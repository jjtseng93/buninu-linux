import {compileAwk, executeAwk} from "./awk.js";
import {normalFileDiff} from "./diff.js";
import {compileSed, applySed} from "./sed.js";
import {
  constants as fsConstants,
  accessSync,
  closeSync,
  chmodSync,
  chownSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  lstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  openSync,
  readdirSync,
  rmdirSync,
  readFileSync,
  readSync,
  read as fsRead,
  writeSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
  utimesSync,
} from "node:fs";
import { createHash } from "node:crypto";
import {
  tmpdir,
  arch as osArch,
  constants as osConstants,
  hostname as osHostname,
  release as osRelease,
  type as osType,
  version as osVersion,
} from "node:os";
import {
  basename as pathBasename,
  delimiter as pathDelimiter,
  dirname as pathDirname,
  isAbsolute,
  resolve as resolvePath,
} from "node:path";
import { Readable } from "node:stream";
import { format as formatValue } from "node:util";
import { EXECUTABLE_COMMAND, IS_COMPILED } from "../single-exe/compiled.js";
import { readAssetText } from "../single-exe/assetsHelper.js";
import { dedupeBunmshHistory, saveBunmshHistory } from "./history.js";
import { fancyLs } from "./fancy-ls.js";
import { canonicalEnvironment, environmentValue } from "./environment.js";
import { findIsRegularBuiltin, runFind } from "./find.js";
import { main as startFileServer, parseServeArguments, waitForInterrupt } from "../serve.js";
import { main as catFancy } from "./cat-fancy.js";
import { parseCatOperands } from "./cat-operands.js";
import { runCurl } from "./curl.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const DEFAULT_ALIASES = {
  ls: ["ls", "--color=auto"],
  grep: ["grep", "--color=auto"],
  diff: ["diff", "--color"],
};
const DEFAULT_COMMAND_PATH = process.platform === "win32"
  ? (environmentValue(process.env, "PATH") ?? "")
  : ["/bin", "/usr/bin"].join(pathDelimiter);
const BUN_EXECUTABLE = Bun.which("bun") || process.argv0;
const BUN_RUNTIME_COMMAND = EXECUTABLE_COMMAND.length > 1
  ? EXECUTABLE_COMMAND
  : [BUN_EXECUTABLE];
const BUNMSH_ENTRY = resolvePath(import.meta.dirname, "main.js");
const PIPELINE_STATE_ENV = "BUNMSH_INTERNAL_PIPELINE_STATE";

const HELP_ALIASES = {
  ":": "colon",
  "[": "test",
  __builtin: "builtin",
  chdir: "cd",
};
const HELP_EXCLUDED = new Set([".", "..", "//", "-", "~"]);
const HELP_LONG_ONLY = new Set(["ls", "lsfancy"]);

function requestsBuiltinHelp(argv) {
  return argv.length === 2 &&
    (argv[1] === "--help" || (argv[1] === "-h" && !HELP_LONG_ONLY.has(argv[0])));
}

function hasBuiltinHelp(name) {
  return !HELP_EXCLUDED.has(name);
}

async function builtinHelp(name) {
  try {
    const source = await readAssetText(`help/${HELP_ALIASES[name] ?? name}.md`);
    return result(0, String(Bun.markdown.ansi(source, { hyperlinks: true })));
  } catch (error) {
    return result(1, "", `bunmsh: ${name}: cannot load help: ${error.message}\n`);
  }
}

function shellPath(value) {
  return process.platform === "win32" ? value.replaceAll("\\", "/") : value;
}

function nativePath(value) {
  return process.platform === "win32" ? value.replaceAll("/", "\\") : value;
}

export class ShellSyntaxError extends Error {
  constructor(message, offset = -1) {
    super(message);
    this.name = "ShellSyntaxError";
    this.offset = offset;
  }
}

function isNameStart(ch) {
  return /[A-Za-z_]/.test(ch ?? "");
}

function isNameChar(ch) {
  return /[A-Za-z0-9_]/.test(ch ?? "");
}

function isSpace(ch) {
  return ch === " " || ch === "\t" || ch === "\r";
}

function lineContinuationLength(source, offset) {
  if (source[offset] !== "\\") return 0;
  if (source[offset + 1] === "\n") return 2;
  if (source[offset + 1] === "\r" && source[offset + 2] === "\n") return 3;
  return 0;
}

function normalizeSource(source) {
  return String(source).replaceAll("\r\n", "\n");
}

function wordToken(offset) {
  return { type: "word", fragments: [], offset };
}

function pushFragment(word, text, quote) {
  if (text === "") {
    if (quote !== "none") word.fragments.push({ text, quote });
    return;
  }
  const previous = word.fragments.at(-1);
  if (previous?.quote === quote) previous.text += text;
  else word.fragments.push({ text, quote });
}

function substitutionEnd(source, start) {
  if (source[start] === "`") {
    for (let i = start + 1; i < source.length; i++) {
      if (source[i] === "\\") i++;
      else if (source[i] === "`") return i + 1;
    }
    throw new ShellSyntaxError("unterminated command substitution", start);
  }
  if (source[start] !== "$" || source[start + 1] !== "(") return start;
  let depth = source[start + 2] === "(" ? 2 : 1;
  let quote = null;
  for (let i = start + 2 + (depth === 2 ? 1 : 0); i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") { i++; continue; }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return i + 1;
  }
  throw new ShellSyntaxError("unterminated substitution", start);
}

function parameterEnd(source, start) {
  let depth = 1;
  for (let i = start + 2; i < source.length; i++) {
    if (source[i] === "\\") { i++; continue; }
    if (source[i] === "$" && source[i + 1] === "{") { depth++; i++; continue; }
    if (source[i] === "}" && --depth === 0) return i + 1;
  }
  throw new ShellSyntaxError("unterminated parameter expansion", start);
}

// Real shells (dash, bash) are lenient when a script ends before a
// here-document's terminator line ever appears: whatever was read so far
// becomes the body instead of raising a syntax error. `strict` disables that
// leniency so a caller (see growHeredocLine) can use the throw as a signal
// that more input is still needed.
function consumeHeredocBodies(source, start, pending, strict) {
  let i = start;
  for (const entry of pending) {
    let body = "";
    while (true) {
      const newline = source.indexOf("\n", i);
      const atEnd = newline === -1;
      const lineEnd = atEnd ? source.length : newline;
      const rawLine = source.slice(i, lineEnd);
      const line = entry.strip ? rawLine.replace(/^\t+/, "") : rawLine;
      if (line === entry.delimiterText) {
        i = atEnd ? lineEnd : newline + 1;
        break;
      }
      if (atEnd) {
        if (strict) {
          throw new ShellSyntaxError(
            `unterminated here-document (wanted '${entry.delimiterText}')`,
            entry.token.offset,
          );
        }
        body += line;
        i = lineEnd;
        break;
      }
      body += `${line}\n`;
      i = newline + 1;
    }
    entry.token.heredoc = { body, expand: entry.expand };
  }
  return i;
}

