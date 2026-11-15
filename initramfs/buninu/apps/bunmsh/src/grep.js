// The fallback grep, after GNU grep 3.11 for the options it takes. Results stream:
// `write`, when given, takes the output as each file chunk (or, with --line-buffered,
// each line) is searched, so a long recursive search shows its first match at once;
// without it everything is gathered and returned, as a captured `$(grep ...)` needs.
//
// Recursion follows GNU: -r follows symbolic links only when they are operands, -R
// follows all of them and reports a directory loop instead of entering it, and in
// both only regular files and directories are read, so a FIFO never blocks the walk.
// A file that cannot be read is reported and the search goes on; the exit status is
// then 2, unless -q already found a match. Files are read in chunks, never whole.
//
// A file whose data holds a NUL is binary. By default its first selected line prints
// "binary file matches" to stderr instead of the line; -a (--text, --binary-files=text)
// searches it as text. -I probes up to 32 KiB of the first nonempty chunk, without
// waiting for more pipe input. Later bytes are searched as text: already emitted
// matches cannot be retracted. Classification can depend on input buffering.
import { lstatSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const STRERROR = {
  ENOENT: "No such file or directory", EACCES: "Permission denied", EPERM: "Operation not permitted",
  ELOOP: "Too many levels of symbolic links", ENOTDIR: "Not a directory", EISDIR: "Is a directory",
  EIO: "Input/output error", ENAMETOOLONG: "File name too long",
};
const reason = (error) => STRERROR[error?.code] ?? String(error?.message ?? error);

// Basic regular expressions: \+ \? \| \( \) \{ \} are operators, the bare characters are literal.
export function grepBasicRegex(pattern) {
  let output = "", inClass = false, branchStart = true;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (!inClass && ch === "\\" && i + 1 < pattern.length) {
      const next = pattern[++i];
      output += "+?|(){}".includes(next) ? next : `\\${next}`;
      branchStart = next === "(" || next === "|";
      continue;
    }
    if (!inClass && ch === "$") {
      const anchored = i === pattern.length - 1 || pattern.startsWith("\\)", i + 1) || pattern.startsWith("\\|", i + 1);
      output += anchored ? "$" : "\\$";
    } else if (!inClass && ch === "^") output += branchStart ? "^" : "\\^";
    else if (!inClass && "+?|(){}".includes(ch)) output += `\\${ch}`;
    else output += ch;
    if (ch === "[") inClass = true;
    else if (ch === "]" && inClass) inClass = false;
    branchStart = false;
  }
  return output;
}

export function grepPosixClasses(pattern) {
  const classes = {
    alnum: "A-Za-z0-9", alpha: "A-Za-z", blank: " \\t", digit: "0-9",
    lower: "a-z", space: "\\s", upper: "A-Z", word: "A-Za-z0-9_",
    xdigit: "A-Fa-f0-9",
  };
  return pattern.replace(/\[\[:(alnum|alpha|blank|digit|lower|space|upper|word|xdigit):\]\]/g,
    (_match, name) => `[${classes[name]}]`);
}

// GNU grep matches --exclude and --exclude-dir globs as fnmatch does without FNM_PATHNAME or
// FNM_PERIOD: * and ? also take "/" and a leading ".".
export function globRegex(pattern) {
  let source = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") source += "[^]*";
    else if (ch === "?") source += "[^]";
    else if (ch === "\\" && i + 1 < pattern.length) source += pattern[++i].replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    else if (ch === "[") {
      const end = pattern.indexOf("]", i + 2);
      if (end < 0) source += "\\[";
      else { const body = pattern.slice(i + 1, end); source += `[${body.startsWith("!") ? "^" + body.slice(1) : body}]`; i = end; }
    } else source += ch.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`${source}$`);
}
// A walked entry is excluded by its own name; an operand by any of its "/"-separated suffixes.
const excludedName = (globs, name) => globs.some((glob) => glob.test(name));
function excludedOperand(globs, operand) {
  const trimmed = operand.replace(/\/+$/, "") || operand;
  if (excludedName(globs, trimmed)) return true;
  for (let at = trimmed.indexOf("/"); at >= 0; at = trimmed.indexOf("/", at + 1))
    if (excludedName(globs, trimmed.slice(at + 1))) return true;
  return false;
}

