#!/usr/bin/env bun

const jsStart = globalThis.Bun ? Bun.nanoseconds() : Date.now() * 1e6;
const checkpoints = [
  { name: "Bun Engine Boot", time: 0 },
  { name: "JS Load & Module Imports", time: jsStart }
];
function addCheckpoint(name) {
  checkpoints.push({ name, time: globalThis.Bun ? Bun.nanoseconds() : Date.now() * 1e6 });
}

let parallelTimings = null;

function printProfileReport() {
  console.log("\x1b[1m\x1b[36m=== Bunmicro Startup Performance Profile ===\x1b[0m\n");
  
  let totalMs = 0;
  const rows = [];
  
  for (let i = 0; i < checkpoints.length - 1; i++) {
    const current = checkpoints[i];
    const next = checkpoints[i + 1];
    const durationNs = next.time - current.time;
    const durationMs = durationNs / 1e6;
    totalMs += durationMs;
    
    rows.push({
      phase: current.name,
      durationMs: durationMs,
      cumulativeMs: totalMs
    });
  }
  
  const colWidths = { phase: 32, duration: 15, cumulative: 15 };
  
  const header = 
    "Phase".padEnd(colWidths.phase) + " | " +
    "Duration (ms)".padStart(colWidths.duration) + " | " +
    "Cumulative (ms)".padStart(colWidths.cumulative);
  
  const separator = 
    "-".repeat(colWidths.phase) + "-+-" +
    "-".repeat(colWidths.duration) + "-+-" +
    "-".repeat(colWidths.cumulative);
    
  console.log(header);
  console.log(separator);
  
  for (const row of rows) {
    const phaseStr = row.phase.padEnd(colWidths.phase);
    const durStr = row.durationMs.toFixed(3).padStart(colWidths.duration);
    const cumStr = row.cumulativeMs.toFixed(3).padStart(colWidths.cumulative);
    
    let color = "";
    if (row.durationMs > 50) {
      color = "\x1b[31m"; // Red
    } else if (row.durationMs > 10) {
      color = "\x1b[33m"; // Yellow
    }
    
    const reset = color ? "\x1b[0m" : "";
    console.log(`${color}${phaseStr}${reset} | ${color}${durStr}${reset} | ${cumStr}`);
  }
  
  console.log(separator);
  
  if (parallelTimings) {
    console.log("\x1b[1mParallel Tasks Breakdown:\x1b[0m");
    console.log(`  ├── Lua Plugins & Hooks : ${parallelTimings.lua.toFixed(3).padStart(8)} ms`);
    console.log(`  ├── JS Plugins Load     : ${parallelTimings.js.toFixed(3).padStart(8)} ms`);
    console.log(`  └── Buffer & History    : ${parallelTimings.buffers.toFixed(3).padStart(8)} ms`);
    console.log(separator);
  }
  
  console.log(`\x1b[1mTotal Startup Time: ${totalMs.toFixed(3)} ms\x1b[0m\n`);
  
  const slowest = [...rows].sort((a, b) => b.durationMs - a.durationMs)[0];
  if (slowest) {
    console.log(`\x1b[1mSlowest Phase:\x1b[0m ${slowest.phase} (${slowest.durationMs.toFixed(3)} ms)`);
    if (slowest.phase.includes("Clipboard")) {
      console.log("\x1b[32mTip: Clipboard probing can be slow. Setting 'clipboard' option to 'terminal' or a specific tool can bypass auto-detection.\x1b[0m");
    } else if (slowest.phase.includes("Plugin")) {
      console.log("\x1b[32mTip: Disable unnecessary plugins to speed up startup.\x1b[0m");
    } else if (slowest.phase.includes("Syntax")) {
      console.log("\x1b[32mTip: Syntax loading parses many YAML/JSON files. You can pre-compile or bundle syntax definitions to speed this up.\x1b[0m");
    } else if (slowest.phase.includes("JS Load")) {
      console.log("\x1b[32mTip: JS load time includes loading packages like wasmoon, which might take time due to file system lookups.\x1b[0m");
    }
  }
}

import child_process from "node:child_process"
import { accessSync, closeSync, constants, existsSync, openSync, readSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname, basename, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { toggleTaskCheckboxBeforeColumn, updateAnsiTaskCheckbox } from "./cui/task-checkbox.mjs";
import { backspaceMdcuiTableRow, deleteMdcuiTableRow, isMdcuiTableRow, overwriteMdcuiTableRow, replaceAnsiPlainRange } from "./cui/table-row-edit.mjs";
import { markTuiTableStripeStyles } from "./cui/table-render.mjs";
import { fenceEventMap, inlineFenceEventCode } from "./cui/fence-events.mjs";
import {
  checkMarkdownIdCollisions,
  formatMarkdownIdCheckAnsi,
  formatMarkdownOutline,
} from "./cui/id-collision.mjs";
import { fitKittyImageToWidth, prepareKittyImages } from "./cui/kitty-images.mjs";
import { kittyModeFromEnvironment } from "./cui/kitty-mode.mjs";
import { logKittyPlacement } from "./cui/kitty-debug.mjs";
import {
  enqueueMdcuiRerender,
  waitForMdcuiRerenders,
} from "./cui/rerender-queue.mjs";
import { resizeMdcuiTextBlock } from "./cui/text-block-resize.mjs";
import { indexedTuiLinkAtPosition, refreshTuiLinkIndex, tuiLinkActivationContext } from "./cui/tui-links.mjs";
import { applyPreRenderHeadingData } from "./cui/template-components.mjs";
import { Config } from "./config/config.js";
import { defaultAllSettings, OPTION_CHOICES, LOCAL_SETTINGS } from "./config/defaults.js";
import { cleanConfig } from "./config/clean.js";
import { RuntimeRegistry, RTColorscheme, RTHelp } from "./runtime/registry.js";
import { assetDiskPath, assetPath, buildHtmlBundleImageMap, hasInternalAssets, listInternalAssetDirs, listInternalAssetPaths, readAssetText, readInternalAssetText } from "../single-exe/assetsHelper.js";
//import { PluginManager } from "./plugins/manager.js";
import { JsPluginManager, buildMicroGlobal, buildTuiBlockIndex, captureTuiRerenderState, clearTuiSourceDependentState, findTuiBlockInIndex, indexTuiHeadingRows, insertTuiTextareaNewline, markTuiTableCellDirtyAtPosition, mergeTuiTextareaBackward, mergeTuiTextareaForward, navigateTuiHeadingFragment, restoreTuiHiddenHeadings, restoreTuiRerenderState, toggleTuiHeadingAt, tuiCheckboxRerenderMismatchMessage, tuiTableCellAtPosition, runAction, listActions } from "./plugins/js-bridge.js";
import { Colorscheme } from "./config/colorscheme.js";
import { detectSyntax, loadSyntaxDefinitions } from "./highlight/parser.js";
import { Highlighter } from "./highlight/highlighter.js";
import { DISABLE_MOUSE, parseInputEvents, parseKey } from "./screen/events.js";
import { Screen } from "./screen/screen.js";
import { VT100 } from "./screen/vt100.js";
import { ClipboardManager, probeOSC52, osc52Clipboard } from "./platform/clipboard.js";
import { platformId, run as runCommand, runSync, fetchHttpBytes, detectHttpBackend } from "./platform/commands.js";
import { controllingTerminalInputPath } from "./platform/terminal.js";
import { shellSplit } from "./shell/shell.js";
import { styleToAnsi } from "./display/ansi-style.js";
import { encodeBinaryToBuffer, decodeBinaryBytes } from "./buffer/fixed3-codec.js";
import { writeBackup, removeBackup, applyBackup } from "./buffer/backup.js";

let kittyImageMode = "off";
let allowRemoteKittyImages = false;
const remoteMarkdownSources = new Map();
let bundledImageMapPromise = null;
import { isHex3Encoding, isMdcuiEncoding } from "./runtime/encodings.js";
import { createInterface } from "node:readline/promises";

import pkg from "../package.json" with { type: "json" };
import { REPO_ROOT,IS_COMPILED, buildExecutable,buildEarlyExit,stringifyNonPrimitiveDefineValues } from "../single-exe/compiled.js";
import { expandBuildMdAliases } from "./build-args.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getBundledImageMap() {
  if (!IS_COMPILED || !global.MDCUI_MAIN) return null;
  bundledImageMapPromise ??= import(global.MDCUI_MAIN + "-server.js")
    .then((module) => buildHtmlBundleImageMap(module.homepage));
  return bundledImageMapPromise;
}


if(!globalThis.Bun)
{
  try{
    let bunbinary=child_process.spawnSync("bun",["--print","Bun.which('bun')"]).stdout.toString().trim()
    process.argv[0]=bunbinary
    process.argv[1]=__filename
    //console.log(process.argv)

    console.error('Ran by node, changed to run by bun')
    const launched = child_process.spawnSync(bunbinary, process.argv.slice(1), {
      stdio: "inherit",
      env: process.env,
    });
    if (launched.error) throw launched.error;
    process.exit(launched.status ?? 1);
  }
  catch(e){
    console.log(`
Node.js is not supported
Please install Bun at 
  https://bun.com
or use the script below:
  
If you have npm
  
  npm i -g bun
    
Linux/macOS
  If you have bash and curl:

  curl -fsSL https://bun.sh/install | bash

Windows

  powershell -c "irm bun.sh/install.ps1 | iex"

    `)
    process.exit(127)
  }
}

const VERSION = pkg.version;

const SINGLE_EXE_DIR = resolve(REPO_ROOT, "single-exe");
const SINGLE_EXE_ENTRY = resolve(SINGLE_EXE_DIR, "entry.mjs");
const DEFAULT_BUILD_OUTFILE = "mdcui";
const MDCUI_DEFAULT_EDIT_ENABLED = typeof MDCUI_DEFAULT_EDIT !== "undefined";
const MDCUI_DEFAULT_DEMO_ENABLED = typeof MDCUI_DEFAULT_DEMO !== "undefined";
const MDCUI_DEFAULT_DEMO_WUI_ENABLED = typeof MDCUI_DEFAULT_DEMO_WUI !== "undefined";
const MDCUI_OVERWRITE_DEMO_ENABLED = typeof MDCUI_OVERWRITE_DEMO !== "undefined";
let defaultEdit = false;
let noRuntimeArgs = false;
const decoder = new TextDecoder();
let _activeTtyStream = null; // set in App.start() for use by the global error handler

const KEYDISPLAY = [
  "^Q Quit, ^S Save, ^O Open, ^G Help, ^E Cmd, ^K CutRow",
  "^F Find, ^Z Undo, ^Y Redo, ^A All, ^B Shell, ^D DupRow, ^T New Tab",
];

const DEFAULT_SETTINGS = {
  tabsize: 4,
  tabstospaces: false,
  autosave: 0,
  cursorshape: "block",
  cursorline: true,
  diffgutter: false,
  eofnewline: true,
  parsecursor: true,
  ruler: true,
  relativeruler: false,
  matchbrace: true,
  matchbraceleft: true,
  matchbracestyle: "underline",
  savecursor: false,
  backup: true,
  backupdir: "",
  permbackup: false,
  softwrap: true,
  wordwrap: false,
  pageoverlap: 2,
  scrollmargin: 3,
  reload: "prompt",
  encoding: "utf-8",
  fileformat: process.platform === "win32" ? "dos" : "unix",
  "comment.type": "",
  commenttype: "",
  hltrailingws: false,
  hltaberrors: false,
  colorcolumn: 0,
  showchars: "",
  indentchar: " ",
};

const LONG_LINE_REHIGHLIGHT_LIMIT = 300;
// Lines exceeding this are never highlighted interactively; stored as default and deferred to Esc.
const LONG_LINE_INITIAL_HIGHLIGHT_LIMIT = 10_000;

const promptHistory = new Map();
let startupHighlightProgress = null;

function write(data) {
  process.stdout.write(data);
}

// Pre-TUI terminal prompt — stdin must still be in line (cooked) mode.
// Accepts an optional input stream so the TUI path can pass its own tty fd.
async function termPromptLine(msg, input = process.stdin) {
  const rl = createInterface({ input, output: process.stdout });
  try {
    console.log(Bun.markdown.ansi(msg))
    return await rl.question("> ");
  } catch {
    return "";
  } finally {
    rl.close();
  }
}

function sgr(...codes) {
  return `\x1b[${codes.join(";")}m`;
}

function move(row, col) {
  return `\x1b[${row};${col}H`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function canWritePath(path) {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function isHttpUrl(value) {
  return String(value ?? "").startsWith("http://") || String(value ?? "").startsWith("https://");
}

function decodeTextBytesWithEncoding(bytes, encoding = "utf-8") {
  const normalized = normalizeEncodingLabel(encoding);
  if (isMdcuiEncoding(normalized)) {
    const decoder = new TextDecoder("utf-8");
    return { text: decoder.decode(bytes), encoding: "mdcui" };
  }
  if (normalized === "hex3gz") {
    const decoded = decodeHex3Bytes(Bun.gunzipSync(bytes));
    return { ...decoded, encoding: "hex3gz" };
  }
  if (normalized === "hex3zst") {
    const decoded = decodeHex3Bytes(Bun.zstdDecompressSync(bytes));
    return { ...decoded, encoding: "hex3zst" };
  }
  if (normalized === "hex3") {
    return decodeHex3Bytes(bytes);
  }
  const decoder = new TextDecoder(normalized);
  return { text: decoder.decode(bytes), encoding: decoder.encoding };
}

function encodeTextBytesWithEncoding(text, encoding = "utf-8") {
  const normalized = normalizeEncodingLabel(encoding);
  if (normalized === "hex3gz") {
    return Bun.gzipSync(encodeHex3Text(text));
  }
  if (normalized === "hex3zst") {
    return Bun.zstdCompressSync(encodeHex3Text(text));
  }
  if (normalized === "hex3") {
    return encodeHex3Text(text);
  }
  return new TextEncoder().encode(String(text));
}

function decodeHex3Bytes(bytes) {
  return { text: encodeBinaryToBuffer(bytes).toString("latin1"), encoding: "hex3" };
}

function encodeHex3Text(text) {
  return decodeBinaryBytes(Buffer.from(text, "latin1"));
}

async function readTextFileWithEncoding(path, encoding = "utf-8", inferMdcui = true) {
  const bytes = new Uint8Array(await Bun.file(path).arrayBuffer());
  return decodeAndRenderTextBytes(bytes, encodingForPath(path, encoding, inferMdcui), process.stdout.columns || 80, path);
}

async function fetchTextWithEncoding(url, encoding = "utf-8", inferMdcui = true) {
  const bytes = await fetchHttpBytes(url);
  return decodeAndRenderTextBytes(
    new Uint8Array(bytes),
    encodingForPath(url, encoding, inferMdcui),
    process.stdout.columns || 80,
    url,
  );
}

function normalizeEncodingLabel(encoding = "utf-8") {
  const s = String(encoding || "utf-8");
  if (isHex3Encoding(s)) return s.toLowerCase();
  if (isMdcuiEncoding(s)) return "mdcui";
  return new TextDecoder(s).encoding;
}

function encodingForPath(pathOrUrl, encoding = DEFAULT_SETTINGS.encoding, inferMdcui = true) {
  const normalized = normalizeEncodingLabel(encoding);
  if (normalized !== "utf-8" || !inferMdcui || defaultEdit) return normalized;
  let pathname = String(pathOrUrl ?? "").replace(/[?#].*$/, "");
  try {
    if (isHttpUrl(pathname)) pathname = new URL(pathname).pathname;
  } catch {}
  return pathname.toLowerCase().endsWith(".md") ? "mdcui" : normalized;
}

async function decodeAndRenderTextBytes(bytes, encoding = "utf-8", width = process.stdout.columns || 80, mdpath = null) {
  const decoded = decodeTextBytesWithEncoding(bytes, encoding);
  if (!isMdcuiEncoding(decoded.encoding)) return decoded;
  const renderWidth = Math.max(1, Math.trunc(Number(width) || 80));
  const { rendered, tuiSourceText, images, preRenderHeadingData } = await renderMdcui(decoded.text, renderWidth, mdpath, mdpath);
  const styled = parseAnsiStyledText(rendered);
  markTuiTableStripeStyles(styled.styleLines, styled.text.split("\n"));
  return { text: styled.text, encoding: "mdcui", sourceText: decoded.text, tuiSourceText, ansiText: rendered, ansiStyleLines: styled.styleLines, mdcuiImages: images, mdcuiRenderWidth: renderWidth, preRenderHeadingData };
}

async function renderMdcui(markdown, width = process.stdout.columns || 80, mdpath = null, imageBasePath = mdpath) {
  const runmd = await import("../runmd.mjs");
  let md = String(markdown);
  if (mdpath && !isHttpUrl(mdpath)) {
    md = await runmd.extractJs(md, mdpath);
    await runmd.createWui(md, mdpath);
  }
  const renderContext = {};
  const tui = runmd.createTui(
    md,
    Math.max(1, Math.trunc(Number(width) || 80)),
    renderContext,
  );
  const resolvedImageBasePath = mdpath && !isHttpUrl(mdpath)
    ? remoteMarkdownSources.get(resolve(mdpath)) ?? imageBasePath
    : imageBasePath;
  const prepared = kittyImageMode === "off"
    ? { rendered: tui, images: [] }
    : await prepareKittyImages(tui, resolvedImageBasePath, width, {
      allowUrl: allowRemoteKittyImages,
      kittyMode: kittyImageMode,
      getBundledImageMap,
    });
  return {
    rendered: prepared.rendered,
    images: prepared.images,
    tuiSourceText: md,
    preRenderHeadingData: renderContext.preRenderHeadingData,
  };
}

function stripAnsi(text) {
  return Bun.stripANSI(String(text));
}

const ANSI_COLORS = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightblack", "brightred", "brightgreen", "brightyellow",
  "brightblue", "brightmagenta", "brightcyan", "brightwhite",
];

function parseAnsiStyledText(ansiText) {
  const text = stripAnsi(ansiText);
  const styleLines = text.split("\n").map(() => []);
  let line = 0;
  let col = 0;
  let style = {};
  const input = String(ansiText);

  for (let i = 0; i < input.length;) {
    const ch = input[i];
    if (ch === "\x1b") {
      if (input[i + 1] === "[") {
        const end = findAnsiCsiEnd(input, i + 2);
        if (end < 0) break;
        if (input[end] === "m") style = applyAnsiSgr(style, input.slice(i + 2, end));
        i = end + 1;
        continue;
      }
      if (input[i + 1] === "]") {
        const bel = input.indexOf("\x07", i + 2);
        const st = input.indexOf("\x1b\\", i + 2);
        if (bel < 0 && st < 0) break;
        i = bel >= 0 && (st < 0 || bel < st) ? bel + 1 : st + 2;
        continue;
      }
      i += 2;
      continue;
    }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") {
      line++;
      col = 0;
      if (!styleLines[line]) styleLines[line] = [];
      i++;
      continue;
    }
    const unit = displayUnitAt(input, i);
    if (unit.length <= 0) break;
    const currentStyle = Object.keys(style).length ? { ...style } : null;
    if (currentStyle && styleLines[line]) {
      for (let j = 0; j < unit.length; j++) styleLines[line][col + j] = currentStyle;
    }
    col += unit.length;
    i += unit.length;
  }
  return { text, styleLines: normalizeAnsiStyleLinesBlend(styleLines) };
}

function normalizeAnsiStyleLinesBlend(styleLines) {
  const baseBg = dominantAnsiBackground(styleLines);
  if (baseBg == null) return styleLines;
  return styleLines.map((line) => line.map((style) => {
    if (!style || style.bg !== baseBg) return style;
    const next = { ...style };
    delete next.bg;
    return Object.keys(next).length ? next : null;
  }));
}

function dominantAnsiBackground(styleLines) {
  const counts = new Map();
  for (const line of styleLines) {
    for (const style of line) {
      const bg = style?.bg;
      if (bg == null || bg === "default") continue;
      counts.set(bg, (counts.get(bg) ?? 0) + 1);
    }
  }
  let bestBg = null;
  let bestCount = 0;
  for (const [bg, count] of counts) {
    if (count > bestCount) {
      bestBg = bg;
      bestCount = count;
    }
  }
  return bestBg;
}

function findAnsiCsiEnd(str, start) {
  for (let i = start; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 0x40 && c <= 0x7e) return i;
  }
  return -1;
}

function applyAnsiSgr(current, params) {
  const parts = params === "" ? [0] : params.split(";").map((p) => p === "" ? 0 : Number(p));
  let style = { ...current };
  for (let i = 0; i < parts.length; i++) {
    const n = parts[i];
    if (n === 0) style = {};
    else if (n === 1) style.bold = true;
    else if (n === 3) style.italic = true;
    else if (n === 4) style.underline = true;
    else if (n === 7) style.reverse = true;
    else if (n === 21 || n === 22) delete style.bold;
    else if (n === 23) delete style.italic;
    else if (n === 24) delete style.underline;
    else if (n === 27) delete style.reverse;
    else if (n >= 30 && n <= 37) style.fg = ANSI_COLORS[n - 30];
    else if (n === 38) {
      const color = parseAnsiExtendedColor(parts, i);
      if (color.value != null) style.fg = color.value;
      i += color.skip;
    } else if (n === 39) delete style.fg;
    else if (n >= 40 && n <= 47) style.bg = ANSI_COLORS[n - 40];
    else if (n === 48) {
      const color = parseAnsiExtendedColor(parts, i);
      if (color.value != null) style.bg = color.value;
      i += color.skip;
    } else if (n === 49) delete style.bg;
    else if (n >= 90 && n <= 97) style.fg = ANSI_COLORS[n - 90 + 8];
    else if (n >= 100 && n <= 107) style.bg = ANSI_COLORS[n - 100 + 8];
  }
  return style;
}

function parseAnsiExtendedColor(parts, index) {
  const mode = parts[index + 1];
  if (mode === 5) return { value: parts[index + 2] ?? 0, skip: 2 };
  if (mode === 2) {
    return {
      value: `#${toHex2(parts[index + 2])}${toHex2(parts[index + 3])}${toHex2(parts[index + 4])}`,
      skip: 4,
    };
  }
  return { value: null, skip: 0 };
}

function toHex2(value) {
  return ((value ?? 0) & 0xff).toString(16).padStart(2, "0");
}

function localModuleUrl(filePath) {
  const absPath = resolve(filePath);
  let href = pathToFileURL(absPath).href;
  try {
    href += `?mtime=${statSync(absPath).mtimeMs}`;
  } catch {}
  return href;
}

function mdcuiCellPayload(buf, y, x, trigger = "unknown") {
  if (!buf || !isMdcuiEncoding(buf.encoding)) return null;
  const rowIdx = clamp(Math.trunc(Number(y) || 0), 0, Math.max(0, (buf.lines?.length ?? 1) - 1));
  const line = buf.lines?.[rowIdx] ?? "";
  const charIdx = normalizeCharBoundary(line, clamp(Math.trunc(Number(x) || 0), 0, line.length));
  const col = displayWidth(line.slice(0, charIdx)) + 1;
  const ansiLine = String(buf._mdcuiAnsiText ?? "").split("\n")[rowIdx] ?? line;
  const ansi = typeof Bun?.sliceAnsi === "function"
    ? Bun.sliceAnsi(ansiLine, col - 1, col)
    : line.slice(charIdx, charIdx + 1);
  const linkSpan = indexedTuiLinkAtPosition(buf, rowIdx, charIdx);
  return {
    trigger,
    row: rowIdx + 1,
    col,
    ansi,
    link: linkSpan?.href ?? null,
    linkText: linkSpan?.textContent ?? "",
    linkHtml: linkSpan?.innerHTML ?? null,
    linkParent: linkSpan
      ? tuiTableCellAtPosition(buf, rowIdx, charIdx)
      : null,
    line,
  };
}

function detectFileFormat(text, fallback = DEFAULT_SETTINGS.fileformat) {
  if (text.length === 0) return fallback === "dos" ? "dos" : "unix";
  const newlineIdx = text.indexOf("\n");
  if (newlineIdx < 0) return "unix";
  return newlineIdx > 0 && text.charCodeAt(newlineIdx - 1) === 13 ? "dos" : "unix";
}

function normalizeBufferText(text) {
  return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function encodeBufferTextForFile(text, fileformat) {
  return fileformat === "dos" ? text.replace(/\n/g, "\r\n") : text;
}

function isReadonlyBuffer(buf) {
  return Boolean(buf?.readonly || buf?.Settings?.readonly || buf?.Type?.Readonly);
}

function mdcuiEditablePrefixLength(buf, y = buf?.cursor?.y ?? 0) {
  if (!isMdcuiEncoding(buf?.encoding ?? buf?.Settings?.encoding)) return 0;
  const line = String(buf?.lines?.[y] ?? "");
  return /^(?:│|\|) /.test(line) ? 2 : 0;
}

function canEditMdcuiAtCursor(buf) {
  const prefixLength = mdcuiEditablePrefixLength(buf);
  return prefixLength > 0 && (buf?.cursor?.x ?? 0) >= prefixLength;
}

// insertChar / backspace / deleteForward 只改 buf.lines，不會像
// spliceTuiBufferLines 那樣同步 buf._mdcuiAnsiText。若放著不管，之後任何
// 依賴 _mdcuiAnsiText 重建畫面的動作（例如 refreshMdcuiKittyImages 換圖片時）
// 都會用這份沒反映最新輸入的舊快照，把使用者剛打的字蓋掉。這裡比照
// applyMdcuiTableRowEdit 的做法，在同一行內插入/刪除純文字時，順手同步
// ansiText 對應那一行的可視文字內容。
function syncMdcuiAnsiTextForCharEdit(buf, row, start, end, replacement) {
  if (!isMdcuiEncoding(buf?.encoding) || typeof buf._mdcuiAnsiText !== "string") return;
  const ansiLines = buf._mdcuiAnsiText.split("\n");
  if (row < 0 || row >= ansiLines.length) return;
  ansiLines[row] = replaceAnsiPlainRange(ansiLines[row] ?? "", start, end, replacement);
  buf._mdcuiAnsiText = ansiLines.join("\n");
}

function canEditMdcuiSelection(buf, selection) {
  if (!selection) return true;
  const { first, last } = selectionBounds(selection);
  const prefixLength = mdcuiEditablePrefixLength(buf, first.y);
  return first.y === last.y && prefixLength > 0 && first.x >= prefixLength;
}

function applyMdcuiTableRowEdit(buf, edit) {
  if (!buf || !edit) return false;
  const row = buf.cursor.y;
  markTuiTableCellDirtyAtPosition(buf, row, edit.start);
  const styleLine = buf._ansiStyleLines?.[row];
  if (Array.isArray(styleLine)) {
    const style = styleLine[edit.start] ?? null;
    styleLine.splice(
      edit.start,
      edit.end - edit.start,
      ...Array.from({ length: edit.replacement.length }, () => style),
    );
  }
  if (typeof buf._mdcuiAnsiText === "string") {
    const ansiLines = buf._mdcuiAnsiText.split("\n");
    ansiLines[row] = replaceAnsiPlainRange(
      ansiLines[row] ?? "",
      edit.start,
      edit.end,
      edit.replacement,
    );
    buf._mdcuiAnsiText = ansiLines.join("\n");
  }
  buf.lines[row] = edit.line;
  buf.cursor.x = edit.cursor;
  buf.invalidateHighlightFrom(row);
  buf._mdcuiLinkIndex = null;
  buf.modified = true;
  return true;
}

function mdcuiTextareaAtCursor(buf) {
  if (!isMdcuiEncoding(buf?.encoding)) return null;
  let cache = buf._mdcuiControlBlockIndex;
  if (!cache || cache.lines !== buf.lines || cache.lineCount !== buf.lines.length) {
    cache = {
      lines: buf.lines,
      lineCount: buf.lines.length,
      blocks: buildTuiBlockIndex(buf.lines),
    };
    buf._mdcuiControlBlockIndex = cache;
  }
  const block = findTuiBlockInIndex(cache.blocks, buf.cursor.y);
  return block?.header?.tag === "textarea" ? block : null;
}

function isEditLockedBuffer(buf) {
  return isMdcuiEncoding(buf?.encoding ?? buf?.Settings?.encoding);
}

// Cross-platform shell helpers
const _isWin = process.platform === "win32";
function defaultShell() {
  return _isWin ? (process.env.COMSPEC || "cmd.exe") : (process.env.SHELL || "sh");
}
function shellCmdArgs(cmd) {
  // Returns [shell, flag, cmd] for running a shell one-liner
  return _isWin ? [defaultShell(), "/c", cmd] : [defaultShell(), "-c", cmd];
}

function isWordChar(ch) {
  if (!ch) return false;
  const cp = ch.codePointAt(0);
  if ((cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || (cp >= 48 && cp <= 57) || cp === 95) return true;
  if (cp <= 127) return false;
  return /\p{L}|\p{N}/u.test(ch);
}

function isWideCodePoint(cp) {
  if (cp < 0x1100) return false;
  return (
    cp <= 0x115F ||
    cp === 0x2329 || cp === 0x232A ||
    (cp >= 0x2E80 && cp <= 0x303E) ||
    (cp >= 0x3040 && cp <= 0x33FF) ||
    (cp >= 0x3400 && cp <= 0x4DBF) ||
    (cp >= 0x4E00 && cp <= 0xA4C6) ||
    (cp >= 0xA960 && cp <= 0xA97C) ||
    (cp >= 0xAC00 && cp <= 0xD7A3) ||
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0xFE10 && cp <= 0xFE19) ||
    (cp >= 0xFE30 && cp <= 0xFE4F) ||
    (cp >= 0xFF01 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    (cp >= 0x1B000 && cp <= 0x1B0FF) ||
    (cp >= 0x1F004 && cp <= 0x1F0CF) ||
    (cp >= 0x1F18F && cp <= 0x1F19A) ||
    (cp >= 0x1F200 && cp <= 0x1F2FF) ||
    (cp >= 0x1F300 && cp <= 0x1FAFF) ||
    (cp >= 0x20000 && cp <= 0x2FFFD) ||
    (cp >= 0x30000 && cp <= 0x3FFFD)
  );
}

function isZeroWidthCodePoint(cp) {
  return (
    cp === 0x200D ||
    (cp >= 0x0300 && cp <= 0x036F) ||
    (cp >= 0x1AB0 && cp <= 0x1AFF) ||
    (cp >= 0x1DC0 && cp <= 0x1DFF) ||
    (cp >= 0x20D0 && cp <= 0x20FF) ||
    (cp >= 0xFE00 && cp <= 0xFE0F) ||
    (cp >= 0xFE20 && cp <= 0xFE2F) ||
    (cp >= 0xE0100 && cp <= 0xE01EF)
  );
}

function charWidth(ch) {
  if (!ch) return 0;
  const cp = ch.codePointAt(0);
  if (cp === 9) return DEFAULT_SETTINGS.tabsize;
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0) || isZeroWidthCodePoint(cp)) return 0;
  if (isWideCodePoint(cp)) return 2;
  return 1;
}

function isEmojiVariationBase(cp) {
  return (
    cp === 0x00A9 || cp === 0x00AE ||
    cp === 0x203C || cp === 0x2049 ||
    cp === 0x2122 || cp === 0x2139 ||
    (cp >= 0x2194 && cp <= 0x21AA) ||
    (cp >= 0x231A && cp <= 0x231B) ||
    cp === 0x2328 || cp === 0x23CF ||
    (cp >= 0x23E9 && cp <= 0x23F3) ||
    (cp >= 0x23F8 && cp <= 0x23FA) ||
    cp === 0x24C2 ||
    (cp >= 0x25AA && cp <= 0x25AB) ||
    cp === 0x25B6 || cp === 0x25C0 ||
    (cp >= 0x25FB && cp <= 0x25FE) ||
    (cp >= 0x2600 && cp <= 0x27BF) ||
    (cp >= 0x2934 && cp <= 0x2935) ||
    (cp >= 0x2B05 && cp <= 0x2B55) ||
    cp === 0x3030 || cp === 0x303D ||
    cp === 0x3297 || cp === 0x3299
  );
}

function displayUnitAt(text, idx) {
  const cp = text.codePointAt(idx);
  if (cp == null) return { text: "", width: 0, length: 0 };
  let length = cp > 0xFFFF ? 2 : 1;
  let unit = String.fromCodePoint(cp);
  let width = charWidth(unit);
  const nextCp = text.codePointAt(idx + length);
  if (nextCp === 0xFE0F && isEmojiVariationBase(cp)) {
    unit += String.fromCodePoint(nextCp);
    length += 1;
    width = 2;
  }
  return { text: unit, width, length };
}

function displayWidth(text) {
  let width = 0;
  for (let i = 0; i < text.length;) {
    const unit = displayUnitAt(text, i);
    if (unit.length <= 0) break;
    width += unit.width;
    i += unit.length;
  }
  return width;
}

function displayWidthRangeAtLeast(text, start, end, minWidth) {
  let width = 0;
  let i = Math.max(0, start);
  const stop = Math.min(text.length, end);
  while (i < stop) {
    const cp = text.codePointAt(i);
    const charLen = cp > 0xFFFF ? 2 : 1;
    width += charWidth(String.fromCodePoint(cp));
    if (width >= minWidth) return true;
    i += charLen;
  }
  return false;
}

// Convert a screen-column offset (visualCol) into a string char-unit index,
// starting from startIdx (code-unit index) in line and walking forward.
// Snaps to the start of a wide character when the click lands on its right cell.
function visualColToCharIdx(line, startIdx, visualCol) {
  let col = 0;
  let i = startIdx;
  while (i < line.length) {
    if (col >= visualCol) break;
    const cp = line.codePointAt(i);
    const charLen = cp > 0xFFFF ? 2 : 1;
    const w = charWidth(String.fromCodePoint(cp));
    if (col + w > visualCol) break;
    col += w;
    i += charLen;
  }
  return Math.min(i, line.length);
}

// Find the leftmost char-unit index such that
// displayWidth(line.slice(result, cursorX)) < visibleCols.
// Used to compute scroll.x when the cursor scrolls off the right edge.
function charIdxForScrollRight(line, cursorX, visibleCols) {
  let col = 0;
  let i = cursorX;
  while (i > 0) {
    const prevI = (i >= 2 && line.charCodeAt(i - 1) >= 0xDC00 && line.charCodeAt(i - 1) <= 0xDFFF) ? i - 2 : i - 1;
    const w = charWidth(String.fromCodePoint(line.codePointAt(prevI)));
    if (col + w >= visibleCols) break;
    col += w;
    i = prevI;
  }
  return i;
}

function normalizeCharBoundary(line, idx) {
  idx = clamp(idx, 0, line.length);
  if (idx > 0 && idx < line.length) {
    const prev = line.charCodeAt(idx - 1);
    const cur = line.charCodeAt(idx);
    if (prev >= 0xD800 && prev <= 0xDBFF && cur >= 0xDC00 && cur <= 0xDFFF) return idx - 1;
  }
  return idx;
}

// --- Softwrap utilities (ported from Go internal/display/softwrap.go) ---

// Returns an array of code-unit indices where each visual row starts.
// breaks[0] === 0 always. breaks[k] is the start of visual row k within `line`.
// Tabs are treated as `tabsize` columns wide (consistent with the renderer).
// With wordwrap=true, breaks at word boundaries; with wordwrap=false, hard-wraps at bufWidth.
let _swCacheLine = null, _swCacheBufWidth = 0, _swCacheWordwrap = false, _swCacheTabsize = 4, _swCacheBreaks = null;
function softwrapBreaks(line, bufWidth, wordwrap, tabsize) {
  if (bufWidth <= 0) return [0];
  if (line === _swCacheLine && bufWidth === _swCacheBufWidth && wordwrap === _swCacheWordwrap && tabsize === _swCacheTabsize)
    return _swCacheBreaks;
  const breaks = [0];
  let visualX = 0;    // display col within current visual row
  let wordStart = 0;  // code-unit index of current word start
  let wordWidth = 0;  // accumulated display width of current word
  let i = 0;

  while (i < line.length) {
    const cp = line.codePointAt(i);
    const charLen = cp > 0xFFFF ? 2 : 1;
    const w = cp === 9 ? tabsize : charWidth(String.fromCodePoint(cp));

    wordWidth += w;
    const isWS = cp === 32 || cp === 9; // space or tab

    // Wordwrap: keep accumulating non-whitespace into current word unless
    // the word is already as wide as bufWidth (must break it eventually).
    if (wordwrap && !isWS && i + charLen < line.length && wordWidth < bufWidth) {
      i += charLen;
      continue;
    }

    // Word complete — wrap before it if it doesn't fit on this visual row.
    if (visualX + wordWidth > bufWidth && visualX > 0) {
      breaks.push(wordStart);
      visualX = 0;
    }

    visualX += wordWidth;
    i += charLen;
    wordStart = i;
    wordWidth = 0;

    // If we just filled the row exactly, next char starts a new visual row.
    if (visualX >= bufWidth && i < line.length) {
      breaks.push(i);
      visualX = 0;
    }
  }

  _swCacheLine = line; _swCacheBufWidth = bufWidth; _swCacheWordwrap = wordwrap; _swCacheTabsize = tabsize; _swCacheBreaks = breaks;
  return breaks;
}

// Returns how many visual rows `line` needs when rendered at `bufWidth`.
function softwrapRowCount(line, bufWidth, wordwrap, tabsize) {
  return softwrapBreaks(line, bufWidth, wordwrap, tabsize).length;
}

// Returns which visual sub-row (0-based) a given code-unit index falls in,
// given the precomputed breaks array for that line.
function softwrapRowOfCharIdx(breaks, charIdx) {
  let row = 0;
  for (let k = 1; k < breaks.length; k++) {
    if (breaks[k] > charIdx) break;
    row = k;
  }
  return row;
}

// Advance SLoc {line, row} forward by n visual rows.
function slocAdvanceN(lines, sloc, n, bufWidth, wordwrap, tabsize) {
  let { line, row } = sloc;
  while (n > 0 && line < lines.length) {
    const rc = softwrapRowCount(lines[line] ?? "", bufWidth, wordwrap, tabsize);
    const available = rc - row;
    if (n < available) { row += n; n = 0; }
    else { n -= available; line++; row = 0; }
  }
  return { line: Math.min(line, Math.max(0, lines.length - 1)), row };
}

// Retreat SLoc {line, row} backward by n visual rows.
function slocRetreatN(lines, sloc, n, bufWidth, wordwrap, tabsize) {
  let { line, row } = sloc;
  while (n > 0) {
    if (n <= row) { row -= n; n = 0; }
    else {
      n -= row + 1;
      line--;
      if (line < 0) { line = 0; row = 0; break; }
      row = softwrapRowCount(lines[line] ?? "", bufWidth, wordwrap, tabsize) - 1;
    }
  }
  return { line, row };
}

// Count visual rows from s1 to s2 (s1 must be <= s2).
function slocDiff(lines, s1, s2, bufWidth, wordwrap, tabsize) {
  let n = 0;
  let s = { ...s1 };
  while (s.line < s2.line || (s.line === s2.line && s.row < s2.row)) {
    if (s.line < s2.line) {
      const rc = softwrapRowCount(lines[s.line] ?? "", bufWidth, wordwrap, tabsize);
      n += rc - s.row;
      s = { line: s.line + 1, row: 0 };
    } else {
      n += s2.row - s.row;
      break;
    }
  }
  return n;
}

function takeDisplay(text, maxWidth) {
  let out = "";
  let width = 0;
  for (const ch of text) {
    const w = charWidth(ch);
    if (width + w > maxWidth) break;
    out += ch === "\t" ? " ".repeat(DEFAULT_SETTINGS.tabsize) : ch;
    width += w;
  }
  return out;
}

function keyboardEventJson(event) {
  const target = event?.target;
  return {
    type: String(event?.type ?? ""),
    key: String(event?.key ?? ""),
    code: String(event?.code ?? ""),
    raw: String(event?.raw ?? ""),
    ctrlKey: Boolean(event?.ctrlKey),
    shiftKey: Boolean(event?.shiftKey),
    altKey: Boolean(event?.altKey),
    metaKey: Boolean(event?.metaKey),
    repeat: Boolean(event?.repeat),
    defaultPrevented: Boolean(event?.defaultPrevented),
    target: {
      id: String(target?.id ?? ""),
      tagName: String(target?.tagName ?? ""),
      className: String(target?.className ?? ""),
      value: String(target?.value ?? ""),
    },
  };
}

function tuiKeyEventForFront(event, target, type) {
  const sequence = String(event?.key ?? "");
  const parts = sequence.split("-");
  const aliases = {
    enter: "Enter",
    escape: "Escape",
    tab: "Tab",
    backtab: "Tab",
    backspace: "Backspace",
    delete: "Delete",
    left: "ArrowLeft",
    right: "ArrowRight",
    up: "ArrowUp",
    down: "ArrowDown",
    home: "Home",
    end: "End",
    pageup: "PageUp",
    pagedown: "PageDown",
    space: " ",
  };
  let base = parts.at(-1) || sequence;
  if (sequence === "backtab") base = "tab";
  const raw = String(event?.raw ?? "");
  const key = aliases[base] ?? (sequence === raw && [...raw].length === 1 ? raw : base);
  let defaultPrevented = false;
  let propagationStopped = false;
  const result = {
    type,
    key,
    raw,
    ctrlKey: parts.includes("ctrl"),
    altKey: parts.includes("alt"),
    shiftKey: sequence === "backtab" || parts.includes("shift"),
    metaKey: parts.includes("meta"),
    repeat: false,
    target,
    currentTarget: target,
    get defaultPrevented() { return defaultPrevented; },
    get propagationStopped() { return propagationStopped; },
    preventDefault() { defaultPrevented = true; },
    stopPropagation() { propagationStopped = true; },
  };
  Object.defineProperty(result, "toJSON", {
    configurable: true,
    value() { return keyboardEventJson(this); },
  });
  return result;
}

function indexedMdcuiFenceBlockAtLine(buffer, lineIndex) {
  const declarations = buffer?._mdcuiFenceEvents;
  if (!isMdcuiEncoding(buffer?.encoding) || declarations?.size === 0) return null;
  let cache = buffer._mdcuiFenceBlockIndex;
  // Render/reopen replaces the lines array; structural selector edits explicitly
  // clear this cache. Ordinary character edits leave block boundaries unchanged.
  if (
    !cache
    || cache.lines !== buffer.lines
    || cache.lineCount !== buffer.lines.length
    || cache.declarations !== declarations
  ) {
    cache = {
      lines: buffer.lines,
      lineCount: buffer.lines.length,
      declarations,
      blocks: buildTuiBlockIndex(buffer.lines, declarations),
    };
    buffer._mdcuiFenceBlockIndex = cache;
  }
  return findTuiBlockInIndex(cache.blocks, lineIndex);
}

function parseArgs(argv) {
  const flags = {
    version: false,
    options: false,
    help: false,
    clean: false,
    check: false,
    outline: false,
    cat: false,
    wui: false,
    printUi: false,
    docs: false,
    exportReadme: false,
    exportCdpMaze: false,
    changelog: false,
    testapp: false,
    demoList: false,
    demo: null,
    overwriteDemo: false,
    allowUrl: false,
    buildExe: false,
    buildFor: "",
    configDir: "",
    debug: false,
    profile: false,
    plugin: "",
    cdpMaze: false,
    cdpPort: 0,
    cdpAddress: "",
    cdpAllowOrigins: "",
    kittyMode: kittyModeFromEnvironment(process.env.JSMDCUI_KITTY_MODE),
    settings: new Map(),
  };
  const files = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-version" || arg === "--version" || arg === "-V") flags.version = true;
    else if (arg === "-options") flags.options = true;
    else if (arg === "-help" || arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "-clean") flags.clean = true;
    else if (arg === "--check") flags.check = true;
    else if (arg === "--outline") flags.outline = true;
    else if (arg === "--cat" || arg === "-cat" || arg === "--ccat" || arg === "-ccat" || arg === "--bat" || arg === "-bat" || arg === "--glow" || arg === "-glow") flags.cat = true;
    else if (arg === "--wui") flags.wui = true;
    else if (arg === "--print-ui") flags.printUi = true;
    else if (arg === "--xxd" || arg === "--hexdump") {
      flags.cat = true;
      flags.settings.set("encoding", "hex3");
    }
    else if (arg === "--hex3") {
      flags.settings.set("encoding", "hex3");
    }
    else if (arg === "--hex3gz") {
      flags.settings.set("encoding", "hex3gz");
    }
    else if (arg === "--hex3zst") {
      flags.settings.set("encoding", "hex3zst");
    }
    else if (arg === "--edit") {
      flags.settings.set("encoding", "utf-8");
    }
    else if (arg === "--mdcui" || arg === "--tui") {
      flags.settings.set("encoding", "mdcui");
    }
    else if (arg === "--docs" || arg === "--readme") flags.docs = true;
    else if (arg === "--export-readme") flags.exportReadme = true;
    else if (arg === "--export-cdp-maze") flags.exportCdpMaze = true;
    else if (arg === "--changelog") flags.changelog = true;
    else if (arg === "--testapp.md") flags.testapp = true;
    else if (arg === "--demo-list") flags.demoList = true;
    else if (arg === "--overwrite-demo") flags.overwriteDemo = true;
    else if (arg === "--cdp-maze") {
      flags.cdpMaze = true;
      flags.demo = { option: arg, filename: "maze.md", asset: "demos/maze.md" };
    }
    else if (arg === "--demo") {
      flags.demo = { option: arg, filename: "testapp.md", asset: "testapp.md" };
    }
    else if (arg.startsWith("--demo-")) {
      const name = arg.slice("--demo-".length);
      flags.demo = isValidDemoName(name)
        ? { option: arg, filename: `${name}.md`, asset: `demos/${name}.md` }
        : {
            option: arg,
            error:
              "demo filename must start with a Unicode letter or number "
              + "and contain only Unicode letters, numbers, dots, underscores, "
              + "or hyphens; whitespace is not allowed",
          };
    }
    else if (arg === "--allow-url") flags.allowUrl = true;
    else if (arg === "--kitty") flags.kittyMode = "extended";
    else if (arg === "--kitty-compat") flags.kittyMode = "compat";
    else if (arg === "--build-exe") flags.buildExe = true;
    else if (arg === "--build-for") flags.buildFor = argv[++i] ?? "";
    else if (arg === "-debug") flags.debug = true;
    else if (arg === "-profile" || arg === "--profile") flags.profile = true;
    else if (arg === "-config-dir") flags.configDir = argv[++i] ?? "";
    else if (arg === "-plugin") flags.plugin = argv[++i] ?? "";
    else if (arg.startsWith("--remote-debugging-port=")) {
      flags.cdpPort = parseInt(arg.slice("--remote-debugging-port=".length)) || 9222;
    } else if (arg === "--remote-debugging-port") {
      flags.cdpPort = parseInt(argv[++i]) || 9222;
    } else if (arg.startsWith("--remote-debugging-address=")) {
      flags.cdpAddress = arg.slice("--remote-debugging-address=".length);
    } else if (arg === "--remote-debugging-address") {
      flags.cdpAddress = argv[++i] ?? "";
    } else if (arg.startsWith("--remote-allow-origins=")) {
      flags.cdpAllowOrigins = arg.slice("--remote-allow-origins=".length);
    } else if (arg === "--remote-allow-origins") {
      flags.cdpAllowOrigins = argv[++i] ?? "";
    } else if (arg.startsWith("-") && arg.length > 1 && i + 1 < argv.length) {
      flags.settings.set(arg.slice(1), argv[++i]);
    } else {
      files.push(arg);
    }
  }

  if (flags.cdpMaze && !flags.cdpPort) flags.cdpPort = 9222;

  return { flags, files };
}

function isValidDemoName(name) {
  return /^[\p{L}\p{N}][\p{L}\p{N}\p{M}._-]*$/u.test(String(name));
}

function demoNameFromMarkdownBasename(filename) {
  const value = String(filename);
  if (!value.endsWith(".md")) return "";
  const name = value.slice(0, -".md".length);
  return isValidDemoName(name) ? name : "";
}

function usage() {
  return [
    `Usage:
  ${pkg.name} [OPTIONS] [FILE]
    
Execute .md:
  ${pkg.name} [FILE.md]
  ${pkg.name} --wui [FILE.md]
Develop .md:
  ${pkg.name} --edit [FILE.md]
  ${pkg.name} --check <FILE.md>
  ${pkg.name} --outline <FILE.md>

Modes:
  --tui, --mdcui, -encoding mdcui
    .md files use this by default
    Execute a Markdown App
      Create a Terminal UI
    Generate & overwrite
      .front.js, .back.js, 
      .html, -rpc.js, -server.js
      beside the .md file
      
  --wui [FILE.md]
    Execute a Markdown App
      Create a Web UI
      Start a web server
    Generate & overwrite 
      .front.js, .back.js, 
      .html, -rpc.js, -server.js
      beside the .md file
      
    Without FILE.md, 
    default to ./testapp.md
      If ./testapp.md is missing, write the bundled demo there first
    Combine with any --demo option to start that demo as a Web UI
      
  --print-ui
    Must be combined with --wui
    Print the generated TUI, raw ANSI, and HTML before starting the server
    
  --kitty
    Display Markdown images with Kitty graphics and the jsgotty MIME extension
  --kitty-compat
    Display Markdown images with Kitty graphics without the non-standard MIME U field

  JSMDCUI_KITTY_MODE=off|compat|extended
    Set the Kitty image mode without command-line flags; explicit Kitty flags override it
      
  --edit
    Open files as editable UTF-8 text
    Override .md mdcui detection
    
  --check <FILE.md>
    Check heading and fenced-block IDs for collisions, print details, and exit
    Exits 0 when IDs are unique, 1 on collisions, and 2 on usage/read errors

  --outline <FILE.md>
    Print every selectable ID and exit
    Headings use an indented "-" tree; fenced blocks use a top-level "+"
      
  --cat, --ccat, --bat, --glow
      Render file(s) and write to stdout, then exit (.md uses mdcui/createTui)
      A local .md file also writes or overwrites five generated files beside it
  --xxd, --hexdump
      Hex3 dump file(s) and write to stdout (same as --cat -encoding hex3)
  --hex3, --hex3gz, --hex3zst
      Set -encoding hex3, hex3gz, or hex3zst for this session
      hex3 shows raw bytes; gz/zst variants compress the same hex3 view

Settings:
  -SETTING VALUE
      Override one editor setting for this run.
  -options
      List all setting names and defaults, then exit.

CDP(Chrome DevTools Protocol):
  --cdp-maze
      Open the maze demo, start CDP on localhost:9222, and solve it automatically
  --export-cdp-maze
      Write or overwrite ./cdp-maze.js with the bundled CDP maze solver & exit
      
  --remote-debugging-port=PORT
      Start CDP (Chrome DevTools Protocol) server on PORT at launch
  --remote-debugging-address=ADDRESS
      Bind CDP server to ADDRESS (default: 127.0.0.1); use 0.0.0.0 for all interfaces
  --remote-allow-origins=ORIGINS
      Allow comma-separated browser WebSocket origins; no browser origins are allowed by default

Information:
  --help, -h, -help
      Show this help & exit
  --version, -V, -version
      Show version+backend info & exit
      
  --readme, --docs
      Show ${pkg.name}'s README.md & exit
  --export-readme
      Write or overwrite ./README.md with the bundled README.md & exit
      
  --changelog
      Show CHANGELOG.md & exit
  --profile, -profile
      Print startup performance profile and exit

Demo:
  --testapp.md
      Print the bundled testapp.md to stdout & exit
  --demo-list
      List the bundled demos & exit
      
  --demo
      Execute an existing ./testapp.md
      Or write the bundled demo if missing
      Open it in the TUI and write 5 generated files beside it
      
  --demo-<filename>
      Execute an existing <filename>.md
      Or write the bundled demos/<filename>.md if missing
      Open it in the TUI and write 5 generated files beside it
      For example: --demo-select, --demo-todo, or --demo-todo-zh

  --demo-reader
      Text-to-speech reader
      
  --overwrite-demo
      Overwrite an existing local demo with the bundled copy; combine with any --demo option
      
Remote Markdown:
  --allow-url
      Download HTTP(S) Markdown and, with Kitty mode, its HTTP(S) images; allow its code to run

Experimental single-exe:
  --build-md-exe <file.md> [BUN_ARGS...]
      Build with <file.md> embedded as global.MDCUI_MAIN & exit
  --build-md-for <platform> <file.md> [BUN_ARGS...]
      Build for <platform> with <file.md> embedded & exit
      
  --build-exe [BUN_ARGS...]
      Build a Bun single-file executable & exit
  --build-for <target> [BUN_ARGS...]
      Build a Bun single-file executable for target & exit
  
  [BUN_ARGS...]
      --define MDCUI_OVERWRITE_DEMO=1 
      --define global.MDCUI_MAIN=myapp.md
      More info in --readme
      https://bun.com/docs/bundler/executables
`
  ].join("\n");
}


function parseInput(args) {
  const files = [];
  const command = {
    startCursor: { line: -1, subRow: 0, col: 1 },
    searchRegex: "",
    searchAfterStart: false,
  };
  let posIndex = -1;
  let searchIndex = -1;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const pos = arg.match(/^\+(-?\d+(?:\.\d+)?)(?::(-?\d+))?$/);
    const search = arg.match(/^\+\/(.+)$/);
    const cursorFile = arg.match(/^(.+):(-?\d+(?:\.\d+)?)(?::(-?\d+))?$/);

    if (pos) {
      command.startCursor = parseLineCol(`${pos[1]}${pos[2] ? `:${pos[2]}` : ""}`);
      posIndex = i;
    } else if (search) {
      command.searchRegex = search[1];
      searchIndex = i;
    } else if (DEFAULT_SETTINGS.parsecursor && cursorFile && existsSync(cursorFile[1])) {
      files.push(cursorFile[1]);
      command.startCursor = parseLineCol(`${cursorFile[2]}${cursorFile[3] ? `:${cursorFile[3]}` : ""}`);
      posIndex = i;
    } else {
      files.push(arg);
    }
  }

  command.searchAfterStart = searchIndex > posIndex;
  return { files, command };
}

class BufferModel {
  get searchPattern() { return this._searchPattern ?? ""; }
  set searchPattern(v) { this._searchPattern = v ?? ""; this.searchMatches?.clear(); }

  constructor({ path = "", text = "", command = {}, type = "default", readonly = false, modTimeMs = null, encoding = DEFAULT_SETTINGS.encoding, ansiStyleLines = null, ansiText = null, sourceText = null, tuiSourceText = null, mdcuiImages = null, mdcuiRenderWidth = 0, preRenderHeadingData = null } = {}) {
    this.path = path;
    this.type = type;
    this.name = path ? basename(path) : "No name";
    this.fileformat = detectFileFormat(text, DEFAULT_SETTINGS.fileformat);
    this.encoding = normalizeEncodingLabel(encoding);
    readonly = Boolean(readonly || isMdcuiEncoding(this.encoding));
    this.lines = normalizeBufferText(text).split("\n");
    if (this.lines.length === 0) this.lines = [""];
    this._ansiStyleLines = ansiStyleLines;
    this._mdcuiAnsiText = isMdcuiEncoding(this.encoding) ? String(ansiText ?? "") : null;
    this._mdcuiSourceText = isMdcuiEncoding(this.encoding) ? String(sourceText ?? text) : null;
    this._mdcuiTuiSourceText = isMdcuiEncoding(this.encoding) ? String(tuiSourceText ?? sourceText ?? text) : null;
    this._mdcuiFenceEvents = isMdcuiEncoding(this.encoding) ? fenceEventMap(sourceText ?? tuiSourceText ?? text) : new Map();
    this._mdcuiImages = isMdcuiEncoding(this.encoding) ? (mdcuiImages ?? []) : [];
    this._mdcuiRenderWidth = Math.trunc(Number(mdcuiRenderWidth) || 0);
    this._parseAnsiStyledText = parseAnsiStyledText;
    if (isMdcuiEncoding(this.encoding)) {
      indexTuiHeadingRows(this);
      refreshTuiLinkIndex(this, { resetCatalog: true });
      applyPreRenderHeadingData(this, preRenderHeadingData);
    }
    this._useBundledMdcuiModules = false;
    this.cursor = { x: 0, y: 0 };
    this.scroll = { x: 0, y: 0, row: 0 };
    this._modified = false;
    this._backupRequested = false;
    this._backupRevision = 0;
    Object.defineProperty(this, "modified", {
      configurable: true,
      enumerable: true,
      get: () => this._modified,
      set: (value) => this.setModified(value),
    });
    this.readonly = readonly;
    this.modTimeMs = modTimeMs;
    this.reloadDisabled = false;
    this.message = "";
    this.allowCursorOffscreen = false;
    this.acHas = false;
    this.acSuggestions = [];
    this.acCompletions = [];
    this.acCurIdx = -1;
    this.searchMatches = new Map();
    this.searchPattern = "";
    this.command = command;
    this.filetype = "unknown";
    this.syntaxDefinition = null;
    this.highlighter = null;
    this._highlightCache = null;
    this.undoStack = [];
    this.redoStack = [];
    this._undoSerial = 0;
    this._savedSerial = 0;
    this.Settings = {
      filetype: "unknown",
      cursorline: DEFAULT_SETTINGS.cursorline,
      diffgutter: DEFAULT_SETTINGS.diffgutter,
      tabstospaces: DEFAULT_SETTINGS.tabstospaces,
      tabsize: DEFAULT_SETTINGS.tabsize,
      ruler: DEFAULT_SETTINGS.ruler,
      relativeruler: DEFAULT_SETTINGS.relativeruler,
      matchbrace: DEFAULT_SETTINGS.matchbrace,
      matchbraceleft: DEFAULT_SETTINGS.matchbraceleft,
      matchbracestyle: DEFAULT_SETTINGS.matchbracestyle,
      savecursor: DEFAULT_SETTINGS.savecursor,
      backup: DEFAULT_SETTINGS.backup,
      backupdir: DEFAULT_SETTINGS.backupdir,
      permbackup: DEFAULT_SETTINGS.permbackup,
      softwrap: DEFAULT_SETTINGS.softwrap,
      wordwrap: DEFAULT_SETTINGS.wordwrap,
      pageoverlap: DEFAULT_SETTINGS.pageoverlap,
      scrollmargin: DEFAULT_SETTINGS.scrollmargin,
      reload: DEFAULT_SETTINGS.reload,
      eofnewline: DEFAULT_SETTINGS.eofnewline,
      fileformat: this.fileformat,
      hltrailingws: DEFAULT_SETTINGS.hltrailingws,
      hltaberrors: DEFAULT_SETTINGS.hltaberrors,
      colorcolumn: DEFAULT_SETTINGS.colorcolumn,
      showchars: DEFAULT_SETTINGS.showchars,
      indentchar: DEFAULT_SETTINGS.indentchar,
      encoding: this.encoding,
      readonly,
    };
    this.Path = path;
    this.AbsPath = path;
    this.Type = { Scratch: type !== "default", Kind: 0, Readonly: readonly };

    if (commandHasStartCursor(command)) {
      if (command.startCursor.subRow > 0) {
        this.gotoLoc(command.startCursor.line, 1);
        this._pendingVisualGoto = { subRow: command.startCursor.subRow, col: command.startCursor.col };
      } else {
        this.gotoLoc(command.startCursor.line, command.startCursor.col);
      }
    }
    if (command.searchRegex) this.search(command.searchRegex, command.searchAfterStart);
  }

  setModified(value = true) {
    const next = Boolean(value);
    const prev = this._modified;
    this._modified = next;
    if (next) {
      this._backupRequested = true;
      this._backupRevision++;
    } else {
      this._backupRequested = false;
      if (prev && this._configDir) removeBackup(this, this._configDir);
    }
  }

  static async fromFile(path, command, context = {}) {
    let text = "";
    let readonly = false;
    let modTimeMs = null;
    let encoding = context.inputEncoding ?? context.config?.globalSettings?.encoding ?? DEFAULT_SETTINGS.encoding;
    let ansiStyleLines = null;
    let ansiText = null;
    let sourceText = null;
    let tuiSourceText = null;
    let mdcuiRenderWidth = 0;
    let mdcuiImages = null;
    let preRenderHeadingData = null;
    if (existsSync(path)) {
      const info = statSync(path);
      if (info.isDirectory()) throw new Error(`${path} is a directory`);
      readonly = !canWritePath(path);
      modTimeMs = info.mtimeMs;
      const decoded = await readTextFileWithEncoding(path, encoding, !context.encodingExplicit);
      text = decoded.text;
      encoding = decoded.encoding;
      ansiStyleLines = decoded.ansiStyleLines ?? null;
      ansiText = decoded.ansiText ?? null;
      sourceText = decoded.sourceText ?? null;
      tuiSourceText = decoded.tuiSourceText ?? null;
      mdcuiRenderWidth = decoded.mdcuiRenderWidth ?? 0;
      mdcuiImages = decoded.mdcuiImages ?? null;
      preRenderHeadingData = decoded.preRenderHeadingData ?? null;
      if (isMdcuiEncoding(encoding)) readonly = true;
    }
    const buffer = new BufferModel({ path, text, command, readonly, modTimeMs, encoding, ansiStyleLines, ansiText, sourceText, tuiSourceText, mdcuiImages, mdcuiRenderWidth, preRenderHeadingData });
    buffer._configDir = context?.config?.configDir ?? null;
    attachSyntax(buffer, context, path, text);
    return buffer;
  }

  line() {
    return this.lines[this.cursor.y] ?? "";
  }

  isReadonly() {
    return isReadonlyBuffer(this);
  }

  isEditLocked() {
    return isEditLockedBuffer(this);
  }

  ensureCursor() {
    this.cursor.y = clamp(this.cursor.y, 0, this.lines.length - 1);
    this.cursor.x = normalizeCharBoundary(this.line(), this.cursor.x);
  }

  invalidateHighlightFrom(lineNo = 0, options = {}) {
    this._editRev = (this._editRev ?? 0) + 1;
    if (options.force) this.searchMatches?.clear();
    else this.searchMatches?.delete(lineNo);
    invalidateHighlightFrom(this, lineNo, options);
  }

  insert(text) {
    if (this.isEditLocked() && !canEditMdcuiAtCursor(this)) return false;
    if (isMdcuiEncoding(this.encoding) && /[\r\n]/.test(String(text))) return false;
    for (const ch of text) {
      if (ch === "\r" || ch === "\n") this.newline(false);
      else if (ch >= " " || ch === "\t") this.insertChar(ch);
    }
    return true;
  }

  insertChar(ch) {
    if (this.isEditLocked() && !canEditMdcuiAtCursor(this)) return false;
    if (ch === "\t" && DEFAULT_SETTINGS.tabstospaces) ch = " ".repeat(DEFAULT_SETTINGS.tabsize);
    const line = this.line();
    this.lines[this.cursor.y] = line.slice(0, this.cursor.x) + ch + line.slice(this.cursor.x);
    syncMdcuiAnsiTextForCharEdit(this, this.cursor.y, this.cursor.x, this.cursor.x, ch);
    this.invalidateHighlightFrom(this.cursor.y);
    this.cursor.x += ch.length;
    this.modified = true;
    return true;
  }

  newline(autoindent = true) {
    if (isMdcuiEncoding(this.encoding)) return false;
    if (this.isEditLocked()) return false;
    const line = this.line();
    const left = line.slice(0, this.cursor.x);
    const right = line.slice(this.cursor.x);
    this.lines[this.cursor.y] = left;
    let indent = "";
    if (autoindent && (this.Settings?.autoindent ?? true)) {
      indent = line.match(/^(\s*)/)?.[1] ?? "";
    }
    this.lines.splice(this.cursor.y + 1, 0, indent + right);
    this.invalidateHighlightFrom(this.cursor.y, { force: true });
    this.cursor.y++;
    this.cursor.x = indent.length;
    this.modified = true;
    return true;
  }

  backspace() {
    if (this.isEditLocked() && !canEditMdcuiAtCursor(this)) return false;
    const mdcuiPrefixLength = mdcuiEditablePrefixLength(this);
    if (mdcuiPrefixLength > 0 && this.cursor.x <= mdcuiPrefixLength) return false;
    if (this.cursor.x > 0) {
      const line = this.line();
      let start = this.cursor.x - 1;
      // if the code unit before cursor is a low surrogate, step back one more
      const code = line.charCodeAt(start);
      if (code >= 0xDC00 && code <= 0xDFFF && start > 0) start--;
      this.lines[this.cursor.y] = line.slice(0, start) + line.slice(this.cursor.x);
      syncMdcuiAnsiTextForCharEdit(this, this.cursor.y, start, this.cursor.x, "");
      this.invalidateHighlightFrom(this.cursor.y);
      this.cursor.x = start;
      this.modified = true;
      return true;
    }
    if (this.cursor.y > 0) {
      const prevLen = this.lines[this.cursor.y - 1].length;
      this.lines[this.cursor.y - 1] += this.line();
      this.lines.splice(this.cursor.y, 1);
      this.invalidateHighlightFrom(this.cursor.y - 1, { force: true });
      this.cursor.y--;
      this.cursor.x = prevLen;
      this.modified = true;
      return true;
    }
    return false;
  }

  deleteForward() {
    if (this.isEditLocked() && !canEditMdcuiAtCursor(this)) return false;
    const line = this.line();
    if (this.cursor.x < line.length) {
      const cp = line.codePointAt(this.cursor.x);
      const charLen = cp > 0xFFFF ? 2 : 1;
      this.lines[this.cursor.y] = line.slice(0, this.cursor.x) + line.slice(this.cursor.x + charLen);
      syncMdcuiAnsiTextForCharEdit(this, this.cursor.y, this.cursor.x, this.cursor.x + charLen, "");
      this.invalidateHighlightFrom(this.cursor.y);
      this.modified = true;
      return true;
    } else if (isMdcuiEncoding(this.encoding)) {
      return false;
    } else if (this.cursor.y < this.lines.length - 1) {
      this.lines[this.cursor.y] += this.lines[this.cursor.y + 1];
      this.lines.splice(this.cursor.y + 1, 1);
      this.invalidateHighlightFrom(this.cursor.y, { force: true });
      this.modified = true;
      return true;
    }
    return false;
  }

  moveLeft() {
    if (this.cursor.x > 0) {
      this.cursor.x--;
      // step over low surrogate to keep cursor on a valid code point boundary
      const code = this.line().charCodeAt(this.cursor.x);
      if (code >= 0xDC00 && code <= 0xDFFF && this.cursor.x > 0) this.cursor.x--;
    } else if (this.cursor.y > 0) {
      this.cursor.y--;
      this.cursor.x = this.line().length;
    }
  }

  moveRight() {
    const line = this.line();
    if (this.cursor.x < line.length) {
      const cp = line.codePointAt(this.cursor.x);
      this.cursor.x += cp > 0xFFFF ? 2 : 1;
    } else if (this.cursor.y < this.lines.length - 1) {
      this.cursor.y++;
      this.cursor.x = 0;
    }
  }

  moveUp() {
    this.cursor.y--;
    this.ensureCursor();
  }

  moveDown() {
    this.cursor.y++;
    this.ensureCursor();
  }

  moveHome() {
    this.cursor.x = 0;
  }

  moveEnd() {
    this.cursor.x = this.line().length;
  }

  _startOfTextX() {
    const line = this.line();
    let x = 0;
    while (x < line.length && (line[x] === ' ' || line[x] === '\t')) x++;
    return x;
  }

  moveStartOfText() {
    this.cursor.x = this._startOfTextX();
  }

  moveStartOfTextToggle() {
    const sotX = this._startOfTextX();
    this.cursor.x = (this.cursor.x === sotX) ? 0 : sotX;
  }

  moveStartOfBuffer() {
    this.cursor = { x: 0, y: 0 };
  }

  moveEndOfBuffer() {
    const y = Math.max(0, this.lines.length - 1);
    this.cursor = { x: this.lines[y]?.length ?? 0, y };
  }

  paragraphPrevious() {
    let line = this.cursor.y;
    // Skip to the first non-empty line going up
    while (line > 0 && (this.lines[line] ?? "").length === 0) line--;
    // Find first empty line going up
    for (; line > 0; line--) {
      if ((this.lines[line] ?? "").length === 0) {
        this.cursor = { x: 0, y: line };
        return;
      }
    }
    this.cursor = { x: 0, y: 0 };
  }

  paragraphNext() {
    let line = this.cursor.y;
    // Skip to the first non-empty line going down
    while (line < this.lines.length - 1 && (this.lines[line] ?? "").length === 0) line++;
    // Find first empty line going down
    for (line++; line < this.lines.length; line++) {
      if ((this.lines[line] ?? "").length === 0) {
        this.cursor = { x: 0, y: line };
        return;
      }
    }
    const y = this.lines.length - 1;
    this.cursor = { x: this.lines[y]?.length ?? 0, y };
  }

  moveWordRight() {
    const line = this.line();
    if (this.cursor.x >= line.length) {
      if (this.cursor.y < this.lines.length - 1) { this.cursor.y++; this.cursor.x = 0; }
      return;
    }
    let x = this.cursor.x;
    while (x < line.length && !isWordChar(line[x])) x++;
    while (x < line.length && isWordChar(line[x])) x++;
    this.cursor.x = x;
  }

  moveWordLeft() {
    if (this.cursor.x === 0) {
      if (this.cursor.y > 0) { this.cursor.y--; this.cursor.x = this.lines[this.cursor.y].length; }
      return;
    }
    const line = this.line();
    let x = this.cursor.x - 1;
    while (x > 0 && !isWordChar(line[x - 1])) x--;
    while (x > 0 && isWordChar(line[x - 1])) x--;
    this.cursor.x = x;
  }

  _historyState() {
    return {
      lines: this.lines.slice(),
      cursor: { ...this.cursor },
      serial: this._undoSerial,
      ansiStyleLines: Array.isArray(this._ansiStyleLines)
        ? this._ansiStyleLines.map((line) => Array.isArray(line) ? line.slice() : line)
        : this._ansiStyleLines,
      mdcuiAnsiText: this._mdcuiAnsiText,
      mdcuiImages: Array.isArray(this._mdcuiImages)
        ? this._mdcuiImages.map((image) => ({ ...image }))
        : this._mdcuiImages,
      headingTaskListAnchors: this._mdcuiHeadingTaskListAnchors instanceof Map
        ? new Map([...this._mdcuiHeadingTaskListAnchors].map(([key, value]) => [key, { ...value }]))
        : this._mdcuiHeadingTaskListAnchors,
    };
  }

  _restoreHistoryState(state) {
    this.lines = state.lines;
    this.cursor = { ...state.cursor };
    this._undoSerial = state.serial ?? 0;
    this._ansiStyleLines = state.ansiStyleLines;
    this._mdcuiAnsiText = state.mdcuiAnsiText;
    this._mdcuiImages = state.mdcuiImages;
    this._mdcuiHeadingTaskListAnchors = state.headingTaskListAnchors;
    this._mdcuiFenceBlockIndex = null;
    this._mdcuiControlBlockIndex = null;
  }

  pushUndo(force = false) {
    if (!force && this.isEditLocked() && !canEditMdcuiAtCursor(this)) return;
    this.undoStack.push(this._historyState());
    this._undoSerial = (this._undoSerial ?? 0) + 1;
    if (this.undoStack.length > 500) this.undoStack.shift();
    this.redoStack = [];
  }

  undo() {
    if (this.isEditLocked() && !isMdcuiEncoding(this.encoding)) return false;
    if (!this.undoStack.length) return false;
    this.redoStack.push(this._historyState());
    const s = this.undoStack.pop();
    this._restoreHistoryState(s);
    this.invalidateHighlightFrom(0, { force: true });
    this.modified = this._undoSerial !== this._savedSerial;
    return true;
  }

  redo() {
    if (this.isEditLocked() && !isMdcuiEncoding(this.encoding)) return false;
    if (!this.redoStack.length) return false;
    this.undoStack.push(this._historyState());
    const s = this.redoStack.pop();
    this._restoreHistoryState(s);
    this.invalidateHighlightFrom(0, { force: true });
    this.modified = this._undoSerial !== this._savedSerial;
    return true;
  }

  page(delta, amount) {
    this.cursor.y += delta * Math.max(1, amount);
    this.ensureCursor();
  }

  gotoLine(line) {
    this.gotoLoc(line, 1);
  }

  gotoLoc(line, col = 1) {
    let targetLine = Number(line);
    let targetCol = Number(col);
    if (!Number.isFinite(targetLine)) throw new Error("Invalid line number");
    if (!Number.isFinite(targetCol)) throw new Error("Invalid column number");
    if (targetLine < 0) targetLine = this.lines.length + 1 + targetLine;
    const y = clamp(Math.trunc(targetLine) - 1, 0, this.lines.length - 1);
    const x = clamp(Math.trunc(targetCol) - 1, 0, this.lines[y]?.length ?? 0);
    this.cursor = { x, y };
    this.ensureCursor();
  }

  search(pattern, afterStart = true) {
    this.searchPattern = pattern;
    const ignoreCase = this.Settings?.ignorecase ?? true;
    let re;
    try { re = new RegExp(pattern, ignoreCase ? "i" : ""); } catch { re = null; }
    const start = afterStart ? this.cursor.y : 0;
    for (let pass = 0; pass < 2; pass++) {
      const from = pass === 0 ? start : 0;
      const to   = pass === 0 ? this.lines.length : start;
      for (let y = from; y < to; y++) {
        const line = this.lines[y];
        const idx = re ? line.search(re) : line.indexOf(pattern);
        if (idx >= 0) {
          this.cursor = { x: idx, y };
          this.message = `Found: ${pattern}`;
          return true;
        }
      }
    }
    this.message = `Not found: ${pattern}`;
    return false;
  }

  searchNext() {
    if (!this.searchPattern) { this.message = "No search pattern"; return false; }
    const ignoreCase = this.Settings?.ignorecase ?? true;
    let re;
    try { re = new RegExp(this.searchPattern, ignoreCase ? "i" : ""); } catch { re = null; }
    const origY = this.cursor.y;
    const origX = this.cursor.x;
    for (let pass = 0; pass < 2; pass++) {
      const fromY = pass === 0 ? origY : 0;
      const toY   = pass === 0 ? this.lines.length : origY + 1;
      for (let y = fromY; y < toY; y++) {
        const line = this.lines[y];
        const fromX = (y === origY && pass === 0) ? origX + 1 : 0;
        const sub = line.slice(fromX);
        const idx = re ? sub.search(re) : sub.indexOf(this.searchPattern);
        if (idx >= 0) {
          this.cursor = { x: fromX + idx, y };
          this.message = `Found: ${this.searchPattern}`;
          return true;
        }
      }
    }
    this.message = `Not found: ${this.searchPattern}`;
    return false;
  }

  searchPrev() {
    if (!this.searchPattern) { this.message = "No search pattern"; return false; }
    const ignoreCase = this.Settings?.ignorecase ?? true;
    let re;
    try { re = new RegExp(this.searchPattern, ignoreCase ? "i" : ""); } catch { re = null; }
    const origY = this.cursor.y;
    const origX = this.cursor.x;
    for (let pass = 0; pass < 2; pass++) {
      const fromY = pass === 0 ? origY : this.lines.length - 1;
      const toY   = pass === 0 ? -1   : origY - 1;
      for (let y = fromY; y > toY; y--) {
        const line = this.lines[y];
        const sub = (y === origY && pass === 0) ? line.slice(0, origX) : line;
        const positions = allMatchPositions(sub, re, this.searchPattern);
        if (positions.length > 0) {
          this.cursor = { x: positions.at(-1), y };
          this.message = `Found: ${this.searchPattern}`;
          return true;
        }
      }
    }
    this.message = `Not found: ${this.searchPattern}`;
    return false;
  }

  updateModTime() {
    if (!this.path || isHttpUrl(this.path)) return false;
    try {
      this.modTimeMs = statSync(this.path).mtimeMs;
      return true;
    } catch {
      return false;
    }
  }

  externallyModified() {
    if (!this.path || this.reloadDisabled || isHttpUrl(this.path)) return false;
    try {
      const modTimeMs = statSync(this.path).mtimeMs;
      return this.modTimeMs != null && modTimeMs !== this.modTimeMs;
    } catch {
      return false;
    }
  }

  async reopen(context = {}) {
    if (!this.path) return;
    if (isHttpUrl(this.path)) {
      const decoded = await fetchTextWithEncoding(this.path, this.Settings.encoding ?? this.encoding, false);
      const text = decoded.text;
      this.encoding = decoded.encoding;
      this.Settings.encoding = decoded.encoding;
      this._ansiStyleLines = decoded.ansiStyleLines ?? null;
      this._mdcuiAnsiText = isMdcuiEncoding(this.encoding) ? String(decoded.ansiText ?? "") : null;
      this._mdcuiSourceText = isMdcuiEncoding(this.encoding) ? String(decoded.sourceText ?? text) : null;
      this._mdcuiTuiSourceText = isMdcuiEncoding(this.encoding) ? String(decoded.tuiSourceText ?? decoded.sourceText ?? text) : null;
      this._mdcuiFenceEvents = isMdcuiEncoding(this.encoding) ? fenceEventMap(decoded.sourceText ?? decoded.tuiSourceText ?? text) : new Map();
      this._mdcuiRenderWidth = decoded.mdcuiRenderWidth ?? 0;
      this._mdcuiImages = decoded.mdcuiImages ?? [];
      const readonly = isMdcuiEncoding(this.encoding);
      this.fileformat = detectFileFormat(text, this.Settings.fileformat ?? DEFAULT_SETTINGS.fileformat);
      this.Settings.fileformat = this.fileformat;
      this.lines = normalizeBufferText(text).split("\n");
      if (this.lines.length === 0) this.lines = [""];
      clearTuiSourceDependentState(this);
      if (isMdcuiEncoding(this.encoding)) {
        indexTuiHeadingRows(this);
        refreshTuiLinkIndex(this, { resetCatalog: true });
        applyPreRenderHeadingData(this, decoded.preRenderHeadingData);
      }
      this.modTimeMs = null;
      this.readonly = readonly;
      this.Settings.readonly = readonly;
      this.Type.Readonly = readonly;
      this.undoStack = [];
      this.redoStack = [];
      this._undoSerial = 0;
      this._savedSerial = 0;
      this.modified = false;
      this.invalidateHighlightFrom(0, { force: true });
      this.message = "";
      this.clearAutocomplete();
      this.ensureCursor();
      attachSyntax(this, context, this.path.replace(/[?#].*$/, ""), text);
      return;
    }
    const info = statSync(this.path);
    if (info.isDirectory()) throw new Error(`${this.path} is a directory`);
    const decoded = await readTextFileWithEncoding(this.path, this.Settings.encoding ?? this.encoding, false);
    const text = decoded.text;
    this.encoding = decoded.encoding;
    this.Settings.encoding = decoded.encoding;
    this._ansiStyleLines = decoded.ansiStyleLines ?? null;
    this._mdcuiAnsiText = isMdcuiEncoding(this.encoding) ? String(decoded.ansiText ?? "") : null;
    this._mdcuiSourceText = isMdcuiEncoding(this.encoding) ? String(decoded.sourceText ?? text) : null;
    this._mdcuiTuiSourceText = isMdcuiEncoding(this.encoding) ? String(decoded.tuiSourceText ?? decoded.sourceText ?? text) : null;
    this._mdcuiFenceEvents = isMdcuiEncoding(this.encoding) ? fenceEventMap(decoded.sourceText ?? decoded.tuiSourceText ?? text) : new Map();
    this._mdcuiRenderWidth = decoded.mdcuiRenderWidth ?? 0;
    this._mdcuiImages = decoded.mdcuiImages ?? [];
    this.fileformat = detectFileFormat(text, this.Settings.fileformat ?? DEFAULT_SETTINGS.fileformat);
    this.Settings.fileformat = this.fileformat;
    this.lines = normalizeBufferText(text).split("\n");
    if (this.lines.length === 0) this.lines = [""];
    clearTuiSourceDependentState(this);
    if (isMdcuiEncoding(this.encoding)) {
      indexTuiHeadingRows(this);
      refreshTuiLinkIndex(this, { resetCatalog: true });
      applyPreRenderHeadingData(this, decoded.preRenderHeadingData);
    }
    this.modTimeMs = info.mtimeMs;
    this.readonly = !canWritePath(this.path) || isMdcuiEncoding(this.encoding);
    this.Settings.readonly = this.readonly;
    this.Type.Readonly = this.readonly;
    this.undoStack = [];
    this.redoStack = [];
    this._undoSerial = 0;
    this._savedSerial = 0;
    this.modified = false;
    this.invalidateHighlightFrom(0, { force: true });
    this.message = "";
    this.clearAutocomplete();
    this.ensureCursor();
    attachSyntax(this, context, this.path, text);
  }
  rerenderMdcui(width) {
    return enqueueMdcuiRerender(this, () => this._rerenderMdcuiNow(width));
  }

  refreshMdcuiKittyImages(width = this._mdcuiRenderWidth || 80) {
    return enqueueMdcuiRerender(this, async () => {
      if (!this._mdcuiImagesDirty || typeof this._mdcuiAnsiText !== "string")
        return false;
      const revision = this._mdcuiImagesRevision ?? 0;

      const ansiLines = this._mdcuiAnsiText.split("\n");
      const reservedRows = new Set();
      for (const image of this._mdcuiImages ?? []) {
        for (let offset = 1; offset < Math.max(1, Number(image.rows) || 1); offset++)
          reservedRows.add(image.line + offset);
      }
      const unpreparedAnsi = ansiLines
        .filter((_, line) => !reservedRows.has(line))
        .join("\n");
      const resolvedImageBasePath = this.path && !isHttpUrl(this.path)
        ? remoteMarkdownSources.get(resolve(this.path)) ?? this.path
        : this.path;
      const prepared = kittyImageMode === "off"
        ? { rendered: unpreparedAnsi, images: [] }
        : await prepareKittyImages(unpreparedAnsi, resolvedImageBasePath, width, {
          allowUrl: allowRemoteKittyImages,
          kittyMode: kittyImageMode,
          getBundledImageMap,
        });
      const styled = parseAnsiStyledText(prepared.rendered);
      if ((this._mdcuiImagesRevision ?? 0) !== revision) return false;
      markTuiTableStripeStyles(styled.styleLines, styled.text.split("\n"));
      this.lines = normalizeBufferText(styled.text).split("\n");
      this._ansiStyleLines = styled.styleLines;
      this._mdcuiAnsiText = prepared.rendered;
      this._mdcuiImages = prepared.images;
      this._mdcuiImagesDirty = false;
      indexTuiHeadingRows(this);
      refreshTuiLinkIndex(this);
      this.invalidateHighlightFrom(0, { force: true });
      this.ensureCursor();
      return true;
    });
  }
  async _rerenderMdcuiNow(width) {
    if (!isMdcuiEncoding(this.encoding) || this._mdcuiTuiSourceText == null) return false;
    const renderWidth = Math.max(1, Math.trunc(Number(width) || 80));
    if (renderWidth === this._mdcuiRenderWidth) return false;
    const snapshot = captureTuiRerenderState(this);
    let rerendered;
    try {
      rerendered = await renderMdcui(this._mdcuiTuiSourceText, renderWidth, null, this.path);
    } catch (error) {
      restoreTuiHiddenHeadings(this, snapshot.hiddenHeadings);
      throw error;
    }
    const { rendered, images, preRenderHeadingData } = rerendered;
    const styled = parseAnsiStyledText(rendered);
    markTuiTableStripeStyles(styled.styleLines, styled.text.split("\n"));
    this.lines = normalizeBufferText(styled.text).split("\n");
    if (this.lines.length === 0) this.lines = [""];
    this._ansiStyleLines = styled.styleLines;
    this._mdcuiAnsiText = rendered;
    this._mdcuiImages = images;
    this._mdcuiHeadingTaskListAnchors = null;
    indexTuiHeadingRows(this);
    refreshTuiLinkIndex(this, { resetCatalog: true });
    applyPreRenderHeadingData(this, preRenderHeadingData);
    restoreTuiRerenderState(this, snapshot);
    this._mdcuiRenderWidth = renderWidth;
    this.fileformat = detectFileFormat(styled.text, this.Settings.fileformat ?? DEFAULT_SETTINGS.fileformat);
    this.Settings.fileformat = this.fileformat;
    this.modified = false;
    this.clearAutocomplete();
    this.invalidateHighlightFrom(0, { force: true });
    this.ensureCursor();
    this.scroll.y = clamp(this.scroll.y ?? 0, 0, Math.max(0, this.lines.length - 1));
    this.scroll.x = 0;
    this.scroll.row = 0;
    return true;
  }
  async save(path = this.path) {
    if (this.isEditLocked()) throw new Error("Can't save under readonly mode");
    if (!path) throw new Error("No filename");
    const detectSyntaxAfterSave = this.filetype === "unknown";
    const oldPath = this.AbsPath || this.path;
    const targetPath = resolve(path);
    let text = this.lines.join("\n");
    if (this._configDir) {
      if (this._backupWritePromise) {
        try { await this._backupWritePromise; } catch {}
      }
      const backupRevision = this._backupRevision;
      const job = writeBackup(this, this._configDir, targetPath, { force: true });
      this._backupWritePromise = job;
      try {
        await job;
      } finally {
        if (this._backupWritePromise === job) this._backupWritePromise = null;
      }
      if (this._backupRevision === backupRevision) this._backupRequested = false;
      this._forceKeepBackup = true;
    }
    if (isHex3Encoding(this.encoding)) {
      try {
        await Bun.write(targetPath, encodeTextBytesWithEncoding(text, this.encoding));
      } finally {
        this._forceKeepBackup = false;
      }
      this.path = targetPath;
      this.Path = targetPath;
      this.AbsPath = targetPath;
      this.name = basename(targetPath);
      this.updateModTime();
      this.readonly = !canWritePath(path);
      this.Settings.readonly = this.readonly;
      this.Type.Readonly = this.readonly;
      this._savedSerial = this._undoSerial ?? 0;
      this.modified = false;
      this.message = `Saved ${targetPath}`;
      if (this._configDir && oldPath !== targetPath) removeBackup(this, this._configDir, oldPath);
      this._updateOpenBufferPath(oldPath, targetPath);
      if (detectSyntaxAfterSave && this._syntaxContext) attachSyntax(this, this._syntaxContext, targetPath, text);
      return;
    }
    if ((this.Settings.eofnewline ?? DEFAULT_SETTINGS.eofnewline) && !text.endsWith("\n")) text += "\n";
    try {
      await Bun.write(targetPath, encodeBufferTextForFile(text, this.Settings.fileformat ?? this.fileformat));
    } finally {
      this._forceKeepBackup = false;
    }
    this.encoding = "utf-8";
    this.Settings.encoding = "utf-8";
    this._ansiStyleLines = null;
    this._mdcuiAnsiText = null;
    this._mdcuiSourceText = null;
    this._mdcuiTuiSourceText = null;
    this._mdcuiRenderWidth = 0;
    this.path = targetPath;
    this.Path = targetPath;
    this.AbsPath = targetPath;
    this.name = basename(targetPath);
    this.updateModTime();
    this.readonly = !canWritePath(path);
    this.Settings.readonly = this.readonly;
    this.Type.Readonly = this.readonly;
    this._savedSerial = this._undoSerial ?? 0;
    this.modified = false;
    this.message = `Saved ${targetPath}`;
    if (this._configDir && oldPath !== targetPath) removeBackup(this, this._configDir, oldPath);
    this._updateOpenBufferPath(oldPath, targetPath);
    if (detectSyntaxAfterSave && this._syntaxContext) attachSyntax(this, this._syntaxContext, targetPath, text);
  }

  _updateOpenBufferPath(oldPath, newPath) {
    if (!this._openBufferMap) return;
    if (oldPath && this._openBufferMap.get(oldPath) === this) this._openBufferMap.delete(oldPath);
    this._openBufferMap.set(newPath, this);
  }

  // --- Autocomplete (BufferComplete) ---

  _getWord() {
    const line = this.line();
    const x = this.cursor.x;
    if (x === 0) return null;
    if (!isWordChar(line[x - 1])) return null;
    // don't trigger when cursor is inside a word
    if (x < line.length && isWordChar(line[x])) return null;
    let start = x;
    while (start > 0 && isWordChar(line[start - 1])) start--;
    const word = line.slice(start, x);
    return word ? { word, startX: start } : null;
  }

  startBufferComplete() {
    if (this.isEditLocked()) return false;
    const got = this._getWord();
    if (!got) return false;
    const { word } = got;
    const wordLen = word.length;
    const seen = new Set();
    const suggestions = [];
    const cy = this.cursor.y;
    // scan upward from cursor line, then downward
    for (let pass = 0; pass < 2; pass++) {
      const [from, to, step] = pass === 0 ? [cy, -1, -1] : [cy + 1, this.lines.length, 1];
      for (let y = from; y !== to; y += step) {
        const l = this.lines[y];
        let i = 0;
        while (i < l.length) {
          if (!isWordChar(l[i])) { i++; continue; }
          let j = i;
          while (j < l.length && isWordChar(l[j])) j++;
          const w = l.slice(i, j);
          if (w.length > wordLen && w.startsWith(word) && !seen.has(w)) {
            seen.add(w);
            suggestions.push(w);
          }
          i = j;
        }
      }
    }
    const syntaxWords = this.syntaxDefinition?.autocompleteWords ?? [];
    for (const w of syntaxWords) {
      if (w.length > wordLen && w.startsWith(word) && !seen.has(w)) {
        seen.add(w);
        suggestions.push(w);
      }
    }
    if (suggestions.length === 0) return false;
    if (suggestions.length === 1) {
      // Single match: insert suffix directly without entering cycling mode
      const suffix = suggestions[0].slice(wordLen);
      const line = this.lines[this.cursor.y];
      const x = this.cursor.x;
      this.lines[this.cursor.y] = line.slice(0, x) + suffix + line.slice(x);
      this.cursor.x = x + suffix.length;
      this.invalidateHighlightFrom(this.cursor.y);
      this.modified = true;
      return true;
    }
    suggestions.push(word); // last entry = cycle back to original prefix
    this.acSuggestions = suggestions;
    this.acCompletions = suggestions.map(s => s.slice(wordLen));
    this.acCurIdx = -1;
    this.acHas = true;
    this.cycleAutocomplete(true);
    return true;
  }

  cycleAutocomplete(forward) {
    if (this.isEditLocked()) return;
    if (!this.acHas) return;
    const prevIdx = this.acCurIdx;
    const n = this.acCompletions.length;
    this.acCurIdx = forward
      ? (prevIdx + 1) % n
      : (prevIdx - 1 + n) % n;
    const line = this.lines[this.cursor.y];
    const x = this.cursor.x;
    const prevLen = prevIdx >= 0 ? this.acCompletions[prevIdx].length : 0;
    const base = line.slice(0, x - prevLen) + line.slice(x);
    const ins = this.acCompletions[this.acCurIdx];
    const newX = x - prevLen;
    this.lines[this.cursor.y] = base.slice(0, newX) + ins + base.slice(newX);
    this.invalidateHighlightFrom(this.cursor.y);
    this.cursor.x = newX + ins.length;
    this.modified = true;
  }

  clearAutocomplete() {
    this.acHas = false;
    this.acSuggestions = [];
    this.acCompletions = [];
    this.acCurIdx = -1;
  }

  jumpToAcSuggestion(idx) {
    if (this.isEditLocked()) return;
    if (!this.acHas || idx < 0 || idx >= this.acCompletions.length) return;
    const prevIdx = this.acCurIdx;
    const line = this.lines[this.cursor.y];
    const x = this.cursor.x;
    const prevLen = prevIdx >= 0 ? this.acCompletions[prevIdx].length : 0;
    const base = line.slice(0, x - prevLen) + line.slice(x);
    const ins = this.acCompletions[idx];
    const newX = x - prevLen;
    this.lines[this.cursor.y] = base.slice(0, newX) + ins + base.slice(newX);
    this.invalidateHighlightFrom(this.cursor.y);
    this.cursor.x = newX + ins.length;
    this.modified = true;
    this.clearAutocomplete();
  }

  insertTab() {
    const ts = this.Settings.tabsize || DEFAULT_SETTINGS.tabsize || 4;
    const useSpaces = this.Settings.tabstospaces ?? DEFAULT_SETTINGS.tabstospaces;
    this.insertChar(useSpaces ? " ".repeat(ts) : "\t");
  }

  FileType() {
    return this.filetype ?? this.Settings.filetype ?? "unknown";
  }

  SetOption(option, value) {
    const oldValue = this.Settings[option];
    const parsed = parseOptionValue(value);
    if (option === "cursorshape" && !OPTION_CHOICES.cursorshape.includes(String(parsed))) {
      throw new Error(`Invalid value for cursorshape: ${parsed}`);
    }
    if (option === "fileformat" && !OPTION_CHOICES.fileformat.includes(String(parsed))) {
      throw new Error(`Invalid value for fileformat: ${parsed}`);
    }
    this.Settings[option] = option === "encoding" ? normalizeEncodingLabel(parsed) : option === "fileformat" ? String(parsed) : parsed;
    if (option === "filetype") this.filetype = String(parsed);
    if (option === "encoding") {
      this.encoding = this.Settings.encoding;
      if (isMdcuiEncoding(this.encoding)) {
        this.readonly = true;
        this.Settings.readonly = true;
        this.Type.Readonly = true;
      } else {
        this._ansiStyleLines = null;
      }
    }
    if (option === "fileformat") this.fileformat = this.Settings.fileformat === "dos" ? "dos" : "unix";
    if (option === "readonly") {
      this.readonly = Boolean(parsed);
      this.Settings.readonly = this.readonly;
      this.Type.Readonly = this.readonly;
    }
    if (option in DEFAULT_SETTINGS && option !== "fileformat") DEFAULT_SETTINGS[option] = this.Settings[option];
    this._onOptionChange?.(option, oldValue, this.Settings[option]);
  }

  DoSetOptionNative(option, value) {
    const oldValue = this.Settings[option];
    if (option === "cursorshape" && !OPTION_CHOICES.cursorshape.includes(String(value))) {
      throw new Error(`Invalid value for cursorshape: ${value}`);
    }
    if (option === "fileformat" && !OPTION_CHOICES.fileformat.includes(String(value))) {
      throw new Error(`Invalid value for fileformat: ${value}`);
    }
    this.Settings[option] = option === "encoding" ? normalizeEncodingLabel(value) : option === "fileformat" ? String(value) : value;
    if (option === "filetype") this.filetype = String(value);
    if (option === "encoding") {
      this.encoding = this.Settings.encoding;
      if (isMdcuiEncoding(this.encoding)) {
        this.readonly = true;
        this.Settings.readonly = true;
        this.Type.Readonly = true;
      } else {
        this._ansiStyleLines = null;
      }
    }
    if (option === "fileformat") this.fileformat = this.Settings.fileformat === "dos" ? "dos" : "unix";
    if (option === "readonly") {
      this.readonly = Boolean(value);
      this.Settings.readonly = this.readonly;
      this.Type.Readonly = this.readonly;
    }
    this._onOptionChange?.(option, oldValue, this.Settings[option]);
  }

  SetDiffBase(text) {
    this.diffBase = String(text);
    this._diffMarkersCache = null;
    if (this._diffDebounceTimer) { clearTimeout(this._diffDebounceTimer); this._diffDebounceTimer = null; }
  }

  AddMessage(message) {
    this.Messages ??= [];
    this.Messages.push(message);
  }

  ClearMessages(owner) {
    this.Messages = (this.Messages ?? []).filter((message) => message.Owner !== owner);
  }

  LinesNum() {
    return this.lines.length;
  }

  Line(n) {
    return this.lines[n] ?? "";
  }

  Bytes() {
    return encodeBufferTextForFile(this.lines.join("\n"), this.Settings.fileformat ?? this.fileformat);
  }

  Size() {
    return new TextEncoder().encode(this.Bytes()).byteLength;
  }

  currentLineText() {
    return this.line();
  }

  cutLine() {
    if (this.isEditLocked()) return "";
    const text = this.line();
    if (this.lines.length === 1) {
      this.lines[0] = "";
      this.invalidateHighlightFrom(0, { force: true });
      this.cursor.x = 0;
    } else if (this.cursor.y === this.lines.length - 1) {
      // last line of multi-line buffer: clear content, keep the line (cursor stays)
      this.lines[this.cursor.y] = "";
      this.invalidateHighlightFrom(this.cursor.y, { force: true });
      this.cursor.x = 0;
    } else {
      this.lines.splice(this.cursor.y, 1);
      this.invalidateHighlightFrom(this.cursor.y, { force: true });
      this.cursor.x = 0;
    }
    this.modified = true;
    return text;
  }
}

class Prompt {
  constructor(label, callback, { completer = null, type = null, yn = false, onDelta = null, initial = "", onCancel = null, onCompletionSelect = null } = {}) {
    this.label = label;
    this.value = initial;
    this.callback = callback;
    this.completer = completer;
    this.yn = yn;
    this.onDelta = onDelta;
    this.onCancel = onCancel;
    this.onCompletionSelect = onCompletionSelect;
    this.completions = [];
    this.completionLabels = [];
    this.completionIndex = -1;
    this.completionInput = "";
    this.cursor = initial.length;
    this.type = type ?? (label.trim().replace(/:$/, "") || "default");
    if (!promptHistory.has(this.type)) promptHistory.set(this.type, []);
    this.historyIndex = promptHistory.get(this.type).length;
    this.savedInput = "";
  }

  resetCompletion() {
    this.completions = [];
    this.completionLabels = [];
    this.completionIndex = -1;
    this.completionInput = "";
  }

  historyUp() {
    const hist = promptHistory.get(this.type) ?? [];
    if (this.historyIndex === hist.length) this.savedInput = this.value;
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.value = hist[this.historyIndex];
      this.cursor = this.value.length;
      this.resetCompletion();
    }
  }

  historyDown() {
    const hist = promptHistory.get(this.type) ?? [];
    if (this.historyIndex < hist.length) {
      this.historyIndex++;
      this.value = this.historyIndex === hist.length ? this.savedInput : hist[this.historyIndex];
      this.cursor = this.value.length;
      this.resetCompletion();
    }
  }

  commit() {
    if (!this.value) return;
    const hist = promptHistory.get(this.type) ?? [];
    const dupIdx = hist.indexOf(this.value);
    if (dupIdx >= 0) hist.splice(dupIdx, 1);
    hist.push(this.value);
    this.historyIndex = hist.length;
    this.savedInput = "";
  }
}

class TerminalPane {
  constructor(app) {
    this.app = app;
    this.proc = null;
    this.vt = null;
    this.decoder = new TextDecoder();
    this.exited = false;
  }

  open(cols, rows) {
    if (!Bun.spawn || typeof Bun.Terminal === "undefined") {
      this.app.message = "Bun PTY support is unavailable in this runtime";
      return;
    }
    const shell = defaultShell();
    cols = Math.max(10, cols ?? this.app.cols);
    rows = Math.max(4, rows ?? Math.floor(this.app.rows / 2));
    this.vt = new VT100(cols, rows);
    this.exited = false;
    this.proc = Bun.spawn([shell], {
      env: { ...process.env, TERM: "xterm-256color", COLUMNS: String(cols), LINES: String(rows) },
      terminal: {
        cols,
        rows,
        data: (_terminal, data) => {
          const text = this.decoder.decode(data, { stream: true });
          if (!text) return;
          const responses = this.vt.feed(text);
          for (const resp of responses) this.proc?.terminal?.write(resp);
          this.app.render();
        },
        exit: () => {
          this.exited = true;
          this.vt.feed("\r\n[process exited]\r\nPress enter to close\r\n");
          this.app.render();
        },
      },
    });
  }

  write(data) {
    if (this.exited) return;
    this.proc?.terminal?.write(data);
  }

  writeInput(data) {
    this.write(encodeTerminalInput(data, this.vt));
  }

  resize(cols, rows) {
    rows = Math.max(4, rows);
    this.vt?.resize(cols, rows);
    this.proc?.terminal?.resize(cols, rows);
  }

  close() {
    try {
      if (!this.exited) this.proc?.kill();
      this.proc?.terminal?.close();
    } catch {
      // PTY may already be closed.
    }
    this.proc = null;
    this.exited = true;
  }
}

function encodeTerminalInput(data, vt) {
  if (!vt) return data;
  const flags = vt.keyboardProtocolFlags ?? 0;
  const wantsKitty = flags !== 0;
  const wantsXterm = (vt.modifyOtherKeys ?? 0) > 0 || (vt.formatOtherKeys ?? 0) > 0;
  if (!wantsKitty && !wantsXterm) return data;

  const text = data instanceof Uint8Array ? decoder.decode(data) : String(data);
  const events = parseInputEvents(text);
  if (events.length === 0 || events.some(e => e.type !== "key")) return data;

  const encoded = [];
  for (const event of events) {
    const seq = encodeKeyEventForTerminal(event, flags, wantsXterm);
    if (!seq) return data;
    encoded.push(seq);
  }
  return encoded.join("");
}

function encodeKeyEventForTerminal(event, flags, wantsXterm) {
  const key = event.key;
  const raw = event.raw ?? "";
  const reportAll = (flags & 8) !== 0;
  const disambiguate = (flags & 1) !== 0 || reportAll || wantsXterm;

  if (!reportAll && isPlainTextKey(raw, key)) return raw;
  const parsed = keyToKittyCode(key, raw);
  if (!parsed) return raw;
  const { code, modifiers } = parsed;
  if (!reportAll && !disambiguate && modifiers <= 1) return raw;
  if (!reportAll && modifiers <= 1 && !needsDisambiguation(key)) return raw;
  return `\x1b[${code};${modifiers}u`;
}

function isPlainTextKey(raw, key) {
  return raw && raw === key && !raw.includes("\x1b") && !/^(?:ctrl|alt|shift)-/.test(key) && !KEY_CODEPOINTS[key];
}

function needsDisambiguation(key) {
  return key === "escape" || key.startsWith("ctrl-") || key.startsWith("alt-") || key.includes("shift-");
}

const NAMED_KEY_CODEPOINTS = {
  escape: 27,
  enter: 13,
  tab: 9,
  backspace: 127,
  delete: 57362,
  insert: 57363,
  left: 57364,
  right: 57365,
  up: 57366,
  down: 57367,
  pageup: 57368,
  pagedown: 57369,
  home: 57370,
  end: 57371,
};

const KEY_CODEPOINTS = NAMED_KEY_CODEPOINTS;

function keyToKittyCode(key, raw) {
  let rest = key;
  let mods = 1;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [prefix, bit] of [["shift-", 1], ["alt-", 2], ["ctrl-", 4]]) {
      if (rest.startsWith(prefix)) {
        mods += bit;
        rest = rest.slice(prefix.length);
        changed = true;
      }
    }
  }

  if (rest === "space") return { code: 32, modifiers: mods };
  if (KEY_CODEPOINTS[rest]) return { code: KEY_CODEPOINTS[rest], modifiers: mods };
  if (rest.length === 1) return { code: rest.toLowerCase().codePointAt(0), modifiers: mods };

  if (raw.length === 1 && raw >= " " && raw !== "\x7f") return { code: raw.toLowerCase().codePointAt(0), modifiers: mods };
  if (raw.length === 1 && raw.charCodeAt(0) >= 1 && raw.charCodeAt(0) <= 26) {
    return { code: raw.charCodeAt(0) + 96, modifiers: mods | 4 };
  }
  return null;
}

// ─── Pane / split layout ────────────────────────────────────────────────────

class Pane {
  constructor(buffer = null) {
    this.buffer = buffer;
    this.terminal = null;
    this.type = "editor"; // "editor" | "term"
    this.selection = null;
    // rect filled by computeLayout
    this.x = 0; this.y = 0; this.w = 0; this.h = 0;
  }
  get name() {
    if (this.type === "term") return "[Terminal]";
    return this.buffer?.name ?? "No name";
  }
  get modified() { return this.type === "editor" && (this.buffer?.modified ?? false); }
}

class SplitNode {
  constructor(dir, children) {
    this.dir = dir; // "h" = left|right,  "v" = top|bottom
    this.children = children;
    this.x = 0; this.y = 0; this.w = 0; this.h = 0;
  }
}

function computeLayout(node, x, y, w, h) {
  node.x = x; node.y = y; node.w = w; node.h = h;
  if (node instanceof Pane) return;
  const n = node.children.length;
  if (n === 0) return;
  const isH = node.dir === "h";
  const total = isH ? w : h;
  const space = Math.max(n, total - (n - 1)); // subtract divider cols
  const each = Math.floor(space / n);
  let cur = isH ? x : y;
  for (let i = 0; i < n; i++) {
    const isLast = i === n - 1;
    const size = isLast ? space - each * (n - 1) : each;
    if (isH) computeLayout(node.children[i], cur, y, size, h);
    else     computeLayout(node.children[i], x, cur, w, size);
    cur += size + 1;
  }
}

function collectPanes(node) {
  if (node instanceof Pane) return [node];
  return node.children.flatMap(collectPanes);
}

function insertSplit(root, target, newPane, dir) {
  if (root === target) return new SplitNode(dir, [target, newPane]);
  if (root instanceof SplitNode) {
    if (root.dir === dir) {
      const idx = root.children.indexOf(target);
      if (idx >= 0) {
        const ch = [...root.children];
        ch.splice(idx + 1, 0, newPane);
        return new SplitNode(dir, ch);
      }
    }
    const ch = root.children.map(c => insertSplit(c, target, newPane, dir));
    return new SplitNode(root.dir, ch);
  }
  return root;
}

function removePaneFromTree(root, target) {
  if (root === target) return null;
  if (root instanceof SplitNode) {
    const ch = root.children.map(c => removePaneFromTree(c, target)).filter(Boolean);
    if (ch.length === 0) return null;
    if (ch.length === 1) return ch[0];
    return new SplitNode(root.dir, ch);
  }
  return root;
}

class Tab {
  constructor(pane) {
    this.root = pane;
    this.activePane = pane;
  }
  get buffer() { return this.activePane?.buffer ?? null; }
  get name()   { return this.activePane?.name   ?? "No name"; }
  panes()      { return collectPanes(this.root); }

  split(currentPane, newPane, dir) {
    this.root = insertSplit(this.root, currentPane, newPane, dir);
    this.activePane = newPane;
  }

  removePane(pane) {
    const newRoot = removePaneFromTree(this.root, pane);
    if (newRoot === null) { this.root = null; this.activePane = null; return; }
    this.root = newRoot;
    if (this.activePane === pane) {
      this.activePane = this.panes()[0] ?? null;
    }
  }
}

// ─── App ────────────────────────────────────────────────────────────────────

class App {
  constructor(buffers, context = {}) {
    this.tabs = buffers.map(b => new Tab(new Pane(b)));
    this.activeTabIdx = 0;
    this.rows = process.stdout.rows || 24;
    this.cols = process.stdout.columns || 80;
    this.message = "";
    this.prompt = null;
    this.keymenu = false;
    this.running = true;
    this.clipboard = new ClipboardManager();
    this.context = context;
    this.shellRunning = false;
    this.screen = new Screen({
      mouse: DEFAULT_SETTINGS.mouse !== false,
      kittyMode: context.kittyMode ?? "off",
    });
    this.tabRects = [];
    this._escBuf = null;   // pending lone ESC bytes waiting for alt-key combo
    this._escTimer = null;
    this._suggestionsRow = null;
    this._suggestionRects = [];
    this._acHScroll = 0;
    this._suppressMouseUntilUp = false;
    this._undoInsertChain = false;
    this._freshClip = false;
    this._messageClickAction = null;
    this._messageRowY = null;
    this._messageRowClickZone = null;
    this._resizeRenderSeq = 0;
    this._inputQueue = Promise.resolve();
    this._inputGeneration = 0;
    this._mdcuiExitNotified = new WeakSet();
    this._mdcuiLoadNotified = new WeakSet();
  }

  get tab()    { return this.tabs[this.activeTabIdx]; }
  get pane()   { return this.tab?.activePane ?? null; }
  get buffer() { return this.pane?.buffer ?? null; }
  // backward-compat for the few spots that still use this.active / this.buffers
  get active() { return this.activeTabIdx; }
  get buffers() {
    return [...new Set(this.tabs.flatMap((tab) =>
      tab.panes().flatMap((pane) => [pane.buffer, pane.prevBuffer]).filter(Boolean)
    ))];
  }

  paneForBuffer(buffer) {
    for (const tab of this.tabs) {
      const pane = tab.panes().find((p) => p.buffer === buffer || p.prevBuffer === buffer);
      if (pane) return pane;
    }
    return null;
  }

  async refreshMdcuiKittyImages(buffer = this.buffer) {
    if (!buffer) return false;
    try {
      return await buffer.refreshMdcuiKittyImages?.(
        buffer._mdcuiRenderWidth || this.cols || 80,
      );
    } finally {
      if (this._started) this.render();
    }
  }

  _enqueueInput(operation) {
    const pending = this._inputQueue.catch(() => {}).then(async () => {
      await Promise.all(this.buffers.map(waitForMdcuiRerenders));
      if (this.running) await operation();
    });
    this._inputQueue = pending;
    void pending.catch(() => {});
    return pending;
  }

  _acceptTerminalInput(rawData) {
    const generation = this._inputGeneration;
    const data = Uint8Array.from(
      rawData instanceof Uint8Array ? rawData : new Uint8Array(rawData),
    );
    if (this._escBuf !== null) {
      clearTimeout(this._escTimer);
      this._escTimer = null;
      const merged = new Uint8Array(this._escBuf.length + data.length);
      merged.set(this._escBuf);
      merged.set(data, this._escBuf.length);
      this._escBuf = null;
      void this._enqueueInput(() => {
        if (generation !== this._inputGeneration) return;
        return this.handleInput(merged);
      });
      return;
    }

    if (
      data.length === 1
      && data[0] === 0x1b
      && this.pane?.type !== "term"
    ) {
      this._escBuf = data;
      this._escTimer = setTimeout(() => {
        if (this._escBuf !== data) return;
        this._escBuf = null;
        this._escTimer = null;
        void this._enqueueInput(async () => {
          if (generation !== this._inputGeneration) return;
          await this._dispatchInput(data);
          this.render();
        });
      }, 150);
      return;
    }

    void this._enqueueInput(() => {
      if (generation !== this._inputGeneration) return;
      return this.handleInput(data);
    });
  }

  _invalidatePendingEditorInput() {
    this._inputGeneration++;
    if (this._escTimer !== null) clearTimeout(this._escTimer);
    this._escTimer = null;
    this._escBuf = null;
  }

  formatCursorLocation(buffer = this.buffer, pane = null) {
    return formatCursorLocation(buffer, pane ?? this.paneForBuffer(buffer) ?? this.pane);
  }

  formatAbsoluteCursorLocation(buffer = this.buffer) {
    return formatAbsoluteCursorLocation(buffer);
  }

  async start() {
    this.installProtectedPrompts();
    // When stdin was a pipe (content already consumed in loadBuffers), open the
    // controlling terminal directly so the event loop has a live handle and
    // keyboard input works. Unix: /dev/tty; Windows: CONIN$.
    if (!process.stdin.isTTY) {
      try {
        const { ReadStream } = await import("node:tty");
        const fd = openSync(controllingTerminalInputPath(), "r");
        this._ttyStream = new ReadStream(fd);
      } catch {
        this._ttyStream = process.stdin;
      }
    } else {
      this._ttyStream = process.stdin;
    }
    _activeTtyStream = this._ttyStream;
    this._ttyStream.setRawMode?.(true);
    this._ttyStream.resume();
    const clipSetting = this.context?.config?.getGlobalOption("clipboard") ?? "external";
    await this.reinitializeClipboard(clipSetting);
    this._inputHandler = (data) => {
      this._acceptTerminalInput(data);
    };
    this._ttyStream.on("data", this._inputHandler);
    process.stdout.on("resize", async () => {
      const seq = ++this._resizeRenderSeq;
      const resize = this.screen.updateSize();
      this.rows = resize.rows;
      this.cols = resize.cols;
      this.layoutEditorArea();
      for (const tab of this.tabs)
        for (const p of tab.panes())
          if (p.type === "term") p.terminal?.resize(p.w, Math.max(4, p.h - 1));
      await this._inputQueue.catch(() => {});
      if (seq !== this._resizeRenderSeq) return;
      await this.rerenderMdcuiBuffersForLayout();
      if (seq !== this._resizeRenderSeq) return;
      if (!this.shellRunning && !this._alertRunning) this.render();
    });
    process.on("SIGINT", () => {}); // Ctrl+C is handled as copy in handleEvent
    this.screen.init();
    this._started = true;
    // Update backup prompt to screen-aware version now that TUI is running.
    if (this.context._termPrompt) {
      this.context._termPrompt = async (msg) => {
        const tty = this._ttyStream ?? process.stdin;
        this._invalidatePendingEditorInput();
        if (this._inputHandler) tty.removeListener("data", this._inputHandler);
        tty.setRawMode?.(false);
        this.screen.fini();
        process.stdout.write("\n");
        const answer = await termPromptLine(msg, tty);
        this.screen.previous = null;
        this.screen.init();
        tty.setRawMode?.(true);
        tty.resume(); // rl.close() pauses the stream; resume so data events fire again
        if (this._inputHandler) tty.on("data", this._inputHandler);
        return answer;
      };
    }
    // Process buffers requested by edits. A successful backup is not repeated
    // until the buffer is modified again.
    const configDir = this.context?.config?.configDir;
    if (configDir) {
      this._backupTimer = setInterval(async () => {
        for (const buf of this.buffers) {
          if (buf._backupRequested && buf.modified && buf.path && buf.type === "default" &&
              (buf.Settings?.backup ?? DEFAULT_SETTINGS.backup) && !buf._backupWritePromise) {
            const revision = buf._backupRevision;
            const job = writeBackup(buf, configDir);
            buf._backupWritePromise = job;
            try {
              if (await job) {
                if (buf._backupRevision === revision) buf._backupRequested = false;
              }
            } catch {} finally {
              if (buf._backupWritePromise === job) buf._backupWritePromise = null;
            }
          }
        }
      }, 10_000);
    }
    startupHighlightProgress = new StartupHighlightProgress(this);
    try {
      this.layoutEditorArea();
      await this.rerenderMdcuiBuffersForLayout();
      this.render();
    } finally {
      startupHighlightProgress = null;
    }
  }

  async rerenderMdcuiBuffersForLayout() {
    const jobs = [];
    const seen = new Set();
    for (const tab of this.tabs) {
      for (const pane of tab.panes()) {
        const buf = pane.buffer;
        if (!buf || seen.has(buf) || !isMdcuiEncoding(buf.encoding)) continue;
        seen.add(buf);
        const width = Math.max(1, (pane.w ?? this.cols) - editorGutterWidth(buf));
        jobs.push({ buf, promise: buf.rerenderMdcui(width) });
      }
    }
    if (jobs.length === 0) return;
    const results = await Promise.allSettled(jobs.map(job => job.promise));
    const mismatches = jobs.filter((job, index) => (
      results[index].status === "fulfilled"
      && results[index].value === true
      && job.buf._mdcuiRerenderMismatch?.checkboxes
    ));
    const mismatch = mismatches.find(job => job.buf === this.buffer) ?? mismatches[0];
    if (mismatch) this.message = tuiCheckboxRerenderMismatchMessage(mismatch.buf);
  }

  async reinitializeClipboard(setting) {
    if (this._inputHandler) this._ttyStream?.removeListener("data", this._inputHandler);
    try {
      await this.clipboard.initFromSetting(setting, this._ttyStream, process.stdout, 150);
    } finally {
      if (this._inputHandler) this._ttyStream?.on("data", this._inputHandler);
    }
  }

  async stop(code = 0) {
    for (const buf of this.buffers)
      await this.notifyMdcuiExit(buf, "exit");
    this.running = false;
    if (this._backupTimer) { clearInterval(this._backupTimer); this._backupTimer = null; }
    await Promise.allSettled(this.buffers.map((buf) => buf._backupWritePromise).filter(Boolean));
    for (const tab of this.tabs)
      for (const p of tab.panes())
        if (p.type === "term") p.terminal?.close();
    (this._ttyStream ?? process.stdin).setRawMode?.(false);
    this.screen.fini();
    this._started = false;
    this.restoreProtectedPrompts();

    if (this.context?.config?.getGlobalOption("savehistory") !== false) {
      try { await saveHistory(this.context.config.configDir); } catch {}
    }
    if (DEFAULT_SETTINGS.savecursor && this.context?.config?.configDir) {
      if (!this.context.cursorStates) this.context.cursorStates = {};
      for (const buf of this.buffers) {
        if (buf.path) this.context.cursorStates[buf.path] = { ...buf.cursor };
      }
      try { await saveCursorStates(this.context.config.configDir, this.context.cursorStates); } catch {}
    }
    const configDir = this.context?.config?.configDir;
    if (configDir) {
      for (const buf of this.buffers) removeBackup(buf, configDir);
    }
    process.exit(code);
  }

  installProtectedPrompts() {
    if (this._protectedPrompts) return;
    const saved = {
      alert: {
        had: Object.prototype.hasOwnProperty.call(globalThis, "alert"),
        value: globalThis.alert,
      },
      confirm: {
        had: Object.prototype.hasOwnProperty.call(globalThis, "confirm"),
        value: globalThis.confirm,
      },
      prompt: {
        had: Object.prototype.hasOwnProperty.call(globalThis, "prompt"),
        value: globalThis.prompt,
      },
    };
    this._protectedPrompts = saved;
    this._protectedPromptGlobals = {
      alert: this.protectedAlert.bind(this),
      confirm: this.protectedConfirm.bind(this),
      prompt: this.protectedPrompt.bind(this),
    };
    Object.assign(globalThis, this._protectedPromptGlobals);
  }

  runProtectedPrompt(name, fallback, args) {
    const nativeFn = this._protectedPrompts?.[name]?.value;
    const tty = this._ttyStream ?? process.stdin;
    const wasRaw = typeof tty?.isRaw === "boolean" ? tty.isRaw : true;
    if (
      !this._started
      || this.shellRunning
      || this._alertRunning
      || !wasRaw
      || typeof nativeFn !== "function"
    ) {
      this.message = String(args[0] ?? "");
      return fallback;
    }

    const inputHandler = this._inputHandler;
    const listenerAttached = Boolean(
      inputHandler && tty.listeners?.("data").includes(inputHandler),
    );
    const wasPaused = tty.isPaused?.() ?? false;
    let value;
    let failed = false;
    let failure;
    const cleanupFailures = [];
    const cleanup = (fn) => {
      try { fn(); } catch (error) { cleanupFailures.push(error); }
    };

    try {
      this._alertRunning = true;
      this._invalidatePendingEditorInput();
      // Do not let the editor's flowing-mode data listener race the blocking
      // prompt for bytes from the same terminal.
      if (listenerAttached) tty.removeListener("data", inputHandler);
      tty.pause?.();
      tty.setRawMode?.(false);
      this.screen.fini();
      this.screen.previous = null;
      // Bun's native prompts always read fd 0. If Markdown itself came from a
      // pipe, read synchronously from the controlling terminal instead.
      value = tty !== process.stdin
        ? this.runProtectedTtyPrompt(name, fallback, args)
        : Reflect.apply(nativeFn, globalThis, args);
    } catch (error) {
      failed = true;
      failure = error;
    } finally {
      cleanup(() => tty.setRawMode?.(wasRaw));
      cleanup(() => { this.screen.previous = null; });
      cleanup(() => this.screen.init());
      cleanup(() => { this._alertRunning = false; });
      cleanup(() => {
        if (listenerAttached) tty.on("data", inputHandler);
      });
      cleanup(() => {
        if (!wasPaused) tty.resume?.();
      });
      cleanup(() => this.render());
    }
    if (failed) throw failure;
    if (cleanupFailures.length > 0) throw cleanupFailures[0];
    return value;
  }

  runProtectedTtyPrompt(name, fallback, args) {
    const message = String(args[0] ?? "");
    const defaultValue = String(args[1] ?? "");
    const fd = openSync(controllingTerminalInputPath(), "r");
    try {
      if (name === "alert") {
        process.stdout.write(`${message}\n\nPress ENTER to continue...`);
        this.readProtectedPromptLine(fd);
        return undefined;
      }
      const suffix = name === "confirm"
        ? " [y/N] "
        : defaultValue ? ` (${defaultValue}) ` : " ";
      process.stdout.write(message + suffix);
      const answer = this.readProtectedPromptLine(fd);
      if (answer == null) return fallback;
      if (name === "confirm") return /^(?:y|yes)$/i.test(answer.trim());
      return answer === "" ? defaultValue : answer;
    } finally {
      closeSync(fd);
    }
  }

  readProtectedPromptLine(fd) {
    const chunks = [];
    const chunk = Buffer.allocUnsafe(1024);
    while (true) {
      const length = readSync(fd, chunk, 0, chunk.length, null);
      if (length === 0) return chunks.length > 0 ? Buffer.concat(chunks).toString() : null;
      const bytes = chunk.subarray(0, length);
      const newline = bytes.findIndex((byte) => byte === 0x0a || byte === 0x0d);
      chunks.push(Buffer.from(newline < 0 ? bytes : bytes.subarray(0, newline)));
      if (newline >= 0) return Buffer.concat(chunks).toString();
    }
  }

  protectedAlert(msg = "") {
    return this.runProtectedPrompt("alert", undefined, [String(msg)]);
  }

  protectedConfirm(msg = "") {
    return this.runProtectedPrompt("confirm", false, [String(msg)]);
  }

  protectedPrompt(msg = "", defaultValue = "") {
    return this.runProtectedPrompt(
      "prompt",
      defaultValue,
      [String(msg), String(defaultValue)],
    );
  }

  restoreProtectedPrompts() {
    const saved = this._protectedPrompts;
    if (!saved) return;
    for (const name of ["alert", "confirm", "prompt"]) {
      if (saved[name].had) globalThis[name] = saved[name].value;
      else delete globalThis[name];
    }
    this._protectedPrompts = null;
    this._protectedPromptGlobals = null;
  }

  layoutEditorArea() {
    const promptHeight = this.prompt ? 1 : 0;
    const tabBarHeight = this.tabs.length > 1 ? 1 : 0;
    const keymenuHeight = this.keymenu ? KEYDISPLAY.length : 0;
    const activeSuggestions = this._activeSuggestions();
    const activeSuggestionIdx = this._activeSuggestionIdx();
    const formatWarning = this.buffer?.filetype === "shell" && this.buffer?.fileformat === "dos"
      ? "dos(CRLF fileformat) invalid for shell scripts!"
      : "";
    const activeMessage = this.message || this.buffer?.message || formatWarning;
    if (activeSuggestions.length === 0) this._acHScroll = 0;
    const suggestionsHeight = activeSuggestions.length > 1 ? 1 : 0;
    const messageHeight = suggestionsHeight ? 0 : activeMessage ? 1 : 0;
    const infoHeight = suggestionsHeight + messageHeight;
    const editorAreaTop = tabBarHeight;
    const editorAreaH = Math.max(1, this.rows - 1 - promptHeight - tabBarHeight - keymenuHeight - infoHeight);
    const statusRow = this.rows - promptHeight - 1;

    for (const tab of this.tabs) computeLayout(tab.root, 0, editorAreaTop, this.cols, editorAreaH);

    return {
      tabBarHeight,
      keymenuHeight,
      activeSuggestions,
      activeSuggestionIdx,
      activeMessage,
      suggestionsHeight,
      messageHeight,
      statusRow,
    };
  }

  render() {
    if (!this.running) return;
    const tab = this.tab;
    const {
      tabBarHeight,
      keymenuHeight,
      activeSuggestions,
      activeSuggestionIdx,
      activeMessage,
      suggestionsHeight,
      messageHeight,
      statusRow,
    } = this.layoutEditorArea();

    const defaultStyle = this.context.colorscheme?.defaultStyle ?? {};
    this.screen.fill(" ", defaultStyle);
    this._kittyFrameImages = [];

    this.tabRects = [];
    if (tabBarHeight) this.renderTabbar(defaultStyle);

    // Center scroll for any buffer restored from savecursor (deferred until layout is known)
    for (const p of tab.panes()) {
      if (p.buffer?._pendingCenterScroll) {
        delete p.buffer._pendingCenterScroll;
        this.scrollCursorToCenter(p);
      }
    }

    // Render each pane
    for (const p of tab.panes()) {
      if (p.type === "term") this.renderTermPane(p, defaultStyle);
      else this.renderEditorPane(p, defaultStyle);
    }

    // Draw split dividers
    this.renderDividers(tab.root, defaultStyle);

    // Key menu (toggled by Alt-g)
    if (this.keymenu) this.renderKeyMenu(defaultStyle, statusRow);

    // Info row: autocomplete candidates take precedence over messages.
    if (suggestionsHeight) {
      const suggestionsRow = statusRow - keymenuHeight - 1;
      this.renderSuggestions(defaultStyle, suggestionsRow, activeSuggestions, activeSuggestionIdx);
    } else {
      this._suggestionsRow = null;
      if (messageHeight) {
        const messageRow = statusRow - keymenuHeight - 1;
        this.renderMessageRow(defaultStyle, messageRow, activeMessage);
      }
    }

    // Status bar
    const activePaneObj = this.pane;
    const buf = this.buffer;
    const dirty = activePaneObj?.modified ? " *" : "";
    const name = activePaneObj?.name ?? "No name";
    const rowNum = buf ? `${buf.cursor.y + 1}` : "1";
    const colNum = buf ? `${buf.cursor.x + 1}` : "1";
    const ft = (buf?.filetype && buf.filetype !== "unknown") ? buf.filetype : "?";
    const fmt = buf?.fileformat ?? "unix";
    const enc = buf?.encoding ?? "utf-8";
    const baseStatus = this.context.colorscheme?.styles?.has("statusline")
      ? this.context.colorscheme.get("statusline")
      : { ...defaultStyle, reverse: true };
    const redStatus = { ...baseStatus, fg: "red" };
    // Fill entire row with base style first
    putText(this.screen, 0, statusRow, " ".repeat(this.cols), baseStatus, this.cols);
    // Render segments and record clickable zones
    this._statusBarRow = statusRow;
    this._statusBarRects = [];
    const markZone = (type, start, end) => this._statusBarRects.push({ type, start, end });
    let sx = 0, x0;
    // name
    x0 = sx;
    sx = putText(this.screen, sx, statusRow, ` ${name}`, isReadonlyBuffer(buf) ? redStatus : baseStatus, this.cols - sx);
    markZone("name", x0, sx);
    if (dirty) {
      x0 = sx;
      sx = putText(this.screen, sx, statusRow, dirty, baseStatus, this.cols - sx);
      markZone("dirty", x0, sx);
    }
    sx = putText(this.screen, sx, statusRow, " ", baseStatus, this.cols - sx);
    // (row,col)
    sx = putText(this.screen, sx, statusRow, "(", baseStatus, this.cols - sx);
    x0 = sx;
    sx = putText(this.screen, sx, statusRow, rowNum, isDirtyLongLine(buf, buf?.cursor?.y) ? redStatus : baseStatus, this.cols - sx);
    markZone("row", x0, sx);
    sx = putText(this.screen, sx, statusRow, ",", baseStatus, this.cols - sx);
    x0 = sx;
    sx = putText(this.screen, sx, statusRow, colNum, baseStatus, this.cols - sx);
    markZone("col", x0, sx);
    sx = putText(this.screen, sx, statusRow, ")", baseStatus, this.cols - sx);
    // ⧉ separator (ctrl-t = add tab) then ft
    sx = putText(this.screen, sx, statusRow, " ", baseStatus, this.cols - sx);
    x0 = sx;
    sx = putText(this.screen, sx, statusRow, "⧉", baseStatus, this.cols - sx);
    markZone("addtab", x0, sx);
    sx = putText(this.screen, sx, statusRow, " ft:", baseStatus, this.cols - sx);
    x0 = sx;
    sx = putText(this.screen, sx, statusRow, ft, baseStatus, this.cols - sx);
    markZone("ft", x0, sx);
    // € separator (ctrl-e = command mode) then fmt
    sx = putText(this.screen, sx, statusRow, " ", baseStatus, this.cols - sx);
    x0 = sx;
    sx = putText(this.screen, sx, statusRow, "€", baseStatus, this.cols - sx);
    markZone("cmdmode", x0, sx);
    sx = putText(this.screen, sx, statusRow, " ", baseStatus, this.cols - sx);
    x0 = sx;
    sx = putText(this.screen, sx, statusRow, fmt, fmt === "dos" ? redStatus : baseStatus, this.cols - sx);
    markZone("fmt", x0, sx);
    // $ separator (ctrl-b = shell mode) then enc
    sx = putText(this.screen, sx, statusRow, " ", baseStatus, this.cols - sx);
    x0 = sx;
    sx = putText(this.screen, sx, statusRow, "$", baseStatus, this.cols - sx);
    markZone("shellmode", x0, sx);
    sx = putText(this.screen, sx, statusRow, " ", baseStatus, this.cols - sx);
    x0 = sx;
    sx = putText(this.screen, sx, statusRow, enc, enc !== "utf-8" ? redStatus : baseStatus, this.cols - sx);
    markZone("enc", x0, sx);
    // Alt-G keymenu toggle button
    sx = putText(this.screen, sx, statusRow, " | ", baseStatus, this.cols - sx);
    x0 = sx;
    sx = putText(this.screen, sx, statusRow, "Alt-G", baseStatus, this.cols - sx);
    markZone("keymenu", x0, sx);
    if (this.prompt) {
      const promptRow = this.rows - 1;
      const promptStyle = { fg: "default", bg: "default", bold: false, italic: false, underline: false, reverse: false };
      putText(this.screen, 0, promptRow, " ".repeat(this.cols), promptStyle, this.cols);
      const totalText = this.prompt.label + this.prompt.value;
      const labelW = displayWidth(this.prompt.label);
      const cursorInTotal = labelW + displayWidth(this.prompt.value.slice(0, this.prompt.cursor));
      let scrollX = this._promptScrollX ?? 0;
      if (cursorInTotal > scrollX + this.cols - 1) scrollX = cursorInTotal - (this.cols - 1);
      if (cursorInTotal < scrollX) scrollX = cursorInTotal;
      scrollX = Math.max(0, scrollX);
      this._promptScrollX = scrollX;
      const startIdx = scrollX > 0 ? visualColToCharIdx(totalText, 0, scrollX) : 0;
      putText(this.screen, 0, promptRow, totalText.slice(startIdx), promptStyle, this.cols);
      this.screen.setCursor(cursorInTotal - scrollX, promptRow, true, "bar");
    }

    // Cursor — term pane sets its own cursor in renderTermPane, editor sets it here
    if (!this.prompt && activePaneObj?.type === "editor" && buf) {
      const p = activePaneObj;
      const gutterW = editorGutterWidth(buf);
      const bufW = Math.max(1, p.w - gutterW);
      const softwrap = buf.Settings?.softwrap ?? false;
      const wordwrap = softwrap && (buf.Settings?.wordwrap ?? false);
      const tabsize = buf.Settings?.tabsize ?? DEFAULT_SETTINGS.tabsize;

      let cursorRow, cursorCol;
      if (softwrap) {
        const scrollSloc = { line: buf.scroll.y, row: buf.scroll.row ?? 0 };
        const cursorLine = buf.lines[buf.cursor.y] ?? "";
        const cursorX = normalizeCharBoundary(cursorLine, buf.cursor.x);
        const cursorBreaks = softwrapBreaks(cursorLine, bufW, wordwrap, tabsize);
        const cursorSubRow = softwrapRowOfCharIdx(cursorBreaks, cursorX);
        const cursorSloc = { line: buf.cursor.y, row: cursorSubRow };
        const cursorAbove = cursorSloc.line < scrollSloc.line ||
          (cursorSloc.line === scrollSloc.line && cursorSloc.row < scrollSloc.row);
        const visualRowOffset = cursorAbove
          ? -slocDiff(buf.lines, cursorSloc, scrollSloc, bufW, wordwrap, tabsize)
          : slocDiff(buf.lines, scrollSloc, cursorSloc, bufW, wordwrap, tabsize);
        cursorRow = p.y + visualRowOffset;
        const segStart = cursorBreaks[cursorSubRow] ?? 0;
        cursorCol = p.x + gutterW + displayWidth(cursorLine.slice(segStart, cursorX));
      } else {
        const line = buf.line();
        const cursorX = normalizeCharBoundary(line, buf.cursor.x);
        cursorRow = p.y + buf.cursor.y - buf.scroll.y;
        cursorCol = p.x + gutterW + displayWidth(line.slice(buf.scroll.x, cursorX));
      }

      // Go micro hides the terminal cursor while a non-empty selection is
      // active. Otherwise its block cursor makes the exclusive selection end
      // look selected even though copy/cut correctly omit that character.
      const hasSelection = p.selection && !sameLoc(p.selection.start, p.selection.end);
      const cursorVisible = !hasSelection &&
        cursorRow >= p.y && cursorRow < p.y + p.h &&
        cursorCol >= p.x && cursorCol < p.x + p.w;
      this.screen.setCursor(
        clamp(cursorCol, 0, this.cols - 1),
        clamp(cursorRow, 0, this.rows - 1),
        cursorVisible,
        DEFAULT_SETTINGS.cursorshape,
      );
    } else if (!this.prompt && activePaneObj?.type !== "term") {
      this.screen.setCursor(0, 0, false);
    }

    this.screen.setKittyImages(this._kittyFrameImages);
    this.screen.show();
  }

  renderMessageRow(defaultStyle, row, message) {
    const style = this.context.colorscheme?.styles?.has("message")
      ? this.context.colorscheme.get("message")
      : defaultStyle;
    putText(this.screen, 0, row, " ".repeat(this.cols), style, this.cols);
    this._messageRowY = row;
    this._messageRowClickZone = null;
    const msg = String(message);
    // detect [AltMethod] prefix — render it underlined as a clickable button
    if (this._messageClickAction && msg.startsWith("[")) {
      const close = msg.indexOf("]");
      if (close > 0) {
        const btnText = msg.slice(0, close + 1);
        const rest = msg.slice(close + 1);
        const btnStyle = { ...style, underline: true };
        let sx = putText(this.screen, 0, row, btnText, btnStyle, this.cols);
        putText(this.screen, sx, row, rest.slice(0, this.cols - sx), style, this.cols - sx);
        this._messageRowClickZone = { start: 0, end: sx };
        return;
      }
    }
    putText(this.screen, 0, row, msg.slice(0, this.cols), style, this.cols);
  }

  renderKeyMenu(defaultStyle, statusRow) {
    for (let i = 0; i < KEYDISPLAY.length; i++) {
      const row = statusRow - KEYDISPLAY.length + i;
      const line = KEYDISPLAY[i].padEnd(this.cols).slice(0, this.cols);
      putText(this.screen, 0, row, line, defaultStyle, this.cols);
    }
  }

  renderSuggestions(defaultStyle, row, suggestions, curIdx) {
    const cs = this.context.colorscheme;
    const baseStyle = cs?.styles?.has("statusline.suggestions")
      ? cs.get("statusline.suggestions")
      : cs?.styles?.has("statusline")
        ? cs.get("statusline")
        : { ...defaultStyle, reverse: true };
    const selStyle = {
      ...baseStyle,
      reverse: true,
    };

    // Compute each item's position in the virtual (pre-scroll) space.
    const positions = [];
    let pos = 0;
    for (const s of suggestions) {
      const wordEnd = pos + s.length;
      positions.push({ start: pos, wordEnd, end: wordEnd + 1 });
      pos = wordEnd + 1;
    }
    const totalWidth = pos;

    // Adjust horizontal scroll so curIdx is always visible.
    if (curIdx >= 0 && curIdx < positions.length) {
      const { start, wordEnd } = positions[curIdx];
      if (wordEnd - this._acHScroll > this.cols) this._acHScroll = wordEnd - this.cols;
      if (start - this._acHScroll < 0) this._acHScroll = start;
    }
    const hscroll = this._acHScroll;

    // Fill row.
    putText(this.screen, 0, row, " ".repeat(this.cols), baseStyle, this.cols);

    const hasLeft = hscroll > 0;
    const hasRight = totalWidth - hscroll > this.cols;
    const viewLeft = hasLeft ? 1 : 0;
    const viewRight = hasRight ? this.cols - 1 : this.cols;

    if (hasLeft) putText(this.screen, 0, row, "<", baseStyle, 1);
    if (hasRight) putText(this.screen, this.cols - 1, row, ">", baseStyle, 1);

    this._suggestionsRow = row;
    this._suggestionRects = [];

    for (let i = 0; i < suggestions.length; i++) {
      const { start, wordEnd, end } = positions[i];
      const scrStart = start - hscroll;
      const scrWordEnd = wordEnd - hscroll;
      const scrEnd = end - hscroll;
      if (scrEnd <= viewLeft) continue;
      if (scrStart >= viewRight) break;

      const word = suggestions[i];
      const wordClipL = Math.max(0, viewLeft - scrStart);
      const wordClipR = Math.min(word.length, viewRight - scrStart);
      if (wordClipR > wordClipL) {
        const drawX = Math.max(viewLeft, scrStart);
        const style = i === curIdx ? selStyle : baseStyle;
        putText(this.screen, drawX, row, word.slice(wordClipL, wordClipR), style, viewRight - drawX);
      }

      if (scrWordEnd >= viewLeft && scrWordEnd < viewRight) {
        putText(this.screen, scrWordEnd, row, " ", baseStyle, 1);
      }

      const zoneStart = Math.max(viewLeft, scrStart);
      const zoneEnd = Math.min(viewRight, scrWordEnd);
      if (zoneEnd > zoneStart) this._suggestionRects.push({ index: i, start: zoneStart, end: zoneEnd });
    }
  }

  _activeSuggestions() {
    const buf = this.buffer;
    if (buf?.acHas && buf.acSuggestions.length > 1) return buf.acSuggestions;
    if (this.prompt?.completions?.length > 1) return this.prompt.completionLabels?.length > 1 ? this.prompt.completionLabels : this.prompt.completions;
    return [];
  }

  _activeSuggestionIdx() {
    const buf = this.buffer;
    if (buf?.acHas) return buf.acCurIdx;
    if (this.prompt?.completions?.length > 1) return this.prompt.completionIndex;
    return -1;
  }

  gotoLocation(buf, loc, pane = this.pane) {
    if (!buf) return;
    if (!loc?.subRow) {
      buf.gotoLoc(loc.line, loc.col);
      return;
    }
    buf.gotoLoc(loc.line, 1);
    this.applyVisualGoto(buf, pane, loc.subRow, loc.col);
  }

  applyVisualGoto(buf, pane, subRow, col = 1) {
    if (!buf || !pane) return;
    const softwrap = buf.Settings?.softwrap ?? false;
    if (!softwrap) {
      buf.gotoLoc(buf.cursor.y + 1, col);
      return;
    }
    const gutterW = editorGutterWidth(buf);
    const bufW = Math.max(1, pane.w - gutterW);
    const wordwrap = buf.Settings?.wordwrap ?? false;
    const tabsize = buf.Settings?.tabsize ?? DEFAULT_SETTINGS.tabsize;
    const line = buf.lines[buf.cursor.y] ?? "";
    const breaks = softwrapBreaks(line, bufW, wordwrap, tabsize);
    const targetSubRow = clamp(Math.trunc(Number(subRow) || 0), 0, Math.max(0, breaks.length - 1));
    const segStart = breaks[targetSubRow] ?? 0;
    buf.cursor.x = visualColToCharIdx(line, segStart, Math.max(0, Math.trunc(Number(col) || 1) - 1));
    buf.ensureCursor();
  }

  applyPendingVisualGoto(pane) {
    const pending = pane?.buffer?._pendingVisualGoto;
    if (!pending) return;
    delete pane.buffer._pendingVisualGoto;
    this.applyVisualGoto(pane.buffer, pane, pending.subRow, pending.col);
  }

  renderEditorPane(pane, defaultStyle) {
    const buf = pane.buffer;
    if (!buf) return;
    this.applyPendingVisualGoto(pane);
    this.updateScrollForPane(pane);
    const gutterW = editorGutterWidth(buf);
    const braceMatches = findMatchingBracePositions(buf);
    const maxW = Math.max(0, pane.w - gutterW);
    const softwrap = buf.Settings?.softwrap ?? false;
    const wordwrap = softwrap && (buf.Settings?.wordwrap ?? false);
    const tabsize = buf.Settings?.tabsize ?? DEFAULT_SETTINGS.tabsize;
    const isActivePane = pane === this.tab.activePane;
    const gutterStyle = this.context.colorscheme?.styles?.has("line-number")
      ? this.context.colorscheme.get("line-number")
      : defaultStyle;
    const cursorlineOn = buf.Settings?.cursorline ?? DEFAULT_SETTINGS.cursorline;
    const csHasCurNum = this.context.colorscheme?.styles?.has("current-line-number");
    const curNumStyle = !csHasCurNum
      ? defaultStyle
      : (cursorlineOn ? this.context.colorscheme.get("current-line-number") : gutterStyle);
    const dirtyGutterStyle = { ...gutterStyle, fg: "red" };
    const useCursorline = (buf.Settings?.cursorline ?? DEFAULT_SETTINGS.cursorline) && isActivePane;
    const clBg = (useCursorline && this.context.colorscheme?.styles?.has("cursor-line"))
      ? (this.context.colorscheme.get("cursor-line")?.fg ?? null)
      : null;

    const addKittyImage = (lineNo, screenRow, subRow = 0) => {
      if (subRow !== 0 || !Array.isArray(buf._mdcuiImages)) return;
      for (const image of buf._mdcuiImages) {
        if (image.line !== lineNo) continue;
        const { cols, rows } = fitKittyImageToWidth(image, maxW);
        const visibleTop = Math.max(pane.y, screenRow);
        const visibleBottom = Math.min(pane.y + pane.h, screenRow + rows);
        const visibleRows = visibleBottom - visibleTop;
        if (visibleRows < 1 || cols < 1) continue;
        const clippedTopRows = visibleTop - screenRow;
        const pixelHeight = Math.max(1, Math.trunc(Number(image.pixelHeight) || 1));
        const sourceY = Math.min(pixelHeight - 1, Math.round(pixelHeight * clippedTopRows / rows));
        const sourceBottom = Math.min(pixelHeight, Math.round(pixelHeight * (clippedTopRows + visibleRows) / rows));
        const sourceHeight = Math.max(1, sourceBottom - sourceY);
        const sourceWidth = Math.max(1, Math.trunc(Number(image.pixelWidth) || 1));
        const x = pane.x + gutterW;
        const placementId = ((image.id ^ Math.imul(x + 1, 73856093) ^ Math.imul(visibleTop + 1, 19349663) ^ Math.imul(sourceY + 1, 83492791)) >>> 0) % 2147483646 + 1;
        logKittyPlacement("app-placement", {
          buffer: buf.path,
          imagePath: image.path,
          imageId: image.id,
          placementId,
          imageLogicalLine: image.line,
          renderedLine: lineNo,
          subRow,
          pane: { x: pane.x, y: pane.y, width: pane.w, height: pane.h },
          scroll: { ...buf.scroll },
          gutterWidth: gutterW,
          maxWidth: maxW,
          screenX: x,
          nominalScreenY: screenRow,
          screenY: visibleTop,
          cols,
          rows: visibleRows,
          originalCols: image.cols,
          originalRows: image.rows,
          sourceRect: { x: 0, y: sourceY, width: sourceWidth, height: sourceHeight },
        });
        this._kittyFrameImages.push({
          ...image,
          x,
          y: visibleTop,
          cols,
          rows: visibleRows,
          sourceX: 0,
          sourceY,
          sourceWidth,
          sourceHeight,
          placementId,
        });
      }
    };

    const hasDiff   = (buf.Settings?.diffgutter ?? false) && !!buf.diffBase;
    if (hasDiff && !buf._diffOnUpdate) buf._diffOnUpdate = () => this.render();
    const diffMarks = hasDiff ? getDiffMarkers(buf) : null;
    const msgW      = (buf.Messages?.length ?? 0) > 0 ? 2 : 0;
    const diffCol   = (buf.Settings?.diffgutter ?? false) ? 1 : 0;
    const lineNumW  = gutterW - msgW - diffCol;
    const cs = this.context.colorscheme;
    const diffAddStyle = cs?.styles?.has("diff-added") ? cs.get("diff-added") : null;
    const diffModStyle = cs?.styles?.has("diff-modified") ? cs.get("diff-modified") : null;
    const diffDelStyle = cs?.styles?.has("diff-deleted") ? cs.get("diff-deleted") : null;
    const msgInfoStyle = cs?.styles?.has("gutter-info") ? cs.get("gutter-info") : defaultStyle;
    const msgWarnStyle = cs?.styles?.has("gutter-warning") ? cs.get("gutter-warning") : defaultStyle;
    const msgErrStyle = cs?.styles?.has("gutter-error") ? cs.get("gutter-error") : defaultStyle;

    // When the image anchor has scrolled above the pane, its lower portion can
    // still intersect the viewport. It will not be encountered by the normal
    // visible-line loop, so add that clipped placement explicitly.
    for (const image of buf._mdcuiImages ?? []) {
      if (image.line >= buf.scroll.y) continue;
      const nominalScreenRow = pane.y + image.line - buf.scroll.y;
      const { rows } = fitKittyImageToWidth(image, maxW);
      if (nominalScreenRow < pane.y && nominalScreenRow + rows > pane.y) {
        addKittyImage(image.line, nominalScreenRow);
      }
    }

    const renderGutter = (lineNo, row, screenRow, subRow = 0) => {
      // Message indicator: 2 cols, '> ' with kind-based style (Go: drawGutter)
      if (msgW > 0) {
        let msgCh = " ", msgSt = gutterStyle;
        if (subRow === 0) {
          for (const m of buf.Messages ?? []) {
            if (m.Start.Y === lineNo || m.End.Y === lineNo) {
              msgCh = ">";
              msgSt = m.Kind === 2 ? msgErrStyle : m.Kind === 1 ? msgWarnStyle : msgInfoStyle;
              break;
            }
          }
        }
        putText(this.screen, pane.x, screenRow, msgCh + " ", msgSt, 2);
      }
      const isCurrentLine = isActivePane && !pane.selection && lineNo === buf.cursor.y;
      const lineStyle = isCurrentLine ? curNumStyle : gutterStyle;
      if (diffCol > 0) {
        const m = diffMarks?.[lineNo] ?? 0;
        const [ch, colorStyle] = m === 1 ? ["▌", diffAddStyle]
                              : m === 2 ? ["▌", diffModStyle]
                              : m === 3 ? ["▔", diffDelStyle]
                              : [" ", null];
        const st = colorStyle ? { ...lineStyle, fg: colorStyle.fg } : lineStyle;
        putText(this.screen, pane.x + msgW, screenRow, subRow === 0 ? ch : " ", st, 1);
      }
      if (lineNumW > 0) {
        const prefix = subRow === 0
          ? lineNumberText(buf, lineNo, row, lineNumW)
          : visualLineNumberText(subRow, lineNumW);
        putText(this.screen, pane.x + msgW + diffCol, screenRow, prefix, isDirtyLongLine(buf, lineNo) ? dirtyGutterStyle : lineStyle, lineNumW);
      }
    };

    if (!softwrap) {
      for (let row = 0; row < pane.h; row++) {
        const lineNo = buf.scroll.y + row;
        const screenRow = pane.y + row;
        const isCL = clBg && lineNo === buf.cursor.y && !pane.selection;
        if (gutterW > 0) renderGutter(lineNo, row, screenRow);
        if (lineNo < buf.lines.length) {
          const cells = renderHighlightedCells(buf, lineNo, buf.scroll.x, maxW, this.context.colorscheme, pane.selection, getLineSearchRanges(buf, lineNo), braceMatches, isCL ? clBg : null);
          putCells(this.screen, pane.x + gutterW, screenRow, cells, maxW);
          addKittyImage(lineNo, screenRow);
        }
      }
    } else {
      let sloc = { line: buf.scroll.y, row: buf.scroll.row ?? 0 };
      let _swBreaksLineNo = -1, _swBreaks = null;
      let _swSearchLineNo = -1, _swSearchRanges = [];
      for (let screenY = 0; screenY < pane.h; screenY++) {
        const screenRow = pane.y + screenY;
        const { line: lineNo, row: subRow } = sloc;

        if (lineNo >= buf.lines.length) break;

        const lineStr = buf.lines[lineNo] ?? "";
        if (lineNo !== _swBreaksLineNo) { _swBreaks = softwrapBreaks(lineStr, maxW, wordwrap, tabsize); _swBreaksLineNo = lineNo; }
        if (lineNo !== _swSearchLineNo) { _swSearchRanges = getLineSearchRanges(buf, lineNo); _swSearchLineNo = lineNo; }
        const breaks = _swBreaks;
        const segStart = breaks[subRow] ?? 0;
        const isCL = clBg && lineNo === buf.cursor.y && !pane.selection;

        if (gutterW > 0) renderGutter(lineNo, screenY, screenRow, subRow);

        const cells = renderHighlightedCells(buf, lineNo, segStart, maxW, this.context.colorscheme, pane.selection, _swSearchRanges, braceMatches, isCL ? clBg : null);
        putCells(this.screen, pane.x + gutterW, screenRow, cells, maxW);
        addKittyImage(lineNo, screenRow, subRow);

        if (subRow + 1 < breaks.length) {
          sloc = { line: lineNo, row: subRow + 1 };
        } else {
          sloc = { line: lineNo + 1, row: 0 };
        }
      }
    }
  }

  renderTermPane(pane, defaultStyle) {
    if (!pane.terminal) return;
    const isActive = pane === this.tab.activePane;
    const vt = pane.terminal.vt;
    const titleStyle = { ...defaultStyle, reverse: true };
    const scrollMsg = vt && vt.scrollOffset > 0
      ? ` -- SCROLLBACK (${vt.scrollOffset}/${vt.scrollback.length}) wheel↑↓ to browse, any key to return`
      : (isActive ? " [Esc: close  Ctrl-W: switch pane]" : "");
    putText(this.screen, pane.x, pane.y, ` Terminal${scrollMsg}`.padEnd(pane.w), titleStyle, pane.w);
    if (!vt) return;
    const renderRows = pane.h - 1;
    for (let row = 0; row < renderRows; row++) {
      const vtRow = vt.getRow(row);
      for (let col = 0; col < Math.min(pane.w, vt.cols); col++) {
        const cell = vtRow[col];
        if (!cell) continue;
        const style = {
          fg: cell.fg, bg: cell.bg,
          bold: cell.bold, italic: cell.italic,
          underline: cell.underline, reverse: cell.reverse,
        };
        if (cell.filler) {
          this.screen.setFillerContent(pane.x + col, pane.y + 1 + row, style);
          continue;
        }
        this.screen.setContent(pane.x + col, pane.y + 1 + row, cell.ch || " ", style, cell.combining ?? []);
      }
    }
    // Show VT cursor only when live (not scrolled back) and active
    if (isActive && !this.prompt && vt.scrollOffset === 0) {
      const cx = clamp(pane.x + vt.cx, 0, this.cols - 1);
      const cy = clamp(pane.y + 1 + vt.cy, 0, this.rows - 1);
      this.screen.setCursor(cx, cy, true);
    }
  }

  renderDividers(node, defaultStyle) {
    if (node instanceof Pane) return;
    const divReverse = this.context.config?.globalSettings?.divreverse ?? true;
    const baseDiv = this.context.colorscheme?.styles?.has("divider")
      ? this.context.colorscheme.get("divider")
      : defaultStyle;
    const divStyle = divReverse ? { ...baseDiv, reverse: true } : baseDiv;
    for (let i = 0; i < node.children.length - 1; i++) {
      const child = node.children[i];
      if (node.dir === "h") {
        const divX = child.x + child.w;
        for (let r = node.y; r < node.y + node.h; r++)
          this.screen.setContent(divX, r, "│", divStyle);
      } else {
        const divY = child.y + child.h;
        for (let c = node.x; c < node.x + node.w; c++)
          this.screen.setContent(c, divY, "─", divStyle);
      }
    }
    for (const child of node.children) this.renderDividers(child, defaultStyle);
  }

  renderTabbar(defaultStyle) {
    const cs = this.context.colorscheme;
    const gs = this.context.config?.globalSettings;
    const tabReverse = gs?.tabreverse ?? true;
    const tabHighlight = gs?.tabhighlight ?? false;
    const tabCharReverse = (tabReverse || tabHighlight) && !(tabReverse && tabHighlight);

    const stylesFor = (reverse) => {
      const base = cs?.styles?.has("tabbar")
        ? cs.get("tabbar")
        : { ...defaultStyle, reverse };
      const active = cs?.styles?.has("tabbar.active")
        ? cs.get("tabbar.active")
        : base;
      return [base, active];
    };
    const [sepStyle] = stylesFor(tabReverse);
    const [charBase, charActive] = stylesFor(tabCharReverse);

    let x = 0;
    for (let i = 0; i < this.tabs.length && x < this.cols; i++) {
      const name = this.tabs[i].name || "No name";
      const isActive = i === this.activeTabIdx;
      const label = isActive ? `[${name}]` : ` ${name} `;
      const style = isActive ? charActive : charBase;
      const start = x;
      x = putText(this.screen, x, 0, label, style, this.cols - x);
      this.tabRects.push({ index: i, start, end: x });
      if (i < this.tabs.length - 1 && x < this.cols)
        x = putText(this.screen, x, 0, "  ", sepStyle, this.cols - x);
    }
    if (x < this.cols) putText(this.screen, x, 0, " ".repeat(this.cols - x), sepStyle, this.cols - x);
  }

  updateScrollForPane(pane) {
    const buf = pane.buffer;
    if (!buf) return;
    const height = pane.h;
    const gutterW = editorGutterWidth(buf);
    const bufW = Math.max(1, pane.w - gutterW);
    const softwrap = buf.Settings?.softwrap ?? false;
    const wordwrap = softwrap && (buf.Settings?.wordwrap ?? false);
    const tabsize = buf.Settings?.tabsize ?? DEFAULT_SETTINGS.tabsize;

    if (softwrap) {
      buf.scroll.x = 0;
      buf.scroll.row = buf.scroll.row ?? 0;

      const cursorBreaks = softwrapBreaks(buf.lines[buf.cursor.y] ?? "", bufW, wordwrap, tabsize);
      const cursorSubRow = softwrapRowOfCharIdx(cursorBreaks, buf.cursor.x);
      const cursorSloc = { line: buf.cursor.y, row: cursorSubRow };
      const scrollSloc = { line: buf.scroll.y, row: buf.scroll.row };

      if (!buf.allowCursorOffscreen) {
        if (cursorSloc.line < scrollSloc.line ||
            (cursorSloc.line === scrollSloc.line && cursorSloc.row < scrollSloc.row)) {
          buf.scroll.y = cursorSloc.line;
          buf.scroll.row = cursorSloc.row;
        } else {
          const cursorScreenRow = slocDiff(buf.lines, scrollSloc, cursorSloc, bufW, wordwrap, tabsize);
          if (cursorScreenRow >= height) {
            const newScroll = slocAdvanceN(buf.lines, scrollSloc, cursorScreenRow - height + 1, bufW, wordwrap, tabsize);
            buf.scroll.y = newScroll.line;
            buf.scroll.row = newScroll.row;
          }
        }
      }
    } else {
      const visibleCols = bufW;
      const margin = buf.Settings?.scrollmargin ?? DEFAULT_SETTINGS.scrollmargin;
      if (!buf.allowCursorOffscreen) {
        if (buf.cursor.y < buf.scroll.y + margin) buf.scroll.y = Math.max(0, buf.cursor.y - margin);
        if (buf.cursor.y >= buf.scroll.y + height - margin) buf.scroll.y = Math.max(0, buf.cursor.y - height + 1 + margin);
      }
      const line = buf.lines[buf.cursor.y] ?? "";
      if (buf.cursor.x < buf.scroll.x) {
        buf.scroll.x = buf.cursor.x;
      } else {
        if (displayWidthRangeAtLeast(line, buf.scroll.x, buf.cursor.x, visibleCols)) {
          buf.scroll.x = charIdxForScrollRight(line, buf.cursor.x, visibleCols);
        }
      }
    }
  }

  // Align the current cursor line to the start, center, or end of the pane.
  scrollCursorToAlignment(pane, block = "center") {
    const buf = pane?.buffer;
    if (!buf) return;
    const gutterW = editorGutterWidth(buf);
    const bufW = Math.max(1, pane.w - gutterW);
    const softwrap = buf.Settings?.softwrap ?? false;
    const wordwrap = softwrap && (buf.Settings?.wordwrap ?? false);
    const tabsize = buf.Settings?.tabsize ?? DEFAULT_SETTINGS.tabsize;
    const offset = block === "start"
      ? 0
      : block === "end"
        ? Math.max(0, pane.h - 1)
        : Math.floor(pane.h / 2);

    if (softwrap) {
      const cursorBreaks = softwrapBreaks(buf.lines[buf.cursor.y] ?? "", bufW, wordwrap, tabsize);
      const cursorSubRow = softwrapRowOfCharIdx(cursorBreaks, buf.cursor.x);
      const cursorSloc = { line: buf.cursor.y, row: cursorSubRow };
      const newScroll = slocRetreatN(buf.lines, cursorSloc, offset, bufW, wordwrap, tabsize);
      buf.scroll.y = newScroll.line;
      buf.scroll.row = newScroll.row;
      buf.scroll.x = 0;
    } else {
      buf.scroll.y = Math.max(0, buf.cursor.y - offset);
      buf.scroll.row = 0;
    }
  }

  // Center the current cursor line vertically in the pane.
  scrollCursorToCenter(pane) {
    this.scrollCursorToAlignment(pane, "center");
  }

  scrollCursorToBoundary(pane, boundary) {
    const buf = pane?.buffer;
    if (!buf) return;
    const gutterW = editorGutterWidth(buf);
    const bufW = Math.max(1, (pane?.w ?? this.cols) - gutterW);
    const softwrap = buf.Settings?.softwrap ?? false;
    const wordwrap = softwrap && (buf.Settings?.wordwrap ?? false);
    const tabsize = buf.Settings?.tabsize ?? DEFAULT_SETTINGS.tabsize;
    if (boundary === "start") {
      buf.scroll = { x: 0, y: 0, row: 0 };
      return;
    }
    if (softwrap) {
      const breaks = softwrapBreaks(buf.lines[buf.cursor.y] ?? "", bufW, wordwrap, tabsize);
      const cursorSubRow = softwrapRowOfCharIdx(breaks, buf.cursor.x);
      buf.scroll.x = 0;
      buf.scroll.y = buf.cursor.y;
      buf.scroll.row = Math.max(0, cursorSubRow - Math.max(1, pane.h) + 1);
    } else {
      buf.scroll.y = Math.max(0, buf.cursor.y - Math.max(1, pane.h) + 1);
      buf.scroll.row = 0;
      buf.scroll.x = charIdxForScrollRight(buf.lines[buf.cursor.y] ?? "", buf.cursor.x, bufW);
    }
  }

  pageScroll(pane, delta, amount = null) {
    const buf = pane?.buffer;
    if (!buf) return;
    const gutterW = editorGutterWidth(buf);
    const bufW = Math.max(1, (pane?.w ?? this.cols) - gutterW);
    const softwrap = buf.Settings?.softwrap ?? false;
    const wordwrap = softwrap && (buf.Settings?.wordwrap ?? false);
    const tabsize = buf.Settings?.tabsize ?? DEFAULT_SETTINGS.tabsize;
    const pageOverlap = Math.trunc(Number(buf.Settings?.pageoverlap ?? DEFAULT_SETTINGS.pageoverlap) || 0);
    const scrollAmount = amount ?? Math.max(1, (pane?.h ?? this.rows) - pageOverlap);

    if (softwrap) {
      const start = { line: buf.scroll.y, row: buf.scroll.row ?? 0 };
      const next = delta < 0
        ? slocRetreatN(buf.lines, start, scrollAmount, bufW, wordwrap, tabsize)
        : slocAdvanceN(buf.lines, start, scrollAmount, bufW, wordwrap, tabsize);
      buf.scroll.y = next.line;
      buf.scroll.row = next.row;
      buf.scroll.x = 0;
      if (delta > 0) this.scrollAdjust(pane);
    } else {
      buf.scroll.y = Math.max(0, (buf.scroll.y ?? 0) + delta * scrollAmount);
      buf.scroll.row = 0;
      if (delta > 0) this.scrollAdjust(pane);
    }
    buf.allowCursorOffscreen = true;
  }

  scrollAdjust(pane) {
    const buf = pane?.buffer;
    if (!buf || buf.lines.length === 0) return;
    const gutterW = editorGutterWidth(buf);
    const bufW = Math.max(1, (pane?.w ?? this.cols) - gutterW);
    const softwrap = buf.Settings?.softwrap ?? false;
    const wordwrap = softwrap && (buf.Settings?.wordwrap ?? false);
    const tabsize = buf.Settings?.tabsize ?? DEFAULT_SETTINGS.tabsize;
    if (softwrap) {
      const endLine = Math.max(0, buf.lines.length - 1);
      const endBreaks = softwrapBreaks(buf.lines[endLine] ?? "", bufW, wordwrap, tabsize);
      const end = { line: endLine, row: Math.max(0, endBreaks.length - 1) };
      const start = { line: buf.scroll.y, row: buf.scroll.row ?? 0 };
      if (slocDiff(buf.lines, start, end, bufW, wordwrap, tabsize) < (pane?.h ?? this.rows) - 1) {
        const adjusted = slocRetreatN(buf.lines, end, Math.max(0, (pane?.h ?? this.rows) - 1), bufW, wordwrap, tabsize);
        buf.scroll.y = adjusted.line;
        buf.scroll.row = adjusted.row;
      }
    } else {
      buf.scroll.y = Math.min(buf.scroll.y ?? 0, Math.max(0, buf.lines.length - (pane?.h ?? this.rows)));
    }
  }

  cursorPage(pane, delta, { select = false, amount = null } = {}) {
    const buf = pane?.buffer;
    if (!buf) return;
    const pageOverlap = Math.trunc(Number(buf.Settings?.pageoverlap ?? DEFAULT_SETTINGS.pageoverlap) || 0);
    const selectionEndNewline = !select && delta > 0 && pane.selection?.end?.x === 0;
    let scrollAmount = amount ?? Math.max(1, (pane?.h ?? this.rows) - pageOverlap);
    if (selectionEndNewline) scrollAmount = Math.max(1, scrollAmount - 1);
    const move = () => {
      const softwrap = buf.Settings?.softwrap ?? false;
      if (softwrap) {
        for (let i = 0; i < scrollAmount; i++) {
          if (delta < 0) this._moveUpVisual(buf, pane);
          else this._moveDownVisual(buf, pane);
        }
      } else {
        buf.page(delta, scrollAmount);
      }
    };
    if (select) extendSelection(pane, buf, move);
    else {
      pane.selection = null;
      move();
    }
    if (selectionEndNewline) buf.moveHome();
    this.pageScroll(pane, delta, scrollAmount);
    buf.allowCursorOffscreen = false;
  }

  // Softwrap-aware vertical cursor movement.
  // Moves cursor by one visual row, maintaining the target visual X column.
  _softwrapGetContext(buf, pane) {
    const softwrap = buf.Settings?.softwrap ?? false;
    if (!softwrap) return null;
    const wordwrap = buf.Settings?.wordwrap ?? false;
    const tabsize = buf.Settings?.tabsize ?? DEFAULT_SETTINGS.tabsize;
    const gutterW = editorGutterWidth(buf);
    const bufW = Math.max(1, (pane?.w ?? 80) - gutterW);
    return { wordwrap, tabsize, bufW };
  }

  _moveUpVisual(buf, pane) {
    const ctx = this._softwrapGetContext(buf, pane);
    if (!ctx) { buf.moveUp(); return; }
    const { wordwrap, tabsize, bufW } = ctx;
    const line = buf.lines[buf.cursor.y] ?? "";
    const breaks = softwrapBreaks(line, bufW, wordwrap, tabsize);
    const subRow = softwrapRowOfCharIdx(breaks, buf.cursor.x);
    const segStart = breaks[subRow] ?? 0;
    const targetVisX = buf._lastVisX ?? displayWidth(line.slice(segStart, buf.cursor.x));
    buf._lastVisX = targetVisX;

    if (subRow > 0) {
      const prevSegStart = breaks[subRow - 1];
      buf.cursor.x = visualColToCharIdx(line, prevSegStart, targetVisX);
    } else if (buf.cursor.y > 0) {
      buf.cursor.y--;
      const prevLine = buf.lines[buf.cursor.y] ?? "";
      const prevBreaks = softwrapBreaks(prevLine, bufW, wordwrap, tabsize);
      const lastSub = prevBreaks.length - 1;
      const lastSegStart = prevBreaks[lastSub];
      buf.cursor.x = visualColToCharIdx(prevLine, lastSegStart, targetVisX);
    }
    buf.ensureCursor();
  }

  _moveDownVisual(buf, pane) {
    const ctx = this._softwrapGetContext(buf, pane);
    if (!ctx) { buf.moveDown(); return; }
    const { wordwrap, tabsize, bufW } = ctx;
    const line = buf.lines[buf.cursor.y] ?? "";
    const breaks = softwrapBreaks(line, bufW, wordwrap, tabsize);
    const subRow = softwrapRowOfCharIdx(breaks, buf.cursor.x);
    const segStart = breaks[subRow] ?? 0;
    const targetVisX = buf._lastVisX ?? displayWidth(line.slice(segStart, buf.cursor.x));
    buf._lastVisX = targetVisX;

    if (subRow + 1 < breaks.length) {
      const nextSegStart = breaks[subRow + 1];
      buf.cursor.x = visualColToCharIdx(line, nextSegStart, targetVisX);
    } else if (buf.cursor.y < buf.lines.length - 1) {
      buf.cursor.y++;
      const nextLine = buf.lines[buf.cursor.y] ?? "";
      const nextBreaks = softwrapBreaks(nextLine, bufW, wordwrap, tabsize);
      const nextSegStart = nextBreaks[0] ?? 0;
      buf.cursor.x = visualColToCharIdx(nextLine, nextSegStart, targetVisX);
    }
    buf.ensureCursor();
  }

  async handleInput(rawData) {
    if (this.shellRunning) {
      this._shellResolve?.();
      return;
    }
    if (this._alertRunning) {
      this._alertResolve?.();
      return;
    }

    const data = rawData instanceof Uint8Array
      ? rawData
      : new Uint8Array(rawData);
    await this._dispatchInput(data);
  }

  async _dispatchInput(data) {
    const text = decoder.decode(data);

    // Any non-mouse input clears the clipboard alt-copy action
    {
      const _evts = parseInputEvents(data);
      if (_evts.some(e => e.type !== "mouse")) this._messageClickAction = null;
    }

    // Any non-mouse input stops TTS
    if (this._ttsState) {
      const events = parseInputEvents(data);
      if (events.some(e => e.type !== "mouse")) {
        this.stopTts();
        this.message = "TTS: stopped";
        this.render();
        return;
      }
    }

    // If active pane is a terminal, forward input to it —
    // but intercept tab-bar mouse clicks and pane-switching keys first.
    const activePaneObj = this.pane;
    if (activePaneObj?.type === "term" && activePaneObj.terminal) {
      const events = parseInputEvents(data);
      const mouseEvents = events.filter((event) => event.type === "mouse");
      if (mouseEvents.length > 0) {
        const tabBarHeight = this.tabs.length > 1 ? 1 : 0;
        const vt = activePaneObj.terminal?.vt;
        const forwarded = [];

        for (const ev of mouseEvents) {
          // Tab-bar row belongs to the editor even while a terminal pane is active.
          if (tabBarHeight && ev.y === 0) {
            await this.handleMouse(ev);
            continue;
          }

          // Status bar row: route to editor so tab cycling and other statusbar actions work.
          if (this._statusBarRow != null && ev.y === this._statusBarRow) {
            await this.handleMouse(ev);
            continue;
          }

          // Wheel: scroll the VT100 scrollback buffer, never forward.
          if (ev.button === "wheel-up") {
            vt?.scroll(3);
            continue;
          }
          if (ev.button === "wheel-down") {
            vt?.scroll(-3);
            continue;
          }

          // Click on a different pane: switch focus without forwarding to terminal.
          if (ev.action === "down") {
            const clickedPane = this.tab.panes().find(p =>
              ev.x >= p.x && ev.x < p.x + p.w &&
              ev.y >= p.y && ev.y < p.y + p.h
            );
            if (clickedPane && clickedPane !== activePaneObj) {
              await this.handleMouse(ev);
              continue;
            }
          }

          // Clicks inside the terminal: only forward if the app enabled mouse mode.
          if (vt?.mouseMode && ev.raw) forwarded.push(ev.raw);
        }

        if (forwarded.length > 0) activePaneObj.terminal.write(forwarded.join(""));
        this.render();
        return;
      }

      if (activePaneObj.terminal.exited && events.some((event) => event.type === "key" && event.key === "enter")) {
        await this.closeTermPane(activePaneObj);
        this.render();
        return;
      }

      // Escape alone: close pane in legacy mode; protocol-aware shells need it as input.
      if (text === "\x1b" && !(activePaneObj.terminal?.vt?.keyboardProtocolFlags || activePaneObj.terminal?.vt?.modifyOtherKeys)) {
        await this.closeTermPane(activePaneObj);
        this.render();
        return;
      }
      // Ctrl-W: switch pane focus without closing
      if (text === "\x17") {
        const panes = this.tab.panes();
        if (panes.length > 1) {
          const idx = panes.indexOf(this.tab.activePane);
          this.tab.activePane = panes[(idx + 1) % panes.length];
          this.render();
        }
        return;
      }

      // Any other key input: reset scroll to live view, then forward
      if (activePaneObj.terminal?.vt) activePaneObj.terminal.vt.scrollOffset = 0;
      activePaneObj.terminal.writeInput(data);
      return;
    }

    if (await this.checkExternalReload()) {
      this.render();
      return;
    }

    if (this.prompt) {
      for (const event of parseInputEvents(data)) {
        if (!this.prompt) break;
        if (event.type === "key") await this.handlePrompt(event.raw);
        else if (event.type === "paste") await this.handlePrompt(event.text);
        else await this.handleEvent(event);
      }
      this._syncPrimarySelection();
      return;
    }

    for (const event of parseInputEvents(data)) {
      await this.handleEvent(event);
    }
    this._syncPrimarySelection();
  }

  async handleEvent(event) {
    const buf = this.buffer;
    const eventFenceBlock = indexedMdcuiFenceBlockAtLine(buf, buf?.cursor.y);
    const fenceValue = (block) => {
      const header = block?.header;
      if (!header?.id) return undefined;
      return globalThis.$?.(`${header.tag}#${header.id}`)?.val?.();
    };
    // Mouse up/move are passive — don't clear status messages set by a prior click.
    if (event.type !== "mouse" || event.action === "down") {
      this.message = "";
      if (buf) buf.message = "";
    }

    if (event.type === "mouse") {
      await this.handleMouse(event);
      this.render();
      return;
    }

    if (event.type === "paste") {
      const valueBeforePaste = fenceValue(eventFenceBlock);
      if (
        isMdcuiEncoding(buf?.encoding)
        && isMdcuiTableRow(buf?.line?.())
      ) {
        if (this.pane?.selection || /[\r\n]/u.test(event.text)) {
          this.message = "Protected table row";
          this.render();
          return;
        }
        buf.pushUndo();
        for (const character of event.text) {
          const edit = overwriteMdcuiTableRow(buf.line(), buf.cursor.x, character);
          if (!applyMdcuiTableRowEdit(buf, edit)) break;
        }
        this.message = pasteStatusMessage("terminal", event.text);
        this.render();
        return;
      }
      if (
        (isEditLockedBuffer(buf) && !isMdcuiEncoding(buf?.encoding))
        || (isMdcuiEncoding(buf?.encoding) && (
          !canEditMdcuiAtCursor(buf)
          ||
          /[\r\n]/.test(event.text)
          || !canEditMdcuiSelection(buf, this.pane?.selection)
        ))
      ) {
        this.message = "Buffer is read-only";
        this.render();
        return;
      }
      if (buf) buf.pushUndo();
      this._undoInsertChain = false;
      if (this.pane?.selection) deleteSelection(buf, this.pane);
      buf.insert(event.text);
      if (fenceValue(eventFenceBlock) !== valueBeforePaste)
        await this.dispatchMdcuiFenceEvent(buf, eventFenceBlock, event, "input");
      this.message = pasteStatusMessage("terminal", event.text);
      this.render();
      return;
    }

    const text = event.raw;
    const seq = event.key;
    const keydownBlock = eventFenceBlock;
    const valueBeforeKeydown = fenceValue(keydownBlock);
    if (buf) buf.allowCursorOffscreen = false;

    if (this._rawMode) {
      const hex = Array.from(new TextEncoder().encode(text)).map(b => b.toString(16).padStart(2, "0")).join(" ");
      this.message = `key=${JSON.stringify(seq)}  raw=${hex}`;
      if (seq === "escape") this._rawMode = false;
      this.render();
      return;
    }

    const keydownEvent = await this.dispatchMdcuiFenceEvent(buf, keydownBlock, event, "keydown");
    if (keydownEvent?.defaultPrevented && !["ctrl-q", "alt-q", "escape"].includes(seq)) {
      this.render();
      return;
    }

    // Reset undo insert chain on any non-printable-char key
    if (!(seq === text && text.length === 1 && text >= " ")) this._undoInsertChain = false;

    // Keep autocomplete active while cycling candidates with Tab/Shift-Tab or Up/Down.
    if (!["tab", "backtab", "up", "down"].includes(seq) && buf?.acHas) buf.clearAutocomplete();

    switch (seq) {
      case "escape": {
        this.pane.selection = null;
        this._markSelStart = null;
        if (buf) buf.searchPattern = "";
        const count = forceRehighlightDirtyLongLines(buf, this);
        if (count > 0) this.message = `Rehighlighted ${count} long line${count === 1 ? "" : "s"}`;
        this.render();
        return;
      }
      case "ctrl-q": //quit
      case "alt-q": //quit
        await this.quit();
        return;
      case "ctrl-a": //selectAll
        this.pane.selection = {
          start: { x: 0, y: 0 },
          end: { x: buf.lines.at(-1)?.length ?? 0, y: buf.lines.length - 1 },
        };
        buf.cursor = { ...this.pane.selection.end };
        break;
      case "ctrl-c": await this.handleCommand("copy"); break; //copy
      case "ctrl-x": await this.handleCommand("cut"); break; //cut
      case "ctrl-v": await this.handleCommand("paste"); break; //paste
      case "ctrl-z": //undo
        if (buf.undo()) this.pane.selection = null;
        else this.message = "Nothing to undo";
        break;
      case "ctrl-left":
        this.pane.selection = null;
        buf._lastVisX = null;
        buf.moveWordLeft();
        break;
      case "ctrl-right":
        this.pane.selection = null;
        buf._lastVisX = null;
        buf.moveWordRight();
        break;
      case "shift-ctrl-left":
        buf._lastVisX = null;
        extendSelection(this.pane, buf, () => buf.moveWordLeft());
        break;
      case "shift-ctrl-right":
        buf._lastVisX = null;
        extendSelection(this.pane, buf, () => buf.moveWordRight());
        break;
      case "ctrl-up": //cursorStart
        buf._lastVisX = null;
        await runAction("CursorStart", this);
        break;
      case "ctrl-down": //cursorEnd
        buf._lastVisX = null;
        await runAction("CursorEnd", this);
        break;
      case "shift-ctrl-up":
        extendSelection(this.pane, buf, () => { buf.moveStartOfBuffer(); this.scrollCursorToBoundary(this.pane, "start"); });
        break;
      case "shift-ctrl-down":
        extendSelection(this.pane, buf, () => { buf.moveEndOfBuffer(); this.scrollCursorToBoundary(this.pane, "end"); });
        break;
      case "ctrl-l": //goto line:col
        this.openCommandMode("goto ");
        break;
      case "ctrl-e": //cmd prompt
        this.openCommandMode();
        break;
      case "alt-/":
      case "alt-c": //comment toggle
      case "ctrl-underscore":
        this.toggleComment();
        break;
      case "ctrl-b": //shell cmd
        this.openShellMode();
        break;
      case "ctrl-s": //save
        await this.save();
        break;
      case "ctrl-f": { //find
        const searchSavedCursor = { ...this.buffer.cursor };
        this.openPrompt("Find: ", (value) => {
          if (value) this.buffer.search(value);
          else this.buffer.searchPattern = "";
        }, {
          onDelta: (value) => {
            if (value) {
              this.buffer.cursor = { ...searchSavedCursor };
              this.buffer.search(value, true);
            } else {
              this.buffer.cursor = { ...searchSavedCursor };
              this.buffer.searchPattern = "";
            }
          },
        });
        break;
      }
      case "ctrl-h": //replace/bksp
      case "alt-h": //replace
        this.openPrompt("> ", async (value) => {
          if (value.trim()) await this.handleCommand(value.trim());
        }, { completer: (i) => commandComplete(i, this.context), type: "Command", initial: "replace " });
        break;
      case "ctrl-g": //help toggle
        await this.toggleHelp();
        break;
      case "ctrl-d": { //dupLine/Sel
        if (isEditLockedBuffer(buf)) { this.message = "Buffer is read-only"; break; }
        buf.pushUndo();
        if (this.pane?.selection) {
          // Duplicate(): insert selection copy right after selection end
          const { last } = selectionBounds(this.pane.selection);
          const selText = getSelectionText(buf, this.pane.selection);
          const parts = selText.split("\n");
          const line = buf.lines[last.y] ?? "";
          const right = line.slice(last.x);
          if (parts.length === 1) {
            buf.lines[last.y] = line.slice(0, last.x) + parts[0] + right;
            buf.cursor = { y: last.y, x: last.x + parts[0].length };
            buf.invalidateHighlightFrom(last.y);
          } else {
            buf.lines[last.y] = line.slice(0, last.x) + parts[0];
            buf.lines.splice(last.y + 1, 0, ...parts.slice(1, -1), parts.at(-1) + right);
            buf.cursor = { y: last.y + parts.length - 1, x: parts.at(-1).length };
            buf.invalidateHighlightFrom(last.y, { force: true });
          }
          this.pane.selection = null;
          buf.modified = true;
          this.message = "Duplicated selection";
        } else {
          // DuplicateLine(): insert copy of current line below, cursor at end of new line
          const lineText = buf.lines[buf.cursor.y] ?? "";
          buf.lines.splice(buf.cursor.y + 1, 0, lineText);
          buf.invalidateHighlightFrom(buf.cursor.y, { force: true });
          buf.modified = true;
          buf.cursor = { y: buf.cursor.y + 1, x: lineText.length };
          this.message = "Duplicated line";
        }
        break;
      }
      case "ctrl-k": await this.handleCommand("cutline"); break; //cutLine
      case "ctrl-o": //open
        this.openCommandMode("open ");
        break;
      case "ctrl-n": //nextFind
        await runAction("FindNext", this);
        break;
      case "ctrl-p": //prevFind
        await runAction("FindPrevious", this);
        break;
      case "ctrl-r": //lineNumber toggle
        await runAction("ToggleRuler", this);
        break;
      case "alt-g": //helpBar toggle
        await runAction("ToggleKeyMenu", this);
        break;
      case "alt-comma":
      case "alt-[":
      case "ctrl-pageup":
        await runAction("PreviousTab", this);
        break;
      case "alt-period":
      case "alt-]":
      case "ctrl-pagedown":
        await runAction("NextTab", this);
        break;
      case "ctrl-t": //newTab
        await runAction("AddTab", this);
        break;
      case "ctrl-w": { //switchPane
        const panes = this.tab.panes();
        if (panes.length > 1) {
          const idx = panes.indexOf(this.tab.activePane);
          this.tab.activePane = panes[(idx + 1) % panes.length];
        }
        break;
      }
      case "ctrl-y": //redo
        if (buf.redo()) this.pane.selection = null;
        else this.message = "Nothing to redo";
        break;
      case "backspace":
        buf.pushUndo();
        if (
          isMdcuiEncoding(buf?.encoding)
          && isMdcuiTableRow(buf.line())
        ) {
          if (this.pane?.selection) this.message = "Protected table row";
          else {
            applyMdcuiTableRowEdit(
              buf,
              backspaceMdcuiTableRow(buf.line(), buf.cursor.x),
            );
          }
        }
        else if (this.pane?.selection) deleteSelection(buf, this.pane);
        else if (await this.runPluginBool("preBackspace")) {
          const textarea = mdcuiTextareaAtCursor(buf);
          if (!mergeTuiTextareaBackward(buf, textarea)) buf.backspace();
        }
        break;
      case "delete":
        buf.pushUndo();
        if (
          isMdcuiEncoding(buf?.encoding)
          && isMdcuiTableRow(buf.line())
        ) {
          if (this.pane?.selection) this.message = "Protected table row";
          else {
            applyMdcuiTableRowEdit(
              buf,
              deleteMdcuiTableRow(buf.line(), buf.cursor.x),
            );
          }
        }
        else if (this.pane?.selection) deleteSelection(buf, this.pane);
        else {
          const textarea = mdcuiTextareaAtCursor(buf);
          if (!mergeTuiTextareaForward(buf, textarea)) buf.deleteForward();
        }
        break;
      case "enter":
        if (isMdcuiEncoding(buf?.encoding)) {
          const textarea = mdcuiTextareaAtCursor(buf);
          if (textarea && canEditMdcuiAtCursor(buf)) {
            buf.pushUndo();
            if (this.pane?.selection) deleteSelection(buf, this.pane);
            insertTuiTextareaNewline(buf, textarea);
            break;
          }
          await this.handleMdcuiCellCallback(buf, buf.cursor.y, buf.cursor.x, "enter");
          break;
        }
        buf.pushUndo();
        if (this.pane?.selection) deleteSelection(buf, this.pane);
        if (await this.runPluginBool("preInsertNewline")) buf.newline();
        break;
      case "left":
        this.pane.selection = null;
        buf._lastVisX = null;
        buf.moveLeft();
        break;
      case "right":
        this.pane.selection = null;
        buf._lastVisX = null;
        buf.moveRight();
        break;
      case "up":
        if (buf.acHas) {
          buf.cycleAutocomplete(false);
          break;
        }
        this.pane.selection = null;
        this._moveUpVisual(buf, this.pane);
        break;
      case "down":
        if (buf.acHas) {
          buf.cycleAutocomplete(true);
          break;
        }
        this.pane.selection = null;
        this._moveDownVisual(buf, this.pane);
        break;
      case "shift-left":
        buf._lastVisX = null;
        extendSelection(this.pane, buf, () => buf.moveLeft());
        break;
      case "shift-right":
        buf._lastVisX = null;
        extendSelection(this.pane, buf, () => buf.moveRight());
        break;
      case "shift-up":
        extendSelection(this.pane, buf, () => this._moveUpVisual(buf, this.pane));
        break;
      case "shift-down":
        extendSelection(this.pane, buf, () => this._moveDownVisual(buf, this.pane));
        break;
      case "shift-home":
      case "alt-shift-left":
        buf._lastVisX = null;
        extendSelection(this.pane, buf, () => buf.moveStartOfTextToggle());
        break;
      case "shift-end":
      case "alt-shift-right":
        buf._lastVisX = null;
        extendSelection(this.pane, buf, () => buf.moveEnd());
        break;
      case "shift-pageup":
        buf._lastVisX = null;
        this.cursorPage(this.pane, -1, { select: true });
        break;
      case "shift-pagedown":
        buf._lastVisX = null;
        this.cursorPage(this.pane, 1, { select: true });
        break;
      case "home":
        buf._lastVisX = null;
        await runAction("StartOfTextToggle", this);
        break;
      case "end":
        buf._lastVisX = null;
        await runAction("EndOfLine", this);
        break;
      case "alt-left":
        buf._lastVisX = null;
        await runAction("StartOfTextToggle", this);
        break;
      case "alt-right":
        buf._lastVisX = null;
        await runAction("EndOfLine", this);
        break;
      case "alt-k": //MoveLinesUp
      case "alt-up":
        await runAction("MoveLinesUp", this);
        break;
      case "alt-j": //MoveLinesDown
      case "alt-down":
        await runAction("MoveLinesDown", this);
        break;
      case "alt-d": //DedentSelection
        await runAction("OutdentSelection", this);
        break;
      case "alt-s": { //Mark selection start / extend selection to mark
        if (!this._markSelStart) {
          this._markSelStart = { ...buf.cursor };
          this.message = "selectionStart, ESC:cancel";
        } else {
          this.pane.selection = { start: { ...this._markSelStart }, end: { ...buf.cursor } };
          buf.cursor = { ...buf.cursor };
          this.message = "selectionEnd, ESC:cancel";
        }
        break;
      }
      case "alt-p": //PreviousTab
        await runAction("PreviousTab", this);
        break;
      case "alt-t": //NextTab
        await runAction("NextTab", this);
        break;
      case "alt-{":
        await runAction("ParagraphPrevious", this);
        break;
      case "alt-}":
        await runAction("ParagraphNext", this);
        break;
      case "alt-shift-up":
        extendSelection(this.pane, buf, () => buf.paragraphPrevious());
        break;
      case "alt-shift-down":
        extendSelection(this.pane, buf, () => buf.paragraphNext());
        break;
      case "ctrl-home":
        buf._lastVisX = null;
        await runAction("Start", this);
        break;
      case "ctrl-end":
        buf._lastVisX = null;
        await runAction("End", this);
        break;
      case "pageup":
        buf._lastVisX = null;
        await runAction("CursorPageUp", this);
        break;
      case "pagedown":
        buf._lastVisX = null;
        await runAction("CursorPageDown", this);
        break;
      case "tab":
        if (buf.acHas) buf.cycleAutocomplete(true);
        else if (this.pane?.selection) {
          indentSelection(buf, this.pane, this.context);
        } else if (!buf.startBufferComplete()) {
          buf.insertTab();
        }
        break;
      case "backtab":
        if (buf.acHas) buf.cycleAutocomplete(false);
        else if (this.pane?.selection) {
          outdentSelection(buf, this.pane, this.context);
        } else {
          outdentLine(buf, this.context);
        }
        break;
      default:
        if (text >= " " || text.includes("\n")) {
          if (isMdcuiEncoding(buf?.encoding) && text === " " && !canEditMdcuiAtCursor(buf)) {
            await this.handleMdcuiCellCallback(buf, buf.cursor.y, buf.cursor.x, "space");
            break;
          }
          if (!this._undoInsertChain || this.pane?.selection) {
            buf.pushUndo();
          }
          if (
            isMdcuiEncoding(buf?.encoding)
            && isMdcuiTableRow(buf.line())
          ) {
            if (this.pane?.selection || text.includes("\n")) {
              this.message = "Protected table row";
              break;
            }
            this._undoInsertChain = true;
            for (const character of text) {
              const edit = overwriteMdcuiTableRow(
                buf.line(),
                buf.cursor.x,
                character,
              );
              if (!applyMdcuiTableRowEdit(buf, edit)) break;
              await this.context.plugins?.run(
                "onRune",
                makePaneAdapter(buf, this),
                character,
              );
              await this.context.jsPlugins?.run(
                "onRune",
                makePaneAdapter(buf, this),
                character,
              );
            }
            break;
          }
          if (isMdcuiEncoding(buf?.encoding) && !canEditMdcuiSelection(buf, this.pane?.selection)) {
            this.message = "Protected mdcui prefix";
            break;
          }
          this._undoInsertChain = true;
          if (this.pane?.selection) deleteSelection(buf, this.pane);
          await this.insertTextWithHooks(text);
        }
        break;
    }
    if (fenceValue(keydownBlock) !== valueBeforeKeydown)
      await this.dispatchMdcuiFenceEvent(buf, keydownBlock, event, "input");
    this.render();
  }

  async dispatchMdcuiFenceEvent(buf, block, inputEvent, eventName) {
    const id = block?.header?.id;
    const declaration = id ? buf?._mdcuiFenceEvents?.get(id) : null;
    const handler = declaration?.events?.get(eventName);
    const code = inlineFenceEventCode(handler);
    if (
      !code
      || declaration.tag !== block?.header?.tag
      || !buf?.path
      || isHttpUrl(buf.path)
    ) return false;

    const frontPath = `${buf.path}.front.js`;
    const useBundledMdcuiModules = Boolean(
      global.MDCUI_MAIN && buf._useBundledMdcuiModules,
    );
    if (!useBundledMdcuiModules && !existsSync(frontPath)) return false;
    try {
      const selection = globalThis.$?.(`${declaration.tag}#${id}`);
      const target = {
        id,
        tagName: declaration.tag.toUpperCase(),
        className: declaration.classes.join(" "),
      };
      Object.defineProperty(target, "value", {
        enumerable: true,
        get: () => selection?.val?.() ?? "",
        set: (value) => selection?.val?.(value),
      });
      const event = tuiKeyEventForFront(inputEvent, target, eventName);
      const [{ evalFront }, frontMod] = await Promise.all([
        useBundledMdcuiModules
          ? import(global.MDCUI_MAIN + "-rpc.js")
          : import("./cui/rpc.mjs"),
        useBundledMdcuiModules
          ? import(global.MDCUI_MAIN + ".front.js")
          : import(localModuleUrl(frontPath)),
      ]);
      const result = await evalFront(frontMod, code, { event, target }, target);
      if (result && typeof result === "object" && result.ok === false) {
        this.message = `mdcui ${eventName}: ${String(result.error ?? "Unknown error")}`;
      }
      return event;
    } catch (error) {
      this.message = `mdcui ${eventName}: ${String(error?.message || error)}`;
      return null;
    }
  }

  async handleMdcuiCellCallback(buf, y = buf?.cursor?.y ?? 0, x = buf?.cursor?.x ?? 0, trigger = "unknown") {
    const payload = mdcuiCellPayload(buf, y, x, trigger);
    if (!payload) return false;
    if (
      (trigger === "space" || trigger === "enter" || trigger === "mouse")
      && toggleTuiHeadingAt(buf, y, x)
    ) return true;
    const resizeResult = resizeMdcuiTextBlock(buf, y, x);
    if (resizeResult) {
      if (resizeResult === "added") this.message = "Added text row";
      else if (resizeResult === "removed") this.message = "Removed empty text row";
      return true;
    }
    if (
      payload.link?.startsWith("#")
      && navigateTuiHeadingFragment(buf, payload.link)
    ) {
      if (this.pane?.buffer === buf) {
        this.pane.selection = null;
        this.scrollCursorToCenter(this.pane);
      }
      return true;
    }
    const callback = this.context?.mdcuiCallback ?? globalThis.mdcuiCallback;
    if (typeof callback === "function") {
      try {
        await callback(payload);
      } catch (error) {
        this.message = `mdcui: ${String(error.message || error)}`;
        return true;
      }
    } 
    else 
    { // defaultCallback
      if (payload.link && /^javascript:/i.test(payload.link) && buf?.path && !isHttpUrl(buf.path)) {
        try {
          const useBundledMdcuiModules = Boolean(
            global.MDCUI_MAIN && buf._useBundledMdcuiModules,
          );
          const [{ evalFront }, frontMod] = await Promise.all([
            useBundledMdcuiModules
              ? import(global.MDCUI_MAIN + "-rpc.js")
              : import("./cui/rpc.mjs"),
            useBundledMdcuiModules
              ? import(global.MDCUI_MAIN + ".front.js")
              : import(localModuleUrl(`${buf.path}.front.js`)),
          ]);
          const context = tuiLinkActivationContext(payload);
          const result = await evalFront(
            frontMod,
            payload.link,
            context,
            context.target,
          );
          if (result && typeof result === "object" && result.ok === false) {
            this.protectedAlert(String(result.error ?? "Unknown error"));
          } else if (result != null) {
            this.message = String(result);
          }
          return true;
        } catch (error) {
          this.message = `mdcui js: ${String(error.message || error)}`;
          return true;
        }
      }

      const checkboxResult = toggleTaskCheckboxBeforeColumn(payload.line, x);
      if (checkboxResult.toggled) {
        buf.lines[y] = checkboxResult.line;
        const checkboxStyle = checkboxResult.checked ? { fg: "green" } : null;
        const styleLine = buf._ansiStyleLines?.[y];
        if (Array.isArray(styleLine)) {
          styleLine[checkboxResult.checkboxAt] = checkboxStyle;
          if (checkboxResult.line[checkboxResult.checkboxAt + 1] === " ")
            styleLine[checkboxResult.checkboxAt + 1] = checkboxStyle;
        }
        if (typeof buf._mdcuiAnsiText === "string") {
          const ansiLines = buf._mdcuiAnsiText.split("\n");
          ansiLines[y] = updateAnsiTaskCheckbox(
            ansiLines[y],
            checkboxResult.checkboxAt,
            checkboxResult.checked,
          );
          buf._mdcuiAnsiText = ansiLines.join("\n");
        }
        buf.modified = true;
      }
    
      this.message = `event ${payload.trigger}:`+
      `(${payload.row},${payload.col})`+
      `${payload.link||payload.ansi} `+
      `${payload.line}` ;
      
    }
    
    
    return true;
  }

  toggleComment() {
    const buf = this.buffer;
    if (!buf) return;
    if (isEditLockedBuffer(buf)) { this.message = "Buffer is read-only"; return; }
    buf.pushUndo();
    const range = commentLineRange(buf, this.pane?.selection);
    const commentType = resolveCommentType(buf);
    if (range.start > range.end) return;
    const lineNos = rangeLineNumbers(range);
    const nonBlank = lineNos.filter((n) => (buf.lines[n] ?? "").trim() !== "");
    const allCommented = nonBlank.length > 0 &&
      nonBlank.every((lineNo) => isLineCommented(buf.lines[lineNo] ?? "", commentType));
    if (allCommented) {
      for (const lineNo of nonBlank) {
        buf.lines[lineNo] = uncommentText(buf.lines[lineNo] ?? "", commentType);
      }
    } else {
      const indentMin = minCommentIndent(buf, range);
      for (const lineNo of nonBlank) {
        buf.lines[lineNo] = commentText(buf.lines[lineNo] ?? "", commentType, indentMin);
      }
      if (!this.pane?.selection) {
        const offset = commentType.indexOf("%s");
        if (offset >= 0) buf.cursor.x = clamp(buf.cursor.x + offset, 0, buf.line().length);
      }
    }
    buf.invalidateHighlightFrom(range.start);
    buf.modified = true;
    buf.ensureCursor();
    this.message = allCommented ? "Uncommented" : "Commented";
  }
  async insertTextWithHooks(text) {
    const buf = this.buffer;
    for (const ch of text) {
      if (ch === "\r") continue;
      if (ch === "\n") {
        if (await this.runPluginBool("preInsertNewline")) buf.newline();
        continue;
      }
      if (ch < " " && ch !== "\t") continue;
      buf.insertChar(ch);
      await this.context.plugins?.run("onRune", makePaneAdapter(buf, this), ch);
      await this.context.jsPlugins?.run("onRune", makePaneAdapter(buf, this), ch);
    }
  }

  async runPluginBool(fn) {
    const luaOk = await this.context.plugins?.runBool(fn, makePaneAdapter(this.buffer, this)) ?? true;
    const jsOk  = await this.context.jsPlugins?.runBool(fn, makePaneAdapter(this.buffer, this)) ?? true;
    return luaOk && jsOk;
  }

  async handleMouse(event) {
    if (this._suppressMouseUntilUp) {
      if (event.action === "up") this._suppressMouseUntilUp = false;
      if (event.action === "drag" || event.action === "up") return;
      this._suppressMouseUntilUp = false;
    }

    // Prompt row click: reposition cursor, toggle shell/command mode, or zone double-click
    if (this.prompt && event.y === this.rows - 1) {
      if ((event.action === "down" || event.action === "drag") && event.button === "left") {
        const totalText = this.prompt.label + this.prompt.value;
        const scrollX = this._promptScrollX ?? 0;
        const startIdx = scrollX > 0 ? visualColToCharIdx(totalText, 0, scrollX) : 0;
        const clickedCharIdx = visualColToCharIdx(totalText, startIdx, event.x);

        if (event.action === "down") {
          // Double-click zone: divide prompt row into thirds
          const third = Math.floor(this.cols / 3);
          const zone = event.x < third ? "left" : event.x < third * 2 ? "middle" : "right";
          const now = Date.now();
          const isDoubleClick = this._lastPromptClickZone === zone &&
                                now - (this._lastPromptClickTime ?? 0) < 400;
          this._lastPromptClickTime = now;
          this._lastPromptClickZone = zone;

          if (isDoubleClick && !this.prompt.yn) {
            if (zone === "left") {
              this.prompt.historyDown();
            } else if (zone === "middle") {
              this.prompt.historyUp();
            } else {
              const prompt = this.prompt;
              this.prompt = null;
              prompt.commit();
              await prompt.callback(prompt.value);
            }
            this.render();
            return;
          }

          // Single click on label (> or $): toggle Command ↔ Shell
          if (clickedCharIdx < this.prompt.label.length &&
              (this.prompt.type === "Command" || this.prompt.type === "Shell")) {
            const val = this.prompt.value;
            if (this.prompt.type === "Command") {
              this.openShellMode();
              this.prompt.value = val;
              this.prompt.cursor = val.length;
            } else {
              this.openCommandMode(val);
            }
            this.render();
            return;
          }
        }

        this.prompt.cursor = Math.max(0, Math.min(clickedCharIdx - this.prompt.label.length, this.prompt.value.length));
        this.render();
      }
      return;
    }

    if (this.handleSuggestionMouse(event)) {
      this.render();
      return;
    }
    if (await this.handleMessageRowMouse(event)) {
      this.render();
      return;
    }
    if (await this.handleStatusBarMouse(event)) {
      this.render();
      return;
    }
    if (await this.handleTabbarMouse(event)) {
      this.render();
      return;
    }

    // Find which pane was clicked
    const allPanes = this.tab.panes();
    const clicked = allPanes.find(p =>
      event.x >= p.x && event.x < p.x + p.w &&
      event.y >= p.y && event.y < p.y + p.h
    );
    if (!clicked) return;

    // Focus the clicked pane
    if (clicked !== this.tab.activePane) this.tab.activePane = clicked;

    const buf = clicked.buffer;
    if (!buf) return; // terminal panes: just focus switch

    const _swGutterW = editorGutterWidth(buf);
    const _swBufW = Math.max(1, clicked.w - _swGutterW);
    const _swOn = buf.Settings?.softwrap ?? false;
    const _swWord = _swOn && (buf.Settings?.wordwrap ?? false);
    const _swTab = buf.Settings?.tabsize ?? DEFAULT_SETTINGS.tabsize;

    if (event.button === "wheel-up") {
      buf.allowCursorOffscreen = true;
      if (_swOn) {
        const s = slocRetreatN(buf.lines, { line: buf.scroll.y, row: buf.scroll.row ?? 0 }, 3, _swBufW, _swWord, _swTab);
        buf.scroll.y = s.line; buf.scroll.row = s.row;
      } else {
        buf.scroll.y = Math.max(0, buf.scroll.y - 3);
      }
      return;
    }
    if (event.button === "wheel-down") {
      buf.allowCursorOffscreen = true;
      if (_swOn) {
        const s = slocAdvanceN(buf.lines, { line: buf.scroll.y, row: buf.scroll.row ?? 0 }, 3, _swBufW, _swWord, _swTab);
        buf.scroll.y = s.line; buf.scroll.row = s.row;
      } else {
        const maxScrollY = Math.max(0, buf.lines.length - clicked.h);
        buf.scroll.y = Math.min(maxScrollY, buf.scroll.y + 3);
      }
      return;
    }
    if (!["down", "up", "drag"].includes(event.action) || !["left", "none", "middle"].includes(event.button)) return;
    buf.allowCursorOffscreen = false;
    const gutterW = _swGutterW;
    const localY = event.y - clicked.y;
    const visualX = Math.max(0, event.x - clicked.x - gutterW);
    const inGutter = gutterW > 0 && event.x >= clicked.x && event.x < clicked.x + gutterW;
    let y, x;
    if (_swOn) {
      const clickSloc = slocAdvanceN(buf.lines, { line: buf.scroll.y, row: buf.scroll.row ?? 0 }, localY, _swBufW, _swWord, _swTab);
      y = clamp(clickSloc.line, 0, buf.lines.length - 1);
      const clickLine = buf.lines[y] ?? "";
      const clickBreaks = softwrapBreaks(clickLine, _swBufW, _swWord, _swTab);
      const segStart = clickBreaks[clickSloc.row] ?? 0;
      x = visualColToCharIdx(clickLine, segStart, visualX);
    } else {
      y = clamp(buf.scroll.y + localY, 0, buf.lines.length - 1);
      const line = buf.lines[y] ?? "";
      x = visualColToCharIdx(line, buf.scroll.x, visualX);
    }
    buf.cursor.y = y;
    buf.cursor.x = x;
    if (isMdcuiEncoding(buf.encoding) && event.action === "down" && event.button === "left" && !inGutter) {
      await this.handleMdcuiCellCallback(buf, y, x, "mouse");
      return;
    }
    if (event.button === "middle") {
      if (event.action === "down") {
        const pasted = this.clipboard.read("primary");
        if (pasted) {
          buf.pushUndo();
          this.pane.selection = null;
          buf.insert(pasted);
          this.message = pasteStatusMessage("primary", pasted);
        }
      }
      return;
    }
    if (event.action === "down") {
      if (inGutter) {
        // Message column (first msgW cols): show message text in infobar, no selection.
        const msgW = (buf.Messages?.length ?? 0) > 0 ? 2 : 0;
        const localX = event.x - clicked.x;
        if (msgW > 0 && localX < msgW) {
          const hit = (buf.Messages ?? []).find((m) => m.Start.Y === y || m.End.Y === y);
          if (hit) buf.message = hit.Msg;
          return;
        }

        const now = Date.now();
        const isDoubleClick =
          this._lastGutterClickY === y &&
          now - (this._lastGutterClickTime ?? 0) < 400;
        this._lastGutterClickTime = now;
        this._lastGutterClickY = y;
        if (isDoubleClick) {
          clicked.selection = null;
          this._gutterAnchorLine = null;
          this.toggleComment();
          return;
        }

        // First gutter click: anchor this line and select it whole
        // Subsequent gutter clicks: extend selection from anchor to this line
        if (this._gutterAnchorLine == null) {
          this._gutterAnchorLine = y;
          clicked.selection = { start: { x: 0, y }, end: { x: (buf.lines[y] ?? "").length, y } };
        } else {
          const anchorY = this._gutterAnchorLine;
          const topY = Math.min(anchorY, y);
          const botY = Math.max(anchorY, y);
          clicked.selection = { start: { x: 0, y: topY }, end: { x: (buf.lines[botY] ?? "").length, y: botY } };
        }
        buf.cursor.x = 0;
      } else {
        this._gutterAnchorLine = null;
        if (event.modifiers & 4) {
          // Shift+click: extend existing selection, or anchor from current cursor
          if (clicked.selection) {
            clicked.selection.end = { x, y };
          } else {
            const cur = buf.cursor;
            clicked.selection = { start: { x: cur.x, y: cur.y }, end: { x, y } };
          }
        } else {
          const now = Date.now();
          const isDoubleClick =
            this._lastClickX === x && this._lastClickY === y &&
            now - (this._lastClickTime ?? 0) < 400;
          this._lastClickTime = now;
          this._lastClickX = x;
          this._lastClickY = y;
          if (isDoubleClick) {
            clicked.selection = wordSelectionAt(buf, x, y);
          } else {
            clicked.selection = { start: { x, y }, end: { x, y } };
          }
        }
      }
    }
    if (event.action === "drag") {
      if (this._gutterAnchorLine != null) {
        // Drag from gutter: extend full-line selection
        const anchorY = this._gutterAnchorLine;
        const topY = Math.min(anchorY, y);
        const botY = Math.max(anchorY, y);
        clicked.selection = { start: { x: 0, y: topY }, end: { x: (buf.lines[botY] ?? "").length, y: botY } };
        buf.cursor.x = 0;
      } else if (clicked.selection) {
        clicked.selection.end = { x, y };
      }
    }
    if (event.action === "up" && clicked.selection &&
        clicked.selection.start.x === clicked.selection.end.x &&
        clicked.selection.start.y === clicked.selection.end.y)
      clicked.selection = null;
    buf.ensureCursor();
  }

  _syncPrimarySelection() {
    const sel = this.pane?.selection;
    if (!sel || sameLoc(sel.start, sel.end)) return;
    const buf = this.buffer;
    if (!buf) return;
    const text = getSelectionText(buf, sel);
    if (text) this.clipboard.write(text, "primary");
  }

  handleSuggestionMouse(event) {
    if (this._suggestionsRow == null || event.y !== this._suggestionsRow) return false;
    if (event.action !== "down" || event.button !== "left") return false;
    const rect = this._suggestionRects?.find(r => event.x >= r.start && event.x < r.end);
    if (!rect) return false;
    this._suppressMouseUntilUp = true;
    const buf = this.buffer;
    if (buf?.acHas) {
      buf.jumpToAcSuggestion(rect.index);
      this.message = "";
    } else if (this.prompt?.completions?.length > 1) {
      this.prompt.value = this.prompt.completions[rect.index];
      this.prompt.completionIndex = rect.index;
      this.prompt.cursor = this.prompt.value.length;
      this.prompt.onDelta?.(this.prompt.value);
    }
    return true;
  }

  async handleMessageRowMouse(event) {
    if (this._messageRowY == null || event.y !== this._messageRowY) return false;
    if (event.action !== "down" || event.button !== "left") return false;
    const zone = this._messageRowClickZone;
    if (!zone || !this._messageClickAction) return false;
    if (event.x < zone.start || event.x >= zone.end) return false;
    const result = this._messageClickAction();
    this._messageClickAction = null;
    this._messageRowClickZone = null;
    if (typeof result === "string") this.message = result;
    return true;
  }

  async handleStatusBarMouse(event) {
    if (this._statusBarRow == null || event.y !== this._statusBarRow) return false;
    if (event.action !== "down" || event.button !== "left") return false;
    const zone = this._statusBarRects?.find(r => event.x >= r.start && event.x < r.end);
    if (!zone) return false;
    const buf = this.buffer;
    const isTerm = this.pane?.type === "term";
    switch (zone.type) {
      case "name":
        if (this.tabs.length <= 1) {
          await this.handleCommand("showpath");
        } else {
          this.nextTab();
        }
        break;
      case "dirty": {
        const name = buf?.name ?? "No name";
        const filename = /^[^\s"'\\]+$/.test(name) ? name : JSON.stringify(name);
        this.openCommandMode(`save ${filename}`);
        break; //"
      }
      case "row":
        if (isTerm) {
          this.pane.terminal?.write("\x12");
        } else {
          this.openPrompt("> ", async (value) => {
            if (value.trim()) await this.handleCommand(value.trim());
          }, { completer: (i) => commandComplete(i, this.context), type: "Command", initial: "goto " });
        }
        break;
      case "col":
        if (isTerm) {
          // Alternate Home / End on each click
          this._termStatusColToggle = !this._termStatusColToggle;
          this.pane.terminal?.write(this._termStatusColToggle ? "\x1b[H" : "\x1b[F");
        } else if (buf) {
          const bracePair = findMatchingBracePair(buf);
          if (bracePair?.match) {
            buf.cursor = { x: bracePair.match.x, y: bracePair.match.y };
            buf.allowCursorOffscreen = false;
          } else {
            const line = buf.line();
            buf.cursor.x = buf.cursor.x === 0 ? line.length : 0;
          }
          buf.ensureCursor();
        }
        break;
      case "ft": {
        this.openCommandMode("set filetype ");
        break;
      }
      case "fmt":
        if (buf) {
          if (isEditLockedBuffer(buf)) { this.message = "Buffer is read-only"; break; }
          buf.fileformat = buf.fileformat === "dos" ? "unix" : "dos";
          buf.Settings.fileformat = buf.fileformat;
          buf.modified = true;
        }
        break;
      case "enc":
        if (buf) {
          this.openPrompt("> ", async (value) => {
            if (value.trim()) await this.handleCommand(value.trim());
          }, { completer: (i) => commandComplete(i, this.context), type: "Command", initial: "reopen " });
        }
        break;
      case "keymenu":
        this.keymenu = !this.keymenu;
        break;
      case "addtab":
        await this.addTab();
        break;
      case "cmdmode":
        if (this.prompt?.type === "Command") this._suppressMouseUntilUp = true;
        await this.togglePromptMode("Command");
        break;
      case "shellmode":
        if (this.prompt?.type === "Shell") this._suppressMouseUntilUp = true;
        await this.togglePromptMode("Shell");
        break;
    }
    return true;
  }

  async handleTabbarMouse(event) {
    if (this.tabs.length <= 1 || event.y !== 0) return false;
    if (event.button === "wheel-up") return this.previousTab();
    if (event.button === "wheel-down") return this.nextTab();
    if (event.action !== "down" || event.button !== "left") return false;
    const hit = this.tabRects.find((rect) => event.x >= rect.start && event.x < rect.end);
    if (!hit) return false;
    const now = Date.now();
    const isDoubleClick =
      this._lastTabClickIdx === hit.index &&
      now - (this._lastTabClickTime ?? 0) < 400;
    this._lastTabClickIdx = hit.index;
    this._lastTabClickTime = now;
    if (isDoubleClick) {
      await this.handleCommand("showpath");
      return true;
    }
    this.setActiveTab(hit.index);
    return true;
  }

  async addTab() {
    const buffer = new BufferModel({ command: {} });
    attachSyntax(buffer, this.context, "", "");
    const tab = new Tab(new Pane(buffer));
    this.tabs.push(tab);
    this.setActiveTab(this.tabs.length - 1);
    await this.context.plugins?.run("onBufferOpen", buffer);
    await this.context.jsPlugins?.run("onBufferOpen", buffer);
  }

  setActiveTab(index) {
    if (index < 0 || index >= this.tabs.length || index === this.activeTabIdx) return false;
    this.activeTabIdx = index;
    this.message = "";
    if (this.context.plugins && this.buffer) this.context.plugins.curPaneAdapter = makePaneAdapter(this.buffer, this);
    this.context.plugins?.run("onSetActive", makePaneAdapter(this.buffer, this));
    if (this.buffer) this.context.jsPlugins?.run("onSetActive", makePaneAdapter(this.buffer, this));
    return true;
  }

  previousTab() {
    return this.setActiveTab((this.activeTabIdx - 1 + this.tabs.length) % this.tabs.length);
  }

  nextTab() {
    return this.setActiveTab((this.activeTabIdx + 1) % this.tabs.length);
  }

  async handlePrompt(text) {
    const key = parseKey(text);

    if (this.prompt.yn) {
      const prompt = this.prompt;
      if (key === "escape" || key === "ctrl-c") {
        this.prompt = null;
        await prompt.onCancel?.();
      } else if (text === "y" || text === "Y") {
        this.prompt = null;
        await prompt.callback("y");
      } else if (text === "n" || text === "N") {
        this.prompt = null;
        await prompt.callback("n");
      }
      // any other key: ignore (stay in prompt)
      this.render();
      return;
    }

    if (key === "escape" || key === "ctrl-c") {
      const hadDelta = this.prompt.onDelta;
      const onCancel = this.prompt.onCancel;
      this.prompt = null;
      if (hadDelta) this.buffer.searchPattern = "";
      await onCancel?.();
    } else if (key === "up") {
      if (this.prompt.completions.length > 0) {
        const prompt = this.prompt;
        prompt.completionIndex = (prompt.completionIndex - 1 + prompt.completions.length) % prompt.completions.length;
        prompt.value = prompt.completions[prompt.completionIndex];
        prompt.cursor = prompt.value.length;
        this.message = completionMessage(prompt);
        await prompt.onCompletionSelect?.(prompt.value);
      } else {
        this.prompt.historyUp();
      }
    } else if (key === "down") {
      if (this.prompt.completions.length > 0) {
        const prompt = this.prompt;
        prompt.completionIndex = (prompt.completionIndex + 1) % prompt.completions.length;
        prompt.value = prompt.completions[prompt.completionIndex];
        prompt.cursor = prompt.value.length;
        this.message = completionMessage(prompt);
        await prompt.onCompletionSelect?.(prompt.value);
      } else {
        this.prompt.historyDown();
      }
    } else if (key === "tab") {
      this.completePrompt();
      if (this.prompt) await this.prompt.onCompletionSelect?.(this.prompt.value);
    } else if (key === "enter") {
      const prompt = this.prompt;
      this.prompt = null;
      prompt.commit();
      await prompt.callback(prompt.value);
    } else if (key === "left" || key === "ctrl-left") {
      const prompt = this.prompt;
      if (prompt.cursor > 0) {
        const lastCode = prompt.value.charCodeAt(prompt.cursor - 1);
        prompt.cursor -= (lastCode >= 0xDC00 && lastCode <= 0xDFFF) ? 2 : 1;
      }
    } else if (key === "right" || key === "ctrl-right") {
      const prompt = this.prompt;
      if (prompt.cursor < prompt.value.length) {
        const code = prompt.value.charCodeAt(prompt.cursor);
        prompt.cursor += (code >= 0xD800 && code <= 0xDBFF) ? 2 : 1;
      }
    } else if (key === "home" || key === "ctrl-a") {
      this.prompt.cursor = 0;
    } else if (key === "end" || key === "ctrl-e") {
      this.prompt.cursor = this.prompt.value.length;
    } else if (key === "ctrl-u") {
      const prompt = this.prompt;
      prompt.value = prompt.value.slice(prompt.cursor);
      prompt.cursor = 0;
      prompt.resetCompletion();
      this.message = "";
      prompt.onDelta?.(prompt.value);
    } else if (key === "ctrl-k") {
      const prompt = this.prompt;
      prompt.value = prompt.value.slice(0, prompt.cursor);
      prompt.resetCompletion();
      this.message = "";
      prompt.onDelta?.(prompt.value);
    } else if (key === "backspace") {
      const prompt = this.prompt;
      if (prompt.cursor > 0) {
        const lastCode = prompt.value.charCodeAt(prompt.cursor - 1);
        const trim = (lastCode >= 0xDC00 && lastCode <= 0xDFFF) ? 2 : 1;
        prompt.value = prompt.value.slice(0, prompt.cursor - trim) + prompt.value.slice(prompt.cursor);
        prompt.cursor -= trim;
      }
      this.prompt.resetCompletion();
      this.message = "";
      this.prompt.onDelta?.(this.prompt.value);
    } else if (key === "delete") {
      const prompt = this.prompt;
      if (prompt.cursor < prompt.value.length) {
        const code = prompt.value.charCodeAt(prompt.cursor);
        const trim = (code >= 0xD800 && code <= 0xDBFF) ? 2 : 1;
        prompt.value = prompt.value.slice(0, prompt.cursor) + prompt.value.slice(prompt.cursor + trim);
      }
      this.prompt.resetCompletion();
      this.message = "";
      this.prompt.onDelta?.(this.prompt.value);
    } else if (text >= " ") {
      const prompt = this.prompt;
      prompt.value = prompt.value.slice(0, prompt.cursor) + text + prompt.value.slice(prompt.cursor);
      prompt.cursor += text.length;
      this.prompt.resetCompletion();
      this.message = "";
      this.prompt.onDelta?.(this.prompt.value);
    }
    this.render();
  }

  completePrompt() {
    const prompt = this.prompt;
    if (!prompt?.completer) return;
    if (prompt.completions.length > 0 && prompt.value === prompt.completions[prompt.completionIndex]) {
      prompt.completionIndex = (prompt.completionIndex + 1) % prompt.completions.length;
      prompt.value = prompt.completions[prompt.completionIndex];
      prompt.cursor = prompt.value.length;
      this.message = completionMessage(prompt);
      return;
    }

    const rawCompletions = prompt.completer(prompt.value);
    const completions = rawCompletions.map((c) => (typeof c === "string" ? c : c.value));
    const labels = rawCompletions.map((c) => (typeof c === "string" ? c : (c.label ?? c.value)));
    prompt.completionInput = prompt.value;
    prompt.completions = completions;
    prompt.completionLabels = labels;
    if (completions.length === 0) {
      prompt.completionIndex = -1;
      this.message = "No completions";
      return;
    }

    prompt.completionIndex = 0;
    prompt.value = completions[0];
    prompt.cursor = prompt.value.length;
    this.message = completionMessage(prompt);
  }

  openPrompt(label, callback, options = {}) {
    this.prompt = new Prompt(label, callback, options);
    this._promptScrollX = 0;
  }

  openYNPrompt(label, callback, { onCancel = null } = {}) {
    this.prompt = new Prompt(label, callback, { yn: true, onCancel });
  }

  async togglePromptMode(type) {
    if (this.prompt?.type === type) {
      const prompt = this.prompt;
      this.prompt = null;
      await prompt.onCancel?.();
      return;
    }

    if (type === "Command") this.openCommandMode();
    else this.openShellMode();
  }

  async checkExternalReload() {
    if (this.prompt || this.pane?.type !== "editor") return false;
    const buf = this.buffer;
    if (!buf?.externallyModified?.()) return false;

    const reload = buf.Settings?.reload ?? DEFAULT_SETTINGS.reload;
    if (reload === "prompt") {
      this.openYNPrompt("File changed, reload? (y,n,esc)", async (answer) => {
        if (answer === "y") {
          try {
            await buf.reopen(this.context);
            if (this.pane?.buffer === buf) this.pane.selection = null;
          } catch (error) {
            this.message = String(error.message || error);
          }
        } else {
          buf.updateModTime();
        }
      }, {
        onCancel: () => { buf.reloadDisabled = true; },
      });
      return true;
    }

    if (reload === "auto") {
      try {
        await buf.reopen(this.context);
        if (this.pane?.buffer === buf) this.pane.selection = null;
      } catch (error) {
        this.message = String(error.message || error);
      }
      return true;
    }

    if (reload === "disabled") {
      buf.reloadDisabled = true;
      return false;
    }

    this.message = "Invalid reload setting";
    return true;
  }
  async openInPane(path) {
    try {
      const previous = this.pane.buffer;
      const buffer = await loadBufferForPath(path, this.context, {}, { interactive: true });
      this.pane.buffer = buffer;
      this.pane.selection = null;
      if (previous !== buffer) this._closeBufferIfUnused(previous);
      await this.context.plugins?.run("onBufferOpen", buffer);
      await this.context.jsPlugins?.run("onBufferOpen", buffer);
    } catch (error) {
      this.message = String(error.message || error);
    }
  }

  async openFile(path) {
    try {
      const buffer = await loadBufferForPath(path, this.context, {}, { interactive: true });
      if (isEmptyUntitledBuffer(this.buffer)) {
        const previous = this.pane.buffer;
        this.pane.buffer = buffer;
        this.pane.selection = null;
        if (previous !== buffer) this._closeBufferIfUnused(previous);
      } else {
        const tab = new Tab(new Pane(buffer));
        this.tabs.push(tab);
        this.setActiveTab(this.tabs.length - 1);
      }
      await this.context.plugins?.run("onBufferOpen", buffer);
      await this.context.jsPlugins?.run("onBufferOpen", buffer);
    } catch (error) {
      this.message = String(error.message || error);
    }
  }

  reconcileReopenedBuffer(buffer) {
    if (!buffer || isHttpUrl(buffer.path)) return buffer;
    const map = this.context?._openBuffers;
    if (!map) return buffer;
    const absPath = resolve(buffer.AbsPath || buffer.path);

    if (isMdcuiEncoding(buffer.encoding)) {
      if (map.get(absPath) === buffer) map.delete(absPath);
      buffer._openBufferMap = null;
      return buffer;
    }

    const existing = map.get(absPath);
    if (existing && existing !== buffer && !isMdcuiEncoding(existing.encoding)) {
      for (const tab of this.tabs) {
        for (const pane of tab.panes()) {
          if (pane.buffer === buffer) pane.buffer = existing;
          if (pane.prevBuffer === buffer) pane.prevBuffer = existing;
        }
      }
      return existing;
    }

    buffer._openBufferMap = map;
    map.set(absPath, buffer);
    return buffer;
  }

  async save({ force = false } = {}) {
    if (isEditLockedBuffer(this.buffer)) { this.message = "Can't save under readonly mode"; return; }
    if (!force && this.buffer?.readonly) { this.message = "Can't save under readonly mode"; return; }
    try {
      const enc = normalizeEncodingLabel(this.buffer?.encoding);
      if (enc !== "utf-8" && !isHex3Encoding(enc)) {
        this.openYNPrompt("Save in UTF-8?(y,n)", async (answer) => {
          if (answer === "y") await this.saveUtf8();
        });
        this.render();
        return;
      }
      await this.saveUtf8();
    } catch (error) {
      this.message = String(error.message || error);
    }
  }

  async saveUtf8() {
    try {
      const p = this.buffer.path;
      const isUrl = isHttpUrl(p);
      if (!p || isUrl) {
        const initial = isUrl ? basename(new URL(p).pathname) : "";
        this.openPrompt("Save as: ", async (value) => {
          if (value) {
            await this.buffer.save(resolve(expandHome(value)));
            await this.context.plugins?.run("onSave", makePaneAdapter(this.buffer, this));
            await this.context.jsPlugins?.run("onSave", makePaneAdapter(this.buffer, this));
          }
        }, { completer: fileComplete, initial });
      } else {
        await this.buffer.save();
        await this.context.plugins?.run("onSave", makePaneAdapter(this.buffer, this));
        await this.context.jsPlugins?.run("onSave", makePaneAdapter(this.buffer, this));
        await this._saveCursorForBuf(this.buffer);
      }
    } catch (error) {
      this.message = String(error.message || error);
    }
  }

  async _saveCursorForBuf(buf) {
    if (!DEFAULT_SETTINGS.savecursor || !buf.path) return;
    if (!this.context.cursorStates) this.context.cursorStates = {};
    this.context.cursorStates[buf.path] = { ...buf.cursor };
    try { await saveCursorStates(this.context.config?.configDir, this.context.cursorStates); } catch {}
  }

  async quit() {
    const buffer = this.buffer;
    if (isMdcuiEncoding(buffer?.encoding)) {
      await this.notifyMdcuiExit(buffer, "quit");
      await this._doCloseCurrentPane();
      return;
    }
    if (buffer.modified) {
      if (!this.prompt) {
        this.openYNPrompt(
          `Save?(y,n,esc): ${buffer.name} `,
          async (answer) => {
            if (answer === "y") await this.saveAndCloseCurrentPane();
            else if (answer === "n") await this._doCloseCurrentPane();
            // esc / anything else: canceled, do nothing
          }
        );
        this.render();
      }
      return;
    }
    await this._doCloseCurrentPane();
  }

  // Close only the current pane; if it's the last pane in the tab, close the tab.
  async _doCloseCurrentPane() {
    if (this.tab.panes().length > 1) {
      await this.notifyMdcuiExit(this.buffer, "close-pane");
      await this.closePane(this.pane);
      this.render();
    } else {
      await this.closeCurrentTab({ force: true });
    }
  }

  async saveAndCloseCurrentPane() {
    await this.save();
    if (!this.prompt && !this.buffer.modified) await this._doCloseCurrentPane();
  }

  async saveAndCloseCurrentTab() {
    await this.save();
    if (!this.prompt && !this.buffer.modified) await this.closeCurrentTab({ force: true });
  }

  async notifyMdcuiExit(buffer, reason = "exit") {
    if (
      !buffer
      || !isMdcuiEncoding(buffer.encoding)
      || this._mdcuiExitNotified.has(buffer)
    ) return;
    this._mdcuiExitNotified.add(buffer);

    const frontPath = buffer.path && !isHttpUrl(buffer.path)
      ? `${buffer.path}.front.js`
      : "";
    const useBundledMdcuiModules = Boolean(
      global.MDCUI_MAIN && buffer._useBundledMdcuiModules,
    );
    if (
      !useBundledMdcuiModules
      && (!frontPath || !existsSync(frontPath))
    ) return;

    try {
      const frontMod = useBundledMdcuiModules
        ? await import(global.MDCUI_MAIN + ".front.js")
        : await import(localModuleUrl(frontPath));
      if (typeof frontMod.onMdcuiExit !== "function") return;
      await frontMod.onMdcuiExit({
        reason,
        path: buffer.path,
        $: globalThis.$,
      });
    } catch (error) {
      console.error(`[mdcui] onMdcuiExit: ${error?.message || error}`);
    }
  }

  async notifyMdcuiLoad(buffer) {
    if (
      !buffer
      || !isMdcuiEncoding(buffer.encoding)
      || this._mdcuiLoadNotified.has(buffer)
    ) return;
    this._mdcuiLoadNotified.add(buffer);

    const frontPath = buffer.path && !isHttpUrl(buffer.path)
      ? `${buffer.path}.front.js`
      : "";
    const useBundledMdcuiModules = Boolean(
      global.MDCUI_MAIN && buffer._useBundledMdcuiModules,
    );
    if (!useBundledMdcuiModules && (!frontPath || !existsSync(frontPath))) return;

    try {
      const [{ evalFront }, frontMod] = await Promise.all([
        useBundledMdcuiModules
          ? import(global.MDCUI_MAIN + "-rpc.js")
          : import("./cui/rpc.mjs"),
        useBundledMdcuiModules
          ? import(global.MDCUI_MAIN + ".front.js")
          : import(localModuleUrl(frontPath)),
      ]);
      const result = await evalFront(
        frontMod,
        "typeof onMdcuiLoad === 'function' ? onMdcuiLoad() : undefined",
      );
      if (result?.ok === false)
        console.error(`[mdcui] onMdcuiLoad: ${result.error}`);
    } catch (error) {
      console.error(`[mdcui] onMdcuiLoad: ${error?.message || error}`);
    }
  }

  async toggleHelp() {
    const cur = this.pane;
    if (cur?.isHelp) {
      await this.closePane(cur);
      return;
    }
    await this.openHelp("help", { hsplit: true });
  }

  // Open a help topic in a pane. Mirrors Go's BufPane.openHelp logic.
  // hsplit=true  → top/bottom split ("v" dir); false → left/right split ("h" dir).
  // forceSplit=true → always create a new split even if current pane is already a help pane.
  async openHelp(topic, { hsplit = false, forceSplit = false } = {}) {
    const helpFile = this.context.runtime?.find(RTHelp, topic);
    if (!helpFile) {
      this.message = `Sorry, no help for ${topic}`;
      return;
    }
    let text = "";
    try { text = await helpFile.text(); }
    catch { this.message = `Unable to load help text for ${topic}`; return; }
    const helpBuf = new BufferModel({ path: helpFile.path, text, type: "help" });
    helpBuf.name = "Help " + topic;
    helpBuf.readonly = true;
    attachSyntax(helpBuf, this.context, helpFile.path, text);
    const cur = this.pane;
    if (cur?.isHelp && !forceSplit) {
      cur.buffer = helpBuf;
      cur.selection = null;
    } else {
      const helpPane = new Pane(helpBuf);
      helpPane.isHelp = true;
      // "h" = left|right (Go vsplit), "v" = top|bottom (Go hsplit)
      this.tab.split(cur, helpPane, hsplit ? "v" : "h");
    }
  }

  jumpToMatchingBrace() {
    const buf = this.buffer; if (!buf) return;
    const bracePair = findMatchingBracePair(buf);
    if (bracePair?.match) {
      buf.cursor = { x: bracePair.match.x, y: bracePair.match.y };
      buf.allowCursorOffscreen = false;
      buf.ensureCursor();
    } else {
      this.message = "No matching brace";
    }
  }

  diffNext() {
    const buf = this.buffer; if (!buf) return;
    const markers = getDiffMarkers(buf);
    if (!markers) { this.message = "No diff available"; return; }
    for (let y = buf.cursor.y + 1; y < markers.length; y++) {
      if (markers[y] !== 0) { buf.cursor.y = y; buf.ensureCursor(); this.message = ""; return; }
    }
    this.message = "No next diff";
  }

  diffPrevious() {
    const buf = this.buffer; if (!buf) return;
    const markers = getDiffMarkers(buf);
    if (!markers) { this.message = "No diff available"; return; }
    for (let y = buf.cursor.y - 1; y >= 0; y--) {
      if (markers[y] !== 0) { buf.cursor.y = y; buf.ensureCursor(); this.message = ""; return; }
    }
    this.message = "No previous diff";
  }

  async closeTermPane(pane) {
    pane.terminal?.close();
    pane.terminal = null;
    if (pane.prevBuffer) {
      pane.type = "editor";
      pane.buffer = pane.prevBuffer;
      pane.prevBuffer = null;
    } else {
      await this.closePane(pane);
    }
  }

  async closePane(pane) {
    pane.terminal?.close();
    const closingBuffers = [...new Set([pane.buffer, pane.prevBuffer].filter(Boolean))];
    const tab = this.tab;
    tab.removePane(pane);
    for (const buffer of closingBuffers) this._closeBufferIfUnused(buffer);
    if (!tab.root) {
      // Tab is empty — close it
      if (this.tabs.length <= 1) { this.stop(0); return; }
      this.tabs.splice(this.activeTabIdx, 1);
      this.activeTabIdx = Math.min(this.activeTabIdx, this.tabs.length - 1);
    }
    this.layoutEditorArea();
    await this.rerenderMdcuiBuffersForLayout();
  }

  async closeCurrentTab({ force = false } = {}) {
    if (!force && this.buffer?.modified) return await this.quit();
    if (this.tabs.length <= 1) {
      await this.notifyMdcuiExit(this.buffer, "close-tab");
      await this.stop(0);
      return;
    }
    const closingBuffers = [...new Set(this.tab.panes().flatMap((pane) => [pane.buffer, pane.prevBuffer]).filter(Boolean))];
    const closing = this.buffer;
    for (const buffer of closingBuffers)
      await this.notifyMdcuiExit(buffer, "close-tab");
    this.tabs.splice(this.activeTabIdx, 1);
    this.activeTabIdx = Math.min(this.activeTabIdx, this.tabs.length - 1);
    this.message = "";
    for (const buffer of closingBuffers) this._closeBufferIfUnused(buffer);
    if (this.context.plugins && this.buffer) this.context.plugins.curPaneAdapter = makePaneAdapter(this.buffer, this);
    await this.context.plugins?.run("onSetActive", makePaneAdapter(this.buffer, this));
    await this.context.plugins?.run("onBufferClose", closing);
    if (this.buffer) this.context.jsPlugins?.run("onSetActive", makePaneAdapter(this.buffer, this));
    await this.context.jsPlugins?.run("onBufferClose", closing);
    this.render();
  }

  _closeBufferIfUnused(buffer) {
    if (!buffer || this.paneForBuffer(buffer)) return;
    const configDir = this.context?.config?.configDir;
    if (configDir) removeBackup(buffer, configDir);
    const map = this.context?._openBuffers;
    if (map && map.get(buffer.AbsPath) === buffer) map.delete(buffer.AbsPath);
  }

  openCommandMode(initial = "") {
    const originalColorscheme = this.context.colorscheme;
    const previewTheme = async (value) => {
      const name = parseThemeName(value);
      if (!name || !this.context?.runtime) return;
      try {
        this.context.colorscheme = await new Colorscheme(this.context.runtime).load(name);
        this.render();
      } catch {}
    };
    this.openPrompt("> ", async (value) => {
      if (value.trim()) await this.handleCommand(value.trim());
    }, {
      completer: (i) => commandComplete(i, this.context),
      type: "Command",
      onCompletionSelect: previewTheme,
      onCancel: () => { this.context.colorscheme = originalColorscheme; },
      initial,
    });
  }

  openShellMode() {
    this.openPrompt("$ ", async (value) => {
      if (value.trim()) await this.runInteractiveShell(value.trim());
    }, { type: "Shell" });
  }

  async runInteractiveShell(cmdLine) {
    this.shellRunning = true;
    this._invalidatePendingEditorInput();
    const tty = this._ttyStream ?? process.stdin;
    const inputHandler = this._inputHandler;
    const listenerAttached = Boolean(
      inputHandler && tty.listeners?.("data").includes(inputHandler),
    );
    if (listenerAttached) tty.removeListener("data", inputHandler);
    tty.setRawMode?.(false);
    this.screen.fini();
    this.screen.previous = null;

    process.stdout.write("\n");
    try {
      const args = Array.isArray(cmdLine) ? cmdLine : shellSplit(cmdLine);
      if (args.length > 0) {
        const proc = Bun.spawn(args, {
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          env: { ...process.env },
        });
        const code = await proc.exited;
        if (code !== 0) process.stdout.write(`\n[Process exited with code ${code}]\n`);
      }
    } catch (err) {
      process.stdout.write(`\nError: ${err.message}\n`);
    }

    process.stdout.write("\nPress ENTER to continue...");
    let _onData;
    try {
      await new Promise((resolve) => {
        const done = () => {
          if (_onData) { tty.off("data", _onData); _onData = null; }
          this._shellResolve = null;
          resolve();
        };
        _onData = (data) => done();
        this._shellResolve = done;
        tty.on("data", _onData);
      });
    } finally {
      this._shellResolve = null;
      tty.setRawMode?.(true);
      this.screen.previous = null;
      this.screen.init();
      this.shellRunning = false;
      if (listenerAttached && this.running)
        tty.on("data", inputHandler);
      this.render();
    }
  }

  async runAlert(msg) {
    this._alertRunning = true;
    this._invalidatePendingEditorInput();
    const tty = this._ttyStream ?? process.stdin;
    const inputHandler = this._inputHandler;
    const listenerAttached = Boolean(
      inputHandler && tty.listeners?.("data").includes(inputHandler),
    );
    if (listenerAttached) tty.removeListener("data", inputHandler);
    tty.setRawMode?.(false);
    this.screen.fini();
    this.screen.previous = null;

    process.stdout.write(String(msg) + "\n");
    process.stdout.write("\nPress ENTER to continue...");
    try {
      let _onData;
      await new Promise((resolve) => {
        const done = () => {
          if (_onData) { tty.off("data", _onData); _onData = null; }
          this._alertResolve = null;
          resolve();
        };
        _onData = (data) => {
          const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
          if (bytes.some((b) => b === 0x0d || b === 0x0a)) done();
        };
        this._alertResolve = done;
        tty.on("data", _onData);
      });
    } finally {
      this._alertResolve = null;
      tty.setRawMode?.(true);
      this.screen.previous = null;
      this.screen.init();
      this._alertRunning = false;
      if (listenerAttached && this.running)
        tty.on("data", inputHandler);
      this.render();
    }
  }

  async handleCommand(input) {
    let args;
    try {
      args = shellSplit(input);
    } catch (err) {
      this.message = `Parse error: ${err.message}`;
      return;
    }
    if (args.length === 0) return;

    const [cmd, ...cmdArgs] = args;
    const buf = this.buffer;
    if (buf && isEditLockedBuffer(buf) && EDIT_LOCKED_COMMANDS.has(cmd)) {
      this.message = "Buffer is read-only";
      return;
    }

    switch (cmd) {
      case "show":
      case "get": {
        if (cmdArgs.length < 1) { this.message = `Usage: ${cmd} <option>`; break; }
        const [showOpt] = cmdArgs;
        const cfg = this.context?.config;
        let showVal;
        if (showOpt in (buf.Settings ?? {})) {
          showVal = buf.Settings[showOpt];
        } else if (cfg && showOpt in (cfg.globalSettings ?? {})) {
          showVal = cfg.globalSettings[showOpt];
        }
        if (showVal === undefined) { this.message = `${showOpt} is not a valid option`; break; }
        this.message = `${showOpt} = ${showVal}`;
        break;
      }
      case "set":
      case "setlocal": {
        if (cmdArgs.length < 2) { this.message = `Usage: ${cmd} <option> <value>`; break; }
        const [opt, val] = cmdArgs;
        try {
          buf.SetOption(opt, val);
        } catch (error) {
          this.message = String(error.message || error);
          break;
        }
        this.message = `${opt} = ${buf.Settings[opt] ?? val}`;
        if (opt === "diffgutter" && buf.Settings.diffgutter && !buf.diffBase) {
          await this.context.plugins?.run("onBufferOpen", buf);
          await this.context.jsPlugins?.run("onBufferOpen", buf);
        }
        if (cmd === "set" && !LOCAL_SETTINGS.has(opt)) {
          const cfg = this.context?.config;
          if (cfg && opt in cfg.globalSettings) {
            try {
              cfg.setGlobalOptionNative(opt, buf.Settings[opt], { modified: true });
              await cfg.saveSettings();
            } catch {}
          }
          if (opt === "colorscheme" && this.context?.runtime) {
            try {
              this.context.colorscheme = await new Colorscheme(this.context.runtime).load(val);
              this.message = `colorscheme: ${val}`;
            } catch (err) {
              this.message = `colorscheme: ${err.message}`;
            }
          }
          if (opt === "clipboard") {
            await this.reinitializeClipboard(buf.Settings[opt]);
          }
        }
        break;
      }
      case "open!":
      case "open": {
        // Parse flags: -f (force, skip save prompt), -r (readonly). Any order, combinable.
        let force = cmd === "open!";
        let openReadonly = false;
        let flagError = false;
        const remaining = [...cmdArgs];
        while (remaining.length > 0 && remaining[0].startsWith("-")) {
          const flag = remaining.shift();
          if (flag === "-f") force = true;
          else if (flag === "-r") openReadonly = true;
          else { this.message = `open: unknown flag ${flag}. Usage: open [-f] [-r] <file>`; flagError = true; break; }
        }
        if (flagError) break;
        const openArg = remaining[0];
        if (!openArg) { this.message = "Usage: open [-f] [-r] <file>"; break; }
        const openTarget = isHttpUrl(openArg) ? openArg : resolve(expandHome(openArg));
        const doOpenInPane = async () => {
          await this.openInPane(openTarget);
          if (openReadonly && this.buffer) this.buffer.readonly = true;
        };
        if (!force && buf?.modified) {
          this.openYNPrompt(`Save?(y,n,esc): ${buf.name} `, async (answer) => {
            if (answer === "y") { try { await buf.save(); } catch (e) { this.message = e.message; return; } await doOpenInPane(); }
            else if (answer === "n") await doOpenInPane();
          });
          this.render();
        } else {
          await doOpenInPane();
        }
        break;
      }
      case "save": {
        // Parse -f flag (force, bypasses readonly check). Must be first arg.
        const saveArgs = [...cmdArgs];
        const saveForce = saveArgs[0] === "-f" && (saveArgs.shift(), true);
        if (!saveForce && buf?.readonly) { this.message = "Can't save under readonly mode"; break; }
        const bufferEncoding = normalizeEncodingLabel(buf?.encoding);
        if (saveArgs.length > 0 && bufferEncoding !== "utf-8" && !isHex3Encoding(bufferEncoding)) {
          const target = resolve(expandHome(saveArgs[0]));
          this.openYNPrompt("Save in UTF-8?(y,n)", async (answer) => {
            if (answer === "y") {
              try {
                await buf.save(target);
                await this.context.plugins?.run("onSave", makePaneAdapter(buf, this));
                await this.context.jsPlugins?.run("onSave", makePaneAdapter(buf, this));
              } catch (err) {
                this.message = err.message;
              }
            }
          });
          this.render();
        } else if (saveArgs.length > 0) {
          try {
            await buf.save(resolve(expandHome(saveArgs[0])));
            await this.context.plugins?.run("onSave", makePaneAdapter(buf, this));
            await this.context.jsPlugins?.run("onSave", makePaneAdapter(buf, this));
          }
          catch (err) { this.message = err.message; }
        } else {
          await this.save({ force: saveForce });
        }
        break;
      }
      case "reopen": {
        if (!buf?.path) { this.message = "No file to reopen"; break; }
        let requestedEncoding = null;
        if (cmdArgs[0]) {
          try {
            requestedEncoding = normalizeEncodingLabel(cmdArgs[0]);
          } catch (error) {
            this.message = String(error.message || error);
            break;
          }
        }
        const doReopen = async () => {
          try {
            if (isMdcuiEncoding(requestedEncoding)) {
              const detachedContext = { ...this.context, inputEncoding: "mdcui", encodingExplicit: true };
              const reopened = await loadBufferForPath(buf.path, detachedContext);
              const previous = this.pane.buffer;
              this.pane.buffer = reopened;
              this.pane.selection = null;
              if (previous !== reopened) this._closeBufferIfUnused(previous);
              await this.context.plugins?.run("onBufferOpen", reopened);
              await this.context.jsPlugins?.run("onBufferOpen", reopened);
              this.message = `Reopened ${reopened.name} as ${reopened.encoding}`;
              this.render();
              return;
            }
            if (requestedEncoding) buf.SetOption("encoding", requestedEncoding);
            await buf.reopen(this.context);
            const reopened = this.reconcileReopenedBuffer(buf);
            if (this.pane?.buffer === reopened) this.pane.selection = null;
            this.message = `Reopened ${reopened.name} as ${reopened.encoding}`;
          } catch (error) {
            this.message = String(error.message || error);
          }
          this.render();
        };
        if (buf.modified) {
          this.openYNPrompt("Save file before reopen? (y,n,esc)", async (answer) => {
            if (answer === "y") {
              try { await this.save(); }
              catch (error) { this.message = String(error.message || error); this.render(); return; }
              await doReopen();
            } else if (answer === "n") {
              await doReopen();
            }
          });
          this.render();
        } else {
          await doReopen();
        }
        break;
      }
      case "quit":
      case "q":
        await this.quit();
        break;
      case "exit": {
        const code = cmdArgs.length > 0 ? parseInt(cmdArgs[0], 10) : 0;
        await this.stop(isNaN(code) ? 0 : code);
        break;
      }
      case "comment":
        this.toggleComment();
        break;
      case "goto": {
        if (cmdArgs.length === 0) { this.message = "Usage: goto <line[.subrow][:col]>"; break; }
        try {
          this.gotoLocation(buf, parseLineCol(cmdArgs[0]), this.pane);
          this.pane.selection = null;
        } catch (error) {
          this.message = String(error.message || error);
        }
        break;
      }
      case "find": {
        if (cmdArgs.length === 0) { this.message = "Usage: find <pattern>"; break; }
        buf.search(cmdArgs.join(" "));
        break;
      }
      case "replace": {
        if (cmdArgs.length < 1) { this.message = "Usage: replace [-a] [-l] <search> [<replace>]"; break; }
        await this.replaceCmd(cmdArgs, false);
        break;
      }
      case "replaceall": {
        if (cmdArgs.length < 1) { this.message = "Usage: replaceall [-l] <search> [<replace>]"; break; }
        await this.replaceCmd(cmdArgs, true);
        break;
      }
      case "action":
      case "act": {
        if (cmdArgs.length === 0) { this.message = "Usage: act <ActionName>"; break; }
        const ok = await runAction(cmdArgs[0], this);
        if (!ok) this.message = `Unknown action: ${cmdArgs[0]}`;
        break;
      }
      case "raw": {
        this._rawMode = !this._rawMode;
        this.message = this._rawMode ? "Raw key mode ON — press keys to inspect, ESC to exit" : "Raw key mode OFF";
        break;
      }
      case "cd": {
        const dir = cmdArgs[0] ? expandHome(cmdArgs[0]) : (process.env.HOME ?? ".");
        try {
          process.chdir(dir);
          this.message = `cd: ${process.cwd()}`;
        } catch (err) {
          this.message = `cd: ${err.message}`;
        }
        break;
      }
      case "pwd":
        this.message = process.cwd();
        break;
      case "tab": {
        if (cmdArgs.length > 0) await this.openFile(resolve(expandHome(cmdArgs[0])));
        else await this.addTab();
        break;
      }
      case "run": {
        if (cmdArgs.length === 0) { this.message = "Usage: run <shell-command>"; break; }
        const runCmd = cmdArgs.join(" ");
        this.message = `Running: ${runCmd}`;
        this.render();
        try {
          const result = await runCommand(shellCmdArgs(runCmd), { allowFailure: true });
          const out = (result.stdout + result.stderr).trim();
          this.message = out || (result.ok ? "Done" : `exited with ${result.code}`);
        } catch (err) {
          this.message = String(err.message || err);
        }
        break;
      }
      case "vsplit": {
        let newBuf;
        if (cmdArgs.length > 0) {
          try { newBuf = await loadBufferForPath(resolve(expandHome(cmdArgs[0])), this.context, {}, { interactive: true }); }
          catch (err) { this.message = err.message; break; }
        } else {
          newBuf = new BufferModel({ command: {} });
          attachSyntax(newBuf, this.context, "", "");
        }
        this.tab.split(this.pane, new Pane(newBuf), "h");
        this.layoutEditorArea();
        await this.rerenderMdcuiBuffersForLayout();
        this.render();
        break;
      }
      case "hsplit": {
        let newBuf;
        if (cmdArgs.length > 0) {
          try { newBuf = await loadBufferForPath(resolve(expandHome(cmdArgs[0])), this.context, {}, { interactive: true }); }
          catch (err) { this.message = err.message; break; }
        } else {
          newBuf = new BufferModel({ command: {} });
          attachSyntax(newBuf, this.context, "", "");
        }
        this.tab.split(this.pane, new Pane(newBuf), "v");
        this.render();
        break;
      }
      case "term": {
        const p = this.pane;
        p.prevBuffer = p.buffer;   // save so ESC can restore it
        p.type = "term";
        p.buffer = null;
        p.selection = null;
        p.terminal = new TerminalPane(this);
        this.render(); // compute layout first so p.w/p.h are set
        p.terminal.open(p.w, p.h - 1); // -1 for title bar
        break;
      }
      case "tts": {
        if (cmdArgs.length > 0) {
          await this.runTts(cmdArgs.join(" "), { trackBuffer: false });
          break;
        }
        const buf = this.buffer;
        let ttsText;
        if (this.pane?.selection) {
          ttsText = getSelectionText(buf, this.pane.selection);
        } else {
          const cur = buf.cursor;
          const tail = buf.lines.slice(cur.y);
          tail[0] = tail[0].slice(cur.x);
          ttsText = tail.join("\n");
        }
        await this.runTts(ttsText);
        break;
      }
      case "ttsspeed": {
        if (cmdArgs.length === 0) { this.message = `TTS_SPEED = ${Bun.env.TTS_SPEED ?? "1.5"}`; break; }
        const tsv = parseFloat(cmdArgs[0]);
        if (isNaN(tsv) || tsv <= 0) { this.message = "ttsspeed: value must be a positive number"; break; }
        Bun.env.TTS_SPEED = String(tsv);
        this.message = `TTS_SPEED = ${tsv}`;
        break;
      }
      case "ttspitch": {
        if (cmdArgs.length === 0) { this.message = `TTS_PITCH = ${Bun.env.TTS_PITCH ?? "1"}`; break; }
        const tpv = parseFloat(cmdArgs[0]);
        if (isNaN(tpv) || tpv <= 0) { this.message = "ttspitch: value must be a positive number"; break; }
        Bun.env.TTS_PITCH = String(tpv);
        this.message = `TTS_PITCH = ${tpv}`;
        break;
      }
      case "ttslang": {
        if (cmdArgs.length === 0) { 
          this.message = `TTS_LANG = ${Bun.env.TTS_LANG ?? "zh-TW"}`; 
          break; 
        }

        Bun.env.TTS_LANG = String(cmdArgs[0]);
        this.message = `TTS_LANG = ${Bun.env.TTS_LANG}`;
        break;
      }
      case "help": {
        const helpsplit = this.context?.config?.globalSettings?.helpsplit ?? "hsplit";
        let helpHsplit = helpsplit !== "vsplit";
        let forceSplit = false;
        const topics = [];
        let conflict = false;
        for (const arg of cmdArgs) {
          if (arg === "-vsplit") {
            if (forceSplit) { this.message = "hsplit and vsplit are not allowed at the same time"; conflict = true; break; }
            helpHsplit = false; forceSplit = true;
          } else if (arg === "-hsplit") {
            if (forceSplit) { this.message = "hsplit and vsplit are not allowed at the same time"; conflict = true; break; }
            helpHsplit = true; forceSplit = true;
          } else {
            topics.push(arg);
          }
        }
        if (!conflict) {
          if (topics.length === 0) {
            await this.openHelp("help", { hsplit: helpHsplit, forceSplit });
          } else {
            if (topics.length > 1) forceSplit = true;
            for (const topic of topics) {
              await this.openHelp(topic, { hsplit: helpHsplit, forceSplit });
            }
          }
        }
        break;
      }
      case "toggle":
      case "tog":
      case "togglelocal": {
        if (cmdArgs.length === 0) { this.message = `Usage: ${cmd} <option>`; break; }
        const opt = cmdArgs[0];
        const cfg = this.context?.config;
        const allSettings = cfg?.globalSettings ?? defaultAllSettings();
        if (!(opt in allSettings)) { this.message = `${opt} is not a valid option`; break; }
        const curVal = buf.Settings[opt] ?? cfg?.globalSettings[opt] ?? defaultAllSettings()[opt];
        let newVal;
        const choices = OPTION_CHOICES[opt];
        if (choices?.length === 2) {
          newVal = curVal === choices[0] ? choices[1] : choices[0];
        } else if (typeof curVal === "boolean") {
          newVal = !curVal;
        } else {
          this.message = `${opt} is not toggleable`; break;
        }
        try { buf.SetOption(opt, newVal); } catch (err) { this.message = String(err.message || err); break; }
        this.message = `${opt} = ${newVal}`;
        if (opt === "diffgutter" && buf.Settings.diffgutter && !buf.diffBase) {
          await this.context.plugins?.run("onBufferOpen", buf);
          await this.context.jsPlugins?.run("onBufferOpen", buf);
        }
        if (cmd !== "togglelocal" && cfg && opt in cfg.globalSettings && !LOCAL_SETTINGS.has(opt)) {
          try { cfg.setGlobalOptionNative(opt, newVal, { modified: true }); await cfg.saveSettings(); } catch {}
        }
        break;
      }
      case "reset": {
        if (cmdArgs.length === 0) { this.message = "Usage: reset <option>"; break; }
        const opt = cmdArgs[0];
        const defaults = defaultAllSettings();
        const cfgR = this.context?.config;
        if (!(opt in defaults) && !(opt in (cfgR?.globalSettings ?? {}))) { this.message = `${opt} is not a valid option`; break; }
        const defVal = opt in defaults ? defaults[opt] : true;
        try { buf.SetOption(opt, String(defVal)); } catch (err) { this.message = String(err.message || err); break; }
        this.message = `${opt} = ${defVal}`;
        if (cfgR && opt in cfgR.globalSettings && !LOCAL_SETTINGS.has(opt)) {
          try { cfgR.setGlobalOptionNative(opt, defVal, { modified: true }); await cfgR.saveSettings(); } catch {}
        }
        if (opt === "colorscheme" && this.context?.runtime) {
          try { this.context.colorscheme = await new Colorscheme(this.context.runtime).load(String(defVal)); } catch {}
        }
        if (opt === "clipboard") await this.reinitializeClipboard(defVal);
        break;
      }
      case "jump": {
        if (cmdArgs.length === 0) { this.message = "Usage: jump <±lines>"; break; }
        try {
          const offset = parseInt(cmdArgs[0], 10);
          if (isNaN(offset)) throw new Error("invalid number");
          const target = clamp(buf.cursor.y + offset, 0, buf.lines.length - 1);
          buf.cursor = { x: 0, y: target };
          buf.ensureCursor();
          this.pane.selection = null;
        } catch (err) { this.message = String(err.message || err); }
        break;
      }
      case "tabmove": {
        if (cmdArgs.length === 0) { this.message = "Usage: tabmove [±]<index>"; break; }
        const arg = cmdArgs[0];
        const num = parseInt(arg, 10);
        if (isNaN(num)) { this.message = "tabmove: invalid index"; break; }
        const from = this.activeTabIdx;
        let to;
        if (arg[0] === "+" || arg[0] === "-") {
          to = from + num;
        } else {
          to = num - 1; // 1-based
        }
        to = clamp(to, 0, this.tabs.length - 1);
        if (to !== from) {
          const [tab] = this.tabs.splice(from, 1);
          this.tabs.splice(to, 0, tab);
          this.activeTabIdx = to;
        }
        break;
      }
      case "tabswitch": {
        if (cmdArgs.length === 0) { this.message = "Usage: tabswitch <index|name>"; break; }
        const arg = cmdArgs[0];
        const num = parseInt(arg, 10);
        if (!isNaN(num)) {
          const idx = num - 1;
          if (idx < 0 || idx >= this.tabs.length) { this.message = "tabswitch: invalid tab index"; break; }
          this.setActiveTab(idx);
        } else {
          const idx = this.tabs.findIndex((t) => t.name === arg);
          if (idx < 0) { this.message = `tabswitch: no tab named "${arg}"`; break; }
          this.setActiveTab(idx);
        }
        break;
      }
      case "textfilter": {
        if (cmdArgs.length === 0) { this.message = "Usage: textfilter <command> [args...]"; break; }
        const sel = this.pane?.selection;
        const input = sel ? getSelectionText(buf, sel) : buf.currentLineText();
        try {
          const result = await runCommand(shellCmdArgs(cmdArgs.join(" ")), { stdin: input, allowFailure: true });
          if (!result.ok) { this.message = result.stderr.trim() || `exited with ${result.code}`; break; }
          const out = result.stdout;
          buf.pushUndo();
          if (sel) {
            deleteSelection(buf, this.pane);
          } else {
            const y = buf.cursor.y;
            buf.lines[y] = "";
            buf.cursor = { x: 0, y };
          }
          buf.insert(out.replace(/\n$/, ""));
          buf.modified = true;
        } catch (err) { this.message = String(err.message || err); }
        break;
      }
      case "showkey":
        await this.openHelp("defaultkeys", { hsplit: true });
        break;
      case "memusage": {
        const m = process.memoryUsage();
        const mb = (n) => (n / 1024 / 1024).toFixed(1) + " MB";
        this.message = `heap: ${mb(m.heapUsed)} / ${mb(m.heapTotal)}  rss: ${mb(m.rss)}`;
        break;
      }
      case "retab": {
        const toSpaces = buf.Settings?.tabstospaces ?? DEFAULT_SETTINGS.tabstospaces;
        const tabsize = buf.Settings?.tabsize ?? DEFAULT_SETTINGS.tabsize;
        const spaces = " ".repeat(tabsize);
        buf.pushUndo();
        for (let i = 0; i < buf.lines.length; i++) {
          const line = buf.lines[i];
          const wsEnd = line.search(/[^ \t]/);
          const end = wsEnd === -1 ? line.length : wsEnd;
          if (end === 0) continue;
          const ws = line.slice(0, end);
          const rest = line.slice(end);
          const newWs = toSpaces
            ? ws.replaceAll("\t", spaces)
            : ws.replaceAll(spaces, "\t");
          if (newWs !== ws) buf.lines[i] = newWs + rest;
        }
        buf.modified = true;
        buf.invalidateHighlightFrom(0, { force: true });
        this.message = toSpaces ? "Retabbed to spaces" : "Retabbed to tabs";
        break;
      }
      case "eval": {
        const lang = cmdArgs[0];
        if (!lang) { this.message = "Usage: eval js|py|sh [code]"; break; }
        if (lang !== "js" && lang !== "py" && lang !== "sh") {
          this.message = `eval: unknown language '${lang}' — use js, py, or sh`;
          break;
        }
        // Code source: inline (raw, bypass shell quoting) or selection
        let evalCode;
        const inlineMatch = /^\s*eval\s+(?:js|py|sh)\s+(.+)$/s.exec(input);
        if (inlineMatch) {
          evalCode = inlineMatch[1];
        } else {
          const sel = this.pane?.selection;
          evalCode = (sel && !sameLoc(sel.start, sel.end)) ? getSelectionText(buf, sel) : null;
          if (!evalCode) { this.message = `eval ${lang}: select text, or use: eval ${lang} <code>`; break; }
        }
        // Build temp file
        const { tmpdir } = await import("node:os");
        const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
        let ext, execArgs, fileContent = evalCode;
        if (lang === "js") {
          ext = "js";
          execArgs = [Bun.which("bun") ?? "bun"];
        } else if (lang === "py") {
          ext = "py";
          const pyBin = process.platform === "win32" ? "python" : "python3";
          execArgs = [Bun.which(pyBin) ?? pyBin];
        } else { // sh
          if (existsSync("/bin/sh")) {
            ext = "sh";
            execArgs = ["/bin/sh"];
          } else {
            ext = "js";
            fileContent = `import { $ } from "bun";\nawait $\`\n${evalCode}\n\`;\n`;
            execArgs = [Bun.which("bun") ?? "bun"];
          }
        }
        const evalTmpFile = join(tmpdir(), `bunmicro-tmp${suffix}.${ext}`);
        await Bun.write(evalTmpFile, fileContent);
        try {
          await this.runInteractiveShell([...execArgs, evalTmpFile]);
        } finally {
          try { unlinkSync(evalTmpFile); } catch {}
        }
        break;
      }
      case "bind":
      case "unbind":
        this.message = `${cmd}: keybinding system not yet implemented`;
        break;
      case "reload": {
        if (!this.context?.runtime) { this.message = "reload: runtime not available"; break; }
        try {
          this.context.syntaxDefinitions = await loadSyntaxDefinitions(this.context.runtime);
          const schemeName = this.context.config?.getGlobalOption("colorscheme") || "default";
          this.context.colorscheme = await new Colorscheme(this.context.runtime).load(schemeName);
          for (const tab of this.tabs) {
            for (const pane of tab.panes()) {
              if (pane.buffer) attachSyntax(pane.buffer, this.context, pane.buffer.path, pane.buffer.lines[0] ?? "");
            }
          }
          this.message = "Runtime reloaded";
        } catch (err) { this.message = `reload: ${err.message}`; }
        break;
      }
      case "theme": {
        if (cmdArgs.length === 0) { this.message = "Usage: theme <name>"; break; }
        const themeName = cmdArgs[0];
        if (!this.context?.runtime) { this.message = "theme: runtime not available"; break; }
        try {
          this.context.colorscheme = await new Colorscheme(this.context.runtime).load(themeName);
          const cfg = this.context?.config;
          if (cfg) {
            cfg.setGlobalOptionNative("colorscheme", themeName, { modified: true });
            await cfg.saveSettings();
          }
          this.message = `colorscheme: ${themeName}`;
        } catch (err) {
          this.message = `theme: ${err.message}`;
        }
        break;
      }
      case "lintlog": {
        const log = this.context.plugins?.lintLog ?? [];
        if (log.length === 0) { this.message = "No lint output"; break; }
        const content = log.join("\n---\n");
        if (this.context.plugins) this.context.plugins.lintLog = [];
        await this.runAlert(content);
        break;
      }
      case "copy": {
        this._freshClip = false;
        const sel = this.pane?.selection;
        const copyText = sel ? getSelectionText(buf, sel) : (buf.currentLineText() + "\n");
        this.clipboard.write(copyText);
        this.message = clipboardCopyMsg(this.clipboard, copyText, sel ? "selection" : "line");
        this._messageClickAction = clipboardAltAction(this.clipboard, copyText);
        break;
      }
      case "cut": {
        this._freshClip = false;
        buf.pushUndo();
        const cutText = this.pane?.selection
          ? deleteSelection(buf, this.pane)
          : (buf.cutLine() + "\n");
        const cutKind = this.pane?.selection ? "selection" : "line";
        this.clipboard.write(cutText);
        this.message = clipboardCopyMsg(this.clipboard, cutText, cutKind, "Cut");
        this._messageClickAction = clipboardAltAction(this.clipboard, cutText);
        break;
      }
      case "cutline": {
        buf.pushUndo();
        if (this.pane?.selection) {
          this._freshClip = false;
          const text = deleteSelection(buf, this.pane);
          this.clipboard.write(text);
          this.message = clipboardCopyMsg(this.clipboard, text, "selection", "Cut");
          this._messageClickAction = clipboardAltAction(this.clipboard, text);
        } else {
          const prev = this._freshClip ? (this.clipboard.read() ?? "") : "";
          const line = buf.cutLine() + "\n";
          this.clipboard.write(prev + line);
          this._freshClip = true;
          const total = (prev + line).split("\n").length - 1;
          const label = total > 1 ? `${total} lines` : "line";
          this.message = clipboardCopyMsg(this.clipboard, prev + line, label, "Cut");
          this._messageClickAction = clipboardAltAction(this.clipboard, prev + line);
        }
        break;
      }
      case "paste": {
        this._freshClip = false;
        const pasted = this.clipboard.read();
        if (pasted) {
          if (isMdcuiEncoding(buf?.encoding) && (
            /[\r\n]/.test(pasted)
            || !canEditMdcuiAtCursor(buf)
            || !canEditMdcuiSelection(buf, this.pane?.selection)
          )) {
            this.message = "Protected mdcui content";
            break;
          }
          buf.pushUndo();
          if (this.pane?.selection) deleteSelection(buf, this.pane);
          buf.insert(pasted);
          this.message = pasteStatusMessage(this.clipboard.readMethodName(), pasted);
        }
        break;
      }
      case "pasteprimary":
        await runAction("PastePrimary", this);
        break;
      default: {
        const pluginCmd = this.context.plugins?.commands?.get(cmd) ?? this.context.jsPlugins?.commands?.get(cmd);
        if (pluginCmd) {
          try {
            cmdArgs.raw = input;
            await pluginCmd(makePaneAdapter(this.buffer, this), cmdArgs);
          } catch (e) {
            this.message = String(e.message ?? e);
          }
        } else {
          this.message = `Unknown command: ${cmd}`;
        }
        break;
      }
    }
  }

  async replaceCmd(args, forceAll = false) {
    let all = forceAll;
    let noRegex = false;
    const positional = [];
    for (const arg of args) {
      if (arg === "-a") { all = true; continue; }
      if (arg === "-l") { noRegex = true; continue; }
      positional.push(arg);
    }
    if (positional.length < 1) {
      this.message = "Usage: replace [-a] [-l] <search> [<replace>]";
      return;
    }
    const searchStr = positional[0];
    const replaceStr = positional.length >= 2 ? positional.slice(1).join(" ") : "";

    const buf = this.buffer;
    const ignoreCase = buf.Settings?.ignorecase ?? this.context?.config?.globalSettings?.ignorecase ?? true;
    const pattern = noRegex ? RegExp.escape(searchStr) : searchStr;
    const flags = "m" + (ignoreCase ? "i" : "");
    let re;
    try { re = new RegExp(pattern, flags); }
    catch (err) { this.message = `Invalid regex: ${err.message}`; return; }

    const sel = this.pane?.selection;
    const inSelection = sel != null;
    let startY = 0, startX = 0;
    let endY = buf.lines.length - 1;
    let endX = buf.lines[endY]?.length ?? 0;
    if (inSelection) {
      const { first, last } = selectionBounds(sel);
      startY = first.y; startX = first.x;
      endY = last.y; endX = last.x;
    }

    if (all) {
      this._doReplaceAll(searchStr, replaceStr, re, noRegex, startY, startX, endY, endX, inSelection);
    } else {
      await this._interactiveReplace(searchStr, replaceStr, re, noRegex, startY, startX, endY, endX, inSelection);
    }
  }

  _doReplaceAll(searchStr, replaceStr, re, noRegex, startY, startX, endY, endX, inSelection) {
    const buf = this.buffer;
    buf.pushUndo();
    const reG = new RegExp(re.source, re.flags.replace(/g/g, "") + "g");
    let count = 0;
    let firstChanged = null;
    let structuralChange = false;

    let y = startY;
    let yEnd = endY;
    while (y <= yEnd) {
      const line = buf.lines[y];
      const lineStart = (y === startY) ? startX : 0;
      const lineEnd = (y === yEnd) ? endX : line.length;
      const prefix = line.slice(0, lineStart);
      const suffix = line.slice(lineEnd);
      const searchable = line.slice(lineStart, lineEnd);

      reG.lastIndex = 0;
      const after = noRegex
        ? searchable.replace(reG, () => { count++; return replaceStr; })
        : searchable.replace(reG, (...args) => { count++; return replaceStr; });

      if (after !== searchable) {
        const newContent = prefix + after + suffix;
        const newLines = newContent.split("\n");
        const delta = newLines.length - 1;
        buf.lines.splice(y, 1, ...newLines);
        if (newLines.length !== 1) structuralChange = true;
        firstChanged = firstChanged == null ? y : Math.min(firstChanged, y);
        yEnd += delta;
        y += newLines.length;
        buf.modified = true;
      } else {
        y++;
      }
    }
    if (firstChanged != null) buf.invalidateHighlightFrom(firstChanged, { force: structuralChange });

    const noun = count === 1 ? "occurrence" : "occurrences";
    this.message = count > 0
      ? `Replaced ${count} ${noun} of ${searchStr}${inSelection ? " in selection" : ""}`
      : `Nothing matched ${searchStr}`;
    if (inSelection) this.pane.selection = null;
  }

  async _interactiveReplace(searchStr, replaceStr, re, noRegex, startY, startX, endY, endX, inSelection) {
    const buf = this.buffer;
    buf.pushUndo();
    let nreplaced = 0;
    let fromY = clamp(buf.cursor.y, startY, endY);
    let fromX = buf.cursor.y === fromY ? buf.cursor.x : (fromY === startY ? startX : 0);

    const reOnce = new RegExp(re.source, re.flags.replace(/g/g, ""));

    const findNext = () => {
      for (let y = fromY; y <= endY; y++) {
        const line = buf.lines[y];
        const lineFrom = (y === fromY) ? fromX : 0;
        const lineTo = (y === endY) ? endX : line.length;
        reOnce.lastIndex = 0;
        const sub = line.slice(lineFrom, lineTo);
        const m = reOnce.exec(sub);
        if (m) return { y, x: lineFrom + m.index, matchEnd: lineFrom + m.index + m[0].length, match: m };
      }
      return null;
    };

    const finish = () => {
      this.pane.selection = null;
      const noun = nreplaced === 1 ? "occurrence" : "occurrences";
      this.message = nreplaced > 0
        ? `Replaced ${nreplaced} ${noun} of ${searchStr}${inSelection ? " in selection" : ""}`
        : `Nothing matched ${searchStr}`;
      this.render();
    };

    const doNext = async () => {
      const hit = findNext();
      if (!hit) { finish(); return; }

      buf.cursor = { y: hit.y, x: hit.x };
      this.pane.selection = { start: { y: hit.y, x: hit.x }, end: { y: hit.y, x: hit.matchEnd } };
      buf.ensureCursor?.();
      this.render();

      this.openYNPrompt("Perform replacement (y,n,esc)", async (answer) => {
        if (answer === "y") {
          const line = buf.lines[hit.y];
          const matched = line.slice(hit.x, hit.matchEnd);
          const actual = noRegex ? replaceStr : matched.replace(reOnce, replaceStr);
          const suffix = line.slice(hit.matchEnd);
          const newContent = line.slice(0, hit.x) + actual + suffix;
          const newLines = newContent.split("\n");
          const delta = newLines.length - 1;
          buf.lines.splice(hit.y, 1, ...newLines);
          buf.invalidateHighlightFrom(hit.y, { force: newLines.length !== 1 });
          buf.modified = true;
          nreplaced++;
          endY += delta;
          fromY = hit.y + newLines.length - 1;
          fromX = newLines[newLines.length - 1].length - suffix.length;
        } else {
          fromY = hit.y;
          fromX = hit.matchEnd;
        }
        await doNext();
      }, {
        onCancel: finish,
      });
      this.render();
    };

    await doNext();
  }

  async runTts(text, { trackBuffer = true } = {}) {
    if (!text.trim()) { this.message = "Nothing to speak"; return this.message; }
    const cmd = detectTtsCmd();
    if (!cmd) { this.message = "No TTS command found (install espeak)"; return this.message; }
    const buf = this.buffer;
    const pane = trackBuffer ? this.pane : null;
    let startX, startY;
    if (pane?.selection) {
      const { first } = selectionBounds(pane.selection);
      startX = first.x; startY = first.y;
    } else {
      startX = buf.cursor.x; startY = buf.cursor.y;
    }
    const sentences = splitSentencesWithPositions(text, startX, startY);
    const state = { abort: false, proc: null };
    this._ttsState = state;
    this.message = `TTS_PITCH:${Bun.env.TTS_PITCH||1} TTS_SPEED:${Bun.env.TTS_SPEED||1.5} — Press key: Stop`;
    this.render();
    for (let { text: sentence, start, end } of sentences) {
      if (state.abort) break;
      if (pane) {
        pane.selection = { start, end };
        buf.cursor = { x: start.x, y: start.y };
        buf.allowCursorOffscreen = false;
        buf.ensureCursor();
        this.scrollCursorToCenter(pane);
      }
      this.render();
      const spawnOpts = { stdout: "ignore", stderr: "ignore",env:Bun.env };
      spawnOpts.stdin = cmd.via === "stdin" ? new Blob([sentence]) : "ignore";

      if (cmd.via === "arg") {
        sentence = (sentence + "")
          .replace(/^-+/, "")
          .replaceAll("`", "")
          .replaceAll("$", "");
        if (cmd.textTransform) sentence = cmd.textTransform(sentence);
      }
      const args = cmd.via === "arg" ? [...cmd.cmd, sentence] : cmd.cmd;
      const proc = Bun.spawn(args, spawnOpts);
      state.proc = proc;
      const code = await proc.exited;
      if (state.abort) break;
      if (code !== 0) {
        if (this._ttsState === state) this._ttsState = null;
        this.message = `TTS: command exited with code ${code}`;
        this.render();
        return this.message;
      }
    }
    if (state.abort) {
      this.message = "TTS: stopped";
      if (this._ttsState === state) this._ttsState = null;
      this.render();
      return this.message;
    }
    this.message = "TTS: done";
    if (this._ttsState === state) this._ttsState = null;
    this.render();
  }

  stopTts() {
    const state = this._ttsState;
    if (!state) return false;
    state.abort = true;
    try { state.proc?.kill(); } catch {}
    if (this._ttsState === state) this._ttsState = null;
    return true;
  }

}

class StartupHighlightProgress {
  constructor(app, { immediate = false } = {}) {
    this.app = app;
    this.startedAt = performance.now();
    this.lastDrawAt = 0;
    this.processedChars = 0;
    this.currentLineProgress = 0;
    this.currentLineChars = 0;
    this.immediate = immediate;
  }

  beforeLine(lineChars, lineNo, targetLine) {
    this.currentLineProgress = 0;
    this.currentLineChars = lineChars;
    if (lineChars <= LONG_LINE_REHIGHLIGHT_LIMIT * 10) return;
    this.draw(lineNo, targetLine, `${ansiDim(", current line ")}${ansiCyan(formatCount(lineChars))}${ansiDim(" chars")}`, true);
  }

  linePosition(pos, lineNo, targetLine) {
    const next = Math.max(this.currentLineProgress, Math.min(this.currentLineChars, Number(pos) || 0));
    if (next === this.currentLineProgress) return;
    this.currentLineProgress = next;
    this.draw(lineNo, targetLine, `${ansiDim(", current line ")}${ansiCyan(formatCount(next))}${ansiDim("/")}${ansiMagenta(formatCount(this.currentLineChars))}${ansiDim(" chars")}`);
  }

  afterLine(lineChars, lineNo, targetLine) {
    this.processedChars += lineChars;
    this.currentLineProgress = 0;
    this.currentLineChars = 0;
    this.draw(lineNo, targetLine);
  }

  draw(lineNo, targetLine, suffix = "", force = false) {
    const now = performance.now();
    if (!force && !this.immediate && now - this.startedAt < 120) return;
    if (!force && now - this.lastDrawAt < 80) return;
    this.lastDrawAt = now;
    const row = Math.max(1, this.app.rows || process.stdout.rows || 24);
    const cols = Math.max(1, this.app.cols || process.stdout.columns || 80);
    const currentTotal = this.processedChars + this.currentLineProgress;
    const msg = progressMessage(currentTotal, lineNo, targetLine, suffix);
    const rows = wrapProgressText(msg, cols).slice(0, Math.min(3, row));
    const startRow = row - rows.length + 1;
    let out = "\x1b[0m";
    for (let i = 0; i < rows.length; i++) {
      out += `\x1b[${startRow + i};1H\x1b[2K${rows[i]}\x1b[0m`;
    }
    process.stdout.write(out);
    if (this.app.screen) this.app.screen.previous = null;
  }
}

function formatCount(value) {
  return Math.max(0, Number(value) || 0).toLocaleString("en-US");
}

function progressMessage(currentTotal, lineNo, targetLine, suffix = "") {
  return [
    ansiBold(ansiPink("Highlighting")),
    " ",
    ansiGreen(formatCount(currentTotal)),
    ansiDim(" chars"),
    ansiDim(", "),
    ansiYellow("line"),
    " ",
    ansiBlue(formatCount(lineNo + 1)),
    ansiDim("/"),
    ansiPurple(formatCount(targetLine + 1)),
    suffix,
  ].join("");
}

function wrapProgressText(text, width) {
  if (typeof Bun?.wrapAnsi === "function") return Bun.wrapAnsi(String(text), Math.max(1, width)).split("\n");
  const value = String(text);
  const w = Math.max(1, width);
  const rows = [];
  for (let i = 0; i < value.length; i += w) rows.push(value.slice(i, i + w));
  return rows.length ? rows : [""];
}

function ansiWrap(code, text) {
  return `\x1b[${code}m${text}\x1b[0m`;
}

function ansiBold(text) { return ansiWrap("1", text); }
function ansiDim(text) { return ansiWrap("2", text); }
function ansiPink(text) { return ansiWrap("95", text); }
function ansiGreen(text) { return ansiWrap("92", text); }
function ansiCyan(text) { return ansiWrap("96", text); }
function ansiYellow(text) { return ansiWrap("93", text); }
function ansiBlue(text) { return ansiWrap("94", text); }
function ansiPurple(text) { return ansiWrap("35", text); }
function ansiMagenta(text) { return ansiWrap("95", text); }

const COMMAND_NAMES = [
  "set", "setlocal", "show", "get", "open", "open!", "save", "quit", "q", "exit", "goto", "comment", "find", "replace", "replaceall",
  "cd", "pwd", "tab", "run", "vsplit", "hsplit", "term", "tts", "ttsspeed", "ttspitch", "ttslang", "reopen", "theme", "toggle", "tog",
  "togglelocal", "reset", "jump", "tabmove", "tabswitch", "textfilter", "bind", "unbind", "reload", "lintlog", "act", "action", "raw",
  "help", "plugin", "showkey", "memusage", "retab", "eval",
  "copy", "cut", "cutline", "paste", "pasteprimary",
];

const EDIT_LOCKED_COMMANDS = new Set([
  "comment", "replace", "replaceall", "save", "cut", "cutline", "paste", "pasteprimary", "textfilter", "retab",
]);

const SUPPORTED_ENCODING_LABELS = [
  "hex3", "mdcui", "utf-8", "hex3gz", "hex3zst",
  "utf-16le", "utf-16be",
  "windows-1252", "iso-8859-1", "latin1",
  "big5", "gbk", "gb18030",
  "shift_jis", "sjis", "euc-jp", "iso-2022-jp",
  "euc-kr", "ks_c_5601-1987",
].filter((encoding) => {
  if (isMdcuiEncoding(encoding)) return true;
  if (isHex3Encoding(encoding)) return true;
  try { new TextDecoder(encoding); return true; }
  catch { return false; }
});

function completeOptionValue(cmd, option, partial, context) {
  const allSettings = context?.config?.globalSettings ?? defaultAllSettings();
  if (!(option in allSettings)) return [];
  const optVal = allSettings[option];
  const suggestions = [];

  if (option === "filetype") {
    const filetypes = [
      "off",
      "unknown",
      ...(context?.syntaxDefinitions ?? []).map((definition) => definition.filetype),
    ];
    return [...new Set(filetypes)]
      .filter((filetype) => filetype && filetype.startsWith(partial))
      .sort()
      .map((filetype) => ({ value: `${cmd} ${option} ${filetype}`, label: filetype }));
  }

  if (typeof optVal === "boolean") {
    if ("on".startsWith(partial)) suggestions.push("on");
    else if ("true".startsWith(partial)) suggestions.push("true");
    if ("off".startsWith(partial)) suggestions.push("off");
    else if ("false".startsWith(partial)) suggestions.push("false");
  } else if (typeof optVal === "string") {
    if (option === "encoding") {
      return completeEncoding(partial).map((e) => ({ value: `${cmd} ${option} ${e}`, label: e }));
    }
    if (option === "colorscheme" && context?.runtime) {
      const schemes = context.runtime.list(RTColorscheme).map((f) => f.name).sort();
      for (const s of schemes) if (s.startsWith(partial)) suggestions.push(s);
    } else if (option === "sucmd") {
      if ("sudo".startsWith(partial)) suggestions.push("sudo");
      if ("doas".startsWith(partial)) suggestions.push("doas");
    } else if (option in OPTION_CHOICES) {
      for (const c of OPTION_CHOICES[option]) if (c.startsWith(partial)) suggestions.push(c);
    }
  }

  return suggestions.map((s) => ({ value: `${cmd} ${option} ${s}`, label: s }));
}

function toggleableOptions(allSettings = null) {
  const all = allSettings ?? defaultAllSettings();
  return Object.entries(all)
    .filter(([k, v]) => {
      if (typeof v === "boolean") return true;
      const choices = OPTION_CHOICES[k];
      return choices?.length === 2;
    })
    .map(([k]) => k)
    .sort();
}

function parseThemeName(value) {
  const m = /^theme\s+(\S+)$/.exec(value) ?? /^set(?:local)?\s+colorscheme\s+(\S+)$/.exec(value);
  return m?.[1] ?? null;
}

function commandComplete(input, context = null) {
  const spaceIdx = input.indexOf(" ");
  if (spaceIdx < 0) {
    const pluginCmds = [
      ...(context?.plugins?.commands?.keys() ?? []),
      ...(context?.jsPlugins?.commands?.keys() ?? []),
    ];
    return [...new Set([...COMMAND_NAMES, ...pluginCmds])].filter((cmd) => cmd.startsWith(input));
  }
  const cmd = input.slice(0, spaceIdx);
  const rest = input.slice(spaceIdx + 1);
  const allSettings = context?.config?.globalSettings ?? null;
  const allSettingsOrDefault = allSettings ?? defaultAllSettings();
  if (["open", "open!", "save", "cd", "tab", "run"].includes(cmd)) {
    if (cmd === "open" || cmd === "open!") {
      // Strip any leading -f/-r flags and reconstruct prefix for completions
      let flagPrefix = "";
      let filePart = rest;
      while (filePart.startsWith("-f ") || filePart.startsWith("-r ")) {
        flagPrefix += filePart.slice(0, 3);
        filePart = filePart.slice(3);
      }
      return fileComplete(filePart).map((f) => `${cmd} ${flagPrefix}${f}`);
    }
    if (cmd === "save") {
      const filePart = rest.startsWith("-f ") ? rest.slice(3) : rest;
      const flagPrefix = rest.startsWith("-f ") ? "-f " : "";
      return fileComplete(filePart).map((f) => `save ${flagPrefix}${f}`);
    }
    return fileComplete(rest).map((f) => `${cmd} ${f}`);
  }
  if (cmd === "reopen" && !rest.includes(" ")) {
    return completeEncoding(rest).map((encoding) => `${cmd} ${encoding}`);
  }
  if (cmd === "eval" && !rest.includes(" ")) {
    return completeEvalLanguage(rest).map((lang) => `${cmd} ${lang}`);
  }
  if (cmd === "theme" && !rest.includes(" ")) {
    const schemes = (context?.runtime?.list(RTColorscheme) ?? []).map((f) => f.name).sort();
    return schemes.filter((s) => s.startsWith(rest)).map((s) => ({ value: `theme ${s}`, label: s }));
  }
  if ((cmd === "toggle" || cmd === "tog" || cmd === "togglelocal") && !rest.includes(" ")) {
    return toggleableOptions(allSettings).filter((o) => o.startsWith(rest)).map((o) => ({ value: `${cmd} ${o}`, label: o }));
  }
  if (cmd === "reset" && !rest.includes(" ")) {
    const opts = Object.keys(allSettingsOrDefault);
    return opts.filter((o) => o.startsWith(rest)).sort().map((o) => ({ value: `reset ${o}`, label: o }));
  }
  if ((cmd === "set" || cmd === "setlocal") && !rest.includes(" ")) {
    const opts = Object.keys(allSettingsOrDefault);
    return opts.filter((o) => o.startsWith(rest)).sort().map((o) => ({ value: `${cmd} ${o}`, label: o }));
  }
  if (cmd === "set" || cmd === "setlocal") {
    const spaceInRest = rest.indexOf(" ");
    const option = rest.slice(0, spaceInRest);
    const partial = rest.slice(spaceInRest + 1);
    return completeOptionValue(cmd, option, partial, context);
  }
  if ((cmd === "show" || cmd === "get") && !rest.includes(" ")) {
    const opts = Object.keys(allSettingsOrDefault);
    return opts.filter((o) => o.startsWith(rest)).sort().map((o) => ({ value: `${cmd} ${o}`, label: o }));
  }
  if ((cmd === "act" || cmd === "action") && !rest.includes(" ")) {
    const actions = listActions();
    return actions.filter((a) => a.startsWith(rest)).map((a) => ({ value: `act ${a}`, label: a }));
  }
  if (cmd === "help") {
    // Complete last token (may follow -vsplit/-hsplit flags already typed)
    const lastSpace = rest.lastIndexOf(" ");
    const partial = lastSpace >= 0 ? rest.slice(lastSpace + 1) : rest;
    const prefix = lastSpace >= 0 ? rest.slice(0, lastSpace + 1) : "";
    const topics = (context?.runtime?.list(RTHelp) ?? []).map((f) => f.name).sort();
    const flags = ["-vsplit", "-hsplit"];
    const candidates = [...topics, ...flags].filter((s) => s.startsWith(partial));
    return candidates.map((s) => ({ value: `help ${prefix}${s}`, label: s }));
  }
  return [];
}

function completeEncoding(partial) {
  const value = String(partial).toLowerCase();
  return SUPPORTED_ENCODING_LABELS.filter((encoding) => encoding.startsWith(value));
}

function completeEvalLanguage(partial) {
  const value = String(partial).toLowerCase();
  return ["js", "py", "sh"].filter((lang) => lang.startsWith(value));
}

function fileComplete(input) {
  const value = String(input);
  const expanded = expandHome(value);
  const slash = Math.max(expanded.lastIndexOf("/"), expanded.lastIndexOf(sep));
  const dirPart = slash >= 0 ? expanded.slice(0, slash + 1) : "";
  const prefix = slash >= 0 ? expanded.slice(slash + 1) : expanded;
  const readDir = dirPart || ".";
  let entries;
  try {
    entries = readdirSync(readDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .map((entry) => entry.name + (entry.isDirectory() ? sep : ""))
    .filter((name) => name.startsWith(prefix))
    .sort((a, b) => a.localeCompare(b))
    .map((name) => unexpandHome(dirPart + name, value));
}

function expandHome(path) {
  if (path === "~") return process.env.HOME || path;
  if (path.startsWith("~/") || path.startsWith("~" + sep)) return resolve(process.env.HOME || ".", path.slice(2));
  return path;
}

function unexpandHome(path, original) {
  if (!(original === "~" || original.startsWith("~/") || original.startsWith("~" + sep))) return path;
  const home = process.env.HOME;
  if (!home || !path.startsWith(home)) return path;
  const rest = path.slice(home.length).replace(/^\//, "");
  return rest ? "~/" + rest : "~";
}

function longestCommonPrefix(values) {
  if (values.length === 0) return "";
  let prefix = values[0];
  for (const value of values.slice(1)) {
    while (prefix && !value.startsWith(prefix)) prefix = prefix.slice(0, -1);
  }
  return prefix;
}

function completionMessage(prompt) {
  const labels = (prompt.completionLabels?.length > 0 ? prompt.completionLabels : null) ?? prompt.completions;
  if (labels.length <= 1) return labels[0] ?? "";
  const shown = labels.slice(0, 5).join("  ");
  const suffix = labels.length > 5 ? "  +" + (labels.length - 5) + " more" : "";
  return shown + suffix;
}
function isEmptyUntitledBuffer(buffer) {
  return !buffer.path && !buffer.modified && buffer.lines.length === 1 && buffer.lines[0] === "";
}

function formatAbsoluteCursorLocation(buffer) {
  if (!buffer) return "+1:1";
  const y = clamp(buffer.cursor?.y ?? 0, 0, Math.max(0, (buffer.lines?.length ?? 1) - 1));
  const line = buffer.lines?.[y] ?? "";
  const x = normalizeCharBoundary(line, buffer.cursor?.x ?? 0);
  return `+${y + 1}:${x + 1}`;
}

function formatCursorLocation(buffer, pane = null) {
  if (!buffer) return "+1.0:1";
  const y = clamp(buffer.cursor?.y ?? 0, 0, Math.max(0, (buffer.lines?.length ?? 1) - 1));
  const line = buffer.lines?.[y] ?? "";
  const x = normalizeCharBoundary(line, buffer.cursor?.x ?? 0);
  let subRow = 0;
  let col = x + 1;
  if (pane && (buffer.Settings?.softwrap ?? false)) {
    const gutterW = editorGutterWidth(buffer);
    const bufW = Math.max(1, (pane.w ?? process.stdout.columns ?? 80) - gutterW);
    const wordwrap = buffer.Settings?.wordwrap ?? false;
    const tabsize = buffer.Settings?.tabsize ?? DEFAULT_SETTINGS.tabsize;
    const breaks = softwrapBreaks(line, bufW, wordwrap, tabsize);
    subRow = softwrapRowOfCharIdx(breaks, x);
    const segStart = breaks[subRow] ?? 0;
    col = displayWidth(line.slice(segStart, x)) + 1;
  }
  return `+${y + 1}.${subRow}:${col}`;
}

function makePaneAdapter(buffer, app = null) {
  const pane = {
    Buf: makeBufferAdapter(buffer),
    Cursor: makeCursorAdapter(buffer),
    CursorLocation: () => formatCursorLocation(buffer, app?.paneForBuffer?.(buffer) ?? app?.pane ?? null),
    AbsoluteCursorLocation: () => formatAbsoluteCursorLocation(buffer),
    Save: () => buffer.save(),
    Backspace: () => buffer.backspace(),
    Delete: () => buffer.deleteForward(),
    CursorLeft: () => buffer.moveLeft(),
    CursorRight: () => buffer.moveRight(),
    StartOfLine: () => buffer.moveHome(),
    EndOfLine: () => buffer.moveEnd(),
    InsertNewline: () => buffer.newline(),
    InsertTab: () => buffer.insert("\t"),
  };
  return pane;
}

function makeCursorAdapter(buffer) {
  return {
    get X() { return buffer.cursor.x; },
    set X(value) { buffer.cursor.x = clamp(Number(value), 0, buffer.line().length); },
    get Y() { return buffer.cursor.y; },
    set Y(value) { buffer.cursor.y = clamp(Number(value), 0, buffer.lines.length - 1); buffer.ensureCursor(); },
    get Loc() { return encodeLoc(buffer.cursor.x, buffer.cursor.y); },
    HasSelection: () => false,
  };
}

function makeBufferAdapter(buffer) {
  return {
    get Path()     { return buffer.Path ?? buffer.path ?? ""; },
    get AbsPath()  { return buffer.AbsPath ?? buffer.path ?? ""; },
    get Name()     { return buffer.Name ?? buffer.name ?? ""; },
    get Modified() { return buffer.modified ?? false; },
    get Settings() { return buffer.Settings; },
    get MdcuiModuleSource() {
      return global.MDCUI_MAIN && buffer._useBundledMdcuiModules
        ? "embedded"
        : "external";
    },
    Line: (...args) => buffer.Line(Number(lastArg(args))),
    Insert: (...args) => insertAtLoc(buffer, decodeLoc(args.at(-2)), String(args.at(-1))),
    Replace: (...args) => replaceAtLocs(buffer, decodeLoc(args.at(-3)), decodeLoc(args.at(-2)), String(args.at(-1))),
    LinesNum: () => buffer.LinesNum(),
    Bytes: () => buffer.Bytes(),
    Size: () => buffer.Size(),
    FileType: () => buffer.FileType(),
    SetOption: (...args) => buffer.SetOption(args.at(-2), args.at(-1)),
    DoSetOptionNative: (...args) => buffer.DoSetOptionNative(args.at(-2), args.at(-1)),
    AddMessage: (...args) => buffer.AddMessage(lastArg(args)),
    ClearMessages: (...args) => buffer.ClearMessages(lastArg(args)),
  };
}

function lastArg(args) {
  return args.at(-1);
}

function insertAtLoc(buffer, loc, text) {
  if (isEditLockedBuffer(buffer)) return;
  const old = { ...buffer.cursor };
  buffer.cursor = { x: clamp(loc.x, 0, buffer.Line(loc.y).length), y: clamp(loc.y, 0, buffer.lines.length - 1) };
  buffer.insert(text);
  const inserted = advanceLoc(loc, text);
  if (old.y > loc.y || (old.y === loc.y && old.x >= loc.x)) buffer.cursor = inserted;
  else buffer.cursor = old;
  buffer.ensureCursor();
}

function replaceAtLocs(buffer, start, end, text) {
  if (isEditLockedBuffer(buffer)) return;
  const s = { x: clamp(start.x, 0, buffer.Line(start.y).length), y: clamp(start.y, 0, buffer.lines.length - 1) };
  const e = { x: clamp(end.x, 0, buffer.Line(end.y).length), y: clamp(end.y, 0, buffer.lines.length - 1) };
  if (s.y === e.y) {
    const line = buffer.Line(s.y);
    buffer.lines[s.y] = line.slice(0, s.x) + text + line.slice(e.x);
  } else {
    const first = buffer.Line(s.y).slice(0, s.x);
    const last = buffer.Line(e.y).slice(e.x);
    const parts = normalizeNewlines(text).split("\n");
    const replacement = parts.length === 1 ? [first + parts[0] + last] : [first + parts[0], ...parts.slice(1, -1), parts.at(-1) + last];
    buffer.lines.splice(s.y, e.y - s.y + 1, ...replacement);
  }
  buffer.invalidateHighlightFrom?.(s.y, { force: s.y !== e.y || normalizeNewlines(text).includes("\n") });
  buffer.modified = true;
  buffer.ensureCursor();
}

function advanceLoc(loc, text) {
  const parts = normalizeNewlines(text).split("\n");
  if (parts.length === 1) return { x: loc.x + parts[0].length, y: loc.y };
  return { x: parts.at(-1).length, y: loc.y + parts.length - 1 };
}

function normalizeNewlines(text) {
  return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function encodeLoc(x, y) {
  return -((Number(y) * 1000000) + Number(x) + 1);
}

function decodeLoc(value) {
  if (typeof value === "number") {
    const n = Math.abs(Math.trunc(value)) - 1;
    return { x: n % 1000000, y: Math.floor(n / 1000000) };
  }
  return { x: Number(value?.X ?? value?.x ?? 0), y: Number(value?.Y ?? value?.y ?? 0) };
}

function highlightBufferLine(buf, lineNo) {
  if (!buf.highlighter) return { changes: new Map([[0, "default"]]), state: null };
  const cache = highlightCache(buf);
  const target = clamp(lineNo, 0, buf.lines.length - 1);
  let state = null;
  let result = { changes: new Map([[0, "default"]]), state: null };
  let start = 0;

  if (cache.validTo >= 0) {
    const cachedLine = Math.min(cache.validTo, target);
    result = cache.results[cachedLine] ?? result;
    state = cache.states[cachedLine] ?? null;
    start = cachedLine + 1;
    if (cachedLine === target) return result;
  }

  for (let y = start; y <= target; y++) {
    const line = buf.lines[y] ?? "";
    startupHighlightProgress?.beforeLine(line.length, y, target);
    if (!cache.forceLongLineRehighlight && cache.dirtyLongLines.has(y) && cache.results[y]) {
      result = cache.results[y];
      state = cache.states[y] ?? null;
    } else if (!cache.forceLongLineRehighlight && line.length > LONG_LINE_INITIAL_HIGHLIGHT_LIMIT) {
      // Too long to highlight interactively — store a default result and mark dirty for Esc rehighlight.
      if (!cache.results[y]) {
        cache.results[y] = { changes: new Map([[0, "default"], [line.length, "default"]]), state: null };
        cache.states[y] = null;
      }
      result = cache.results[y];
      state = null;
      cache.dirtyLongLines.add(y);
    } else {
      const progress = startupHighlightProgress
        ? (pos) => startupHighlightProgress.linePosition(pos, y, target)
        : null;
      result = buf.highlighter.highlightLine(line, state, progress);
      state = result.state;
      cache.results[y] = result;
      cache.states[y] = state;
      cache.dirtyLongLines.delete(y);
    }
    startupHighlightProgress?.afterLine(line.length + 1, y, target);
  }
  cache.validTo = Math.max(cache.validTo, target);
  return result;
}

function highlightCache(buf) {
  if (!buf._highlightCache || buf._highlightCache.highlighter !== buf.highlighter) {
    buf._highlightCache = {
      highlighter: buf.highlighter,
      results: [],
      states: [],
      validTo: -1,
      dirtyLongLines: new Set(),
      forceLongLineRehighlight: false,
    };
  }
  return buf._highlightCache;
}

function invalidateHighlightFrom(buf, lineNo = 0, { force = false } = {}) {
  if (!buf) return;
  const cache = buf._highlightCache;
  if (!cache) return;
  const from = Math.max(0, Math.trunc(Number(lineNo) || 0));
  const line = buf.lines[from] ?? "";
  // Hard limit: never clear cache for very long lines even on force — mark dirty instead.
  if (line.length > LONG_LINE_INITIAL_HIGHLIGHT_LIMIT && cache.results[from]) {
    cache.dirtyLongLines.add(from);
    return;
  }
  if (!force && line.length > LONG_LINE_REHIGHLIGHT_LIMIT && cache.results[from]) {
    cache.dirtyLongLines.add(from);
    return;
  }
  cache.validTo = Math.min(cache.validTo, from - 1);
  cache.results.length = Math.min(cache.results.length, from);
  cache.states.length = Math.min(cache.states.length, from);
  for (const dirtyLine of [...cache.dirtyLongLines]) {
    if (dirtyLine >= from) cache.dirtyLongLines.delete(dirtyLine);
  }
}

function forceRehighlightDirtyLongLines(buf, app = null) {
  const cache = buf?._highlightCache;
  if (!buf?.highlighter || !cache || cache.dirtyLongLines.size === 0) return 0;
  const count = cache.dirtyLongLines.size;
  const from = Math.min(...cache.dirtyLongLines);
  const target = Math.max(cache.validTo, from);
  cache.validTo = Math.min(cache.validTo, from - 1);
  cache.forceLongLineRehighlight = true;
  const previousProgress = startupHighlightProgress;
  if (app) startupHighlightProgress = new StartupHighlightProgress(app, { immediate: true });
  try {
    highlightBufferLine(buf, target);
  } finally {
    startupHighlightProgress = previousProgress;
    cache.forceLongLineRehighlight = false;
    if (app?.screen) app.screen.previous = null;
  }
  return count;
}

function isDirtyLongLine(buf, lineNo) {
  return buf?._highlightCache?.dirtyLongLines?.has(lineNo) ?? false;
}

function flatOffsetToLoc(startX, startY, text, offset) {
  const before = text.slice(0, offset);
  const nlCount = (before.match(/\n/g) || []).length;
  const lastNlIdx = before.lastIndexOf("\n");
  const colAfterNl = lastNlIdx === -1 ? before.length : before.length - lastNlIdx - 1;
  return { x: nlCount === 0 ? startX + colAfterNl : colAfterNl, y: startY + nlCount };
}

function splitSentencesWithPositions(text, startX, startY) {
  const re = /(?<=[.!?。！？…；;])\s*|[\r\n]+/g;
  const result = [];
  let segStart = 0;
  for (const match of text.matchAll(re)) {
    const raw = text.slice(segStart, match.index);
    const trimmed = raw.trim();
    if (trimmed) {
      const lead = raw.length - raw.trimStart().length;
      const absStart = segStart + lead;
      result.push({
        text: trimmed,
        start: flatOffsetToLoc(startX, startY, text, absStart),
        end: flatOffsetToLoc(startX, startY, text, absStart + trimmed.length),
      });
    }
    segStart = match.index + match[0].length;
  }
  const raw = text.slice(segStart);
  const trimmed = raw.trim();
  if (trimmed) {
    const lead = raw.length - raw.trimStart().length;
    const absStart = segStart + lead;
    result.push({
      text: trimmed,
      start: flatOffsetToLoc(startX, startY, text, absStart),
      end: flatOffsetToLoc(startX, startY, text, absStart + trimmed.length),
    });
  }
  return result;
}

// Returns { cmd: string[], via: "arg"|"stdin" } or null
function detectTtsCmd() {
  const platform = platformId();
  const pitch = parseFloat(Bun.env.TTS_PITCH) || 1;
  const speed = parseFloat(Bun.env.TTS_SPEED) || 1.5;
  Bun.env.TTS_PITCH = String(pitch);
  Bun.env.TTS_SPEED = String(speed);
  
  const lang = Bun.env.TTS_LANG || 'zh-TW'
  Bun.env.TTS_LANG = lang ;

  if (platform === "android") {
    if (Bun.which("termux-tts-speak"))
      return { cmd: ["termux-tts-speak", "-p", String(pitch), "-r", String(speed)], via: "arg" };
  }

  if (platform === "darwin") {
    // say -r <wpm>; pitch via [[pbas n]] embedded TTS command (0-127, 48 = normal)
    const rate = Math.round(175 * speed);
    const pitchN = Math.max(0, Math.min(127, Math.round(48 * pitch)));
    return {
      cmd: ["say", "-r", String(rate)],
      via: "arg",
      textTransform: pitchN !== 48 ? (t) => `[[pbas ${pitchN}]] ${t}` : null,
    };
  }

  if (platform === "win32") {
    // Rate property: -10 to 10 (0 = normal); pitch via SSML <prosody>
    const rate = Math.max(-10, Math.min(10, Math.round((speed - 1) * 10)));
    const pitchPct = Math.round((pitch - 1) * 100);
    const pitchAttr = (pitchPct >= 0 ? "+" : "") + pitchPct + "%";
    for (const shell of ["pwsh.exe", "powershell.exe"]) {
      if (Bun.which(shell)) {
        const psCmd =
          "Add-Type -AssemblyName System.Speech; " +
          `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.Rate = ${rate}; ` +
          `$t = [Console]::In.ReadToEnd(); ` +
          `$x = [System.Security.SecurityElement]::Escape($t); ` +
          `$s.SpeakSsml('<speak xml:lang="${lang}" version="1.0" xmlns="http://www.w3.org/2001/10/synthesis"><prosody pitch="${pitchAttr}">' + $x + '</prosody></speak>')`;
        return { cmd: [shell, "-NoProfile", "-Command", psCmd], via: "stdin" };
      }
    }
  }

  // Linux / Android fallback: espeak-ng / espeak
  // Speed: -s <wpm> (175 = normal), Pitch: -p <n> (0-99, 50 = normal)
  for (const bin of ["espeak-ng", "espeak"]) {
    if (Bun.which(bin)) {
      const spd = Math.round(175 * speed);
      const pit = Math.max(0, Math.min(99, Math.round(50 * pitch)));
      return { cmd: [bin, '-s', spd, '-p', pit], via: "arg" };
    }
  }
  
  if(Bun.which("tts"))
    return {cmd:['tts'],via:'arg'};
    
  return null;
}

function commandHasStartCursor(command = {}) {
  return Boolean(command.startCursor && command.startCursor.line >= 1);
}

function commandHasStartupJump(command = {}) {
  return commandHasStartCursor(command) || Boolean(command.searchRegex);
}

async function loadBufferForPath(pathOrUrl, context, command = {}, { interactive = false } = {}) {
  const loadContext = interactive
    ? { ...context, inputEncoding: defaultAllSettings().encoding, encodingExplicit: false }
    : context;
  if (isHttpUrl(pathOrUrl) && loadContext.allowUrl) {
    const url = new URL(pathOrUrl);
    let name;
    try { name = decodeURIComponent(basename(url.pathname)); }
    catch { name = basename(url.pathname); }
    if (!name) name = "remote.md";
    if (!name.toLowerCase().endsWith(".md")) name += ".md";
    const localPath = resolve(name);
    await Bun.write(localPath, await fetchHttpBytes(pathOrUrl));
    remoteMarkdownSources.set(localPath, new URL(pathOrUrl).href);
    return await loadBufferForPath(localPath, loadContext, command, { interactive });
  }
  let buffer;
  if (isHttpUrl(pathOrUrl)) {
    let encoding = loadContext.inputEncoding ?? loadContext.config?.globalSettings?.encoding ?? DEFAULT_SETTINGS.encoding;
    const decoded = await fetchTextWithEncoding(pathOrUrl, encoding, !loadContext.encodingExplicit);
    const text = decoded.text;
    encoding = decoded.encoding;
    const urlPath = pathOrUrl.replace(/[?#].*$/, "");
    buffer = new BufferModel({
      path: pathOrUrl,
      text,
      command,
      encoding,
      ansiStyleLines: decoded.ansiStyleLines ?? null,
      ansiText: decoded.ansiText ?? null,
      sourceText: decoded.sourceText ?? null,
      tuiSourceText: decoded.tuiSourceText ?? null,
      mdcuiRenderWidth: decoded.mdcuiRenderWidth ?? 0,
      mdcuiImages: decoded.mdcuiImages ?? null,
    });
    buffer._configDir = context?.config?.configDir ?? null;
    attachSyntax(buffer, loadContext, urlPath, text);
  } else {
    if (!context._openBuffers) context._openBuffers = new Map();
    const absPath = resolve(pathOrUrl);
    const existing = context._openBuffers.get(absPath);
    const requestedEncoding = encodingForPath(
      absPath,
      loadContext.inputEncoding ?? loadContext.config?.globalSettings?.encoding ?? DEFAULT_SETTINGS.encoding,
      !loadContext.encodingExplicit,
    );
    if (existing && !isMdcuiEncoding(existing.encoding) && !isMdcuiEncoding(requestedEncoding)) return existing;
    buffer = await BufferModel.fromFile(absPath, command, loadContext);
    // Check for crash-recovery backup before returning the buffer.
    const promptFn = context._termPrompt;
    if (promptFn && buffer._configDir) {
      const { recovered, abort } = await applyBackup(buffer, buffer._configDir, promptFn);
      if (abort) return new BufferModel({ command });
      if (recovered) {
        buffer.ensureCursor();
        attachSyntax(buffer, context, absPath, buffer.lines.join("\n"));
      }
    }
    // mdcui is a derived, read-only view. Keep every view independent and out
    // of the same-path cache used by normal editable buffers.
    if (!isMdcuiEncoding(buffer.encoding)) {
      buffer._openBufferMap = context._openBuffers;
      context._openBuffers.set(absPath, buffer);
    }
  }
  if (DEFAULT_SETTINGS.savecursor && !commandHasStartupJump(command) && context?.cursorStates?.[pathOrUrl]) {
    const saved = context.cursorStates[pathOrUrl];
    const y = clamp(saved.y ?? 0, 0, buffer.lines.length - 1);
    const x = clamp(saved.x ?? 0, 0, buffer.lines[y]?.length ?? 0);
    buffer.cursor = { x, y };
    buffer._pendingCenterScroll = true;
  }
  return buffer;
}

function editorGutterWidth(buf) {
  const lineNumW = (buf?.Settings?.ruler ?? DEFAULT_SETTINGS.ruler) ? 5 : 0;
  const diffW    = (buf?.Settings?.diffgutter ?? false) ? 1 : 0;
  const msgW     = (buf?.Messages?.length ?? 0) > 0 ? 2 : 0;
  return msgW + diffW + lineNumW;
}

// Line diff ported 1:1 from Go's go-diff (sergi/go-diff diffmatchpatch),
// matching internal/buffer/buffer.go updateDiff: DiffLinesToRunes + DiffMainRunes,
// then walk the equal/insert/delete ops to produce per-line markers.
// Each distinct line maps to one integer id (== DiffLinesToRunes); the diff
// runs over id arrays. Ops come back in go-diff canonical order (deletes before
// inserts) so the modified-line detection below matches Go exactly.
const _DIFF_DELETE = -1, _DIFF_INSERT = 1, _DIFF_EQUAL = 0;

function _arrEq(a, b) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
function _commonPrefix(a, b) { const n = Math.min(a.length, b.length); let i = 0; while (i < n && a[i] === b[i]) i++; return i; }
function _commonSuffix(a, b) { const n = Math.min(a.length, b.length); let i = 0; while (i < n && a[a.length-1-i] === b[b.length-1-i]) i++; return i; }
function _indexOfSub(longArr, shortArr) { const L = longArr.length, S = shortArr.length; if (S === 0) return 0; outer: for (let i = 0; i + S <= L; i++) { for (let j = 0; j < S; j++) if (longArr[i+j] !== shortArr[j]) continue outer; return i; } return -1; }
function _hasSuffix(seq, suf) { if (suf.length > seq.length) return false; for (let i = 0; i < suf.length; i++) if (seq[seq.length-suf.length+i] !== suf[i]) return false; return true; }
function _hasPrefix(seq, pre) { if (pre.length > seq.length) return false; for (let i = 0; i < pre.length; i++) if (seq[i] !== pre[i]) return false; return true; }

function _diffMain(a, b) {
  if (_arrEq(a, b)) return a.length ? [{ op: _DIFF_EQUAL, seq: a.slice() }] : [];
  const pre = _commonPrefix(a, b);
  const commonprefix = a.slice(0, pre);
  a = a.slice(pre); b = b.slice(pre);
  const suf = _commonSuffix(a, b);
  const commonsuffix = a.slice(a.length - suf);
  a = a.slice(0, a.length - suf); b = b.slice(0, b.length - suf);
  const diffs = _diffCompute(a, b);
  if (commonprefix.length) diffs.unshift({ op: _DIFF_EQUAL, seq: commonprefix });
  if (commonsuffix.length) diffs.push({ op: _DIFF_EQUAL, seq: commonsuffix });
  return _diffCleanupMerge(diffs);
}

function _diffCompute(a, b) {
  if (a.length === 0) return [{ op: _DIFF_INSERT, seq: b.slice() }];
  if (b.length === 0) return [{ op: _DIFF_DELETE, seq: a.slice() }];
  const aLonger = a.length > b.length;
  const long = aLonger ? a : b, short = aLonger ? b : a;
  const idx = _indexOfSub(long, short);
  if (idx !== -1) {
    const op = aLonger ? _DIFF_DELETE : _DIFF_INSERT;
    return [
      { op, seq: long.slice(0, idx) },
      { op: _DIFF_EQUAL, seq: short.slice() },
      { op, seq: long.slice(idx + short.length) },
    ];
  }
  if (short.length === 1) return [{ op: _DIFF_DELETE, seq: a.slice() }, { op: _DIFF_INSERT, seq: b.slice() }];
  return _diffBisect(a, b);
}

function _diffBisect(a, b) {
  const n = a.length, m = b.length;
  const maxD = Math.ceil((n + m) / 2);
  const vOffset = maxD, vLength = 2 * maxD;
  const v1 = new Int32Array(vLength).fill(-1);
  const v2 = new Int32Array(vLength).fill(-1);
  v1[vOffset + 1] = 0; v2[vOffset + 1] = 0;
  const delta = n - m;
  const front = (delta % 2 !== 0);
  let k1start = 0, k1end = 0, k2start = 0, k2end = 0;
  for (let d = 0; d < maxD; d++) {
    for (let k1 = -d + k1start; k1 <= d - k1end; k1 += 2) {
      const k1Offset = vOffset + k1;
      let x1;
      if (k1 === -d || (k1 !== d && v1[k1Offset-1] < v1[k1Offset+1])) x1 = v1[k1Offset+1];
      else x1 = v1[k1Offset-1] + 1;
      let y1 = x1 - k1;
      while (x1 < n && y1 < m && a[x1] === b[y1]) { x1++; y1++; }
      v1[k1Offset] = x1;
      if (x1 > n) k1end += 2;
      else if (y1 > m) k1start += 2;
      else if (front) {
        const k2Offset = vOffset + delta - k1;
        if (k2Offset >= 0 && k2Offset < vLength && v2[k2Offset] !== -1) {
          const x2 = n - v2[k2Offset];
          if (x1 >= x2) return _diffBisectSplit(a, b, x1, y1);
        }
      }
    }
    for (let k2 = -d + k2start; k2 <= d - k2end; k2 += 2) {
      const k2Offset = vOffset + k2;
      let x2;
      if (k2 === -d || (k2 !== d && v2[k2Offset-1] < v2[k2Offset+1])) x2 = v2[k2Offset+1];
      else x2 = v2[k2Offset-1] + 1;
      let y2 = x2 - k2;
      while (x2 < n && y2 < m && a[n-x2-1] === b[m-y2-1]) { x2++; y2++; }
      v2[k2Offset] = x2;
      if (x2 > n) k2end += 2;
      else if (y2 > m) k2start += 2;
      else if (!front) {
        const k1Offset = vOffset + delta - k2;
        if (k1Offset >= 0 && k1Offset < vLength && v1[k1Offset] !== -1) {
          const x1 = v1[k1Offset];
          const y1 = vOffset + x1 - k1Offset;
          const x2real = n - x2;
          if (x1 >= x2real) return _diffBisectSplit(a, b, x1, y1);
        }
      }
    }
  }
  return [{ op: _DIFF_DELETE, seq: a.slice() }, { op: _DIFF_INSERT, seq: b.slice() }];
}

function _diffBisectSplit(a, b, x, y) {
  return _diffMain(a.slice(0, x), b.slice(0, y)).concat(_diffMain(a.slice(x), b.slice(y)));
}

function _diffCleanupMerge(diffs) {
  diffs.push({ op: _DIFF_EQUAL, seq: [] });
  let pointer = 0, countDelete = 0, countInsert = 0, textDelete = [], textInsert = [];
  while (pointer < diffs.length) {
    const d = diffs[pointer];
    if (d.op === _DIFF_INSERT) { countInsert++; textInsert = textInsert.concat(d.seq); pointer++; }
    else if (d.op === _DIFF_DELETE) { countDelete++; textDelete = textDelete.concat(d.seq); pointer++; }
    else {
      if (countDelete + countInsert > 1) {
        if (countDelete !== 0 && countInsert !== 0) {
          let cl = _commonPrefix(textInsert, textDelete);
          if (cl !== 0) {
            const x = pointer - countDelete - countInsert;
            if (x > 0 && diffs[x-1].op === _DIFF_EQUAL) diffs[x-1].seq = diffs[x-1].seq.concat(textInsert.slice(0, cl));
            else { diffs.unshift({ op: _DIFF_EQUAL, seq: textInsert.slice(0, cl) }); pointer++; }
            textInsert = textInsert.slice(cl); textDelete = textDelete.slice(cl);
          }
          cl = _commonSuffix(textInsert, textDelete);
          if (cl !== 0) {
            const insIdx = textInsert.length - cl;
            diffs[pointer].seq = textInsert.slice(insIdx).concat(diffs[pointer].seq);
            textInsert = textInsert.slice(0, insIdx); textDelete = textDelete.slice(0, textDelete.length - cl);
          }
        }
        const repl = [];
        if (textDelete.length) repl.push({ op: _DIFF_DELETE, seq: textDelete });
        if (textInsert.length) repl.push({ op: _DIFF_INSERT, seq: textInsert });
        const start = pointer - countDelete - countInsert;
        diffs.splice(start, countDelete + countInsert, ...repl);
        pointer = start + repl.length + 1;
      } else if (pointer !== 0 && diffs[pointer-1].op === _DIFF_EQUAL) {
        diffs[pointer-1].seq = diffs[pointer-1].seq.concat(d.seq);
        diffs.splice(pointer, 1);
      } else pointer++;
      countInsert = 0; countDelete = 0; textDelete = []; textInsert = [];
    }
  }
  if (diffs[diffs.length-1].seq.length === 0) diffs.pop();

  // Second pass: shift a single edit sandwiched between two equalities sideways.
  let changes = false;
  pointer = 1;
  while (pointer < diffs.length - 1) {
    const prev = diffs[pointer-1], cur = diffs[pointer], next = diffs[pointer+1];
    if (prev.op === _DIFF_EQUAL && next.op === _DIFF_EQUAL) {
      if (_hasSuffix(cur.seq, prev.seq)) {
        if (prev.seq.length) {
          cur.seq = prev.seq.concat(cur.seq.slice(0, cur.seq.length - prev.seq.length));
          next.seq = prev.seq.concat(next.seq);
        }
        diffs.splice(pointer-1, 1); changes = true;
      } else if (_hasPrefix(cur.seq, next.seq)) {
        prev.seq = prev.seq.concat(next.seq);
        cur.seq = cur.seq.slice(next.seq.length).concat(next.seq);
        diffs.splice(pointer+1, 1); changes = true;
      }
    }
    pointer++;
  }
  if (changes) return _diffCleanupMerge(diffs);
  return diffs;
}

// Diff marker constants: 0=none 1=added 2=modified 3=deleted_above
// Walk mirrors Go's buffer.updateDiff exactly:
//   Equal:  lineN advances by line count
//   Insert: ALL inserted lines get same status — DSModified if markers[lineN]
//           was DSDeletedAbove, DSAdded otherwise; lineN advances per line
//   Delete: marks markers[lineN] = DSDeletedAbove (does NOT advance lineN)
function computeDiffMarkers(baseText, currLines) {
  const base = String(baseText).split(/\r?\n/);
  if (base.at(-1) === "") base.pop();
  const n = base.length, m = currLines.length;
  if (m === 0) return new Uint8Array(0);

  // Go's UpdateDiff skips computing diffs once total line count >= 30000.
  if (Math.max(n, m) >= 30000) return new Uint8Array(m);

  // Map each distinct line to an integer id (== go-diff DiffLinesToRunes).
  const ids = new Map();
  const idOf = (s) => { let v = ids.get(s); if (v === undefined) { v = ids.size; ids.set(s, v); } return v; };
  const a = new Array(n); for (let i = 0; i < n; i++) a[i] = idOf(base[i]);
  const bArr = new Array(m); for (let i = 0; i < m; i++) bArr[i] = idOf(currLines[i]);

  const diffs = _diffMain(a, bArr);
  const markers = new Uint8Array(m);
  let lineN = 0;
  for (const d of diffs) {
    const cnt = d.seq.length;
    if (d.op === _DIFF_EQUAL) lineN += cnt;
    else if (d.op === _DIFF_INSERT) {
      const status = (lineN < m && markers[lineN] === 3) ? 2 : 1;
      for (let i = 0; i < cnt; i++) { if (lineN < m) markers[lineN] = status; lineN++; }
    } else if (lineN < m) markers[lineN] = 3;
  }
  return markers;
}

function getDiffMarkers(buf) {
  if (!buf.diffBase) return null;
  const rev = buf._editRev ?? 0;
  const cache = buf._diffMarkersCache;
  if (cache && cache.rev === rev) return cache.markers;

  if (buf._diffDebounceTimer) clearTimeout(buf._diffDebounceTimer);
  buf._diffDebounceTimer = setTimeout(() => {
    buf._diffDebounceTimer = null;
    const markers = computeDiffMarkers(buf.diffBase, buf.lines);
    buf._diffMarkersCache = { rev: buf._editRev ?? 0, markers };
    buf._diffOnUpdate?.();
  }, 150);

  return cache?.markers ?? null;
}

function wordSelectionAt(buf, x, y) {
  const line = buf.lines[y] ?? "";
  if (line.length === 0) return { start: { x: 0, y }, end: { x: 0, y } };
  const cx = Math.min(x, line.length - 1);
  const isWordChar = (ch) => /[\w]/.test(ch);
  if (!isWordChar(line[cx])) {
    // Non-word character: select just that character
    return { start: { x: cx, y }, end: { x: cx + 1, y } };
  }
  let start = cx;
  while (start > 0 && isWordChar(line[start - 1])) start--;
  let end = cx + 1;
  while (end < line.length && isWordChar(line[end])) end++;
  return { start: { x: start, y }, end: { x: end, y } };
}

function lineNumberText(buf, lineNo, row, gutterW) {
  if (lineNo >= buf.lines.length) return " ".repeat(gutterW);
  if (buf.Settings?.relativeruler && lineNo !== buf.cursor.y) {
    return String(Math.abs(lineNo - buf.cursor.y)).padStart(Math.max(0, gutterW - 1)) + " ";
  }
  return String(lineNo + 1).padStart(Math.max(0, gutterW - 1)) + " ";
}

function visualLineNumberText(subRow, gutterW) {
  const text = `.${subRow}`;
  const numberW = Math.max(0, gutterW - 1);
  const padded = text.length >= numberW
    ? text.slice(text.length - numberW)
    : text.padStart(numberW);
  return padded + " ";
}

const BRACE_PAIRS = { "(": ")", "[": "]", "{": "}" };
const BRACE_REVERSE = { ")": "(", "]": "[", "}": "{" };

function findMatchingBracePositions(buf) {
  const pair = findMatchingBracePair(buf);
  if (!pair?.origin) return null;
  if (!pair.match) return new Set([braceKey(pair.origin)]);
  return new Set([braceKey(pair.origin), braceKey(pair.match)]);
}

function findMatchingBracePair(buf) {
  if (!(buf?.Settings?.matchbrace ?? DEFAULT_SETTINGS.matchbrace)) return null;
  if ((buf.lines[buf.cursor.y] ?? "").length > LONG_LINE_INITIAL_HIGHLIGHT_LIMIT) return null;
  const left = braceAt(buf, buf.cursor.x - 1, buf.cursor.y);
  const right = braceAt(buf, buf.cursor.x, buf.cursor.y);
  let origin = null;
  if (right) origin = right;
  else if ((buf.Settings?.matchbraceleft ?? DEFAULT_SETTINGS.matchbraceleft) && left) origin = left;
  if (!origin) return null;
  const match = BRACE_PAIRS[origin.ch]
    ? findForwardBrace(buf, origin, origin.ch, BRACE_PAIRS[origin.ch])
    : findBackwardBrace(buf, origin, BRACE_REVERSE[origin.ch], origin.ch);
  return { origin, match };
}

function braceAt(buf, x, y) {
  const line = buf.lines[y] ?? "";
  if (x < 0 || x >= line.length) return null;
  const ch = line[x];
  return BRACE_PAIRS[ch] || BRACE_REVERSE[ch] ? { x, y, ch } : null;
}

function findForwardBrace(buf, origin, open, close) {
  let depth = 0;
  for (let y = origin.y; y < buf.lines.length; y++) {
    const line = buf.lines[y] ?? "";
    const start = y === origin.y ? origin.x : 0;
    for (let x = start; x < line.length; x++) {
      const ch = line[x];
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) return { x, y, ch };
      }
    }
  }
  return null;
}

function findBackwardBrace(buf, origin, open, close) {
  let depth = 0;
  for (let y = origin.y; y >= 0; y--) {
    const line = buf.lines[y] ?? "";
    const start = y === origin.y ? origin.x : line.length - 1;
    for (let x = start; x >= 0; x--) {
      const ch = line[x];
      if (ch === close) depth++;
      else if (ch === open) {
        depth--;
        if (depth === 0) return { x, y, ch };
      }
    }
  }
  return null;
}

function braceKey(loc) {
  return String(loc.y) + ":" + String(loc.x);
}

function renderHighlightedCells(buf, lineNo, scrollX, maxWidth, colorscheme, selection = null, searchRanges = [], braceMatches = null, cursorLineBg = null) {
  const raw = buf.lines[lineNo] ?? "";
  const cells = [];
  let width = 0;
  let changes = [[0, "default"], [raw.length, "default"]];
  const ansiStyles = buf._ansiStyleLines?.[lineNo] ?? null;
  if (!ansiStyles && buf.highlighter && colorscheme) {
    const highlighted = highlightBufferLine(buf, lineNo);
    changes = [...highlighted.changes.entries()].sort(([a], [b]) => a - b);
    if (changes.length === 0 || changes[0][0] !== 0) changes.unshift([0, "default"]);
    changes.push([raw.length, changes.at(-1)?.[1] ?? "default"]);
  }
  // Go: cursor-line bg is skipped when a syntax style already has a non-default background (preservebg)
  const defBg = colorscheme?.defaultStyle?.bg ?? "default";
  const tableStripeBg = colorscheme?.styles?.has("cursor-line")
    ? colorscheme.get("cursor-line")?.fg
    : colorscheme?.styles?.has("color-column")
      ? colorscheme.get("color-column")?.fg
      : null;

  const showTrailingWs = buf.Settings?.hltrailingws ?? false;
  let trailingWsIdx = raw.length;
  if (showTrailingWs) {
    let k = raw.length - 1;
    while (k >= 0 && (raw[k] === " " || raw[k] === "\t")) k--;
    trailingWsIdx = k + 1;
  }
  const trailingWsColor = showTrailingWs && colorscheme?.styles?.has("trailingws")
    ? colorscheme.get("trailingws")?.fg
    : null;

  // showchars parsing (Go bufwindow.go:455-476)
  const indentchar = buf.Settings?.indentchar ?? " ";
  let spacechars = " ";
  let tabchars = indentchar;
  let indentspacechars = "";
  let indenttabchars = "";
  for (const entry of String(buf.Settings?.showchars ?? "").split(",")) {
    const eq = entry.indexOf("=");
    if (eq < 0) continue;
    const key = entry.slice(0, eq);
    const val = entry.slice(eq + 1);
    if (key === "space") spacechars = val;
    else if (key === "tab") tabchars = val;
    else if (key === "ispace") indentspacechars = val;
    else if (key === "itab") indenttabchars = val;
  }
  // Only inspect visible leading whitespace. Once horizontally scrolled, the
  // line start is off-screen and should not make redraw cost depend on it.
  let leadingwsEnd = 0;
  if (scrollX === 0) {
    const visibleEnd = Math.min(raw.length, maxWidth);
    while (leadingwsEnd < visibleEnd && (raw[leadingwsEnd] === " " || raw[leadingwsEnd] === "\t")) leadingwsEnd++;
  }

  const hltaberrors = buf.Settings?.hltaberrors ?? false;
  const tabstospaces = buf.Settings?.tabstospaces ?? false;
  const tabErrorFg = hltaberrors && colorscheme?.styles?.has("tab-error")
    ? colorscheme.get("tab-error")?.fg
    : null;
  const indentCharFg = colorscheme?.styles?.has("indent-char")
    ? colorscheme.get("indent-char")?.fg
    : null;
  const colorcolumn = Number(buf.Settings?.colorcolumn ?? 0) | 0;
  const colorColumnBg = colorcolumn > 0 && colorscheme?.styles?.has("color-column")
    ? colorscheme.get("color-column")?.fg
    : null;
  const tabsize = buf.Settings?.tabsize ?? DEFAULT_SETTINGS.tabsize;

  // Keep horizontal rendering bounded to the visible range. Reconstructing
  // the exact display width before scrollX makes long-line redraws O(scrollX).
  const scrollVisualCol = scrollX;

  // Linter messages overlapping this line (Go bufwindow.go:662-668)
  const lineMessages = (buf.Messages ?? []).filter((m) => {
    const sy = m.Start?.Y ?? 0, ey = m.End?.Y ?? 0;
    return sy <= lineNo && ey >= lineNo;
  });
  const inMessageAt = (charIdx) => {
    for (const m of lineMessages) {
      const sY = m.Start?.Y ?? 0, sX = m.Start?.X ?? 0;
      const eY = m.End?.Y ?? 0, eX = m.End?.X ?? 0;
      const ge = lineNo > sY || (lineNo === sY && charIdx >= sX);
      const lt = lineNo < eY || (lineNo === eY && charIdx < eX);
      if (ge && lt) return true;
    }
    return false;
  };

  let changeIndex = 0;
  let searchIdx = 0;
  let i = scrollX;
  while (i < raw.length && width < maxWidth) {
    const unit = displayUnitAt(raw, i);
    const ch = unit.text;
    const charLen = unit.length;
    const w = unit.width;
    if (charLen <= 0) break;
    while (changeIndex + 1 < changes.length && i >= changes[changeIndex + 1][0]) changeIndex++;
    const group = changes[changeIndex]?.[1] ?? "default";
    const ansiStyle = ansiStyles?.[i] ?? null;
    const syntaxStyle = ansiStyle
      ? { ...(colorscheme?.defaultStyle ?? {}), ...ansiStyle }
      : (colorscheme?.get(group) ?? colorscheme?.defaultStyle ?? {});
    let preservebg = syntaxStyle.bg !== undefined && syntaxStyle.bg !== defBg;
    const stripedStyle = (
      ansiStyle?.mdcuiTableStripe
      && tableStripeBg != null
      && !preservebg
    ) ? { ...syntaxStyle, bg: tableStripeBg } : syntaxStyle;
    if (stripedStyle !== syntaxStyle) preservebg = true;
    let baseStyle = cursorLineBg
      ? { ...stripedStyle, bg: cursorLineBg }
      : stripedStyle;
    while (searchIdx < searchRanges.length && searchRanges[searchIdx][1] <= i) searchIdx++;
    const inSearch = searchIdx < searchRanges.length && i >= searchRanges[searchIdx][0] && i < searchRanges[searchIdx][1];
    const selected = isSelected(selection, lineNo, i, i + charLen);
    const braceMatched = braceMatches?.has(String(lineNo) + ":" + String(i));

    // tab-error in leading whitespace
    let style = baseStyle;
    const inLeading = i < leadingwsEnd;
    if (tabErrorFg != null && inLeading) {
      if ((tabstospaces && ch === "\t") || (!tabstospaces && ch === " ")) {
        style = { ...style, bg: tabErrorFg };
        preservebg = true;
      }
    }
    if (trailingWsColor != null && i >= trailingWsIdx) {
      style = { ...style, bg: trailingWsColor };
      preservebg = true;
    }
    if (inSearch) {
      const searchStyle = colorscheme?.styles?.has("hlsearch") ? colorscheme.get("hlsearch") : null;
      style = searchStyle ?? { ...(colorscheme?.defaultStyle ?? {}), reverse: true };
      if ((style.bg ?? "default") !== defBg) preservebg = true;
    }
    if (braceMatched) {
      if ((buf.Settings?.matchbracestyle ?? DEFAULT_SETTINGS.matchbracestyle) === "highlight") {
        const braceStyle = colorscheme?.styles?.has("match-brace") ? colorscheme.get("match-brace") : null;
        style = braceStyle ?? { ...style, reverse: !style.reverse };
      } else {
        style = { ...style, underline: true };
      }
    }
    if (selected) {
      const selectionStyle = colorscheme?.styles?.has("selection") ? colorscheme.get("selection") : null;
      style = selectionStyle ?? { ...(colorscheme?.defaultStyle ?? {}), reverse: true };
    }
    if (lineMessages.length > 0 && inMessageAt(i)) {
      style = { ...style, underline: true };
    }

    // Visualize whitespace
    let displayCh = ch;
    let useIndentCharFg = false;
    if (ch === " ") {
      // Go bufwindow.go:554-559: ispace only kicks in at tabsize boundaries (indent guide).
      const visualCol = scrollVisualCol + width;
      const useIspace = inLeading && indentspacechars && (visualCol % tabsize === 0);
      const candidate = useIspace ? indentspacechars : spacechars;
      if (candidate && candidate !== " ") {
        displayCh = candidate[0] ?? " ";
        useIndentCharFg = true;
      }
    } else if (ch === "\t") {
      const candidate = (inLeading && indenttabchars) ? indenttabchars : tabchars;
      if (candidate && candidate !== " ") {
        displayCh = candidate[0] ?? " ";
        useIndentCharFg = true;
      } else {
        displayCh = " ";
      }
    }
    if (useIndentCharFg && indentCharFg != null) {
      style = { ...style, fg: indentCharFg };
    }

    const ccAt = (visualCol) => {
      if (colorColumnBg == null || preservebg) return null;
      return visualCol === colorcolumn ? colorColumnBg : null;
    };

    if (ch === "\t") {
      const spaces = Math.min(tabsize, maxWidth - width);
      for (let j = 0; j < spaces; j++) {
        const visualCol = scrollVisualCol + width;
        const cellCh = j === 0 ? displayCh : " ";
        const ccBg = ccAt(visualCol);
        const cellStyle = ccBg != null ? { ...style, bg: ccBg } : style;
        cells.push({ ch: cellCh, style: cellStyle });
        width++;
      }
    } else if (w > 0 && width + w <= maxWidth) {
      const visualCol = scrollVisualCol + width;
      const ccBg = ccAt(visualCol);
      const cellStyle = ccBg != null ? { ...style, bg: ccBg } : style;
      cells.push({ ch: displayCh, style: cellStyle, width: w });
      width += w;
    }
    i += charLen;
  }
  // Trailing fill: cursor-line bg and color-column always apply (Go bufwindow.go:807-826)
  while (width < maxWidth) {
    const visualCol = scrollVisualCol + width;
    let padStyle = cursorLineBg
      ? { ...(colorscheme?.defaultStyle ?? {}), bg: cursorLineBg }
      : (colorscheme?.defaultStyle ?? {});
    if (colorColumnBg != null && visualCol === colorcolumn) {
      padStyle = { ...padStyle, bg: colorColumnBg };
    }
    cells.push({ ch: " ", style: padStyle });
    width++;
  }
  return cells;
}

function putText(screen, x, y, text, style = null, maxWidth = Infinity) {
  let col = x;
  let width = 0;
  const str = String(text);
  for (let i = 0; i < str.length;) {
    if (width >= maxWidth) break;
    const unit = displayUnitAt(str, i);
    const ch = unit.text;
    const w = unit.width;
    if (unit.length <= 0) break;
    if (ch === "\t") {
      const spaces = Math.min(DEFAULT_SETTINGS.tabsize, maxWidth - width);
      for (let i = 0; i < spaces; i++) screen.setContent(col++, y, " ", style);
      width += spaces;
      i += unit.length;
      continue;
    }
    if (w <= 0 || width + w > maxWidth) {
      i += unit.length;
      continue;
    }
    screen.setContent(col, y, ch, style);
    if (w === 2) screen.setFillerContent(col + 1, y, style);
    col += w;
    width += w;
    i += unit.length;
  }
  return col;
}

function putCells(screen, x, y, cells, maxWidth = Infinity) {
  let col = x;
  let width = 0;
  for (const cell of cells) {
    if (width >= maxWidth) break;
    const w = cell.width ?? charWidth(cell.ch);
    if (w <= 0 || width + w > maxWidth) continue;
    screen.setContent(col, y, cell.ch, cell.style);
    if (w === 2) screen.setFillerContent(col + 1, y, cell.style);
    col += w;
    width += w;
  }
  return col;
}

function isSelected(selection, lineNo, start, end) {
  return Boolean(segmentSelection(selection, lineNo, start, end));
}

function allMatchPositions(text, re, literal) {
  const positions = [];
  if (re) {
    const g = new RegExp(re.source, re.flags.replace(/g/g, "") + "g");
    let m;
    while ((m = g.exec(text)) !== null) {
      positions.push(m.index);
      if (m[0].length === 0) g.lastIndex++;
    }
  } else {
    let idx = 0;
    while (idx < text.length) {
      const pos = text.indexOf(literal, idx);
      if (pos < 0) break;
      positions.push(pos);
      idx = pos + 1;
    }
  }
  return positions;
}

function getLineSearchRanges(buf, lineNo) {
  if (!buf.searchPattern) return [];
  if (!buf.searchMatches.has(lineNo)) {
    const raw = buf.lines[lineNo] ?? "";
    const ignoreCase = buf.Settings?.ignorecase ?? true;
    buf.searchMatches.set(lineNo, getSearchRanges(raw, buf.searchPattern, ignoreCase));
  }
  return buf.searchMatches.get(lineNo);
}

function getSearchRanges(line, pattern, ignoreCase = false, rangeStart = 0, rangeEnd = line.length) {
  if (!pattern) return [];
  let re;
  try {
    re = new RegExp(pattern, "g" + (ignoreCase ? "i" : ""));
  } catch {
    re = null;
  }
  const ranges = [];
  if (re) {
    re.lastIndex = rangeStart;
    let m;
    while ((m = re.exec(line)) !== null) {
      if (m.index >= rangeEnd) break;
      if (m[0].length === 0) { re.lastIndex++; continue; }
      ranges.push([m.index, m.index + m[0].length]);
    }
  } else {
    let idx = rangeStart;
    while (idx < rangeEnd) {
      const pos = line.indexOf(pattern, idx);
      if (pos < 0 || pos >= rangeEnd) break;
      ranges.push([pos, pos + pattern.length]);
      idx = pos + pattern.length;
    }
  }
  return ranges;
}

async function loadBuffers(files, command) {
  const buffers = [];
  if (files.length > 0) {
    for (const file of files) {
      try {
        buffers.push(await loadBufferForPath(file, loadBuffers.context ?? {}, command));
      } catch (error) {
        console.error(error.message || error);
      }
    }
  } else if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const context = loadBuffers.context ?? {};
    const encoding = context.config?.globalSettings?.encoding ?? DEFAULT_SETTINGS.encoding;
    const decoded = await decodeAndRenderTextBytes(Buffer.concat(chunks), encoding);
    const stdinText = decoded.text;
    const stdinBuf = new BufferModel({
      text: stdinText,
      type: process.stdout.isTTY ? "default" : "stdout",
      command,
      encoding: decoded.encoding,
      ansiStyleLines: decoded.ansiStyleLines ?? null,
      ansiText: decoded.ansiText ?? null,
      sourceText: decoded.sourceText ?? null,
      tuiSourceText: decoded.tuiSourceText ?? null,
      mdcuiRenderWidth: decoded.mdcuiRenderWidth ?? 0,
      mdcuiImages: decoded.mdcuiImages ?? null,
    });
    if (loadBuffers.context) attachSyntax(stdinBuf, loadBuffers.context, "", stdinText);
    buffers.push(stdinBuf);
  } else {
    const buffer = new BufferModel({ command });
    if (loadBuffers.context) attachSyntax(buffer, loadBuffers.context, "", "");
    buffers.push(buffer);
  }
  if (buffers.length > 0) return buffers;
  const buffer = new BufferModel({ command });
  if (loadBuffers.context) attachSyntax(buffer, loadBuffers.context, "", "");
  return [buffer];
}

async function printReadmeDocs() {
  process.stdout.write(Bun.markdown.ansi(await bundledReadmeSource(), { hyperlinks: true }));
}

async function bundledReadmeSource() {
  return readAssetText("README.md");
}

async function exportReadme() {
  const readmePath = resolve("README.md");
  await Bun.write(readmePath, await bundledReadmeSource());
  console.log(`Wrote ${readmePath}`);
}

async function exportCdpMaze() {
  const outputPath = resolve("cdp-maze.js");
  await Bun.write(outputPath, await bundledMarkdownSource("cdp-maze.js"));
  console.log(`Wrote ${outputPath}`);
}

async function printChangelogDocs() {
  const changelog = await readAssetText("CHANGELOG.md");
  process.stdout.write(Bun.markdown.ansi(changelog, { hyperlinks: true }));
}

async function printTestappSource() {
  process.stdout.write(await bundledMarkdownSource("testapp.md"));
}

async function bundledMarkdownSource(filename) {
  return readAssetText(filename);
}

function availableDemoAssets() {
  let paths;
  if (hasInternalAssets()) {
    paths = listInternalAssetPaths("demos");
  } else {
    try {
      paths = readdirSync(assetDiskPath("demos"), { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => assetPath("demos", entry.name));
    } catch {
      paths = [];
    }
  }

  return [...new Set(paths)]
    .filter((path) => /^demos\/[^/]+\.md$/i.test(path))
    .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
}

function printDemoList() {
  const demos = availableDemoAssets().map((asset) => ({
    option: `--demo-${asset.slice("demos/".length, -".md".length)}`,
    asset,
  }));
  const entries = [{ option: "--demo", asset: "testapp.md" }, ...demos];
  const optionWidth = Math.max(...entries.map(({ option }) => option.length));
  const descriptions = new Map([
    ["demos/imgtool.md", "compact table-based modern image processor UI"],
    ["demos/imgtool-zh.md", "Traditional Chinese compact table-based modern image processor UI"],
    ["demos/image-processor.md", "long-form document image processor UI"],
    ["demos/image-processor.zh-TW.md", "Traditional Chinese long-form document image processor UI"],
    ["demos/reader.md", "text-to-speech reader"],
  ]);

  console.log("Available demos:\n");
  for (const { option, asset } of entries) {
    const description = descriptions.get(asset);
    console.log(
      `  ${option.padEnd(optionWidth)}  ${asset}`
      + (description ? `  — ${description}` : ""),
    );
  }
}

async function prepareDemo(flags, rawFiles) {
  if (!flags.demo) return { ok: true };
  if (flags.demo.error) {
    console.error(`Invalid demo option ${flags.demo.option}: ${flags.demo.error}`);
    process.exitCode = 2;
    return { ok: false };
  }
  let demoSource;
  try {
    demoSource = await bundledMarkdownSource(flags.demo.asset);
  } catch {
    console.error(`Unknown demo ${flags.demo.option}: ${flags.demo.asset} was not found`);
    process.exitCode = 2;
    return { ok: false };
  }

  const demoPath = resolve(flags.demo.filename);
  const demoFile = Bun.file(demoPath);
  const demoExists = await demoFile.exists();
  const writeBundledContent = flags.overwriteDemo || !demoExists;
  const bundledByteLength = Buffer.byteLength(demoSource);
  const demoByteLength = writeBundledContent
    ? bundledByteLength
    : demoFile.size;
  const configuredMainBase = String(
    global.MDCUI_MAIN_BASE
      || (global.MDCUI_MAIN ? basename(String(global.MDCUI_MAIN)) : ""),
  );
  const isConfiguredMainDemo = Boolean(
    global.MDCUI_MAIN
    && configuredMainBase
    && basename(demoPath) === configuredMainBase,
  );

  if (writeBundledContent) {
    await Bun.write(demoPath, demoSource);
  } else if (isConfiguredMainDemo && demoByteLength !== bundledByteLength) {
    console.error(
      `[mdcui] ${demoPath} differs from the bundled demo `
      + `(${demoByteLength} bytes vs ${bundledByteLength} bytes). `
      + "The edited demo may not work correctly if it imports companion modules "
      + "instead of keeping all application code in the Markdown file.",
    );
  }

  rawFiles.splice(0, rawFiles.length, demoPath);
  return {
    ok: true,
    path: demoPath,
    useBundledModules: isConfiguredMainDemo
      && demoByteLength === bundledByteLength,
  };
}

function stringDefineFromArgv(argv, name) {
  const prefix = `${name}=`;
  for (let i = 0; i < argv.length; i++) {
    let definition = "";
    if (argv[i] === "--define") definition = argv[i + 1] ?? "";
    else if (argv[i].startsWith("--define="))
      definition = argv[i].slice("--define=".length);
    if (!definition.startsWith(prefix)) continue;
    try {
      const value = JSON.parse(definition.slice(prefix.length));
      return typeof value === "string" ? value : "";
    } catch {
      return "";
    }
  }
  return "";
}

async function main() {
  addCheckpoint("Argument Parsing");

  expandBuildMdAliases(process.argv);
  stringifyNonPrimitiveDefineValues(process.argv, "process.env.JSMDCUI_KITTY_MODE");
  stringifyNonPrimitiveDefineValues(process.argv, "global.MDCUI_MAIN");
  const argvMdcuiMain = stringDefineFromArgv(
    process.argv,
    "global.MDCUI_MAIN",
  );
  let sourceMdcuiMain = "";
  if (IS_COMPILED) {
    sourceMdcuiMain = "";
  } else {
    sourceMdcuiMain = String(argvMdcuiMain || global.MDCUI_MAIN || "");
  }

  if (sourceMdcuiMain) {
    const mdcuiMain = resolve(sourceMdcuiMain);
    const mdcuiMainBase = basename(mdcuiMain);
    const mdcuiMainDemoName = demoNameFromMarkdownBasename(mdcuiMainBase);
    if (!mdcuiMainDemoName) {
      throw new Error(
        "MDCUI_MAIN basename must end with lowercase .md, start with a "
        + "Unicode letter or number, and contain no whitespace; only Unicode "
        + "letters, numbers, dots, underscores, and hyphens are allowed",
      );
    }
    const runmd = await import("../runmd.mjs");
    const mdcuiMainFile = Bun.file(mdcuiMain);
    if (!(await mdcuiMainFile.exists())) {
      throw new Error(`MDCUI_MAIN file not found: ${mdcuiMain}`);
    }
    let markdown = await mdcuiMainFile.text();
    const demoPath = join(REPO_ROOT, "demos", mdcuiMainBase);
    if (resolve(mdcuiMain) !== resolve(demoPath)) {
      await Bun.write(demoPath, markdown);
    }
    markdown = await runmd.extractJs(markdown, mdcuiMain, {
      bundling: true,
    });
    await runmd.createWui(markdown, mdcuiMain, {
      bundling: true,
    });

    if (
      process.argv.includes("--build-for")
      || process.argv.includes("--build-exe")
    ) {
      if (argvMdcuiMain) {
        const normalizedDefine =
          `global.MDCUI_MAIN=${JSON.stringify(mdcuiMain)}`;
        for (let i = 0; i < process.argv.length; i++) {
          if (
            process.argv[i] === "--define"
            && process.argv[i + 1]?.startsWith("global.MDCUI_MAIN=")
          ) {
            process.argv[i + 1] = normalizedDefine;
          } else if (
            process.argv[i].startsWith("--define=global.MDCUI_MAIN=")
          ) {
            process.argv[i] = `--define=${normalizedDefine}`;
          }
        }
      } else {
        process.argv.push(
          "--define",
          `global.MDCUI_MAIN=${JSON.stringify(mdcuiMain)}`,
        );
      }
      process.argv.push(
        "--define",
        `global.MDCUI_MAIN_BASE=${JSON.stringify(mdcuiMainBase)}`,
      );
    }
  }

  await buildEarlyExit(null,DEFAULT_BUILD_OUTFILE)
  defaultEdit = await Bun.file(join(REPO_ROOT, "src", "MDCUI_DEFAULT_EDIT")).exists();
  
  const runtimeArgs = process.argv.slice(2);
  noRuntimeArgs = runtimeArgs.length === 0;
  if (MDCUI_DEFAULT_EDIT_ENABLED) runtimeArgs.unshift("--edit");
  if (noRuntimeArgs && MDCUI_DEFAULT_DEMO_ENABLED) runtimeArgs.push("--demo");
  if (noRuntimeArgs && MDCUI_DEFAULT_DEMO_WUI_ENABLED) runtimeArgs.push("--wui");
  if (
    noRuntimeArgs
    && (global.MDCUI_MAIN || global.MDCUI_MAIN_BASE)
  ) {
    const mdcuiMainBase = String(
      global.MDCUI_MAIN_BASE || basename(String(global.MDCUI_MAIN)),
    );
    const demoName = demoNameFromMarkdownBasename(mdcuiMainBase);
    if (!demoName) {
      console.error(
        "Invalid MDCUI_MAIN_BASE: expected a lowercase .md basename with "
        + "Unicode letters or numbers and no whitespace",
      );
      process.exitCode = 2;
      return;
    }
    runtimeArgs.push(`--demo-${demoName}`);
  }
  if (MDCUI_OVERWRITE_DEMO_ENABLED) runtimeArgs.push("--overwrite-demo");
  const { flags, files: rawFiles } = parseArgs(runtimeArgs);
  let demoPreparation = null;
  kittyImageMode = flags.kittyMode;
  allowRemoteKittyImages = flags.allowUrl;

  if (flags.help) {
    console.log(usage());
    return;
  }
  if (flags.version) {
    const ttsCmd = detectTtsCmd();
    console.log(pkg.name+":",pkg.description)
    console.log("  Made by: Dr. John (醫者小智)")
    console.log("")
    console.log("Version:", VERSION);
    console.log("Runtime:", `Bun ${Bun.version}`);
    console.log("Platform:", platformId());
    console.log("Http client:",detectHttpBackend());
    console.log("TTS:", ttsCmd ? ttsCmd.cmd[0] : "not found");
    console.log({SUPPORTED_ENCODING_LABELS})
    console.log("Distribution settings:");
    console.log("  MDCUI_DEFAULT_EDIT:", (MDCUI_DEFAULT_EDIT_ENABLED || defaultEdit) ? "enabled" : "disabled");
    console.log("  MDCUI_DEFAULT_DEMO:", MDCUI_DEFAULT_DEMO_ENABLED ? "enabled" : "disabled");
    console.log("  MDCUI_DEFAULT_DEMO_WUI:", MDCUI_DEFAULT_DEMO_WUI_ENABLED ? "enabled" : "disabled");
    console.log("  MDCUI_OVERWRITE_DEMO:", MDCUI_OVERWRITE_DEMO_ENABLED ? "enabled" : "disabled");
    console.log(
      "  global.MDCUI_MAIN:",
      String(global.MDCUI_MAIN || "") || "not set",
    );
    console.log(
      "  global.MDCUI_MAIN_BASE:",
      String(global.MDCUI_MAIN_BASE || "") || "not set",
    );
    const clipboard = new ClipboardManager();
    let osc52Available = false;
    if (process.stdin.isTTY && process.stdout.isTTY) {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      osc52Available = await probeOSC52(process.stdin, process.stdout, 150);
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
    }
    const externalName = clipboard.methodName();
    const backends = osc52Available ? `${externalName}, OSC 52` : externalName;
    console.log("Clipboard:", backends);
    return;
  }
  if (flags.wui) {
    demoPreparation = await prepareDemo(flags, rawFiles);
    if (!demoPreparation.ok) return;
    const runmd = await import("../runmd.mjs");
    await runmd.main(30, {
      mdpath: rawFiles[0] ?? null,
      overwriteDemo: flags.overwriteDemo && rawFiles.length === 0,
      printUi: flags.printUi,
      useBundledMdcuiServer: demoPreparation.useBundledModules,
    });
    return;
  }
  if (flags.check) {
    if (rawFiles.length !== 1) {
      console.error("Usage: jsmdcui --check FILE.md");
      process.exitCode = 2;
      return;
    }
    const checkPath = resolve(rawFiles[0]);
    try {
      const file = Bun.file(checkPath);
      if (!(await file.exists())) throw new Error("file not found");
      const result = checkMarkdownIdCollisions(await file.text());
      process.stdout.write(formatMarkdownIdCheckAnsi(checkPath, result));
      if (result.collisions.length) process.exitCode = 1;
    } catch (error) {
      console.error(`Cannot check ${checkPath}: ${error?.message || error}`);
      process.exitCode = 2;
    }
    return;
  }
  if (flags.outline) {
    if (rawFiles.length !== 1) {
      console.error("Usage: jsmdcui --outline FILE.md");
      process.exitCode = 2;
      return;
    }
    const outlinePath = resolve(rawFiles[0]);
    try {
      const file = Bun.file(outlinePath);
      if (!(await file.exists())) throw new Error("file not found");
      const result = checkMarkdownIdCollisions(await file.text());
      process.stdout.write(formatMarkdownOutline(result));
    } catch (error) {
      console.error(`Cannot outline ${outlinePath}: ${error?.message || error}`);
      process.exitCode = 2;
    }
    return;
  }
  if (flags.docs) {
    await printReadmeDocs();
    return;
  }
  if (flags.exportReadme) {
    await exportReadme();
    return;
  }
  if (flags.exportCdpMaze) {
    await exportCdpMaze();
    return;
  }
  if (flags.changelog) {
    await printChangelogDocs();
    return;
  }
  if (flags.testapp) {
    await printTestappSource();
    return;
  }
  if (flags.demoList) {
    printDemoList();
    return;
  }
  if (flags.demo) {
    demoPreparation = await prepareDemo(flags, rawFiles);
    if (!demoPreparation.ok) return;
  }
  if (flags.options) {
    for (const [key, value] of Object.entries(defaultAllSettings()).sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`-${key} value`);
      console.log(`    Default value: '${value}'`);
    }
    return;
  }
  addCheckpoint("Config Initialization");
  const config = await new Config({ configDir: flags.configDir }).init();
  config.applyCliSettings(flags.settings);
  const encodingExplicit = flags.settings.has("encoding") || Object.hasOwn(config.parsedSettings, "encoding");
  const inputFiletype = flags.settings.has("filetype") ? String(flags.settings.get("filetype")) : null;
  syncEditorSettings(config);

  addCheckpoint("Runtime Registry Init");
  //  Not REPO_ROOT: --assets-extract writes the tree under its own
  //  assets/<name>@<version>/ namespace, and --assets-external then reads
  //  from there. assetDiskPath("") is that root, or REPO_ROOT in a checkout.
  const runtime = new RuntimeRegistry({ repoRoot: assetDiskPath(""), configDir: config.configDir });
  await runtime.init({ user: true });

  addCheckpoint("Colorscheme & Syntax Load");
  const colorscheme = await new Colorscheme(runtime).load(config.getGlobalOption("colorscheme") || "default");
  const syntaxDefinitions = await loadSyntaxDefinitions(runtime);

  if (flags.cat) {
    await catFiles(
      rawFiles,
      colorscheme,
      syntaxDefinitions,
      config.getGlobalOption("encoding"),
      !encodingExplicit,
      inputFiletype,
    );
    return;
  }

  addCheckpoint("Lua Plugin Manager Init");
  // const plugins = new PluginManager({ config, runtime, repoRoot: REPO_ROOT });
  // await plugins.init();

  if (flags.plugin === "list") {
    const luaList = [] //plugins.list();
    const jsItems = [];
    const builtinJsPluginNames = hasInternalAssets()
      ? listInternalAssetDirs(assetPath("runtime", "jsplugins"))
      : [];
    if (builtinJsPluginNames.length > 0) {
      for (const name of builtinJsPluginNames) {
        jsItems.push({ name, builtin: true });
      }
    } else {
      const builtinJsDir = assetDiskPath("runtime/jsplugins");
      if (existsSync(builtinJsDir)) {
        for (const entry of readdirSync(builtinJsDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          if (existsSync(join(builtinJsDir, entry.name, `${entry.name}.js`)))
            jsItems.push({ name: entry.name, builtin: true });
        }
      }
    }
    const userJsDir = join(config.configDir, "jsplug");
    if (existsSync(userJsDir)) {
      for (const entry of readdirSync(userJsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (existsSync(join(userJsDir, entry.name, `${entry.name}.js`)))
          jsItems.push({ name: entry.name, builtin: false });
      }
    }
    const fmtTag = (p) => p.builtin ? " *(built-in)*" : "";
    const luaLines = luaList.length > 0
      ? luaList.map((p) => `- ${p.name}${fmtTag(p)}`).join("\n")
      : "- *(none)*";
    const jsLines = jsItems.length > 0
      ? jsItems.map((p) => `- ${p.name}${fmtTag(p)}`).join("\n")
      : "- *(none)*";
    process.stdout.write(Bun.markdown.ansi(`# Lua plugins\n${luaLines}\n\n# JS plugins\n${jsLines}\n`));
    return;
  }
  if (flags.plugin) {
    await plugins.pluginCommand(flags.plugin, rawFiles);
    return;
  }

  if (flags.clean) {
    await cleanConfig(config, plugins);
    return;
  }

  const { files, command } = parseInput(rawFiles);
  const jsPlugins = new JsPluginManager();
  const context = {
    colorscheme,
    syntaxDefinitions,
    config,
    runtime,
    jsPlugins,
    encodingExplicit,
    inputFiletype,
    allowUrl: flags.allowUrl,
    kittyMode: flags.kittyMode,
  };
  jsPlugins.setContext(context);
  buildMicroGlobal(jsPlugins);   // sets globalThis.micro

  addCheckpoint("Parallel Initialization Start");

  const luaPromise = (async () => {
    let plugins=null
    return 0;
    
    const start = Bun.nanoseconds();
    const pluginErr = await plugins.loadAll();
    if (pluginErr) console.error(`Plugin runtime disabled: ${pluginErr.message}`);
    if (!pluginErr) {
      await plugins.run("preinit");
      await plugins.run("init");
      await plugins.run("postinit");
    }
    const end = Bun.nanoseconds();
    return { pluginErr, duration: end - start };
  })();

  const jsPromise = (async () => {
    const start = Bun.nanoseconds();
    const jsDirs = [
      { dir: assetDiskPath("runtime/jsplugins"), builtin: true },
      { dir: join(config.configDir, "jsplug"),        builtin: false },
    ];
    await jsPlugins.loadFrom(jsDirs);
    const end = Bun.nanoseconds();
    return { duration: end - start };
  })();

  const buffersPromise = (async () => {
    const start = Bun.nanoseconds();
    let cursorStates = {};
    if (DEFAULT_SETTINGS.savecursor) {
      cursorStates = await loadCursorStates(config.configDir);
    }
    // Mix in context properties needed for buffer loading:
    context.cursorStates = cursorStates;
    context._openBuffers = new Map();
    context._termPrompt = process.stdout.isTTY ? termPromptLine : null;
    
    loadBuffers.context = context;
    const buffers = await loadBuffers(files.map((file) =>
      isHttpUrl(file) ? file : resolve(file)
    ), command);
    if (demoPreparation?.useBundledModules) {
      const bundledDemoBuffer = buffers.find((buffer) =>
        buffer.path
        && !isHttpUrl(buffer.path)
        && resolve(buffer.path) === demoPreparation.path
      );
      if (bundledDemoBuffer) {
        bundledDemoBuffer._useBundledMdcuiModules = true;
      }
    }

    let historyPromise = Promise.resolve();
    if (config.getGlobalOption("savehistory") !== false) {
      historyPromise = loadHistory(config.configDir);
    }
    await historyPromise;
    const end = Bun.nanoseconds();
    return { buffers, duration: end - start };
  })();

  const [luaSettled, jsSettled, buffersSettled] = await Promise.allSettled([
    luaPromise,
    jsPromise,
    buffersPromise
  ]);

  const luaResult = luaSettled.status === "fulfilled"
    ? luaSettled.value
    : { pluginErr: luaSettled.reason, duration: 0 };
  if (luaSettled.status === "rejected") {
    console.error(`Lua plugin runtime disabled: ${luaSettled.reason?.message || luaSettled.reason}`);
  }

  const jsResult = jsSettled.status === "fulfilled"
    ? jsSettled.value
    : { duration: 0 };
  if (jsSettled.status === "rejected") {
    console.error(`JS plugin runtime disabled: ${jsSettled.reason?.message || jsSettled.reason}`);
  }

  const buffersResult = buffersSettled.status === "fulfilled"
    ? buffersSettled.value
    : { buffers: [new BufferModel({ command })], duration: 0 };
  if (buffersSettled.status === "rejected") {
    console.error(`Buffer load failed: ${buffersSettled.reason?.message || buffersSettled.reason}`);
  }

  addCheckpoint("Parallel Initialization End");

  parallelTimings = {
    lua: luaResult.duration / 1e6,
    js: jsResult.duration / 1e6,
    buffers: buffersResult.duration / 1e6
  };

  const { pluginErr } = luaResult;
  const { buffers } = buffersResult;

  if (!process.stdout.isTTY && !flags.profile) {
    console.log(buffers[0].lines.join("\n"));
    return;
  }
  
  addCheckpoint("App Instantiation");
  const app = new App(buffers, context);
  jsPlugins.setApp(app);
  app.installProtectedPrompts();
  // if (plugins && !pluginErr && app.buffer) plugins.curPaneAdapter = makePaneAdapter(app.buffer, app);
  // Dispatch all JS plugin lifecycle hooks after setApp so TermMessage,
  // CurPane, cmd/action proxies, and buffer APIs all work correctly.
  addCheckpoint("JS Lifecycle Hooks");
  await jsPlugins.run("preinit");
  await jsPlugins.run("init");
  await jsPlugins.run("postinit");
  
  /*
  if (!pluginErr) {
    for (const buffer of buffers) await plugins.run("onBufferOpen", buffer);
  }
  */
  
  for (const buffer of buffers) await jsPlugins.run("onBufferOpen", buffer);
  if (flags.cdpPort) {
    const cdpArgs = [flags.cdpPort];
    if (flags.cdpAddress) cdpArgs.push(`--address=${flags.cdpAddress}`);
    if (flags.cdpAllowOrigins) {
      cdpArgs.push(`--remote-allow-origins=${flags.cdpAllowOrigins}`);
    }
    await app.handleCommand(`cdp ${cdpArgs.join(" ")}`);
  }

  if (flags.cdpMaze) {
    const solverHost = !flags.cdpAddress || flags.cdpAddress === "0.0.0.0"
      ? "127.0.0.1"
      : flags.cdpAddress;
    const solverUrl = `ws://${solverHost}:${flags.cdpPort}/devtools/browser/cdp-server`;
    setTimeout(async () => {
      try {
        const { runCdpMaze } = await import("../cdp-maze.js");
        app.message = await runCdpMaze(solverUrl);
        app.render?.();
      } catch (error) {
        app.message = `CDP maze solver failed: ${error?.message || error}`;
        app.render?.();
      }
    }, 3000);
  }
  
  if (flags.profile) {
    addCheckpoint("Clipboard Probing");
    const clipSetting = config.getGlobalOption("clipboard") ?? "external";
    const clipboard = new ClipboardManager();
    if (process.stdin.isTTY && process.stdout.isTTY) {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      await clipboard.initFromSetting(clipSetting, process.stdin, process.stdout, 150);
      process.stdin.setRawMode?.(false);
      process.stdin.pause();
    } else {
      await clipboard.initFromSetting(clipSetting, process.stdin, process.stdout, 150);
    }
    
    addCheckpoint("Profile Done");
    printProfileReport();
    process.exit(0);
  }
  
  await app.start();
  await app.notifyMdcuiLoad(app.buffer);
  app.render();
}

const HISTORY_MAX = 100;

async function loadHistory(configDir) {
  const histPath = resolve(configDir, "buffers", "history.json");
  try {
    const text = await Bun.file(histPath).text();
    const data = JSON.parse(text);
    if (data && typeof data === "object") {
      for (const [type, entries] of Object.entries(data)) {
        if (Array.isArray(entries) && entries.length > 0) {
          promptHistory.set(type, entries.filter(e => typeof e === "string"));
        }
      }
    }
  } catch {
    // missing or corrupt file — start fresh
  }
}

async function saveHistory(configDir) {
  const data = {};
  for (const [type, entries] of promptHistory.entries()) {
    const trimmed = entries.slice(-HISTORY_MAX);
    if (trimmed.length > 0) data[type] = trimmed;
  }
  if (Object.keys(data).length === 0) return;
  const histDir = resolve(configDir, "buffers");
  await mkdir(histDir, { recursive: true });
  await Bun.write(resolve(histDir, "history.json"), JSON.stringify(data));
}

async function loadCursorStates(configDir) {
  try {
    const text = await Bun.file(resolve(configDir, "buffers", "cursor_state.json")).text();
    return JSON.parse(text) ?? {};
  } catch {
    return {};
  }
}

async function saveCursorStates(configDir, states) {
  const dir = resolve(configDir, "buffers");
  await mkdir(dir, { recursive: true });
  await Bun.write(resolve(dir, "cursor_state.json"), JSON.stringify(states));
}

const COMMENT_TYPES = {
  apacheconf: "# %s", batch: ":: %s", bat: ":: %s", c: "// %s", "c++": "// %s", cmake: "# %s", conf: "# %s", crystal: "# %s", css: "/* %s */", d: "// %s", dart: "// %s", dockerfile: "# %s", elm: "-- %s", fish: "# %s", gdscript: "# %s", glsl: "// %s", go: "// %s", haskell: "-- %s", html: "<!-- %s -->", ini: "; %s", java: "// %s", javascript: "// %s", jinja2: "{# %s #}", json: "// %s", julia: "# %s", kotlin: "// %s", lua: "-- %s", markdown: "<!-- %s -->", nginx: "# %s", nim: "# %s", objc: "// %s", ocaml: "(* %s *)", pascal: "{ %s }", perl: "# %s", php: "// %s", pony: "// %s", powershell: "# %s", proto: "// %s", python: "# %s", python3: "# %s", ruby: "# %s", rust: "// %s", scala: "// %s", shell: "# %s", sh: "# %s", sql: "-- %s", swift: "// %s", tex: "% %s", toml: "# %s", twig: "{# %s #}", typescript: "// %s", v: "// %s", xml: "<!-- %s -->", yaml: "# %s", zig: "// %s", zscript: "// %s", zsh: "# %s",
};

function resolveCommentType(buf) {
  const explicit = buf.Settings?.["comment.type"];
  if (explicit) return String(explicit);
  const legacy = buf.Settings?.commenttype;
  if (legacy) return String(legacy);
  return COMMENT_TYPES[buf.Settings?.filetype] ?? COMMENT_TYPES[buf.filetype] ?? "# %s";
}

function commentLineRange(buf, selection) {
  if (!selection) return { start: buf.cursor.y, end: buf.cursor.y };
  const { first, last } = selectionBounds(selection);
  let end = last.y;
  if (last.x === 0 && end > first.y) end--;
  return { start: clamp(first.y, 0, buf.lines.length - 1), end: clamp(end, 0, buf.lines.length - 1) };
}

function rangeLineNumbers(range) {
  const lines = [];
  for (let lineNo = range.start; lineNo <= range.end; lineNo++) lines.push(lineNo);
  return lines;
}

function leadingWhitespace(text) {
  return String(text).match(/^\s*/)?.[0] ?? "";
}

function minCommentIndent(buf, range) {
  let min = Infinity;
  for (const lineNo of rangeLineNumbers(range)) min = Math.min(min, leadingWhitespace(buf.lines[lineNo] ?? "").length);
  return Number.isFinite(min) ? min : 0;
}

function commentParts(commentType) {
  const idx = commentType.indexOf("%s");
  if (idx < 0) return { before: commentType, after: "" };
  return { before: commentType.slice(0, idx), after: commentType.slice(idx + 2) };
}

function commentText(line, commentType, indentLen) {
  const { before, after } = commentParts(commentType);
  const indent = line.slice(0, Math.min(indentLen, line.length));
  const rest = line.slice(indent.length);
  return indent + before + rest + after;
}

function isLineCommented(line, commentType) {
  const { before, after } = commentParts(commentType);
  const trimmed = line.slice(leadingWhitespace(line).length);
  // Accept "// foo" and bare "//" (no trailing space); for wrap types also accept "/*foo*/"
  return trimmed.startsWith(before.trimEnd()) &&
    (!after || trimmed.endsWith(after.trimStart()));
}

function uncommentText(line, commentType) {
  const { before, after } = commentParts(commentType);
  const indent = leadingWhitespace(line);
  let rest = line.slice(indent.length);
  // Remove leading marker (with or without trailing space)
  if (before && rest.startsWith(before)) {
    rest = rest.slice(before.length);
  } else if (before && rest.startsWith(before.trimEnd())) {
    rest = rest.slice(before.trimEnd().length);
    if (rest.startsWith(" ")) rest = rest.slice(1);
  }
  // Remove trailing marker (with or without leading space)
  if (after && rest.endsWith(after)) {
    rest = rest.slice(0, -after.length);
  } else if (after && rest.endsWith(after.trimStart())) {
    rest = rest.slice(0, -after.trimStart().length);
    if (rest.endsWith(" ")) rest = rest.slice(0, -1);
  }
  return indent + rest;
}
function clipboardCopyMsg(clipboard, text, kind, verb = "Copied") {
  const method = clipboard.methodName();
  const alt = clipboard.altMethodName();
  const chars = Array.from(String(text).replace(/\n$/, "")).length;
  const label = typeof kind === "string" && (kind === "line" || kind.endsWith("lines"))
    ? kind : `${chars} chars`;
  if (alt) return `[Click:Copy>${alt}] ${method}: ${label} ${verb.toLowerCase()}`;
  return `${verb} ${label} to ${method} clipboard`;
}

function clipboardAltAction(clipboard, text) {
  const alt = clipboard.altMethodName();
  if (!alt) return null;
  return () => {
    if (!clipboard.writeAlt(text)) return `${alt}: failed`;
    const chars = Array.from(String(text).replace(/\n$/, "")).length;
    return `${alt}: ${chars} chars copied`;
  };
}

function pasteStatusMessage(method, text) {
  const value = String(text);
  const lines = value.split("\n").length;
  const chars = Array.from(value).length;
  const unit = lines > 1 ? String(lines) + " lines" : String(chars) + " chars";
  return "Pasted " + unit + " from " + method + " clipboard";
}

function selectionBounds(selection) {
  const a = selection.start;
  const b = selection.end;
  const first = a.y < b.y || (a.y === b.y && a.x <= b.x) ? a : b;
  const last = first === a ? b : a;
  return { first, last };
}

function sameLoc(a, b) {
  return a?.x === b?.x && a?.y === b?.y;
}

function extendSelection(pane, buf, moveFn) {
  const anchor = pane.selection?.start ?? { ...buf.cursor };
  moveFn();
  const end = { ...buf.cursor };
  pane.selection = sameLoc(anchor, end) ? null : { start: anchor, end };
}

function _indentString(buf) {
  const tabsize = buf?.Settings?.tabsize ?? DEFAULT_SETTINGS.tabsize ?? 4;
  const useSpaces = buf?.Settings?.tabstospaces ?? DEFAULT_SETTINGS.tabstospaces ?? false;
  return useSpaces ? " ".repeat(tabsize) : "\t";
}

function indentSelection(buf, pane, _ctx) {
  if (isEditLockedBuffer(buf)) return;
  const sel = pane?.selection;
  if (!sel) return;
  buf.pushUndo();
  const { first, last } = selectionBounds(sel);
  const indent = _indentString(buf);
  for (let y = first.y; y <= last.y; y++) {
    if ((buf.lines[y] ?? "").length > 0) {
      buf.lines[y] = indent + (buf.lines[y] ?? "");
    }
  }
  buf.invalidateHighlightFrom(first.y, { force: first.y !== last.y });
  // Adjust selection x-coordinates: column 0 stays at 0, others shift right by indent length
  const newStart = { ...sel.start, x: sel.start.x > 0 ? sel.start.x + indent.length : sel.start.x };
  const newEnd = { ...sel.end, x: sel.end.x > 0 ? sel.end.x + indent.length : sel.end.x };
  pane.selection = { start: newStart, end: newEnd };
  buf.cursor = { ...buf.cursor, x: buf.cursor.x + indent.length };
  buf.ensureCursor();
  buf.modified = true;
}

function outdentSelection(buf, pane, _ctx) {
  if (isEditLockedBuffer(buf)) return;
  const sel = pane?.selection;
  if (!sel) return;
  buf.pushUndo();
  const { first, last } = selectionBounds(sel);
  const indent = _indentString(buf);
  for (let y = first.y; y <= last.y; y++) {
    const line = buf.lines[y] ?? "";
    if (line.startsWith(indent)) {
      buf.lines[y] = line.slice(indent.length);
    } else if (line.startsWith("\t")) {
      buf.lines[y] = line.slice(1);
    } else {
      // Remove up to indent.length leading spaces
      let n = 0;
      while (n < indent.length && n < line.length && line[n] === ' ') n++;
      buf.lines[y] = line.slice(n);
    }
  }
  buf.invalidateHighlightFrom(first.y, { force: first.y !== last.y });
  pane.selection = {
    start: { ...sel.start, x: Math.max(0, sel.start.x - indent.length) },
    end: { ...sel.end, x: Math.max(0, sel.end.x - indent.length) },
  };
  buf.cursor = { ...buf.cursor, x: Math.max(0, buf.cursor.x - indent.length) };
  buf.ensureCursor();
  buf.modified = true;
}

function outdentLine(buf, _ctx) {
  if (isEditLockedBuffer(buf)) return;
  const indent = _indentString(buf);
  const line = buf.lines[buf.cursor.y] ?? "";
  buf.pushUndo();
  if (line.startsWith(indent)) {
    buf.lines[buf.cursor.y] = line.slice(indent.length);
    buf.cursor.x = Math.max(0, buf.cursor.x - indent.length);
  } else if (line.startsWith("\t")) {
    buf.lines[buf.cursor.y] = line.slice(1);
    buf.cursor.x = Math.max(0, buf.cursor.x - 1);
  } else {
    let n = 0;
    while (n < indent.length && n < line.length && line[n] === ' ') n++;
    if (n > 0) {
      buf.lines[buf.cursor.y] = line.slice(n);
      buf.cursor.x = Math.max(0, buf.cursor.x - n);
    }
  }
  buf.invalidateHighlightFrom(buf.cursor.y);
  buf.modified = true;
}

function deleteSelection(buf, pane) {
  const selection = pane?.selection;
  if (!selection || !buf) return "";
  const text = getSelectionText(buf, selection);
  const { first, last } = selectionBounds(selection);
  if (isMdcuiEncoding(buf?.encoding)) {
    const prefixLength = mdcuiEditablePrefixLength(buf, first.y);
    if (first.y !== last.y || prefixLength === 0 || first.x < prefixLength) return "";
  } else if (isEditLockedBuffer(buf)) {
    return "";
  }
  if (first.y === last.y) {
    const line = buf.lines[first.y] ?? "";
    buf.lines[first.y] = line.slice(0, first.x) + line.slice(last.x);
  } else {
    const firstLine = buf.lines[first.y] ?? "";
    const lastLine = buf.lines[last.y] ?? "";
    buf.lines.splice(first.y, last.y - first.y + 1, firstLine.slice(0, first.x) + lastLine.slice(last.x));
  }
  buf.invalidateHighlightFrom(first.y, { force: first.y !== last.y });
  buf.cursor = { x: first.x, y: first.y };
  pane.selection = null;
  buf.modified = true;
  buf.ensureCursor();
  return text;
}

function getSelectionText(buf, selection) {
  if (!selection || !buf) return "";
  const { first, last } = selectionBounds(selection);
  if (first.y === last.y) return buf.lines[first.y]?.slice(first.x, last.x) ?? "";
  const parts = [buf.lines[first.y]?.slice(first.x) ?? ""];
  for (let i = first.y + 1; i < last.y; i++) parts.push(buf.lines[i] ?? "");
  parts.push(buf.lines[last.y]?.slice(0, last.x) ?? "");
  return parts.join("\n");
}

function attachSyntax(buffer, context, path, text) {
  buffer._syntaxContext = context;
  const explicitFiletype = context.inputFiletype;
  const def = explicitFiletype == null
    ? detectBufferSyntax(context.syntaxDefinitions, path, text)
    : context.syntaxDefinitions?.find((candidate) => candidate.filetype === explicitFiletype) ?? null;
  buffer.syntaxDefinition = def;
  buffer.filetype = explicitFiletype == null ? (def?.filetype ?? "unknown") : String(explicitFiletype);
  buffer.Settings.filetype = buffer.filetype;
  buffer.highlighter = def ? new Highlighter(def, context.syntaxDefinitions ?? []) : null;
  buffer._highlightCache = null;
  buffer._onOptionChange = (option, oldVal, newVal) => {
    if (option === "filetype") setBufferFiletype(buffer, context, newVal);
    const ba = makeBufferAdapter(buffer);
    context.plugins?.run("onBufferOptionChanged", ba, option, oldVal, newVal);
    context.jsPlugins?.run("onBufferOptionChanged", ba, option, oldVal, newVal);
  };
}

function setBufferFiletype(buffer, context, filetype) {
  const value = String(filetype);
  const definitions = context?.syntaxDefinitions ?? [];
  const def = definitions.find((candidate) => candidate.filetype === value) ?? null;
  buffer.filetype = value;
  buffer.Settings.filetype = value;
  buffer.syntaxDefinition = def;
  buffer.highlighter = def ? new Highlighter(def, definitions) : null;
  buffer._highlightCache = null;
}

function detectBufferSyntax(definitions, path, text) {
  if (!definitions) return null;
  const lines = normalizeBufferText(text).split("\n").slice(0, 50);
  return detectSyntax(definitions, { path, firstLine: lines[0] ?? "", lines });
}

function detectBufferFiletype(definitions, path, text) {
  if (!definitions) return "unknown";
  return detectBufferSyntax(definitions, path, text)?.filetype ?? "unknown";
}

function segmentSelection(selection, lineNo, start, end) {
  if (!selection) return null;
  const a = selection.start;
  const b = selection.end;
  const first = a.y < b.y || (a.y === b.y && a.x <= b.x) ? a : b;
  const last = first === a ? b : a;
  if (lineNo < first.y || lineNo > last.y) return null;
  const selStart = lineNo === first.y ? first.x : 0;
  const selEnd = lineNo === last.y ? last.x : end;
  const from = Math.max(start, Math.min(selStart, selEnd));
  const to = Math.min(end, Math.max(selStart, selEnd));
  if (to <= from) return null;
  return { from: from - start, to: to - start };
}


function parseLineCol(value) {
  const input = String(value).trim();
  if (!input) throw new Error("Not enough arguments");
  const match = input.match(/^(-?\d+)(?:\.(\d+))?(?::(-?\d+))?$/);
  if (!match) throw new Error("Invalid line number");
  const line = Number(match[1]);
  const subRow = match[2] == null ? 0 : Number(match[2]);
  const col = match[3] == null ? 1 : Number(match[3]);
  if (!Number.isInteger(line)) throw new Error("Invalid line number");
  if (!Number.isInteger(subRow)) throw new Error("Invalid visual line number");
  if (subRow < 0) throw new Error("Invalid visual line number");
  if (!Number.isInteger(col)) throw new Error("Invalid column number");
  return { line, subRow, col };
}

function parseOptionValue(value) {
  if (value === "on" || value === "true") return true;
  if (value === "off" || value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(String(value))) return Number(value);
  return value;
}

function syncEditorSettings(config) {
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key in config.globalSettings) DEFAULT_SETTINGS[key] = config.globalSettings[key];
  }
}

async function catFiles(files, colorscheme, syntaxDefinitions, encoding = DEFAULT_SETTINGS.encoding, inferMdcui = true, filetype = null) {
  const targets = files.length > 0 ? files.map((f) => ({ path: f, stdin: false })) : [{ path: null, stdin: true }];
  for (const { path: filePath, stdin } of targets) {
    let content;
    let ansiContent = null;
    let effectivePath = filePath;
    let effectiveEncoding = normalizeEncodingLabel(encoding);
    if (stdin) {
      const chunks = [];
      for await (const chunk of process.stdin) chunks.push(chunk);
      const decoded = await decodeAndRenderTextBytes(Buffer.concat(chunks), encoding);
      content = decoded.text;
      ansiContent = decoded.ansiText ?? null;
      effectiveEncoding = decoded.encoding;
    } else if (isHttpUrl(filePath)) {
      const decoded = await fetchTextWithEncoding(filePath, encoding, inferMdcui);
      content = decoded.text;
      ansiContent = decoded.ansiText ?? null;
      effectiveEncoding = decoded.encoding;
      // Use the URL pathname for syntax/md detection (strip query/hash)
      try { effectivePath = new URL(filePath).pathname; } catch { effectivePath = filePath; }
    } else {
      const decoded = await readTextFileWithEncoding(filePath, encoding, inferMdcui);
      content = decoded.text;
      ansiContent = decoded.ansiText ?? null;
      effectiveEncoding = decoded.encoding;
    }
    if (isMdcuiEncoding(effectiveEncoding)) {
      process.stdout.write(ansiContent ?? content);
      if (!(ansiContent ?? content).endsWith("\n")) process.stdout.write("\n");
      continue;
    } else if (filetype == null && effectivePath && /\.md$/i.test(effectivePath)) {
      process.stdout.write(
        Bun.markdown.ansi(content,{
          hyperlinks:true
        })
      );
      continue;
    }
    const lines = normalizeBufferText(content).split("\n");
    const def = filetype == null
      ? detectSyntax(syntaxDefinitions, {
          path: effectivePath ?? "",
          firstLine: lines[0] ?? "",
          lines: lines.slice(0, 50),
        })
      : syntaxDefinitions.find((candidate) => candidate.filetype === filetype) ?? null;
    const highlighter = def ? new Highlighter(def, syntaxDefinitions) : null;
    if (!highlighter) {
      process.stdout.write(content);
      if (!content.endsWith("\n")) process.stdout.write("\n");
      continue;
    }
    const defaultStyle = colorscheme?.defaultStyle ?? {};
    let state = null;
    for (const line of lines) {
      const result = highlighter.highlightLine(line, state);
      state = result.state;
      const changes = [...result.changes.entries()];
      let out = "";
      for (let ci = 0; ci < changes.length - 1; ci++) {
        const [from, group] = changes[ci];
        const to = changes[ci + 1][0];
        if (from >= line.length) break;
        const segment = line.slice(from, to);
        if (!segment) continue;
        const style = colorscheme?.get(group) ?? defaultStyle;
        out += styleToAnsi(style) + segment;
      }
      out += "\x1b[0m\n";
      process.stdout.write(out);
    }
  }
}


main().catch((error) => {
  try {
    (_activeTtyStream ?? process.stdin).setRawMode?.(false);
    write(DISABLE_MOUSE + "\x1b[?25h\x1b[?1049l\x1b[0m");
  } finally {
    console.error(error?.stack || error);
    process.exit(1);
  }
});