export function tokenize(source, options = {}) {
  source = normalizeSource(source);
  const strict = Boolean(options.strict);
  const tokens = [];
  let i = 0;
  let current = null;
  let atWordBoundary = true;
  let pendingHeredocs = [];
  let awaitingHeredocDelimiter = false;
  let currentHeredocStrip = false;

  const finishWord = () => {
    if (current) {
      if (awaitingHeredocDelimiter) {
        pendingHeredocs.push({
          token: current,
          strip: currentHeredocStrip,
          expand: current.fragments.every((fragment) =>
            fragment.quote === "none" && !fragment.text.includes("\u0000")),
          delimiterText: current.fragments.map((fragment) =>
            fragment.text.replace(/\u0000(.)/g, "$1")).join(""),
        });
        awaitingHeredocDelimiter = false;
      }
      tokens.push(current);
    }
    current = null;
  };
  const ensureWord = () => {
    current ??= wordToken(i);
    atWordBoundary = false;
    return current;
  };

  while (i < source.length) {
    const ch = source[i];

    // A backslash-newline pair is removed before token recognition. Besides
    // joining ordinary words, doing this here avoids creating a phantom empty
    // word for the indented continuation lines commonly used in exec calls.
    const continuation = lineContinuationLength(source, i);
    if (continuation) {
      options.continuations?.set(i, continuation);
      i += continuation;
      continue;
    }

    if (ch === "\n") {
      finishWord();
      // Newlines after AND/OR/pipe operators continue the same command,
      // including when a here-document body lies between the two sides.
      const previous = tokens.at(-1);
      if (!(previous?.type === "op" && ["&&", "||", "|"].includes(previous.value)))
        tokens.push({ type: "op", value: ";", offset: i });
      i++;
      atWordBoundary = true;
      if (pendingHeredocs.length) {
        i = consumeHeredocBodies(source, i, pendingHeredocs, strict);
        pendingHeredocs = [];
      }
      continue;
    }
    if (isSpace(ch)) {
      finishWord();
      i++;
      atWordBoundary = true;
      continue;
    }
    if (ch === "#" && atWordBoundary && !current) {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    const fullDup = /^\d+>&\d+(?=$|[\s;|&<>])/.exec(source.slice(i))?.[0];
    if (!current && fullDup) { tokens.push({type:"op",value:fullDup,offset:i}); i += fullDup.length; atWordBoundary=true; continue; }
    const ioOperator = /^(?:[0-9]+)?(?:>&|<&|<>|>>|>(?!>)|<(?!<))/.exec(source.slice(i))?.[0];
    if (!current && ioOperator) {
      tokens.push({type:"op", value:ioOperator, offset:i});
      i += ioOperator.length;
      atWordBoundary = true;
      continue;
    }
    const two = source.slice(i, i + 2);
    const operatorAhead =
      ["|", ";", "<", ">"].includes(ch) ||
      two === "&&" ||
      two === "||";
    if (current && operatorAhead) {
      finishWord();
      continue;
    }
    if (!current && ["&&", "||", ">>", "2>", "2>>"].includes(
      source.slice(i, i + 3) === "2>>" ? source.slice(i, i + 3) : two,
    )) {
      const value = source.slice(i, i + 3) === "2>>" ? "2>>" : two;
      tokens.push({ type: "op", value, offset: i });
      i += value.length;
      atWordBoundary = true;
      continue;
    }
    if (!current && two === "<<" && source[i + 2] === "<") {
      tokens.push({ type: "op", value: "<<<", offset: i });
      i += 3;
      atWordBoundary = true;
      continue;
    }
    if (!current && two === "<<") {
      const value = source[i + 2] === "-" ? "<<-" : "<<";
      tokens.push({ type: "op", value, offset: i });
      currentHeredocStrip = value === "<<-";
      awaitingHeredocDelimiter = true;
      i += value.length;
      atWordBoundary = true;
      continue;
    }
    if (!current && ["|", ";", "<", ">"].includes(ch)) {
      tokens.push({ type: "op", value: ch, offset: i++ });
      atWordBoundary = true;
      continue;
    }

    if (ch === "'") {
      const word = ensureWord();
      const start = ++i;
      while (i < source.length && source[i] !== "'") i++;
      if (i >= source.length)
        throw new ShellSyntaxError("unterminated single quote", start - 1);
      pushFragment(word, source.slice(start, i), "single");
      i++;
      continue;
    }

    if (ch === '"') {
      const word = ensureWord();
      i++;
      let text = "";
      let closed = false;
      while (i < source.length) {
        if (source[i] === '"') {
          closed = true;
          i++;
          break;
        }
        const quotedContinuation = lineContinuationLength(source, i);
        if (quotedContinuation) {
          options.continuations?.set(i, quotedContinuation);
          i += quotedContinuation;
          continue;
        }
        if (source[i] === "\\" && i + 1 < source.length) {
          const next = source[i + 1];
          if (next === "$" || next === "`" || next === '"' || next === "\\") {
            text += `\u0000${next}`;
            i += 2;
            continue;
          }
        }
        if ((source[i] === "$" && ["(", "{"].includes(source[i + 1])) || source[i] === "`") {
          const end = source[i] === "$" && source[i + 1] === "{" ? parameterEnd(source, i) : substitutionEnd(source, i);
          text += source.slice(i, end);
          i = end;
          continue;
        }
        text += source[i++];
      }
      if (!closed)
        throw new ShellSyntaxError("unterminated double quote", i);
      pushFragment(word, text, "double");
      continue;
    }

    if (ch === "\\") {
      const word = ensureWord();
      if (i + 1 >= source.length) {
        // A bare trailing backslash at the very end of the source is what an
        // interactive line looks like the instant Enter is pressed, before
        // the next physical line -- which would complete the continuation
        // pair the branch above handles -- has even been typed. In strict
        // mode (needsMoreInput's interactive-continuation check) that must
        // wait for more input like any other unterminated construct, not
        // silently become a literal "\" word character.
        if (strict) throw new ShellSyntaxError("unterminated line continuation", i);
        pushFragment(word, "\\", "none");
        i++;
      } else {
        pushFragment(word, `\u0000${source[i + 1]}`, "none");
        i += 2;
      }
      continue;
    }

    const word = ensureWord();
    let text = "";
    while (i < source.length) {
      const c = source[i];
      if ((c === "$" && ["(", "{"].includes(source[i + 1])) || c === "`") {
        const end = source[i] === "$" && source[i + 1] === "{" ? parameterEnd(source, i) : substitutionEnd(source, i);
        text += source.slice(i, end);
        i = end;
        continue;
      }
      const maybeOp =
        ["|", ";", "<", ">"].includes(c) ||
        source.slice(i, i + 2) === "&&" ||
        source.slice(i, i + 2) === "||";
      if (isSpace(c) || c === "\n" || c === "'" || c === '"' || c === "\\" || maybeOp)
        break;
      text += c;
      i++;
    }
    pushFragment(word, text, "none");
  }

  finishWord();
  if (pendingHeredocs.length) {
    if (strict) {
      const first = pendingHeredocs[0];
      throw new ShellSyntaxError(
        `unterminated here-document (wanted '${first.delimiterText}')`,
        first.token.offset,
      );
    }
    for (const entry of pendingHeredocs) entry.token.heredoc = { body: "", expand: entry.expand };
  }
  return tokens;
}

function emptyCommand() {
  return { words: [], redirects: [] };
}

export function parse(source) {
  source = normalizeSource(source);
  const tokens = tokenize(source);
  const jobs = [];
  let i = 0;
  let connector = null;

  const skipSemicolons = () => {
    while (tokens[i]?.type === "op" && tokens[i].value === ";") i++;
  };

  skipSemicolons();
  while (i < tokens.length) {
    const pipeline = [];
    while (true) {
      const command = emptyCommand();
      command.lineNumber = source.slice(0, tokens[i]?.offset ?? 0).split("\n").length;
      while (i < tokens.length) {
        const token = tokens[i];
        if (token.type === "op" && ["|", ";", "&&", "||"].includes(token.value))
          break;
        if (token.type === "op" && /^\d+>&\d+$/.test(token.value)) {
          command.redirects.push({ op: token.value, target: null });
          i++;
          continue;
        }
        if (token.type === "op" && (/^\d*(?:>&|<&|<>|>>|>|<)$/.test(token.value) || ["<<", "<<-", "<<<"].includes(token.value))) {
          const target = tokens[i + 1];
          if (!target || target.type !== "word")
            throw new ShellSyntaxError(
              token.value === "<<<"
                ? `redirection ${token.value} requires a word`
                : token.value.startsWith("<<")
                ? `redirection ${token.value} requires a here-document delimiter`
                : `redirection ${token.value} requires a path`,
              token.offset,
            );
          command.redirects.push({ op: token.value, target, heredoc: target.heredoc ?? null });
          i += 2;
          continue;
        }
        if (token.type !== "word")
          throw new ShellSyntaxError(`unexpected operator ${token.value}`, token.offset);
        command.words.push(token);
        i++;
      }
      if (command.words.length === 0 && command.redirects.length === 0)
        throw new ShellSyntaxError("expected a command", tokens[i]?.offset ?? source.length);
      pipeline.push(command);

      if (tokens[i]?.value === "|") {
        i++;
        while (tokens[i]?.value === ";" && source[tokens[i].offset] === "\n") i++;
        if (!tokens[i])
          throw new ShellSyntaxError("pipeline requires a command", source.length);
        continue;
      }
      break;
    }

    let negate = false;
    const firstWord = pipeline[0]?.words[0];
    if (firstWord?.fragments.length === 1 && firstWord.fragments[0].quote === "none" &&
        firstWord.fragments[0].text === "!") {
      pipeline[0].words.shift();
      if (pipeline[0].words.length === 0)
        throw new ShellSyntaxError("! requires a command", firstWord.offset);
      negate = true;
    }
    const separator = tokens[i]?.value;
    jobs.push({ connector, pipeline, negate, background: false });
    if (!separator) break;
    if (![";", "&&", "||"].includes(separator))
      throw new ShellSyntaxError(`unexpected operator ${separator}`, tokens[i].offset);
    connector = separator;
    i++;
    skipSemicolons();
    if (i >= tokens.length) break;
  }
  const lastJob = jobs.at(-1);
  const lastCommand = lastJob?.pipeline.at(-1);
  const lastWord = lastCommand?.words.at(-1);
  const lastToken = tokens.findLast((token) =>
    token.type !== "op" || token.value !== ";" || source[token.offset] !== "\n");
  if (lastWord === lastToken &&
      lastWord?.fragments.length === 1 &&
      lastWord.fragments[0].quote === "none" &&
      lastWord.fragments[0].text === "&") {
    lastCommand.words.pop();
    if (lastCommand.words.length === 0 && lastCommand.redirects.length === 0)
      throw new ShellSyntaxError("expected a command", lastWord.offset);
    lastJob.background = true;
  }
  return jobs;
}

function parameterValue(name, state) {
  if (name === "LINENO") return String(state.lineNumber ?? 1);
  if (name === "?") return String(state.lastStatus);
  if (name === "$") return String(process.pid);
  if (name === "#") return String(Math.max(0, state.args.length - 1));
  if (name === "-") return Object.entries(state.shellOptions ?? {}).filter(([k,v])=>v && k.length === 1).map(([k])=>k).join("");
  if (name === "0") return state.args[0] ?? "bunmsh";
  if (name === "@" || name === "*") return state.args.slice(1).join((state.env.IFS ?? " ")[0] ?? " ");
  if (/^[1-9][0-9]*$/.test(name)) return state.args[Number(name)] ?? "";
  return state.env[name] ?? "";
}

function checkedParameter(name,state) {
  const unset = name === "LINENO" ? false : /^\d+$/.test(name) ? Number(name) >= state.args.length : /^[A-Za-z_]/.test(name) && !Object.hasOwn(state.env,name);
  if (state.shellOptions.u && unset) {
    state.exitRequested = true;
    state.exitStatus = 1;
    throw new ShellSyntaxError(`${name}: parameter not set`);
  }
  return parameterValue(name,state);
}

function tildeDirectory(name, state) {
  if (name === "") return state.env.HOME ?? "";
  if (name === "+") return state.env.PWD ?? state.cwd;
  if (name === "-") return state.env.OLDPWD ?? "~-";
  try {
    const entry = readFileSync("/etc/passwd", "utf8").split("\n")
      .find((line) => line.split(":", 2)[0] === name);
    return entry?.split(":")[5] ?? `~${name}`;
  } catch { return `~${name}`; }
}

function expandTildes(text, state, assignment) {
  const pattern = assignment ? /(^|[=:])~([A-Za-z0-9_.+-]*)(?=\/|:|$)/g : /^~([A-Za-z0-9_.+-]*)(?=\/|$)/;
  if (assignment)
    return text.replace(pattern, (_match, prefix, name) => `${prefix}${tildeDirectory(name, state)}`);
  return text.replace(pattern, (_match, name) => tildeDirectory(name, state));
}

function arithmeticValue(source, state) {
  const tokens = source.match(/(?:0[xX][0-9a-fA-F]+|\d+|[A-Za-z_][A-Za-z0-9_]*|\|\||&&|==|!=|<=|>=|<<|>>|[()+\-*/%<>&^|!~])/g) ?? [];
  let i = 0;
  const precedence = { "||": 1, "&&": 2, "|": 3, "^": 4, "&": 5, "==": 6, "!=": 6,
    "<": 7, "<=": 7, ">": 7, ">=": 7, "<<": 8, ">>": 8, "+": 9, "-": 9,
    "*": 10, "/": 10, "%": 10 };
  const atom = () => {
    const token = tokens[i++];
    if (["+", "-", "!", "~"].includes(token)) {
      const value = atom();
      return token === "+" ? value : token === "-" ? -value : token === "!" ? Number(!value) : ~value;
    }
    if (token === "(") {
      const value = expression(0);
      if (tokens[i++] !== ")") throw new ShellSyntaxError("bad arithmetic expression");
      return value;
    }
    if (/^[A-Za-z_]/.test(token ?? "")) return Number(state.env[token] ?? 0) || 0;
    if (token === undefined) throw new ShellSyntaxError("bad arithmetic expression");
    return Number(token);
  };
  const expression = (minimum) => {
    let left = atom();
    while ((precedence[tokens[i]] ?? -1) >= minimum) {
      const op = tokens[i++], priority = precedence[op], right = expression(priority + 1);
      left = { "||": Number(Boolean(left || right)), "&&": Number(Boolean(left && right)),
        "|": left | right, "^": left ^ right, "&": left & right, "==": Number(left === right),
        "!=": Number(left !== right), "<": Number(left < right), "<=": Number(left <= right),
        ">": Number(left > right), ">=": Number(left >= right), "<<": left << right,
        ">>": left >> right, "+": left + right, "-": left - right, "*": left * right,
        "/": Math.trunc(left / right), "%": left % right }[op];
    }
    return left;
  };
  const value = expression(0);
  if (i !== tokens.length || !Number.isFinite(value)) throw new ShellSyntaxError("bad arithmetic expression");
  return String(value | 0);
}

async function casePatternRegex(pattern, state) {
  let marked = "";
  const literal = (value) => {
    for (const ch of value) marked += `\u0000${ch}`;
  };
  for (let i = 0; i < pattern.length;) {
    if (pattern[i] === "\\") {
      if (i + 1 < pattern.length) literal(pattern[i + 1]);
      i += 2;
      continue;
    }
    if (pattern[i] === "'") {
      const end = pattern.indexOf("'", i + 1);
      if (end < 0) throw new ShellSyntaxError("unterminated single quote in case pattern");
      literal(pattern.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    if (pattern[i] === '"') {
      let end = i + 1;
      while (end < pattern.length && pattern[end] !== '"') {
        if (pattern[end] === "\\") end++;
        end++;
      }
      if (end >= pattern.length) throw new ShellSyntaxError("unterminated double quote in case pattern");
      literal(stripExpansionMarkers(await expandText(pattern.slice(i + 1, end), state)));
      i = end + 1;
      continue;
    }
    let end = i;
    while (end < pattern.length && !["\\", "'", '"'].includes(pattern[end])) end++;
    marked += stripExpansionMarkers(await expandText(pattern.slice(i, end), state));
    i = end;
  }
  let source = "";
  for (let i = 0; i < marked.length; i++) {
    if (marked[i] === "\u0000") {
      source += (marked[++i] ?? "").replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    } else if (marked[i] === "*") source += ".*";
    else if (marked[i] === "?") source += ".";
    else if (marked[i] === "[") {
      let end = i + 1;
      if (marked[end] === "!" || marked[end] === "^") end++;
      if (marked[end] === "]") end++;
      while (end < marked.length && marked[end] !== "]") {
        if (marked[end] === "\u0000" && end + 1 < marked.length) end++;
        end++;
      }
      if (end >= marked.length) source += "\\[";
      else {
        let body = marked.slice(i + 1, end);
        const negate = body[0] === "!" || body[0] === "^";
        if (negate) body = body.slice(1);
        body = body.replace(/\u0000(.)/gs, (_,ch) => /[\\\]\-^]/.test(ch) ? `\\${ch}` : ch);
        source += `[${negate ? "^" : ""}${body}]`;
        i = end;
      }
    }
    else source += marked[i].replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`^${source}$`, "s");
}

async function parameterExpansion(body, state, quoted = false) {
  if (/^[!%][A-Za-z_][A-Za-z0-9_]*$/.test(body)) {
    const value = parameterValue(body.slice(1), state);
    return body[0] === "!" ? parameterValue(value, state) : String([...value].length);
  }
  if (body.startsWith("#") && /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9]+|[?$#-])$/.test(body.slice(1)))
    return String(parameterValue(body.slice(1), state).length);
  const trim = /^([A-Za-z_][A-Za-z0-9_]*|[?$#@*]|[0-9]+)(%%|%|##|#)(.*)$/s.exec(body);
  if (trim) {
    const value = parameterValue(trim[1], state);
    const pattern = await casePatternRegex(trim[3], state);
    const matches = (part) => pattern.test(part);
    if (trim[2] === "%") {
      for (let i = value.length; i >= 0; i--) if (matches(value.slice(i))) return value.slice(0, i);
    } else if (trim[2] === "%%") {
      for (let i = 0; i <= value.length; i++) if (matches(value.slice(i))) return value.slice(0, i);
    } else if (trim[2] === "#") {
      for (let i = 0; i <= value.length; i++) if (matches(value.slice(0, i))) return value.slice(i);
    } else {
      for (let i = value.length; i >= 0; i--) if (matches(value.slice(0, i))) return value.slice(i);
    }
    return value;
  }
  const replace = /^([A-Za-z_][A-Za-z0-9_]*|[?$#@*-]|[0-9]+)\/(\/|#|%)?([^/]*)\/(.*)$/s.exec(body);
  if (replace) {
    const value = parameterValue(replace[1], state);
    const pattern = stripExpansionMarkers(await expandText(replace[3], state));
    const replacement = stripExpansionMarkers(await expandText(replace[4], state));
    let source = "";
    for (const ch of pattern) {
      if (ch === "*") source += ".*";
      else if (ch === "?") source += ".";
      else source += ch.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    }
    const prefix = replace[2] === "#" ? "^" : "";
    const suffix = replace[2] === "%" ? "$" : "";
    return value.replace(new RegExp(`${prefix}${source}${suffix}`, replace[2] === "/" ? "g" : ""), replacement);
  }
  const match = /^([A-Za-z_][A-Za-z0-9_]*|[?$#@*-]|[0-9]+)(?:(:?[-+=?])(.*))?$/s.exec(body);
  if (!match) throw new ShellSyntaxError(`unsupported parameter expansion: \${${body}}`);
  const [, name, operator, operand = ""] = match;
  const value = parameterValue(name, state);
  const unset = /^\d+$/.test(name) ? Number(name) >= state.args.length :
    name !== "LINENO" && !Object.hasOwn(state.env, name) && !/^[?$#@*-]$/.test(name);
  const empty = value === "";
  if (!operator) return checkedParameter(name,state);
  const useEmpty = operator.startsWith(":");
  const op = operator.at(-1);
  const missing = unset || (useEmpty && empty);
  const expandedOperand = () => expandParameterOperand(operand, state, quoted);
  if (op === "-") return missing ? expandedOperand() : value;
  if (op === "+") return missing ? "" : expandedOperand();
  if (op === "=") {
    if (missing) {
      if (!/^[A-Za-z_]/.test(name)) throw new ShellSyntaxError("cannot assign positional parameter");
      if (state.readonly?.has(name)) throw new ShellSyntaxError(`${name}: is read only`);
      const expanded = await expandedOperand();
      state.env[name] = stripExpansionMarkers(expanded);
      return expanded;
    }
    return value;
  }
  if (op === "?" && missing) throw new ShellSyntaxError(operand ? await expandedOperand() : `${name}: parameter null or not set`);
  return value;
}

function markedExpansion(value) {
  return `\ufdd0${value}\ufdd1`;
}

function stripExpansionMarkers(value) {
  return value.replace(/\ufdd4/g, " ").replace(/[\ufdd0-\ufdd3\ufdd5\ufdd6]/g, "");
}

// Like mksh eval.c's XARG/XARGSEP, retain quote and argument boundaries
// until field splitting. A selected ${...word} is shell word syntax, not text.
async function expandParameterOperand(source, state, outerQuoted) {
  let output = "", plain = "", quote = "none";
  const flush = async () => {
    if (quote === "single") output += `\ufdd2${plain}\ufdd5\ufdd3`;
    else {
      const value = await expandText(plain, state, outerQuoted || quote === "double");
      output += quote === "double" ? `\ufdd2${value}${value === "\ufdd6" ? "" : "\ufdd5"}\ufdd3` : value;
    }
    plain = "";
  };
  for (let i = 0; i < source.length;) {
    const ch = source[i];
    if (quote === "single") {
      if (ch === "'") { await flush(); quote = "none"; i++; }
      else plain += source[i++];
      continue;
    }
    if ((ch === '"' && quote !== "single") || (ch === "'" && quote === "none" && !outerQuoted)) {
      await flush(); quote = quote === "none" ? (ch === '"' ? "double" : "single") : "none"; i++; continue;
    }
    if (ch === "\\" && i + 1 < source.length) {
      if (quote === "none" && !outerQuoted || '$`"\\'.includes(source[i + 1])) {
        plain += `\u0000${source[i + 1]}`; i += 2; continue;
      }
    }
    if (ch === "`" || ch === "$" && ["{", "("].includes(source[i + 1])) {
      const end = source[i] === "$" && source[i + 1] === "{" ? parameterEnd(source, i) : substitutionEnd(source, i);
      plain += source.slice(i, end); i = end; continue;
    }
    plain += source[i++];
  }
  await flush();
  return output;
}

async function commandSubstitution(source, state) {
  const child = {
    ...state,
    env: { ...state.env },
    aliases: { ...state.aliases },
    readonly: new Set(state.readonly),
    exported: new Set(state.exported),
    directoryHistory: [...state.directoryHistory],
    tabs: [...state.tabs],
    exitRequested: false,
    exitStatus: 0,
    flow:null, loopDepth:0, returnDepth:0,
    shellOptions:{...state.shellOptions}, fdBindings:{...state.fdBindings},
    traps:{}, trapListeners:new Map(), pendingTraps:[], ownedFds:new Set(),
  };
  // Command substitution installs its own stdout pipe even inside >file.
  delete child.fdBindings[1];
  const output = await execute(source, child, { capture: true });
  const final = await finishShell(child,output.status,{capture:true});
  state.expansionStatus = final.status;
  return decode(concatBytes([output.stdout,final.stdout])).replace(/\n+$/, "");
}

async function expandText(text, state, quoted = false) {
  let output = "";
  for (let i = 0; i < text.length; ) {
    if (text[i] === "\u0000") {
      output += `\u0000${text[i + 1] ?? ""}`;
      i += 2;
      continue;
    }
    if (text[i] === "`") {
      const end = substitutionEnd(text, i);
      // mksh lex.c SBQUOTE removes one escape layer before parsing the body,
      // even inside quotes that belong to the inner command. Double-quoted
      // backquotes additionally recognize an escaped double quote.
      const source = text.slice(i + 1, end - 1).replace(quoted ? /\\([$`\\"])/g : /\\([$`\\])/g, "$1");
      output += markedExpansion(await commandSubstitution(source, state));
      i = end;
      continue;
    }
    if (text[i] !== "$") {
      output += text[i++];
      continue;
    }
    if (text.startsWith("$((", i)) {
      const end = substitutionEnd(text, i);
      const expression = stripExpansionMarkers(await expandText(text.slice(i + 3, end - 2), state));
      output += markedExpansion(arithmeticValue(expression, state));
      i = end;
      continue;
    }
    if (text.startsWith("$(", i)) {
      const end = substitutionEnd(text, i);
      output += markedExpansion(await commandSubstitution(text.slice(i + 2, end - 1), state));
      i = end;
      continue;
    }
    if (text[i + 1] === "{") {
      const end = parameterEnd(text, i);
      output += markedExpansion(await parameterExpansion(text.slice(i + 2, end - 1), state, quoted));
      i = end;
      continue;
    }
    const next = text[i + 1];
    if (["?", "$", "#", "@", "*", "-"].includes(next) || /[0-9]/.test(next ?? "")) {
      output += next === "@" && quoted
        ? (state.args.length > 1 ? state.args.slice(1).map(arg => `\ufdd2${arg}\ufdd5\ufdd3`).join("\ufdd4") : "\ufdd6")
        : markedExpansion(checkedParameter(next, state));
      i += 2;
      continue;
    }
    if (isNameStart(next)) {
      let end = i + 2;
      while (isNameChar(text[end])) end++;
      output += markedExpansion(checkedParameter(text.slice(i + 1, end), state));
      i = end;
      continue;
    }
    output += "$";
    i++;
  }
  return output;
}

function splitFields(segments, state) {
  const ifs = state.env.IFS === undefined ? " \t\n" : state.env.IFS;
  const fields = [];
  let current = [];
  let forced = false;
  let afterWhitespaceDelimiter = false;
  const finish = (includeEmpty = false) => {
    if (current.length || forced || includeEmpty) fields.push(current);
    current = [];
    forced = false;
  };
  for (const segment of segments) {
    if (segment.boundary) { finish(true); continue; }
    if (segment.quoted && segment.text === "") forced = true;
    for (const ch of segment.text) {
      if (!segment.quoted && segment.splittable && ifs.includes(ch)) {
        const whitespace = " \t\n".includes(ch);
        finish(!whitespace && !afterWhitespaceDelimiter);
        afterWhitespaceDelimiter = whitespace;
      } else {
        current.push({ ch, quoted: segment.quoted });
        afterWhitespaceDelimiter = false;
      }
    }
  }
  finish();
  return fields;
}

async function pathnameFields(field, state) {
  const value = field.map(({ ch }) => ch).join("");
  if (!field.some(({ ch, quoted }) => !quoted && "*?[".includes(ch))) return [value];
  const pattern = field.map(({ ch, quoted }) => {
    if (!quoted) return ch;
    if (ch === "*") return "[*]";
    if (ch === "?") return "[?]";
    if (ch === "[") return "[[]";
    return ch;
  }).join("");
  const glob = new Bun.Glob(pattern);
  // Shell pathname expansion follows a directory symlink used as an
  // intermediate path component. Bun.Glob defaults this off, which makes
  // patterns such as /sys/class/*/device silently miss sysfs class links.
  const matches = [...glob.scanSync({
    cwd: state.cwd,
    dot: false,
    onlyFiles: false,
    followSymlinks: true,
  })].sort();
  return matches.length ? matches : [value];
}

function braceFields(field) {
  let open = -1;
  for (let i = 0; i < field.length; i++) {
    if (!field[i].quoted && field[i].ch === "{") { open = i; break; }
  }
  if (open < 0) return [field];
  let depth = 0, close = -1;
  const commas = [];
  for (let i = open; i < field.length; i++) {
    if (field[i].quoted) continue;
    if (field[i].ch === "{") depth++;
    else if (field[i].ch === "}" && --depth === 0) { close = i; break; }
    else if (field[i].ch === "," && depth === 1) commas.push(i);
  }
  if (close < 0 || commas.length === 0) return [field];
  const boundaries = [open, ...commas, close];
  const output = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const replacement = field.slice(boundaries[i] + 1, boundaries[i + 1]);
    output.push(...braceFields([...field.slice(0, open), ...replacement, ...field.slice(close + 1)]));
  }
  return output;
}

export async function expandWord(word, state, options = {}) {
  const segments = [];
  for (const fragment of word.fragments) {
    const source = fragment.quote === "none" && !options.noTilde
      ? expandTildes(fragment.text, state, Boolean(options.assignment)) : fragment.text;
    if (fragment.quote === "single") {
      segments.push({text:source.replaceAll("\u0000", ""),quoted:true,splittable:false});
      continue;
    }
    const text = await expandText(source, state, fragment.quote === "double");
    let plain = "", splitDepth = 0, quoteDepth = fragment.quote === "double" ? 1 : 0;
    const flush = () => {
      if (plain) segments.push({text:plain,quoted:quoteDepth > 0,splittable:splitDepth > 0});
      plain = "";
    };
    if (fragment.quote === "double" && !text.includes("\ufdd6"))
      segments.push({text:"",quoted:true,splittable:false});
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === "\ufdd0") { flush(); splitDepth++; }
      else if (ch === "\ufdd1") { flush(); splitDepth--; }
      else if (ch === "\ufdd2") { flush(); quoteDepth++; }
      else if (ch === "\ufdd3") { flush(); quoteDepth--; }
      else if (ch === "\ufdd4") { flush(); segments.push({text:options.single ? " " : "",boundary:!options.single}); }
      else if (ch === "\ufdd5") { flush(); segments.push({text:"",quoted:true,splittable:false}); }
      else if (ch === "\ufdd6") { flush(); }
      else if (ch === "\u0000") { flush(); segments.push({text:text[++i] ?? "",quoted:true,splittable:false}); }
      else plain += ch;
    }
    flush();
  }
  if (options.single) return [segments.map(({ text }) => text).join("")];
  const fields = splitFields(segments, state);
  const output = [];
  for (const field of fields)
    for (const expanded of braceFields(field)) output.push(...(state.shellOptions.f ? [expanded.map(part=>part.ch).join("")] : await pathnameFields(expanded, state)));
  return output;
}

function splitAssignment(value) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(value);
  return match ? { name: match[1], value: match[2] } : null;
}

function bytes(value = "") {
  return value instanceof Uint8Array ? value : encoder.encode(String(value));
}

function concatBytes(parts) {
  const values = parts.map(bytes);
  const length = values.reduce((sum, value) => sum + value.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
}

function result(status = 0, stdout = "", stderr = "") {
  return { status, stdout: bytes(stdout), stderr: bytes(stderr) };
}

function quoteShellWord(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function findExecutable(name, state, defaultPath = false) {
  if (!state.pathSearch) return null;
  const path = defaultPath ? DEFAULT_COMMAND_PATH : (environmentValue(state.env, "PATH") ?? "");
  const found = Bun.which(name, { PATH: path, cwd: nativePath(state.cwd) });
  return found ? shellPath(found) : null;
}

function aliasWords(value) {
  const tokens = tokenize(value);
  if (tokens.some((token) => token.type !== "word")) return null;
  return tokens.map((token) => token.fragments
    .map((fragment) => fragment.text.replaceAll("\u0000", ""))
    .join(""));
}

function readonlyError(name) {
  return result(1, "", `bunmsh: ${name}: is read only\n`);
}

function writeStream(stream, data) {
  return new Promise((resolve, reject) => {
    stream.write(data, (error) => error ? reject(error) : resolve());
  });
}

function parsePrintEscapes(value) {
  let stop = false;
  const text = value.replace(/\\(c|n|r|t|b|a|v|\\|0[0-7]{1,3})/g, (_, code) => {
    if (code === "c") {
      stop = true;
      return "";
    }
    const map = { n: "\n", r: "\r", t: "\t", b: "\b", a: "\x07", v: "\v", "\\": "\\" };
    if (code[0] === "0") return String.fromCharCode(parseInt(code.slice(1), 8));
    return map[code] ?? code;
  });
  return { text, stop };
}

function parentDirectory(path) {
  if (path === "/") return "/";
  const end = path.endsWith("/") ? path.length - 1 : path.length;
  const separator = path.lastIndexOf("/", end - 1);
  return separator <= 0 ? "/" : path.slice(0, separator);
}

async function changeDirectory(state, target, { print = false } = {}) {
  const path = isAbsolute(nativePath(target))
    ? nativePath(target)
    : resolvePath(nativePath(state.cwd), nativePath(target));
  try {
    const resolved = shellPath(resolvePath(path));
    const stat = await Bun.file(nativePath(resolved)).stat();
    if (!stat.isDirectory())
      return result(1, "", `bunmsh: cd: ${target}: not a directory\n`);
    const previous = state.cwd;
    state.directoryHistory.push(previous);
    state.cwd = resolved;
    state.tabs[state.activeTab] = resolved;
    state.env.OLDPWD = previous;
    state.env.PWD = resolved;
    return result(0, print ? `${resolved}\n` : "");
  } catch (error) {
    return result(1, "", `bunmsh: cd: ${target}: ${error.message}\n`);
  }
}

async function previousChildDirectory(state) {
  for (let i = state.directoryHistory.length - 1; i >= 0; i--) {
    const candidate = state.directoryHistory[i];
    if (parentDirectory(candidate) !== state.cwd) continue;
    try {
      if ((await Bun.file(candidate).stat()).isDirectory())
        return changeDirectory(state, candidate);
    } catch {}
  }
  return result(1, "", "bunmsh: //: no previous child directory\n");
}

async function sourceFile(argv, state) {
  if (!argv[1]) return result(2, "", `bunmsh: ${argv[0]}: missing file operand\n`);
  let path = argv[1];
  if (!path.includes("/")) {
    const found = (environmentValue(state.env, "PATH") ?? "").split(pathDelimiter)
      .map((directory) => resolvePath(directory || state.cwd, path))
      .find((candidate) => {
        try { return statSync(candidate).isFile(); } catch { return false; }
      });
    if (found) path = found;
  } else if (!isAbsolute(path)) path = resolvePath(state.cwd, path);
  try {
    const source = await Bun.file(path).text();
    const previousArgs = state.args;
    const previousLoopDepth = state.loopDepth;
    state.loopDepth = 0;
    if (argv.length > 2) state.args = [previousArgs[0], ...argv.slice(2)];
    state.returnDepth++;
    try {
      return await execute(source, state, { capture: true });
    } finally {
      state.returnDepth--;
      state.loopDepth = previousLoopDepth;
      if (state.flow?.kind === "return") state.flow = null;
      state.args = previousArgs;
    }
  } catch (error) {
    return result(1, "", `bunmsh: ${argv[0]}: ${argv[1]}: ${error.message}\n`);
  }
}

function testStat(path, state) {
  try { return statSync(isAbsolute(path) ? path : resolvePath(state.cwd, path)); }
  catch { return null; }
}

function evaluateTest(argv, state) {
  if (argv.length === 0) return false;
  if (argv[0] === "!") return !evaluateTest(argv.slice(1), state);
  const or = argv.indexOf("-o");
  if (or >= 0) return evaluateTest(argv.slice(0, or), state) || evaluateTest(argv.slice(or + 1), state);
  const and = argv.indexOf("-a");
  if (and >= 0) return evaluateTest(argv.slice(0, and), state) && evaluateTest(argv.slice(and + 1), state);
  if (argv.length === 1) return argv[0].length > 0;
  if (argv.length === 2) {
    const [op, value] = argv;
    if (op === "-n") return value.length > 0;
    if (op === "-z") return value.length === 0;
    const stat = testStat(value, state);
    if (op === "-e") return stat !== null;
    if (op === "-f") return Boolean(stat?.isFile());
    if (op === "-d") return Boolean(stat?.isDirectory());
    if (op === "-b") return Boolean(stat?.isBlockDevice());
    if (op === "-c") return Boolean(stat?.isCharacterDevice());
    if (op === "-p") return Boolean(stat?.isFIFO());
    if (op === "-S") return Boolean(stat?.isSocket());
    if (op === "-L" || op === "-h") {
      try { return lstatSync(isAbsolute(value) ? value : resolvePath(state.cwd, value)).isSymbolicLink(); }
      catch { return false; }
    }
    if (op === "-s") return Boolean(stat && stat.size > 0);
    if (op === "-r" || op === "-w" || op === "-x") {
      try {
        const mode = op === "-r" ? fsConstants.R_OK : op === "-w" ? fsConstants.W_OK : fsConstants.X_OK;
        accessSync(isAbsolute(value) ? value : resolvePath(state.cwd, value), mode);
        return true;
      } catch { return false; }
    }
    return false;
  }
  if (argv.length === 3) {
    const [left, op, right] = argv;
    if (op === "=" || op === "==") return left === right;
    if (op === "!=") return left !== right;
    if (["-eq", "-ne", "-gt", "-ge", "-lt", "-le"].includes(op)) {
      const a = Number(left), b = Number(right);
      if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error("integer expression expected");
      return { "-eq": a === b, "-ne": a !== b, "-gt": a > b, "-ge": a >= b,
        "-lt": a < b, "-le": a <= b }[op];
    }
    const a = testStat(left, state), b = testStat(right, state);
    if (op === "-nt") return Boolean(a && (!b || a.mtimeMs > b.mtimeMs));
    if (op === "-ot") return Boolean(b && (!a || a.mtimeMs < b.mtimeMs));
    if (op === "-ef") return Boolean(a && b && a.dev === b.dev && a.ino === b.ino);
  }
  throw new Error("unsupported expression");
}

function loopControl(kind, argv, state) {
  const levels = argv[1] === undefined ? 1 : Number(argv[1]);
  if (argv.length > 2 || !Number.isInteger(levels) || levels < 1)
    return result(2, "", `bunmsh: ${kind}: expected a positive integer\n`);
  if (!state.loopDepth) return result(2, "", `bunmsh: ${kind}: not in a loop\n`);
  state.flow = { kind, levels: Math.min(levels, state.loopDepth) };
  return result();
}

function trapName(value) {
  if (value === "0" || value === "EXIT") return "EXIT";
  const name = /^\d+$/.test(value)
    ? Object.keys(osConstants.signals).find(key => osConstants.signals[key] === Number(value))
    : value.startsWith("SIG") ? value : `SIG${value}`;
  return name && osConstants.signals[name] && !["SIGKILL","SIGSTOP"].includes(name) ? name : null;
}

function setTrap(argv, state) {
  let args = argv.slice(1);
  if (args[0] === "--") args.shift();
  if (!args.length) return result(0,Object.entries(state.traps).map(([name,command]) => `trap -- ${quoteShellWord(command)} ${name === "EXIT" ? "0" : name.slice(3)}\n`).join(""));
  let action = args.shift();
  if (/^\d+$/.test(action)) { args.unshift(action); action = "-"; }
  if (!args.length) return result(2,"","bunmsh: trap: expected a signal\n");
  for (const value of args) {
    const name = trapName(value);
    if (!name) return result(2,"",`bunmsh: trap: ${value}: invalid or uncatchable signal\n`);
    const listener = state.trapListeners.get(name);
    if (listener) process.off(name,listener);
    state.trapListeners.delete(name);
    if (action === "-") { delete state.traps[name]; continue; }
    state.traps[name] = action;
    if (name !== "EXIT") {
      // Like mksh's pending-trap flag: callbacks enqueue only. Shell code
      // runs at command boundaries, never reentrantly from a signal callback.
      const handler = () => { if (state.traps[name] && !state.pendingTraps.includes(name)) state.pendingTraps.push(name); };
      process.on(name,handler);
      state.trapListeners.set(name,handler);
    }
  }
  return result();
}

async function runPendingTraps(state, io) {
  if (state.inTrap) return result();
  const stdout = [], stderr = [];
  while (state.pendingTraps.length) {
    const name = state.pendingTraps.shift();
    const source = state.traps[name];
    if (!source) continue;
    const savedStatus = state.lastStatus;
    state.inTrap = true;
    try {
      const execution = await execute(source,state,io);
      stdout.push(execution.stdout); stderr.push(execution.stderr);
    } finally { state.inTrap = false; state.lastStatus = savedStatus; }
    if (state.exitRequested) break;
  }
  return result(state.lastStatus,concatBytes(stdout),concatBytes(stderr));
}

export async function finishShell(state, status = state.lastStatus, io = {}) {
  if (state.finished) return result(status);
  state.finished = true;
  let execution = result(status);
  try {
    const handler = state.traps.EXIT;
    delete state.traps.EXIT;
    if (handler) {
      state.exitRequested = false;
      state.flow = null;
      state.lastStatus = status;
      execution = await execute(handler,state,io);
      execution.status = state.exitRequested ? state.exitStatus : status;
    }
    return execution;
  } finally {
    for (const [signal,listener] of state.trapListeners) process.off(signal,listener);
    state.trapListeners.clear();
    for (const fd of state.ownedFds) { try { closeSync(fd); } catch {} }
    state.ownedFds.clear();
    // Background processes deliberately remain unref'ed and accessible by
    // stable index in Bun.sha.procs. No waiting, killing or registry cleanup.
  }
}

function consumeLoopFlow(state) {
  if (!state.flow) return false;
  if (state.flow.kind === "return") return true;
  const kind = state.flow.kind;
  if (--state.flow.levels > 0) return true;
  state.flow = null;
  return kind === "break";
}

const builtins = {
  return: async (argv, state) => {
    if (!state.returnDepth) return result(2, "", "bunmsh: return: not in a function or sourced script\n");
    const status = argv[1] === undefined ? state.lastStatus : Number(argv[1]);
    if (argv.length > 2 || !Number.isInteger(status))
      return result(2, "", "bunmsh: return: expected an integer status\n");
    state.flow = { kind: "return" };
    return result(status & 255);
  },
  break: async (argv, state) => loopControl("break", argv, state),
  continue: async (argv, state) => loopControl("continue", argv, state),
  ":": async () => result(),
  true: async () => result(),
  false: async () => result(1),
  // Execution is handled specially by runCommand so command can alter command
  // lookup without creating another parsed command.
  command: null,
  builtin: null,
  __builtin: null,
  time: null,
  // This is handled specially by runCommandArgv because its output is
  // unbounded and therefore cannot be represented by the normal buffered
  // builtin result.
  yes: null,
  whence: async (argv, state) => {
    let pathOnly = false, verbose = false, i = 1;
    for (; i < argv.length; i++) {
      if (argv[i] === "--") { i++; break; }
      if (argv[i] === "-p") pathOnly = true;
      else if (argv[i] === "-v") verbose = true;
      else if (argv[i].startsWith("-") && argv[i] !== "-")
        return result(1, "", `bunmsh: whence: ${argv[i]}: unknown option\n`);
      else break;
    }
    let status = 0, output = "";
    for (const name of argv.slice(i)) {
      let description;
      if (pathOnly) {
        const path = findExecutable(name, state);
        description = path ? `${path}\n` : null;
      } else description = describeCommand(name, state, verbose, false);
      if (description === null || description.endsWith(" not found\n")) status = 1;
      if (description) output += description;
    }
    return result(status, output);
  },
  which: async (argv, state) => {
    let i = 1;
    if (argv[i] === "--") i++;
    if (i >= argv.length)
      return result(1, "", "bunmsh: which: missing command name\n");
    let status = 0, output = "";
    for (; i < argv.length; i++) {
      // `which` is an explicit PATH query, so it remains useful even while
      // direct command-name lookup is disabled with `tab path off`.
      const path = findExecutable(argv[i], { ...state, pathSearch: true });
      if (path) output += `${path}\n`;
      else status = 1;
    }
    return result(status, output);
  },
  type: async (argv, state) => {
    let status = 0, output = "";
    for (const name of argv.slice(1)) {
      const description = describeCommand(name, state, true, false);
      if (description.endsWith(" not found\n")) status = 1;
      output += description;
    }
    return result(status, output);
  },
  alias: async (argv, state) => {
    if (argv.length === 1) {
      const output = Object.entries(state.aliases)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, words]) => `alias ${name}=${quoteShellWord(words.join(" "))}\n`)
        .join("");
      return result(0, output);
    }
    let status = 0;
    let output = "";
    let stderr = "";
    for (const item of argv.slice(1)) {
      const equal = item.indexOf("=");
      if (equal < 0) {
        const words = state.aliases[item];
        if (words) output += `alias ${item}=${quoteShellWord(words.join(" "))}\n`;
        else {
          status = 1;
          stderr += `bunmsh: alias: ${item}: not found\n`;
        }
        continue;
      }
      const name = item.slice(0, equal);
      const words = aliasWords(item.slice(equal + 1));
      if (!name || words === null) {
        status = 1;
        stderr += `bunmsh: alias: ${name || item}: invalid alias\n`;
      } else state.aliases[name] = words;
    }
    return result(status, output, stderr);
  },
  unalias: async (argv, state) => {
    let i = 1;
    if (argv[i] === "-a") {
      state.aliases = {};
      return result();
    }
    if (argv[i] === "--") i++;
    if (i === argv.length)
      return result(1, "", "bunmsh: unalias: missing alias name\n");
    let status = 0;
    let stderr = "";
    for (; i < argv.length; i++) {
      if (Object.hasOwn(state.aliases, argv[i])) delete state.aliases[argv[i]];
      else {
        status = 1;
        stderr += `bunmsh: unalias: ${argv[i]}: not found\n`;
      }
    }
    return result(status, "", stderr);
  },
  test: async (argv, state) => {
    try { return result(evaluateTest(argv.slice(1), state) ? 0 : 1); }
    catch (error) { return result(2, "", `bunmsh: test: ${error.message}\n`); }
  },
  "[": async (argv, state) => {
    if (argv.at(-1) !== "]") return result(2, "", "bunmsh: [: missing ]\n");
    try { return result(evaluateTest(argv.slice(1, -1), state) ? 0 : 1); }
    catch (error) { return result(2, "", `bunmsh: [: ${error.message}\n`); }
  },
  echo: async (argv) => {
    let newline = true;
    let start = 1;
    if (argv[1] === "-n") {
      newline = false;
      start = 2;
    }
    return result(0, argv.slice(start).join(" ") + (newline ? "\n" : ""));
  },
  print: async (argv) => {
    let raw = false;
    let newline = true;
    let separator = " ";
    let terminator = "\n";
    let fd = 1;
    let i = 1;
    for (; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === "--") {
        i++;
        break;
      }
      if (!arg.startsWith("-") || arg === "-") break;
      if (/^-u[0-9]+$/.test(arg)) {
        fd = Number(arg.slice(2));
        continue;
      }
      for (const flag of arg.slice(1)) {
        if (flag === "r" || flag === "R") raw = true;
        else if (flag === "n") newline = false;
        else if (flag === "l") separator = "\n";
        else if (flag === "N") separator = terminator = "\0";
        else return result(1, "", `bunmsh: print: -${flag}: unsupported option\n`);
      }
    }
    let output = argv.slice(i).join(separator);
    if (!raw) {
      const expanded = parsePrintEscapes(output);
      output = expanded.text;
      if (expanded.stop) newline = false;
    }
    if (newline) output += terminator;
    if (fd === 2) return result(0, "", output);
    if (fd !== 1)
      return result(1, "", `bunmsh: print: file descriptor ${fd} is not supported yet\n`);
    return result(0, output);
  },
  printf: async (argv) => {
    if (argv.length < 2) return result(2, "", "bunmsh: printf: missing format\n");
    const format = argv[1];
    let ai = 2;
    let output = "";
    let previous;
    do {
      previous = ai;
      for (let i = 0; i < format.length; i++) {
        if (format[i] === "\\" && i + 1 < format.length) {
          const parsed = parsePrintEscapes(format.slice(i, i + 2));
          output += parsed.text;
          i++;
          continue;
        }
        if (format[i] !== "%") {
          output += format[i];
          continue;
        }
        if (format[i + 1] === "%") {
          output += "%";
          i++;
          continue;
        }
        const match = /^%([0-9]*)([sdi])/.exec(format.slice(i));
        if (!match) return result(2, "", `bunmsh: printf: unsupported format near ${format.slice(i)}\n`);
        const width = Number(match[1] || 0);
        const kind = match[2];
        const value = argv[ai++] ?? (kind === "s" ? "" : "0");
        let rendered = kind === "s" ? value : String(Number.parseInt(value, 10) || 0);
        if (width > rendered.length)
          rendered = (match[1]?.startsWith("0") ? "0" : " ").repeat(width - rendered.length) + rendered;
        output += rendered;
        i += match[0].length - 1;
      }
    } while (ai > previous && ai < argv.length);
    return result(0, output);
  },
  read: async (argv, state, input) => {
    let raw = false, i = 1;
    if (argv[i] === "-r") { raw = true; i++; }
    if (argv[i] === "--") i++;
    const names = argv.slice(i);
    if (!names.length) names.push("REPLY");
    if (names.some((name) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))
      return result(2, "", "bunmsh: read: invalid variable name\n");
    let line, gotInput;
    if (state.readLines) {
      gotInput = state.readLines.length > 0;
      line = state.readLines.shift() ?? "";
    } else if (typeof input === "number" || input == null) {
      // Like mksh's normal read mode, consume only through the delimiter.
      // A fresh buffered stream would read ahead and cancelling it can close
      // the shared descriptor, breaking subsequent reads and fd duplicates.
      const byte = Buffer.alloc(1), data = [];
      gotInput = false;
      while (true) {
        let count;
        try {
          count = input == null
            ? await new Promise((resolve,reject) => fsRead(0,byte,0,1,null,(error,n) => error ? reject(error) : resolve(n)))
            : readSync(input, byte, 0, 1, null);
        }
        catch (error) { if (error.code === "EINTR") continue; throw error; }
        if (!count) break;
        if (byte[0] === 10) { gotInput = true; break; }
        data.push(byte[0]);
      }
      line = decoder.decode(Uint8Array.from(data));
    } else {
      const reader = fallbackInput(input).getReader();
      const chunks = [];
      let foundNewline = false;
      try {
        while (!foundNewline) {
          const { value, done } = await reader.read();
          if (done) break;
          const newline = value.indexOf(10);
          chunks.push(newline < 0 ? value : value.slice(0, newline));
          foundNewline = newline >= 0;
        }
        if (foundNewline) try { await reader.cancel(); } catch {}
      } finally { try { reader.releaseLock(); } catch {} }
      line = decoder.decode(concatBytes(chunks));
      gotInput = foundNewline || chunks.length > 0;
    }
    line = line.replace(/\r$/, "");
    if (!raw) line = line.replace(/\\(.)/gs, "$1");
    const ifs = state.env.IFS ?? " \t\n";
    const escaped = ifs.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
    const fields = ifs ? line.trim().split(new RegExp(`[${escaped}]+`)) : [line];
    for (let n = 0; n < names.length; n++) {
      if (state.readonly.has(names[n])) return readonlyError(names[n]);
      state.env[names[n]] = n === names.length - 1 ? fields.slice(n).join(" ") : (fields[n] ?? "");
    }
    return result(gotInput ? 0 : 1);
  },
  pwd: async (_argv, state) => result(0, `${state.cwd}\n`),
  cd: async (argv, state) => {
    if (argv[1] === "//") return previousChildDirectory(state);
    if (argv[1] === "-") {
      if (!state.env.OLDPWD)
        return result(1, "", "bunmsh: cd: OLDPWD is not set\n");
      return changeDirectory(state, state.env.OLDPWD, { print: true });
    }
    const target = argv[1] ?? state.env.HOME;
    if (!target) return result(1, "", "bunmsh: cd: HOME is not set\n");
    return changeDirectory(state, target);
  },
  chdir: async (argv, state) => builtins.cd(["cd", ...argv.slice(1)], state),
  tab: async (argv, state) => {
    if (argv.length > 3 || (argv.length > 2 && !["mouse", "path", "s", "save"].includes(argv[1])))
      return result(1, "", "bunmsh: tab: usage: tab [n|x|c|l|r|s|save [d|dedupe]|mouse [on|off|true|false]|path [on|off|true|false]|number]\n");
    const action = argv[1];
    const activate = (index) => {
      state.activeTab = index;
      state.cwd = state.tabs[index];
      state.env.PWD = state.cwd;
    };
    if (action === "n" || (action === undefined && state.tabs.length === 1)) {
      state.tabs.push(state.cwd);
      activate(state.tabs.length - 1);
      return result();
    }
    if (action === undefined || action === "r") {
      activate((state.activeTab + 1) % state.tabs.length);
      return result();
    }
    if (action === "l") {
      activate((state.activeTab - 1 + state.tabs.length) % state.tabs.length);
      return result();
    }
    if (action === "x" || action === "c") {
      if (state.tabs.length === 1)
        return result(1, "", "bunmsh: tab: cannot close the last tab\n");
      state.tabs.splice(state.activeTab, 1);
      activate(Math.min(state.activeTab, state.tabs.length - 1));
      return result();
    }
    if (action === "s" || action === "save") {
      const modifier = argv[2];
      if (modifier !== undefined && !["d", "dedupe"].includes(modifier))
        return result(1, "", "bunmsh: tab: save: expected d or dedupe\n");
      try {
        if (modifier === undefined) {
          const path = await saveBunmshHistory(state, state.env);
          return result(0, `${shellPath(path)}\n`);
        }
        // Rewrites the whole history file to drop duplicates, unlike the
        // plain save above — see dedupeBunmshHistory for why that is only
        // safe to do as an explicit, occasional choice.
        const { path, raced, count } = await dedupeBunmshHistory(state, state.env);
        const warning = raced
          ? " (warning: another session wrote to it during cleanup; some of its entries may have been lost — rerun if needed)"
          : "";
        return result(0, `${shellPath(path)}: ${count} unique entries${warning}\n`);
      } catch (error) {
        return result(1, "", `bunmsh: tab: cannot save history: ${error.message}\n`);
      }
    }
    if (action === "mouse") {
      const mode = argv[2];
      if (mode === undefined) state.mouseTracking = !state.mouseTracking;
      else if (mode === "on" || mode === "true") state.mouseTracking = true;
      else if (mode === "off" || mode === "false") state.mouseTracking = false;
      else return result(1, "", "bunmsh: tab: mouse: expected on, off, true, or false\n");
      return result();
    }
    if (action === "path") {
      const mode = argv[2];
      if (mode === undefined) state.pathSearch = !state.pathSearch;
      else if (mode === "on" || mode === "true") state.pathSearch = true;
      else if (mode === "off" || mode === "false") state.pathSearch = false;
      else return result(1, "", "bunmsh: tab: path: expected on, off, true, or false\n");
      return result();
    }
    if (/^[1-9][0-9]*$/.test(action ?? "")) {
      const index = Number(action) - 1;
      if (index >= state.tabs.length)
        return result(1, "", `bunmsh: tab: ${action}: no such tab\n`);
      activate(index);
      return result();
    }
    return result(1, "", "bunmsh: tab: usage: tab [n|x|c|l|r|s|save|mouse [on|off|true|false]|path [on|off|true|false]|number]\n");
  },
  "-": async (_argv, state) => builtins.cd(["cd", "-"], state),
  "~": async (_argv, state) => builtins.cd(["cd"], state),
  "..": async (_argv, state) => changeDirectory(state, ".."),
  "//": async (_argv, state) => previousChildDirectory(state),
  export: async (argv, state) => {
    if (argv.length === 1 || argv.length === 2 && argv[1] === "-p") {
      const listing = Object.entries(state.env)
        .filter(([name]) => !state.shellOptions.posix || state.exported.has(name))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, value]) => `export ${name}=${JSON.stringify(value)}\n`)
        .join("");
      return result(0, listing);
    }
    for (const item of argv.slice(1)) {
      const assignment = splitAssignment(item);
      if (assignment) {
        if (state.readonly.has(assignment.name)) return readonlyError(assignment.name);
        state.env[assignment.name] = assignment.value;
      }
      else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(item))
        state.env[item] ??= "";
      else return result(1, "", `bunmsh: export: ${item}: invalid name\n`);
      state.exported.add(assignment?.name ?? item);
    }
    return result();
  },
  unset: async (argv, state) => {
    let i = 1;
    if (argv[i] === "-v" || argv[i] === "--") i++;
    for (const name of argv.slice(i)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        return result(1, "", `bunmsh: unset: ${name}: invalid name\n`);
      if (state.readonly.has(name)) return readonlyError(name);
      delete state.env[name];
      state.exported.delete(name);
    }
    return result();
  },
  readonly: async (argv, state) => {
    if (argv.length === 1 || (argv.length === 2 && argv[1] === "-p")) {
      const output = [...state.readonly].sort()
        .map((name) => `readonly ${name}=${quoteShellWord(state.env[name] ?? "")}\n`)
        .join("");
      return result(0, output);
    }
    let i = argv[1] === "--" ? 2 : 1;
    for (; i < argv.length; i++) {
      const assignment = splitAssignment(argv[i]);
      const name = assignment?.name ?? argv[i];
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        return result(1, "", `bunmsh: readonly: ${name}: invalid name\n`);
      if (assignment) {
        if (state.readonly.has(name)) return readonlyError(name);
        state.env[name] = assignment.value;
      } else state.env[name] ??= "";
      state.readonly.add(name);
    }
    return result();
  },
  env: async (argv, state, input, context = {}) => {
    let env = { ...externalEnvironment(state) };
    let i = 1;
    for (; i < argv.length; i++) {
      const item = argv[i];
      if (item === "--") { i++; break; }
      if (item === "-i" || item === "--ignore-environment") { env = {}; continue; }
      if (item === "-u" || item === "--unset") {
        const name = argv[++i];
        if (!name) return result(2, "", "bunmsh: env: option requires a name\n");
        delete env[name];
        continue;
      }
      if (item.startsWith("--unset=")) { delete env[item.slice(8)]; continue; }
      const assignment = splitAssignment(item);
      if (!assignment) break;
      env[assignment.name] = assignment.value;
    }
    if (i >= argv.length)
      return result(0, Object.entries(env).map(([k, v]) => `${k}=${v}\n`).join(""));
    const childState = {
      ...state,
      env,
      exported: new Set(Object.keys(env)),
      directoryHistory: [...state.directoryHistory],
      tabs: [...state.tabs],
      readonly: new Set(state.readonly),
    };
    return runCommandArgv(
      argv.slice(i),
      childState,
      input,
      context.captureStdout ?? true,
      context.captureStderr ?? true,
      context.options ?? {},
    );
  },
  exec: async (argv, state, input, context = {}) => {
    if (argv.length === 1) return result();
    const execution = await runCommandArgv(
      argv.slice(1), state, input,
      context.captureStdout ?? true,
      context.captureStderr ?? true,
      context.options ?? {},
    );
    state.exitRequested = true;
    state.exitStatus = execution.status;
    return execution;
  },
  exit: async (argv, state) => {
    const status = argv[1] === undefined ? state.lastStatus : Number(argv[1]);
    if (!Number.isInteger(status))
      return result(2, "", `bunmsh: exit: ${argv[1]}: numeric argument required\n`);
    state.exitRequested = true;
    state.exitStatus = status & 255;
    return result(state.exitStatus);
  },
  shift: async (argv, state) => {
    const count = argv[1] === undefined ? 1 : Number(argv[1]);
    if (!Number.isInteger(count) || count < 0)
      return result(1, "", `bunmsh: shift: ${argv[1]}: bad number\n`);
    if (count > state.args.length - 1) return result(1);
    state.args.splice(1, count);
    return result();
  },
  getopts: async (argv, state) => {
    if (argv.length < 3)
      return result(2, "", "bunmsh: getopts: usage: getopts optstring name [arg ...]\n");
    const optstring = argv[1];
    const variable = argv[2];
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable))
      return result(2, "", `bunmsh: getopts: ${variable}: invalid name\n`);
    const args = argv.length > 3 ? argv.slice(3) : state.args.slice(1);
    let index = Number(state.env.OPTIND ?? "1");
    if (!Number.isInteger(index) || index < 1) index = 1;
    let offset = state.getoptsOffset ?? 1;
    const current = args[index - 1];
    if (!current || current === "--" || !current.startsWith("-") || current === "-") {
      if (current === "--") state.env.OPTIND = String(index + 1);
      state.getoptsOffset = 1;
      return result(1);
    }
    const option = current[offset];
    const position = optstring.indexOf(option);
    const requiresArgument = position >= 0 && optstring[position + 1] === ":";
    let stderr = "";
    delete state.env.OPTARG;
    if (position < 0 || option === ":") {
      state.env[variable] = "?";
      if (optstring[0] === ":") state.env.OPTARG = option;
      else stderr = `bunmsh: getopts: -${option}: unknown option\n`;
    } else if (requiresArgument) {
      if (offset + 1 < current.length) state.env.OPTARG = current.slice(offset + 1);
      else if (index < args.length) state.env.OPTARG = args[index++];
      else {
        state.env[variable] = optstring[0] === ":" ? ":" : "?";
        if (optstring[0] === ":") state.env.OPTARG = option;
        else stderr = `bunmsh: getopts: -${option}: argument expected\n`;
        state.env.OPTIND = String(index + 1);
        state.getoptsOffset = 1;
        return result(0, "", stderr);
      }
      state.env[variable] = option;
      offset = current.length;
    } else state.env[variable] = option;
    if (offset + 1 >= current.length) {
      index++;
      offset = 1;
    } else offset++;
    state.env.OPTIND = String(index);
    state.getoptsOffset = offset;
    return result(0, "", stderr);
  },
  eval: async (argv, state) => execute(argv.slice(1).join(" "), state, { capture: true }),
  ".": async (argv, state) => sourceFile(argv, state),
  source: async (argv, state) => sourceFile(argv, state),
  realpath: async (argv, state) => {
    let output = "";
    try {
      for (const item of argv.slice(1))
        output += `${realpathSync(isAbsolute(item) ? item : resolvePath(state.cwd, item))}\n`;
      return result(0, output);
    } catch (error) {
      return result(1, "", `bunmsh: realpath: ${error.message}\n`);
    }
  },
  umask: async (argv) => {
    if (argv.length === 1) return result(0, `${process.umask().toString(8).padStart(4, "0")}\n`);
    if (argv.length !== 2 || !/^[0-7]{1,4}$/.test(argv[1]))
      return result(1, "", "bunmsh: umask: bad mask\n");
    process.umask(Number.parseInt(argv[1], 8));
    return result();
  },
  kill: async (argv) => {
    let signal = "SIGTERM";
    let i = 1;
    if (argv[i] === "-l") {
      const names = Object.keys(osConstants.signals).map((name) => name.replace(/^SIG/, ""));
      return result(0, `${names.join(" ")}\n`);
    }
    if (argv[i]?.startsWith("-") && argv[i] !== "-") {
      const value = argv[i++].slice(1).toUpperCase();
      signal = /^\d+$/.test(value) ? Number(value) : `SIG${value.replace(/^SIG/, "")}`;
    }
    if (i >= argv.length) return result(2, "", "bunmsh: kill: missing pid\n");
    let status = 0, stderr = "";
    for (; i < argv.length; i++) {
      const pid = Number(argv[i]);
      //  Signal 0 asks whether a PID can be signalled without touching it,
      //  which taskkill has no way to express — and which process.kill does
      //  answer on Windows. Everything else goes through taskkill there.
      if (process.platform === "win32" && signal !== 0) {
        if (!Number.isInteger(pid) || pid <= 0) {
          status = 1;
          stderr += `bunmsh: kill: ${argv[i]}: arguments must be process ids\n`;
          continue;
        }
        const failure = await runWindowsKill(pid);
        if (failure) { status = 1; stderr += `bunmsh: kill: ${argv[i]}: ${failure}\n`; }
        continue;
      }
      try { process.kill(pid, signal); }
      catch (error) { status = 1; stderr += `bunmsh: kill: ${argv[i]}: ${error.message}\n`; }
    }
    return result(status, "", stderr);
  },
  trap: async (argv,state) => setTrap(argv,state),
  set: async (argv, state) => {
    if (argv.length === 1)
      return result(0, Object.entries(state.env).sort().map(([k, v]) => `${k}=${JSON.stringify(v)}\n`).join(""));
    const names = {errexit:"e",nounset:"u",noglob:"f",xtrace:"x",verbose:"v",posix:"posix"};
    let i = 1;
    for (; i < argv.length; i++) {
      const item = argv[i];
      if (item === "--") { i++; break; }
      if (item === "-") {
        // Traditional set - ends options and disables verbose/xtrace. Like
        // mksh parse_args, preserve positional parameters if none follow.
        state.shellOptions.x = state.shellOptions.v = false;
        i++; break;
      }
      if (!/^[+-]/.test(item)) break;
      const enabled = item[0] === "-";
      if (item === "-o" || item === "+o") {
        if (argv[i+1] === undefined) return result(0,Object.entries(names).map(([name,key]) => enabled ? `${name} ${state.shellOptions[key] ? "on" : "off"}\n` : `set ${state.shellOptions[key] ? "-" : "+"}o ${name}\n`).join(""));
        const name = argv[++i];
        if (!names[name]) return result(2,"",`bunmsh: set: unknown option ${name}\n`);
        state.shellOptions[names[name]] = enabled;
      } else {
        for (const key of item.slice(1)) {
          if (!"eufxv".includes(key)) return result(2,"",`bunmsh: set: unknown option ${key}\n`);
          state.shellOptions[key] = enabled;
        }
      }
    }
    if (i < argv.length || argv.at(-1) === "--") state.args = [state.args[0],...argv.slice(i)];
    return result();
  },
};

