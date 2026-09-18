import { existsSync, lstatSync, readdirSync, readlinkSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif", "heic"]);
const MUSIC = new Set(["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus", "mid", "midi"]);
const VIDEO = new Set(["mp4", "mkv", "webm", "mov", "avi", "m4v", "mpeg", "mpg"]);
const ICONS = new Map([
  ["js", "🟨"], ["mjs", "🟨"], ["cjs", "🟨"],
  ["ts", "🟦"], ["mts", "🟦"], ["cts", "🟦"],
  ["py", "🐍"], ["c", "🔧"], ["h", "🧩"], ["rs", "🦀"],
  ["html", "🌐"], ["htm", "🌐"], ["css", "🎨"],
]);

function extension(name) {
  const index = name.lastIndexOf(".");
  return index > 0 ? name.slice(index + 1).toLowerCase() : "";
}

export function iconFor(name, stats, path = null) {
  if (stats.isDirectory()) return "📦";
  if (stats.isSymbolicLink()) return path !== null && !existsSync(path) ? "🚫" : "🔗";
  const ext = extension(name);
  if (IMAGE.has(ext)) return "🖼️";
  if (MUSIC.has(ext)) return "🎵";
  if (VIDEO.has(ext)) return "🎬";
  if (ICONS.has(ext)) return ICONS.get(ext);
  if (stats.mode & 0o111) return "⚙️";
  return "📄";
}

// Only touches cross-platform-safe fs.Stats methods (isDirectory/
// isSymbolicLink/isSocket/isFIFO always return a real boolean on Windows
// too, just typically false for socket/FIFO since NTFS directory entries
// aren't reported as those) and the same mode-bit check iconFor already
// uses elsewhere in this file, so this needs no platform-specific handling.
function classifySuffix(stats) {
  if (stats.isDirectory()) return "/";
  if (stats.isSymbolicLink()) return "@";
  if (stats.isSocket()) return "=";
  if (stats.isFIFO()) return "|";
  if (stats.mode & 0o111) return "*";
  return "";
}

function displayEntry(entry, options) {
  const suffix = options.classify ? classifySuffix(entry.stats) : entry.stats.isDirectory() ? "/" : "";
  return `${iconFor(entry.name, entry.stats, entry.path)} ${entry.name}${suffix}`;
}

function columns(items, width) {
  if (!items.length) return "";
  const widest = Math.max(...items.map((item) => Bun.stringWidth(item))) + 2;
  const count = Math.max(1, Math.floor(width / widest));
  let output = "";
  for (let index = 0; index < items.length; index++) {
    const last = index % count === count - 1 || index === items.length - 1;
    output += items[index];
    output += last ? "\n" : " ".repeat(widest - Bun.stringWidth(items[index]));
  }
  return output;
}

function modeString(mode) {
  const kinds = [[0o400, "r"], [0o200, "w"], [0o100, "x"], [0o040, "r"], [0o020, "w"], [0o010, "x"], [0o004, "r"], [0o002, "w"], [0o001, "x"]];
  return kinds.map(([bit, letter]) => mode & bit ? letter : "-").join("");
}

function linkTarget(path) {
  try {
    // Node/Bun read the reparse point's stored target on Windows the same
    // way as a POSIX symlink; only the separator needs normalizing to match
    // the forward-slash paths the rest of the shell displays.
    const target = readlinkSync(path);
    return process.platform === "win32" ? target.replaceAll("\\", "/") : target;
  } catch {
    return null;
  }
}

function localDateTime(ms) {
  const date = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function humanSize(bytes) {
  if (bytes < 1024) return String(bytes);
  const units = ["K", "M", "G", "T", "P"];
  let value = bytes;
  let unit = -1;
  do { value /= 1024; unit++; } while (value >= 1024 && unit < units.length - 1);
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "")}${units[unit]}`;
}

function listDirectory(path, options) {
  let entries = readdirSync(path, { withFileTypes: true })
    .filter((entry) => options.all || options.almostAll || !entry.name.startsWith("."))
    .map((entry) => {
      const entryPath = resolve(path, entry.name);
      return { name: entry.name, stats: lstatSync(entryPath), path: entryPath };
    });
  if (options.all) entries = [
    { name: ".", stats: lstatSync(path), path },
    { name: "..", stats: lstatSync(resolve(path, "..")), path: resolve(path, "..") },
    ...entries,
  ];
  entries.sort(options.size
    ? (a, b) => b.stats.size - a.stats.size || a.name.localeCompare(b.name)
    : options.time
    ? (a, b) => b.stats.mtimeMs - a.stats.mtimeMs || a.name.localeCompare(b.name)
    : (a, b) => a.name.localeCompare(b.name));
  if (options.reverse) entries.reverse();
  return entries;
}

export function fancyLs(argv, state, terminal = Boolean(process.stdout.isTTY)) {
  const options = {
    all: false, almostAll: false, directory: false, long: false, human: false,
    recursive: false, time: false, reverse: false, size: false, one: false, classify: false,
  };
  const operands = [];
  for (const argument of argv.slice(1)) {
    if (argument === "--color=auto" || argument === "--color" || argument === "--") continue;
    if (/^-[^-]/.test(argument)) {
      for (const flag of argument.slice(1)) {
        if (flag === "a") options.all = true;
        else if (flag === "A") options.almostAll = true;
        else if (flag === "d") options.directory = true;
        else if (flag === "l") options.long = true;
        else if (flag === "h") options.human = true;
        else if (flag === "R") options.recursive = true;
        else if (flag === "t") options.time = true;
        else if (flag === "r") options.reverse = true;
        else if (flag === "S") options.size = true;
        else if (flag === "1") options.one = true;
        else if (flag === "F") options.classify = true;
        else return { status: 2, stdout: "", stderr: `bunmsh: ${argv[0]}: unsupported option: -${flag}\n` };
      }
    } else operands.push(argument);
  }
  if (!operands.length) operands.push(".");
  let status = 0, stdout = "", stderr = "";
  const visited = new Set();
  const show = (operand, heading = operands.length > 1) => {
    const path = isAbsolute(operand) ? operand : resolve(state.cwd, operand);
    try {
      const stats = lstatSync(path);
      let entries;
      if (!stats.isDirectory() || options.directory)
        entries = [{ name: basename(operand) || operand, stats, path }];
      else entries = listDirectory(path, options);
      if (heading) stdout += `${operand}:\n`;
      const rendered = entries.map((entry) => displayEntry(entry, options));
      if (options.long) {
        for (let i = 0; i < entries.length; i++) {
          const item = entries[i];
          const date = localDateTime(item.stats.mtimeMs);
          const size = options.human ? humanSize(item.stats.size) : String(item.stats.size);
          const target = item.stats.isSymbolicLink() ? linkTarget(item.path) : null;
          const suffix = target === null ? "" : ` -> ${target}`;
          stdout += `${item.stats.isDirectory() ? "d" : item.stats.isSymbolicLink() ? "l" : "-"}${modeString(item.stats.mode)} ${size.padStart(8)} ${date} ${rendered[i]}${suffix}\n`;
        }
      } else stdout += terminal && !options.one
        ? columns(rendered, process.stdout.columns ?? 80)
        : `${rendered.join("\n")}${rendered.length ? "\n" : ""}`;
      if (options.recursive && stats.isDirectory() && !options.directory) {
        for (const entry of entries) if (entry.stats.isDirectory() && entry.name !== "." && entry.name !== "..") {
          const child = resolve(path, entry.name);
          if (visited.has(child)) continue;
          visited.add(child);
          stdout += "\n";
          show(`${operand.replace(/\/$/, "")}/${entry.name}`, true);
        }
      }
    } catch (error) {
      status = 1;
      stderr += `bunmsh: ${argv[0]}: ${operand}: ${error.message}\n`;
    }
  };
  for (let i = 0; i < operands.length; i++) {
    if (i) stdout += "\n";
    show(operands[i]);
  }
  return { status, stdout, stderr };
}
