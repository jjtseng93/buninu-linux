//  Fallback `curl`, implemented on Bun's own fetch(). It exists so scripts
//  written against the system curl keep working on a device that only ships
//  bunmsh: the tmpk installer scripts (`curl -kLO`, `curl -C - -kLO`,
//  `curl -fsSL`, `curl -#k`, `curl -kfsS`) are the baseline, and enough of
//  the request-shaping options are here to drive a JSON API such as
//  OpenAI's from the shell.
//
//  Where curl and fetch cannot agree the difference is documented in
//  help/curl.md rather than papered over: fetch does not expose the wire
//  header casing or the negotiated HTTP version, so `-i`/`-v` reconstruct
//  them, and the progress meter is a look-alike, not a byte-for-byte copy.
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename as pathBasename, dirname as pathDirname, isAbsolute, resolve as resolvePath } from "node:path";

export const CURL_VERSION = "8.14.1";

const DEFAULT_USER_AGENT = `curl/${CURL_VERSION}`;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

//  Short flags spell the same options as their long names, so the parser
//  only has to know one table. `-#` is a flag like any other here.
const SHORT_TO_LONG = {
  "#": "progress-bar",
  "4": "ipv4",
  "6": "ipv6",
  A: "user-agent",
  a: "append",
  b: "cookie",
  C: "continue-at",
  c: "cookie-jar",
  D: "dump-header",
  d: "data",
  E: "cert",
  e: "referer",
  F: "form",
  f: "fail",
  G: "get",
  g: "globoff",
  H: "header",
  h: "help",
  I: "head",
  i: "include",
  J: "remote-header-name",
  j: "junk-session-cookies",
  k: "insecure",
  L: "location",
  l: "list-only",
  m: "max-time",
  N: "no-buffer",
  n: "netrc",
  O: "remote-name",
  o: "output",
  q: "disable",
  R: "remote-time",
  r: "range",
  S: "show-error",
  s: "silent",
  T: "upload-file",
  u: "user",
  V: "version",
  v: "verbose",
  w: "write-out",
  X: "request",
  x: "proxy",
  Z: "parallel",
  z: "time-cond",
};

const VALUE_OPTIONS = new Set([
  "aws-sigv4", "cacert", "capath", "cert", "connect-timeout", "connect-to",
  "continue-at", "cookie", "cookie-jar", "data", "data-ascii", "data-binary",
  "data-raw", "data-urlencode", "dns-servers", "dump-header",
  "expect100-timeout", "form", "form-string", "header", "interface", "json",
  "key", "limit-rate", "local-port", "max-filesize", "max-redirs", "max-time",
  "noproxy", "oauth2-bearer", "output", "output-dir", "proto-default", "proxy",
  "proxy-header", "proxy-user", "range", "referer", "request", "resolve",
  "retry", "retry-delay", "retry-max-time", "time-cond", "unix-socket",
  "upload-file", "url", "user", "user-agent", "write-out",
]);

const BOOLEAN_OPTIONS = new Set([
  "anyauth", "append", "basic", "compressed", "create-dirs", "digest",
  "disable", "fail", "fail-early", "fail-with-body", "get", "globoff", "head",
  "help", "http0.9", "http1.0", "http1.1", "http2", "http2-prior-knowledge",
  "http3", "include", "insecure", "ipv4", "ipv6", "junk-session-cookies",
  "keepalive", "list-only", "location", "location-trusted", "netrc",
  "no-alpn", "no-buffer", "no-keepalive", "no-npn", "no-progress-meter",
  "no-styled-output", "parallel", "path-as-is", "progress-bar",
  "progress-meter", "raw", "remote-header-name", "remote-name",
  "remote-name-all", "remote-time", "retry-all-errors",
  "retry-connrefused", "show-error", "silent", "ssl", "ssl-no-revoke",
  "ssl-reqd", "sslv2", "sslv3", "styled-output", "tcp-nodelay", "tlsv1",
  "tlsv1.0", "tlsv1.1", "tlsv1.2", "tlsv1.3", "verbose", "version",
]);

//  Recognised, parsed, and then deliberately dropped: they configure parts
//  of libcurl that fetch() either does for us or does not expose. Accepting
//  them keeps a script from dying on an option that would not have changed
//  the bytes we fetch anyway.
const IGNORED_OPTIONS = new Set([
  "anyauth", "aws-sigv4", "basic", "cacert", "capath", "cert", "connect-to",
  "digest", "disable", "dns-servers", "expect100-timeout", "fail-early",
  "globoff", "http0.9", "http1.0", "http1.1", "http2",
  "http2-prior-knowledge", "http3", "interface", "ipv4", "ipv6",
  "junk-session-cookies", "keepalive", "key", "limit-rate", "list-only",
  "local-port", "max-filesize", "netrc", "no-alpn", "no-buffer",
  "no-keepalive", "no-npn", "no-styled-output", "noproxy", "parallel",
  "path-as-is", "proxy-header", "proxy-user", "raw", "remote-time",
  "resolve", "ssl", "ssl-no-revoke", "ssl-reqd", "sslv2", "sslv3",
  "styled-output", "tcp-nodelay", "time-cond", "tlsv1", "tlsv1.0",
  "tlsv1.1", "tlsv1.2", "tlsv1.3", "unix-socket",
]);

//  fetch() hands back lower-cased header names; servers and curl show them
//  in the conventional casing. Rebuild that so `-i` output reads like curl's.
const HEADER_CASE = {
  "content-md5": "Content-MD5",
  dnt: "DNT",
  etag: "ETag",
  "last-event-id": "Last-Event-ID",
  te: "TE",
  "www-authenticate": "WWW-Authenticate",
  "x-xss-protection": "X-XSS-Protection",
};