const runFindBuiltin = async (argv, state) => {
  const output = await runFind(argv, state, process.platform, (command) =>
    runCommandArgv(command, state, null, true, true));
  return result(output.status, output.stdout, output.stderr);
};

if (findIsRegularBuiltin()) builtins.find = runFindBuiltin;

// These are used only when PATH does not provide an executable of the same
// name. `builtin name` can still select them explicitly.
export function bunShellFallbackArgv(argv) {
  let commandArgv = argv;
  if (argv[0] === "ls")
    commandArgv = commandArgv.filter((value, index) => index === 0 || value !== "--color=auto");
  if (["mv", "rm"].includes(argv[0]) && argv.includes("--")) {
    const end = argv.indexOf("--");
    // Bun.$ mv/rm do not accept --. Protect option-looking path operands when
    // removing the delimiter, so a filename cannot become an option.
    commandArgv = [...argv.slice(0, end), ...argv.slice(end + 1).map(value =>
      value.startsWith("-") ? `./${value}` : value)];
  }
  if (argv[0] === "cp")
    commandArgv = commandArgv.map((value, index) =>
      index > 0 && /^-[^-]/.test(value) ? `-${value.slice(1).replaceAll("r", "R")}` : value);
  return commandArgv;
}

async function runBunShellFallback(argv, state) {
  if (argv[0] === "mkdir") {
    const flags = argv.slice(1).filter(arg => /^-[pv]+$/.test(arg) || ["--parents","--vebose"].includes(arg));
    const operands = argv.slice(1).filter(arg => !flags.includes(arg));
    // Bun.$ starts sibling mkdir operands concurrently. POSIX callers can
    // pass parent then child without -p, so preserve operand order here.
    if (operands.length > 1 && operands.every(arg => !arg.startsWith("-") || arg === "-")) {
      const output = [], errors = []; let status = 0;
      for (const operand of operands) {
        const r = await runBunShellFallback(["mkdir",...flags,operand],state);
        status ||= r.status; output.push(r.stdout); errors.push(r.stderr);
      }
      return result(status,concatBytes(output),concatBytes(errors));
    }
  }
  // GNU/POSIX rm -f ignores nonexistent operands, including the empty name.
  // Bun.$ instead resolves that empty name to cwd and reports a directory.
  if (argv[0] === "rm") {
    const delimiter = argv.indexOf("--");
    const options = argv.slice(1, delimiter < 0 ? undefined : delimiter)
      .filter(arg => /^-[frRi]+$/.test(arg)).join("");
    if (options.lastIndexOf("f") > options.lastIndexOf("i"))
      argv = argv.filter((arg, index) => index === 0 || arg !== "");
  }
  // Bun.$ rejects an empty operand list even with rm -f. Autoconf probes it.
  const rmFlags = argv.at(-1) === "--" ? argv.slice(1, -1) : argv.slice(1);
  if (argv[0] === "rm" && rmFlags.every(arg => /^-[frRi]+$/.test(arg)) &&
      rmFlags.join("").lastIndexOf("f") > rmFlags.join("").lastIndexOf("i")) return result();
  const shell = Bun.$`${bunShellFallbackArgv(argv)}`
    .cwd(nativePath(state.cwd))
    .env(externalEnvironment(state))
    .nothrow();
  if (state.pipelineChild) {
    const output = await shell;
    return result(output.exitCode);
  }
  const output = await shell.quiet();
  return result(output.exitCode, output.stdout, output.stderr);
}

async function runFancyLsFallback(argv, state) {
  const output = fancyLs(argv, state);
  return result(output.status, output.stdout, output.stderr);
}

async function runBunShellCpFallback(argv, state) {
  let preserve=false, verbose=false, end=false;
  const files=[], unsupported=[];
  for(const arg of argv.slice(1)) {
    if(!end&&arg==='--'){end=true;continue;}
    if(!end&&arg.startsWith('-')&&arg!=='-') {
      for(const flag of arg.slice(1)) {
        if(flag==='p')preserve=true;
        else if(flag==='v')verbose=true;
        else unsupported.push(flag);
      }
    } else files.push(arg);
  }
  if(preserve) {
    if(unsupported.length)return result(1,'',`bunmsh: cp: unsupported option with -p: -${unsupported[0]}\n`);
    if(files.length<2)return result(1,'','bunmsh: cp: missing file operand\n');
    const destination=resolvePath(nativePath(state.cwd),nativePath(files.pop()));
    let directory=false;
    try {directory=statSync(destination).isDirectory();}catch(error){if(error.code!=='ENOENT')return result(1,'',`bunmsh: cp: ${error.message}\n`);}
    if(files.length>1&&!directory)return result(1,'','bunmsh: cp: destination must be a directory\n');
    let stdout='',stderr='',status=0;
    for(const file of files)try {
      const source=resolvePath(nativePath(state.cwd),nativePath(file));
      const target=directory?resolvePath(destination,pathBasename(source)):destination;
      const info=statSync(source);
      if(!info.isFile())throw new Error(`-p currently requires a regular file: ${file}`);
      let previous;try{previous=statSync(target);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(previous?.dev===info.dev&&previous?.ino===info.ino)throw new Error(`${file} and destination are the same file`);
      copyFileSync(source,target);
      const copied=statSync(target);
      if(copied.uid!==info.uid||copied.gid!==info.gid)chownSync(target,info.uid,info.gid);
      chmodSync(target,info.mode&0o7777);
      utimesSync(target,info.atime,info.mtime);
      if(verbose)stdout+=`'${file}' -> '${target}'\n`;
    }catch(error){status=1;stderr+=`bunmsh: cp: ${error.message}\n`;}
    return result(status,stdout,stderr);
  }
  const cmd = IS_COMPILED
    ? [...EXECUTABLE_COMMAND, "--bun-shell-fallback", ...bunShellFallbackArgv(argv)]
    : [...BUN_RUNTIME_COMMAND, BUNMSH_ENTRY, "--bun-shell-fallback", ...bunShellFallbackArgv(argv)];
  const proc = Bun.spawn({
    cmd,
    cwd: nativePath(state.cwd),
    env: {
      ...externalEnvironment(state),
      BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1",
    },
    stdin: "inherit",
    stdout: state.pipelineChild ? "inherit" : "pipe",
    stderr: state.pipelineChild ? "inherit" : "pipe",
  });
  if (state.pipelineChild) return result(await proc.exited);
  const [status, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).arrayBuffer(),
  ]);
  return result(status, new Uint8Array(stdout), new Uint8Array(stderr));
}

async function runReflectedProcess(cmd, state) {
  const inherit = state.pipelineChild || Boolean(process.stdout.isTTY);
  try {
    const proc = Bun.spawn({
      cmd,
      cwd: nativePath(state.cwd),
      env: externalEnvironment(state),
      stdin: "inherit",
      stdout: inherit ? "inherit" : "pipe",
      stderr: inherit ? "inherit" : "pipe",
    });
    if (inherit) return result(await proc.exited);
    const [status, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).arrayBuffer(),
    ]);
    return result(status, new Uint8Array(stdout), new Uint8Array(stderr));
  } catch (error) {
    return result(127, "", `bunmsh: ${cmd[0]}: ${error.message}\n`);
  }
}

function runBunmshFallback(argv, state) {
  const cmd = IS_COMPILED
    ? [...EXECUTABLE_COMMAND, ...argv.slice(1)]
    : [...BUN_RUNTIME_COMMAND, BUNMSH_ENTRY, ...argv.slice(1)];
  return runReflectedProcess(cmd, state);
}

function runBunFallback(argv, state) {
  if (!IS_COMPILED)
    return runReflectedProcess([...BUN_RUNTIME_COMMAND, ...argv.slice(1)], state);
  const executable = process.argv0.includes("/") || process.argv0.includes("\\")
    ? process.argv0
    : (Bun.which(process.argv0) || process.argv0);
  return runReflectedProcess([executable, ...argv.slice(1)], state);
}

export async function executeBunShellFallback(argv) {
  const output = await Bun.$`${argv}`.nothrow();
  return output.exitCode;
}

async function runCatFallback(argv, state, input) {
  const parsed = parseCatOperands(argv, "cat");
  if (parsed.error) return result(1, "", parsed.error);
  const operands = parsed.operands;

  const chunks = [];
  let status = 0;
  let stderr = "";
  // A subprocess still needs shell-level descriptor routing for redirects.
  const endpoint = state.fdBindings?.[1] ?? {channel:1};
  const writer = state.pipelineChild && endpoint.channel === 1 &&
    endpoint.fd === undefined && !endpoint.closed ? Bun.stdout.writer() : null;
  const emit = async (chunk) => {
    if (writer) {
      writer.write(chunk);
      await writer.flush();
    } else chunks.push(bytes(chunk));
  };

  try {
    for (const operand of operands) {
      try {
        const stream = operand === "-"
          ? (input instanceof ReadableStream ? input : Bun.stdin.stream())
          : Bun.file(nativePath(isAbsolute(nativePath(operand))
            ? operand
            : resolvePath(nativePath(state.cwd), nativePath(operand)))).stream();
        for await (const chunk of stream) await emit(chunk);
      } catch (error) {
        status = 1;
        stderr += `bunmsh: cat: ${operand}: ${error.message}\n`;
      }
    }
  } finally {
    if (writer) {
      try { writer.end(); } catch {}
    }
  }
  return result(status, writer ? "" : concatBytes(chunks), stderr);
}

