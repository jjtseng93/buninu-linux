#!/usr/bin/env bun

//Object.defineProperty(process,"platform",{value:'linux'})

const fs = require("fs");
const http = require("http");
const https = require("https");
const net = require("net");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { constants: fsConstants } = require("fs");
const WebSocket = require("ws");
const { WebSocketServer } = WebSocket;

const MSG_INPUT = "1";
const MSG_PING = "2";
const MSG_RESIZE_TERMINAL = "3";
const MSG_SET_ENCODING = "4";
const MSG_INPUT_BINARY = "8";

const MSG_OUTPUT = "1";
const MSG_PONG = "2";
const MSG_SET_WINDOW_TITLE = "3";
const MSG_SET_PREFERENCES = "4";
const MSG_SET_RECONNECT = "5";
const MSG_SET_BUFFER_SIZE = "6";
const MSG_KITTY_GRAPHICS = "7";
const MSG_WINDOWS_BRIDGE = "9";
const MSG_SET_ROLE = "a";
const MSG_CONTROL_RESULT = "b";
const MSG_ZMODEM_MODE = "z";
const MSG_ZMODEM_OUTPUT = "y";
const MSG_ZMODEM_ACK = "Y";
const MSG_KITTY_DEBUG = "K";
const KITTY_TRACE = /^(1|true|yes|on)$/i.test(String(process.env.JSGOTTY_KITTY_DEBUG || ""));
const WINDOWS_BRIDGE_TRACE = process.env.WINDOWS_BRIDGE_TRACE === "1";
const WINDOWS_BRIDGE_PREFIX = Buffer.from("@@GOTTYCTL:", "ascii");
const WINDOWS_BRIDGE_SUFFIX = Buffer.from("@@", "ascii");
const KITTY_PLACEMENT_LOG = path.resolve(__dirname, "kitty-placement.log");

function kittyPlacementLog(stage, details = {}) {
  if (!KITTY_TRACE) {
    return;
  }
  try {
    fs.appendFileSync(KITTY_PLACEMENT_LOG, JSON.stringify({
      time: new Date().toISOString(),
      pid: process.pid,
      stage,
      ...details,
    }) + "\n");
  } catch (error) {
    // Placement diagnostics must never affect terminal output.
  }
}

function cursorControls(buffer) {
  const text = Buffer.from(buffer).toString("utf8");
  return Array.from(text.matchAll(/\u001b\[([0-9;?]*)([A-Za-z])/g), (match) => ({
    params: match[1],
    final: match[2],
  })).filter((entry) => "ABCDEFGHfJKhl".includes(entry.final));
}

const DEFAULTS = {
  address: "0.0.0.0",
  port: "8080",
  path: "/",
  permitWrite: false,
  credential: "",
  randomUrl: false,
  randomUrlLength: 16,
  tls: false,
  tlsCrt: "~/.gotty.crt",
  tlsKey: "~/.gotty.key",
  index: "",
  titleFormat: "{{ .command }}@{{ .hostname }}",
  reconnect: false,
  reconnectTime: -1,
  maxConnection: -1,
  once: false,
  timeout: -1,
  permitArguments: false,
  passHeaders: false,
  width: 0,
  height: 0,
  wsOrigin: "",
  wsQueryArgs: "",
  webgl: false,
  quiet: false,
  closeSignal: "SIGINT",
  closeTimeout: -1
};

const compiledHelperPromise = import("./single-exe/compiled.js").catch(() => null);
const assetsHelperPromise = import("./single-exe/assetsHelper.js").catch(() => null);

//  Assets are addressed by the package-relative keys package.json declares
//  ("static/index.html", "README.md"). assetsHelper turns a key into bytes,
//  wherever they live: the embedded store, the compiled binary's virtual
//  filesystem, or a file on disk. Nothing here builds an absolute path.
let assets = null;

//  Node runs this file without the ESM-only helper. Then there is nothing
//  embedded either, so a key is just a path under the source checkout.
function assetText(key) {
  return assets
    ? assets.readAssetTextSync(key)
    : fs.readFileSync(path.join(__dirname, key), "utf8");
}

function assetFilePath(key) {
  return assets ? assets.assetDiskPath(key) : path.join(__dirname, key);
}

//  URL-relative path -> asset key, or null when it escapes `static/`.
//  Normalizing against "/" is what makes "../../etc/passwd" unreachable.
function staticAssetKey(relativePath) {
  const rel = path.posix.normalize(`/${String(relativePath ?? "")}`).slice(1);
  if (!rel || rel === ".." || rel.startsWith("../")) return null;
  return `static/${rel}`;
}

let cliBootstrapPromise = null;
for (const i of ["rz.js", "sz.js", "viu.mjs", "client.mjs"]) {
  let subcmd = i.split(".")[0] ;
  if (process.argv[2] === `--${subcmd}`) {
    process.argv.splice(2, 1);
    process.argv[1] = process.argv[1].replace(/gotty\.js$/, i);
    cliBootstrapPromise = (async () => {
    
      if(subcmd=="rz")
        await import("./rz.js");
      else if(subcmd=="sz")
        await import("./sz.js");
      else if(subcmd=="viu")
        await import("./viu.mjs");
      else if(subcmd=="client")
        await import("./client.mjs");
        
    })().catch((error) => {
      console.error(String(error && error.stack ? error.stack : error));
      process.exitCode = 1;
    });
    break;
  }
}


const pkg = require('./package.json');


function printUsage() {
  console.log(`GoTTY JavaScript rewrite
  Linux/macOS: use Bun
  Windows: use Bun/Node
Version: ${pkg.version}
  
Usage: bun gotty.js [options] <command> [<arguments...>]

Built-in tools:
  --rz                          Start rz.js
  --sz                          Start sz.js
  --viu                         Start viu.mjs
  --client                      Start client.mjs

Options:
  -a, --address <value>         IP address to listen 
    (default: 0.0.0.0)
    
  -p, --port <value>            Port number to listen 
    (default: 8080)
    
  -w, --permit-write            Permits writing to the TTY
    (default: disabled)

  -m, --path <value>            Base path 
    (default: /)
    
  -c, --credential <user:pass>  Credential for Basic Authentication 
    
  --once                        Accept only one client and exit on disconnect
    (default: disabled)
    
  -r, --random-url              Add a random string to the URL
  --random-url-length <value>   Random URL length 
    (default: 16)
    
  -t, --tls                     Enable TLS/SSL
  --tls-crt <value>             TLS certificate file path
    (default: ~/.gotty.crt)
  --tls-key <value>             TLS key file path
    (default: ~/.gotty.key)
    
  --index <value>               Custom index.html file
    (default: static/index.html)
  --title-format <value>        Title format 
    (default: {{ .command }}@{{ .hostname }} )
    
  --reconnect, --session        Enable session mode
    Keep the PTY session resumable after the browser disconnects
    (default: disabled)
  --reconnect-time <value>      Time to preserve original TTY (seconds)
    (default: -1 (forever) )
    
  --max-connection <value>      Maximum concurrent clients
    (default: -1 (no limit) )

  --timeout <value>             Timeout waiting for first/next client (seconds)
    (default: -1)
    
  --permit-arguments            Permit query args from the client
    ?arg=a&arg=b... from URL => appends to command argv
    (default: disabled)
    
  --pass-headers                Pass HTTP request headers as environment variables
    Request headers => child env: HTTP_USER_AGENT=...
    (default: disabled)
    
  --width <value>               Fixed terminal width
    (default: 0 (auto) )
  --height <value>              Fixed terminal height
    (default: 0 (auto) )
    
  --ws-origin <regex>           Allowed WebSocket Origin regex
    (default: disabled)
  --ws-query-args <value>       Query arguments appended by the browser client
    Adds a fixed query string to the WebSocket URL
    Format: keyA=valA&keyB=valB
    (default: empty)

  --webgl                       Enable xterm WebGL renderer
    (default: disabled)
    
  --quiet                       Disable logging
    (default: log to stderr)
    
  --close-signal <value>        Signal sent to the child on close
    (default: ${DEFAULTS.closeSignal})
  --close-timeout <value>       Seconds before force kill after ${DEFAULTS.closeSignal}
    (default: -1 (disabled) )
    
  --help-web                    Show help for WebUI frontend
  --readme                      Show README.md and exit
  --readme-en                   Show README.en.md and exit
  --help, -h                    Show help for CLI

Experimental:
  --build-exe                   Build a Bun single-file executable and exit
  --build-for <target>          Build a Bun single-file executable for target`);
}

function printMarkdownFile(key) {
  const text = assetText(key);
  const markdownAnsi =
    typeof Bun !== "undefined" &&
    Bun &&
    Bun.markdown &&
    typeof Bun.markdown.ansi === "function"
      ? Bun.markdown.ansi
      : null;
  console.log(markdownAnsi ? markdownAnsi(text, { hyperlinks: true }) : text);
}

function fatal(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function expandHome(filePath) {
  if (!filePath || !filePath.startsWith("~")) {
    return filePath;
  }
  return path.join(os.homedir(), filePath.slice(1));
}

function normalizeBasePath(basePath) {
  let value = basePath || "/";
  if (!value.startsWith("/")) {
    value = `/${value}`;
  }
  if (!value.endsWith("/")) {
    value = `${value}/`;
  }
  return value;
}

function forceRawReadableSocket(socket) {
  if (!socket) {
    return;
  }

  try {
    if (typeof socket.setEncoding === "function") {
      socket.setEncoding(null);
    }
  } catch (error) {
    // ignore
  }

  if (Object.prototype.hasOwnProperty.call(socket, "_decoder")) {
    delete socket._decoder;
  }

  const readableState = socket._readableState;
  if (readableState) {
    readableState.decoder = null;
    readableState.encoding = null;
  }
}

function forceWindowsPtyBinaryMode(proc) {
  if (process.platform !== "win32" || !proc) {
    return;
  }

  forceRawReadableSocket(proc._socket);
  if (proc._agent) {
    forceRawReadableSocket(proc._agent.outSocket);
  }
}

function encodeWindowsBridgeMessage(message) {
  return `${WINDOWS_BRIDGE_PREFIX.toString("ascii")}${Buffer.from(JSON.stringify(message), "utf8").toString("base64")}${WINDOWS_BRIDGE_SUFFIX.toString("ascii")}`;
}

function windowsBridgeSidecarPath(id) {
  return path.join(os.tmpdir(), "js-gotty-bridge", `${id}.json`);
}

function decodeWindowsBridgePayload(payload) {
  const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8"));
  if (!decoded || typeof decoded !== "object" || !decoded.$f) {
    return decoded;
  }

  const filePath = windowsBridgeSidecarPath(String(decoded.$f));
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } finally {
    try {
      fs.unlinkSync(filePath);
    } catch {}
  }
  return JSON.parse(text);
}

function basenameSafe(name) {
  const base = path.basename(name || "");
  if (!base || base === "." || base === "..") {
    throw new Error(`invalid filename from peer: ${JSON.stringify(name)}`);
  }
  return base;
}

class WindowsBridgeParser {
  constructor(label = "parser") {
    this.label = label;
    this.pending = Buffer.alloc(0);
  }

  consume(raw) {
    const data = this.pending.length > 0 ? Buffer.concat([this.pending, raw]) : raw;
    bridgeTrace(this.label, "consume", JSON.stringify({
      rawLength: raw.length,
      pendingLength: this.pending.length,
      combinedLength: data.length,
      prefixIndex: data.indexOf(WINDOWS_BRIDGE_PREFIX),
      suffixIndex: data.indexOf(WINDOWS_BRIDGE_SUFFIX)
    }), previewBuffer(data));
    this.pending = Buffer.alloc(0);
    const plain = [];
    const controls = [];
    let offset = 0;

    for (;;) {
      const start = data.indexOf(WINDOWS_BRIDGE_PREFIX, offset);
      if (start === -1) {
        break;
      }

      if (start > offset) {
        plain.push(data.subarray(offset, start));
      }

      const payloadStart = start + WINDOWS_BRIDGE_PREFIX.length;
      const end = data.indexOf(WINDOWS_BRIDGE_SUFFIX, payloadStart);
      if (end === -1) {
        this.pending = data.subarray(start);
        bridgeTrace(this.label, "pending-incomplete", JSON.stringify({
          start,
          pendingLength: this.pending.length
        }), previewBuffer(this.pending));
        return {
          plain: plain.length === 0 ? Buffer.alloc(0) : plain.length === 1 ? Buffer.from(plain[0]) : Buffer.concat(plain),
          controls
        };
      }

      const payload = data.subarray(payloadStart, end).toString("ascii");
      try {
        controls.push(decodeWindowsBridgePayload(payload));
        bridgeTrace(this.label, "control", JSON.stringify({
          start,
          end,
          controls: controls.length
        }));
      } catch (error) {
        bridgeTrace(this.label, "decode-error", JSON.stringify({
          start,
          end,
          message: error.message
        }), previewBuffer(data.subarray(start, end + WINDOWS_BRIDGE_SUFFIX.length)));
        plain.push(data.subarray(start, end + WINDOWS_BRIDGE_SUFFIX.length));
      }

      offset = end + WINDOWS_BRIDGE_SUFFIX.length;
    }

    if (offset < data.length) {
      const tail = data.subarray(offset);
      let partialPrefixLength = 0;
      const maxPrefixLength = Math.min(tail.length, WINDOWS_BRIDGE_PREFIX.length - 1);
      for (let len = maxPrefixLength; len > 0; len -= 1) {
        if (tail.subarray(tail.length - len).equals(WINDOWS_BRIDGE_PREFIX.subarray(0, len))) {
          partialPrefixLength = len;
          break;
        }
      }

      if (partialPrefixLength > 0) {
        const flushableLength = tail.length - partialPrefixLength;
        if (flushableLength > 0) {
          plain.push(tail.subarray(0, flushableLength));
        }
        this.pending = tail.subarray(flushableLength);
        bridgeTrace(this.label, "pending-partial-prefix", JSON.stringify({
          partialPrefixLength,
          pendingLength: this.pending.length
        }), previewBuffer(this.pending));
      } else {
        plain.push(tail);
      }
    }

    const plainBuffer = plain.length === 0 ? Buffer.alloc(0) : plain.length === 1 ? Buffer.from(plain[0]) : Buffer.concat(plain);
    bridgeTrace(this.label, "result", JSON.stringify({
      plainLength: plainBuffer.length,
      controls: controls.length,
      pendingLength: this.pending.length
    }), plainBuffer.length > 0 ? previewBuffer(plainBuffer) : "{\"length\":0}");

    return {
      plain: plainBuffer,
      controls
    };
  }
}

function randomPathSegment(length) {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const bytes = crypto.randomBytes(length);
  let output = "";
  for (let i = 0; i < length; i += 1) {
    output += alphabet[bytes[i] % alphabet.length];
  }
  return output;
}

function generateReconnectToken() {
  return crypto.randomBytes(24).toString("base64url");
}

function formatReconnectTokenForLog(token) {
  const value = String(token || "");
  if (!value) {
    return "-";
  }
  return value // .slice(0, 8);
}

function parseInteger(name, value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    fatal(`Invalid integer for ${name}: ${value}`, 2);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = { ...DEFAULTS };
  const commandArgs = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) {
        fatal(`Missing value for ${arg}`, 2);
      }
      return argv[i];
    };

    switch (arg) {
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      case "--help-web":
        printMarkdownFile("static/help.md");
        process.exit(0);
        break;
      case "--readme":
        printMarkdownFile("README.md");
        process.exit(0);
        break;
      case "--readme-en":
        printMarkdownFile("README.en.md");
        process.exit(0);
        break;
      case "--address":
      case "-a":
        options.address = next();
        break;
      case "--port":
      case "-p":
        options.port = next();
        break;
      case "--path":
      case "-m":
        options.path = next();
        break;
      case "--permit-write":
      case "-w":
        options.permitWrite = true;
        break;
      case "--credential":
      case "-c":
        options.credential = next();
        break;
      case "--random-url":
      case "-r":
        options.randomUrl = true;
        break;
      case "--random-url-length":
        options.randomUrlLength = parseInteger(arg, next());
        break;
      case "--tls":
      case "-t":
        options.tls = true;
        break;
      case "--tls-crt":
        options.tlsCrt = next();
        break;
      case "--tls-key":
        options.tlsKey = next();
        break;
      case "--index":
        options.index = next();
        break;
      case "--title-format":
        options.titleFormat = next();
        break;
      case "--reconnect":
      case "--session":
        options.reconnect = true;
        break;
      case "--reconnect-time":
        options.reconnectTime = parseInteger(arg, next());
        break;
      case "--max-connection":
        options.maxConnection = parseInteger(arg, next());
        break;
      case "--once":
        options.once = true;
        break;
      case "--timeout":
        options.timeout = parseInteger(arg, next());
        break;
      case "--permit-arguments":
        options.permitArguments = true;
        break;
      case "--pass-headers":
        options.passHeaders = true;
        break;
      case "--width":
        options.width = parseInteger(arg, next());
        break;
      case "--height":
        options.height = parseInteger(arg, next());
        break;
      case "--ws-origin":
        options.wsOrigin = next();
        break;
      case "--ws-query-args":
        options.wsQueryArgs = next();
        break;
      case "--webgl":
        options.webgl = true;
        break;
      case "--quiet":
        options.quiet = true;
        break;
      case "--close-signal":
        options.closeSignal = next();
        break;
      case "--close-timeout":
        options.closeTimeout = parseInteger(arg, next());
        break;
      default:
        if (arg.startsWith("-")) {
          console.error(`Unknown option: ${arg}`);
          options[arg.replace(/^-+/,'')] = true ;
        }
        else{
          commandArgs.push(...argv.slice(i));
          i = argv.length;
        }
        break;
    }
  }

  if (commandArgs.length === 0) {
    printUsage();
    fatal("\nError: No command given.", 1);
  }

  return {
    options,
    command: commandArgs[0],
    argv: commandArgs.slice(1)
  };
}