export function canonicalHeaderName(name) {
  const lower = name.toLowerCase();
  if (HEADER_CASE[lower]) return HEADER_CASE[lower];
  return lower.split("-")
    .map((part) => /^(id|ip|md5|ssl|tls|uri|url|xss)$/.test(part)
      ? part.toUpperCase()
      : part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");
}

function bytes(value) {
  return value instanceof Uint8Array ? value : encoder.encode(String(value));
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  return merged;
}

function resolveAgainst(cwd, value) {
  return isAbsolute(value) ? value : resolvePath(cwd, value);
}

class CurlError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

//  ---------------------------------------------------------------- parsing

function emptyOptions() {
  return {
    urls: [],
    //  -o and -O queue up in argument order and pair with the URLs in the
    //  same order, the way curl matches them.
    outputs: [],
    headers: [],
    data: [],
    forms: [],
    method: null,
    silent: false,
    showError: false,
    verbose: false,
    fail: false,
    failWithBody: false,
    include: false,
    head: false,
    location: false,
    locationTrusted: false,
    maxRedirects: 50,
    insecure: false,
    compressed: false,
    progressBar: false,
    progressMeter: null,
    append: false,
    createDirs: false,
    remoteNameAll: false,
    remoteHeaderName: false,
    get: false,
    outputDir: null,
    continueAt: null,
    uploadFile: null,
    user: null,
    bearer: null,
    userAgent: null,
    referer: null,
    cookie: null,
    range: null,
    maxTime: null,
    connectTimeout: null,
    retry: 0,
    retryDelay: null,
    retryMaxTime: null,
    retryAllErrors: false,
    retryConnrefused: false,
    protoDefault: null,
    writeOut: null,
    dumpHeader: null,
    proxy: null,
    help: false,
    version: false,
  };
}

export function parseCurlArguments(argv) {
  const options = emptyOptions();
  const args = argv.slice(1);
  let operandsOnly = false;

  const takeValue = (name, inline, index) => {
    if (inline !== null) return { value: inline, index };
    if (index + 1 >= args.length)
      return { error: `curl: option ${name}: requires parameter` };
    return { value: args[index + 1], index: index + 1 };
  };

  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (operandsOnly || argument === "-" || !argument.startsWith("-")) {
      options.urls.push(argument);
      continue;
    }
    if (argument === "--") { operandsOnly = true; continue; }

    //  Long option, optionally --name=value.
    if (argument.startsWith("--")) {
      const separator = argument.indexOf("=");
      let name = separator < 0 ? argument.slice(2) : argument.slice(2, separator);
      const inline = separator < 0 ? null : argument.slice(separator + 1);
      let negated = false;
      if (!BOOLEAN_OPTIONS.has(name) && !VALUE_OPTIONS.has(name) && name.startsWith("no-") &&
          BOOLEAN_OPTIONS.has(name.slice(3))) {
        negated = true;
        name = name.slice(3);
      }
      if (VALUE_OPTIONS.has(name)) {
        const taken = takeValue(`--${name}`, inline, i);
        if (taken.error) return { error: taken.error };
        i = taken.index;
        const error = applyOption(options, name, taken.value);
        if (error) return { error };
        continue;
      }
      if (BOOLEAN_OPTIONS.has(name)) {
        const error = applyOption(options, name, negated ? false : true);
        if (error) return { error };
        continue;
      }
      return { error: `curl: option ${argument.split("=")[0]}: is unknown` };
    }

    //  Short cluster: every flag but the last must be value-less, and the
    //  tail of the cluster doubles as the last flag's value (-ofile).
    for (let j = 1; j < argument.length; j++) {
      const flag = argument[j];
      const name = SHORT_TO_LONG[flag];
      if (!name) return { error: `curl: option -${flag}: is unknown` };
      if (VALUE_OPTIONS.has(name)) {
        const inline = j + 1 < argument.length ? argument.slice(j + 1) : null;
        const taken = takeValue(`-${flag}`, inline, i);
        if (taken.error) return { error: taken.error };
        i = taken.index;
        const error = applyOption(options, name, taken.value);
        if (error) return { error };
        break;
      }
      const error = applyOption(options, name, true);
      if (error) return { error };
    }
  }
  return { options };
}

