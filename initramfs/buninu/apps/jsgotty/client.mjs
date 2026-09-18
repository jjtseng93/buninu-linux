#!/usr/bin/env bun

import process from "node:process";
import { Buffer } from "node:buffer";
import WebSocket from "ws";

const MSG_INPUT = "1";
const MSG_PING = "2";
const MSG_RESIZE_TERMINAL = "3";
const MSG_SET_ENCODING = "4";

const MSG_OUTPUT = "1";
const MSG_PONG = "2";
const MSG_SET_WINDOW_TITLE = "3";
const MSG_SET_PREFERENCES = "4";
const MSG_SET_RECONNECT = "5";
const MSG_SET_BUFFER_SIZE = "6";
const MSG_SET_ROLE = "a";
const MSG_CONTROL_RESULT = "b";

const DEFAULT_URL = "ws://127.0.0.1:8080/ws";

function usage() {
  console.log(`Usage:
  bun client.mjs [options] [target]

Target:
  Defaults to ${DEFAULT_URL}
  A pure number connects to 127.0.0.1 on that port, for example 8080.
  Accepts http(s) page URLs or ws(s) WebSocket URLs.

Options:
  -ls                                
    List reconnectable sessions and exit
  -r, --reconnect-token <token|pid> 
    Resume a session by token or PID
  -d, --detach <token|pid>
    Disconnect the active writer for a session and exit
  -k, --kill <token|pid>
    Terminate the session PTY for a token or PID
  
  -c, --credential <user:pass>       
    GoTTY credential/AuthToken
  --readonly                     
    Never request terminal write access
  --arg <value>                  
    Add ?arg=<value> to the init Arguments
  --arguments <query>            
    Raw init Arguments, for example "?arg=bash"
  --cols <number>               
    Initial terminal columns
  --rows <number>                
    Initial terminal rows
  -h, --help                        
    Show help

Subcommand aliases:
  ls, list, list-sessions        => -ls
  attach, a <token|pid>          => -r <token|pid>
  detach <token|pid>             => -d <token|pid>
  kill-session, stop <token|pid> => -k <token|pid>

Environment:
  GOTTY_CREDENTIAL
  GOTTY_RECONNECT_TOKEN`);
}

function parseArgs(argv) {
  const options = {
    url: "",
    credential: process.env.GOTTY_CREDENTIAL || "",
    reconnectToken: process.env.GOTTY_RECONNECT_TOKEN || "",
    arguments: "",
    args: [],
    cols: 0,
    rows: 0,
    readonly: false,
    listSessions: false,
    disconnectWriterTarget: "",
    killSessionTarget: ""
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) {
        throw new Error(`${arg} requires a value`);
      }
      return argv[i];
    };

    switch (arg) {
      case "-h":
      case "--help":
        usage();
        process.exit(0);
        break;
      case "-c":
      case "--credential":
        options.credential = next();
        break;
      case "-r":
      case "--reconnect-token":
        options.reconnectToken = next();
        break;
      case "-d":
      case "--detach":
        options.disconnectWriterTarget = next();
        break;
      case "-k":
      case "--kill":
        options.killSessionTarget = next();
        break;
      case "-ls":
        options.listSessions = true;
        break;
      case "--readonly":
        options.readonly = true;
        break;
      case "--arg":
        options.args.push(next());
        break;
      case "--arguments":
        options.arguments = next();
        break;
      case "--cols":
        options.cols = Number.parseInt(next(), 10) || 0;
        break;
      case "--rows":
        options.rows = Number.parseInt(next(), 10) || 0;
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`unknown option: ${arg}`);
        }
        if (options.url) {
          throw new Error(`unexpected extra URL/argument: ${arg}`);
        }
        options.url = arg;
        break;
    }
  }

  return options;
}

function normalizeUrl(input) {
  const raw = input || DEFAULT_URL;
  const target = /^\d+$/.test(raw) ? `127.0.0.1:${raw}` : raw;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? target : `ws://${target}`;
  const url = new URL(withScheme);
  const reconnectToken = url.searchParams.get("reconnect-token")?.trim() || "";
  url.searchParams.delete("reconnect-token");
  if (!url.port) {
    url.port = "8080";
  }
  let initArguments = "";

  const appendWsPath = () => {
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "/ws";
    } else if (url.pathname.endsWith("/")) {
      url.pathname = `${url.pathname}ws`;
    } else if (!url.pathname.endsWith("/ws")) {
      url.pathname = `${url.pathname}/ws`;
    }
  };

  if (url.protocol === "http:" || url.protocol === "https:") {
    initArguments = url.search || "";
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.search = "";
    appendWsPath();
  } else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`unsupported URL protocol: ${url.protocol}`);
  }

  appendWsPath();

  return {
    wsUrl: url.toString(),
    initArguments,
    reconnectToken
  };
}

