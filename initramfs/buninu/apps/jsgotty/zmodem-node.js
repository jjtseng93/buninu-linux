const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");
const vm = require("vm");

let cachedZmodem = null;
let savedTtyMode = null;
let ttyModeDepth = 0;
let rawOutputMode = false;
const defaultDebugLogPath = path.join(os.tmpdir(), "zmodem", "zmodem.log");
const debugLogPath = resolveDebugLogPath();
const ZMODEM_ASSET = "static/js/zmodem.js";
//  ESM, and Bun-only in practice: under Node there is nothing embedded, so
//  the source checkout's own copy is the only answer anyway.
const assetsHelperPromise = globalThis.Bun
  ? import("./single-exe/assetsHelper.js").catch(() => null)
  : Promise.resolve(null);

async function loadZmodem() {
  if (cachedZmodem) {
    return cachedZmodem;
  }

  await globalThis.assetsLoaderPromise;
  const assets = await assetsHelperPromise;
  const source = assets
    ? assets.readAssetTextSync(ZMODEM_ASSET)
    : fs.readFileSync(path.join(__dirname, ZMODEM_ASSET), "utf8");
  //  Only a label for stack traces out of the vm context.
  const bundlePath = assets
    ? assets.assetDiskPath(ZMODEM_ASSET)
    : path.join(__dirname, ZMODEM_ASSET);
  const quietConsole = {
    debug() {},
    log() {},
    warn() {},
    error: (...args) => process.stderr.write(`${args.join(" ")}\n`),
  };

  const context = {
    Array,
    ArrayBuffer,
    Blob: typeof Blob === "undefined" ? undefined : Blob,
    Buffer,
    Date,
    Int32Array,
    Math,
    Object,
    Promise,
    TextDecoder,
    TextEncoder,
    URL: typeof URL === "undefined" ? undefined : URL,
    Uint8Array,
    clearTimeout,
    console: quietConsole,
    setTimeout,
  };
  context.window = context;
  context.global = context;
  context.globalThis = context;

  vm.runInNewContext(source, context, { filename: bundlePath });

  if (!context.Zmodem) {
    throw new Error("failed to load ZMODEM bundle");
  }

  cachedZmodem = context.Zmodem;
  return cachedZmodem;
}