function fallbackInput(input) {
  return input instanceof ReadableStream ? input : Bun.stdin.stream();
}

async function readFallbackInput(input) {
  return new Uint8Array(await new Response(fallbackInput(input)).arrayBuffer());
}

async function readFallbackFiles(operands, state, input) {
  if (operands.length === 0 || (operands.length === 1 && operands[0] === "-"))
    return readFallbackInput(input);
  const parts = [];
  for (const operand of operands) {
    if (operand === "-") parts.push(await readFallbackInput(input));
    else {
      const path = isAbsolute(nativePath(operand))
        ? nativePath(operand)
        : resolvePath(nativePath(state.cwd), nativePath(operand));
      parts.push(new Uint8Array(await Bun.file(path).arrayBuffer()));
    }
  }
  return concatBytes(parts);
}

async function runTacFallback(argv, state, input) {
  let operands = argv.slice(1);
  if (operands[0] === "--") operands = operands.slice(1);
  if (operands.some((value) => value.startsWith("-") && value !== "-"))
    return result(1, "", "bunmsh: tac: options are not supported\n");
  if (operands.length === 0) operands = ["-"];

  const output = [];
  let status = 0;
  let stderr = "";
  for (const operand of operands) {
    try {
      const data = await readFallbackFiles([operand], state, input);
      const records = [];
      let start = 0;
      for (let i = 0; i < data.byteLength; i++) {
        if (data[i] !== 10) continue;
        records.push(data.slice(start, i + 1));
        start = i + 1;
      }
      if (start < data.byteLength) records.push(data.slice(start));
      records.reverse();
      output.push(concatBytes(records));
    } catch (error) {
      status = 1;
      stderr += `bunmsh: tac: ${operand}: ${error.message}\n`;
    }
  }
  return result(status, concatBytes(output), stderr);
}

async function runHeadFallback(argv, state, input) {
  let count = 10, i = 1, bytesMode = false;
  if (argv[i] === "-n") count = Number(argv[++i]), i++;
  else if (argv[i] === "-c") bytesMode = true, count = Number(argv[++i]), i++;
  else if (/^-c\d+$/.test(argv[i] ?? "")) bytesMode = true, count = Number(argv[i++].slice(2));
  else if (/^-\d+$/.test(argv[i] ?? "")) count = Number(argv[i++].slice(1));
  if (!Number.isInteger(count) || count < 0)
    return result(1, "", "bunmsh: head: invalid line count\n");
  const operands = argv.slice(i);
  if (operands.length) {
    const output = [];
    let status = 0, stderr = "";
    for (const operand of operands) {
      if (operands.length > 1)
        output.push(`${output.length ? "\n" : ""}==> ${operand} <==\n`);
      try {
        const data = await readFallbackFiles([operand], state, input);
        output.push(bytesMode
          ? data.slice(0, count)
          : decoder.decode(data).split(/(?<=\n)/).slice(0, count).join(""));
      } catch (error) { status = 1; stderr += `bunmsh: head: ${operand}: ${error.message}\n`; }
    }
    return result(status, concatBytes(output), stderr);
  }
  const reader = fallbackInput(input).getReader();
  const output = [];
  let lines = 0;
  try {
    let totalBytes = 0;
    while (bytesMode ? totalBytes < count : lines < count) {
      const { value, done } = await reader.read();
      if (done) break;
      let end = bytesMode ? Math.min(value.byteLength, count - totalBytes) : value.byteLength;
      if (!bytesMode) for (let j = 0; j < value.byteLength; j++) {
        if (value[j] === 10 && ++lines >= count) { end = j + 1; break; }
      }
      output.push(value.slice(0, end));
      totalBytes += end;
      if (end < value.byteLength) break;
    }
  } finally {
    try { await reader.cancel(); } catch {}
  }
  return result(0, concatBytes(output));
}

async function runUniqFallback(argv, state, input) {
  let count = false, repeated = false, single = false, i = 1;
  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") { i++; break; }
    if (arg === "-" || !arg.startsWith("-")) break;
    if (!/^-[cdu]+$/.test(arg)) return result(1, "", `bunmsh: uniq: unsupported option: ${arg}\n`);
    count ||= arg.includes("c"); repeated ||= arg.includes("d"); single ||= arg.includes("u");
  }
  const operands = argv.slice(i);
  if (operands.length > 2) return result(1, "", "bunmsh: uniq: too many operands\n");
  try {
    const data = await readFallbackFiles([operands[0] ?? "-"], state, input);
    const output = [];
    let previous = null, occurrences = 0;
    const emit = () => {
      if (previous === null || (repeated && occurrences === 1) || (single && occurrences !== 1)) return;
      if (count) output.push(String(occurrences).padStart(7) + " ");
      output.push(previous, "\n");
    };
    for (let start = 0; start < data.length;) {
      const newline = data.indexOf(10, start);
      const end = newline < 0 ? data.length : newline;
      const line = data.subarray(start, end);
      if (previous !== null && previous.length === line.length && line.every((b, j) => b === previous[j])) occurrences++;
      else { emit(); previous = line; occurrences = 1; }
      start = end + 1;
    }
    emit();
    const bytes = concatBytes(output);
    if (operands[1] && operands[1] !== "-") {
      writeFileSync(resolvePath(state.cwd, operands[1]), bytes);
      return result(0);
    }
    return result(0, bytes);
  } catch (error) { return result(1, "", `bunmsh: uniq: ${error.message}\n`); }
}

async function runTextFilter(argv, state, input, kind) {
  try {
    let args = argv.slice(1), reverse = false, numeric = false, unique = false;
    let tailCount = 10, tailFromStart = false;
    if (kind === "tail") {
      if (args[0] === "-n") {
        const count = args[1] ?? "";
        tailFromStart = /^\+\d+$/.test(count);
        tailCount = Number(count);
        args = args.slice(2);
      } else if (/^-n\+\d+$/.test(args[0] ?? "")) {
        tailFromStart = true;
        tailCount = Number(args.shift().slice(2));
      }
      else if (/^-\d+$/.test(args[0] ?? "")) tailCount = Number(args.shift().slice(1));
      if (!Number.isInteger(tailCount) || tailCount < 0)
        return result(1, "", "bunmsh: tail: invalid line count\n");
    }
    if (kind === "sort") {
      while (args[0]?.startsWith("-") && args[0] !== "-") {
        const option = args.shift();
        reverse ||= option.includes("r"); numeric ||= option.includes("n"); unique ||= option.includes("u");
      }
    }
    if (kind === "tail") {
      const operands = args.length ? args : ["-"];
      const output = [];
      let status = 0, stderr = "";
      for (const operand of operands) {
        try {
          const text = decoder.decode(await readFallbackFiles([operand], state, input));
          const lines = text.split("\n");
          const trailing = lines.at(-1) === "";
          if (trailing) lines.pop();
          const selected = tailFromStart
            ? lines.slice(Math.max(0, tailCount - 1))
            : tailCount === 0 ? [] : lines.slice(-tailCount);
          if (operands.length > 1 && (tailFromStart || tailCount !== 0))
            output.push(`${output.length ? "\n" : ""}==> ${operand === "-" ? "standard input" : operand} <==\n`);
          if (selected.length) output.push(`${selected.join("\n")}${trailing ? "\n" : ""}`);
        } catch (error) { status = 1; stderr += `bunmsh: tail: ${operand}: ${error.message}\n`; }
      }
      return result(status, output.join(""), stderr);
    }
    const text = decoder.decode(await readFallbackFiles(args, state, input));
    let lines = text.split("\n");
    if (lines.at(-1) === "") lines.pop();
    lines.sort((a, b) => numeric ? Number(a) - Number(b) : a.localeCompare(b));
    if (unique) lines = lines.filter((line, index) => index === 0 || line !== lines[index - 1]);
    if (reverse) lines.reverse();
    return result(0, lines.length ? `${lines.join("\n")}\n` : "");
  } catch (error) { return result(1, "", `bunmsh: ${kind}: ${error.message}\n`); }
}

async function runWcFallback(argv, state, input) {
  let flags = "", i = 1;
  while (/^-[lwc]+$/.test(argv[i] ?? "")) flags += argv[i++].slice(1);
  if (!flags) flags = "lwc";
  const operands = argv.slice(i);
  const files = operands.length ? operands : ["-"];
  const rows = [];
  let status = 0, stderr = "";
  let totalBytes = 0;
  for (const operand of files) try {
    const data = await readFallbackFiles([operand], state, input);
    const text = decoder.decode(data);
    const values = [];
    if (flags.includes("l")) values.push((text.match(/\n/g) ?? []).length);
    if (flags.includes("w")) values.push(text.trim() ? text.trim().split(/\s+/).length : 0);
    if (flags.includes("c")) values.push(data.byteLength);
    totalBytes += data.byteLength;
    rows.push({ values, operand });
  } catch (error) { status = 1; stderr += `bunmsh: wc: ${operand}: ${error.message}\n`; }
  if (operands.length > 1 && rows.length)
    rows.push({ values: rows.reduce((total, row) => total.map((n, index) => n + row.values[index]),
      rows[0].values.map(() => 0)), operand: "total" });
  const width = operands.length > 1 ? String(totalBytes).length : 0;
  return result(status, rows.map(({ values, operand }) =>
    `${values.map((value) => String(value).padStart(width)).join(" ")}${operands.length ? ` ${operand}` : ""}\n`).join(""), stderr);
}

function expandTrSet(value) {
  const escapes = { a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", "\\": "\\" };
  const characters = [];
  for (let i = 0; i < value.length; i++) {
    if (value[i] !== "\\") {
      characters.push(value[i]);
      continue;
    }
    const octal = value.slice(i + 1).match(/^[0-7]{1,3}/)?.[0];
    if (octal) {
      characters.push(String.fromCharCode(Number.parseInt(octal, 8)));
      i += octal.length;
      continue;
    }
    const escaped = value[++i];
    characters.push(escapes[escaped] ?? escaped ?? "\\");
  }

  let output = "";
  for (let i = 0; i < characters.length; i++) {
    if (i + 2 < characters.length && characters[i + 1] === "-") {
      const first = characters[i].charCodeAt(0);
      const last = characters[i + 2].charCodeAt(0);
      if (first <= last) {
        for (let code = first; code <= last; code++) output += String.fromCharCode(code);
        i += 2;
        continue;
      }
    }
    output += characters[i];
  }
  return output;
}

async function runTrFallback(argv, _state, input) {
  let del = false, squeeze = false, i = 1;
  while (argv[i]?.startsWith("-") && argv[i] !== "-") {
    const option = argv[i++];
    if (option === "--") break;
    if (!/^-[ds]+$/.test(option)) return result(1, "", `bunmsh: tr: unsupported option: ${option}\n`);
    del ||= option.includes("d"); squeeze ||= option.includes("s");
  }
  const operands = argv.slice(i);
  const count = del ? (squeeze ? 2 : 1) : (squeeze && operands.length === 1 ? 1 : 2);
  if (operands.length !== count) return result(1, "", "bunmsh: tr: wrong number of operands\n");
  const from = expandTrSet(operands[0]);
  const to = expandTrSet(operands[1] ?? "");
  const translate = !del && operands.length === 2;
  if (translate && !to) return result(1, "", "bunmsh: tr: empty translation set\n");
  const squeezed = new Set(operands.length === 2 ? to : from);
  const text = decoder.decode(await readFallbackInput(input));
  let output = "", previous;
  for (const ch of text) {
    const index = from.indexOf(ch);
    if (del && index >= 0) continue;
    const value = translate && index >= 0 ? to[Math.min(index, to.length - 1)] : ch;
    if (squeeze && value === previous && squeezed.has(value)) continue;
    output += value; previous = value;
  }
  return result(0, output);
}

//  `curl` only ever runs when the system has none, so it inherits the
//  streaming rules the other fallbacks use: write straight through when the
//  bytes are headed for the terminal or a pipeline stage, buffer when the
//  caller is capturing them.
async function runCurlFallback(argv, state, input, context = {}) {
  const streamStdout = state.pipelineChild ||
    (!context.captureStdout && !context.options?.stdoutSink);
  const streamStderr = state.pipelineChild || !context.captureStderr;
  const stdout = [];
  const stderr = [];
  const io = {
    cwd: nativePath(state.cwd),
    env: externalEnvironment(state),
    stdoutIsTTY: streamStdout && Boolean(process.stdout.isTTY),
    readStdin: () => readFallbackInput(input),
    async writeStdout(chunk) {
      const data = bytes(chunk);
      if (streamStdout) await writeStream(process.stdout, data); else stdout.push(data);
    },
    async writeStderr(text) {
      const data = bytes(text);
      if (streamStderr) await writeStream(process.stderr, data); else stderr.push(data);
    },
  };
  try {
    const status = await runCurl(argv, io);
    return result(status, concatBytes(stdout), concatBytes(stderr));
  } catch (error) {
    return result(2, concatBytes(stdout), concatBytes([...stderr, bytes(`curl: ${error.message}\n`)]));
  }
}

async function runTeeFallback(argv, state, input) {
  let append = false, i = 1;
  if (argv[i] === "-a") append = true, i++;
  const streams = argv.slice(i).map((name) => createWriteStream(
    isAbsolute(nativePath(name)) ? nativePath(name) : resolvePath(nativePath(state.cwd), nativePath(name)),
    { flags: append ? "a" : "w" },
  ));
  const output = [];
  try {
    for await (const chunk of fallbackInput(input)) {
      const data = bytes(chunk);
      if (state.pipelineChild) await writeStream(process.stdout, data); else output.push(data);
      await Promise.all(streams.map((stream) => writeStream(stream, data)));
    }
  } finally { for (const stream of streams) stream.end(); }
  return result(0, state.pipelineChild ? "" : concatBytes(output));
}

async function runHashFallback(argv, state, input, algorithm) {
  const operands = argv.slice(1);
  const output = [];
  let status = 0, stderr = "";
  for (const operand of operands.length ? operands : ["-"]) try {
    const data = await readFallbackFiles([operand], state, input);
    const digest = createHash(algorithm).update(data).digest("hex");
    output.push(`${digest}  ${operand}\n`);
  } catch (error) { status = 1; stderr += `bunmsh: ${algorithm}sum: ${operand}: ${error.message}\n`; }
  return result(status, output.join(""), stderr);
}

function runMktempFallback(argv, state) {
  const directory = argv.includes("-d");
  const template = argv.find((value, index) => index > 0 && !value.startsWith("-")) ?? "tmp.XXXXXX";
  if (!template.endsWith("XXXXXX")) return result(1, "", "bunmsh: mktemp: template must end in XXXXXX\n");
  const prefix = template.slice(0, -6);
  for (let attempt = 0; attempt < 100; attempt++) {
    const suffix = Math.random().toString(36).slice(2, 8).padEnd(6, "0");
    const shown = `${prefix}${suffix}`;
    const path = isAbsolute(nativePath(shown)) ? nativePath(shown) : resolvePath(nativePath(state.cwd), nativePath(shown));
    try {
      if (directory) mkdirSync(path); else closeSync(openSync(path, "wx", 0o600));
      return result(0, `${shellPath(path)}\n`);
    } catch (error) { if (error.code !== "EEXIST") return result(1, "", `bunmsh: mktemp: ${error.message}\n`); }
  }
  return result(1, "", "bunmsh: mktemp: cannot create temporary file\n");
}

async function runSleepFallback(argv) {
  if (argv.length !== 2) return result(1, "", "bunmsh: sleep: usage: sleep duration\n");
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(argv[1]);
  if (!match) return result(1, "", `bunmsh: sleep: invalid duration: ${argv[1]}\n`);
  const scale = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2] ?? "s"];
  await Bun.sleep(Number(match[1]) * scale);
  return result();
}

function runRmdirFallback(argv, state) {
  let parents = false, operands = argv.slice(1);
  if (operands[0] === "-p" || operands[0] === "--parents") parents = true, operands.shift();
  if (!operands.length) return result(1, "", "bunmsh: rmdir: missing operand\n");
  let status = 0, stderr = "";
  for (const operand of operands) {
    let path = isAbsolute(nativePath(operand)) ? nativePath(operand) : resolvePath(nativePath(state.cwd), nativePath(operand));
    try {
      rmdirSync(path);
      if (parents) {
        let parent = pathDirname(path);
        while (parent !== path) {
          try { rmdirSync(parent); } catch { break; }
          path = parent;
          parent = pathDirname(path);
        }
      }
    } catch (error) { status = 1; stderr += `bunmsh: rmdir: ${operand}: ${error.message}\n`; }
  }
  return result(status, "", stderr);
}

function runDateFallback(argv) {
  const date = new Date();
  if (argv.length === 1) return result(0, `${date.toString()}\n`);
  if (argv.length !== 2 || !argv[1].startsWith("+"))
    return result(1, "", "bunmsh: date: only +FORMAT is supported\n");
  const pad = (value) => String(value).padStart(2, "0");
  const values = {
    "%Y": date.getFullYear(), "%m": pad(date.getMonth() + 1), "%d": pad(date.getDate()),
    "%H": pad(date.getHours()), "%M": pad(date.getMinutes()), "%S": pad(date.getSeconds()),
    "%s": Math.floor(date.getTime() / 1000), "%F": `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    "%T": `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`, "%%": "%",
  };
  return result(0, `${argv[1].slice(1).replace(/%[YmdHMSsFT%]/g, (key) => values[key])}\n`);
}

function grepFiles(operands, state, recursive) {
  const output = [];
  const visit = (shown) => {
    const path = isAbsolute(nativePath(shown))
      ? nativePath(shown)
      : resolvePath(nativePath(state.cwd), nativePath(shown));
    const stat = statSync(path);
    if (!stat.isDirectory()) { output.push({ shown, path }); return; }
    if (!recursive) throw new Error(`${shown}: is a directory`);
    for (const entry of readdirSync(path, { withFileTypes: true }))
      visit(`${shown.replace(/\/$/, "")}/${entry.name}`);
  };
  for (const operand of operands) visit(operand);
  return output;
}

function grepBasicRegex(pattern) {
  let output = "", inClass = false, branchStart = true;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (!inClass && ch === "\\" && i + 1 < pattern.length) {
      const next=pattern[++i];
      output += "+?|(){}".includes(next) ? next : `\\${next}`;
      branchStart = next === "(" || next === "|";
      continue;
    }
    if (!inClass && ch === "$") {
      const anchored = i === pattern.length-1 || pattern.startsWith("\\)",i+1) || pattern.startsWith("\\|",i+1);
      output += anchored ? "$" : "\\$";
    } else if (!inClass && ch === "^") output += branchStart ? "^" : "\\^";
    else if (!inClass && "+?|(){}".includes(ch)) output += `\\${ch}`;
    else output += ch;
    if (ch === "[") inClass = true;
    else if (ch === "]" && inClass) inClass = false;
    branchStart=false;
  }
  return output;
}

function grepPosixClasses(pattern) {
  const classes = {
    alnum: "A-Za-z0-9", alpha: "A-Za-z", blank: " \\t", digit: "0-9",
    lower: "a-z", space: "\\s", upper: "A-Z", word: "A-Za-z0-9_",
    xdigit: "A-Fa-f0-9",
  };
  return pattern.replace(/\[\[:(alnum|alpha|blank|digit|lower|space|upper|word|xdigit):\]\]/g,
    (_match, name) => `[${classes[name]}]`);
}

async function runGrepFallback(argv, state, input, context = {}) {
  let flags = "", colorMode = "never", i = 1;
  const patterns=[];
  while (argv[i]?.startsWith("-") && argv[i] !== "-") {
    if (argv[i] === "--") { i++; break; }
    const colorOption = /^--colou?r(?:=(always|auto|never))?$/.exec(argv[i]);
    if (colorOption) {
      colorMode = colorOption[1] ?? "always";
      i++;
      continue;
    }
    if (argv[i] === "-e" || argv[i].startsWith("-e")) {
      const option=argv[i++]; const pattern=option.length>2 ? option.slice(2) : argv[i++];
      if (pattern === undefined) return result(2,"","bunmsh: grep: -e requires a pattern\n");
      patterns.push(...pattern.split("\n")); continue;
    }
    if (!/^-[EFiqvnorxc]+$/.test(argv[i]))
      return result(2, "", `bunmsh: grep: unsupported option: ${argv[i]}\n`);
    flags += argv[i++].slice(1);
  }
  if (!patterns.length) {
    const pattern=argv[i++];
    if (pattern === undefined) return result(2,"","bunmsh: grep: missing pattern\n");
    patterns.push(...pattern.split("\n"));
  }
  let regex;
  const regexSource=patterns.map(pattern => flags.includes("F")
    ? pattern.replace(/[\\^$.*+?()[\]{}|]/g,"\\$&")
    : grepPosixClasses(flags.includes("E") ? pattern : grepBasicRegex(pattern))).map(p=>`(?:${p})`).join("|");
  try { regex = new RegExp(flags.includes("x") ? `^(?:${regexSource})$` : regexSource, `${flags.includes("i") ? "i" : ""}${flags.includes("o") ? "g" : ""}`); }
  catch (error) { return result(2, "", `bunmsh: grep: ${error.message}\n`); }
  const invert = flags.includes("v"), quiet = flags.includes("q"), numbers = flags.includes("n"), only = flags.includes("o");
  const color = colorMode === "always" ||
    (colorMode === "auto" && !context.captureStdout && Boolean(process.stdout.isTTY));
  const red = "\x1b[01;31m", reset = "\x1b[m";
  const colored = (value) => color && value.length ? `${red}${value}${reset}` : value;
  const highlightRegex = color && !only
    ? new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`)
    : null;
  let matched = false, count = 0;
  const output = [];
  const processLine = (line, lineNumber, label, showLabel) => {
    regex.lastIndex = 0;
    const isMatch = regex.test(line);
    regex.lastIndex = 0;
    if (isMatch === invert) return false;
    matched = true; count++;
    if (quiet) return true;
    if (flags.includes("c")) return false;
    const prefix = `${showLabel ? `${label}:` : ""}${numbers ? `${lineNumber}:` : ""}`;
    if (only) {
      if (invert) return false;
      for (const match of line.matchAll(regex))
        if (match[0].length) output.push(`${prefix}${colored(match[0])}\n`);
    } else {
      const rendered = !invert && highlightRegex
        ? line.replace(highlightRegex, (match) => colored(match))
        : line;
      output.push(`${prefix}${rendered}\n`);
    }
    return false;
  };

  const operands = argv.slice(i);
  const implicitCwd = !operands.length && flags.includes("r");
  if (implicitCwd) operands.push(".");
  if (operands.length) {
    try {
      const files = grepFiles(operands, state, flags.includes("r"));
      const showLabel = files.length > 1 || flags.includes("r");
      for (const file of files) {
        count=0;
        const lines = (await Bun.file(file.path).text()).split("\n");
        if (lines.at(-1) === "") lines.pop();
        for (let line = 0; line < lines.length; line++)
          if (processLine(lines[line], line + 1,
            implicitCwd ? file.shown.replace(/^\.\//, "") : file.shown, showLabel)) return result(0);
        if (flags.includes("c")) output.push(`${showLabel ? `${file.shown}:` : ""}${count}\n`);
      }
    } catch (error) { return result(2, "", `bunmsh: grep: ${error.message}\n`); }
  } else {
    const reader = fallbackInput(input).getReader();
    const decode = new TextDecoder();
    let pending = "", lineNumber = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        pending += decode.decode(value, { stream: !done });
        const lines = pending.split("\n");
        pending = done ? "" : lines.pop();
        if (done && lines.at(-1) === "") lines.pop();
        for (const line of lines)
          if (processLine(line, ++lineNumber, "", false)) { await reader.cancel(); return result(0); }
        if (done) break;
      }
    } finally { try { reader.releaseLock(); } catch {} }
  }
  if (!operands.length && flags.includes("c") && !quiet) output.push(`${count}\n`);
  return result(matched ? 0 : 1, output.join(""));
}

async function runSedFallback(argv, state, input) {
  let quiet = false, extended = false, inPlace = false, i = 1;
  const scripts = [];
  while (i < argv.length && argv[i].startsWith("-") && argv[i] !== "-") {
    const option = argv[i++];
    if (option === "--") break;
    if (option === "-e") {
      if (i >= argv.length) return result(1, "", "bunmsh: sed: option requires an argument: -e\n");
      scripts.push(argv[i++]);
      continue;
    }
    if (option.startsWith("-e")) { scripts.push(option.slice(2)); continue; }
    if (option.startsWith("-f")) {
      const file=option.length>2 ? option.slice(2) : argv[i++];
      if (file === undefined) return result(1,"","bunmsh: sed: -f requires a file\n");
      try { scripts.push(readFileSync(resolvePath(nativePath(state.cwd),nativePath(file)),"utf8")); }
      catch(error) { return result(1,"",`bunmsh: sed: ${error.message}\n`); }
      continue;
    }
    if (!/^-[nEri]+$/.test(option))
      return result(1, "", `bunmsh: sed: unsupported option: ${option}\n`);
    quiet ||= option.includes("n");
    extended ||= option.includes("E") || option.includes("r");
    inPlace ||= option.includes("i");
  }
  if (!scripts.length && i < argv.length) scripts.push(argv[i++]);
  if (!scripts.length) return result(1, "", "bunmsh: sed: missing script\n");
  let commands;
  try { commands = compileSed(scripts.join("\n"), pattern => grepPosixClasses(extended ? pattern : grepBasicRegex(pattern))); }
  catch (error) { return result(1, "", `bunmsh: sed: ${error.message}\n`); }
  const operands = argv.slice(i);
  if (inPlace && !operands.length) return result(1, "", "bunmsh: sed: -i requires a file operand\n");
  const readExtra = file => {
    try { return readFileSync(resolvePath(nativePath(state.cwd),nativePath(file)),"utf8"); }
    catch { return ""; } // sed r silently skips unreadable or missing files.
  };
  try {
    if (!operands.length) {
      const text = decoder.decode(await readFallbackInput(input));
      return result(0, applySed(text, commands, quiet, readExtra));
    }
    let stdout = "";
    for (const operand of operands) {
      const file = isAbsolute(nativePath(operand)) ? nativePath(operand) : resolvePath(nativePath(state.cwd), nativePath(operand));
      const changed = applySed(await Bun.file(file).text(), commands, quiet, readExtra);
      if (inPlace) await Bun.write(file, changed);
      else stdout += changed;
    }
    return result(0, stdout);
  } catch (error) { return result(1, "", `bunmsh: sed: ${error.message}\n`); }
}

function cutCharacterRanges(spec) {
  const ranges = [];
  for (const part of spec.split(",")) {
    const match = /^(\d+)?(?:-(\d+)?)?$/.exec(part);
    if (!match || (!match[1] && !match[2])) throw new Error(`invalid range: ${part}`);
    const start = Number(match[1] ?? 1);
    const end = match[0].includes("-") ? Number(match[2] ?? Number.MAX_SAFE_INTEGER) : start;
    ranges.push([start, end]);
  }
  return ranges;
}

async function runCutFallback(argv, state, input) {
  let spec, i = 1;
  if (argv[i] === "-c") spec = argv[++i], i++;
  else if (argv[i]?.startsWith("-c")) spec = argv[i++].slice(2);
  if (!spec) return result(1, "", "bunmsh: cut: usage: cut -c LIST [FILE ...]\n");
  try {
    const ranges = cutCharacterRanges(spec);
    const output = [];
    let status = 0, stderr = "";
    const operands = argv.slice(i);
    for (const operand of operands.length ? operands : ["-"]) try {
      const text = decoder.decode(await readFallbackFiles([operand], state, input));
      const trailing = text.endsWith("\n");
      const lines = text.split("\n");
      if (trailing) lines.pop();
      output.push(lines.map((line) => [...line].filter((_ch, index) =>
        ranges.some(([start, end]) => index + 1 >= start && index + 1 <= end)).join("")).join("\n") +
        (trailing ? "\n" : ""));
    } catch (error) { status = 1; stderr += `bunmsh: cut: ${operand}: ${error.message}\n`; }
    return result(status, output.join(""), stderr);
  } catch (error) { return result(1, "", `bunmsh: cut: ${error.message}\n`); }
}

function runLnFallback(argv, state) {
  let symbolic = false, force = false, noTargetDirectory = false, i = 1;
  while (/^-[sfT]+$/.test(argv[i] ?? "")) {
    symbolic ||= argv[i].includes("s");
    force ||= argv[i].includes("f");
    noTargetDirectory ||= argv[i].includes("T");
    i++;
  }
  if (argv.length - i < 2) return result(1, "", "bunmsh: ln: usage: ln [-sf] target... link_name\n");
  const sources = argv.slice(i, -1);
  const destination = nativePath(argv.at(-1));
  const targetPath = isAbsolute(destination) ? destination : resolvePath(nativePath(state.cwd), destination);
  let directory = false;
  if (!noTargetDirectory) try { directory = statSync(targetPath).isDirectory(); } catch {}
  if (sources.length > 1 && !directory)
    return result(1, "", "bunmsh: ln: target is not a directory\n");
  let status = 0, stderr = "";
  for (const operand of sources) {
    const target = nativePath(operand);
    const link = directory ? resolvePath(targetPath, pathBasename(target)) : targetPath;
    try {
      if (force) try { unlinkSync(link); } catch {}
      if (symbolic) symlinkSync(target, link); else {
        const source = isAbsolute(target) ? target : resolvePath(nativePath(state.cwd), target);
        linkSync(source, link);
      }
    } catch (error) { status = 1; stderr += `bunmsh: ln: ${operand}: ${error.message}\n`; }
  }
  return result(status, "", stderr);
}

function symbolicFileMode(spec, stat) {
  let mode = stat.mode & 0o7777;
  // Retain the original shorthand; other symbolic forms require explicit who.
  if (spec === "+x") return mode | 0o111;
  for (const clause of spec.split(",")) {
    const match = /^([ugoa]+)((?:[+=-][rwxX]*)+)$/.exec(clause);
    if (!match) throw new Error(`unsupported mode: ${spec}`);
    const who = match[1].includes("a") ? "ugo" : match[1];
    let selected = 0, special = 0;
    for (const [name, mask, bit] of [["u",0o700,0o4000],["g",0o070,0o2000],["o",0o007,0o1000]])
      if (who.includes(name)) { selected |= mask; special |= bit; }
    for (const action of match[2].matchAll(/([+=-])([rwxX]*)/g)) {
      let bits = 0;
      for (const ch of action[2]) {
        if (ch === "r") bits |= 0o444;
        if (ch === "w") bits |= 0o222;
        if (ch === "x" || (ch === "X" && (stat.isDirectory() || (mode & 0o111)))) bits |= 0o111;
      }
      bits &= selected;
      if (action[1] === "+") mode |= bits;
      else if (action[1] === "-") mode &= ~bits;
      else {
        // GNU chmod preserves directory set-ID bits unless explicitly changed.
        const clearedSpecial = stat.isDirectory() ? special & 0o1000 : special;
        mode = (mode & ~(selected | clearedSpecial)) | bits;
      }
    }
  }
  return mode;
}

function runChmodFallback(argv, state) {
  let i = argv[1] === "--" ? 2 : 1;
  const mode = argv[i++];
  if (argv[i] === "--") i++;
  if (!mode || i >= argv.length) return result(1, "", "bunmsh: chmod: usage: chmod MODE FILE...\n");
  let status = 0, stderr = "";
  for (const operand of argv.slice(i)) {
    const path = isAbsolute(nativePath(operand)) ? nativePath(operand) : resolvePath(nativePath(state.cwd), nativePath(operand));
    try {
      chmodSync(path, /^[0-7]{1,4}$/.test(mode) ? Number.parseInt(mode, 8) : symbolicFileMode(mode, statSync(path)));
    } catch (error) { status = 1; stderr += `bunmsh: chmod: ${operand}: ${error.message}\n`; }
  }
  return result(status, "", stderr);
}

export function runUnameFallback(argv, system = {}) {
  const arch = system.arch ?? osArch();
  const machine = ({ arm64: "aarch64", x64: "x86_64" })[arch] ?? arch;
  const values = {
    s: system.type ?? osType(),
    n: system.hostname ?? osHostname(),
    r: system.release ?? osRelease(),
    v: system.version ?? osVersion(),
    m: machine,
    p: machine,
  };
  if (argv.length === 1) return result(0, `${values.s}\n`);
  const flags = new Set();
  for (const arg of argv.slice(1)) {
    if (arg === "-a") for (const flag of "snrvmp") flags.add(flag);
    else if (/^-[snrvmp]+$/.test(arg)) for (const flag of arg.slice(1)) flags.add(flag);
    else return result(1, "", `bunmsh: uname: unsupported option: ${arg}\n`);
  }
  return result(0, `${[..."snrvmp"].filter((flag) => flags.has(flag)).map((flag) => values[flag]).join(" ")}\n`);
}

//  Windows has no `ps`, so the same two columns come out of Win32_Process.
//  bun-taskmgr reads `Select-Object ProcessId, CommandLine`, but that is
//  formatted as a console table, which truncates a long command line with an
//  ellipsis — exactly the part pspa exists to show. Building the line inside
//  PowerShell instead keeps it whole, and falls back to the image name for a
//  system process whose CommandLine is null.
const PSPA_WINDOWS_QUERY = "Get-CimInstance Win32_Process | ForEach-Object { " +
  "$_.ProcessId.ToString() + ' ' + $(if ($_.CommandLine) { $_.CommandLine } else { $_.Name }) }";

export function parseWindowsProcessList(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(\d+) ?(.*)$/.exec(line);
    //  A command line containing a newline arrives as continuation lines with
    //  no PID of their own. There is nothing to attribute them to, so they are
    //  dropped rather than guessed at.
    if (match) rows.push({ pid: Number(match[1]), args: match[2].trim() });
  }
  return rows.sort((first, second) => first.pid - second.pid);
}

