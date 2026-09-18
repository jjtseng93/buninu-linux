#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  basenameSafe,
  loadZmodem,
  restoreStdin,
  setRawStdin,
  stderr,
  appendDebugLog,
  writeOctets,
} = require("./zmodem-node");
const {
  BridgeInputParser,
  emitBridgeMessage,
} = require("./windows-bridge-node");

async function main() {
  if (process.argv.includes("-h") || process.argv.includes("--help")) {
    stderr("usage: node rz.js [target-dir]");
    process.exitCode = 0;
    return;
  }

  const targetDir = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  fs.mkdirSync(targetDir, { recursive: true });

  if (process.platform === "win32") {
    await runWindowsBridge(targetDir);
    return;
  }

  const Zmodem = await loadZmodem();
  const session = new Zmodem.Session.Receive();
  let ending = false;
  const completedUploads = [];

  const finish = (code, error) => {
    if (ending) {
      return;
    }
    ending = true;
    restoreStdin();
    if (error) {
      stderr(String(error && error.stack ? error.stack : error));
    } else if (code === 0) {
      for (const file of completedUploads) {
        stderr(`uploaded ${file.path} (${formatByteCount(file.size)})`);
      }
    }
    process.exitCode = code;
  };

  process.on("SIGINT", () => {
    try {
      if (!session.has_ended()) {
        session.abort();
      }
    } catch {}
    finish(130);
  });

  session.set_sender((octets) => {
    void writeOctets(octets).catch((error) => finish(1, error));
  });

  session.on("offer", (offer) => {
    void receiveOffer(offer, targetDir, completedUploads).catch((error) => {
      try {
        session.abort();
      } catch {}
      finish(1, error);
    });
  });

  session.on("session_end", () => {
    finish(0);
  });

  process.stdin.on("data", (chunk) => {
    try {
      session.consume(Array.from(chunk));
    } catch (error) {
      finish(1, error);
    }
  });

  process.stdin.on("end", () => {
    if (!ending) {
      finish(session.has_ended() ? 0 : 1, session.has_ended() ? null : new Error("stdin ended before ZMODEM session completed"));
    }
  });

  setRawStdin();
  stderr(`rz ready: waiting for sender, target dir ${targetDir}`);
  session.start();
}

async function runWindowsBridge(targetDir) {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let finished = false;

  const finish = (code, error) => {
    if (finished) {
      return;
    }
    finished = true;
    if (error) {
      stderr(String(error && error.stack ? error.stack : error));
    }
    restoreStdin();
    process.exitCode = code;
  };

  const parser = new BridgeInputParser((message) => {
    try {
      if (!message || message.requestId !== requestId) {
        return;
      }

      if (message.op === "upload_cancel") {
        finish(1, new Error("upload canceled"));
        return;
      }

      if (message.op === "upload_error") {
        finish(1, new Error(String(message.message || "upload failed")));
        return;
      }

      if (message.op === "upload_finish") {
        finish(0);
      }
    } catch (error) {
      finish(1, error);
    }
  });

  process.on("SIGINT", () => finish(130));
  process.stdin.on("data", (chunk) => parser.consume(chunk));
  process.stdin.on("end", () => {
    if (!finished) {
      finish(1, new Error("stdin ended before upload completed"));
    }
  });

  setRawStdin();
  stderr(`rz ready: waiting for sender, target dir ${targetDir}`);
  emitBridgeMessage({
    op: "upload_request",
    requestId,
    targetDir,
  });
}

async function receiveOffer(offer, targetDir, completedUploads) {
  const details = offer.get_details();
  const originalName = details.name;
  const localName = basenameSafe(originalName);
  const outputPath = path.join(targetDir, localName);
  const fd = fs.openSync(outputPath, "w", details.mode ? details.mode & 0o777 : 0o644);
  let receivedBytes = 0;

  debug(`receiving ${originalName} -> ${outputPath}`);

  try {
    await offer.accept({
      on_input: (payload) => {
        const buffer = Buffer.from(payload);
        fs.writeSync(fd, buffer);
        receivedBytes += buffer.length;
      },
    });
  } finally {
    fs.closeSync(fd);
  }

  if (details.mtime instanceof Date && !Number.isNaN(details.mtime.valueOf())) {
    fs.utimesSync(outputPath, new Date(), details.mtime);
  }

  completedUploads.push({ path: outputPath, size: receivedBytes });
  debug(`received ${outputPath}`);
}

function debug(message) {
  appendDebugLog(message);
}

function formatByteCount(bytes) {
  return `${Number(bytes || 0).toLocaleString()} bytes`;
}

main().catch((error) => {
  restoreStdin();
  stderr(String(error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
