#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const {
  loadZmodem,
  restoreStdin,
  setRawStdin,
  stderr,
  appendDebugLog,
  writeOctets,
} = require("./zmodem-node");
const { BridgeInputParser, emitBridgeMessage } = require("./windows-bridge-node");

async function main() {
  const inputPaths = process.argv.slice(2);
  if (inputPaths.length === 0 || inputPaths.includes("-h") || inputPaths.includes("--help")) {
    stderr("usage: node sz.js <file> [more files...]");
    process.exitCode = inputPaths.length === 0 ? 1 : 0;
    return;
  }

  const files = inputPaths.map((filePath) => buildFileSpec(filePath));
  if (process.platform === "win32") {
    await runWindowsBridge(files);
    return;
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const Zmodem = await loadZmodem();
  let writeQueue = Promise.resolve();
  let queuedOutputBytes = 0;
  let lastQueuedOutputLog = 0;
  const completedDownloads = [];
  const queueWriteOctets = (octets) => {
    const length = Buffer.isBuffer(octets) ? octets.length : octets.length || 0;
    queuedOutputBytes += length;
    if (queuedOutputBytes - lastQueuedOutputLog >= 4 * 1024 * 1024) {
      lastQueuedOutputLog = queuedOutputBytes;
      debug(`sz debug: queued zmodem output ${queuedOutputBytes.toLocaleString()} bytes`);
    }
    writeQueue = writeQueue.then(() => writeOctets(octets));
    writeQueue.catch((error) => fatal(1, error));
    return writeQueue;
  };
  const waitForOutput = async (label = "") => {
    if (label) {
      debug(`sz debug: waiting output drain (${label}) queued=${queuedOutputBytes.toLocaleString()}`);
    }
    await writeQueue;
    if (label) {
      debug(`sz debug: output drained (${label})`);
    }
  };
  const sentry = new Zmodem.Sentry({
    to_terminal: () => {},
    on_detect: (detection) => {
      void handleDetection(detection, files, totalBytes, waitForOutput).catch((error) => fatal(1, error));
    },
    on_retract: () => {},
    sender: (octets) => {
      queueWriteOctets(octets);
    },
  });

  let done = false;

  const finish = (code, error) => {
    if (done) {
      return;
    }
    done = true;
    restoreStdin();
    if (error) {
      stderr(String(error && error.stack ? error.stack : error));
    } else if (code === 0) {
      for (const file of completedDownloads) {
        stderr(`downloaded ${file.name} (${formatByteCount(file.size)})`);
      }
    }
    process.exitCode = code;
  };

  const fatal = (code, error) => {
    finish(code, error);
  };

  process.on("SIGINT", () => finish(130));

  process.stdin.on("data", (chunk) => {
    try {
      sentry.consume(chunk);
    } catch (error) {
      fatal(1, error);
    }
  });

  process.stdin.on("end", () => {
    if (!done) {
      fatal(1, new Error("stdin ended before ZMODEM session completed"));
    }
  });

  setRawStdin();
  stderr(`sz ready: waiting for receiver (${files.length} file${files.length > 1 ? "s" : ""})`);
  await writeOctets(Zmodem.Header.build("ZRQINIT").to_hex());

  async function handleDetection(detection, fileSpecs, allBytes, waitForOutput) {
    const session = detection.confirm();
    if (session.type !== "send") {
      throw new Error(`unexpected session type: ${session.type}`);
    }

    session.on("session_end", () => {
      debug("sz debug: session_end");
    });
    session.on("receive", (event) => {
      if (event && event.NAME) {
        debug(`sz debug: rx header ${event.NAME}`);
      }
    });

    let remainingBytes = allBytes;

    for (let index = 0; index < fileSpecs.length; index += 1) {
      const file = fileSpecs[index];
      debug(`sending ${file.fullPath}`);

      const transfer = await session.send_offer({
        bytes_remaining: remainingBytes,
        files_remaining: fileSpecs.length - index,
        mode: file.mode,
        mtime: file.mtime,
        name: file.name,
        size: file.size,
      });

      if (!transfer) {
        stderr(`skipped ${file.name}`);
        remainingBytes -= file.size;
        continue;
      }

      const sentBytes = await sendFilePayload(file.fullPath, transfer, waitForOutput, file.size);
      completedDownloads.push({ name: file.name, size: sentBytes });
      debug(`sent ${file.name}`);
      remainingBytes -= file.size;
    }

    debug("sz debug: closing session");
    await session.close();
    await waitForOutput("session close");
    finish(0);
  }
}

async function runWindowsBridge(files) {
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let finished = false;

  const finish = (code, error) => {
    if (finished) {
      return;
    }
    finished = true;
    restoreStdin();
    if (error) {
      stderr(String(error && error.stack ? error.stack : error));
    }
    process.exitCode = code;
  };

  const parser = new BridgeInputParser((message) => {
    if (!message || message.requestId !== requestId) {
      return;
    }
    if (message.op === "download_error") {
      finish(1, new Error(String(message.message || "download failed")));
      return;
    }
    if (message.op === "download_finish") {
      finish(0);
    }
  });

  process.on("SIGINT", () => finish(130));
  process.stdin.on("data", (chunk) => parser.consume(chunk));
  process.stdin.on("end", () => {
    if (!finished) {
      finish(1, new Error("stdin ended before download completed"));
    }
  });

  setRawStdin();
  stderr(`sz ready: sending ${files.length} file${files.length > 1 ? "s" : ""}`);
  emitBridgeMessage({
    op: "download_request",
    requestId,
    files: files.map((file) => ({
      fullPath: file.fullPath,
      name: file.name,
    })),
  });
}

function buildFileSpec(filePath) {
  const fullPath = path.resolve(filePath);
  const stats = fs.statSync(fullPath);

  if (!stats.isFile()) {
    throw new Error(`not a regular file: ${filePath}`);
  }

  return {
    fullPath,
    mode: stats.mode & 0o777,
    mtime: stats.mtime,
    name: path.basename(fullPath),
    size: stats.size,
  };
}

async function sendFilePayload(filePath, transfer, waitForOutput, fileSize) {
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(8192);
  const maxPendingOutputBytes = 1024 * 1024;
  let pendingOutputBytes = 0;
  let sentBytes = 0;
  let lastSentLog = 0;

  try {
    for (;;) {
      const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead === 0) {
        break;
      }
      transfer.send(buffer.subarray(0, bytesRead));
      sentBytes += bytesRead;
      if (sentBytes - lastSentLog >= 4 * 1024 * 1024 || sentBytes === fileSize) {
        lastSentLog = sentBytes;
        debug(`sz debug: file payload sent ${sentBytes.toLocaleString()}/${fileSize.toLocaleString()} bytes`);
      }
      pendingOutputBytes += bytesRead;
      if (pendingOutputBytes >= maxPendingOutputBytes) {
        await waitForOutput(`payload ${sentBytes.toLocaleString()}`);
        pendingOutputBytes = 0;
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  debug("sz debug: transfer.end begin");
  const endPromise = transfer.end();
  await waitForOutput("transfer end");
  await endPromise;
  debug("sz debug: transfer.end complete");
  return sentBytes;
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