function logFactory(quiet) {
  return (...parts) => {
    if (!quiet) {
      console.error(...parts);
    }
  };
}

function traceLog(...parts) {
  if (KITTY_TRACE) {
    console.log("[kitty-trace]", ...parts);
  }
}

function bridgeTrace(...parts) {
  if (WINDOWS_BRIDGE_TRACE) {
    console.log("[windows-bridge]", ...parts);
  }
}

function previewBuffer(buffer, limit = 96) {
  const chunk = buffer.subarray(0, Math.min(limit, buffer.length));
  return JSON.stringify({
    length: buffer.length,
    ascii: chunk.toString("latin1").replace(/[^\x20-\x7e]/g, "."),
    hex: chunk.toString("hex")
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".png":
      return "image/png";
    case ".map":
      return "application/json; charset=utf-8";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function renderTemplate(template, variables) {
  return template.replace(/\{\{\s*\.([^}]+?)\s*\}\}/g, (_, expression) => {
    const value = resolveTemplateValue(variables, expression.trim());
    return value == null ? "" : String(value);
  });
}

function resolveTemplateValue(variables, expression) {
  const parts = expression.split(".");
  let current = variables;
  for (const part of parts) {
    if (part === "") {
      continue;
    }
    if (current == null || !(part in current)) {
      return "";
    }
    current = current[part];
  }
  if (Array.isArray(current)) {
    return current.join(" ");
  }
  return current;
}

function buildTitleVariables(command, argv, hostname, remoteAddr, slaveVars) {
  const merged = {
    command,
    argv,
    hostname,
    remote_addr: remoteAddr,
    ...slaveVars,
    server: {
      command,
      argv,
      hostname
    },
    master: {
      remote_addr: remoteAddr
    },
    slave: slaveVars
  };
  return merged;
}

function parseInitMessage(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch (error) {
    throw new Error("failed to authenticate websocket connection");
  }

  return {
    Arguments: typeof parsed.Arguments === "string" ? parsed.Arguments : "",
    AuthToken: typeof parsed.AuthToken === "string" ? parsed.AuthToken : "",
    ReconnectToken: typeof parsed.ReconnectToken === "string"
      ? parsed.ReconnectToken.trim()
      : "",
    ReadOnly: parsed.ReadOnly === true,
    DisconnectWriter: parsed.DisconnectWriter === true,
    TerminateSession: parsed.TerminateSession === true
  };
}

function detectWindowsShell(command) {
  const name = path.basename(String(command || "")).toLowerCase();
  if (name === "powershell" || name === "powershell.exe") {
    return "powershell";
  }
  if (name === "pwsh" || name === "pwsh.exe") {
    return "pwsh";
  }
  if (name === "cmd" || name === "cmd.exe") {
    return "cmd";
  }
  return "";
}

function createHeaderEnvironment(headers) {
  const env = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value == null) {
      continue;
    }
    const normalizedKey = `HTTP_${key.toUpperCase().replace(/-/g, "_")}`;
    env[normalizedKey] = Array.isArray(value) ? value.join(",") : String(value);
  }
  return env;
}

function basicAuthAuthorized(req, credential) {
  const header = req.headers.authorization;
  if (!header) {
    return false;
  }
  const [scheme, encoded] = header.split(" ");
  if (!scheme || !encoded || scheme.toLowerCase() !== "basic") {
    return false;
  }
  let payload;
  try {
    payload = Buffer.from(encoded, "base64").toString("utf8");
  } catch (error) {
    return false;
  }
  return payload === credential;
}

// Match gorilla/websocket's default policy used by upstream GoTTY: non-browser
// clients without Origin are accepted, while browser connections must come
// from the same host. --ws-origin intentionally replaces this default check.
function webSocketOriginAllowed(req, originMatcher = null) {
  const origin = req.headers.origin;

  if (originMatcher) {
    return originMatcher.test(origin || "");
  }
  if (!origin) {
    return true;
  }

  try {
    const originHost = new URL(origin).host;
    const requestHost = req.headers.host || "";
    return originHost !== "" && originHost.toLowerCase() === requestHost.toLowerCase();
  } catch {
    return false;
  }
}

function sendBasicAuthRequired(res) {
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="GoTTY"',
    "Content-Type": "text/plain; charset=utf-8"
  });
  res.end("authorization failed");
}

class CursorStateTracker {
  constructor() {
    this.row = 1;
    this.col = 1;
    this.cols = 80;
    this._state = "text";
    this._params = "";
    this._wrapPending = false;
  }

  snapshot() {
    return { row: this.row, col: this.col };
  }

