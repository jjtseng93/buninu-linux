#!/usr/bin/env bun

import { lstatSync, readdirSync } from "node:fs";
import { basename, isAbsolute, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { iconFor } from "./src/fancy-ls.js";

let root = process.cwd();
let randomRoute = "";
const publicUrls = new WeakMap();

const ENV_FLAGS = {
  autoOpen: process.env.SERVE_AUTO_OPEN,
  minapkWebview: process.env.SERVE_MINAPK_WEBVIEW,
  randomUrl: process.env.SERVE_RANDOM_URL,
};

const OPTION_NAMES = {
  "--auto-open": "autoOpen",
  "--minapk-webview": "minapkWebview",
  "--random-url": "randomUrl",
};

const envEnabled = (value) => /^(?:1|true|yes|on)$/i.test(String(value ?? "").trim());
// A bare CLI flag always means "on"; `=off`/`=no`/`=false`/`=` always means an
// explicit "off" that overrides an environment default turned on inline.
const isOffValue = (value) => value === "" || /^(?:off|no|false)$/i.test(value);

// SERVE_MINAPK_WEBVIEW can hold a boolean-ish word (on/off/...) or a literal
// number string to pass through as MINAPK_WEBVIEW's default value.
function minapkWebviewEnvDefault(value) {
  const trimmed = String(value ?? "").trim();
  if (isOffValue(trimmed)) return null;
  if (/^\d+$/.test(trimmed)) return trimmed;
  return envEnabled(trimmed) ? "1" : null;
}

// autoOpen is `false` (off), `true` (on, open the server root), or a string
// starting with "/" -- a path opened relative to the served URL (after any
// --random-url prefix) instead of the root. SERVE_AUTO_OPEN can set any of
// the three as the default the same way --auto-open's value does.
function autoOpenEnvDefault(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed.startsWith("/") ? trimmed : envEnabled(trimmed);
}

export function parseServeArguments(args, env = process.env, cwd = process.cwd()) {
  const options = {
    autoOpen: autoOpenEnvDefault(ENV_FLAGS.autoOpen),
    minapkWebview: minapkWebviewEnvDefault(ENV_FLAGS.minapkWebview),
    randomUrl: envEnabled(ENV_FLAGS.randomUrl),
  };
  const operands = [];
  let parseOptions = true;
  for (const argument of args) {
    if (parseOptions && argument === "--") {
      parseOptions = false;
      continue;
    }
    if (parseOptions && argument.startsWith("--")) {
      const equals = argument.indexOf("=");
      const flag = equals === -1 ? argument : argument.slice(0, equals);
      const value = equals === -1 ? undefined : argument.slice(equals + 1);
      const name = OPTION_NAMES[flag];
      if (!name) return { error: `unknown option: ${argument}` };
      if (name === "minapkWebview") {
        if (value === undefined) options.minapkWebview = "1";
        else if (isOffValue(value)) options.minapkWebview = null;
        else if (/^\d+$/.test(value)) options.minapkWebview = value;
        else return { error: `invalid value for --minapk-webview: ${value}` };
      } else if (name === "autoOpen") {
        if (value === undefined) options.autoOpen = true;
        else if (isOffValue(value)) options.autoOpen = false;
        else if (value.startsWith("/")) options.autoOpen = value;
        else options.autoOpen = true;
      } else {
        options[name] = value === undefined || !isOffValue(value);
      }
      continue;
    }
    operands.push(argument);
  }
  if (operands.length > 1) return { error: "too many directory operands" };
  return { directory: operands[0] ?? cwd, ...options, env };
}

// Each UUIDv7 is 128 bits: a 48-bit ms timestamp (not secret), a 4-bit
// version + 2-bit variant (fixed), a 12-bit rand_a, and a 62-bit rand_b.
// Confirmed against Bun's own source (bun/src/jsc/uuid.rs UUID7::next):
// rand_a is a process-global monotonic counter seeded fresh only on the
// first call to observe a new millisecond -- every later call in that same
// millisecond just gets seed+1, seed+2, ..., not a fresh random draw. Four
// calls made back-to-back like this land in the same millisecond, so their
// timestamp and rand_a sequence are effectively one shared, low-entropy
// value. Only rand_b is unconditionally re-drawn from BoringSSL's CSPRNG
// (bun/src/jsc/rare_data.rs EntropyCache, backed by bun_boringssl::rand_bytes)
// on every single call, so the four independent 62-bit rand_b fields are
// the actual guaranteed entropy floor: >= 248 bits, not 4 * 128.
export const randomServeRoute = () =>
  `${Array.from({ length: 4 }, () => Bun.randomUUIDv7("base64url")).join("")}/`;

export const serveUrl = (server) => publicUrls.get(server) ?? server.url;

const escapeHtml = (value) => Bun.escapeHTML(value);

const PARSERS = new Map([
  ["json", { name: "json.parse", parse: JSON.parse }],
  ["json5", { name: "bun.json5.parse", parse: Bun.JSON5.parse }],
  ["jsonc", { name: "bun.jsonc.parse", parse: Bun.JSONC.parse }],
  ["jsonl", { name: "bun.jsonl.parse", parse: Bun.JSONL.parse }],
  ["ndjson", { name: "bun.jsonl.parse", parse: Bun.JSONL.parse }],
  ["yaml", { name: "bun.yaml.parse", parse: Bun.YAML.parse }],
  ["yml", { name: "bun.yaml.parse", parse: Bun.YAML.parse }],
  ["toml", { name: "bun.toml.parse", parse: Bun.TOML.parse }],
]);

if (typeof Bun.XML?.parse === "function") {
  PARSERS.set("xml", { name: "bun.xml.parse", parse: Bun.XML.parse });
}

const extension = (name) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

const previewName = (name) => extension(name) === "md"
  ? "bun.markdown.html"
  : PARSERS.get(extension(name))?.name;

const page = (title, body) => `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark }
  body { max-width: 72rem; margin: 2rem auto; padding: 0 1rem; font: 16px/1.7 ui-monospace, monospace }
  a { color: inherit; text-decoration: none }
  a:hover { text-decoration: underline }
  pre { padding: 1rem; overflow: auto; white-space: pre-wrap; background: color-mix(in srgb, CanvasText 7%, Canvas) }
  code { font: inherit }
  .json-statement { color: #b0005a }
  .json-string { color: #6b5d00 }
  .json-special { color: #087f5b }
  .json-number, .json-constant { color: #5f3dc4 }
  @media (prefers-color-scheme: dark) {
    .json-statement { color: #f92672 }
    .json-string { color: #e6db74 }
    .json-special { color: #a6e22e }
    .json-number, .json-constant { color: #ae81ff }
  }
</style>
${body}`;

const pretty = (value) => {
  try {
    return JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? `${item}n` : item, 2) ?? String(value);
  } catch {
    return Bun.inspect(value, { colors: false, depth: Infinity });
  }
};