// Short options that are plain switches, and the long names that mean one of them.
const SWITCHES = "EFGiyvwxcqsnorRlLHhZIa";
const LONG_SWITCHES = {
  "extended-regexp": "E", "fixed-strings": "F", "basic-regexp": "G", "ignore-case": "i",
  "invert-match": "v", "word-regexp": "w", "line-regexp": "x", "count": "c", "quiet": "q",
  "silent": "q", "no-messages": "s", "line-number": "n", "only-matching": "o", "recursive": "r",
  "dereference-recursive": "R", "files-with-matches": "l", "files-without-match": "L",
  "with-filename": "H", "no-filename": "h", "null": "Z", "text": "a",
};

function parse(argv) {
  const options = { flags: new Set(), patterns: [], max: null, binary: "binary", color: "never", lineBuffered: false,
    exclude: [], excludeDir: [] };
  const flags = options.flags;
  // The last of -E, -F and -G wins, as do -H and -h, and -l and -L.
  const set = (flag) => {
    if ("EFG".includes(flag)) for (const other of "EFG") flags.delete(other);
    if ("Hh".includes(flag)) for (const other of "Hh") flags.delete(other);
    if ("lL".includes(flag)) for (const other of "lL") flags.delete(other);
    if (flag === "a") options.binary = "text";
    if (flag === "I") options.binary = "without-match";
    flags.add(flag === "y" ? "i" : flag);
  };
  const maxCount = (value) => {
    if (!/^\d+$/.test(String(value))) throw new Error(`invalid max count`);
    options.max = Number(value);
  };
  const binaryFiles = (value) => {
    if (!["binary", "text", "without-match"].includes(value)) throw new Error(`unknown binary-files type`);
    options.binary = value;
  };
  let i = 1;
  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") { i++; break; }
    if (!arg.startsWith("-") || arg === "-") break;
    if (arg.startsWith("--")) {
      const [name, value] = arg.slice(2).split(/=(.*)/s, 2);
      const takes = (label) => {
        if (value !== undefined) return value;
        if (i + 1 >= argv.length) throw new Error(`option '--${name}' requires an argument`);
        return argv[++i];
      };
      if (name === "color" || name === "colour") {
        if (value !== undefined && !["always", "auto", "never"].includes(value)) throw new Error(`invalid argument '${value}' for '--color'`);
        options.color = value ?? "always";  // bunmsh keeps "always" for a bare --color; GNU means "auto".
      } else if (name === "regexp") options.patterns.push(...takes().split("\n"));
      else if (name === "max-count") maxCount(takes());
      else if (name === "binary-files") binaryFiles(takes());
      else if (name === "line-buffered") options.lineBuffered = true;
      else if (name === "exclude") options.exclude.push(globRegex(takes()));
      else if (name === "exclude-dir") options.excludeDir.push(globRegex(takes()));
      else if (LONG_SWITCHES[name] && value === undefined) set(LONG_SWITCHES[name]);
      else throw new Error(`unsupported option: ${arg}`);
      continue;
    }
    for (let j = 1; j < arg.length; j++) {
      const ch = arg[j];
      if (ch === "e" || ch === "m") {
        const rest = arg.slice(j + 1);
        const value = rest.length ? rest : argv[++i];
        if (value === undefined) throw new Error(ch === "e" ? "-e requires a pattern" : "-m requires a count");
        if (ch === "e") options.patterns.push(...value.split("\n"));
        else maxCount(value);
        break;
      }
      if (!SWITCHES.includes(ch)) throw new Error(`unsupported option: -${ch}`);
      set(ch);
    }
  }
  if (!options.patterns.length) {
    if (i >= argv.length) throw new Error("missing pattern");
    options.patterns.push(...argv[i++].split("\n"));
  }
  options.operands = argv.slice(i);
  return options;
}