  setDimensions(cols) {
    if (Number.isFinite(cols) && cols > 0) {
      this.cols = Math.max(1, Math.floor(cols));
      this.col = Math.min(this.col, this.cols);
    }
  }

  consume(buffer) {
    const text = buffer.toString("utf8");
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (this._state === "text") {
        if (ch === "\u001b") {
          this._state = "esc";
          continue;
        }
        if (ch === "\r") {
          this.col = 1;
          this._wrapPending = false;
          continue;
        }
        if (ch === "\n") {
          if (!this._wrapPending) {
            this.row += 1;
          }
          this._wrapPending = false;
          continue;
        }
        if (ch === "\b") {
          this.col = Math.max(1, this.col - 1);
          this._wrapPending = false;
          continue;
        }
        if (this._wrapPending) {
          this.row += 1;
          this.col = 1;
          this._wrapPending = false;
        }
        if (this.col >= this.cols) {
          this._wrapPending = true;
        } else {
          this.col += 1;
        }
        continue;
      }

      if (this._state === "esc") {
        if (ch === "[") {
          this._state = "csi";
          this._params = "";
          continue;
        }
        this._state = "text";
        continue;
      }

      if (this._state === "csi") {
        if ((ch >= "0" && ch <= "9") || ch === ";" || ch === "?" || ch === ">") {
          this._params += ch;
          continue;
        }
        this._applyCsi(ch, this._params);
        this._state = "text";
        this._params = "";
      }
    }
  }

  _applyCsi(finalByte, params) {
    const raw = params.replace(/[?>]/g, "");
    const numbers = raw === "" ? [] : raw.split(";").map((value) => Number.parseInt(value || "0", 10) || 0);
    switch (finalByte) {
      case "A":
        this.row = Math.max(1, this.row - (numbers[0] || 1));
        this._wrapPending = false;
        break;
      case "B":
        this.row = Math.max(1, this.row + (numbers[0] || 1));
        this._wrapPending = false;
        break;
      case "C":
        this.col = Math.max(1, this.col + (numbers[0] || 1));
        this.col = Math.min(this.col, this.cols);
        this._wrapPending = false;
        break;
      case "D":
        this.col = Math.max(1, this.col - (numbers[0] || 1));
        this._wrapPending = false;
        break;
      case "E":
        this.row = Math.max(1, this.row + (numbers[0] || 1));
        this.col = 1;
        this._wrapPending = false;
        break;
      case "F":
        this.row = Math.max(1, this.row - (numbers[0] || 1));
        this.col = 1;
        this._wrapPending = false;
        break;
      case "G":
        this.col = Math.max(1, numbers[0] || 1);
        this.col = Math.min(this.col, this.cols);
        this._wrapPending = false;
        break;
      case "H":
      case "f":
        this.row = Math.max(1, numbers[0] || 1);
        this.col = Math.max(1, numbers[1] || 1);
        this.col = Math.min(this.col, this.cols);
        this._wrapPending = false;
        break;
      default:
        break;
    }
  }

  applyKittyPlacement(control) {
    if (!control || control.C === "1") {
      return;
    }
    const cols = Math.max(0, Number.parseInt(control.c || "0", 10) || 0);
    const rows = Math.max(0, Number.parseInt(control.r || "0", 10) || 0);
    if (cols > 0) {
      this.col += cols;
      if (this.col > this.cols) {
        this.row += Math.floor((this.col - 1) / this.cols);
        this.col = ((this.col - 1) % this.cols) + 1;
      }
    }
    if (rows > 0) {
      this.row += rows;
    }
    this._wrapPending = false;
  }
}

class KittyGraphicsParser {
  constructor() {
    this.pending = Buffer.alloc(0);
    this.transfers = new Map();
    this.images = new Map();
    this.implicitTransferKey = null;
    this.tempRoots = Array.from(new Set(
      [os.tmpdir(), "/tmp", "/dev/shm", process.env.TMPDIR]
        .filter(Boolean)
        .map((entry) => path.resolve(entry))
    ));
  }

  consume(raw) {
    const data = this.pending.length > 0 ? Buffer.concat([this.pending, raw]) : raw;
    this.pending = Buffer.alloc(0);
    const events = [];
    let offset = 0;
    let plainStart = 0;

    while (offset < data.length) {
      if (data[offset] === 0x1b && offset + 2 < data.length && data[offset + 1] === 0x5f && data[offset + 2] === 0x47) {
        const commandEnd = this._findApcEnd(data, offset + 3);
        if (commandEnd === -1) {
          if (plainStart < offset) {
            events.push({ kind: "plain", data: data.subarray(plainStart, offset) });
          }
          this.pending = data.subarray(offset);
          break;
        }

        if (plainStart < offset) {
          events.push({ kind: "plain", data: data.subarray(plainStart, offset) });
        }

        const packet = data.subarray(offset + 3, commandEnd);
        events.push({ kind: "kitty", packet });

        offset = commandEnd + 2;
        plainStart = offset;
        continue;
      }
      offset += 1;
    }

    if (plainStart < data.length && this.pending.length === 0) {
      events.push({ kind: "plain", data: data.subarray(plainStart) });
    }

    return { events };
  }

  parsePacket(packet, cursor) {
    return this._parsePacket(packet, cursor);
  }

  acknowledge(graphic) {
    if (!graphic || (graphic.kind !== "placement" && graphic.kind !== "query")) {
      return null;
    }
    const control = graphic.control || {};
    if (graphic.kind === "placement" && control.q !== "1") {
      return null;
    }
    const imageId = control.i || control.I || (graphic.image && graphic.image.id);
    if (!imageId || control.q === "2") {
      return null;
    }
    const message = graphic.responseMessage || "OK";
    return `\u001b_Gi=${imageId};${message}\u001b\\`;
  }

  _findApcEnd(buffer, start) {
    for (let i = start; i < buffer.length - 1; i += 1) {
      if (buffer[i] === 0x1b && buffer[i + 1] === 0x5c) {
        return i;
      }
    }
    return -1;
  }

  _parsePacket(packet, cursor) {
    const separator = packet.indexOf(0x3b);
    const controlText = separator === -1 ? packet.toString("ascii") : packet.subarray(0, separator).toString("ascii");
    const payloadText = separator === -1 ? "" : packet.subarray(separator + 1).toString("ascii");
    traceLog("graphics-packet", JSON.stringify({
      control: controlText,
      payloadLength: payloadText.length,
      row: cursor.row,
      col: cursor.col
    }));
    const control = {};
    for (const part of controlText.split(",")) {
      if (!part) {
        continue;
      }
      const eq = part.indexOf("=");
      if (eq === -1) {
        control[part] = true;
      } else {
        control[part.slice(0, eq)] = part.slice(eq + 1);
      }
    }

    const action = control.a || "t";
    if (action === "q") {
      const imageId = control.i || control.I || null;
      try {
        this._resolveImageData(control, payloadText);
        return {
          kind: "query",
          cursor,
          control,
          image: {
            id: imageId
          },
          responseMessage: "OK"
        };
      } catch (error) {
        traceLog("graphics-query-error", JSON.stringify({
          control,
          message: error.message
        }));
        return {
          kind: "query",
          cursor,
          control,
          image: {
            id: imageId
          },
          responseMessage: `ERROR:${this._sanitizeResponseMessage(error.message)}`
        };
      }
    }

    if (action === "d") {
      const deleteScope = control.d || "a";
      const deleteImageId = control.i || control.I || null;
      if (deleteScope === "A") {
        this.images.clear();
      } else if (deleteScope === "I" && deleteImageId) {
        this.images.delete(deleteImageId);
      }
      return {
        kind: "delete",
        delete: {
          scope: deleteScope,
          imageId: deleteImageId,
          placementId: control.p || null,
          cursor
        }
      };
    }

    if (action === "p") {
      const imageId = control.i || control.I;
      if (!imageId || !this.images.has(imageId)) {
        return null;
      }
      return {
        kind: "placement",
        cursor,
        control,
        image: this.images.get(imageId)
      };
    }

    if (action !== "T" && action !== "t") {
      traceLog("graphics-ignored-action", JSON.stringify({
        action,
        control
      }));
      return null;
    }

    const key = this._resolveTransferKey(control, action);
    if (!key) {
      traceLog("graphics-transfer-error", JSON.stringify({
        control,
        message: "missing transfer key"
      }));
      return null;
    }
    const imageId = key.slice(0, key.lastIndexOf(":"));
    const existing = this.transfers.get(key) || {
      control: { ...control },
      chunks: []
    };
    existing.control = { ...existing.control, ...control };
    existing.chunks.push(payloadText);

    if (control.m === "1") {
      this.transfers.set(key, existing);
      if (!control.i && !control.I) {
        this.implicitTransferKey = key;
      }
      return null;
    }

    this.transfers.delete(key);
    if (this.implicitTransferKey === key) {
      this.implicitTransferKey = null;
    }
    let binary;
    try {
      binary = this._resolveImageData(existing.control, existing.chunks.join(""));
    } catch (error) {
      traceLog("graphics-transfer-error", JSON.stringify({
        control: existing.control,
        message: error.message
      }));
      return null;
    }

    const image = {
      id: imageId,
      format: Number.parseInt(existing.control.f || "32", 10),
      width: Number.parseInt(existing.control.s || "0", 10),
      height: Number.parseInt(existing.control.v || "0", 10),
      mime: existing.control.U || existing.control.mime || null,
      data: binary.toString("base64")
    };

    this.images.set(imageId, image);

    return {
      kind: "placement",
      cursor,
      control: existing.control,
      image
    };
  }

  _resolveTransferKey(control, action) {
    const explicitImageId = control.i || control.I;
    if (explicitImageId) {
      return `${explicitImageId}:${control.p || "0"}`;
    }
    if (this.implicitTransferKey && (action === "T" || action === "t")) {
      return this.implicitTransferKey;
    }
    return `anon:${Date.now()}:${Math.random()}:${control.p || "0"}`;
  }

  _resolveImageData(control, payloadText) {
    const transmission = control.t || "d";
    if (transmission === "d") {
      return this._inflateIfNeeded(control, Buffer.from(payloadText, "base64"));
    }
    if (transmission === "f" || transmission === "t") {
      return this._inflateIfNeeded(control, this._readImageFile(control, payloadText, transmission === "t"));
    }
    throw new Error(`unsupported transmission ${transmission}`);
  }

  _inflateIfNeeded(control, binary) {
    if (control.o === "z") {
      return zlib.inflateSync(binary);
    }
    return binary;
  }

  _readImageFile(control, payloadText, deleteAfterRead) {
    const targetPath = Buffer.from(payloadText, "base64").toString("utf8");
    if (!targetPath) {
      throw new Error("empty file path");
    }

    let resolvedPath;
    try {
      resolvedPath = fs.realpathSync(targetPath);
    } catch (error) {
      throw new Error(`cannot resolve file path: ${error.message}`);
    }

    let stat;
    try {
      stat = fs.statSync(resolvedPath);
    } catch (error) {
      throw new Error(`cannot stat file: ${error.message}`);
    }
    if (!stat.isFile()) {
      throw new Error("path is not a regular file");
    }

    const offset = Math.max(0, Number.parseInt(control.O || "0", 10) || 0);
    const requestedSize = Math.max(0, Number.parseInt(control.S || "0", 10) || 0);
    const size = requestedSize > 0 ? requestedSize : Math.max(0, stat.size - offset);
    const fd = fs.openSync(resolvedPath, fsConstants.O_RDONLY);

    try {
      const buffer = Buffer.alloc(size);
      const bytesRead = fs.readSync(fd, buffer, 0, size, offset);
      return buffer.subarray(0, bytesRead);
    } finally {
      fs.closeSync(fd);
      if (deleteAfterRead && this._isSafeTempGraphicsPath(resolvedPath)) {
        try {
          fs.unlinkSync(resolvedPath);
        } catch (error) {
          traceLog("graphics-tempfile-unlink-failed", JSON.stringify({
            path: resolvedPath,
            message: error.message
          }));
        }
      }
    }
  }