function applyOption(options, name, value) {
  if (IGNORED_OPTIONS.has(name)) return null;
  switch (name) {
    case "url": options.urls.push(value); return null;
    case "output": options.outputs.push({ kind: "file", path: value }); return null;
    case "remote-name": options.outputs.push({ kind: "remote" }); return null;
    case "remote-name-all": options.remoteNameAll = value; return null;
    case "remote-header-name": options.remoteHeaderName = value; return null;
    case "output-dir": options.outputDir = value; return null;
    case "create-dirs": options.createDirs = value; return null;
    case "append": options.append = value; return null;
    case "request": options.method = value; return null;
    case "head": options.head = value; return null;
    case "include": options.include = value; return null;
    case "header": options.headers.push(value); return null;
    case "user-agent": options.userAgent = value; return null;
    case "referer": options.referer = value; return null;
    case "cookie": options.cookie = value; return null;
    case "user": options.user = value; return null;
    case "oauth2-bearer": options.bearer = value; return null;
    case "range": options.range = value; return null;
    case "data": options.data.push({ kind: "data", value }); return null;
    case "data-ascii": options.data.push({ kind: "data", value }); return null;
    case "data-raw": options.data.push({ kind: "raw", value }); return null;
    case "data-binary": options.data.push({ kind: "binary", value }); return null;
    case "data-urlencode": options.data.push({ kind: "urlencode", value }); return null;
    case "json": options.data.push({ kind: "json", value }); return null;
    case "form": options.forms.push({ value, literal: false }); return null;
    case "form-string": options.forms.push({ value, literal: true }); return null;
    case "get": options.get = value; return null;
    case "upload-file": options.uploadFile = value; return null;
    case "location": options.location = value; return null;
    case "location-trusted":
      options.location = value;
      options.locationTrusted = value;
      return null;
    case "max-redirs": {
      const limit = Number(value);
      if (!Number.isFinite(limit)) return `curl: option --max-redirs: expected a number`;
      options.maxRedirects = limit < 0 ? Infinity : limit;
      return null;
    }
    case "insecure": options.insecure = value; return null;
    case "compressed": options.compressed = value; return null;
    case "silent": options.silent = value; return null;
    case "show-error": options.showError = value; return null;
    case "verbose": options.verbose = value; return null;
    case "fail": options.fail = value; return null;
    case "fail-with-body":
      options.fail = value;
      options.failWithBody = value;
      return null;
    case "progress-bar": options.progressBar = value; return null;
    case "no-progress-meter": options.progressMeter = !value; return null;
    case "progress-meter": options.progressMeter = value; return null;
    case "continue-at": options.continueAt = value; return null;
    case "max-time": options.maxTime = parseSeconds(value); return null;
    case "connect-timeout": options.connectTimeout = parseSeconds(value); return null;
    case "retry": options.retry = Math.max(0, Number(value) || 0); return null;
    case "retry-delay": options.retryDelay = parseSeconds(value); return null;
    case "retry-max-time": options.retryMaxTime = parseSeconds(value); return null;
    case "retry-all-errors": options.retryAllErrors = value; return null;
    case "retry-connrefused": options.retryConnrefused = value; return null;
    case "proto-default": options.protoDefault = value; return null;
    case "write-out": options.writeOut = value; return null;
    case "dump-header": options.dumpHeader = value; return null;
    case "proxy": options.proxy = value; return null;
    case "help": options.help = value; return null;
    case "version": options.version = value; return null;
    default: return null;
  }
}

function parseSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

//  ------------------------------------------------------------------- URL

//  curl guesses the protocol when the URL has none; so do we, except that a
//  bare host always means http:// (https:// when the port says so), which is
//  what every scheme-less URL in the tmpk scripts wants.
export function normalizeUrl(raw, protoDefault) {
  const value = raw.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)) return value;
  const authority = value.split(/[/?#]/, 1)[0];
  const port = authority.includes(":") ? authority.split(":").pop() : "";
  let scheme = protoDefault ?? "http";
  if (port === "443") scheme = "https";
  else if (!protoDefault && /^ftp\./i.test(authority)) scheme = "ftp";
  return `${scheme}://${value}`;
}

//  ---------------------------------------------------------------- output

function openSink(target, io) {
  if (target.kind === "stdout") {
    return {
      path: null,
      async write(chunk) { await io.writeStdout(chunk); },
      async close() {},
    };
  }
  const path = target.path;
  if (target.createDirs) {
    const directory = pathDirname(path);
    if (directory && !existsSync(directory)) mkdirSync(directory, { recursive: true });
  }
  let stream;
  try {
    stream = createWriteStream(path, { flags: target.append ? "a" : "w" });
  } catch (error) {
    throw new CurlError(23, `Failed writing body: ${error.message}`);
  }
  return {
    path,
    write(chunk) {
      return new Promise((resolve, reject) => {
        stream.write(chunk, (error) => error
          ? reject(new CurlError(23, "Failed writing body"))
          : resolve());
      });
    },
    close() {
      return new Promise((resolve) => stream.end(resolve));
    },
  };
}

//  ------------------------------------------------------- progress display

function humanSize(value) {
  if (!Number.isFinite(value) || value < 0) return "    0";
  if (value < 100_000) return String(Math.round(value)).padStart(5);
  if (value < 10_000 * 1024) return `${Math.round(value / 1024)}k`.padStart(5);
  if (value < 100 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)}M`.padStart(5);
  if (value < 10_000 * 1024 * 1024) return `${Math.round(value / (1024 * 1024))}M`.padStart(5);
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)}G`.padStart(5);
}

function humanTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--:--";
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

class ProgressDisplay {
  constructor(io, style) {
    this.io = io;
    this.style = style;
    this.started = performance.now();
    this.total = null;
    this.received = 0;
    this.lastPaint = 0;
    this.painted = false;
  }

  begin(total) {
    this.total = Number.isFinite(total) && total >= 0 ? total : null;
    if (this.style === "meter") {
      this.io.writeStderr(
        "  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current\n" +
        "                                 Dload  Upload   Total   Spent    Left  Speed\n");
    }
    return this.paint(true);
  }

  advance(size) {
    this.received += size;
    return this.paint(false);
  }