function buildArguments(options, urlArguments) {
  if (options.arguments) {
    return options.arguments.startsWith("?") ? options.arguments : `?${options.arguments}`;
  }
  if (options.args.length > 0) {
    const params = new URLSearchParams();
    for (const arg of options.args) {
      params.append("arg", arg);
    }
    return `?${params.toString()}`;
  }
  return urlArguments;
}

function terminalSize(options) {
  return {
    columns: options.cols || process.stdout.columns || 80,
    rows: options.rows || process.stdout.rows || 24
  };
}

function sendResize(ws, options) {
  const size = terminalSize(options);
  ws.send(MSG_RESIZE_TERMINAL + JSON.stringify(size));
}

function setRawMode(enabled) {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(enabled);
  }
}

function writeStatus(message) {
  const colorEnabled = process.stderr.isTTY && !("NO_COLOR" in process.env);
  const label = colorEnabled ? "\u001b[1;36m[gotty]\u001b[0m" : "[gotty]";
  process.stderr.write(`${message.replaceAll("[gotty]", label)}\n`);
}

function sessionListUrl(wsUrl) {
  const url = new URL(wsUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  url.pathname = url.pathname.endsWith("/ws")
    ? `${url.pathname.slice(0, -2)}css.md`
    : `${url.pathname.replace(/\/?$/, "/")}css.md`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function listSessions(options, wsUrl) {
  const url = sessionListUrl(wsUrl);
  const headers = {};
  if (options.credential) {
    headers.Authorization = `Basic ${Buffer.from(options.credential).toString("base64")}`;
  }

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/markdown")) {
      throw new Error(`unexpected Content-Type: ${contentType || "(missing)"}`);
    }
    const markdown = await response.text();
    const markdownToAnsi = globalThis.Bun?.markdown?.ansi;
    const output = typeof markdownToAnsi === "function"
      ? markdownToAnsi(markdown)
      : markdown;
    process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
  } catch (error) {
    writeStatus(`[gotty] 無法列出 sessions：舊版或 Golang GoTTY 伺服器不支援此功能
Can't list sessions: older or Golang GoTTY servers do not support this feature`);
    process.exitCode = 1;
  }
}

async function sendSessionControl(options, wsUrl, {
  target,
  request,
  successMessage,
  errorPrefix,
  timeoutMessage,
  unsupportedMessage,
  timeoutMs = 5000,
}) {
  await new Promise((resolve) => {
    const ws = new WebSocket(wsUrl, "webtty");
    let completed = false;
    const finish = (exitCode) => {
      if (completed) {
        return;
      }
      completed = true;
      clearTimeout(timer);
      process.exitCode = exitCode;
      resolve();
    };
    const timer = setTimeout(() => {
      writeStatus(timeoutMessage);
      finish(1);
      try {
        ws.close();
      } catch {}
    }, timeoutMs);

    ws.on("open", () => {
      ws.send(JSON.stringify({
        Arguments: "",
        AuthToken: options.credential,
        ReconnectToken: target,
        ReadOnly: true,
        ...request
      }));
    });

    ws.on("message", (data) => {
      const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
      if (!text || text[0] !== MSG_CONTROL_RESULT) {
        return;
      }
      try {
        const result = JSON.parse(text.slice(1));
        if (result.ok) {
          writeStatus(successMessage(result));
          finish(0);
        } else {
          writeStatus(`${errorPrefix}\n  ${result.message}`);
          finish(1);
        }
      } catch (error) {
        writeStatus(`[gotty] invalid session control response:\n  ${error.message}`);
        finish(1);
      }
      ws.close();
    });

    ws.on("error", (error) => {
      writeStatus(`${errorPrefix}\n  ${error.message}`);
      finish(1);
    });

    ws.on("close", (code, reason) => {
      if (!completed) {
        const detail = reason?.length ? `: ${reason.toString()}` : "";
        writeStatus(`${unsupportedMessage} (${code})${detail}`);
        finish(1);
      }
    });
  });
}

async function disconnectWriter(options, wsUrl) {
  const target = options.disconnectWriterTarget.trim();
  return sendSessionControl(options, wsUrl, {
    target,
    request: { DisconnectWriter: true },
    successMessage: (result) => `[gotty] ${result.message}
reconnect token:
  ${result.token}
pid:
  ${result.pid}`,
    errorPrefix: "[gotty] failed to disconnect writer:",
    timeoutMessage: "[gotty] writer disconnect request timed out",
    unsupportedMessage: "[gotty] server does not support writer disconnect"
  });
}