  _isSafeTempGraphicsPath(filePath) {
    if (!filePath.includes("tty-graphics-protocol")) {
      return false;
    }
    return this.tempRoots.some((root) => filePath === root || filePath.startsWith(`${root}${path.sep}`));
  }

  _sanitizeResponseMessage(message) {
    return String(message || "ERROR")
      .replace(/[^\x20-\x7e]/g, " ")
      .trim()
      .slice(0, 200) || "ERROR";
  }
}

class Counter {
  constructor(timeoutSeconds, onTimeout) {
    this.timeoutMs = timeoutSeconds > 0 ? timeoutSeconds * 1000 : 0;
    this.onTimeout = onTimeout;
    this.connections = 0;
    this.timer = null;
    if (this.timeoutMs > 0) {
      this.arm();
    }
  }

  arm() {
    this.disarm();
    this.timer = setTimeout(() => this.onTimeout(), this.timeoutMs);
  }

  disarm() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  add() {
    this.disarm();
    this.connections += 1;
    return this.connections;
  }

  done() {
    this.connections = Math.max(0, this.connections - 1);
    if (this.connections === 0 && this.timeoutMs > 0) {
      this.arm();
    }
    return this.connections;
  }

  count() {
    return this.connections;
  }
}

class NodePtyBackend {
  constructor(options) {
    let nodePty;
    try {
      //  Split so the bundler cannot resolve it. This branch is unreachable
      //  in a compiled binary (Bun >= 1.3.14 always takes BunPtyBackend), so
      //  a static require would only bake ~54 KB of dead JS into the exe —
      //  and node-pty's own `.node` loading is dynamic anyway, so it would
      //  still need the files on disk.
      let preventSingleExe="./lib/"
      nodePty = require(preventSingleExe+"node-pty");
    } catch (error) {
      const detail = error && error.message ? `: ${error.message}` : "";
      throw new Error(
        globalThis.Bun
          ? "This build falls back to node-pty because Bun " + globalThis.Bun.version
            + " is older than 1.3.14, which is where the built-in ConPTY backend landed. "
            + "A compiled binary cannot load node-pty — it is deliberately left out of the "
            + "bundle — so rebuild with Bun 1.3.14 or newer, or run from a source checkout "
            + "with node-pty installed" + detail
          : "node-pty is required to run under Node on Windows, and it could not be loaded "
            + "from ./lib/node-pty. Run with Bun 1.3.14 or newer to use the built-in ConPTY "
            + "backend instead" + detail,
      );
    }

    const system32 = path.join(process.env.windir, 'System32');
    
    let ocmd = options.command
    
    if(ocmd=='cmd' || ocmd=="powershell")
      ocmd+=".exe";
    else if(!fs.existsSync(ocmd) &&
             fs.existsSync(ocmd+'.exe'))
      ocmd+='.exe';
    else if(!fs.existsSync(path.join(system32,ocmd)) &&
             fs.existsSync(path.join(system32,ocmd+'.exe')))
      ocmd = path.join(system32,ocmd+'.exe');

    options.command = ocmd ;

    this.options = options;
    this.closed = false;
    this.exitHandlers = [];
    this.dataHandlers = [];
    this.closeTimer = null;

    const env = {
      ...process.env,
      TERM: "xterm-256color",
      ...(options.headerEnv || {})
    };

    this.proc = nodePty.spawn(options.command, options.argv, {
      name: "xterm-256color",
      cols: options.width || 80,
      rows: options.height || 24,
      cwd: process.cwd(),
      env
    });

    forceWindowsPtyBinaryMode(this.proc);

    this.pid = this.proc.pid;
    this.proc.onData((data) => {
      const chunk = Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(data, "latin1");
      for (const handler of this.dataHandlers) {
        handler(chunk);
      }
    });
    this.proc.onExit(() => {
      this.emitExit();
    });

    this.bootstrapWindowsUtf8();
  }

  onData(handler) {
    this.dataHandlers.push(handler);
  }

  onExit(handler) {
    this.exitHandlers.push(handler);
  }

  emitExit() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const handler of this.exitHandlers) {
      handler();
    }
  }

  write(buffer) {
    this.proc.write(buffer.toString("utf8"));
  }

  writeBinary(buffer) {
    this.proc.write(buffer);
  }

  resize(columns, rows) {
    this.proc.resize(columns, rows);
  }

  kill(signal) {
    try {
      this.proc.kill(signal);
    } catch (error) {
      // ignore
    }
  }

  close() {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }

    if (process.platform === "win32") {
      this.kill();
      return;
    }

    this.kill(this.options.closeSignal);
    if (this.options.closeTimeout >= 0) {
      this.closeTimer = setTimeout(() => {
        this.kill("SIGKILL");
      }, this.options.closeTimeout * 1000);
    }
  }

  bootstrapWindowsUtf8() {
    if (process.platform !== "win32") {
      return;
    }

    const shell = detectWindowsShell(this.options.command);
    if (shell === "powershell" || shell === "pwsh") {
      setTimeout(() => {
        try {
          this.proc.write("[Console]::InputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\r");
          this.proc.write("$OutputEncoding = [System.Text.UTF8Encoding]::new($false)\r");
          this.proc.write("chcp 65001 > $null\r");
        } catch (error) {
          // ignore
        }
      }, 30);
      return;
    }

    if (shell === "cmd") {
      setTimeout(() => {
        try {
          this.proc.write("chcp 65001>nul\r");
        } catch (error) {
          // ignore
        }
      }, 30);
    }
  }
}

class BunPtyBackend {
  constructor(options) {
    if (typeof Bun === "undefined" || typeof Bun.spawn !== "function") {
      throw new Error("Bun runtime is required on Linux/macOS for PTY support");
    }

    this.options = options;
    this.closed = false;
    this.exitHandlers = [];
    this.dataHandlers = [];
    this.closeTimer = null;

    const env = {
      ...process.env,
      TERM: "xterm-256color",
      ...(options.headerEnv || {})
    };

    this.proc = Bun.spawn([options.command, ...options.argv], {
      cwd: process.cwd(),
      env,
      terminal: {
        cols: options.width || 80,
        rows: options.height || 24,
        name: "xterm-256color",
        data: (_terminal, data) => {
          const chunk = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
          for (const handler of this.dataHandlers) {
            handler(chunk);
          }
        },
        exit: () => {
          this.emitExit();
        }
      }
    });

    this.terminal = this.proc.terminal;
    this.pid = this.proc.pid;

    Promise.resolve(this.proc.exited)
      .catch(() => {})
      .finally(() => {
        this.emitExit();
      });
  }

  onData(handler) {
    this.dataHandlers.push(handler);
  }

  onExit(handler) {
    this.exitHandlers.push(handler);
  }

  emitExit() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const handler of this.exitHandlers) {
      handler();
    }
  }

  write(buffer) {
    this.terminal.write(buffer);
  }

  writeBinary(buffer) {
    this.terminal.write(buffer);
  }

  resize(columns, rows) {
    this.terminal.resize(columns, rows);
  }

  kill(signal) {
    try {
      if (typeof this.proc.kill === "function") {
        this.proc.kill(signal);
      } else {
        this.terminal.close();
      }
    } catch (error) {
      try {
        this.terminal.close();
      } catch (closeError) {
        // ignore
      }
    }
  }

  close() {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }

    this.kill(this.options.closeSignal);
    if (this.options.closeTimeout >= 0) {
      this.closeTimer = setTimeout(() => {
        this.kill("SIGKILL");
      }, this.options.closeTimeout * 1000);
    }
  }
}

function createPtyBackend(options) {
  if (process.platform === "win32") {
    if (globalThis.Bun?.semver?.satisfies?.(
        globalThis.Bun?.version, ">=1.3.14"
      )) {
      return new BunPtyBackend(options);
    }
    return new NodePtyBackend(options);
  }

  return new BunPtyBackend(options);
}

class PtySession {
  constructor(options) {
    this.options = options;
    this.clients = new Map();
    this.writerWs = null;
    this.log = options.log;
    this.permitWrite = options.permitWrite;
    this.columns = options.width || 0;
    this.rows = options.height || 0;
    this.bufferSize = 64 * 1024;
    this.closed = false;
    this.backendExited = false;
    this.backendExitPromise = new Promise((resolve) => {
      this.resolveBackendExit = resolve;
    });
    this.backendTerminationPromise = null;
    this.reconnectTimer = null;
    this.reconnectToken = options.reconnect ? generateReconnectToken() : "";
    this.backend = createPtyBackend(options);
    this.supportsWindowsBridge = process.platform === "win32";
    this.cursorTracker = new CursorStateTracker();
    this.cursorTracker.setDimensions(this.columns || 80);
    this.kittyParser = new KittyGraphicsParser();
    this.windowsBridgeParser = this.supportsWindowsBridge ? new WindowsBridgeParser("incoming") : null;
    this.outgoingWindowsBridgeParser = this.supportsWindowsBridge ? new WindowsBridgeParser("outgoing") : null;
    this.windowsUploadRequests = new Map();
    this.windowsBridgeSeen = new Set();
    this.windowsBridgeSeenOrder = [];
    this.pendingEchoBytes = Buffer.alloc(0);
    this.zmodemBinaryBypass = false;
    this.zmodemDetectTail = Buffer.alloc(0);
    this.zmodemBinaryBytesSent = 0;
    this.zmodemBinaryBytesLogged = 0;
    this.zmodemOutputQueue = [];
    this.zmodemOutputInFlight = new Map();
    this.zmodemOutputSeq = 0;
    this.zmodemOutputStreamId = 0;
    this.zmodemOutputAckedSeq = -1;
    this.zmodemOutputWindow = 8;
    this.zmodemRetransmitTimer = null;

    this.slaveVars = {
      command: options.command,
      argv: options.argv,
      pid: this.backend.pid
    };
  }