//  Laid out like `ps -eo pid,args`, so both platforms print the same shape:
//  a right-aligned PID column at least as wide as procps' own, then the
//  command line.
export function formatProcessTable(rows) {
  const width = rows.reduce((widest, row) => Math.max(widest, String(row.pid).length), 5);
  const lines = [`${"PID".padStart(width)} COMMAND`];
  for (const row of rows)
    lines.push(`${String(row.pid).padStart(width)} ${row.args}`.trimEnd());
  return `${lines.join("\n")}\n`;
}

//  Windows has no signals to deliver. libuv turns SIGTERM, SIGINT, and
//  SIGKILL into an unconditional TerminateProcess, refuses every other name
//  with ENOSYS, and in no case touches the target's children. `taskkill`
//  reaches all of it, and `/T /F` is the form bun-taskmgr verified on
//  Windows 11, so that is what a terminating signal becomes here.
export function windowsKillCommand(pid) {
  return ["taskkill", "/PID", String(pid), "/T", "/F"];
}

//  taskkill reports its own failures in prose ("ERROR: The process "123" not
//  found."). Strip its prefix so the line reads as one of ours.
export function taskkillFailure(status, stdout, stderr) {
  if (status === 0) return null;
  const message = (stderr.trim() || stdout.trim()).replace(/^ERROR:\s*/i, "");
  return message || `taskkill exited with status ${status}`;
}

async function runWindowsKill(pid) {
  let proc;
  try {
    proc = Bun.spawn({
      cmd: windowsKillCommand(pid),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) { return `taskkill: ${error.message}`; }
  const [status, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return taskkillFailure(status, stdout, stderr);
}

//  `pspa` answers the question a shell with no process viewer keeps running
//  into: which PID belongs to which command line. POSIX hands that to
//  `ps -eo pid,args` and passes the output straight through — reading it over
//  a pipe is also what stops procps from cutting long command lines at the
//  terminal width, which it does when its stdout is a terminal.
//  Rows out of `ps`, for the callers that render the listing themselves
//  rather than passing it through.
export function parsePosixProcessList(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*PID\s+COMMAND\s*$/.test(line)) continue;
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (match) rows.push({ pid: Number(match[1]), args: match[2].trimEnd() });
  }
  return rows;
}

async function queryProcessList(name, state) {
  const windows = process.platform === "win32";
  const command = windows
    ? ["powershell", "-NoProfile", "-Command", PSPA_WINDOWS_QUERY]
    : ["ps", "-eo", "pid,args"];
  let proc;
  try {
    proc = Bun.spawn({
      cmd: command,
      cwd: nativePath(state.cwd),
      env: externalEnvironment(state),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch (error) {
    return { failure: result(127, "", `bunmsh: ${name}: ${command[0]}: ${error.message}\n`) };
  }
  const [status, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
  ]);
  if (status !== 0) {
    return {
      failure: result(status, "",
        stderr || `bunmsh: ${name}: ${command[0]}: exited with status ${status}\n`),
    };
  }
  return { windows, output: new Uint8Array(stdout), stderr };
}

async function runPspaFallback(argv, state) {
  if (argv.length > 1)
    return result(2, "", `bunmsh: pspa: unexpected operand: ${argv[1]}\n`);
  const query = await queryProcessList("pspa", state);
  if (query.failure) return query.failure;
  return query.windows
    ? result(0, formatProcessTable(parseWindowsProcessList(decoder.decode(query.output))), query.stderr)
    : result(0, query.output, query.stderr);
}

//  The COMMAND column of a process listing is a shell command line, so it is
//  highlighted as one. The rules are micro's `syntax/sh.yaml` and the colours
//  are its `colorschemes/monokai.micro` colour-links, which is also the
//  palette catfancy already uses — so a command line reads the same here, in
//  a previewed script, and in the editor.
export const SH_COLORS = {
  comment: Bun.color("#75715E", "ansi-16m"),
  identifier: Bun.color("#66D9EF", "ansi-16m"),
  constant: Bun.color("#AE81FF", "ansi-16m"),
  string: Bun.color("#E6DB74", "ansi-16m"),
  statement: Bun.color("#F92672", "ansi-16m"),
  type: Bun.color("#66D9EF", "ansi-16m"),
  special: Bun.color("#A6E22E", "ansi-16m"),
  path: "\x1b[2m",
  header: "\x1b[1m",
  reset: "\x1b[0m",
};

//  sh.yaml's rules, in its order. A later rule paints over an earlier one,
//  which is how micro resolves them too: that is why the flag rule beats the
//  command names it overlaps, and why `$var` ends up an identifier rather
//  than the `special` its `$` matched first.
const SH_RULES = [
  { name: "constant", pattern: /\b[0-9]+\b/g },
  { name: "statement", pattern: /\b(break|case|continue|do|done|elif|else|esac|exec|exit|fi|for|function|if|in|return|select|then|trap|until|wait|while)\b/g },
  { name: "special", pattern: /[`$<>!=&~^{}();\][]+/g },
  { name: "type", pattern: /\b(cd|command|echo|eval|export|getopts|let|local|read|set|shift|time|umask|unset)\b/g },
  { name: "type", pattern: /\b((g|ig)?awk|bash|dash|find|getopt|\w{0,4}grep|kill|killall|\w{0,4}less|make|pkill|sed|sh|tar)\b/g },
  { name: "type", pattern: /\b(base64|basename|cat|chcon|chgrp|chmod|chown|chroot|cksum|comm|cp|csplit|cut|date|dd|df|dir|dircolors|dirname|du|env|expand|expr|factor|false|fmt|fold|head|hostid|id|install|join|link|ln|logname|ls|md5sum|mkdir|mkfifo|mknod|mktemp|mv|nice|nl|nohup|nproc|numfmt|od|paste|pathchk|pinky|pr|printenv|printf|ptx|pwd|readlink|realpath|rm|rmdir|runcon|seq|(sha1|sha224|sha256|sha384|sha512)sum|shred|shuf|sleep|sort|split|stat|stdbuf|stty|sum|sync|tac|tail|tee|test|time|timeout|touch|tr|true|truncate|tsort|tty|uname|unexpand|uniq|unlink|users|vdir|wc|who|whoami|yes)\b/g },
  { name: "statement", pattern: /(\s|^)(--?[A-Za-z0-9][\w-]*)/g, group: 2 },
  { name: "identifier", pattern: /\$\{[\w:!%&=+#~@*^$?, .\-/[\]]+\}/g },
  { name: "identifier", pattern: /\$([0-9!#@*$?-]|[A-Za-z_]\w*)/g },
];

//  Quoted strings and comments are regions in sh.yaml, not patterns: they
//  swallow whatever is inside them. Finding their spans first is what keeps
//  a `#` inside a quoted argument from turning the rest of the line into a
//  comment, and a quote inside a comment from opening a string.
function shellRegions(text) {
  const regions = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' || ch === "'") {
      let end = i + 1;
      while (end < text.length) {
        if (text[end] === "\\") { end += 2; continue; }
        if (text[end] === ch) { end++; break; }
        end++;
      }
      end = Math.min(end, text.length);
      regions.push({ start: i, end, name: "string" });
      i = end - 1;
      continue;
    }
    if (ch === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
      regions.push({ start: i, end: text.length, name: "comment" });
      break;
    }
  }
  return regions;
}

//  `base` paints runs before any rule runs, so a rule matching inside one
//  still wins — the same layering micro applies between a scheme's default
//  and its rules.
export function highlightShellCommand(text, base = []) {
  const painted = new Array(text.length).fill(null);
  for (const run of base)
    for (let i = run.start; i < Math.min(run.end, text.length); i++) painted[i] = run.name;
  const regions = shellRegions(text);
  const inRegion = new Array(text.length).fill(false);
  for (const region of regions)
    for (let i = region.start; i < region.end; i++) inRegion[i] = true;
  for (const rule of SH_RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      const value = rule.group ? match[rule.group] : match[0];
      if (!value) continue;
      const start = match.index + (rule.group ? match[0].indexOf(value) : 0);
      for (let i = start; i < start + value.length; i++)
        if (!inRegion[i]) painted[i] = rule.name;
    }
  }
  for (const region of regions)
    for (let i = region.start; i < region.end; i++) painted[i] = region.name;

  let output = "";
  for (let i = 0; i < text.length;) {
    const name = painted[i];
    let end = i;
    while (end < text.length && painted[end] === name) end++;
    const chunk = text.slice(i, end);
    output += name ? `${SH_COLORS[name]}${chunk}${SH_COLORS.reset}` : chunk;
    i = end;
  }
  return output;
}

//  Two additions to what sh.yaml describes, because a process listing is not
//  a script. The directory in front of the program is dimmed: that is the
//  part an absolute path buries the answer in, and `ps` prints a lot of it.
//  And the program's own name is painted `type` whether or not it is one of
//  the names sh.yaml lists — the file has to guess a command from a word
//  list, while here the first token is known to be one.
//  Both are base layers, so a rule still paints over them, and a quoted
//  program keeps the string colour a quoted string gets everywhere else.
//  A kernel thread — `[kworker/0:1]`, one bracketed token with no program,
//  path, or arguments in it — recedes whole instead of being taken apart.
export function colorProcessCommand(args) {
  if (!args) return "";
  if (/^\[.+\]$/.test(args)) return `${SH_COLORS.path}${args}${SH_COLORS.reset}`;
  const end = args.indexOf(" ");
  const program = end < 0 ? args.length : end;
  const separator = Math.max(
    args.lastIndexOf("/", program - 1),
    args.lastIndexOf("\\", program - 1),
  );
  const base = separator < 0
    ? [{ start: 0, end: program, name: "type" }]
    : [
        { start: 0, end: separator + 1, name: "path" },
        { start: separator + 1, end: program, name: "type" },
      ];
  return highlightShellCommand(args, base);
}

export function colorProcessTable(rows) {
  //  A PID is a number, and sh.yaml paints a number `constant`.
  const { constant: PID, header: HEADER, reset: RESET } = SH_COLORS;
  const width = rows.reduce((widest, row) => Math.max(widest, String(row.pid).length), 5);
  const lines = [`${HEADER}${"PID".padStart(width)} COMMAND${RESET}`];
  //  Nothing but colour separates this from formatProcessTable's output, so
  //  a row with no command line keeps the same trimmed tail that one has.
  for (const row of rows)
    lines.push(`${PID}${String(row.pid).padStart(width)}${RESET}` +
      (row.args ? ` ${colorProcessCommand(row.args)}` : ""));
  return `${lines.join("\n")}\n`;
}

//  `pspac` is `pspa` coloured. Like catfancy it always colours rather than
//  sniffing for a terminal, so the plain listing stays one command away.
async function runPspacFallback(argv, state) {
  if (argv.length > 1)
    return result(2, "", `bunmsh: pspac: unexpected operand: ${argv[1]}\n`);
  const query = await queryProcessList("pspac", state);
  if (query.failure) return query.failure;
  const text = decoder.decode(query.output);
  const rows = query.windows ? parseWindowsProcessList(text) : parsePosixProcessList(text);
  return result(0, colorProcessTable(rows), query.stderr);
}

function runExprFallback(argv) {
  const args = argv.slice(argv[1] === "--" ? 2 : 1);
  let i = 0;
  const precedence = {"|":1,"&":2,"=":3,"!=":3,"<":3,"<=":3,">":3,">=":3,"+":4,"-":4,"*":5,"/":5,"%":5,":":6};
  const truth = value => value !== "" && !/^-?0+$/.test(value);
  const integer = value => { if (!/^-?\d+$/.test(value)) throw new Error("non-integer argument"); return BigInt(value); };
  const atom = () => {
    if (i >= args.length) throw new Error("missing operand");
    const value = args[i++];
    if (value !== "(") return value;
    const nested = expression(1);
    if (args[i++] !== ")") throw new Error("expected closing parenthesis");
    return nested;
  };
  const expression = minimum => {
    let left = atom();
    while ((precedence[args[i]] ?? 0) >= minimum) {
      const op = args[i++], right = expression(precedence[op] + 1);
      if (op === "|") left = truth(left) ? left : truth(right) ? right : "0";
      else if (op === "&") left = truth(left) && truth(right) ? left : "0";
      else if (op === ":") {
        const re = new RegExp(`^(?:${grepPosixClasses(grepBasicRegex(right))})`);
        const match = re.exec(left);
        // BRE parentheses are captures; a failed capturing match returns empty.
        const capture = /(^|[^\\])(?:\\\\)*\\\(/.test(right);
        left = capture ? (match?.[1] ?? "") : String(match?.[0].length ?? 0);
      } else if (["+","-","*","/","%"].includes(op)) {
        const a = integer(left), b = integer(right);
        if ((op === "/" || op === "%") && b === 0n) throw new Error("division by zero");
        left = String(op === "+" ? a+b : op === "-" ? a-b : op === "*" ? a*b : op === "/" ? a/b : a%b);
      } else {
        const numeric = /^-?\d+$/.test(left) && /^-?\d+$/.test(right);
        const a = numeric ? BigInt(left) : left, b = numeric ? BigInt(right) : right;
        left = String(Number(op === "=" ? a===b : op === "!=" ? a!==b : op === "<" ? a<b : op === "<=" ? a<=b : op === ">" ? a>b : a>=b));
      }
    }
    return left;
  };
  try {
    const value = expression(1);
    if (i !== args.length) throw new Error("unexpected operand");
    return result(truth(value) ? 0 : 1, `${value}\n`);
  } catch (error) { return result(2,"",`bunmsh: expr: ${error.message}\n`); }
}

async function runAwkFallback(argv, state, input) {
  try {
    const scripts=[], variables={}; let i=1;
    const assignment = text => {
      const m=/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(text);
      if (!m) throw new Error(`invalid variable assignment: ${text}`);
      return [m[1], m[2].replace(/\\([ntr\\])/g, (_,c)=>({n:"\n",t:"\t",r:"\r","\\":"\\"})[c])];
    };
    for (; i<argv.length && argv[i].startsWith("-") && argv[i]!=="-"; i++) {
      const option=argv[i]; if(option==="--") {i++;break;}
      const flag=option.slice(0,2);
      if(!["-F","-v","-f","-e"].includes(flag)) throw new Error(`unsupported option: ${option}`);
      const value=option.length>2?option.slice(2):argv[++i];
      if(value===undefined)throw new Error(`${flag} requires an argument`);
      if(flag==="-F")variables.FS=value;
      else if(flag==="-v") {const [name,text]=assignment(value);variables[name]=text;}
      else scripts.push(flag==="-f" ? readFileSync(resolvePath(nativePath(state.cwd),nativePath(value)),"utf8") : value);
    }
    if(!scripts.length){if(i>=argv.length)throw new Error("missing program");scripts.push(argv[i++]);}
    const program=compileAwk(scripts.join("\n"));
    const needsInput = node => node && typeof node==="object" && (node.type==="getline"&&!node.file ||
      (node instanceof Map ? [...node.values()] : Object.values(node)).some(needsInput));
    const operands=argv.slice(i), inputs=[];
    if(program.rules.length || needsInput(program)) {
      for (const operand of operands.length?operands:["-"]) {
        if(/^[A-Za-z_][A-Za-z0-9_]*=/.test(operand))inputs.push({assignment:assignment(operand)});
        else inputs.push({name:operand,text:operand==="-"?decode(await readFallbackInput(input)):readFileSync(resolvePath(nativePath(state.cwd),nativePath(operand)),"utf8")});
      }
    }
    const path = file => resolvePath(nativePath(state.cwd),nativePath(file));
    const value=executeAwk(program,inputs,{variables,argv:operands,env:externalEnvironment(state),
      runPipe:(command,text)=>{
        const directory=mkdtempSync(resolvePath(tmpdir(),"bunmsh-awk-state-"));
        try {
          const file=resolvePath(directory,"state.json");
          writeFileSync(file,pipelineBuiltinState(state).env[PIPELINE_STATE_ENV],{mode:0o600});
          const p=Bun.spawnSync(pipelineCompoundArgv(command),{
            cwd:nativePath(state.cwd),env:{...externalEnvironment(state),[PIPELINE_STATE_ENV]:`@file:${file}`},
            stdin:bytes(text),stdout:"pipe",stderr:"pipe"});
          if(p.error)throw p.error;
          return {status:p.exitCode,stdout:decode(p.stdout),stderr:decode(p.stderr)};
        } finally {rmSync(directory,{recursive:true,force:true});}
      },
      readFile:file=>readFileSync(path(file),"utf8"),
      writeFile:(file,text,append)=>writeFileSync(path(file),text,{flag:append?"a":"w"})});
    return result(value.status,value.stdout,value.stderr??"");
  } catch(error) {return result(2,"",`bunmsh: ${error.message.startsWith("awk:")?"":"awk: "}${error.message}\n`);}
}

async function runCmpFallback(argv, state, input) {
  let silent = false, i = 1;
  for (; i < argv.length && argv[i].startsWith("-") && argv[i] !== "-"; i++) {
    if (argv[i] === "--") { i++; break; }
    if (["-s", "--silent", "--quiet"].includes(argv[i])) silent = true;
    else return result(2, "", `bunmsh: cmp: unsupported option: ${argv[i]}\n`);
  }
  const files = argv.slice(i);
  if (files.length !== 2) return result(2, "", "bunmsh: cmp: expected two files\n");
  try {
    let stdin;
    const read = async file => file === "-" ? (stdin ??= await readFallbackInput(input)) :
      readFileSync(resolvePath(nativePath(state.cwd), nativePath(file)));
    const a = await read(files[0]), b = await read(files[1]);
    let offset = 0, line = 1;
    while (offset < Math.min(a.length, b.length) && a[offset] === b[offset]) {
      if (a[offset] === 10) line++;
      offset++;
    }
    if (offset === a.length && offset === b.length) return result();
    if (silent) return result(1);
    if (offset < Math.min(a.length, b.length))
      return result(1, `${files[0]} ${files[1]} differ: char ${offset + 1}, line ${line}\n`);
    const file = files[a.length < b.length ? 0 : 1];
    return result(1, "", `cmp: EOF on ${file}${offset ? ` after byte ${offset}, in line ${line}` : " which is empty"}\n`);
  } catch (error) { return result(2, "", silent ? "" : `bunmsh: cmp: ${error.message}\n`); }
}

async function runDiffFallback(argv, state) {
  let brief=false, i=1;
  for (; i<argv.length && argv[i].startsWith("-"); i++) {
    if (argv[i] === "--") { i++; break; }
    if (["-q","--brief"].includes(argv[i])) brief=true;
    else if (!/^--color(?:=(?:always|auto|never))?$/.test(argv[i]))
      return result(2,"",`bunmsh: diff: unsupported option: ${argv[i]}\n`);
  }
  if (argv.length-i !== 2) return result(2,"","bunmsh: diff: expected two files\n");
  const [left,right]=argv.slice(i);
  try {
    const a=readFileSync(resolvePath(nativePath(state.cwd),nativePath(left)));
    const b=readFileSync(resolvePath(nativePath(state.cwd),nativePath(right)));
    if (a.equals(b)) return result();
    if (brief || a.includes(0) || b.includes(0)) return result(1,`Files ${left} and ${right} differ\n`);
    return result(1, Buffer.from(normalFileDiff(a.toString("latin1"), b.toString("latin1")), "latin1").toString());
  } catch(error) {return result(2,"",`bunmsh: diff: ${error.message}\n`);}
}

const fallbackBuiltins = {
  awk: runAwkFallback,
  diff: runDiffFallback,
  cmp: runCmpFallback,
  expr: runExprFallback,
  basename: async (argv) => {
    const i = argv[1] === "--" ? 2 : 1;
    if (i >= argv.length || argv.length - i > 2)
      return result(1, "", "bunmsh: basename: usage: basename string [suffix]\n");
    let name = /^\/+$/.test(argv[i]) ? "/" : pathBasename(argv[i]);
    const suffix = argv[i + 1];
    if (suffix && suffix !== name && name.endsWith(suffix)) name = name.slice(0, -suffix.length);
    return result(0, `${name}\n`);
  },
  dirname: async (argv) => {
    const i = argv[1] === "--" ? 2 : 1;
    if (argv.length - i !== 1)
      return result(1, "", "bunmsh: dirname: usage: dirname string\n");
    return result(0, `${pathDirname(argv[i])}\n`);
  },
  ls: runFancyLsFallback,
  // Bun Shell's own `ls`, kept reachable under a different name now that
  // plain `ls` falls back to lsfancy instead. Bun.$ dispatches on the
  // literal command name, so argv[0] is rewritten back to "ls" for it —
  // `lsbun` itself is not something Bun Shell knows how to run.
  lsbun: (argv, state) => runBunShellFallback(["ls", ...argv.slice(1)], state),
  lsfancy: runFancyLsFallback,
  mv: runBunShellFallback,
  rm: runBunShellFallback,
  mkdir: runBunShellFallback,
  seq: runBunShellFallback,
  touch: runBunShellFallback,
  cat: runCatFallback,
  tac: runTacFallback,
  catfancy: async (argv, state, input) => {
    const output = await catFancy(argv, state.cwd, fallbackInput(input));
    return result(output.status, output.stdout, output.stderr);
  },
  cp: runBunShellCpFallback,
  curl: runCurlFallback,
  head: runHeadFallback,
  tail: (argv, state, input) => runTextFilter(argv, state, input, "tail"),
  wc: runWcFallback,
  tr: runTrFallback,
  sleep: runSleepFallback,
  tee: runTeeFallback,
  clear: async () => result(0, "\x1b[2J\x1b[H"),
  rmdir: async (argv, state) => runRmdirFallback(argv, state),
  mktemp: async (argv, state) => runMktempFallback(argv, state),
  uniq: runUniqFallback,
  sort: (argv, state, input) => runTextFilter(argv, state, input, "sort"),
  date: async (argv) => runDateFallback(argv),
  md5sum: (argv, state, input) => runHashFallback(argv, state, input, "md5"),
  sha256sum: (argv, state, input) => runHashFallback(argv, state, input, "sha256"),
  grep: runGrepFallback,
  egrep: (argv, state, input, context) => runGrepFallback(["grep", "-E", ...argv.slice(1)], state, input, context),
  fgrep: (argv, state, input, context) => runGrepFallback(["grep", "-F", ...argv.slice(1)], state, input, context),
  sed: runSedFallback,
  cut: runCutFallback,
  ln: async (argv, state) => runLnFallback(argv, state),
  chmod: async (argv, state) => runChmodFallback(argv, state),
  uname: async (argv) => runUnameFallback(argv),
  pspa: runPspaFallback,
  pspac: runPspacFallback,
  bunmsh: runBunmshFallback,
  bun: runBunFallback,
  serve: async (argv, state) => {
    const options = parseServeArguments(argv.slice(1), state.env, state.cwd);
    if (options.error) return result(2, "", `bunmsh: serve: ${options.error}\n`);
    try {
      const server = startFileServer(options.directory, options);
      const signal = await waitForInterrupt(server, options);
      return result(signal === "SIGINT" ? 130 : signal === "SIGTERM" ? 143 : 0);
    } catch (error) {
      return result(1, "", `bunmsh: serve: ${error.message}\n`);
    }
  },
};

if (!findIsRegularBuiltin()) fallbackBuiltins.find = runFindBuiltin;

export function builtinNames() {
  return [...new Set([...Object.keys(builtins), ...Object.keys(fallbackBuiltins)])].sort();
}

function formatMilliseconds(milliseconds, color = Boolean(process.stderr.isTTY)) {
  const rendered = milliseconds.toFixed(6);
  if (!color) return rendered;
  const decimal = rendered.indexOf(".");
  const palette = [46, 82, 118, 154, 190, 226, 220, 214, 208, 202, 196, 198, 201, 165, 129, 93, 57, 21, 27, 33, 39, 45];
  let output = "";
  for (let i = 0; i < rendered.length; i++) {
    if (rendered[i] === ".") {
      output += "\x1b[2m.\x1b[0m";
      continue;
    }
    const magnitude = i < decimal ? decimal - i - 1 : decimal - i;
    // Keep each three-digit magnitude region the same colour: units
    // (000), thousands (000), millions (000), then fractional groups.
    const group = Math.floor(magnitude / 3);
    const index = ((group % palette.length) + palette.length) % palette.length;
    output += `\x1b[38;5;${palette[index]}m${rendered[i]}\x1b[0m`;
  }
  return output;
}

function externalEnvironment(state) {
  if (!state.shellOptions.posix) return state.env;
  return Object.fromEntries(Object.entries(state.env).filter(([name]) =>
    state.exported.has(name) || name === PIPELINE_STATE_ENV));
}

export function createState(options = {}) {
  const env = canonicalEnvironment({ ...(options.inheritEnvironment === false ? {} : process.env), ...(options.env ?? {}) });
  const cwd = shellPath(options.cwd ?? process.cwd());
  env.PWD = cwd;
  return {
    env,
    cwd,
    directoryHistory: [...(options.directoryHistory ?? [])],
    tabs: [...(options.tabs ?? [cwd])],
    activeTab: options.activeTab ?? 0,
    aliases: { ...DEFAULT_ALIASES, ...(options.aliases ?? {}) },
    functions: { ...(options.functions ?? {}) },
    history: [...(options.history ?? [])],
    mouseTracking: options.mouseTracking ?? /^(?:1|true|on|yes)$/i.test(env.BUNMSH_MOUSE ?? ""),
    pathSearch: options.pathSearch ?? true,
    readonly: new Set(options.readonly ?? []),
    exported: new Set(options.exported ?? Object.keys(env)),
    getoptsOffset: 1,
    args: options.args ?? ["bunmsh"],
    lastStatus: 0,
    exitRequested: false,
    exitStatus: 0,
    pipelineChild: options.pipelineChild ?? false,
    flow: null,
    loopDepth: 0,
    returnDepth: 0,
    fdBindings: {...(options.fdBindings ?? {})},
    ownedFds: new Set(),
    shellOptions: {...(options.shellOptions ?? {})},
    ignoreErrexit: options.ignoreErrexit ?? 0,
    traps: {},
    trapListeners: new Map(),
    pendingTraps: [],
    inTrap: false,
  };
}

function hasCompoundSyntax(source) {
  if (/(^|\n)\s*(?:\(|[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\))/.test(source)) return true;
  let commandStart = true;
  for (const token of tokenize(source)) {
    if (token.type === "op") {
      if ([";", "&&", "||", "|"].includes(token.value)) commandStart = true;
      continue;
    }
    const word = token.fragments.length === 1 && token.fragments[0].quote === "none"
      ? token.fragments[0].text : null;
    if (commandStart && ["if", "while", "until", "for", "case", "{"].includes(word)) return true;
    if (!(commandStart && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word ?? ""))) commandStart = false;
  }
  return false;
}

function compoundLogicalSource(source, firstLine = 1, sourceLines = null) {
  const continuations = new Map();
  const tokens = tokenize(source, { continuations });
  const breaks = new Set();
  let commandStart = true;
  const literal = (token) => token.type === "word" && token.fragments.length === 1 &&
    token.fragments[0].quote === "none" ? token.fragments[0].text : null;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type === "op") {
      if ([";", "&&", "||", "|"].includes(token.value)) commandStart = true;
      continue;
    }
    const word = literal(token);
    // Function headers allow linebreaks before the opening brace. Braces
    // elsewhere remain ordinary arguments unless at a command boundary.
    const functionHeader = word === "{" && /[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)(?:\s|\\\r?\n)*$/.exec(source.slice(0, token.offset));
    const functionBrace = Boolean(functionHeader);
    if ((commandStart || functionBrace) && word === "{") {
      if (!functionBrace) breaks.add(token.offset);
      else breaks.add(functionHeader.index);
      if (tokens[index + 1]) breaks.add(tokens[index + 1].offset);
      commandStart = true;
      continue;
    }
    if (commandStart && word === "}") {
      breaks.add(token.offset);
      if (tokens[index + 1]?.value === ";" && tokens[index + 2] &&
          tokens[index + 2].value !== ";") breaks.add(tokens[index + 2].offset);
      commandStart = false;
      continue;
    }
    if (!commandStart) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word ?? "")) continue;
    // Like mksh's KEYWORD lexer mode, these words are special only where a
    // command may begin. Physical newlines are not required around them.
    if (["if", "while", "until", "for", "case"].includes(word) && token.offset > 0)
      breaks.add(token.offset);
    if (["elif", "else", "fi", "done", "esac"].includes(word))
      breaks.add(token.offset);
    if (["fi", "done", "esac"].includes(word) && tokens[index + 1]?.value === ";" &&
        tokens[index + 2] && tokens[index + 2].value !== ";")
      breaks.add(tokens[index + 2].offset);
    if (["then", "do", "else"].includes(word) && tokens[index + 1])
      breaks.add(tokens[index + 1].offset);
    commandStart = ["if", "while", "until", "elif", "then", "do", "else"].includes(word);
  }
  let logical = "", line = firstLine, physicalIndex = 0;
  const lineNumbers = [line];
  for (let i = 0; i < source.length; i++) {
    if (breaks.has(i) && logical && !logical.endsWith("\n")) { logical += "\n"; lineNumbers.push(line); }
    if (continuations.has(i)) { i += continuations.get(i) - 1; line = sourceLines?.[++physicalIndex] ?? line + 1; continue; }
    logical += source[i];
    if (source[i] === "\n") { line = sourceLines?.[++physicalIndex] ?? line + 1; lineNumbers.push(line); }
  }
  return {logical, lineNumbers};
}