// Mirrors the useful groups in jsmdcui/runtime/syntax/json.yaml for the
// strict JSON emitted by pretty(): statement keys, strings and escapes,
// numbers, and true/false/null constants.
export const highlightJson = (source) => {
  const input = String(source);
  const token = /"(?:\\(?:u[\da-fA-F]{4}|.)|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g; 
  
  //" fixes micro syntax highlighting
  
  let output = "", cursor = 0, match;
  const stringHtml = (value) => {
    let html = "", offset = 0;
    for (const escape of value.matchAll(/\\(?:u[\da-fA-F]{4}|.)/g)) {
      html += escapeHtml(value.slice(offset, escape.index));
      html += `<span class="json-special">${escapeHtml(escape[0])}</span>`;
      offset = escape.index + escape[0].length;
    }
    return html + escapeHtml(value.slice(offset));
  };
  while ((match = token.exec(input))) {
    output += escapeHtml(input.slice(cursor, match.index));
    const value = match[0];
    let end = token.lastIndex;
    if (value.startsWith('"')) {
      const propertyEnd = /^\s*:/.exec(input.slice(end));
      if (propertyEnd) {
        end += propertyEnd[0].length;
        output += `<span class="json-statement">${escapeHtml(input.slice(match.index, end))}</span>`;
      } else {
        output += `<span class="json-string">${stringHtml(value)}</span>`;
      }
    } else if (value === "true" || value === "false" || value === "null") {
      output += `<span class="json-constant">${value}</span>`;
    } else {
      output += `<span class="json-number">${value}</span>`;
    }
    cursor = end;
    token.lastIndex = end;
  }
  return output + escapeHtml(input.slice(cursor));
};