  start() {
    this.backend.onData((raw) => {
      if (this.closed) {
        return;
      }
      if (this.shouldBypassOutputParsers(raw)) {
        this.sendChunk(MSG_OUTPUT, raw);
        return;
      }
      const parsed = this.kittyParser.consume(raw);
      for (const event of parsed.events) {
        if (event.kind === "kitty") {
          const cursorAtApc = this.cursorTracker.snapshot();
          const graphic = this.kittyParser.parsePacket(event.packet, cursorAtApc);
          if (!graphic) {
            continue;
          }
          kittyPlacementLog("server-kitty-event", {
            cursorAtApc,
            kind: graphic.kind,
            control: graphic.control || null,
            delete: graphic.delete || null,
            imageId: graphic.image?.id || null,
          });
          traceLog("graphics", JSON.stringify({
            kind: graphic.kind,
            control: graphic.control || null,
            imageId: graphic.image ? graphic.image.id : null
          }));
          if (graphic.kind === "placement") {
            this.cursorTracker.applyKittyPlacement(graphic.control);
          }
          this.send(MSG_KITTY_GRAPHICS, JSON.stringify(graphic));
          const syntheticCursorMotion = this.buildKittyCursorMotion(graphic);
          if (syntheticCursorMotion) {
            this.sendChunk(MSG_OUTPUT, Buffer.from(syntheticCursorMotion, "utf8"));
          }
          const ack = this.kittyParser.acknowledge(graphic);
          if (ack) {
            traceLog("graphics-ack", JSON.stringify(graphic.control || {}), JSON.stringify(ack));
            this.backend.write(Buffer.from(ack, "utf8"));
          }
          continue;
        }

        const chunk = event.data;
        const filteredChunk = this.filterEchoedTerminalReplies(chunk);
        if (filteredChunk.length === 0) {
          continue;
        }
        if (!this.supportsWindowsBridge) {
          const cursorBefore = this.cursorTracker.snapshot();
          this.cursorTracker.consume(filteredChunk);
          const cursorAfter = this.cursorTracker.snapshot();
          const controls = cursorControls(filteredChunk);
          if (controls.length > 0) {
            kittyPlacementLog("server-plain-cursor-controls", {
              bytes: filteredChunk.length,
              cursorBefore,
              cursorAfter,
              controls,
            });
          }
          this.sendChunk(MSG_OUTPUT, filteredChunk);
          continue;
        }
        const bridged = this.windowsBridgeParser.consume(filteredChunk);
        if (bridged.plain.length > 0) {
          const cursorBefore = this.cursorTracker.snapshot();
          this.cursorTracker.consume(bridged.plain);
          const cursorAfter = this.cursorTracker.snapshot();
          const controls = cursorControls(bridged.plain);
          if (controls.length > 0) {
            kittyPlacementLog("server-plain-cursor-controls", {
              bytes: bridged.plain.length,
              cursorBefore,
              cursorAfter,
              controls,
              windowsBridge: true,
            });
          }
          this.sendChunk(MSG_OUTPUT, bridged.plain);
        }
        for (const control of bridged.controls) {
          this.handleWindowsBridgeControl(control);
        }
      }
    });

    this.backend.onExit(() => {
      this.backendExited = true;
      this.resolveBackendExit();
      this.terminate(1000, "process exited", { skipBackendClose: true });
    });

    this.attachWebSocket(
      this.options.ws,
      this.options.remoteAddr || "",
      this.options.readOnly === true
    );
  }

  shouldBypassOutputParsers(raw) {
    if (this.zmodemBinaryBypass) {
      return true;
    }

    const data = this.zmodemDetectTail.length > 0
      ? Buffer.concat([this.zmodemDetectTail, raw])
      : raw;
    this.zmodemDetectTail = data.subarray(Math.max(0, data.length - 8));

    const binaryHeaderA = Buffer.from([0x2a, 0x18, 0x41]);
    const binaryHeaderC = Buffer.from([0x2a, 0x18, 0x43]);
    const hexHeader = Buffer.from([0x2a, 0x2a, 0x18, 0x42]);
    if (
      data.indexOf(hexHeader) !== -1 ||
      data.indexOf(binaryHeaderA) !== -1 ||
      data.indexOf(binaryHeaderC) !== -1
    ) {
      this.zmodemBinaryBypass = true;
      this.resetZmodemOutputFlow();
      this.log("ZMODEM detected: bypassing server-side output parsers for this session");
      return true;
    }

    return false;
  }

  attachWebSocket(ws, remoteAddr = "", readOnly = false) {
    if (!ws || this.closed) {
      return false;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.clients.set(ws, {
      remoteAddr,
      encoding: "null",
      readOnly,
      sendQueue: Promise.resolve()
    });
    if (this.permitWrite && !readOnly && !this.writerWs) {
      this.writerWs = ws;
    }
    this.sendSessionMetadata(ws, remoteAddr);
    this.startWebSocketHandlers(ws);
    this.notifyRoles();
    return true;
  }

  canResume(token) {
    return Boolean(
      token &&
      this.options.reconnect &&
      !this.closed &&
      !this.backendExited &&
      token === this.reconnectToken
    );
  }

  sendSessionMetadata(ws, remoteAddr = "") {
    const title = renderTemplate(
      this.options.titleFormat,
      buildTitleVariables(
        this.options.command,
        this.options.argv,
        this.options.hostname,
        remoteAddr,
        this.slaveVars
      )
    );

    this.send(MSG_SET_WINDOW_TITLE, title, ws);
    this.send(MSG_SET_BUFFER_SIZE, JSON.stringify(this.bufferSize), ws);

    if (this.options.reconnect) {
      this.send(MSG_SET_RECONNECT, JSON.stringify({
        time: this.options.reconnectTime,
        token: this.reconnectToken,
        pid: this.backend.pid
      }), ws);
    }
  }

  isWriter(ws) {
    return this.writerSocket() === ws;
  }

  writerSocket() {
    return this.writerWs && this.clients.has(this.writerWs)
      ? this.writerWs
      : null;
  }

  notifyRoles() {
    for (const ws of this.clients.keys()) {
      const writable = this.isWriter(ws);
      this.send(MSG_SET_ROLE, JSON.stringify({
        role: writable ? "writer" : "viewer",
        writable
      }), ws);
    }
  }

  armReconnectTimeout() {
    if (!this.options.reconnect || this.closed || this.backendExited) {
      this.terminate();
      return;
    }

    if (this.options.reconnectTime < 0) {
      return;
    }

    const timeoutMs = this.options.reconnectTime * 1000;
    if (timeoutMs === 0) {
      this.terminate(1001, "reconnect timeout");
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.terminate(1001, "reconnect timeout");
    }, timeoutMs);
  }

  handleWindowsBridgeControl(control) {
    if (!control || typeof control !== "object") {
      return;
    }

    if (this.shouldSkipWindowsBridgeControl(control)) {
      return;
    }

    if (control.op === "image_file") {
      this.handleWindowsImageFile(control);
      return;
    }

    if (control.op === "upload_request") {
      const requestId = String(control.requestId || "");
      if (this.windowsUploadRequests.has(requestId)) {
        traceLog("windows-upload-duplicate", JSON.stringify({ requestId }));
        return;
      }
      this.windowsUploadRequests.set(requestId, {
        requestId,
        targetDir: String(control.targetDir || ""),
        files: new Map()
      });
      this.send(MSG_WINDOWS_BRIDGE, JSON.stringify(control));
      return;
    }

    if (control.op === "download_request") {
      void this.handleWindowsDownloadRequest(control);
      return;
    }

    this.send(MSG_WINDOWS_BRIDGE, JSON.stringify(control));
  }

  shouldSkipWindowsBridgeControl(control) {
    const key = this.getWindowsBridgeControlKey(control);
    if (!key) {
      return false;
    }

    if (this.windowsBridgeSeen.has(key)) {
      traceLog("windows-bridge-duplicate", JSON.stringify({
        key,
        op: String(control.op || "")
      }));
      return true;
    }

    this.windowsBridgeSeen.add(key);
    this.windowsBridgeSeenOrder.push(key);
    while (this.windowsBridgeSeenOrder.length > 2048) {
      const oldest = this.windowsBridgeSeenOrder.shift();
      if (oldest) {
        this.windowsBridgeSeen.delete(oldest);
      }
    }
    return false;
  }

  getWindowsBridgeControlKey(control) {
    const op = String(control.op || "");
    if (!op) {
      return "";
    }

    if (op === "upload_request" || op === "download_request") {
      const requestId = String(control.requestId || "");
      return requestId ? `${op}:${requestId}` : "";
    }

    if (op === "image_file") {
      const imageId = String(control.id || "");
      const targetPath = String(control.path || "");
      if (imageId) {
        return `${op}:${imageId}`;
      }
      if (targetPath) {
        return `${op}:${targetPath}`;
      }
      return "";
    }

    return "";
  }

  handleWindowsImageFile(control) {
    const targetPath = String(control.path || "");
    if (!targetPath) {
      return;
    }

    let binary;
    try {
      binary = fs.readFileSync(targetPath);
    } catch (error) {
      traceLog("windows-image-file-error", JSON.stringify({
        path: targetPath,
        message: error.message
      }));
      return;
    } finally {
      if (control.deleteAfterRead) {
        try {
          fs.unlinkSync(targetPath);
        } catch {}
      }
    }

    this.emitWindowsImageGraphic({
      id: String(control.id || Date.now()),
      cols: control.cols,
      rows: control.rows,
      width: control.width,
      height: control.height,
      mime: control.mime,
      data: binary.toString("base64")
    });
  }

  emitWindowsImageGraphic(image) {
    const imageId = String(image.id || Date.now());
    const cols = Math.max(1, Number.parseInt(String(image.cols || 0), 10) || 1);
    const rows = Math.max(1, Number.parseInt(String(image.rows || 0), 10) || 1);
    const width = Math.max(1, Number.parseInt(String(image.width || 0), 10) || 1);
    const height = Math.max(1, Number.parseInt(String(image.height || 0), 10) || 1);
    const graphic = {
      kind: "placement",
      cursor: this.cursorTracker.snapshot(),
      control: {
        i: imageId,
        c: String(cols),
        r: String(rows),
        U: image.mime || "image/png",
        q: "2"
      },
      image: {
        id: imageId,
        format: 100,
        width,
        height,
        data: String(image.data || "")
      }
    };
    this.send(MSG_KITTY_GRAPHICS, JSON.stringify(graphic));
    const syntheticCursorMotion = this.buildKittyCursorMotion(graphic);
    if (syntheticCursorMotion) {
      this.sendChunk(MSG_OUTPUT, Buffer.from(syntheticCursorMotion, "utf8"));
    }
  }

  async handleWindowsDownloadRequest(control) {
    const requestId = String(control.requestId || "");
    const files = Array.isArray(control.files) ? control.files : [];

    try {
      for (const file of files) {
        const fullPath = String(file.fullPath || "");
        const name = basenameSafe(file.name || path.basename(fullPath));
        const stats = fs.statSync(fullPath);
        if (!stats.isFile()) {
          throw new Error(`not a regular file: ${fullPath}`);
        }

        this.send(MSG_WINDOWS_BRIDGE, JSON.stringify({
          op: "download_start",
          requestId,
          name,
          size: stats.size,
          mtime: stats.mtime.toISOString()
        }));

        const fd = fs.openSync(fullPath, "r");
        const buffer = Buffer.allocUnsafe(48 * 1024);
        try {
          for (;;) {
            const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
            if (bytesRead === 0) {
              break;
            }
            this.send(MSG_WINDOWS_BRIDGE, JSON.stringify({
              op: "download_chunk",
              requestId,
              name,
              data: buffer.subarray(0, bytesRead).toString("base64")
            }));
          }
        } finally {
          fs.closeSync(fd);
        }

        this.send(MSG_WINDOWS_BRIDGE, JSON.stringify({
          op: "download_end",
          requestId,
          name
        }));
      }

      this.backend.write(Buffer.from(encodeWindowsBridgeMessage({
        op: "download_finish",
        requestId
      }), "utf8"));
    } catch (error) {
      this.backend.write(Buffer.from(encodeWindowsBridgeMessage({
        op: "download_error",
        requestId,
        message: error.message
      }), "utf8"));
    }
  }

