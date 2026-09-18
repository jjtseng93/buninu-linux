const fs = require("fs");
const os = require("os");
const path = require("path");

const MARKER_PREFIX = "@@GOTTYCTL:";
const MARKER_SUFFIX = "@@";
const SIDE_CAR_DIR = path.join(os.tmpdir(), "js-gotty-bridge");

function sidecarPath(id) {
  return path.join(SIDE_CAR_DIR, `${id}.json`);
}

function emitBridgeMessage(message) {
  let payloadMessage = message;
  if (process.platform === "win32") {
    fs.mkdirSync(SIDE_CAR_DIR, { recursive: true });
    const id = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    fs.writeFileSync(sidecarPath(id), JSON.stringify(message), "utf8");
    payloadMessage = { $f: id };
  }
  const payload = Buffer.from(JSON.stringify(payloadMessage), "utf8").toString("base64");
  process.stdout.write(`${MARKER_PREFIX}${payload}${MARKER_SUFFIX}`);
}

class BridgeInputParser {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.pending = "";
  }

  consume(chunk) {
    const data = this.pending + chunk.toString("utf8");
    let offset = 0;

    for (;;) {
      const start = data.indexOf(MARKER_PREFIX, offset);
      if (start === -1) {
        this.pending = data.slice(offset);
        return;
      }

      const payloadStart = start + MARKER_PREFIX.length;
      const end = data.indexOf(MARKER_SUFFIX, payloadStart);
      if (end === -1) {
        this.pending = data.slice(start);
        return;
      }

      const payload = data.slice(payloadStart, end);
      const message = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
      this.onMessage(message);
      offset = end + MARKER_SUFFIX.length;
    }
  }
}

module.exports = {
  BridgeInputParser,
  emitBridgeMessage,
};
