// The fallback du, after GNU du (coreutils 9.7) for the options it takes. Results stream:
// `write`, when given, takes each line as its folder is finished, so the first sizes of a long
// walk show at once (and a caller can read sizes as they come); without it everything is gathered
// and returned, as a captured `$(du ...)` needs.
//
// Short options combine the GNU way (-shc, -sbhc, -d1, -BM), long ones may be abbreviated, and
// options may follow operands. Like GNU: a folder's line comes after everything inside it; a
// file with several hard links counts once, and with several operands (as `du -shc *` gives) or
// -L every item counts once, so an operand already counted prints nothing; a folder that cannot
// be read is reported, still printed with what could be counted, and makes the status 1.
//
// Disk usage is st_blocks * 512. Windows reports no blocks, so there it is the apparent size.
import { lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { globRegex } from "./grep.js";

const STRERROR = {
  ENOENT: "No such file or directory", EACCES: "Permission denied", EPERM: "Operation not permitted",
  ELOOP: "Too many levels of symbolic links", ENOTDIR: "Not a directory", EIO: "Input/output error",
  ENAMETOOLONG: "File name too long",
};
const reason = (error) => STRERROR[error?.code] ?? String(error?.message ?? error);
const quote = (name) => `'${name.replaceAll("'", "'\\''")}'`;

const LONG = {
  "all": "a", "apparent-size": "apparent", "block-size": "B=", "bytes": "b", "total": "c",
  "dereference-args": "D", "max-depth": "d=", "human-readable": "h", "inodes": "inodes", "si": "si",
  "count-links": "l", "dereference": "L", "no-dereference": "P", "null": "0", "separate-dirs": "S",
  "summarize": "s", "threshold": "t=", "one-file-system": "x", "exclude": "exclude=", "exclude-from": "X=",
};
const SHORT = "abcDhHklLmPSsx0";
const SHORT_VALUE = "BdtX";

class Usage extends Error {}
// A bad value names itself and stops; it gets no "Try 'du --help'" line, as in GNU.
class Invalid extends Error {}

// "K", "1M", "MiB", "KB", "4k"... into { size, suffix }: a size given without a number prints its
// unit after each count, as GNU does for -BM.
const UNITS = "KMGTPEZY";
function blockSize(text, option) {
  const match = /^(\d*)([KkMGTPEZY]?)(iB|B)?$/.exec(text);
  if (!match || (!match[1] && !match[2])) throw new Invalid(`invalid ${option} argument '${text}'`);
  const base = match[3] === "B" ? 1000 : 1024;
  const power = match[2] ? UNITS.indexOf(match[2].toUpperCase()) + 1 : 0;
  const size = (match[1] ? Number(match[1]) : 1) * base ** power;
  if (!size) throw new Invalid(`invalid ${option} argument '${text}'`);
  // A decimal kilo is a lowercase k: -BKB prints 4kB.
  const unit = match[3] === "B" && match[2].toUpperCase() === "K" ? "k" : match[2];
  return { size, suffix: match[1] ? "" : unit + (match[3] ?? "") };
}

function parse(argv, cwd) {
  const o = { all: false, apparent: false, block: { size: 1024, suffix: "" }, human: 0, total: false,
    depth: Infinity, summarize: false, links: false, deref: "P", nul: false, separate: false,
    one: false, inodes: false, threshold: 0, exclude: [], operands: [] };
  const apply = (flag, value) => {
    switch (flag) {
      case "a": o.all = true; break;
      case "apparent": o.apparent = true; break;
      case "b": o.apparent = true; o.block = { size: 1, suffix: "" }; o.human = 0; break;
      case "c": o.total = true; break;
      case "D": case "H": o.deref = "H"; break;
      case "L": o.deref = "L"; break;
      case "P": o.deref = "P"; break;
      case "h": o.human = 1024; break;
      case "si": o.human = 1000; break;
      case "k": o.block = { size: 1024, suffix: "" }; o.human = 0; break;
      case "m": o.block = { size: 1024 * 1024, suffix: "" }; o.human = 0; break;
      case "l": o.links = true; break;
      case "0": o.nul = true; break;
      case "S": o.separate = true; break;
      case "s": o.summarize = true; break;
      case "x": o.one = true; break;
      case "inodes": o.inodes = true; break;
      case "B":
        if (value === "human-readable") o.human = 1024;
        else if (value === "si") o.human = 1000;
        else { o.block = blockSize(value, "--block-size"); o.human = 0; }
        break;
      case "d":
        if (!/^\d+$/.test(value)) throw new Usage(`invalid maximum depth '${value}'`);
        o.depth = Number(value);
        break;
      case "t": {
        const match = /^(-?)(\d+)(.*)$/.exec(value);
        if (!match) throw new Invalid(`invalid --threshold argument '${value}'`);
        const size = Number(match[2]) * (match[3] ? blockSize(`1${match[3]}`, "--threshold").size : 1);
        if (match[1] && !size) throw new Invalid(`invalid --threshold argument '${value}'`);
        o.threshold = match[1] ? -size : size;
        break;
      }
      case "exclude": o.exclude.push(globRegex(value)); break;
      case "X":
        for (const line of readFileSync(resolve(cwd, value), "utf8").split("\n")) if (line) o.exclude.push(globRegex(line));
        break;
    }
  };
  let i = 1;
  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") { o.operands.push(...argv.slice(i + 1)); break; }
    if (!arg.startsWith("-") || arg === "-") { o.operands.push(arg); continue; }
    if (arg.startsWith("--")) {
      const [name, value] = arg.slice(2).split(/=(.*)/s, 2);
      const names = Object.keys(LONG).filter((full) => full.startsWith(name));
      const full = LONG[name] !== undefined ? name : names.length === 1 ? names[0] : null;
      if (!full) throw new Usage(names.length ? `option '${arg}' is ambiguous` : `unrecognized option '${arg}'`);
      const flag = LONG[full];
      if (flag.endsWith("=")) {
        let given = value;
        if (given === undefined) {
          if (i + 1 >= argv.length) throw new Usage(`option '--${full}' requires an argument`);
          given = argv[++i];
        }
        apply(flag.slice(0, -1), given);
      } else {
        if (value !== undefined) throw new Usage(`option '--${full}' doesn't allow an argument`);
        apply(flag);
      }
      continue;
    }
    for (let j = 1; j < arg.length; j++) {
      const ch = arg[j];
      if (SHORT_VALUE.includes(ch)) {
        const value = j + 1 < arg.length ? arg.slice(j + 1) : argv[++i];
        if (value === undefined) throw new Usage(`option requires an argument -- '${ch}'`);
        apply(ch, value);
        break;
      }
      if (!SHORT.includes(ch)) throw new Usage(`invalid option -- '${ch}'`);
      apply(ch);
    }
  }
  if (o.summarize && o.all) throw new Usage("cannot both summarize and show all entries");
  if (o.summarize && o.depth !== Infinity && o.depth !== 0) throw new Usage(`warning: summarizing conflicts with --max-depth=${o.depth}`);
  if (o.summarize) o.depth = 0;
  if (!o.operands.length) o.operands.push(".");
  return o;
}