  async paint(force) {
    const now = performance.now();
    if (!force && now - this.lastPaint < 200) return;
    this.lastPaint = now;
    this.painted = true;
    const spent = (now - this.started) / 1000;
    const speed = spent > 0 ? this.received / spent : 0;
    if (this.style === "bar") {
      const ratio = this.total ? Math.min(1, this.received / this.total) : 0;
      const width = 72;
      const filled = Math.round(ratio * width);
      await this.io.writeStderr(
        `\r${"#".repeat(filled)}${" ".repeat(width - filled)} ${(ratio * 100).toFixed(1)}%`);
      return;
    }
    const percent = this.total ? Math.floor((this.received / this.total) * 100) : 0;
    const left = this.total && speed > 0
      ? humanTime((this.total - this.received) / speed)
      : "--:--:--";
    await this.io.writeStderr(
      `\r${String(percent).padStart(3)} ${humanSize(this.total ?? 0)}  ` +
      `${String(percent).padStart(3)} ${humanSize(this.received)}  ` +
      `  0 ${humanSize(0)}  ${humanSize(speed)}  ${humanSize(0)} ` +
      `${humanTime(this.total && speed > 0 ? this.total / speed : NaN)} ` +
      `${humanTime(spent)} ${left} ${humanSize(speed)}`);
  }

  async end() {
    await this.paint(true);
    if (this.painted) await this.io.writeStderr("\n");
  }
}

//  ------------------------------------------------------------ request body

async function readStdinBytes(io) {
  if (io.stdinBytes) return io.stdinBytes;
  io.stdinBytes = await io.readStdin();
  return io.stdinBytes;
}

async function readOperandBytes(io, spec) {
  if (spec === "-") return readStdinBytes(io);
  const path = resolveAgainst(io.cwd, spec);
  try {
    return new Uint8Array(await readFile(path));
  } catch {
    throw new CurlError(26, `Failed to open/read local data from file/application`);
  }
}

function stripNewlines(data) {
  return data.filter((byte) => byte !== 0x0a && byte !== 0x0d);
}

async function buildDataBody(options, io) {
  const parts = [];
  let jsonRequested = false;
  for (const entry of options.data) {
    if (entry.kind === "raw") {
      parts.push(bytes(entry.value));
      continue;
    }
    if (entry.kind === "urlencode") {
      parts.push(bytes(await urlencodeSegment(entry.value, io)));
      continue;
    }
    if (entry.kind === "json") jsonRequested = true;
    const usesFile = entry.value.startsWith("@");
    if (!usesFile) {
      parts.push(bytes(entry.value));
      continue;
    }
    const data = await readOperandBytes(io, entry.value.slice(1));
    //  --data / --data-ascii / --json strip newlines from file input,
    //  --data-binary keeps the file byte-for-byte.
    parts.push(entry.kind === "binary" || entry.kind === "json" ? data : stripNewlines(data));
  }
  const separator = bytes("&");
  const merged = [];
  parts.forEach((part, index) => {
    if (index) merged.push(separator);
    merged.push(part);
  });
  return { body: concatBytes(merged), json: jsonRequested };
}