function compile(options) {
  const { flags, patterns } = options;
  const source = patterns.map(pattern => flags.has("F")
    ? pattern.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")
    : grepPosixClasses(flags.has("E") ? pattern : grepBasicRegex(pattern))).map(p => `(?:${p})`).join("|");
  let wrapped = source;
  if (flags.has("x")) wrapped = `^(?:${source})$`;
  else if (flags.has("w")) wrapped = `(?<![A-Za-z0-9_])(?:${source})(?![A-Za-z0-9_])`;
  const modes = `${flags.has("i") ? "i" : ""}${flags.has("o") ? "g" : ""}`;
  // "u" makes "." and [...] take a whole emoji rather than half of its surrogate pair. A pattern
  // that "u" rejects (an identity escape such as \< or a bare "{" in -E) keeps the old reading.
  try { return new RegExp(wrapped, `${modes}u`); }
  catch { return new RegExp(wrapped, modes); }
}

// Bytes that are not UTF-8 travel as U+DC80..U+DCFF (Python's "surrogateescape"): the regex
// sees the text around them, and output gives back exactly the bytes that were read.
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export function decodeBytes(bytes) {
  try { return strictUtf8.decode(bytes); } catch {}
  let text = "", start = 0, i = 0;
  const continues = (at, low = 0x80, high = 0xbf) => at < bytes.length && bytes[at] >= low && bytes[at] <= high;
  while (i < bytes.length) {
    const b = bytes[i];
    let size = 0;
    if (b < 0x80) size = 1;
    else if (b >= 0xc2 && b <= 0xdf) size = continues(i + 1) ? 2 : 0;
    else if (b >= 0xe0 && b <= 0xef) {
      const [low, high] = b === 0xe0 ? [0xa0, 0xbf] : b === 0xed ? [0x80, 0x9f] : [0x80, 0xbf];
      size = continues(i + 1, low, high) && continues(i + 2) ? 3 : 0;
    } else if (b >= 0xf0 && b <= 0xf4) {
      const [low, high] = b === 0xf0 ? [0x90, 0xbf] : b === 0xf4 ? [0x80, 0x8f] : [0x80, 0xbf];
      size = continues(i + 1, low, high) && continues(i + 2) && continues(i + 3) ? 4 : 0;
    }
    if (size) { i += size; continue; }
    text += strictUtf8.decode(bytes.subarray(start, i)) + String.fromCharCode(0xdc00 + b);
    start = ++i;
  }
  return text + strictUtf8.decode(bytes.subarray(start));
}
// Scanned by hand: Bun's matchAll misses lone surrogates that a lookbehind regex's test() finds.
export function encodeText(text) {
  if (!/[\uDC80-\uDCFF]/.test(text)) return Buffer.from(text);
  const parts = [];
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0xdc80 || code > 0xdcff) continue;
    const previous = i ? text.charCodeAt(i - 1) : 0;
    if (previous >= 0xd800 && previous <= 0xdbff) continue;
    parts.push(Buffer.from(text.slice(last, i)), Uint8Array.of(code - 0xdc00));
    last = i + 1;
  }
  parts.push(Buffer.from(text.slice(last)));
  return Buffer.concat(parts);
}

/**
 * Runs `grep` with `argv` (argv[0] is the command name). `cwd` resolves relative operands,
 * `input()` returns the ReadableStream for standard input, `tty` says whether stdout is a
 * terminal for --color=auto. Returns { status, stdout, stderr }: stdout is a Buffer holding the
 * input's own bytes, empty when `write` took it (as Buffers); stderr is a string, empty when
 * `writeError` took it, each message after the output before it.
 */