  handleBrowserWindowsBridgeMessage(message) {
    const requestId = String(message && message.requestId || "");
    const request = this.windowsUploadRequests.get(requestId);
    if (!request) {
      return false;
    }

    try {
      if (message.op === "upload_cancel") {
        this.windowsUploadRequests.delete(requestId);
        this.backend.write(Buffer.from(encodeWindowsBridgeMessage({
          op: "upload_cancel",
          requestId
        }), "utf8"));
        return true;
      }

      if (message.op === "upload_start") {
        const name = basenameSafe(message.name);
        const outputPath = path.join(request.targetDir, name);
        const fd = fs.openSync(outputPath, "w", 0o644);
        request.files.set(name, {
          fd,
          outputPath,
          mtime: message.mtime
        });
        return true;
      }

      if (message.op === "upload_chunk") {
        const name = basenameSafe(message.name);
        const entry = request.files.get(name);
        if (!entry) {
          throw new Error(`missing upload target for ${name}`);
        }
        fs.writeSync(entry.fd, Buffer.from(String(message.data || ""), "base64"));
        return true;
      }

      if (message.op === "upload_end") {
        const name = basenameSafe(message.name);
        const entry = request.files.get(name);
        if (!entry) {
          throw new Error(`missing upload target for ${name}`);
        }
        fs.closeSync(entry.fd);
        entry.fd = undefined;
        if (entry.mtime) {
          const mtime = new Date(entry.mtime);
          if (!Number.isNaN(mtime.valueOf())) {
            fs.utimesSync(entry.outputPath, new Date(), mtime);
          }
        }
        return true;
      }

      if (message.op === "upload_finish") {
        this.windowsUploadRequests.delete(requestId);
        this.backend.write(Buffer.from(encodeWindowsBridgeMessage({
          op: "upload_finish",
          requestId
        }), "utf8"));
        return true;
      }
    } catch (error) {
      this.windowsUploadRequests.delete(requestId);
      this.backend.write(Buffer.from(encodeWindowsBridgeMessage({
        op: "upload_error",
        requestId,
        message: error.message
      }), "utf8"));
      return true;
    }

    return false;
  }

  sendChunk(type, raw) {
    if (type === MSG_OUTPUT && this.zmodemBinaryBypass) {
      this.sendZmodemOutput(raw);
      return;
    }

    if (type === MSG_OUTPUT && this.supportsWindowsBridge) {
      const bridged = this.outgoingWindowsBridgeParser.consume(raw);
      for (const control of bridged.controls) {
        this.handleWindowsBridgeControl(control);
      }
      raw = bridged.plain;
      if (raw.length === 0) {
        return;
      }
    }

    const maxChunkSize = Math.floor((this.bufferSize - 1) / 4) * 3;
    for (let offset = 0; offset < raw.length; offset += maxChunkSize) {
      const chunk = raw.subarray(offset, Math.min(offset + maxChunkSize, raw.length));
      this.send(type, chunk.toString("base64"));
    }
  }

  sendZmodemOutput(raw) {
    this.zmodemBinaryBytesSent += raw.length;
    if (this.zmodemBinaryBytesSent - this.zmodemBinaryBytesLogged >= 16 * 1024 * 1024) {
      this.zmodemBinaryBytesLogged = this.zmodemBinaryBytesSent;
      this.log(`ZMODEM text websocket output ${this.zmodemBinaryBytesSent.toLocaleString()} bytes`);
    }

    const maxChunkSize = 3 * 1024;
    for (let offset = 0; offset < raw.length; offset += maxChunkSize) {
      const chunk = raw.subarray(offset, Math.min(offset + maxChunkSize, raw.length));
      this.zmodemOutputQueue.push({
        seq: this.zmodemOutputSeq,
        payload: chunk.toString("base64")
      });
      this.zmodemOutputSeq += 1;
    }
    this.flushZmodemOutput();
  }

  resetZmodemOutputFlow() {
    this.zmodemOutputQueue = [];
    this.zmodemOutputInFlight = new Map();
    this.zmodemOutputSeq = 0;
    this.zmodemOutputStreamId += 1;
    this.zmodemOutputAckedSeq = -1;
    if (this.zmodemRetransmitTimer) {
      clearTimeout(this.zmodemRetransmitTimer);
      this.zmodemRetransmitTimer = null;
    }
  }

  flushZmodemOutput() {
    const targetWs = this.writerWs && this.writerWs.readyState === WebSocket.OPEN
      ? this.writerWs
      : this.clients.keys().next().value;
    if (!targetWs || targetWs.readyState !== WebSocket.OPEN) {
      return;
    }

    while (this.zmodemOutputInFlight.size < this.zmodemOutputWindow && this.zmodemOutputQueue.length > 0) {
      const item = this.zmodemOutputQueue.shift();
      this.zmodemOutputInFlight.set(item.seq, item);
      this.sendZmodemOutputItem(item, targetWs);
    }
    this.scheduleZmodemRetransmit();
  }

  sendZmodemOutputItem(item, targetWs) {
    this.send(MSG_ZMODEM_OUTPUT, `${this.zmodemOutputStreamId}:${item.seq}:${item.payload}`, targetWs);
  }

  scheduleZmodemRetransmit() {
    if (this.zmodemRetransmitTimer || this.zmodemOutputInFlight.size === 0) {
      return;
    }
    this.zmodemRetransmitTimer = setTimeout(() => {
      this.zmodemRetransmitTimer = null;
      if (!this.zmodemBinaryBypass || this.zmodemOutputInFlight.size === 0) {
        return;
      }
      const targetWs = this.writerWs && this.writerWs.readyState === WebSocket.OPEN
        ? this.writerWs
        : this.clients.keys().next().value;
      if (!targetWs || targetWs.readyState !== WebSocket.OPEN) {
        return;
      }
      for (const item of this.zmodemOutputInFlight.values()) {
        this.sendZmodemOutputItem(item, targetWs);
      }
      this.scheduleZmodemRetransmit();
    }, 750);
  }

  filterEchoedTerminalReplies(raw) {
    const needle = Buffer.from("^[[?1;2c", "ascii");
    const combined = this.pendingEchoBytes.length > 0 ? Buffer.concat([this.pendingEchoBytes, raw]) : raw;
    let searchIndex = 0;
    const segments = [];

    while (searchIndex < combined.length) {
      const matchIndex = combined.indexOf(needle, searchIndex);
      if (matchIndex === -1) {
        break;
      }
      if (matchIndex > searchIndex) {
        segments.push(combined.subarray(searchIndex, matchIndex));
      }
      searchIndex = matchIndex + needle.length;
    }

    const remaining = combined.subarray(searchIndex);
    let suffixLength = 0;
    const maxSuffix = Math.min(needle.length - 1, remaining.length);
    for (let len = maxSuffix; len > 0; len -= 1) {
      if (needle.subarray(0, len).equals(remaining.subarray(remaining.length - len))) {
        suffixLength = len;
        break;
      }
    }

    const flushable = suffixLength > 0 ? remaining.subarray(0, remaining.length - suffixLength) : remaining;
    if (flushable.length > 0) {
      segments.push(flushable);
    }
    this.pendingEchoBytes = suffixLength > 0 ? remaining.subarray(remaining.length - suffixLength) : Buffer.alloc(0);

    if (segments.length === 0) {
      return Buffer.alloc(0);
    }
    if (segments.length === 1) {
      return Buffer.from(segments[0]);
    }
    return Buffer.concat(segments);
  }

  buildKittyCursorMotion(graphic) {
    if (!graphic || graphic.kind !== "placement") {
      return "";
    }
    const control = graphic.control || {};
    const cursor = graphic.cursor || { col: 1 };
    if (control.C === "1") {
      return "";
    }
    const cols = Math.max(0, Number.parseInt(control.c || "0", 10) || 0);
    const rows = Math.max(0, Number.parseInt(control.r || "0", 10) || 0);
    const targetCol = Math.max(1, (Number.parseInt(cursor.col || "1", 10) || 1) + cols);

    if (rows > 0) {
      return "\r\n".repeat(rows) + `\u001b[${targetCol}G`;
    }

    if (cols > 0) {
      return `\u001b[${targetCol}G`;
    }

    return "";
  }

  startWebSocketHandlers(ws) {
    ws.on("message", (message, isBinary) => {
      if (this.closed || !this.clients.has(ws) || isBinary) {
        return;
      }
      try {
        this.handleClientMessage(ws, message.toString("utf8"));
      } catch (error) {
        this.log(`WS session error: ${error.message}`);
        try {
          ws.close(1011, error.message);
        } catch (closeError) {
          // The client socket is already gone.
        }
      }
    });

    const handleSocketGone = () => {
      if (!this.clients.has(ws) || this.closed) {
        return;
      }
      if (this.writerWs === ws) {
        this.writerWs = null;
      }
      this.clients.delete(ws);
      if (this.clients.size > 0) {
        this.notifyRoles();
        return;
      }
      if (this.options.reconnect && !this.backendExited) {
        this.armReconnectTimeout();
        return;
      }
      this.terminate();
    };

    ws.once("close", handleSocketGone);
    ws.once("error", handleSocketGone);
  }

  handleClientMessage(ws, data) {
    if (!data || data.length === 0) {
      throw new Error("unexpected zero length read from master");
    }

    const type = data[0];
    const payload = data.slice(1);
    const client = this.clients.get(ws);
    if (!client) {
      return;
    }

    switch (type) {
      case MSG_INPUT:
        if (!this.isWriter(ws) || payload.length === 0) {
          return;
        }
        if (client.encoding === "base64") {
          this.backend.write(Buffer.from(payload, "base64"));
        } else {
          this.backend.write(Buffer.from(payload, "utf8"));
        }
        break;
      case MSG_INPUT_BINARY:
        if (!this.isWriter(ws) || payload.length === 0) {
          return;
        }
        this.backend.writeBinary(Buffer.from(payload, "base64"));
        break;
      case MSG_PING:
        this.send(MSG_PONG, "", ws);
        break;
      case MSG_KITTY_DEBUG:
        if (!KITTY_TRACE) {
          break;
        }
        try {
          kittyPlacementLog("browser", JSON.parse(payload));
        } catch (error) {
          kittyPlacementLog("browser-malformed", { payload });
        }
        break;
      case MSG_WINDOWS_BRIDGE: {
        if (!this.supportsWindowsBridge || !this.isWriter(ws) || payload.length === 0) {
          return;
        }
        let message;
        try {
          message = JSON.parse(payload);
        } catch (error) {
          throw new Error("received malformed data for windows bridge");
        }
        if (this.handleBrowserWindowsBridgeMessage(message)) {
          break;
        }
        this.backend.write(Buffer.from(encodeWindowsBridgeMessage(message), "utf8"));
        break;
      }
      case MSG_SET_ENCODING:
        if (payload === "base64" || payload === "null") {
          client.encoding = payload;
        }
        break;
      case MSG_ZMODEM_MODE:
        if (!this.isWriter(ws)) {
          return;
        }
        {
          const enabled = payload === "1";
          const wasEnabled = this.zmodemBinaryBypass;
          this.zmodemBinaryBypass = enabled;
          if (this.zmodemBinaryBypass && !wasEnabled) {
            this.zmodemBinaryBytesSent = 0;
            this.zmodemBinaryBytesLogged = 0;
            this.resetZmodemOutputFlow();
          } else if (!this.zmodemBinaryBypass) {
            this.resetZmodemOutputFlow();
          }
          this.log(`ZMODEM parser bypass ${this.zmodemBinaryBypass ? "enabled" : "disabled"} by browser`);
        }
        break;
      case MSG_ZMODEM_ACK: {
        if (!this.isWriter(ws)) {
          return;
        }
        const seq = Number.parseInt(payload, 10);
        if (!Number.isFinite(seq) || seq <= this.zmodemOutputAckedSeq) {
          return;
        }
        for (const key of this.zmodemOutputInFlight.keys()) {
          if (key <= seq) {
            this.zmodemOutputInFlight.delete(key);
          }
        }
        this.zmodemOutputAckedSeq = seq;
        this.flushZmodemOutput();
        break;
      }
      case MSG_RESIZE_TERMINAL: {
        if (!this.isWriter(ws) || (this.columns !== 0 && this.rows !== 0)) {
          return;
        }
        let args;
        try {
          args = JSON.parse(payload);
        } catch (error) {
          throw new Error("received malformed data for terminal resize");
        }
        const columns = this.columns || Number.parseInt(String(args.columns), 10);
        const rows = this.rows || Number.parseInt(String(args.rows), 10);
        if (Number.isFinite(columns) && Number.isFinite(rows)) {
          this.cursorTracker.setDimensions(columns);
          this.backend.resize(columns, rows);
        }
        break;
      }
      default:
        throw new Error(`unknown message type ${type}`);
    }
  }

