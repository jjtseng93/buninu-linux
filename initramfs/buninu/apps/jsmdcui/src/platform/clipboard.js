import { firstCommand, isLinuxLike, platformId, runSync } from "./commands.js";

const CLIPBOARD_TIMEOUT_MS = 2000;
const internalRegisters = new Map();

export class ClipboardManager {
  constructor() {
    this.backend = detectClipboardBackend();
    this._writeBackend = null;
    this._altBackend = null;
    this._readFromInternal = false;
  }

  methodName() {
    return (this._writeBackend ?? this.backend).name;
  }

  readMethodName(register = "clipboard") {
    if (register !== "clipboard" && register !== "primary") return "internal";
    if (register === "clipboard" && this._readFromInternal) return "internal";
    if (register === "primary" && !this.backend.supportsPrimary) return "internal";
    return this.backend.name;
  }

  altMethodName() {
    return this._altBackend?.name ?? null;
  }

  fallbackToInternal() {
    this.backend = internalClipboard();
    this._writeBackend = null;
    this._altBackend = null;
    this._readFromInternal = false;
    return this.backend;
  }

  read(register = "clipboard") {
    if (register !== "clipboard" && register !== "primary") {
      return internalRegisters.get(register) ?? "";
    }
    if (register === "primary" && !this.backend.supportsPrimary) {
      return internalRegisters.get(register) ?? "";
    }
    // terminal mode: paste from internal to avoid OSC 52 read issues over SSH
    if (register === "clipboard" && this._readFromInternal) {
      return internalRegisters.get(register) ?? "";
    }
    try {
      const text = this.backend.read?.(register);
      if (text == null) return internalRegisters.get(register) ?? "";
      return text;
    } catch {
      return this.fallbackToInternal().read(register);
    }
  }

  write(text, register = "clipboard") {
    internalRegisters.set(register, text);
    if (register !== "clipboard" && register !== "primary") return true;
    const wb = this._writeBackend ?? this.backend;
    if (register === "primary" && !wb.supportsPrimary) return true;
    try {
      const ok = wb.write?.(text, register) ?? true;
      if (!ok) {
        if (wb === this._writeBackend) this._writeBackend = null;
        else this.fallbackToInternal();
      }
      return true;
    } catch {
      if (wb === this._writeBackend) this._writeBackend = null;
      else this.fallbackToInternal();
      return true;
    }
  }

  writeAlt(text, register = "clipboard") {
    if (!this._altBackend) return false;
    internalRegisters.set(register, text);
    try {
      return this._altBackend.write?.(text, register) ?? true;
    } catch {
      return false;
    }
  }

  async initFromSetting(setting, ttyIn, ttyOut, timeoutMs = 150) {
    this.backend = detectClipboardBackend();
    this._writeBackend = null;
    this._altBackend = null;
    this._readFromInternal = false;
    if (setting === "internal") {
      this.fallbackToInternal();
      return;
    }
    if (setting === "terminal") {
      // skip probe — directly enable OSC 52 write (handles write-only terminals)
      if (ttyOut) {
        this._altBackend = this.backend;   // external as clickable alt
        this._writeBackend = osc52Clipboard(ttyOut);
        this._readFromInternal = true;     // paste via internal (SSH-safe)
      }
    } else {
      // "external" (default): probe OSC 52 as optional alt
      if (ttyIn && ttyOut && process.stdout?.isTTY) {
        const ok = await probeOSC52(ttyIn, ttyOut, timeoutMs);
        if (ok) this._altBackend = osc52Clipboard(ttyOut);
      }
    }
  }

  // kept for backward compatibility (--version probe etc.)
  async probeAndUpgradeOSC52(ttyIn, ttyOut, timeoutMs = 150) {
    const ok = await probeOSC52(ttyIn, ttyOut, timeoutMs);
    if (ok) this._writeBackend = osc52Clipboard(ttyOut);
  }
}

function detectClipboardBackend() {
  const platform = platformId();

  if (platform === "android") {
    const termuxSet = firstCommand(["termux-clipboard-set"]);
    const termuxGet = firstCommand(["termux-clipboard-get"]);
    if (termuxSet && termuxGet) return termuxClipboard(termuxSet, termuxGet);
  }

  if (isLinuxLike()) {
    const wlCopy = firstCommand(["wl-copy"]);
    const wlPaste = firstCommand(["wl-paste"]);
    if (wlCopy && wlPaste) return wlClipboard(wlCopy, wlPaste);

    const xclip = firstCommand(["xclip"]);
    if (xclip) return xclipClipboard(xclip);

    const xsel = firstCommand(["xsel"]);
    if (xsel) return xselClipboard(xsel);

    return internalClipboard();
  }

  if (platform === "darwin") {
    const pbcopy = firstCommand(["pbcopy"]);
    const pbpaste = firstCommand(["pbpaste"]);
    if (pbcopy && pbpaste) return commandClipboard("pbcopy/pbpaste", [pbcopy], [pbpaste]);
    return internalClipboard();
  }

  if (platform === "win32") {
    const shell = firstCommand(["pwsh.exe", "powershell.exe", "pwsh", "powershell"]);
    if (shell) return powershellClipboard(shell);
    return internalClipboard();
  }

  return internalClipboard();
}