export function curlEscape(text) {
  let output = "";
  for (const byte of encoder.encode(text)) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(ch)) output += ch;
    else if (ch === " ") output += "+";
    else output += `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return output;
}

async function urlencodeSegment(spec, io) {
  //  content | =content | name=content | @file | name@file
  if (spec.startsWith("=")) return curlEscape(spec.slice(1));
  if (spec.startsWith("@"))
    return curlEscape(decoder.decode(await readOperandBytes(io, spec.slice(1))));
  const equals = spec.indexOf("=");
  const at = spec.indexOf("@");
  if (equals > 0 && (at < 0 || equals < at))
    return `${spec.slice(0, equals)}=${curlEscape(spec.slice(equals + 1))}`;
  if (at > 0) {
    const content = decoder.decode(await readOperandBytes(io, spec.slice(at + 1)));
    return `${spec.slice(0, at)}=${curlEscape(content)}`;
  }
  return curlEscape(spec);
}

async function buildFormBody(options, io) {
  const form = new FormData();
  for (const entry of options.forms) {
    const separator = entry.value.indexOf("=");
    if (separator < 0)
      throw new CurlError(2, `Illegally formatted input field: '${entry.value}'`);
    const name = entry.value.slice(0, separator);
    let value = entry.value.slice(separator + 1);
    if (entry.literal || !(value.startsWith("@") || value.startsWith("<"))) {
      form.append(name, value);
      continue;
    }
    const upload = value.startsWith("@");
    let spec = value.slice(1);
    let filename = null;
    let type = null;
    //  @file;type=...;filename=... — curl's per-part attributes.
    const attributes = spec.split(";");
    spec = attributes.shift();
    for (const attribute of attributes) {
      const [key, ...rest] = attribute.split("=");
      if (key.trim() === "type") type = rest.join("=");
      if (key.trim() === "filename") filename = rest.join("=");
    }
    const data = await readOperandBytes(io, spec);
    if (!upload) {
      form.append(name, decoder.decode(data));
      continue;
    }
    const file = new File([data], filename ?? pathBasename(spec), type ? { type } : undefined);
    form.append(name, file);
  }
  return form;
}

//  ------------------------------------------------------------- headers

function buildHeaderList(options, prepared) {
  const list = [];
  const set = (name, value) => {
    const index = list.findIndex((entry) => entry[0].toLowerCase() === name.toLowerCase());
    if (index < 0) list.push([name, value]); else list[index] = [name, value];
  };
  set("User-Agent", options.userAgent ?? DEFAULT_USER_AGENT);
  set("Accept", "*/*");
  if (prepared.contentType) set("Content-Type", prepared.contentType);
  if (options.referer) set("Referer", options.referer.replace(/;auto$/, ""));
  if (options.cookie) set("Cookie", options.cookie);
  if (options.range) set("Range", `bytes=${options.range}`);
  if (options.bearer) set("Authorization", `Bearer ${options.bearer}`);
  if (options.user) {
    const credentials = options.user.includes(":") ? options.user : `${options.user}:`;
    set("Authorization", `Basic ${Buffer.from(credentials).toString("base64")}`);
  }
  if (prepared.acceptJson) set("Accept", "application/json");
  for (const raw of options.headers) {
    const separator = raw.indexOf(":");
    if (separator < 0) {
      //  "Name;" is curl's way of sending a header with an empty value.
      if (raw.endsWith(";")) set(raw.slice(0, -1).trim(), "");
      continue;
    }
    const name = raw.slice(0, separator).trim();
    const value = raw.slice(separator + 1).trim();
    if (!value) {
      //  "Name:" removes a header curl would otherwise send itself.
      const index = list.findIndex((entry) => entry[0].toLowerCase() === name.toLowerCase());
      if (index >= 0) list.splice(index, 1);
      continue;
    }
    set(name, value);
  }
  return list;
}

function formatResponseHeaders(response) {
  const lines = [`HTTP/1.1 ${response.status} ${response.statusText}`.trimEnd()];
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
  for (const [name, value] of response.headers) {
    if (name.toLowerCase() === "set-cookie" && cookies.length) continue;
    lines.push(`${canonicalHeaderName(name)}: ${value}`);
  }
  for (const cookie of cookies) lines.push(`Set-Cookie: ${cookie}`);
  return `${lines.join("\r\n")}\r\n\r\n`;
}

//  ---------------------------------------------------------------- errors

function describeFetchFailure(error, url, elapsed, received, options) {
  const target = safeUrl(url);
  const host = target?.hostname ?? url;
  const port = target?.port || (target?.protocol === "https:" ? "443" : "80");
  const code = error?.code ?? "";
  if (error?.name === "TimeoutError" || error?.name === "AbortError")
    return new CurlError(28,
      `Operation timed out after ${Math.round(elapsed)} milliseconds with ${received} bytes received`);
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "DNSException" ||
      /getaddrinfo|Could not resolve|dns/i.test(error?.message ?? ""))
    return new CurlError(6, `Could not resolve host: ${host}`);
  if (/^(CERT_|DEPTH_ZERO|SELF_SIGNED|UNABLE_TO_|ERR_TLS)/.test(code))
    return new CurlError(60, `SSL certificate problem: ${error.message}`);
  if (code === "ECONNRESET" || code === "ConnectionClosed")
    return new CurlError(56, "Recv failure: Connection reset by peer");
  return new CurlError(7,
    `Failed to connect to ${host} port ${port} after ${Math.round(elapsed)} ms: ${
      code === "ConnectionRefused" ? "Could not connect to server" : error?.message ?? "Connection failed"}`);
}

function safeUrl(value) {
  try { return new URL(value); } catch { return null; }
}

//  --------------------------------------------------------------- write-out

function formatWriteOut(format, facts, io) {
  let output = "";
  for (let i = 0; i < format.length; i++) {
    const ch = format[i];
    if (ch === "\\" && i + 1 < format.length) {
      const next = format[++i];
      output += next === "n" ? "\n" : next === "t" ? "\t" : next === "r" ? "\r" : next;
      continue;
    }
    if (ch === "%" && format[i + 1] === "%") { output += "%"; i++; continue; }
    if (ch === "%" && format[i + 1] === "{") {
      const end = format.indexOf("}", i + 2);
      if (end < 0) { output += ch; continue; }
      const name = format.slice(i + 2, end);
      i = end;
      output += writeOutVariable(name, facts, io);
      continue;
    }
    output += ch;
  }
  return output;
}

function writeOutVariable(name, facts, io) {
  const seconds = (value) => (value / 1000).toFixed(6);
  switch (name) {
    case "url": return facts.url;
    case "url_effective": return facts.effectiveUrl;
    case "method": return facts.method;
    case "scheme": return (safeUrl(facts.effectiveUrl)?.protocol ?? "").replace(":", "").toUpperCase();
    case "http_code":
    case "response_code": return String(facts.status);
    case "http_version": return "1.1";
    case "num_redirects": return String(facts.redirects);
    case "num_headers": return String(facts.headerCount);
    case "redirect_url": return facts.redirectUrl ?? "";
    case "size_download": return String(facts.downloaded);
    case "size_upload": return String(facts.uploaded);
    case "size_header": return String(facts.headerBytes);
    case "size_request": return String(facts.requestBytes);
    case "speed_download":
      return String(Math.round(facts.downloaded / Math.max(facts.elapsed / 1000, 1e-6)));
    case "speed_upload":
      return String(Math.round(facts.uploaded / Math.max(facts.elapsed / 1000, 1e-6)));
    case "content_type": return facts.contentType ?? "";
    case "filename_effective": return facts.filename ?? "";
    case "remote_ip": return safeUrl(facts.effectiveUrl)?.hostname ?? "";
    case "remote_port":
      return safeUrl(facts.effectiveUrl)?.port ||
        (safeUrl(facts.effectiveUrl)?.protocol === "https:" ? "443" : "80");
    case "ssl_verify_result": return "0";
    case "exitcode": return String(facts.exitCode);
    case "errormsg": return facts.errorMessage ?? "";
    case "time_total": return seconds(facts.elapsed);
    case "time_starttransfer": return seconds(facts.headerElapsed);
    case "time_pretransfer":
    case "time_appconnect":
    case "time_connect": return seconds(facts.connectElapsed);
    case "time_namelookup": return seconds(0);
    case "time_redirect": return seconds(facts.redirectElapsed);
    case "header_json": return JSON.stringify(facts.headerJson);
    case "json": return JSON.stringify({
      http_code: facts.status,
      method: facts.method,
      num_redirects: facts.redirects,
      size_download: facts.downloaded,
      time_total: Number(seconds(facts.elapsed)),
      url_effective: facts.effectiveUrl,
    });
    case "stderr": facts.writeOutTarget = "stderr"; return "";
    case "stdout": facts.writeOutTarget = "stdout"; return "";
    default:
      io.writeStderr(`curl: unknown --write-out variable: '${name}'\n`);
      return "";
  }
}

//  --------------------------------------------------------------- transfer

function remoteName(url) {
  const parsed = safeUrl(url);
  const name = pathBasename(parsed?.pathname ?? "");
  return name && name !== "/" ? decodeURIComponent(name) : "";
}

function contentDispositionName(response) {
  const disposition = response.headers.get("content-disposition");
  if (!disposition) return null;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  return match ? pathBasename(match[1].trim()) : null;
}

async function performTransfer(rawUrl, target, options, io) {
  const started = performance.now();
  const url = normalizeUrl(rawUrl, options.protoDefault);
  const parsed = safeUrl(url);
  if (!parsed) throw new CurlError(3, "URL rejected: Malformed input to a URL function");
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new CurlError(1,
      `Protocol "${parsed.protocol.replace(":", "")}" not supported or disabled in libcurl`);

  const prepared = await prepareRequest(options, io);
  let method = options.method ?? prepared.method;
  if (options.head) method = options.method ?? "HEAD";
  let headers = buildHeaderList(options, prepared);
  let body = prepared.body;

  let requestUrl = url;
  if (prepared.query)
    requestUrl = `${url}${url.includes("?") ? "&" : "?"}${prepared.query}`;

  //  -O names the file after the URL that was typed, so the path is known
  //  before the first byte arrives — which is what -C - needs to size the
  //  partial download. Only -J has to wait for the response headers.
  let filePath = null;
  if (target.kind === "file") filePath = target.path === "-" ? null : target.path;
  else if (target.kind === "remote" && !options.remoteHeaderName) {
    filePath = remoteName(url);
    if (!filePath) throw new CurlError(23, "Remote filename has no length");
  }
  if (filePath !== null) filePath = resolveOutputPath(filePath, options, io);

  //  Resume: ask for the tail we are missing and append to what is there.
  let resumeFrom = 0;
  if (options.continueAt !== null && filePath !== null) {
    resumeFrom = options.continueAt === "-"
      ? (existsSync(filePath) ? statSync(filePath).size : 0)
      : Number(options.continueAt) || 0;
    if (resumeFrom > 0) headers.push(["Range", `bytes=${resumeFrom}-`]);
  }

  let effectiveUrl = requestUrl;
  let redirects = 0;
  let redirectUrl = null;
  let redirectElapsed = 0;
  let response = null;
  const headerBlocks = [];
  let connectElapsed = 0;

  while (true) {
    if (options.verbose) await logRequest(io, effectiveUrl, method, headers);
    const attemptStarted = performance.now();
    response = await fetchWithRetry(effectiveUrl, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
      redirect: "manual",
      decompress: options.compressed,
      ...(options.insecure ? { tls: { rejectUnauthorized: false } } : {}),
      ...(options.proxy ? { proxy: normalizeUrl(options.proxy, "http") } : {}),
      ...(timeoutSignal(options)),
    }, options, io, effectiveUrl, started);
    connectElapsed = attemptStarted - started;
    const block = formatResponseHeaders(response);
    headerBlocks.push(block);
    if (options.verbose) await logResponse(io, block);

    const location = response.headers.get("location");
    if (REDIRECT_STATUS.has(response.status) && location) {
      redirectUrl = new URL(location, effectiveUrl).toString();
      if (!options.location) break;
      if (redirects >= options.maxRedirects)
        throw new CurlError(47, `Maximum (${options.maxRedirects}) redirects followed`);
      try { await response.body?.cancel(); } catch {}
      redirects++;
      const previous = new URL(effectiveUrl);
      const next = new URL(redirectUrl);
      //  301/302/303 turn a POST into a GET the way browsers and curl do;
      //  307/308 keep the method and the body.
      if ((response.status === 301 || response.status === 302 || response.status === 303) &&
          method !== "HEAD" && method !== "GET") {
        method = "GET";
        body = undefined;
        headers = headers.filter(([name]) =>
          !["content-type", "content-length"].includes(name.toLowerCase()));
      }
      if (!options.locationTrusted && previous.host !== next.host)
        headers = headers.filter(([name]) => name.toLowerCase() !== "authorization");
      effectiveUrl = redirectUrl;
      redirectElapsed = performance.now() - started;
      continue;
    }
    break;
  }

  const headerElapsed = performance.now() - started;
  const httpError = options.fail && response.status >= 400;

  //  -J is the one naming mode that has to wait for the response headers.
  if (filePath === null && target.kind === "remote") {
    const name = contentDispositionName(response) ?? remoteName(url);
    if (!name) throw new CurlError(23, "Remote filename has no length");
    filePath = resolveOutputPath(name, options, io);
  }
  const sinkTarget = filePath === null
    ? { kind: "stdout" }
    : {
        kind: "file",
        path: filePath,
        //  A resumed transfer appends only when the server honoured the range.
        append: options.append || (resumeFrom > 0 && response.status === 206),
        createDirs: options.createDirs,
      };

  //  A range request answered with 416 means the local copy already holds
  //  everything the server has, so the resume is a no-op, not a failure.
  if (resumeFrom > 0 && response.status === 416) {
    try { await response.body?.cancel(); } catch {}
    return transferFacts(response, {
      url, effectiveUrl, method, redirects, redirectUrl, headerBlocks,
      downloaded: 0, uploaded: prepared.uploaded, filename: filePath,
      started, headerElapsed, connectElapsed, redirectElapsed, headers, exitCode: 0,
    });
  }

  if (httpError && !options.failWithBody) {
    try { await response.body?.cancel(); } catch {}
    const error = new CurlError(22, `The requested URL returned error: ${response.status}`);
    //  Keep the facts alive so -f -w '%{http_code}' still reports 404.
    error.facts = transferFacts(response, {
      url, effectiveUrl, method, redirects, redirectUrl, headerBlocks,
      downloaded: 0, uploaded: prepared.uploaded, filename: filePath,
      started, headerElapsed, connectElapsed, redirectElapsed, headers, exitCode: 22,
    });
    throw error;
  }

  if (options.dumpHeader) {
    const text = headerBlocks.join("");
    if (options.dumpHeader === "-") await io.writeStdout(bytes(text));
    else {
      const dump = openSink({
        kind: "file",
        path: resolveAgainst(io.cwd, options.dumpHeader),
        createDirs: options.createDirs,
      }, io);
      await dump.write(bytes(text));
      await dump.close();
    }
  }

  const sink = openSink(sinkTarget, io);
  const showProgress = shouldShowProgress(options, sinkTarget, io);
  const progress = showProgress
    ? new ProgressDisplay(io, options.progressBar ? "bar" : "meter")
    : null;

  let downloaded = 0;
  try {
    if (options.include) await sink.write(bytes(headerBlocks.join("")));
    else if (options.head) await sink.write(bytes(headerBlocks.at(-1)));
    if (progress) {
      const length = Number(response.headers.get("content-length"));
      await progress.begin(Number.isFinite(length) ? length : null);
    }
    if (response.body && method !== "HEAD") {
      for await (const chunk of response.body) {
        downloaded += chunk.byteLength;
        await sink.write(chunk);
        if (progress) await progress.advance(chunk.byteLength);
      }
    }
  } catch (error) {
    if (progress) await progress.end();
    await sink.close();
    if (error instanceof CurlError) throw error;
    throw describeFetchFailure(error, effectiveUrl, performance.now() - started, downloaded, options);
  }
  if (progress) await progress.end();
  await sink.close();

  return transferFacts(response, {
    url, effectiveUrl, method, redirects, redirectUrl, headerBlocks,
    downloaded, uploaded: prepared.uploaded, filename: filePath,
    started, headerElapsed, connectElapsed, redirectElapsed, headers,
    exitCode: httpError ? 22 : 0,
  });
}

//  Everything --write-out can ask about, gathered in one shape so a failed
//  transfer can report the same fields a successful one does.
function transferFacts(response, detail) {
  return {
    status: response.status,
    exitCode: detail.exitCode,
    response,
    url: detail.url,
    effectiveUrl: detail.effectiveUrl,
    method: detail.method,
    redirects: detail.redirects,
    redirectUrl: detail.redirectUrl,
    downloaded: detail.downloaded,
    uploaded: detail.uploaded,
    headerBytes: detail.headerBlocks.reduce((sum, block) => sum + block.length, 0),
    requestBytes: detail.headers.reduce((sum, [name, value]) => sum + name.length + value.length + 4, 0),
    headerCount: [...response.headers].length,
    contentType: response.headers.get("content-type"),
    filename: detail.filename,
    headerJson: Object.fromEntries([...response.headers].map(([name, value]) => [name, [value]])),
    elapsed: performance.now() - detail.started,
    headerElapsed: detail.headerElapsed,
    connectElapsed: detail.connectElapsed,
    redirectElapsed: detail.redirectElapsed,
  };
}

function timeoutSignal(options) {
  const seconds = options.maxTime ?? options.connectTimeout;
  return seconds ? { signal: AbortSignal.timeout(seconds * 1000) } : {};
}

function shouldShowProgress(options, target, io) {
  if (options.silent && !options.progressBar) return false;
  if (options.progressMeter === false) return false;
  if (options.progressBar) return true;
  //  curl keeps the meter off when the body is being painted on the terminal.
  return !(target.kind === "stdout" && io.stdoutIsTTY);
}

async function fetchWithRetry(url, init, options, io, effectiveUrl, started) {
  const attempts = options.retry + 1;
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      const delay = options.retryDelay ?? Math.min(2 ** (attempt - 1), 60);
      if (!options.silent)
        await io.writeStderr(`Warning: Transient problem. Will retry in ${delay} seconds. ` +
          `${attempts - attempt - 1} retries left.\n`);
      await Bun.sleep(delay * 1000);
    }
    try {
      const response = await fetch(url, init);
      if (attempt + 1 < attempts && TRANSIENT_STATUS.has(response.status)) {
        try { await response.body?.cancel(); } catch {}
        lastError = null;
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      const failure = describeFetchFailure(error, effectiveUrl, performance.now() - started, 0, options);
      const retryable = options.retryAllErrors || options.retryConnrefused ||
        [6, 7, 28, 56].includes(failure.code);
      if (attempt + 1 >= attempts || !retryable) throw failure;
    }
  }
  if (lastError) throw describeFetchFailure(lastError, effectiveUrl, performance.now() - started, 0, options);
  //  Ran out of retries on a transient HTTP status: do one last honest call.
  return fetch(url, init);
}

async function prepareRequest(options, io) {
  if (options.forms.length) {
    const form = await buildFormBody(options, io);
    return { body: form, method: "POST", contentType: null, uploaded: 0, acceptJson: false };
  }
  if (options.uploadFile) {
    const data = await readOperandBytes(io, options.uploadFile);
    return { body: data, method: "PUT", contentType: null, uploaded: data.byteLength, acceptJson: false };
  }
  if (options.data.length) {
    const { body, json } = await buildDataBody(options, io);
    if (options.get) return { body: undefined, method: "GET", query: decoder.decode(body), contentType: null, uploaded: 0, acceptJson: json };
    return {
      body,
      method: "POST",
      contentType: json ? "application/json" : "application/x-www-form-urlencoded",
      uploaded: body.byteLength,
      acceptJson: json,
    };
  }
  return { body: undefined, method: "GET", contentType: null, uploaded: 0, acceptJson: false };
}

async function logRequest(io, url, method, headers) {
  const parsed = safeUrl(url);
  const port = parsed?.port || (parsed?.protocol === "https:" ? "443" : "80");
  await io.writeStderr(`* Trying ${parsed?.hostname}:${port}...\n`);
  await io.writeStderr(`* Connected to ${parsed?.hostname} port ${port}\n`);
  await io.writeStderr(`> ${method} ${parsed ? parsed.pathname + parsed.search : url} HTTP/1.1\r\n`);
  await io.writeStderr(`> Host: ${parsed?.host}\r\n`);
  for (const [name, value] of headers) await io.writeStderr(`> ${name}: ${value}\r\n`);
  await io.writeStderr("> \r\n");
}

async function logResponse(io, block) {
  const lines = block.split("\r\n");
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) await io.writeStderr(`< ${line}\r\n`);
}

function resolveOutputPath(name, options, io) {
  let path = name;
  if (options.outputDir && !isAbsolute(path)) path = `${options.outputDir}/${path}`;
  return resolveAgainst(io.cwd, path);
}

//  ------------------------------------------------------------------- main

const USAGE = `Usage: curl [options...] <url>
 -d, --data <data>          HTTP POST data
 -f, --fail                 Fail fast with no output on HTTP errors
 -h, --help                 Get help for commands
 -o, --output <file>        Write to file instead of stdout
 -O, --remote-name          Write output to a file named as the remote file
 -s, --silent               Silent mode
 -T, --upload-file <file>   Transfer local FILE to destination
 -u, --user <user:password> Server user and password
 -A, --user-agent <name>    Send User-Agent <name> to server
 -v, --verbose              Make the operation more talkative
 -V, --version              Show version number and quit