const previewResponse = async (entry) => {

  const renderHTMLOptions = { 
    headings: true 
  }

  const kind = extension(entry.name);
  try {
    const source = await Bun.file(entry.path).text();
    if (kind === "md") return new Response(page(entry.name,
      `<p><a href="${encodeURIComponent(entry.name)}">← ${escapeHtml(entry.name)}</a></p>\n${Bun.markdown.html(source,renderHTMLOptions)}`), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
    const parser = PARSERS.get(kind);
    const output = pretty(parser.parse(source));
    return new Response(page(`${entry.name} — ${parser.name}`,
      `<p><a href="${encodeURIComponent(entry.name)}">← ${escapeHtml(entry.name)}</a></p>\n<h1>${escapeHtml(entry.name)}</h1>\n<pre><code>${highlightJson(output)}</code></pre>`), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  } catch (error) {
    return new Response(page(`Cannot preview ${entry.name}`,
      `<h1>Cannot preview ${escapeHtml(entry.name)}</h1>\n<pre>${escapeHtml(error?.stack ?? String(error))}</pre>`), {
      status: 422,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
};

const directoryHtml = (route, entries) => {
  const parent = route === "/" ? "" : `<a href="../">📦 ../</a>\n`;
  const links = entries
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const directory = entry.stats.isDirectory();
      const name = `${entry.name}${directory ? "/" : ""}`;
      const encoded = encodeURIComponent(entry.name);
      const preview = !directory && previewName(entry.name);
      return `<a href="${encoded}${directory ? "/" : ""}">${iconFor(entry.name, entry.stats)} ${escapeHtml(name)}</a>${preview ? `  <a href="${encoded}-${preview}" title="Preview with ${preview}">🔍</a>` : ""}`;
    })
    .join("\n");
  const title = `Index of ${route}`;
  return page(title, `<h1>${escapeHtml(title)}</h1>\n<pre>${parent}${links}${links ? "\n" : ""}</pre>`);
};

const resolveRequestPath = (pathname) => {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const path = resolve(root, `.${decoded.replaceAll("\\", "/")}`);
  const fromRoot = relative(root, path);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot))
    return null;
  return { path, decoded };
};

const previewRequest = (pathname) => {
  const names = ["bun.markdown.html", ...new Set([...PARSERS.values()].map(({ name }) => name))];
  for (const preview of names) {
    const suffix = `-${preview}`;
    if (!pathname.endsWith(suffix)) continue;
    const original = pathname.slice(0, -suffix.length);
    if (previewName(basename(original)) === preview) return original;
  }
  return null;
};

const notFound = () => new Response("Not Found", { status: 404 });

export const resolveBunfsPath = (directory, moduleDirectory = import.meta.dirname) => {
  const requested = String(directory).replaceAll("\\", "/");
  const moduleDir = String(moduleDirectory).replaceAll("\\", "/").replace(/\/$/, "");
  const mount = /^(\/\$bunfs|[a-z]:\/~bun)(?:\/|$)/i.exec(moduleDir)?.[1];
  if (!mount) return null;
  const alias = /^(\/\$bunfs|[a-z]:\/~bun)(?=\/|$)/i.exec(requested)?.[1];
  if (!alias) return null;
  let suffix = requested.slice(alias.length);
  // Accept both the logical-root spelling and Bun's displayed physical
  // spelling without turning .../root/... into .../root/root/....
  if (suffix.toLowerCase() === "/root") suffix = "";
  else if (suffix.toLowerCase().startsWith("/root/")) suffix = suffix.slice(5);
  return `${moduleDir}${suffix}`;
};

const handleRequest = async (request) => {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });

  const url = new URL(request.url);
  let pathname = url.pathname;
  if (randomRoute) {
    const prefix = `/${randomRoute}`;
    if (!pathname.startsWith(prefix)) return notFound();
    pathname = `/${pathname.slice(prefix.length)}`;
  }
  const originalPreviewPath = previewRequest(pathname);
  const resolved = resolveRequestPath(originalPreviewPath ?? pathname);
  if (!resolved) return new Response("Bad Request", { status: 400 });

  let stats;
  try {
    stats = lstatSync(resolved.path);
  } catch {
    return notFound();
  }

  if (originalPreviewPath) {
    if (stats.isDirectory()) return notFound();
    return previewResponse({ name: basename(resolved.path), path: resolved.path, stats });
  }

  if (stats.isDirectory()) {
    if (!url.pathname.endsWith("/")) {
      url.pathname += "/";
      return Response.redirect(url, 308);
    }
    let entries;
    try {
      entries = readdirSync(resolved.path, { withFileTypes: true }).map((entry) => {
        const path = resolve(resolved.path, entry.name);
        return { name: entry.name, path, stats: lstatSync(path) };
      });
    } catch (error) {
      return new Response(`Cannot list directory: ${error.message}`, { status: 403 });
    }
    return new Response(directoryHtml(resolved.decoded, entries), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // Keep this as a whole, unsliced Bun.file() response. Bun's normal response
  // path then provides native GET/HEAD Range handling, including 206 and 416.
  return new Response(Bun.file(resolved.path));
};

const safeHandleRequest = async (request) => {
  try {
    return await handleRequest(request);
  } catch (error) {
    // Keep an unexpected renderer, filesystem, or runtime exception local to
    // this request. Bun.serve stays alive and the next request is unaffected.
    console.error("bunmsh: serve: request failed:", error);
    return new Response(page("Internal Server Error",
      "<h1>Internal Server Error</h1>\n<p>The server is still running.</p>"), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
};

// Prefer a real xdg-open on PATH regardless of platform -- it's common
// enough on macOS/Windows dev setups (Cygwin, MSYS2, Homebrew's xdg-utils)
// and behaves consistently. Only fall back to each OS's own "hand this to
// the default handler" command when xdg-open isn't present, same relationship
// as the npm `buninu` package's own xdg-open shim.
function openServeCommand() {
  const executable = Bun.which("xdg-open");
  if (executable) return [executable];
  if (process.platform === "darwin") return ["open"];
  // start is a cmd builtin, not a real executable, and needs an empty ""
  // title argument first or it treats a quoted target as the title.
  if (process.platform === "win32") return ["cmd", "/c", "start", ""];
  return null;
}

// autoOpen is `true` for the served root as-is, or a "/"-led path opened
// relative to it -- resolved after any --random-url prefix baked into url,
// since url already ends in "/" (server.url does, and so does the URL built
// from randomRoute in main()).
export const openTargetUrl = (url, autoOpen) =>
  typeof autoOpen === "string" ? new URL(autoOpen.slice(1), url) : url;

function openServeUrl(url, minapkWebview, env = process.env) {
  const command = openServeCommand();
  if (!command) {
    console.error("bunmsh: serve: xdg-open not found");
    return false;
  }
  try {
    Bun.spawn([...command, String(url)], {
      env: minapkWebview ? { ...env, MINAPK_WEBVIEW: String(minapkWebview) } : env,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    }).unref();
    return true;
  } catch (error) {
    console.error(`bunmsh: serve: ${command[0]}: ${error.message}`);
    return false;
  }
}

export function main(directory = process.cwd(), options = {}) {
  // The virtual mount itself is not stat-able. import.meta.dirname points at
  // its real root on each platform: /$bunfs/root or B:/~BUN/root.
  root = resolve(resolveBunfsPath(directory) ?? directory);
  randomRoute = options.randomUrl ? randomServeRoute() : "";
  const serverOptions = {
    port: Number((options.env ?? process.env).PORT ?? 3000),
    fetch: safeHandleRequest,
  };
  let server;
  try {
    server = Bun.serve(serverOptions);
  } catch (error) {
    const addressInUse = error?.code === "EADDRINUSE" ||
      /EADDRINUSE|address already in use/i.test(String(error?.message ?? error));
    if (serverOptions.port !== 3000 || !addressInUse) throw error;
    server = Bun.serve({ ...serverOptions, port: 0 });
  }
  const url = randomRoute ? new URL(randomRoute, server.url) : server.url;
  publicUrls.set(server, url);
  console.log(`Serving ${root}\n  ${url.href}`);
  if (options.autoOpen) openServeUrl(openTargetUrl(url, options.autoOpen), options.minapkWebview, options.env);
  return server;
}

export function waitForInterrupt(server, options = {}) {
  return new Promise((resolve) => {
    let readline;
    let finished = false;
    const stop = (signal) => {
      if (finished) return;
      finished = true;
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      readline?.close();
      server.stop(true);
      resolve(signal);
    };
    const onSigint = () => stop("SIGINT");
    const onSigterm = () => stop("SIGTERM");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    if (!process.stdin.isTTY) return;
    console.log("q/quit/exit: stop  o: open in browser");
    readline = createInterface({ input: process.stdin, terminal: false });
    readline.on("line", (line) => {
      const command = line.trim().toLowerCase();
      if (["q", "quit", "exit"].includes(command)) {
        stop("QUIT");
      } else if (command === "o") {
        openServeUrl(openTargetUrl(serveUrl(server), options.autoOpen), options.minapkWebview, options.env);
      } else if (command) {
        console.error(`bunmsh: serve: unknown control: ${command}`);
      }
    });
    readline.on("close", () => stop("EOF"));
  });
}

if (import.meta.main) {
  const options = parseServeArguments(process.argv.slice(2));
  if (options.error) {
    console.error(`bunmsh: serve: ${options.error}`);
    process.exit(2);
  }
  await waitForInterrupt(main(options.directory, options), options);
}