export async function runGrep(argv, { cwd = process.cwd(), platform = process.platform, input = null, write = null, writeError = null, tty = false } = {}) {
  let options, regex;
  try { options = parse(argv); regex = compile(options); }
  catch (error) { return { status: 2, stdout: Buffer.alloc(0), stderr: `bunmsh: grep: ${error.message}\n` }; }
  const { flags, max, binary, lineBuffered } = options;
  const invert = flags.has("v"), quiet = flags.has("q"), numbers = flags.has("n"), only = flags.has("o");
  const listMatches = flags.has("l"), listMissing = flags.has("L");
  const counting = flags.has("c") && !listMatches && !listMissing;
  const recursive = flags.has("r") || flags.has("R"), follow = flags.has("R");
  const nul = flags.has("Z"), silent = flags.has("s");
  // Lines are printed only when no mode replaces them with a count, a name or nothing.
  const printsLines = !quiet && !counting && !listMatches && !listMissing;
  const color = options.color === "always" || (options.color === "auto" && tty);
  const red = "\x1b[01;31m", reset = "\x1b[m";
  const colored = (value) => color && value.length ? `${red}${value}${reset}` : value;
  const highlight = color && !only ? new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`) : null;
  const native = (value) => platform === "win32" ? value.replaceAll("/", "\\") : value;

  const stdout = [];
  let stderr = "", pending = "", status = 1, failed = false, done = false;
  const flush = async () => {
    if (!pending) return;
    const data = encodeText(pending);
    pending = "";
    if (write) await write(data); else stdout.push(data);
  };
  const out = async (text) => {
    pending += text;
    if (lineBuffered || pending.length >= 65536) await flush();
  };
  // A message streams in order with the output before it, when the caller streams.
  const message = async (text) => {
    if (!writeError) { stderr += text; return; }
    await flush();
    await writeError(text);
  };
  const fail = async (text) => { failed = true; if (!silent) await message(`bunmsh: grep: ${text}\n`); };
  const nameEnd = nul ? "\0" : "\n";
  const labelSep = nul ? "\0" : ":";

  // Searches one stream; `label` names it in output and messages.
  async function search(stream, label, showLabel) {
    if (max === 0) {
      if (!quiet && counting) await out(`${showLabel ? `${label}${labelSep}` : ""}0\n`);
      if (!quiet && listMissing) await out(`${label}${nameEnd}`);
      return;
    }
    let rest = [], lineNo = 0, count = 0, isBinary = false, stop = false;
    const prefix = (n) => `${showLabel ? `${label}${labelSep}` : ""}${numbers ? `${n}:` : ""}`;
    const line = async (text) => {
      lineNo++;
      regex.lastIndex = 0;
      const isMatch = regex.test(text);
      regex.lastIndex = 0;
      if (isMatch === invert) return;
      count++;
      status = 0;
      if (quiet) { done = stop = true; return; }
      if (listMatches) { await out(`${label}${nameEnd}`); stop = true; return; }
      if (listMissing) { stop = true; return; }
      if (printsLines) {
        if (isBinary && binary === "binary") {
          await message(`bunmsh: grep: ${label}: binary file matches\n`);
          stop = true;
          return;
        }
        if (only) {
          if (!invert) for (const match of text.matchAll(regex))
            if (match[0].length) await out(`${prefix(lineNo)}${colored(match[0])}\n`);
        } else {
          await out(`${prefix(lineNo)}${highlight ? text.replace(highlight, (match) => colored(match)) : text}\n`);
        }
      }
      if (max !== null && count >= max) stop = true;
    };
    const reader = stream.getReader();
    try {
      // Never fill a probe by waiting for another chunk: a live producer may
      // wait for our output before sending more. Classify only available bytes.
      let probed = false;
      while (!stop) {
        const { value, done: end } = await reader.read();
        if (!end && value.byteLength && !probed) {
          probed = true;
          if (binary === "without-match" && value.subarray(0, 32768).includes(0)) {
            isBinary = true; stop = true; break;
          }
        }
        if (!end) {
          if (binary !== "without-match" && !isBinary && value.includes(0)) isBinary = true;
          // Only the new bytes are scanned for line ends, and an unfinished line is kept as parts,
          // so a file with very long lines (or none, as a binary may have) costs linear time. A
          // "\n" byte never sits inside a UTF-8 sequence, so the finished lines decode together.
          const last = value.lastIndexOf(10);
          if (last < 0) { if (value.byteLength) rest.push(value.slice()); }
          else {
            const head = value.subarray(0, last);
            const finished = rest.length ? Buffer.concat([...rest, head]) : head;
            rest = last + 1 < value.byteLength ? [value.slice(last + 1)] : [];
            for (const text of decodeBytes(finished).split("\n")) {
              if (stop) break;
              await line(text);
            }
          }
        } else if (!stop && rest.length) { const whole = Buffer.concat(rest); rest = []; await line(decodeBytes(whole)); }
        if (!lineBuffered) await flush();
        if (end) break;
      }
    } finally {
      if (stop) await reader.cancel().catch(() => {});
      try { reader.releaseLock(); } catch {}
    }
    if (done || quiet) return;
    if (counting) await out(`${showLabel ? `${label}${labelSep}` : ""}${isBinary && binary === "without-match" ? 0 : count}\n`);
    if (listMissing && count === 0) await out(`${label}${nameEnd}`);
    await flush();
  }

  async function searchFile(shown, path, showLabel) {
    let stream;
    try { stream = Bun.file(path).stream(); }
    catch (error) { await fail(`${shown}: ${reason(error)}`); return; }
    try { await search(stream, shown, showLabel); }
    catch (error) { await fail(`${shown}: ${reason(error)}`); }
  }

  async function readdirOrFail(shown, path) {
    try { return readdirSync(path, { withFileTypes: true }); }
    catch (error) { await fail(`${shown}: ${reason(error)}`); return []; }
  }

  // Walks a directory in the order the system lists it, as GNU grep's fts walk does. Children
  // of the implicit "." (no operand) are named without "./", as GNU grep names them.
  async function walk(shown, path, entries, ancestors, showLabel) {
    for (const entry of entries) {
      if (done) return;
      const childShown = shown ? `${shown.replace(/\/$/, "")}/${entry.name}` : entry.name;
      const childPath = resolve(path, entry.name);
      let stats;
      try {
        if (entry.isSymbolicLink()) {
          if (!follow) continue;
          stats = statSync(childPath);
        } else if (entry.isDirectory()) stats = lstatSync(childPath);
        else if (entry.isFile()) {
          if (!excludedName(options.exclude, entry.name)) await searchFile(childShown, childPath, showLabel);
          continue;
        }
        else continue;
      } catch (error) { await fail(`${childShown}: ${reason(error)}`); continue; }
      if (stats.isDirectory()) {
        if (excludedName(options.excludeDir, entry.name)) continue;
        const key = `${stats.dev}:${stats.ino}`;
        if (ancestors.has(key)) {
          if (!silent) await message(`bunmsh: grep: ${childShown}: warning: recursive directory loop\n`);
          continue;
        }
        ancestors.add(key);
        await walk(childShown, childPath, await readdirOrFail(childShown, childPath), ancestors, showLabel);
        ancestors.delete(key);
      } else if (stats.isFile() && !excludedName(options.exclude, entry.name)) await searchFile(childShown, childPath, showLabel);
    }
  }

  const operands = options.operands.slice();
  const implicitCwd = !operands.length && recursive;
  if (implicitCwd) operands.push(".");
  if (!operands.length) operands.push("-");
  const forced = flags.has("H") ? true : flags.has("h") ? false : null;
  const many = operands.length > 1;
  for (const operand of operands) {
    if (done) break;
    if (operand === "-") {
      await search(input?.() ?? Bun.stdin.stream(), "(standard input)", forced ?? many);
      continue;
    }
    const path = isAbsolute(native(operand)) ? native(operand) : resolve(cwd, native(operand));
    let stats;
    try { stats = statSync(path); }
    catch (error) { await fail(`${operand}: ${reason(error)}`); continue; }
    if (stats.isDirectory()) {
      if (!recursive) { await fail(`${operand}: Is a directory`); continue; }
      // The implicit "." of a bare -r is never excluded; a named one is, as GNU grep does.
      if (!implicitCwd && excludedOperand(options.excludeDir, operand)) continue;
      const ancestors = new Set([`${stats.dev}:${stats.ino}`]);
      // A directory operand names the files found in it, unless -h says otherwise.
      await walk(implicitCwd ? "" : operand, path, await readdirOrFail(operand, path), ancestors, forced ?? true);
      continue;
    }
    if (excludedOperand(options.exclude, operand)) continue;
    await searchFile(operand, path, forced ?? many);
  }
  await flush();

  if (failed && !(quiet && status === 0)) status = 2;
  return { status, stdout: Buffer.concat(stdout), stderr };
}