function internalClipboard() {
  return {
    name: "internal",
    read: (register) => internalRegisters.get(register) ?? "",
    write: (text, register) => {
      internalRegisters.set(register, text);
      return true;
    },
  };
}

function commandClipboard(name, writeCommand, readCommand) {
  return {
    name,
    read: () => outputOrThrow(runSync(readCommand, { timeout: CLIPBOARD_TIMEOUT_MS })),
    write: (text) => runSync(writeCommand, { stdin: text, stdout: "ignore", timeout: CLIPBOARD_TIMEOUT_MS }).ok,
  };
}

function termuxClipboard(set, get) {
  return commandClipboard("termux", [set], [get]);
}

function wlClipboard(wlCopy, wlPaste) {
  return {
    name: "wl-clipboard",
    supportsPrimary: true,
    read: (register) => {
      const args = [wlPaste, "--no-newline"];
      if (register === "primary") args.push("--primary");
      return outputOrThrow(runSync(args, { timeout: CLIPBOARD_TIMEOUT_MS }));
    },
    write: (text, register) => {
      const args = [wlCopy];
      if (register === "primary") args.push("--primary");
      return runSync(args, { stdin: text, stdout: "ignore", timeout: CLIPBOARD_TIMEOUT_MS }).ok;
    },
  };
}

function xclipClipboard(xclip) {
  return {
    name: "xclip",
    supportsPrimary: true,
    read: (register) => {
      const selection = register === "primary" ? "primary" : "clipboard";
      return outputOrThrow(runSync([xclip, "-selection", selection, "-o"], { timeout: CLIPBOARD_TIMEOUT_MS }));
    },
    write: (text, register) => {
      const selection = register === "primary" ? "primary" : "clipboard";
      return runSync([xclip, "-selection", selection], { stdin: text, stdout: "ignore", timeout: CLIPBOARD_TIMEOUT_MS }).ok;
    },
  };
}

function xselClipboard(xsel) {
  return {
    name: "xsel",
    supportsPrimary: true,
    read: (register) => {
      const selection = register === "primary" ? "--primary" : "--clipboard";
      return outputOrThrow(runSync([xsel, selection, "--output"], { timeout: CLIPBOARD_TIMEOUT_MS }));
    },
    write: (text, register) => {
      const selection = register === "primary" ? "--primary" : "--clipboard";
      return runSync([xsel, selection, "--input"], { stdin: text, stdout: "ignore", timeout: CLIPBOARD_TIMEOUT_MS }).ok;
    },
  };
}

function powershellClipboard(shell) {
  return {
    name: "powershell",
    // Get-Clipboard -Raw appends \r\n to stdout; strip exactly one trailing line ending.
    read: () => outputOrThrow(runSync([shell, "-NoProfile", "-Command", "Get-Clipboard -Raw"], {})).replace(/\r?\n$/, ""),
    write: (text) => {
      text=(text+'').replaceAll("'","''") ;
      return runSync([shell, "-NoProfile", "-Command", `Set-Clipboard '${text}'`], { stdout: "ignore" }).ok ;
    },
  };
}

function outputOrThrow(result) {
  if (!result.ok) throw new Error(result.stderr || result.stdout || "clipboard command failed");
  return result.stdout;
}

export function osc52Clipboard(stdout) {
  const inTmux = !!process.env.TMUX;
  return {
    name: "OSC 52",
    write(text) {
      const b64 = Buffer.from(text, "utf-8").toString("base64");
      stdout.write(inTmux
        ? `\x1bPtmux;\x1b\x1b]52;c;${b64}\x07\x1b\\`
        : `\x1b]52;c;${b64}\x07`);
      return true;
    },
  };
}

export async function probeOSC52(ttyIn, ttyOut, timeoutMs) {
  return true;
  // Almost no terminal reliably supports probing OSC 52, so treat it as
  // available and let the actual write path fail or work on its own.
  if (process.env.TMUX) return true;
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; ttyIn.removeListener("data", onData); resolve(false); }
    }, timeoutMs);
    function onData(chunk) {
      if (done) return;
      const s = Buffer.isBuffer(chunk) ? chunk.toString("latin1") : String(chunk);
      if (s.includes("\x1b]52;")) {
        done = true; clearTimeout(timer); ttyIn.removeListener("data", onData); resolve(true);
      }
    }
    ttyIn.on("data", onData);
    ttyOut.write("\x1b]52;c;?\x07");
  });
}