function writeOctets(octets) {
  let buffer = Buffer.isBuffer(octets) ? octets : Buffer.from(octets);
  if (process.stdout.isTTY && process.platform !== "win32" && !rawOutputMode) {
    buffer = normalizeTtyOutput(buffer);
  }
  return new Promise((resolve, reject) => {
    process.stdout.write(buffer, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function normalizeTtyOutput(buffer) {
  const output = Buffer.allocUnsafe(buffer.length);
  for (let index = 0; index < buffer.length; index += 1) {
    const value = buffer[index];
    output[index] = value === 0x0a ? 0x8a : value;
  }
  return output;
}

function setRawStdin() {
  ttyModeDepth += 1;
  if (ttyModeDepth === 1) {
    savedTtyMode = saveAndSetRawTtyMode();
    rawOutputMode = !!savedTtyMode;
    debugTty(
      `setRawStdin depth=${ttyModeDepth} stdinTTY=${!!process.stdin.isTTY} stdoutTTY=${!!process.stdout.isTTY} saved=${!!savedTtyMode} rawOutputMode=${rawOutputMode}`,
    );
    if (!savedTtyMode && process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      process.stdin.setRawMode(true);
      debugTty("setRawStdin fallback=process.stdin.setRawMode(true)");
    }
  }
  process.stdin.resume();
}

function restoreStdin() {
  if (ttyModeDepth > 0) {
    ttyModeDepth -= 1;
  }
  if (ttyModeDepth === 0) {
    if (savedTtyMode) {
      debugTty(`restoreStdin restoring stty mode ${savedTtyMode}`);
      restoreTtyMode(savedTtyMode);
    } else if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
      debugTty("restoreStdin fallback=process.stdin.setRawMode(false)");
      process.stdin.setRawMode(false);
    }
    savedTtyMode = null;
    rawOutputMode = false;
  }
  process.stdin.pause();
}

function saveAndSetRawTtyMode() {
  if (process.platform === "win32" || !process.stdin.isTTY) {
    debugTty(`saveAndSetRawTtyMode skipped platform=${process.platform} stdinTTY=${!!process.stdin.isTTY}`);
    return null;
  }

  const tty = openControlTty();
  if (tty === null) {
    debugTty("saveAndSetRawTtyMode could not open /dev/tty");
    return null;
  }

  try {
    const saved = spawnSync("stty", ["-g"], {
      encoding: "utf8",
      stdio: [tty.fd, "pipe", "pipe"],
    });
    if (saved.status !== 0 || !saved.stdout.trim()) {
      debugTty(`saveAndSetRawTtyMode stty -g failed status=${saved.status} stderr=${String(saved.stderr || "").trim()}`);
      return null;
    }

    const mode = saved.stdout.trim();
    debugTty(`saveAndSetRawTtyMode captured mode=${mode}`);
    const raw = spawnSync("stty", ["raw", "-echo", "-opost", "-ixon", "-ixoff"], {
      encoding: "utf8",
      stdio: [tty.fd, "ignore", "pipe"],
    });
    if (raw.status !== 0) {
      debugTty(`saveAndSetRawTtyMode stty raw failed status=${raw.status} stderr=${String(raw.stderr || "").trim()}`);
      restoreTtyMode(mode);
      return null;
    }

    debugTty("saveAndSetRawTtyMode raw mode enabled");
    return mode;
  } finally {
    if (tty.close) {
      tty.close();
    }
  }
}

function restoreTtyMode(mode) {
  if (!mode || process.platform === "win32") {
    debugTty(`restoreTtyMode skipped mode=${!!mode} platform=${process.platform}`);
    return;
  }

  const tty = openControlTty();
  if (tty === null) {
    debugTty(`restoreTtyMode could not open /dev/tty for mode=${mode}`);
    return;
  }

  try {
    spawnSync("stty", [mode], {
      encoding: "utf8",
      stdio: [tty.fd, "ignore", "ignore"],
    });
    debugTty(`restoreTtyMode applied mode=${mode}`);
  } finally {
    if (tty.close) {
      tty.close();
    }
  }
}

function openControlTty() {
  try {
    const fd = fs.openSync("/dev/tty", "r+");
    return {
      fd,
      close: () => fs.closeSync(fd),
    };
  } catch {
    if (typeof process.stdin.fd === "number") {
      return {
        fd: process.stdin.fd,
        close: null,
      };
    }
    return null;
  }
}

function debugTty(message) {
  appendDebugLog(message);
}

function appendDebugLog(message) {
  if (!debugLogPath) {
    return;
  }
  fs.mkdirSync(path.dirname(debugLogPath), { recursive: true });
  fs.appendFileSync(debugLogPath, `${new Date().toISOString()} ${message}\n`);
}

function resolveDebugLogPath() {
  const value = process.env.JSGOTTY_ZMODEM_LOG || "";
  if (!value) {
    return "";
  }
  if (/^(1|true|yes)$/i.test(value)) {
    return defaultDebugLogPath;
  }
  return path.resolve(value);
}

function stderr(message) {
  process.stderr.write(`${message}\n`);
}

function basenameSafe(name) {
  const base = path.basename(name || "");
  if (!base || base === "." || base === "..") {
    throw new Error(`invalid filename from peer: ${JSON.stringify(name)}`);
  }
  return base;
}

module.exports = {
  basenameSafe,
  loadZmodem,
  restoreStdin,
  setRawStdin,
  stderr,
  debugLogPath,
  appendDebugLog,
  writeOctets,
};