This is not the full help; this menu is split into categories.
Use "curl --help" inside bunmsh for the built-in reference page.
`;

export async function runCurl(argv, io) {
  const parsed = parseCurlArguments(argv);
  if (parsed.error) {
    await io.writeStderr(`${parsed.error}\n`);
    await io.writeStderr("curl: try 'curl --help' or 'curl --manual' for more information\n");
    return 2;
  }
  const options = parsed.options;
  if (options.help) {
    await io.writeStdout(bytes(USAGE));
    return 0;
  }
  if (options.version) {
    await io.writeStdout(bytes(
      `curl ${CURL_VERSION} (${process.platform}-${process.arch}) bunmsh/fetch Bun/${Bun.version}\n` +
      `Release-Date: ${new Date().toISOString().slice(0, 10)}\n` +
      `Protocols: http https\n` +
      `Features: alt-svc AsynchDNS HTTP2 HTTPS-proxy Largefile libz SSL UnixSockets\n`));
    return 0;
  }
  if (options.urls.length === 0) {
    await io.writeStderr("curl: try 'curl --help' or 'curl --manual' for more information\n");
    return 2;
  }

  let status = 0;
  for (const [index, rawUrl] of options.urls.entries()) {
    let target = options.outputs[index] ??
      (options.remoteNameAll ? { kind: "remote" } : { kind: "stdout" });
    let facts = null;
    let failure = null;
    try {
      facts = await performTransfer(rawUrl, target, options, io);
      if (facts.exitCode) status = facts.exitCode;
    } catch (error) {
      failure = error instanceof CurlError
        ? error
        : describeFetchFailure(error, rawUrl, 0, 0, options);
      facts = failure.facts ?? null;
      status = failure.code;
      if (!options.silent || options.showError)
        await io.writeStderr(`curl: (${failure.code}) ${failure.message}\n`);
    }
    if (options.writeOut) {
      const format = options.writeOut.startsWith("@")
        ? decoder.decode(await readOperandBytes(io, options.writeOut.slice(1)))
        : options.writeOut;
      const source = facts ?? {
        status: 0,
        url: rawUrl,
        effectiveUrl: normalizeUrl(rawUrl, options.protoDefault),
        method: options.method ?? "GET",
        redirects: 0,
        downloaded: 0,
        uploaded: 0,
        headerBytes: 0,
        requestBytes: 0,
        headerCount: 0,
        contentType: null,
        filename: null,
        headerJson: {},
        elapsed: 0,
        headerElapsed: 0,
        connectElapsed: 0,
        redirectElapsed: 0,
        redirectUrl: null,
      };
      const detail = {
        ...source,
        exitCode: failure ? failure.code : (facts?.exitCode ?? 0),
        errorMessage: failure ? failure.message : "",
        writeOutTarget: "stdout",
      };
      const text = formatWriteOut(format, detail, io);
      if (detail.writeOutTarget === "stderr") await io.writeStderr(text);
      else await io.writeStdout(bytes(text));
    }
  }
  return status;
}