  send(type, payload, targetWs = null) {
    if (targetWs) {
      this.queueSend(targetWs, type + payload);
      return;
    }

    for (const ws of this.clients.keys()) {
      this.queueSend(ws, type + payload);
    }
  }

  queueSend(ws, payload, binary = false) {
    const client = this.clients.get(ws);
    if (!client || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const sendOne = async () => {
      await new Promise((resolve, reject) => {
        try {
          if (binary) {
            ws.send(payload, { binary: true }, (error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          } else {
            ws.send(payload, (error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          }
        } catch (error) {
          reject(error);
        }
      });
    };

    client.sendQueue = client.sendQueue.then(sendOne, sendOne);
    client.sendQueue.catch((error) => {
      this.log(`WebSocket send failed: ${error && error.message ? error.message : error}`);
    });
  }

  terminateBackend(gracePeriodMs = 5000) {
    if (this.backendTerminationPromise) {
      return this.backendTerminationPromise;
    }

    this.backendTerminationPromise = (async () => {
      if (this.backendExited) {
        return { forced: false };
      }

      const waitForExit = async (timeoutMs) => {
        let timer = null;
        const timedOut = new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), timeoutMs);
        });
        const exited = this.backendExitPromise.then(() => true);
        const result = await Promise.race([exited, timedOut]);
        if (timer) {
          clearTimeout(timer);
        }
        return result;
      };

      if (process.platform === "win32") {
        this.backend.kill();
        if (await waitForExit(gracePeriodMs)) {
          return { forced: true };
        }
        throw new Error("process did not exit after PTY kill");
      }

      this.backend.kill("SIGTERM");
      if (await waitForExit(gracePeriodMs)) {
        return { forced: false };
      }

      this.backend.kill("SIGKILL");
      if (await waitForExit(gracePeriodMs)) {
        return { forced: true };
      }

      throw new Error("process did not exit after SIGKILL");
    })();

    return this.backendTerminationPromise;
  }

  terminate(code, reason, { skipBackendClose = false } = {}) {
    if (this.closed) {
      return;
    }
    this.closed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.options.reconnectRegistry && this.reconnectToken) {
      this.options.reconnectRegistry.delete(this.reconnectToken);
    }

    if (!skipBackendClose && !this.backendExited) {
      this.backend.close();
    }

    const clients = [...this.clients.keys()];
    this.clients.clear();
    this.writerWs = null;
    for (const ws of clients) {
      try {
        ws.close(code || 1000, reason);
      } catch (error) {
        // ignore
      }
    }

    if (typeof this.options.onTerminate === "function") {
      this.options.onTerminate(this);
    }
  }

  close(code, reason) {
    this.terminate(code, reason);
  }
}