async function killSession(options, wsUrl) {
  const target = options.killSessionTarget.trim();
  return sendSessionControl(options, wsUrl, {
    target,
    request: { TerminateSession: true },
    successMessage: (result) => `[gotty] ${result.message}
pid:
  ${result.pid}
token:
  ${result.token || "(none)"}`,
    errorPrefix: "[gotty] failed to terminate session:",
    timeoutMessage: "[gotty] session terminate request timed out",
    unsupportedMessage: "[gotty] server does not support session terminate",
    timeoutMs: 7000
  });
}

async function main() {
  const cliArgs = process.argv.slice(2);
  if (cliArgs[0] === "attach" ||
      cliArgs[0] === "a") {
    cliArgs[0] = "-r";
  } else if (cliArgs[0] === "detach") {
    cliArgs[0] = "-d";
  } else if (cliArgs[0] === "kill-session" ||
      cliArgs[0] === "stop") {
    cliArgs[0] = "-k";
  } else if (["ls", "list", "list-sessions"].includes(cliArgs[0])) {
    cliArgs[0] = "-ls";
  }
  const options = parseArgs(cliArgs);
  options.reconnectToken = options.reconnectToken.trim();
  const {
    wsUrl,
    initArguments,
    reconnectToken: urlReconnectToken
  } = normalizeUrl(options.url);
  if (!options.reconnectToken && urlReconnectToken) {
    options.reconnectToken = urlReconnectToken;
  }
  if (options.listSessions) {
    await listSessions(options, wsUrl);
    return;
  }
  if (options.disconnectWriterTarget) {
    await disconnectWriter(options, wsUrl);
    return;
  }
  if (options.killSessionTarget) {
    await killSession(options, wsUrl);
    return;
  }
  const args = buildArguments(options, initArguments);
  writeStatus(`[gotty] connecting to\n  ${wsUrl}`);
  const ws = new WebSocket(wsUrl, "webtty");
  let pingTimer = null;
  let closed = false;
  let disconnectedReported = false;
  let rawEnabled = false;
  let writable = false;
  let accessRole = "";
  let fallbackInputActive = false;
  let fallbackProbe = "";
  let fallbackOutputTail = "";
  let viewerInputActive = false;
  let sessionPid = "(unknown)";

  const normalizeEcho = (value) => String(value)
    .replaceAll("\r", "")
    .replace(/\n+$/g, "");

  const handleInput = (chunk) => {
    if (!writable || ws.readyState !== WebSocket.OPEN) {
      return;
    }
    ws.send(MSG_INPUT + Buffer.from(chunk).toString("base64"));
  };

  const handleResize = () => {
    if (writable && ws.readyState === WebSocket.OPEN) {
      sendResize(ws, options);
    }
  };

  const exitClient = (code = 0) => {
    cleanup();
    reportDisconnected();
    ws.close();
    process.exit(code);
  };

  const handleViewerInput = (chunk) => {
    for (const byte of Buffer.from(chunk)) {
      if (byte === 0x03) {
        exitClient(130);
      }
      if (byte === 0x04 || byte === 0x11) {
        exitClient(0);
      }
    }
  };

  const stopViewerInput = () => {
    if (!viewerInputActive) {
      return;
    }
    viewerInputActive = false;
    process.stdin.removeListener("data", handleViewerInput);
  };

  const startViewerInput = () => {
    if (viewerInputActive) {
      return;
    }
    stopFallbackInput();
    process.stdin.removeListener("data", handleInput);
    process.stdout.removeListener("resize", handleResize);
    viewerInputActive = true;
    process.stdin.on("data", handleViewerInput);
    process.stdin.resume();
    setRawMode(true);
    rawEnabled = process.stdin.isTTY;
  };

  const stopFallbackInput = () => {
    if (!fallbackInputActive) {
      return;
    }
    fallbackInputActive = false;
    process.stdin.removeListener("data", handleFallbackInput);
  };

  const handleFallbackInput = (chunk) => {
    if (
      options.readonly ||
      accessRole === "viewer" ||
      ws.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    const input = Buffer.from(chunk);
    fallbackProbe = normalizeEcho(input.toString("utf8"));
    ws.send(MSG_INPUT + input.toString("base64"));
    stopFallbackInput();
  };

  const startFallbackInput = () => {
    if (options.readonly || writable || accessRole === "viewer" || fallbackInputActive) {
      return;
    }
    fallbackInputActive = true;
    process.stdin.on("data", handleFallbackInput);
    process.stdin.resume();
  };

  const setWritable = (enabled) => {
    const nextWritable = enabled && !options.readonly;
    stopFallbackInput();
    stopViewerInput();
    fallbackProbe = "";
    fallbackOutputTail = "";

    if (writable === nextWritable) {
      return;
    }
    writable = nextWritable;

    if (writable) {
      process.stdin.on("data", handleInput);
      process.stdout.on("resize", handleResize);
      process.stdin.resume();
      setRawMode(true);
      rawEnabled = process.stdin.isTTY;
      sendResize(ws, options);
      return;
    }

    process.stdin.removeListener("data", handleInput);
    process.stdout.removeListener("resize", handleResize);
  };

  const reportDisconnected = () => {
    if (disconnectedReported) {
      return;
    }
    disconnectedReported = true;
    writeStatus(`
[gotty] disconnected from
  ${wsUrl}
reconnect token:
  ${options.reconnectToken || "(unknown)"}
pid:
  ${sessionPid}`);
  };

  const cleanup = () => {
    if (closed) {
      return;
    }
    closed = true;
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    setWritable(false);
    stopFallbackInput();
    stopViewerInput();
    if (rawEnabled) {
      setRawMode(false);
      rawEnabled = false;
    }
    process.stdin.pause();
  };

  ws.on("open", () => {
    ws.send(JSON.stringify({
      Arguments: args,
      AuthToken: options.credential,
      ReconnectToken: options.reconnectToken,
      ReadOnly: options.readonly
    }));
    ws.send(MSG_SET_ENCODING + "base64");
    if (options.readonly) {
      startViewerInput();
    } else {
      startFallbackInput();
    }

    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(MSG_PING);
      }
    }, 30000);
  });

  ws.on("message", (data) => {
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    if (!text) {
      return;
    }

    const type = text[0];
    const payload = text.slice(1);

    switch (type) {
      case MSG_OUTPUT:
        {
          const output = Buffer.from(payload, "base64");
          process.stdout.write(output);
          if (fallbackProbe && accessRole === "") {
            fallbackOutputTail = normalizeEcho(
              `${fallbackOutputTail}${output.toString("utf8")}`
            ).slice(-8192);
          }
          if (fallbackProbe && accessRole === "" && fallbackOutputTail.includes(fallbackProbe)) {
            setWritable(true);
            accessRole = "writer";
            writeStatus("[gotty] access:\n  writer (read/write, inferred)");
          }
        }
        break;
      case MSG_PONG:
      case MSG_SET_PREFERENCES:
      case MSG_SET_BUFFER_SIZE:
        break;
      case MSG_SET_WINDOW_TITLE:
        if (process.stdout.isTTY && payload) {
          process.stdout.write(`\u001b]0;${payload}\u0007`);
        }
        break;
      case MSG_SET_RECONNECT: {
        try {
          const reconnect = JSON.parse(payload);
          if (reconnect && typeof reconnect === "object" && typeof reconnect.token === "string") {
            options.reconnectToken = reconnect.token;
            const pid = Number.isInteger(reconnect.pid) || typeof reconnect.pid === "string"
              ? String(reconnect.pid)
              : "(unknown)";
            sessionPid = pid;
            writeStatus(`
[gotty] session:
reconnect token:
  ${reconnect.token}
pid:
  ${pid}`);
          }
        } catch {}
        break;
      }
      case MSG_SET_ROLE: {
        try {
          const status = JSON.parse(payload);
          const canWrite = status?.role === "writer" && status?.writable === true;
          const nextRole = canWrite ? "writer" : "viewer";
          const previousRole = accessRole;
          accessRole = nextRole;
          setWritable(canWrite);
          if (!canWrite) {
            startViewerInput();
          }
          if (previousRole !== nextRole) {
            writeStatus(`[gotty] access:\n  ${canWrite ? "writer (read/write)" : "viewer (read-only)"}`);
            if (!canWrite) {
              writeStatus("[gotty] Exit by Ctrl+C/D/Q");
            }
          }
        } catch {}
        break;
      }
      default:
        break;
    }
  });

  ws.on("close", (code, reason) => {
    cleanup();
    reportDisconnected();
    if (code !== 1000 && code !== 1005) {
      const suffix = reason?.length ? `: ${reason.toString()}` : "";
      writeStatus(`[gotty] websocket closed (${code})${suffix}`);
      process.exitCode = 1;
    }
  });

  ws.on("error", (error) => {
    cleanup();
    writeStatus(`[gotty] websocket error: ${error.message}`);
    process.exitCode = 1;
  });

  process.on("SIGINT", () => {
    exitClient(130);
  });

  process.on("SIGTERM", () => {
    exitClient(143);
  });
}

main().catch((error) => {
  console.error(`client.mjs: ${error.message}`);
  process.exitCode = 1;
});