// A leaf command inside a compound body may continue across physical lines
// inside quotes, substitutions, or a here-document. Keep those lines together
// until mksh-style lexical tokenization says the command is complete, so
// keywords inside a multiline word are never mistaken for compound syntax.
function growLogicalCommand(lines, index) {
  const line = lines[index];
  let end = index;
  let candidate = line;
  while (true) {
    try {
      const tokens = tokenize(candidate, { strict: true });
      const last = tokens.at(-1);
      if (last?.type === "op" && ["|", "&&", "||"].includes(last.value) && end + 1 < lines.length) {
        // Leave a following compound node for parseSequence to attach, but
        // grow ordinary pipelines and AND/OR continuations across newlines.
        if (!/^\s*(?:\{|if\b|for\b|while\b|until\b|case\b)/.test(lines[end + 1])) {
          candidate += `\n${lines[++end]}`;
          continue;
        }
      }
      return { source: candidate, next: end + 1 };
    } catch (error) {
      if (!(error instanceof ShellSyntaxError) ||
          !/^(?:unterminated (?:here-document|single quote|double quote|command substitution|parameter expansion|substitution))/.test(error.message))
        throw error;
      end++;
      if (end >= lines.length) throw error;
      candidate += `\n${lines[end]}`;
    }
  }
}

// Heredoc bodies follow the operator's source position even when it is the
// final token. Remove only the connector, never the rest of the source.
function removeSourceToken(source, token) {
  return source.slice(0, token.offset) + source.slice(token.offset + token.value.length);
}

function compoundSource(node) {
  if (node.type === "subshell") return `(${node.source})`;
  if (node.type === "compoundPostfix")
    return `${compoundSource(node.compound)} ${node.operator} ${node.right ? compoundSource(node.right) : node.command}`;
  if (typeof node.source !== "string") throw new ShellSyntaxError(`missing source for ${node.type}`);
  // A following serialized connector must not become part of a heredoc's
  // delimiter line. Braces preserve the command's scope and give it a boundary.
  if (node.type === "command" && tokenize(node.source).some(token => token.heredoc))
    return `{\n${node.source}\n}`;
  return node.source;
}

function makeCompoundPostfix(compound, suffix, source, nextLine) {
  const suffixCommand = growLogicalCommand([suffix ?? "", ...source.slice(nextLine)], 0);
  suffix = suffixCommand.source;
  nextLine += suffixCommand.next - 1;
  const tokens = tokenize(suffix ?? "");
  const connector = tokens.find(t => t.type === "op" && [";","&&","||","|"].includes(t.value));
  const redirectionText = (suffix ?? "").slice(0,connector?.offset ?? undefined).trim();
  if (redirectionText && !redirectionText.startsWith("#")) {
    if (redirectionText === "&") throw new ShellSyntaxError("&: only a single external command is supported");
    const parsed = parse(`: ${redirectionText}`)[0]?.pipeline[0];
    if (!parsed || parsed.words.length !== 1) throw new ShellSyntaxError(`unexpected compound suffix: ${redirectionText} after ${compound.source.slice(0,120)}`);
    compound = {type:"redirected", compound, redirects:parsed.redirects, source:compoundSource(compound) + " " + redirectionText};
    suffix = connector ? suffix.slice(connector.offset) : "";
  }

  const match = /^\s*(\|\||&&|\||;)\s*(.*)$/s.exec(suffix ?? "");
  if (!match) return { node: compound, nextLine };
  let command = match[2].trim();
  let commandLine = null;
  if (match[1] === ";" && (!command || command.startsWith("#"))) return { node: compound, nextLine };
  while (!command && nextLine < source.length) {
    commandLine = nextLine;
    command = source[nextLine++].trim();
    if (!command || command.startsWith("#")) command = "";
  }
  if (!command)
    throw new ShellSyntaxError(`compound command requires a command after ${match[1]}`);
  if (commandLine !== null && /^(?:\{|if\b|case\b|for\b|while\b|until\b|\()/.test(command))
    return {node:{type:"compoundPostfix",compound,operator:match[1],rightPending:true},nextLine:commandLine};
  // A postfix command can contain multiline quotes, substitutions or heredocs.
  // Grow it just like an ordinary command before resuming the outer parser.
  const remaining = [command, ...source.slice(nextLine)];
  const grown = growLogicalCommand(remaining, 0);
  command = grown.source;
  nextLine += grown.next - 1;
  const trailing = tokenize(command).at(-1);
  if (trailing?.type === "op" && ["&&", "||", "|"].includes(trailing.value)) {
    const middle = {type:"command",source:removeSourceToken(command,trailing)};
    // Pipes bind more tightly; AND/OR lists associate left-to-right.
    if (trailing.value !== "|") return {
      node:{type:"compoundPostfix",compound:{type:"compoundPostfix",compound,operator:match[1],right:middle},operator:trailing.value,rightPending:true},
      nextLine,
    };
    return {
      node: {type:"compoundPostfix", compound, operator:match[1], right:{
        type:"compoundPostfix", compound:middle,
        operator:trailing.value, rightPending:true,
      }},
      nextLine,
    };
  }
  return {
    node: {
      type: "compoundPostfix",
      compound,
      operator: match[1],
      command,
    },
    nextLine,
  };
}

function findShellKeyword(source, keyword) {
  if (source.trimStart().startsWith("#")) return -1;
  let quote = null;
  for (let i = 0; i < source.length;) {
    const ch = source[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      i++;
      continue;
    }
    if (quote === '"') {
      if (ch === "\\" && /[\\"$`\n]/.test(source[i + 1] ?? "")) { i += 2; continue; }
      if (ch === '"') quote = null;
      i++;
      continue;
    }
    if (ch === "\\") { i += 2; continue; }
    if (ch === "'" || ch === '"') { quote = ch; i++; continue; }
    if (ch === "`" || (ch === "$" && source[i + 1] === "(")) {
      try { i = substitutionEnd(source, i); }
      catch { return -1; } // This physical line may continue the substitution.
      continue;
    }
    if (ch === "$" && source[i + 1] === "{") {
      try { i = parameterEnd(source, i); }
      catch { return -1; }
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i++;
      while (/[A-Za-z0-9_]/.test(source[i] ?? "")) i++;
      if (source.slice(start, i) === keyword) {
        let previous = start - 1;
        while (previous >= 0 && /\s/.test(source[previous])) previous--;
        if (keyword !== "esac" || previous < 0 || source[previous] === ";" || source[previous] === "\n")
          return start;
      }
      continue;
    }
    i++;
  }
  return -1;
}

function splitCasePatterns(source) {
  const patterns = [];
  let start = 0;
  let quote = null;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "\\") { i++; continue; }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "$" && (source[i + 1] === "(" || source[i + 1] === "{")) {
      i = (source[i + 1] === "(" ? substitutionEnd(source, i) : parameterEnd(source, i)) - 1;
      continue;
    }
    if (ch === "`") { i = substitutionEnd(source, i) - 1; continue; }
    if (ch === "|") { patterns.push(source.slice(start, i).trim()); start = i + 1; }
  }
  patterns.push(source.slice(start).trim());
  return patterns;
}

// Scan case clauses in the same lexical spirit as mksh's CASEPAT/KEYWORD
// modes. In particular, clause boundaries are shell tokens, not line
// boundaries: Autoconf commonly writes an entire clause on one line.
function shellLiteral(token) {
  return token?.type === "word" && token.fragments.length === 1 && token.fragments[0].quote === "none" ? token.fragments[0].text : null;
}

function caseKeywords(tokens) {
  const words = new Map();
  let start = true;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    let word = shellLiteral(token);
    if (token.type === "op") {
      if ([";", "|", "&&", "||"].includes(token.value)) start = true;
      continue;
    }
    // Parentheses are retained in word tokens by this tokenizer. At command
    // start they can introduce subshells without whitespace before `case`.
    const openings = start ? /^\(+/.exec(word ?? "")?.[0].length ?? 0 : 0;
    if (openings) {
      word = word.slice(openings);
      if (!word) continue;
    }
    if (start && word === "case" && shellLiteral(tokens[i + 2]) === "in") words.set(token.offset + openings, "case");
    if (start && /^esac\)*$/.test(word ?? "")) words.set(token.offset + openings, "esac");
    start = ["then", "do", "else", "{"].includes(word) || Boolean(word?.endsWith(")"));
  }
  return words;
}

function parseCaseArms(source, sourceLines) {
  const arms = [];
  let i = 0;
  const skipSpace = () => {
    while (/\s/.test(source[i] ?? "")) i++;
  };
  while (i < source.length) {
    skipSpace();
    if (i >= source.length) break;
    if (source[i] === "#") {
      while (i < source.length && source[i] !== "\n") i++;
      continue;
    }
    if (source[i] === "(") { i++; skipSpace(); }
    const patternStart = i;
    let quote = null;
    let extensionDepth = 0;
    for (; i < source.length; i++) {
      const ch = source[i];
      if (ch === "\\") { i++; continue; }
      if (quote) {
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === "'" || ch === '"') { quote = ch; continue; }
      if (ch === "$" && (source[i + 1] === "(" || source[i + 1] === "{")) {
        i = (source[i + 1] === "(" ? substitutionEnd(source, i) : parameterEnd(source, i)) - 1;
        continue;
      }
      if (ch === "`") { i = substitutionEnd(source, i) - 1; continue; }
      if (ch === "(" && /[?*+@!]/.test(source[i - 1] ?? "")) { extensionDepth++; continue; }
      if (ch === ")" && extensionDepth) { extensionDepth--; continue; }
      if (ch === ")") break;
    }
    if (i >= source.length)
      throw new ShellSyntaxError(`case pattern requires ): ${source.slice(patternStart, Math.min(source.length, patternStart + 120))}`);
    const patterns = splitCasePatterns(source.slice(patternStart, i));
    if (!patterns.length || patterns.some((pattern) => !pattern))
      throw new ShellSyntaxError("case requires a pattern");
    i++;

    const bodyStart = i;
    let nestedCases = 0;
    let terminator = null;
    const bodyTokens = tokenize(source.slice(bodyStart));
    const keywords = caseKeywords(bodyTokens);
    i = source.length;
    for (let t = 0; t < bodyTokens.length; t++) {
      const token = bodyTokens[t];
      const word = keywords.get(token.offset);
      if (word === "case") nestedCases++;
      else if (word === "esac" && nestedCases) nestedCases--;
      if (!nestedCases && token.type === "op" && token.value === ";") {
        const offset = bodyStart + token.offset;
        if ([";", "&", "|"].includes(source[offset + 1]) && source[offset] === ";") {
          terminator = source.slice(offset, offset + 2);
          i = offset;
          break;
        }
      }
    }
    // POSIX allows the final clause to omit `;;` immediately before esac.
    if (!terminator) {
      if (source.slice(bodyStart, i).trim() || arms.length) terminator = ";;";
      else throw new ShellSyntaxError("unterminated case clause");
    }
    const bodySource = source.slice(bodyStart, i);
    let body;
    try {
      const first = source.slice(0,bodyStart).split("\n").length - 1;
      body = parseCompoundScript(bodySource, sourceLines?.[first] ?? 1, sourceLines?.slice(first));
    } catch (error) {
      if (error instanceof ShellSyntaxError)
        error.message += ` in case arm ${patterns.join("|")}`;
      throw error;
    }
    arms.push({ patterns, body, terminator });
    if (i < source.length) i += 2;
  }
  return arms;
}

function readCompoundHeader(lines, start, keyword) {
  let source = "";
  for (let end = start; end < lines.length; end++) {
    source += (end === start ? "" : "\n") + lines[end];
    let tokens;
    try { tokens = tokenize(source, {strict:true}); } catch (error) {
      if (error.message.startsWith("unterminated")) continue;
      throw error;
    }
    const stack = [];
    let commandStart = true;
    for (let index = 1; index < tokens.length; index++) {
      const token = tokens[index];
      if (token.type === "op") {
        if ([";", "&&", "||", "|"].includes(token.value)) commandStart = true;
        continue;
      }
      const word = token.fragments.length === 1 && token.fragments[0].quote === "none" ? token.fragments[0].text : null;
      if (commandStart && word === keyword && !stack.length) {
        return {condition:source.slice(tokens[0].offset + tokens[0].fragments[0].text.length, token.offset).trim(),
          tail:source.slice(token.offset + keyword.length).trim(), end};
      }
      if (commandStart && ["{", "if", "case", "while", "until", "for"].includes(word)) {
        stack.push(word === "{" ? "}" : word === "if" ? "fi" : word === "case" ? "esac" : "done");
      } else if (word === stack.at(-1)) stack.pop();
      if (commandStart && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word ?? "")) continue;
      commandStart = ["{", "if", "while", "until", "then", "do", "else", "elif"].includes(word);
    }
  }
  throw new ShellSyntaxError(`unterminated condition: expected ${keyword}`);
}