function createServerRuntime(command, argv, options) {
  const log = logFactory(options.quiet);
  const hostname = os.hostname();
  const basePath = normalizeBasePath(
    options.randomUrl ? `/${randomPathSegment(options.randomUrlLength)}/` : options.path
  );
  const wsPath = `${basePath}ws`;
  const originMatcher = options.wsOrigin ? new RegExp(options.wsOrigin) : null;
  const indexTemplate = options.index
    ? fs.readFileSync(expandHome(options.index), "utf8")
    : assetText("static/index.html");
  const manifestTemplate = assetText("static/manifest.json");
  const activeSessions = new Set();
  const reconnectRegistry = new Map();
  let acceptedOnce = false;
  let shuttingDown = false;

  const findSessionByIdentifier = (identifier) => {
    const value = String(identifier || "").trim();
    if (!value) {
      return null;
    }

    const byToken = reconnectRegistry.get(value);
    if (byToken && byToken.canResume(byToken.reconnectToken)) {
      return byToken;
    }

    for (const session of activeSessions) {
      if (!session || !session.backend) {
        continue;
      }
      if (String(session.backend.pid) === value) {
        return session;
      }
      if (session.reconnectToken && session.reconnectToken === value) {
        return session;
      }
    }

    return null;
  };

  const findReconnectSession = (identifier) => {
    const session = findSessionByIdentifier(identifier);
    if (session && session.canResume(session.reconnectToken)) {
      return session;
    }
    return null;
  };

  const counter = new Counter(options.timeout, () => {
    log("Timeout reached without active connections, shutting down");
    shutdown(false);
  });

  const requestHandler = (req, res) => {
    const requestPath = new URL(req.url, "http://localhost").pathname;
    if (requestPath === basePath.slice(0, -1)) {
      res.writeHead(302, {
        Location: basePath,
        "Server": "GoTTY"
      });
      res.end();
      return;
    }

    if (!requestPath.startsWith(basePath)) {
      res.writeHead(404);
      res.end("Not Found");
      return;
    }

    if (options.credential && requestPath !== wsPath) {
      if (!basicAuthAuthorized(req, options.credential)) {
        sendBasicAuthRequired(res);
        return;
      }
    }

    const relativePath = requestPath.slice(basePath.length);
    if (relativePath === "") {
      const title = renderTemplate(
        options.titleFormat,
        buildTitleVariables(command, argv, hostname, req.socket.remoteAddress || "", {})
      );
      const html = renderTemplate(indexTemplate, { title });
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Server": "GoTTY"
      });
      res.end(html);
      return;
    }

    if (relativePath === "manifest.json") {
      const title = renderTemplate(
        options.titleFormat,
        buildTitleVariables(command, argv, hostname, req.socket.remoteAddress || "", {})
      );
      const body = renderTemplate(manifestTemplate, { title });
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Server": "GoTTY"
      });
      res.end(body);
      return;
    }

    if (relativePath === "auth_token.js") {
      const body = `var gotty_auth_token = ${JSON.stringify(options.credential)};`;
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Server": "GoTTY"
      });
      res.end(body);
      return;
    }

    if (relativePath === "config.js") {
      const lines = [
        "var gotty_term = 'xterm';",
        `var gotty_ws_query_args = ${JSON.stringify(options.wsQueryArgs)};`,
        `var gotty_enable_webgl = ${options.webgl ? "true" : "false"};`,
        `var gotty_kitty_trace = ${KITTY_TRACE ? "true" : "false"};`
      ];
      res.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Server": "GoTTY"
      });
      res.end(lines.join("\n"));
      return;
    }

    if (relativePath === "help.md" || relativePath === "help") {
      const markdown = assetText("static/help.md");
      const markdownToHtml = global.Bun?.markdown?.html;
      const renderHtml = relativePath === "help" && typeof markdownToHtml === "function";
      const body = renderHtml
        ? markdownToHtml(markdown)
        : markdown;
      res.writeHead(200, {
        "Content-Type": renderHtml
          ? "text/html; charset=utf-8"
          : "text/markdown; charset=utf-8",
        "Server": "GoTTY"
      });
      res.end(body);
      return;
    }

    if (relativePath === "css.md" || relativePath === "css") {
      const sessions = [];
      for (const session of activeSessions) {
        if (!session || !session.backend) {
          continue;
        }
        const pid = session.backend.pid
          ? String(session.backend.pid)
          : "無";
        const command = session.options && session.options.command
          ? path.basename(String(session.options.command))
          : "";
        const name = command.replace(/[\r\n\s]+/g, " ").trim() || "無";
        const reconnectToken = session.reconnectToken
          ? String(session.reconnectToken).replace(/[\r\n\s]+/g, "")
          : "";
        sessions.push({ pid, name, token: reconnectToken });
      }
      sessions.sort((left, right) => Number(left.pid) - Number(right.pid));
      const scheme = options.tls ? "https" : "http";
      const requestHost = String(req.headers.host || "").trim();
      const fallbackAddress = server.address();
      const fallbackHost = fallbackAddress && typeof fallbackAddress !== "string"
        ? `${net.isIPv6(fallbackAddress.address) ? `[${fallbackAddress.address}]` : fallbackAddress.address}:${fallbackAddress.port}`
        : "127.0.0.1";
      const publicOrigin = `${scheme}://${requestHost || fallbackHost}`;

      const lines = [
        "# Current Session(s)",
        ...(options.reconnect
          ? [
              "- Click on the links directly or with Ctrl+Click to reconnect to session",
              "- Or use bun client.js -r pid"
            ]
          : [
              "- Reconnect is disabled, so only PID and command name are shown"
            ]),
        "## PID SESSION",
        ...(sessions.length > 0
          ? sessions.map((session) => {
              const name = session.name.replace(/([\\[\]])/g, "\\$1");
              if (session.token) {
                const reconnectUrl = `${publicOrigin}${basePath}?reconnect-token=${encodeURIComponent(session.token)}`;
                return `- ${session.pid} [${name}](${reconnectUrl})`;
              }
              return `- ${session.pid} ${name}`;
            })
          : ["- 無 無"])
      ];
      const markdown = `${lines.join("\n")}\n`;
      const markdownToHtml = global.Bun?.markdown?.html;
      const renderHtml = relativePath === "css" && typeof markdownToHtml === "function";
      const body = renderHtml
        ? markdownToHtml(markdown)
        : markdown;
      res.writeHead(200, {
        "Content-Type": renderHtml
          ? "text/html; charset=utf-8"
          : "text/markdown; charset=utf-8",
        "Server": "GoTTY"
      });
      res.end(body);
      return;
    }

    const assetKey = staticAssetKey(relativePath);
    if (!assetKey) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const bundledAsset = assets?.readInternalAssetBytes(assetKey);
    if (bundledAsset != null) {
      const body = bundledAsset instanceof Uint8Array ? bundledAsset : new Uint8Array(bundledAsset);
      res.writeHead(200, {
        "Content-Type": contentType(assetKey),
        "Content-Length": body.length,
        "Server": "GoTTY"
      });
      res.end(body);
      return;
    }

    const externalPath = assetFilePath(assetKey);
    fs.stat(externalPath, (error, stats) => {
      if (error || !stats.isFile()) {
        res.writeHead(404, { "Server": "GoTTY" });
        res.end("Not Found");
        return;
      }

      res.writeHead(200, {
        "Content-Type": contentType(assetKey),
        "Content-Length": stats.size,
        "Server": "GoTTY"
      });
      fs.createReadStream(externalPath).pipe(res);
    });
  };

  let server;
  if (options.tls) {
    const certPath = expandHome(options.tlsCrt);
    const keyPath = expandHome(options.tlsKey);

    try {
      server = https.createServer(
        {
          cert: fs.readFileSync(certPath),
          key: fs.readFileSync(keyPath)
        },
        requestHandler
      );
    } catch (error) {
      console.error("TLS is enabled, but the certificate or key could not be loaded.");
      console.error(`Certificate: ${certPath}`);
      console.error(`Private key: ${keyPath}`);
      console.error(`Reason: ${error.message}`);
      console.error("");
      console.error("You can generate a self-signed certificate for testing with:");
      console.error(`openssl req -x509 -newkey rsa:2048 -sha256 -days 365 -nodes -keyout ${keyPath} -out ${certPath} -subj "/CN=localhost"`);
      console.error("");
      console.error("Or use a certificate and private key issued by a trusted certificate authority.");
      process.exit(1);
    }
  } else {
    server = http.createServer(requestHandler);
  }

  const wss = new WebSocketServer({
    noServer: true,
    clientTracking: false,
    perMessageDeflate: false,
    handleProtocols(protocols) {
      return protocols.has("webtty") ? "webtty" : false;
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const requestPath = new URL(req.url, "http://localhost").pathname;
    if (requestPath !== wsPath) {
      socket.destroy();
      return;
    }

    if (shuttingDown) {
      socket.destroy();
      return;
    }

    if (!webSocketOriginAllowed(req, originMatcher)) {
      socket.destroy();
      return;
    }

    if (options.once && acceptedOnce && !options.reconnect) {
      socket.destroy();
      return;
    }

    const num = counter.add();
    if (options.maxConnection > 0 && 
        num > options.maxConnection) 
    {
      counter.done();
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws, req) => {
    log(`\nNew client connected: ${req.socket.remoteAddress}`);
    log(`  Connection count: ${counter.count()}`)

    if(options.maxConnection>0)
      log(`  Limit: ${options.maxConnection}`);

    let finalized = false;
    let session = null;

    const finish = (reason) => {
      if (finalized) {
        return;
      }
      finalized = true;
      const num = counter.done();
      log(`Connection closed by ${reason}: ${req.socket.remoteAddress}`)

      log(`  Connection count: ${num}`)

      if(options.maxConnection>0)
        log(`  Limit: ${options.maxConnection}`);
        
      if (shuttingDown && num === 0) {
        process.exit(0);
      }
    };

    ws.once("close", () => finish("client"));
    ws.once("error", (error) => finish(`an error: ${error.message}`));

    ws.once("message", async (message, isBinary) => {
      if (isBinary) {
        ws.close(1008, "invalid message type");
        return;
      }

      let init;
      try {
        init = parseInitMessage(message);
      } catch (error) {
        ws.close(1008, error.message);
        return;
      }

      if (init.AuthToken !== options.credential) {
        ws.close(1008, "failed to authenticate websocket connection");
        return;
      }

      if (init.DisconnectWriter) {
        const existing = options.reconnect
          ? findReconnectSession(init.ReconnectToken)
          : null;
        const writer = existing?.writerSocket();
        const result = existing && writer
          ? {
              ok: true,
              message: "writer disconnected",
              token: existing.reconnectToken,
              pid: existing.backend.pid
            }
          : {
              ok: false,
              message: existing
                ? "session has no active writer"
                : "reconnect session not found"
            };

        if (writer) {
          try {
            writer.close(4001, "writer disconnected by remote request");
          } catch (error) {
            result.ok = false;
            result.message = `failed to disconnect writer: ${error.message}`;
          }
        }

        ws.send(MSG_CONTROL_RESULT + JSON.stringify(result), () => {
          ws.close(result.ok ? 1000 : 1008, result.message);
        });
        return;
      }

      if (init.TerminateSession) {
        const existing = findSessionByIdentifier(init.ReconnectToken);
        const token = existing?.reconnectToken || "";
        const pid = existing?.backend?.pid || "";
        const result = existing
          ? {
              ok: true,
              message: "session terminated",
              token,
              pid
            }
          : {
              ok: false,
              message: "session not found"
            };

        if (existing) {
          try {
            const termination = await existing.terminateBackend(5000);
            if (termination.forced) {
              result.message = "session force killed";
            }
          } catch (error) {
            result.ok = false;
            result.message = `failed to terminate session: ${error.message}`;
          }
        }

        ws.send(MSG_CONTROL_RESULT + JSON.stringify(result), () => {
          ws.close(result.ok ? 1000 : 1008, result.message);
        });
        return;
      }

      if (options.reconnect && init.ReconnectToken) {
        const existing = findReconnectSession(init.ReconnectToken);
        if (existing) {
          const reconnectToken = existing.reconnectToken;
          log(`  Reconnect token: (resume)
  ${formatReconnectTokenForLog(reconnectToken)}
`);
          session = existing;
          session.attachWebSocket(
            ws,
            req.socket.remoteAddress || "",
            init.ReadOnly
          );
          return;
        }
      }

      if (options.once && acceptedOnce) {
        ws.close(1008, "server already accepted a client");
        return;
      }

      let clientArgs = [];
      if (options.permitArguments && init.Arguments) {
        const url = new URL(init.Arguments, "http://localhost");
        clientArgs = url.searchParams.getAll("arg");
      }

      const headerEnv = options.passHeaders ? createHeaderEnvironment(req.headers) : {};

      try {
        session = new PtySession({
          ws,
          log,
          command,
          argv: [...argv, ...clientArgs],
          headerEnv,
          remoteAddr: req.socket.remoteAddress || "",
          readOnly: init.ReadOnly,
          hostname,
          titleFormat: options.titleFormat,
          permitWrite: options.permitWrite,
          reconnect: options.reconnect,
          reconnectTime: options.reconnectTime,
          reconnectRegistry,
          width: options.width,
          height: options.height,
          closeSignal: options.closeSignal,
          closeTimeout: options.closeTimeout,
          onTerminate: (endedSession) => {
            activeSessions.delete(endedSession);
            if (options.once) {
              shutdown(false);
              setTimeout(()=>process.exit(0),3000)
            }
          }
        });
      } catch (error) {
        ws.close(1011, `failed to create backend: ${error.message}`);
        return;
      }
      acceptedOnce = acceptedOnce || options.once;
      activeSessions.add(session);
      if (session.reconnectToken) {
        reconnectRegistry.set(session.reconnectToken, session);
      }
      log(`  Reconnect token: 
  ${formatReconnectTokenForLog(session.reconnectToken)}
`);
      session.start();
    });
  });

  function shutdown(graceful) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    if (graceful) {
      server.close();
    } else {
      for (const session of activeSessions) {
        session.close(1001, "server shutting down");
      }
      server.close();
    }
  }

  function logUrls() {
    const scheme = options.tls ? "https" : "http";
    const accessMode = options.permitWrite ? "writable" : "read-only";
    const address = server.address();
    if (!address || typeof address === "string") {
      return;
    }
    const host = address.address === "::" ? "127.0.0.1" : address.address;
    const formattedHost = net.isIPv6(host) ? `[${host}]` : host;
    log(`HTTP server is listening at: 
    ${scheme}://${formattedHost}:${address.port}${basePath}
Access mode: ${accessMode}
`);
    const hasCustomPath = normalizeBasePath(options.path) !== "/";
    const customPathValue = normalizeBasePath(options.path)
      .replace(/^\/+|\/+$/g, "");
    if (
      hasCustomPath &&
      !options.randomUrl &&
      customPathValue.length < 16
    ) {
      log(`SECURITY NOTICE:
  The custom path is only ${customPathValue.length} characters long.
  Use at least 16 randomly generated characters to make URL guessing harder.
  A custom path is not a substitute for --credential and TLS.
`);
    }
    if (
      options.permitWrite &&
      !options.credential &&
      !options.randomUrl &&
      !hasCustomPath
    ) {
      log(`SECURITY WARNING:
  This writable terminal has no credential, random URL, or custom path.
  Anyone who can reach this server may execute arbitrary commands (ACE)
  with the same permissions as the GoTTY process.
  Enable --credential, --random-url, or at minimum use a non-default --path.
`);
    }
    if (options.address === "0.0.0.0") {
      try {
        const interfaces = os.networkInterfaces();
        for (const values of Object.values(interfaces)) {
          for (const value of values || []) {
            if (value.family === "IPv4" && !value.internal) {
              log(`Alternative URL: 
    ${scheme}://${value.address}:${address.port}${basePath}
`);
            }
          }
        }
      } catch (error) {
        log(`Alternative URL: 
    ${scheme}://127.0.0.1:${address.port}${basePath}
`);
        log(`Alternative URL: 
    ${scheme}://localhost:${address.port}${basePath}
`);
      }
    }
  }

  function start() {
    server.listen(Number.parseInt(options.port, 10), options.address, logUrls);
  }

  process.on("SIGTERM", () => {
    shutdown(false);
  });

  let gracefulInterrupt = false;
  process.on("SIGINT", () => {
    if (!gracefulInterrupt) {
      gracefulInterrupt = true;
      console.log("")
      console.log("Press Ctrl+C again to force close❌");
      console.log("再按一次Ctrl+C強制停止❌")
      shutdown(true);
      return;
    }
    console.log("")
    console.log("Force closing...");
    console.log("強制停止...");
    
    shutdown(false);
    process.exit(130);
  });

  server.on("close", () => {
    if (counter.count() === 0) {
      process.exit(0);
    }
  });

  return { start };
}

function main() {
  const { options, command, argv } = parseArgs(process.argv.slice(2));
  const runtime = createServerRuntime(command, argv, options);
  runtime.start();
}

async function bootstrap() {
  try {
    const compiledHelper = await compiledHelperPromise;
    await compiledHelper?.buildEarlyExit?.(process.argv,'jsgt');

    assets = await assetsHelperPromise;
    await globalThis.assetsLoaderPromise;
  } catch (error) {
    console.error(String(error && error.stack ? error.stack : error));
  }

  if (!cliBootstrapPromise) {
    main();
  }
}

module.exports.CursorStateTracker = CursorStateTracker;
module.exports.KittyGraphicsParser = KittyGraphicsParser;
module.exports.webSocketOriginAllowed = webSocketOriginAllowed;

if (require.main === module) {
  if (KITTY_TRACE) {
    try {
      fs.writeFileSync(KITTY_PLACEMENT_LOG, "");
    } catch {}
  }
  bootstrap().catch((error) => {
    console.error(String(error && error.stack ? error.stack : error));
    process.exitCode = 1;
  });
}

//  The guard above is inlined to false once this file is bundled, because
//  the bundle entry point is single-exe/entry.mjs rather than this file.
//  Export the starter so that entry point can call it.
module.exports.bootstrap = bootstrap;