// GNU's human_ceiling: the largest unit the size reaches, one decimal below 10, always rounded up.
function human(bytes, base) {
  if (bytes < base) return String(bytes);
  const suffixes = base === 1000 ? "kMGTPEZY" : "KMGTPEZY";
  let exponent = 0, unit = 1;
  while (exponent < suffixes.length && bytes >= unit * base) { unit *= base; exponent++; }
  let tenths = Math.ceil((bytes * 10) / unit);
  if (tenths < 100) return `${Math.floor(tenths / 10)}.${tenths % 10}${suffixes[exponent - 1]}`;
  let whole = Math.ceil(bytes / unit);
  if (whole >= base && exponent < suffixes.length) return `1.0${suffixes[exponent]}`;
  return `${whole}${suffixes[exponent - 1]}`;
}

export async function runDu(argv, { cwd = process.cwd(), platform = process.platform, write = null, writeError = null } = {}) {
  let o;
  try { o = parse(argv, cwd); }
  catch (error) {
    if (error instanceof Invalid) return { status: 1, stdout: "", stderr: `bunmsh: du: ${error.message}\n` };
    if (!(error instanceof Usage)) return { status: 1, stdout: "", stderr: `bunmsh: du: ${reason(error)}\n` };
    return { status: 1, stdout: "", stderr: `bunmsh: du: ${error.message}\nTry 'du --help' for more information.\n` };
  }
  let stdout = "", stderr = "", pending = "", status = 0;
  const flush = async () => {
    if (!pending) return;
    const text = pending;
    pending = "";
    if (write) await write(text); else stdout += text;
  };
  const native = (value) => platform === "win32" ? value.replaceAll("/", "\\") : value;
  const end = o.nul ? "\0" : "\n";
  const format = (amount) => {
    if (o.inodes) return String(amount);
    if (o.human) return human(amount, o.human);
    return `${Math.ceil(amount / o.block.size)}${o.block.suffix}`;
  };
  const shown = (amount) => !o.threshold || (o.threshold > 0 ? amount >= o.threshold : amount <= -o.threshold);
  // The first line is written at once; after it, lines gathered for up to 50 ms go out together,
  // and the walk looks at the clock on every entry, so none waits behind a long quiet stretch.
  let lastFlush = -Infinity;
  const due = async () => {
    if (!pending || (pending.length < 65536 && performance.now() - lastFlush < 50)) return;
    lastFlush = performance.now();
    await flush();
  };
  // The grand total ignores --threshold, as GNU prints it whatever its size.
  const line = async (amount, path, always = false) => {
    if (!always && !shown(amount)) return;
    pending += `${format(amount)}\t${native(path)}${end}`;
    await due();
  };
  // A message streams in order with the lines before it, when the caller streams.
  const fail = async (message) => {
    status = 1;
    const text = `bunmsh: du: ${message}\n`;
    if (!writeError) { stderr += text; return; }
    await flush();
    await writeError(text);
  };
  // GNU du 9 counts a folder itself as 0 bytes of apparent size; its contents still count.
  const amountOf = (st) => o.inodes ? 1 : o.apparent ? (st.isDirectory() ? 0 : st.size) : platform === "win32" || st.blocks === undefined ? st.size : st.blocks * 512;
  const seen = new Set();
  const ancestors = new Set();
  const hashAll = o.operands.length > 1 || o.deref === "L";
  // Excluded by the whole path or by any part of it after a "/", as GNU's exclude matching does.
  const excluded = (path) => {
    if (!o.exclude.length) return false;
    const test = (value) => o.exclude.some((glob) => glob.test(value));
    if (test(path)) return true;
    for (let at = path.indexOf("/"); at >= 0; at = path.indexOf("/", at + 1)) if (test(path.slice(at + 1))) return true;
    return false;
  };

  // The size of `path` and everything under it, its lines written on the way out: [amount, folder].
  async function walk(path, full, depth, operandDev) {
    if (excluded(path)) return [0, false];
    let st;
    try { st = (depth === 0 ? o.deref !== "P" : o.deref === "L") ? statSync(full) : lstatSync(full); }
    catch (error) { await fail(`cannot access ${quote(path)}: ${reason(error)}`); return [0, false]; }
    if (o.one && depth > 0 && st.dev !== operandDev) return [0, false];
    if (!o.links && (hashAll || (!st.isDirectory() && st.nlink > 1))) {
      const key = `${st.dev}:${st.ino}`;
      if (seen.has(key)) return [0, false];
      seen.add(key);
    }
    const own = amountOf(st);
    if (!st.isDirectory()) {
      if (depth === 0 || (o.all && depth <= o.depth)) await line(own, path);
      return [own, false];
    }
    const directoryKey = `${st.dev}:${st.ino}`;
    if (ancestors.has(directoryKey)) {
      await fail(`cannot access ${quote(path)}: directory cycle`);
      return [0, true];
    }
    ancestors.add(directoryKey);
    try {
      let below = 0, files = 0, entries = null;
      try { entries = readdirSync(full); }
      catch (error) { await fail(`cannot read directory ${quote(path)}: ${reason(error)}`); }
      for (const name of entries ?? []) {
        if (pending) await due();
        const child = path.endsWith("/") ? path + name : `${path}/${name}`;
        const [amount, folder] = await walk(child, `${full}/${name}`, depth + 1, operandDev ?? st.dev);
        below += amount;
        if (!folder) files += amount;
      }
      // -S leaves a folder's subfolders out of its own line.
      const total = own + below, printed = o.separate ? own + files : total;
      if (depth <= o.depth) await line(printed, path);
      return [total, true];
    } finally { ancestors.delete(directoryKey); }
  }

  let grand = 0;
  for (const operand of o.operands) {
    const full = isAbsolute(operand) ? operand : resolve(cwd, operand);
    grand += (await walk(operand, full, 0, undefined))[0];
  }
  if (o.total) await line(grand, "total", true);
  await flush();
  return { status, stdout, stderr };
}