export function parseCompoundScript(source, firstLine = 1, sourceLines = null) {
  const {logical, lineNumbers} = compoundLogicalSource(source, firstLine, sourceLines);
  const lines = logical.split(/\r?\n/);
  const parseSequence = (start, stops = []) => {
    const nodes = [];
    let i = start;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      if (stops.some((stop) => stop.test(trimmed))) break;
      if (!trimmed || trimmed.startsWith("#")) { i++; continue; }

      const functionMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*(\{)?\s*(?:#.*)?$/.exec(trimmed);
      if (functionMatch) {
        if (!functionMatch[2]) {
          do { i++; } while (i < lines.length && (!lines[i].trim() || lines[i].trim().startsWith("#")));
          if (lines[i]?.trim() !== "{") throw new ShellSyntaxError(`unterminated function ${functionMatch[1]}: expected {`);
        }
        const body = parseSequence(i + 1, [/^}(?:\s|;|$)/]);
        if (body.index >= lines.length) throw new ShellSyntaxError(`unterminated function ${functionMatch[1]}`);
        nodes.push({ type: "function", name: functionMatch[1], body: body.nodes });
        i = body.index + 1;
        continue;
      }

      if (trimmed === "{") {
        const body = parseSequence(i + 1, [/^}(?:\s|;|$)/]);
        if (body.index >= lines.length) throw new ShellSyntaxError(`unterminated brace group near ${lines.slice(i, i + 5).join("\n")}`);
        const compound = { type: "group", body: body.nodes, source: [...lines.slice(i, body.index), "}"].join("\n") };
        const postfix = makeCompoundPostfix(compound, lines[body.index].trim().slice(1), lines, body.index + 1);
        nodes.push(postfix.node);
        i = postfix.nextLine;
        continue;
      }

      if (trimmed.startsWith("(")) {
        let end=i, text=line, group=leadingSubshell(text);
        while (!group && ++end < lines.length) { text += `\n${lines[end]}`; group=leadingSubshell(text); }
        if (!group) throw new ShellSyntaxError("unterminated subshell");
        // Preserve the existing rewriteSubshells -> external Bun path for &.
        if (group.suffix.trim() === "&") {
          nodes.push({type:"command",source:text,lineNumber:lineNumbers[i]}); i=end+1; continue;
        }
        const compound={type:"subshell",source:group.body};
        const postfix=makeCompoundPostfix(compound,group.suffix,lines,end+1);
        nodes.push(postfix.node); i=postfix.nextLine; continue;
      }

      if (/^if(?:\s|$)/.test(trimmed)) {
        const compoundStart = i;
        const branches = [];
        let header = readCompoundHeader(lines, i, "then");
        let condition = header.condition;
        let thenCommand = header.tail;
        i = header.end + 1;
        while (true) {
          const body = parseSequence(i, [/^elif(?:\s|$)/, /^else(?:\s*;\s*|\s+|$)(?:#.*)?$/, /^fi\b/]);
          branches.push({ condition, body: body.nodes, thenCommand });
          i = body.index;
          const stop = lines[i]?.trim() ?? "";
          if (/^elif(?:\s|$)/.test(stop)) {
            header = readCompoundHeader(lines, i, "then");
            condition = header.condition;
            thenCommand = header.tail;
            i = header.end + 1;
            continue;
          }
          let otherwise = [];
          if (/^else(?:\s*;\s*|\s+|$)(?:#.*)?$/.test(stop)) {
            const body = parseSequence(i + 1, [/^fi\b/]);
            otherwise = body.nodes;
            i = body.index;
          }
          if (!/^fi\b/.test(lines[i]?.trim() ?? ""))
            throw new ShellSyntaxError("unterminated if");
          const compound = { type: "if", branches, otherwise };
          const close = /^fi\b(.*)$/.exec(lines[i].trim());
          const result = makeCompoundPostfix(
            { ...compound, source: [...lines.slice(compoundStart, i), "fi"].join("\n") },
            close?.[1] ?? "",
            lines,
            i + 1,
          );
          nodes.push(result.node);
          i = result.nextLine;
          break;
        }
        continue;
      }
      if (/^(?:while|until)(?:\s|$)/.test(trimmed)) {
        const compoundStart = i;
        const kind = trimmed.startsWith("until") ? "until" : "while";
        let header = trimmed;
        while (!/(?:;\s*|\s+)do\s*$/.test(header) && ++i < lines.length)
          header += ` ${lines[i].trim()}`;
        if (!/(?:;\s*|\s+)do\s*$/.test(header)) throw new ShellSyntaxError(`${kind} requires do`);
        const condition = header.replace(new RegExp(`^${kind}\\s*`), "").replace(/(?:;\s*|\s+)do\s*$/, "");
        const body = parseSequence(i + 1, [/^done\b/]);
        const done = /^done(?=$|[\s;<|&])(?:\s*<\s*(.+?))?\s*;?\s*((?:\|\||&&|\||;|#).*)?$/.exec(lines[body.index]?.trim() ?? "");
        if (!done)
          throw new ShellSyntaxError(`unterminated ${kind}`);
        const compound = {
          type: "loop", kind, condition, body: body.nodes, input: done[1] ?? null,
          source: [...lines.slice(compoundStart, body.index), `done${done[1] ? ` < ${done[1]}` : ""}`].join("\n"),
        };
        const result = makeCompoundPostfix(compound, done[2] ?? "", lines, body.index + 1);
        nodes.push(result.node);
        i = result.nextLine;
        continue;
      }
      if (/^for(?:\s|$)/.test(trimmed)) {
        const compoundStart = i;
        let header = trimmed;
        let bodyStart = -1;
        while (i < lines.length) {
          if (/;\s*do\s*$/.test(header)) {
            header = header.replace(/;\s*do\s*$/, "");
            bodyStart = i + 1;
            break;
          }
          if (lines[i + 1]?.trim() === "do") {
            bodyStart = i + 2;
            i++;
            break;
          }
          if (++i >= lines.length) break;
          header += ` ${lines[i].trim()}`;
        }
        const match = /^for\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+in(?:\s+(.*?))?)?\s*;?$/.exec(header);
        if (!match) throw new ShellSyntaxError("invalid for command");
        if (bodyStart < 0) throw new ShellSyntaxError("for requires do");
        const body = parseSequence(bodyStart, [/^done\b/]);
        if (!/^done\b/.test(lines[body.index]?.trim() ?? ""))
          throw new ShellSyntaxError(`unterminated for: ${lines[compoundStart]?.trim()} (stopped at ${lines[body.index]?.trim()})`);
        const compound = {
          type: "for", name: match[1], words: match[2] ?? null, body: body.nodes,
          source: [...lines.slice(compoundStart, body.index), "done"].join("\n"),
        };
        const close = /^done\b(.*)$/.exec(lines[body.index].trim());
        const result = makeCompoundPostfix(compound, close?.[1] ?? "", lines, body.index + 1);
        nodes.push(result.node);
        i = result.nextLine;
        continue;
      }
      if (/^case(?:\s|$)/.test(trimmed)) {
        const remaining = lines.slice(i).join("\n");
        const headerTokens=tokenize(remaining).slice(0,3);
        if (headerTokens[2]?.fragments?.map(f=>f.text).join("") !== "in")
          throw new ShellSyntaxError(`case requires in: ${remaining.slice(0,180)}`);
        const caseWord=remaining.slice(headerTokens[1].offset,headerTokens[2].offset).trim();
        const start = headerTokens[2].offset + 2;
        let depth = 0, end = -1;
        for (const [offset, word] of caseKeywords(tokenize(remaining.slice(start)))) {
          if (word === "case") depth++;
          if (word === "esac") {
            if (!depth) { end = start + offset; break; }
            depth--;
          }
        }
        if (end < 0) throw new ShellSyntaxError(`unterminated case: ${trimmed}`);
        const compound = {type:"case", word:caseWord, arms:parseCaseArms(remaining.slice(start,end),lineNumbers.slice(i + remaining.slice(0,start).split("\n").length - 1)), source:remaining.slice(0,end+4)};
        const nextLine = i + remaining.slice(0,end+4).split("\n").length;
        const suffix = remaining.slice(end+4).split("\n")[0];
        const postfix = makeCompoundPostfix(compound,suffix,lines,nextLine);
        nodes.push(postfix.node);
        i = postfix.nextLine;
        continue;
      }
      const grown = growLogicalCommand(lines, i);
      nodes.push({ type: "command", source: grown.source, lineNumber:lineNumbers[i], sourceLines:lineNumbers.slice(i,grown.next) });
      i = grown.next;
    }
    for (let n = nodes.length - 2; n >= 0; n--) {
      let pending = nodes[n];
      while (pending.right) pending = pending.right;
      if (pending.rightPending) {
        pending.right = nodes[n+1]; delete pending.rightPending; nodes.splice(n+1,1); continue;
      }
      if (nodes[n].type !== "command") continue;
      const last = tokenize(nodes[n].source).at(-1);
      if (last?.type !== "op" || !["&&", "||", "|"].includes(last.value)) continue;
      nodes.splice(n,2,{type:"compoundPostfix",compound:{...nodes[n],source:removeSourceToken(nodes[n].source,last)},operator:last.value,right:nodes[n+1]});
    }
    return { nodes, index: i };
  };
  const parsed = parseSequence(0);
  return parsed.nodes;
}

// Every "needs more input before this can run" condition in this parser
// (open quotes, an open $()/${}/backtick, an open here-document, or a
// compound command still missing its closing keyword) raises a
// ShellSyntaxError whose message starts with "unterminated". An interactive
// front end can use this, mirroring mksh's PS2 continuation prompt, to tell
// "still typing this command" apart from a real syntax error.
export function isJavaScriptMode(source) {
  return source.trimStart().startsWith("Bun.");
}

export function needsMoreInput(source) {
  source = normalizeSource(source);
  try {
    if (hasCompoundSyntax(source)) parseCompoundScript(source);
    else tokenize(source, { strict: true });
  } catch (error) {
    if (!(error instanceof ShellSyntaxError && error.message.startsWith("unterminated")))
      return false;
    //  JavaScript has no line-continuation backslash outside a string
    //  literal: there it is a syntax error, not a request for another line,
    //  so asking for one only leads the typing somewhere that cannot parse.
    //  An unterminated quote still continues, because that is JavaScript's
    //  own line continuation and the evaluator does accept it.
    if (isJavaScriptMode(source) && error.message === "unterminated line continuation")
      return false;
    return true;
  }
  return false;
}

// Buffered compound pipelines need the same descriptor routing as leaf commands.
function routeCommandOutput(execution, bindings) {
  const output = [], errors = [];
  for (const [number, data] of [[1, execution.stdout], [2, execution.stderr]]) {
    if (!data.byteLength) continue;
    const endpoint = bindings[number] ?? {channel:number};
    if (endpoint.closed) { execution.status = 1; errors.push(bytes("bunmsh: bad file descriptor\n")); }
    else if (endpoint.fd !== undefined) writeSync(endpoint.fd, data);
    else (endpoint.channel === 2 ? errors : output).push(data);
  }
  execution.stdout = concatBytes(output);
  execution.stderr = concatBytes(errors);
  return execution;
}

async function executeNodeList(nodes, state, options = {}) {
  const capture = options.capture ?? true;
  const stdout = [], stderr = [];
  let execution = result();
  const append = (value) => {
    if (!capture) return;
    if (value.stdout.byteLength) stdout.push(value.stdout);
    if (value.stderr.byteLength) stderr.push(value.stderr);
  };
  for (const node of nodes) {
    if (state.exitRequested || state.flow) break;
    append(await runPendingTraps(state,{capture}));
    if (state.exitRequested) break;
    if (node.type === "redirected") {
      execution = await runCommand({words:parse(":")[0].pipeline[0].words,redirects:node.redirects,body:[node.compound]},state,{captureStdout:capture,captureStderr:capture,input:options.input});
      append(execution);
      if (!capture) {
        if (execution.stdout.byteLength) await writeStream(process.stdout,execution.stdout);
        if (execution.stderr.byteLength) await writeStream(process.stderr,execution.stderr);
      }
      continue;
    }
    if (node.type === "group") {
      execution = await executeNodeList(node.body, state, options);
      append(execution);
      continue;
    }
    if (node.type === "compoundPostfix") {
      if (node.operator === "|") {
        const link = new TransformStream();
        const leftPromise = runExternal(
          pipelineCompoundArgv(compoundSource(node.compound)),
          pipelineBuiltinState(state),
          options.input ?? null,
          false,
          true,
          link.writable,
          { pipelineKillSignal: "SIGTERM" },
        );
        const rightState = {
          ...state,
          env: { ...state.env },
          aliases: { ...state.aliases },
          functions: { ...state.functions },
          readonly: new Set(state.readonly),
          exported: new Set(state.exported),
          directoryHistory: [...state.directoryHistory],
          tabs: [...state.tabs],
          exitRequested: false,
          exitStatus: 0,
        };
        const right = await runExternal(
          pipelineCompoundArgv(node.right ? compoundSource(node.right) : node.command),
          pipelineBuiltinState(rightState),
          link.readable,
          true,
          true,
        );
        const left = await leftPromise;
        execution = routeCommandOutput(result(right.status, right.stdout, concatBytes([left.stderr, right.stderr])), state.fdBindings ?? {});
      } else {
        const previousIgnore = state.ignoreErrexit;
        if (["&&","||"].includes(node.operator)) state.ignoreErrexit++;
        try { execution = await executeNodeList([node.compound], state, { capture }); }
        finally { state.ignoreErrexit=previousIgnore; }
        append(execution);
        const shouldRun = node.operator === "&&"
          ? execution.status === 0
          : node.operator === "||"
            ? execution.status !== 0
            : true;
        if (shouldRun && !state.flow && !state.exitRequested) {
          execution = node.right ? await executeNodeList([node.right],state,{capture}) : await execute(node.command, state, { capture });
          append(execution);
        }
        state.lastStatus = execution.status;
        continue;
      }
      state.lastStatus = execution.status;
      if (capture) append(execution);
      else {
        if (execution.stdout.byteLength) stdout.push(execution.stdout);
        if (execution.stderr.byteLength) stderr.push(execution.stderr);
      }
      continue;
    }
    if (node.type === "function") {
      state.functions[node.name] = node.body;
      state.lastStatus = 0; execution = result();
      continue;
    }
    if (node.type === "command") {
      execution = await execute(node.source, state, { capture, simple: true, firstLine:node.lineNumber, sourceLines:node.sourceLines });
      append(execution);
      continue;
    }
    if (node.type === "subshell") {
      execution = await execute(`(${node.source})`,state,{capture,input:options.input});
      append(execution);
      state.lastStatus = execution.status;
      continue;
    }
    if (node.type === "loop") {
      const previousReadLines = state.readLines;
      let ranBody = false;
      state.loopDepth++;
      try {
        if (node.input !== null) {
          const parsed = parse(`__input ${node.input}`)[0]?.pipeline[0];
          const operand = (await expandWord(parsed.words[1], state, { single: true }))[0];
          const path = isAbsolute(nativePath(operand)) ? nativePath(operand) : resolvePath(nativePath(state.cwd), nativePath(operand));
          const text = await Bun.file(path).text();
          state.readLines = text.split("\n");
          if (state.readLines.at(-1) === "") state.readLines.pop();
        }
        while (true) {
          const checked = await execute(node.condition, state, { capture, errexitIgnored:true });
          append(checked);
          const proceed = node.kind === "until" ? checked.status !== 0 : checked.status === 0;
          if (!proceed || state.exitRequested) {
            if (!ranBody) execution = result();
            break;
          }
          execution = await executeNodeList(node.body, state, { capture });
          ranBody = true;
          append(execution);
          if (state.exitRequested || consumeLoopFlow(state)) break;
        }
      } catch (error) {
        execution = result(1, "", `bunmsh: ${error.message}\n`);
        append(execution);
      } finally {
        state.loopDepth--;
        state.readLines = previousReadLines;
      }
      state.lastStatus = execution.status;
      continue;
    }
    if (node.type === "for") {
      let values;
      if (node.words === null) values = state.args.slice(1);
      else {
        const parsed = parse(`__for ${node.words}`)[0]?.pipeline[0];
        values = [];
        for (const word of parsed?.words.slice(1) ?? []) values.push(...await expandWord(word, state));
      }
      execution = result();
      state.loopDepth++;
      try { for (const value of values) {
        if (state.readonly.has(node.name)) { execution = readonlyError(node.name); break; }
        state.env[node.name] = value;
        execution = await executeNodeList(node.body, state, { capture });
        append(execution);
        if (state.exitRequested || consumeLoopFlow(state)) break;
      } } finally { state.loopDepth--; }
      state.lastStatus = execution.status;
      continue;
    }
    if (node.type === "case") {
      const parsed = parse(`__case ${node.word}`)[0]?.pipeline[0];
      const value = (await expandWord(parsed.words[1], state, { single: true }))[0] ?? "";
      execution = result();
      let fallThrough = false;
      for (const arm of node.arms) {
        let matches = fallThrough;
        if (!matches) for (const pattern of arm.patterns) {
          if ((await casePatternRegex(pattern, state)).test(value)) { matches = true; break; }
        }
        if (!matches) continue;
        execution = await executeNodeList(arm.body, state, { capture });
        append(execution);
        if (arm.terminator === ";&") { fallThrough = true; continue; }
        if (arm.terminator === ";|") { fallThrough = false; continue; }
        break;
      }
      state.lastStatus = execution.status;
      continue;
    }
    let selected = null;
    let selectedThen = "";
    for (const branch of node.branches) {
      let condition = branch.condition.trim();
      const checked = await execute(condition, state, { capture, errexitIgnored:true });
      append(checked);
      if (checked.status === 0) {
        selected = branch.body;
        selectedThen = branch.thenCommand ?? "";
        break;
      }
    }
    if (selectedThen) {
      const initial = await execute(selectedThen, state, { capture });
      append(initial);
    }
    execution = selected
      ? await executeNodeList(selected, state, { capture })
      : await executeNodeList(node.otherwise, state, { capture });
    append(execution);
    state.lastStatus = execution.status;
  }
  return result(execution.status, concatBytes(stdout), concatBytes(stderr));
}

async function executeFunction(name, argv, state) {
  const previousArgs = state.args;
  const previousLoopDepth = state.loopDepth;
  state.loopDepth = 0;
  state.args = [previousArgs[0], ...argv.slice(1)];
  state.returnDepth++;
  try { return await executeNodeList(state.functions[name], state); }
  finally {
    state.returnDepth--;
    state.loopDepth = previousLoopDepth;
    if (state.flow?.kind === "return") state.flow = null;
    state.args = previousArgs;
  }
}

async function runExternal(
  argv,
  state,
  input,
  captureStdout,
  captureStderr,
  stdoutSink = null,
  runtimeOptions = {},
) {
  // The shell language always exposes forward slashes. Only the executable
  // pathname needs native separators at the Windows process boundary.
  const spawnArgv = process.platform === "win32" && argv[0].includes("/")
    ? [nativePath(argv[0]), ...argv.slice(1)]
    : argv;
  const options = {
    cmd: spawnArgv,
    cwd: nativePath(state.cwd),
    env: externalEnvironment(state),
    stdin: runtimeOptions.background ? "ignore" : input === null ? "inherit" : input,
    stdout: runtimeOptions.background ? "inherit" : captureStdout || stdoutSink ? "pipe" : "inherit",
    stderr: runtimeOptions.background ? "inherit" : captureStderr || runtimeOptions.stderrSink ? "pipe" : "inherit",
    onExit(proc, exitCode, signalCode, error) {
      runtimeOptions.onExit?.(proc, exitCode, signalCode, error);
    },
  };
  let stateDirectory;
  try {
    if (options.env[PIPELINE_STATE_ENV] === "@current")
      options.env[PIPELINE_STATE_ENV] = pipelineBuiltinState(state).env[PIPELINE_STATE_ENV];
    const serialized = options.env[PIPELINE_STATE_ENV];
    if (serialized?.length > 2048 && !runtimeOptions.background) {
      stateDirectory = mkdtempSync(resolvePath(tmpdir(), "bunmsh-state-"));
      const file = resolvePath(stateDirectory, "state.json");
      writeFileSync(file, serialized, {mode:0o600});
      options.env = {...options.env, [PIPELINE_STATE_ENV]: `@file:${file}`};
    }
    if (!runtimeOptions.background) {
      options.stdout = runtimeOptions.stdoutFd ?? options.stdout;
      options.stderr = runtimeOptions.stderrFd ?? options.stderr;
      const extra = Object.keys(state.fdBindings ?? {}).map(Number).filter(n => n > 2);
      if (extra.length) {
        options.stdio = [options.stdin, options.stdout, options.stderr];
        for (let n = 3; n <= Math.max(...extra); n++) {
          const endpoint = state.fdBindings[n];
          options.stdio[n] = endpoint?.fd ?? endpoint?.channel ?? "ignore";
        }
        delete options.stdin; delete options.stdout; delete options.stderr;
      }
    }
    const proc = Bun.spawn(options);
    if (runtimeOptions.background) {
      if (!Array.isArray(Bun.sha.procs)) Bun.sha.procs = [];
      Bun.sha.procs.push(proc);
      proc.unref();
      const index = Bun.sha.procs.length - 1;
      return result(0, "", `[${index + 1}] ${proc.pid} Bun.sha.procs[${index}]\n`);
    }
    const pipelineKillSignal = runtimeOptions.pipelineKillSignal ?? "SIGPIPE";
    // A downstream pipeline stage that closes early (for example `head -n 3`)
    // leaves nothing reading the other end of `stdoutSink`/`stderrSink` (a
    // link's readable side, fed as the next stage's stdin). Bun never
    // releases the reader lock it holds on that side even once the process
    // reading it has exited, so a write already in flight into it (from the
    // pipeTo() calls below) backpressures forever instead of settling, and
    // there is no way to cancel or abort it from out here to unstick it —
    // every avenue requires a lock only Bun's own, already-exited consumer
    // holds. So this does not wait for that write to actually finish once
    // the caller (see onSpawn below) says the downstream stage is done;
    // it is abandoned in place, harmless since the killed process here
    // will not produce anything more for it to forward anyway.
    const abandonStreaming = new Promise((resolve) => {
      runtimeOptions.onSpawn?.(proc, pipelineKillSignal, resolve);
    });
    const sharedSink = stdoutSink && stdoutSink === runtimeOptions.stderrSink;
    const sharedStreamPromise = sharedSink ? Promise.race([
      (async()=>{
        const writer=stdoutSink.getWriter();
        const pump=async stream=>{const reader=stream.getReader();try{while(true){const chunk=await reader.read();if(chunk.done)break;await writer.write(chunk.value);}}finally{reader.releaseLock();}};
        try {await Promise.all([pump(proc.stdout),pump(proc.stderr)]);await writer.close();}
        catch {try{proc.kill(pipelineKillSignal);}catch{}}
        finally {writer.releaseLock();}
      })(),
      abandonStreaming,
    ]) : Promise.resolve();
    const outputPromise = captureStdout && !stdoutSink
      ? new Response(proc.stdout).arrayBuffer()
      : Promise.resolve(new ArrayBuffer(0));
    const streamPromise = stdoutSink && !sharedSink
      ? Promise.race([
          proc.stdout.pipeTo(stdoutSink).catch(() => {
            try { proc.kill(pipelineKillSignal); } catch {}
          }),
          abandonStreaming,
        ])
      : Promise.resolve();
    const errorStreamPromise = runtimeOptions.stderrSink && !sharedSink
      ? Promise.race([
          proc.stderr.pipeTo(runtimeOptions.stderrSink).catch(() => {}),
          abandonStreaming,
        ])
      : Promise.resolve();
    const errorPromise = captureStderr && !runtimeOptions.stderrSink
      ? new Response(proc.stderr).arrayBuffer()
      : Promise.resolve(new ArrayBuffer(0));
    const [status, output, error] = await Promise.all([
      proc.exited,
      outputPromise,
      errorPromise,
      streamPromise,
      errorStreamPromise,
      sharedStreamPromise,
    ]);
    const execution = result(status, new Uint8Array(output), new Uint8Array(error));
    execution.stdoutStreamed = Boolean(stdoutSink || runtimeOptions.stderrSink);
    execution.stderrStreamed = Boolean(runtimeOptions.stderrSink);
    return execution;
  } catch (error) {
    return result(127, "", `bunmsh: ${argv[0]}: ${error.message}\n`);
  } finally {
    if (stateDirectory) {
      try { unlinkSync(resolvePath(stateDirectory,"state.json")); rmdirSync(stateDirectory); } catch {}
    }
  }
}

function runsInPipelineSubprocess(argv, state) {
  if (["command", "builtin", "__builtin", "time"].includes(argv[0])) return true;
  if (Object.hasOwn(builtins, argv[0])) return true;
  if (Object.hasOwn(state.functions, argv[0])) return true;
  return !argv[0].includes("/") &&
    Object.hasOwn(fallbackBuiltins, argv[0]) &&
    !findExecutable(argv[0], state);
}

function pipelineBuiltinArgv(argv) {
  return IS_COMPILED
    ? [...EXECUTABLE_COMMAND, "-cc", ...argv]
    : [...BUN_RUNTIME_COMMAND, BUNMSH_ENTRY, "-cc", ...argv];
}

function pipelineCompoundArgv(source) {
  return IS_COMPILED
    ? [...EXECUTABLE_COMMAND, "-c", source]
    : [...BUN_RUNTIME_COMMAND, BUNMSH_ENTRY, "-c", source];
}

function heredocRanges(source, tokens = tokenize(source)) {
  const ranges = new Map();
  let previousEnd = 0;
  for (const token of tokens) {
    if (!token.heredoc) continue;
    const delimiter = token.fragments.map(f=>f.text.replaceAll("\u0000", "")).join("");
    const start = Math.max(source.indexOf("\n",token.offset)+1, previousEnd);
    if (!start) continue;
    let end=start;
    while (end < source.length) {
      const newline=source.indexOf("\n",end);
      const lineEnd=newline<0 ? source.length : newline;
      const line=source.slice(end,lineEnd);
      end=newline<0 ? source.length : newline+1;
      if (line === delimiter || line.replace(/^\t+/,"") === delimiter) break;
    }
    ranges.set(start,end); previousEnd=end;
  }
  return ranges;
}

function leadingSubshell(source) {
  const leading = source.length - source.trimStart().length;
  if (source[leading] !== "(") return null;
  let depth = 0, quote = null;
  let keywords, ranges;
  try { const tokens=tokenize(source); keywords = caseKeywords(tokens); ranges=heredocRanges(source,tokens); } catch (error) {
    if (error.message.startsWith("unterminated")) return null;
    throw error;
  }
  const cases = [];
  for (let i = leading; i < source.length; i++) {
    if (ranges.has(i)) { i=ranges.get(i)-1; continue; }
    const ch = source[i];
    if (quote === "'") { if (ch === "'") quote = null; continue; }
    if (quote === '"') {
      if (ch === "\\" && /[\\"$`\n]/.test(source[i + 1] ?? "")) { i++; continue; }
      if (ch === '"') quote = null;
      continue;
    }
    if (ch === "#" && (i === leading || /[\s;|&]/.test(source[i-1]))) {
      const end=source.indexOf("\n",i); if (end<0) return null; i=end; continue;
    }
    const keyword=keywords.get(i);
    if (keyword === "case") cases.push("head");
    else if (keyword === "esac") cases.pop();
    if (cases.at(-1) === "head" && source.slice(i).match(/^in(?:\s|$)/) && /\s/.test(source[i-1] ?? "")) cases[cases.length-1]="pattern";
    if (cases.at(-1) === "body" && source.startsWith(";;",i)) cases[cases.length-1]="pattern";
    if (ch === "\\") { i++; continue; }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "`") {
      try { i = substitutionEnd(source, i) - 1; } catch { return null; }
      continue;
    }
    if (ch === "$" && source[i + 1] === "(") {
      try { i = substitutionEnd(source, i) - 1; } catch { return null; }
      continue;
    }
    if (cases.at(-1) === "pattern" && (ch === "(" || ch === ")")) {
      if (ch === ")") cases[cases.length-1]="body";
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0)
      return { body: source.slice(leading + 1, i), suffix: source.slice(i + 1) };
  }
  return null;
}

function rewriteSubshells(source, state) {
  let output = "", quote = null;
  const ranges=heredocRanges(source);
  for (let i = 0; i < source.length;) {
    if (ranges.has(i)) { const end=ranges.get(i); output+=source.slice(i,end); i=end; continue; }
    const ch = source[i];
    if (quote === "'") {
      output += ch;
      if (ch === "'") quote = null;
      i++;
      continue;
    }
    if (quote === '"') {
      output += ch;
      if (ch === "\\" && /[\\"$`\n]/.test(source[i + 1] ?? "")) output += source[++i];
      else if (ch === '"') quote = null;
      i++;
      continue;
    }
    if (ch === "\\") { output += source.slice(i, i + 2); i += 2; continue; }
    if (ch === "'" || ch === '"') { quote = ch; output += ch; i++; continue; }
    if (ch === "`") {
      try { const end = substitutionEnd(source, i); output += source.slice(i, end); i = end; continue; }
      catch { output += ch; i++; continue; }
    }
    if (ch === "$" && source[i + 1] === "(") {
      try { const end = substitutionEnd(source, i); output += source.slice(i, end); i = end; continue; }
      catch { output += ch; i++; continue; }
    }
    const boundary = i === 0 || /[\s;|&]/.test(source[i - 1]);
    if (ch === "(" && boundary) {
      const group = leadingSubshell(source.slice(i));
      if (group) {
        const argv = pipelineCompoundArgv(group.body);
        // Snapshot only when this command runs: earlier commands in the same
        // list may still change variables, functions, options or positional args.
        output += `BUNMSH_INTERNAL_PIPELINE_STATE=@current ${argv.map(quoteShellWord).join(" ")}`;
        i += group.body.length + 2;
        continue;
      }
    }
    output += ch;
    i++;
  }
  return output;
}

function pipelineBuiltinState(state) {
  return {
    ...state,
    env: {
      ...state.env,
      [PIPELINE_STATE_ENV]: JSON.stringify({
        env: Object.fromEntries(Object.entries(state.env).filter(([name]) => name !== PIPELINE_STATE_ENV)),
        exported: [...state.exported],
        aliases: state.aliases,
        functions: state.functions,
        readonly: [...state.readonly],
        args: state.args,
        pathSearch: state.pathSearch,
        shellOptions:state.shellOptions,
        ignoreErrexit:state.ignoreErrexit,
        fdBindings: Object.fromEntries(Object.entries(state.fdBindings ?? {}).filter(([n]) => Number(n)>2).map(([n,v]) => [n, v.fd === undefined ? v : {fd:Number(n)}])),
      }),
    },
  };
}

function closedPipe(error) {
  const code = error?.code ?? error?.cause?.code;
  return code === "EPIPE" || code === "ECONNRESET" ||
    /broken pipe|closed pipe|connection reset/i.test(error?.message ?? "");
}

async function runYes(argv) {
  const line = `${argv.length > 1 ? argv.slice(1).join(" ") : "y"}\n`;
  const repetitions = Math.max(1, Math.floor(8192 / Math.max(1, bytes(line).byteLength)));
  const chunk = bytes(line.repeat(repetitions));
  const writer = Bun.stdout.writer();
  try {
    while (true) {
      writer.write(chunk);
      await writer.flush();
    }
  } catch (error) {
    if (!closedPipe(error)) throw error;
  } finally {
    try { writer.end(); } catch {}
  }
  return result();
}

function parseCommandOptions(argv) {
  let defaultPath = false;
  let query = null;
  let i = 1;
  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      i++;
      break;
    }
    if (arg === "-" || !arg.startsWith("-")) break;
    for (const option of arg.slice(1)) {
      if (option === "p") defaultPath = true;
      else if (option === "v" || option === "V") query = option;
      else return { error: option };
    }
  }
  return { defaultPath, query, operands: argv.slice(i) };
}

function describeCommand(name, state, verbose, defaultPath) {
  const alias = state.aliases[name];
  if (alias) {
    const definition = quoteShellWord(alias.join(" "));
    return verbose
      ? `${name} is an alias for ${definition}\n`
      : `alias ${name}=${definition}\n`;
  }
  if (Object.hasOwn(builtins, name))
    return verbose ? `${name} is a shell builtin\n` : `${name}\n`;
  const path = findExecutable(name, state, defaultPath);
  if (path) return verbose ? `${name} is ${path}\n` : `${path}\n`;
  if (Object.hasOwn(fallbackBuiltins, name))
    return verbose ? `${name} is a fallback shell builtin\n` : `${name}\n`;
  return verbose ? `${name} not found\n` : null;
}

async function runCommandArgv(
  argv,
  state,
  input,
  captureStdout,
  captureStderr,
  options = {},
) {
  let commandArgv =  argv;
  
  if( process.env.BUNMSH_LEADING_AND || 
      process.platform === "win32" )
  {
    if(argv[0] === "&")
      commandArgv = argv.slice(1) ;
  }

  if (options.background && (
    options.pipelineStage ||
    ["command", "builtin", "__builtin", "time", "yes"].includes(commandArgv[0]) ||
    Object.hasOwn(state.functions, commandArgv[0]) ||
    Object.hasOwn(builtins, commandArgv[0]) ||
    (!commandArgv[0].includes("/") && Object.hasOwn(fallbackBuiltins, commandArgv[0]) &&
      !findExecutable(commandArgv[0], state))
  )) return result(2, "", "bunmsh: &: only a single external command is supported\n");
  
  let commandState = state;
  const ioCommand = ["builtin", "__builtin", "command"].includes(commandArgv[0])
    ? commandArgv.slice(1).filter(arg => arg !== "--")[0] : commandArgv[0];
  const redirectedStream = (options.stdoutFd !== undefined || options.stderrFd !== undefined) &&
    !Object.hasOwn(state.functions, ioCommand) &&
    (ioCommand === "yes" || Object.hasOwn(fallbackBuiltins, ioCommand));
  if ((options.pipelineStage || redirectedStream) && runsInPipelineSubprocess(commandArgv, commandState))
    return runExternal(
      pipelineBuiltinArgv(commandArgv),
      pipelineBuiltinState(commandState),
      input,
      captureStdout,
      captureStderr,
      options.stdoutSink,
      { ...options, pipelineKillSignal: "SIGTERM" },
    );
  if (typeof input === "number" && ioCommand !== "read" && runsInPipelineSubprocess(commandArgv,commandState))
    input = Readable.toWeb(createReadStream("",{fd:input,autoClose:false}));
  while (["command", "builtin", "__builtin"].includes(commandArgv[0])) {
    if (requestsBuiltinHelp(commandArgv) && hasBuiltinHelp(commandArgv[0]))
      return builtinHelp(commandArgv[0]);
    if (commandArgv[0] !== "command") {
      const builtinName = commandArgv[0];
      const start = commandArgv[1] === "--" ? 2 : 1;
      if (start >= commandArgv.length) {
        if (builtinName === "builtin")
          return result(0, `${builtinNames().join("\n")}\n`);
        return result();
      }
      commandArgv = commandArgv.slice(start);
      if (!Object.hasOwn(builtins, commandArgv[0]) &&
          !Object.hasOwn(fallbackBuiltins, commandArgv[0]))
        return result(1, "", `bunmsh: builtin: ${commandArgv[0]}: not found\n`);
      if (requestsBuiltinHelp(commandArgv) && hasBuiltinHelp(commandArgv[0]))
        return builtinHelp(commandArgv[0]);
      if (!["command", "builtin", "__builtin", "time", "yes"].includes(commandArgv[0]))
        return (builtins[commandArgv[0]] ?? fallbackBuiltins[commandArgv[0]])(
          commandArgv,
          commandState,
          input,
          { captureStdout, captureStderr, options },
        );
      continue;
    }
    const parsed = parseCommandOptions(commandArgv);
    if (parsed.error)
      return result(1, "", `bunmsh: command: -${parsed.error}: unknown option\n`);
    if (parsed.query) {
      let status = 0;
      let output = "";
      for (const name of parsed.operands) {
        const description = describeCommand(
          name,
          commandState,
          parsed.query === "V",
          parsed.defaultPath,
        );
        if (description === null || description.endsWith(" not found\n")) status = 1;
        if (description !== null) output += description;
        if (status && parsed.query === "v") break;
      }
      return result(status, output);
    }
    if (parsed.operands.length === 0) return result();
    commandArgv = parsed.operands;
    if (parsed.defaultPath) {
      commandState = { ...commandState, env: { ...commandState.env, PATH: DEFAULT_COMMAND_PATH } };
    }
  }
  if (requestsBuiltinHelp(commandArgv) && hasBuiltinHelp(commandArgv[0]) &&
      (Object.hasOwn(builtins, commandArgv[0]) ||
       (!findExecutable(commandArgv[0], commandState) &&
        Object.hasOwn(fallbackBuiltins, commandArgv[0]))))
    return builtinHelp(commandArgv[0]);
  if (commandArgv[0] === "time") {
    const started = Bun.nanoseconds();
    const execution = commandArgv.length === 1
      ? result()
      : await runCommandArgv(
          commandArgv.slice(1),
          commandState,
          input,
          captureStdout,
          captureStderr,
        );
    const milliseconds = (Bun.nanoseconds() - started) / 1_000_000;
    execution.stderr = concatBytes([
      execution.stderr,
      `real ${formatMilliseconds(milliseconds)} ms\n`,
    ]);
    return execution;
  }
  if (commandArgv[0] === "yes") return runYes(commandArgv);
  if (Object.hasOwn(commandState.functions, commandArgv[0]))
    return executeFunction(commandArgv[0], commandArgv, commandState);
  if (Object.hasOwn(builtins, commandArgv[0]))
    return builtins[commandArgv[0]](
      commandArgv,
      commandState,
      input,
      { captureStdout, captureStderr, options },
    );
  if (!commandArgv[0].includes("/") && Object.hasOwn(fallbackBuiltins, commandArgv[0]) &&
      !findExecutable(commandArgv[0], commandState))
    return fallbackBuiltins[commandArgv[0]](
      commandArgv,
      commandState,
      input,
      { captureStdout, captureStderr, options },
    );
  if (!commandState.pathSearch && !commandArgv[0].includes("/"))
    return result(127, "", `bunmsh: ${commandArgv[0]}: not found\n`);
  return runExternal(
    commandArgv,
    commandState,
    input,
    captureStdout,
    captureStderr,
    options.stdoutSink,
    options,
  );
}

// Mirrors the double-quote scanning in tokenize(): an unquoted heredoc body
// only lets backslash escape $, `, \, and a trailing newline before the rest
// goes through the normal $/`` expansion pipeline.
function heredocLiteralPass(text) {
  let output = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "\\" && i + 1 < text.length) {
      const next = text[i + 1];
      if (next === "$" || next === "\\" || next === "`" || next === "\n") {
        if (next !== "\n") output += `\u0000${next}`;
        i += 2;
        continue;
      }
    }
    if ((text[i] === "$" && ["(", "{"].includes(text[i + 1])) || text[i] === "`") {
      const end = text[i + 1] === "{" ? parameterEnd(text, i) : substitutionEnd(text, i);
      output += text.slice(i, end);
      i = end;
      continue;
    }
    output += text[i++];
  }
  return output;
}

function redirectHeredoc(content) {
  return new Response(bytes(content)).body;
}

async function runCommand(command, state, options = {}) {
  state.expansionStatus = null;
  if (command.lineNumber != null) state.lineNumber = command.lineNumber;
  const standaloneTilde =
    command.words.length === 1 &&
    command.words[0].fragments.length === 1 &&
    command.words[0].fragments[0].quote === "none" &&
    command.words[0].fragments[0].text === "~";
  let assignmentPrefix = true;
  let aliasEligible = false;
  const expanded = standaloneTilde ? ["~"] : [];
  if (!standaloneTilde) {
    for (const word of command.words) {
      const literal = word.fragments.map((fragment) => fragment.text.replaceAll("\u0000", "")).join("");
      const assignment = assignmentPrefix && /^[A-Za-z_][A-Za-z0-9_]*=/.test(literal);
      expanded.push(...await expandWord(word, state, { single: assignment, assignment }));
      if (!assignment) {
        if (assignmentPrefix)
          aliasEligible = word.fragments.every((fragment) =>
            fragment.quote === "none" && !fragment.text.includes("\u0000"));
        assignmentPrefix = false;
      }
    }
  }
  const localEnv = {};
  while (expanded.length) {
    const assignment = splitAssignment(expanded[0]);
    if (!assignment) break;
    localEnv[assignment.name] = assignment.value;
    expanded.shift();
  }
  const assignmentOnly = expanded.length === 0;
  if (assignmentOnly) {
    for (const name of Object.keys(localEnv))
      if (state.readonly.has(name)) return readonlyError(name);
    Object.assign(state.env, localEnv);
    if (!command.redirects.length) return result(state.expansionStatus ?? 0);
    expanded.push(":");
  }
  const alias = aliasEligible ? state.aliases[expanded[0]] : null;
  if (alias) expanded.splice(0, 1, ...alias);

  const prefixSaved = new Map();
  const special = [":", ".", "break", "continue", "eval", "exec", "exit", "export", "readonly", "return", "set", "shift", "trap", "unset"].includes(expanded[0]);
  const temporaryPrefix = state.shellOptions.posix && !assignmentOnly && !special;
  const previousBindings = state.fdBindings;
  const bindings = {...previousBindings};
  if (options.stdoutSink) bindings[1] = {channel:1};
  if (options.input !== null && options.input !== undefined) delete bindings[0];
  const opened = [];
  const redirectedFds = new Set();
  let input = options.input ?? null;
  let persistent = expanded[0] === "exec" && expanded.length === 1;
  try {
    for (const redirect of command.redirects) {
      if (["<<", "<<-", "<<<"].includes(redirect.op)) {
        redirectedFds.add(0);
        let content;
        if (redirect.op === "<<<") content = `${(await expandWord(redirect.target,state,{single:true,noTilde:true}))[0]}\n`;
        else {
          const heredoc = redirect.heredoc ?? {body:"",expand:false};
          content = heredoc.expand ? stripExpansionMarkers((await expandText(heredocLiteralPass(heredoc.body),state)).replaceAll("\u0000","")) : heredoc.body;
        }
        bindings[0] = {content};
        continue;
      }
      const dup = /^(\d+)([<>]&)(\d+|-)$/.exec(redirect.op);
      const match = /^(\d*)(>&|<&|<>|>>|>|<)$/.exec(redirect.op);
      if (!dup && !match) throw new Error(`unsupported redirection ${redirect.op}`);
      const op = dup ? dup[2] : match[2];
      const fd = Number((dup ? dup[1] : match[1]) || (op.startsWith("<") ? 0 : 1));
      redirectedFds.add(fd);
      if (fd > 1023) throw new Error("file descriptor out of range");
      const target = dup ? dup[3] : (await expandWord(redirect.target,state,{single:true}))[0];
      if (op.endsWith("&")) {
        if (target === "-") bindings[fd] = {closed:true};
        else {
          if (!/^\d+$/.test(target)) throw new Error(`${target}: bad file descriptor`);
          const from = bindings[Number(target)] ?? (Number(target) <= 2 ? {channel:Number(target)} : null);
          if (!from || from.closed) throw new Error(`${target}: bad file descriptor`);
          bindings[fd] = from;
        }
      } else {
        const path = isAbsolute(nativePath(target)) ? nativePath(target) : resolvePath(nativePath(state.cwd),nativePath(target));
        const handle = openSync(path, op === "<" ? "r" : op === ">>" ? "a" : op === "<>" ? fsConstants.O_RDWR | fsConstants.O_CREAT : "w");
        opened.push(handle);
        bindings[fd] = {fd:handle};
      }
    }
    const commandState = options.subshell ? {...state,env:{...state.env,...localEnv},exported:new Set(state.exported),fdBindings:bindings,flow:null,loopDepth:0,returnDepth:0} : state;
    if (!options.subshell) {
      for (const name of Object.keys(localEnv)) if (state.readonly.has(name)) return readonlyError(name);
      // Internal subprocess transport is command-scoped in both modes.
      // Otherwise an unrelated later shell inherits the parent's functions/options.
      for (const name of Object.keys(localEnv)) if (temporaryPrefix || name === PIPELINE_STATE_ENV)
        prefixSaved.set(name, {present:Object.hasOwn(state.env,name),value:state.env[name],exported:state.exported.has(name)});
      Object.assign(commandState.env,localEnv);
    }
    if (!assignmentOnly) for (const name of Object.keys(localEnv)) commandState.exported.add(name);
    commandState.fdBindings = bindings;
    if (persistent) {
      for (const fd of opened) state.ownedFds.add(fd);
      return result();
    }
    const stdin = bindings[0];
    if (stdin?.content !== undefined) input = redirectHeredoc(stdin.content);
    else if (stdin?.closed) input = redirectHeredoc("");
    else if (stdin?.fd !== undefined) input = stdin.fd;
    if (state.shellOptions.x) {
      const line = bytes(`${state.env.PS4 ?? "+ "}${expanded.join(" ")}\n`);
      const traceFd = bindings[2];
      if (traceFd?.fd !== undefined) writeSync(traceFd.fd,line);
      else await writeStream(process.stderr,line);
    }
    const nested = Boolean(command.body) || Object.hasOwn(commandState.functions,expanded[0]) || ["eval",".","source"].includes(expanded[0]);
    const stdout = bindings[1] ?? {channel:1};
    const stderr = bindings[2] ?? {channel:2};
    const direct = (endpoint) => endpoint.fd !== undefined || endpoint.closed;
    const execution = command.body ? await executeNodeList(command.body,commandState,{capture:true,input}) : await runCommandArgv(expanded,commandState,input,
      direct(stdout) ? false : Boolean(options.captureStdout || stdout.channel !== 1),
      direct(stderr) ? false : Boolean(options.captureStderr || stderr.channel !== 2), {
        ...options,
        pipelineStage: Boolean(options.pipelineStage),
        stdoutSink: !direct(stdout)&&stdout.channel===1 ? options.stdoutSink : null,
        stderrSink: !direct(stderr)&&stderr.channel===1 ? options.stdoutSink : null,
        stdoutFd: stdout.fd ?? (stdout.closed ? "ignore" : undefined),
        stderrFd: stderr.fd ?? (stderr.closed ? "ignore" : undefined),
      });
    if (!nested) routeCommandOutput(execution, bindings);
    return execution;
  } catch (error) {
    persistent = false;
    return result(1,"",`bunmsh: ${error.message}\n`);
  } finally {
    for (const [name,saved] of prefixSaved) {
      if (saved.present) state.env[name]=saved.value; else delete state.env[name];
      if (saved.exported) state.exported.add(name); else state.exported.delete(name);
    }
    if (!persistent) {
      if (options.subshell) state.fdBindings = previousBindings;
      else if (command.redirects.length) {
        // Restore just the redirected descriptors (mksh's savedfd scope),
        // not descriptors opened independently by exec inside the body.
        const restored = {...state.fdBindings};
        for (const fd of redirectedFds) {
          if (Object.hasOwn(previousBindings,fd)) restored[fd] = previousBindings[fd];
          else delete restored[fd];
        }
        state.fdBindings = restored;
      }
      for (const fd of opened) {
        if (Object.values(state.fdBindings).some(endpoint => endpoint.fd === fd)) state.ownedFds.add(fd);
        else { try { closeSync(fd); } catch {} }
      }
    }
  }

}

async function runPipeline(pipeline, state, options = {}) {
  if (options.background && (pipeline.length !== 1 || pipeline[0].redirects.length !== 0))
    return result(2, "", "bunmsh: &: only a single external command without redirections is supported\n");
  if (pipeline.length === 1)
    return runCommand(pipeline[0], state, {
      input: options.input ?? null,
      stdoutSink: options.stdoutSink ?? null,
      captureStdout: Boolean(options.capture),
      captureStderr: Boolean(options.capture),
      background: Boolean(options.background),
    });

  const links = Array.from(
    { length: pipeline.length - 1 },
    () => new TransformStream(),
  );
  const linksConnected = links.map((_, i) => {
    const stdoutRedirected = pipeline[i].redirects.some((redirect) =>
      /^(?:1)?>(?:>|&.*)?$/.test(redirect.op));
    const stdinRedirected = pipeline[i + 1].redirects.some((redirect) =>
      /^(?:0)?<(?:<<?-?|&.*|>)?$/.test(redirect.op));
    return !stdoutRedirected && !stdinRedirected;
  });
  const processes = Array(pipeline.length).fill(null);
  const finished = Array(pipeline.length).fill(false);
  const stopUpstream = (index) => {
    if (index < 0 || !linksConnected[index]) return;
    const processInfo = processes[index];
    if (processInfo) {
      try { processInfo.proc.kill(processInfo.signal); } catch {}
      // Killing the process only stops it from producing more output. Its
      // own `proc.stdout.pipeTo()` forwarding that output into this link can
      // still be stuck mid-write, backpressured forever with nobody left to
      // read the link's other end now that the downstream stage is done —
      // see runExternal for why that write can't be canceled directly.
      // This just stops waiting on it instead.
      try { processInfo.detachStream(); } catch {}
    }
  };
  const stages = pipeline.map((command, i) => {
    const last = i === pipeline.length - 1;
    return runCommand(command, state, {
      input: i === 0 ? options.input ?? null : links[i - 1].readable,
      captureStdout: last && Boolean(options.capture),
      captureStderr: Boolean(options.capture),
      stdoutSink: last ? null : links[i].writable,
      pipelineStage: true,
      subshell: true,
      onSpawn(proc, signal, detachStream) {
        processes[i] = { proc, signal, detachStream };
        if (finished[i + 1]) stopUpstream(i);
      },
      onExit() {
        finished[i] = true;
        stopUpstream(i - 1);
      },
    }).then(async (execution) => {
      // Redirected commands and any future buffered pipeline stages do not
      // consume stdoutSink themselves. Forward their finite result and close
      // the link here. Streaming subprocesses already closed it via pipeTo().
      if (!last && !execution.stdoutStreamed) {
        const writer = links[i].writable.getWriter();
        try {
          if (execution.stdout.byteLength) await writer.write(execution.stdout);
          await writer.close();
        } catch {}
      }
      return execution;
    }).finally(() => {
      finished[i] = true;
      stopUpstream(i - 1);
    });
  });
  const executions = await Promise.all(stages);
  const final = executions.at(-1);
  if (options.capture) {
    final.stderr = concatBytes(executions.map((execution) => execution.stderr));
  }
  return final;
}

export async function execute(source, state = createState(), io = {}) {
  const previous = state.ignoreErrexit;
  if (io.errexitIgnored) state.ignoreErrexit++;
  try { return await executeInternal(source,state,io); }
  catch (error) {
    const failure = result(state.exitRequested ? state.exitStatus : 2,"",`bunmsh: ${error.message}\n`);
    if (!io.capture) await writeStream(process.stderr,failure.stderr);
    return failure;
  }
  finally { state.ignoreErrexit = previous; }
}

async function executeInternal(source, state, io) {
  source = normalizeSource(source);
  if (source === "?") {
    const execution = result(0, `${state.lastStatus}\n`);
    state.lastStatus = 0;
    if (!io.capture) await writeStream(process.stdout, execution.stdout);
    return execution;
  }
  const rawSource = source.trimStart();
  const group = leadingSubshell(source);
  if (group) {
    const previous = state.env[PIPELINE_STATE_ENV];
    try { return await execute(rewriteSubshells(source,state),state,io); }
    finally {
      if (previous === undefined) delete state.env[PIPELINE_STATE_ENV];
      else state.env[PIPELINE_STATE_ENV] = previous;
    }
  }
  if (isJavaScriptMode(rawSource)) {
    let execution;
    const previousCwd = process.cwd();
    try {
      try {
        process.chdir(nativePath(state.cwd));
        
        const $ = state.env
        
        const value = await eval(rawSource);
        execution = result(0, value === undefined ? "" : `${formatValue(value)}\n`);
      } finally {
        process.chdir(previousCwd);
      }
    } catch (error) {
      execution = result(1, "", `${error?.stack ?? formatValue(error)}\n`);
    }
    state.lastStatus = execution.status;
    if (!io.capture) {
      if (execution.stdout.byteLength) await writeStream(process.stdout, execution.stdout);
      if (execution.stderr.byteLength) await writeStream(process.stderr, execution.stderr);
    }
    return execution;
  }
  const lines = source.match(/.*(?:\n|$)/g)?.filter(Boolean) ?? [];
  if (lines.some((line) => isJavaScriptMode(line))) {
    const parts = [];
    let shellSource = "";
    for (const line of lines) {
      if (!isJavaScriptMode(line)) {
        shellSource += line;
        continue;
      }
      // Only split at a valid top-level shell boundary. This prevents a
      // Bun.-looking line inside an open quote or $(...) from escaping its
      // surrounding shell construct.
      try {
        if (shellSource.trim()) parse(shellSource);
      } catch {
        shellSource += line;
        continue;
      }
      if (shellSource.trim()) parts.push(shellSource);
      parts.push(line.replace(/\n$/, ""));
      shellSource = "";
    }
    if (shellSource.trim()) parts.push(shellSource);
    if (parts.length > 1) {
      let execution = result(state.lastStatus);
      const stdout = [], stderr = [];
      for (const part of parts) {
        execution = await execute(part, state, io);
        if (io.capture) {
          if (execution.stdout.byteLength) stdout.push(execution.stdout);
          if (execution.stderr.byteLength) stderr.push(execution.stderr);
        }
        if (state.exitRequested || state.flow) break;
      }
      return io.capture
        ? result(execution.status, concatBytes(stdout), concatBytes(stderr))
        : execution;
    }
  }
  let compoundSyntax = false;
  try { compoundSyntax = !io.simple && hasCompoundSyntax(source); } catch {}
  if (compoundSyntax) {
    let execution;
    try {
      execution = await executeNodeList(parseCompoundScript(source, io.firstLine ?? 1, io.sourceLines), state, {
        capture: Boolean(io.capture),
        input: io.input ?? null,
      });
    }
    catch (error) {
      const message = error instanceof ShellSyntaxError ? error.message : String(error);
      execution = result(2, "", `bunmsh: syntax error: ${message}\n`);
    }
    state.lastStatus = execution.status;
    if (!io.capture) {
      if (execution.stdout.byteLength) await writeStream(process.stdout, execution.stdout);
      if (execution.stderr.byteLength) await writeStream(process.stderr, execution.stderr);
    }
    return execution;
  }

  const withSubshells = rewriteSubshells(source, state);
  if (withSubshells !== source) {
    source = withSubshells;
    return execute(source, state, io);
  }

  let jobs;
  try {
    jobs = parse(source);
    for (const job of jobs) for (const command of job.pipeline) command.lineNumber = io.sourceLines?.[command.lineNumber-1] ?? command.lineNumber + (io.firstLine ?? 1) - 1;
  } catch (error) {
    const message = error instanceof ShellSyntaxError ? error.message : String(error);
    const output = `bunmsh: syntax error: ${message}\n`;
    if (io.capture) return result(2, "", output);
    console.error(output.trimEnd());
    state.lastStatus = 2;
    return result(2);
  }

  let execution = result(state.lastStatus);
  const capturedStdout = [];
  const capturedStderr = [];
  for (const [jobIndex,job] of jobs.entries()) {
    const trapped = await runPendingTraps(state,io);
    if (io.capture) { capturedStdout.push(trapped.stdout); capturedStderr.push(trapped.stderr); }
    if (state.exitRequested || state.flow) break;
    if (job.connector === "&&" && execution.status !== 0) continue;
    if (job.connector === "||" && execution.status === 0) continue;
    const ignored = state.ignoreErrexit || job.negate || ["&&","||"].includes(jobs[jobIndex+1]?.connector);
    const previousIgnore = state.ignoreErrexit;
    if (ignored) state.ignoreErrexit++;
    try { execution = await runPipeline(job.pipeline, state, {
      capture: io.capture,
      background: job.background,
      input: io.input ?? null,
      stdoutSink: io.stdoutSink ?? null,
    }); } catch (error) {
      execution = result(state.exitRequested ? state.exitStatus : 2,"",`bunmsh: ${error.message}\n`);
    } finally { state.ignoreErrexit = previousIgnore; }
    if (!ignored && state.shellOptions.e && execution.status && !state.flow) { state.exitRequested=true; state.exitStatus=execution.status; }
    if (job.negate) execution.status = execution.status === 0 ? 1 : 0;
    state.lastStatus = execution.status;
    if (execution.stdout.byteLength) {
      if (io.capture) capturedStdout.push(execution.stdout);
      else await writeStream(process.stdout, execution.stdout);
    }
    if (execution.stderr.byteLength) {
      if (io.capture) capturedStderr.push(execution.stderr);
      else await writeStream(process.stderr, execution.stderr);
    }
    if (state.exitRequested || state.flow) break;
  }
  return io.capture
    ? result(execution.status, concatBytes(capturedStdout), concatBytes(capturedStderr))
    : execution;
}

export async function executeArgv(argv, state = createState(), io = {}) {
  if (argv.length === 0)
    return result(2, "", "bunmsh: -cc requires a command\n");
  const commandArgv = [...argv];
  const execution = await runCommandArgv(
    commandArgv,
    state,
    null,
    Boolean(io.capture),
    Boolean(io.capture),
  );
  state.lastStatus = execution.status;
  if (!io.capture) {
    if (execution.stdout.byteLength) await writeStream(process.stdout, execution.stdout);
    if (execution.stderr.byteLength) await writeStream(process.stderr, execution.stderr);
  }
  return execution;
}

export function pipelineChildState() {
  const serialized = process.env[PIPELINE_STATE_ENV];
  if (!serialized) return createState();
  try {
    const inherited = JSON.parse(serialized.startsWith("@file:") ? readFileSync(serialized.slice(6),"utf8") : serialized);
    const env = { ...process.env, ...(inherited.env ?? {}) };
    delete env[PIPELINE_STATE_ENV];
    return createState({
      env,
      inheritEnvironment: false,
      exported: inherited.exported,
      cwd: process.cwd(),
      aliases: inherited.aliases,
      functions: inherited.functions,
      readonly: inherited.readonly,
      args: inherited.args,
      pathSearch: inherited.pathSearch,
      pipelineChild: true,
      fdBindings: inherited.fdBindings,
      shellOptions:inherited.shellOptions,
      ignoreErrexit:inherited.ignoreErrexit,
    });
  } catch {
    return createState();
  }
}

export function decode(data) {
  return decoder.decode(data);
}
