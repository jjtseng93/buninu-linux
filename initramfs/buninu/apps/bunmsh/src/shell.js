import {
  constants as fsConstants,
  accessSync,
  closeSync,
  chmodSync,
  createReadStream,
  createWriteStream,
  lstatSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmdirSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import {
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
import { Readable, Writable } from "node:stream";
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
      i += continuation;
      continue;
    }

    if (ch === "\n") {
      finishWord();
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

    const two = source.slice(i, i + 2);
    const fdDup = source.slice(i, i + 4);
    const operatorAhead =
      ["|", ";", "<", ">"].includes(ch) ||
      two === "&&" ||
      two === "||" ||
      two === "2>" ||
      fdDup === "1>&2" ||
      fdDup === "2>&1";
    if (current && operatorAhead) {
      finishWord();
      continue;
    }
    // A descriptor duplication begins with the shorter `2>` redirect token,
    // so it must win before ordinary file redirects are considered.
    if (!current && (fdDup === "1>&2" || fdDup === "2>&1")) {
      tokens.push({ type: "op", value: fdDup, offset: i });
      i += 4;
      atWordBoundary = true;
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
          i += quotedContinuation;
          continue;
        }
        if (source[i] === "\\" && i + 1 < source.length) {
          const next = source[i + 1];
          if (next === "$" || next === '"' || next === "\\") {
            text += `\u0000${next}`;
            i += 2;
            continue;
          }
        }
        if ((source[i] === "$" && ["(", "{"].includes(source[i + 1])) || source[i] === "`") {
          const end = source[i + 1] === "{" ? parameterEnd(source, i) : substitutionEnd(source, i);
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
        const end = source[i + 1] === "{" ? parameterEnd(source, i) : substitutionEnd(source, i);
        text += source.slice(i, end);
        i = end;
        continue;
      }
      const maybeOp =
        ["|", ";", "<", ">"].includes(c) ||
        source.slice(i, i + 2) === "&&" ||
        source.slice(i, i + 2) === "||" ||
        source.slice(i, i + 2) === "2>" ||
        source.slice(i, i + 4) === "1>&2" ||
        source.slice(i, i + 4) === "2>&1";
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
      while (i < tokens.length) {
        const token = tokens[i];
        if (token.type === "op" && ["|", ";", "&&", "||"].includes(token.value))
          break;
        if (token.type === "op" && ["1>&2", "2>&1"].includes(token.value)) {
          command.redirects.push({ op: token.value, target: null });
          i++;
          continue;
        }
        if (token.type === "op" && ["<", ">", ">>", "2>", "2>>", "<<", "<<-", "<<<"].includes(token.value)) {
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
    jobs.push({ connector, pipeline, negate });
    const separator = tokens[i]?.value;
    if (!separator) break;
    if (![";", "&&", "||"].includes(separator))
      throw new ShellSyntaxError(`unexpected operator ${separator}`, tokens[i].offset);
    connector = separator;
    i++;
    skipSemicolons();
    if (i >= tokens.length) break;
  }
  return jobs;
}

function parameterValue(name, state) {
  if (name === "?") return String(state.lastStatus);
  if (name === "$") return String(process.pid);
  if (name === "#") return String(Math.max(0, state.args.length - 1));
  if (name === "-") return "";
  if (name === "0") return state.args[0] ?? "bunmsh";
  if (name === "@" || name === "*") return state.args.slice(1).join((state.env.IFS ?? " ")[0] ?? " ");
  if (/^[1-9][0-9]*$/.test(name)) return state.args[Number(name)] ?? "";
  return state.env[name] ?? "";
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

function globPatternRegex(pattern, anchoredStart, anchoredEnd, greedy) {
  let source = "";
  for (const ch of pattern) {
    if (ch === "*") source += greedy ? ".*" : ".*?";
    else if (ch === "?") source += ".";
    else source += ch.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`${anchoredStart ? "^" : ""}${source}${anchoredEnd ? "$" : ""}`);
}

async function parameterExpansion(body, state) {
  if (/^[!%][A-Za-z_][A-Za-z0-9_]*$/.test(body)) {
    const value = parameterValue(body.slice(1), state);
    return body[0] === "!" ? parameterValue(value, state) : String([...value].length);
  }
  if (body.startsWith("#") && /^[A-Za-z_][A-Za-z0-9_]*$/.test(body.slice(1)))
    return String(parameterValue(body.slice(1), state).length);
  const trim = /^([A-Za-z_][A-Za-z0-9_]*|[?$#@*]|[0-9]+)(%%|%|##|#)(.*)$/s.exec(body);
  if (trim) {
    const value = parameterValue(trim[1], state);
    const pattern = stripExpansionMarkers(await expandText(trim[3], state));
    const matches = (part) => globPatternRegex(pattern, true, true, true).test(part);
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
  const unset = !Object.hasOwn(state.env, name) && !/^[?$#@*0-9]$/.test(name);
  const empty = value === "";
  if (!operator) return value;
  const useEmpty = operator.startsWith(":");
  const op = operator.at(-1);
  const missing = unset || (useEmpty && empty);
  const expandedOperand = async () => stripExpansionMarkers(await expandText(operand, state));
  if (op === "-") return missing ? expandedOperand() : value;
  if (op === "+") return missing ? "" : expandedOperand();
  if (op === "=") {
    if (missing) {
      if (!/^[A-Za-z_]/.test(name)) throw new ShellSyntaxError("cannot assign positional parameter");
      if (state.readonly?.has(name)) throw new ShellSyntaxError(`${name}: is read only`);
      const expanded = await expandedOperand();
      state.env[name] = expanded;
      return expanded;
    }
    return value;
  }
  if (op === "?" && missing) throw new ShellSyntaxError(operand ? await expandedOperand() : `${name}: parameter null or not set`);
  return value;
}

function markedExpansion(value) {
  return `\u0001${value}\u0002`;
}

function stripExpansionMarkers(value) {
  return value.replace(/[\u0001\u0002]/g, "");
}

async function commandSubstitution(source, state) {
  const child = {
    ...state,
    env: { ...state.env },
    aliases: { ...state.aliases },
    readonly: new Set(state.readonly),
    directoryHistory: [...state.directoryHistory],
    tabs: [...state.tabs],
    exitRequested: false,
    exitStatus: 0,
  };
  const output = await execute(source, child, { capture: true });
  state.expansionStatus = output.status;
  return decode(output.stdout).replace(/\n+$/, "");
}

async function expandText(text, state) {
  let output = "";
  for (let i = 0; i < text.length; ) {
    if (text[i] === "\u0000") {
      output += `\u0000${text[i + 1] ?? ""}`;
      i += 2;
      continue;
    }
    if (text[i] === "`") {
      const end = substitutionEnd(text, i);
      output += markedExpansion(await commandSubstitution(text.slice(i + 1, end - 1), state));
      i = end;
      continue;
    }
    if (text[i] !== "$") {
      output += text[i++];
      continue;
    }
    if (text.startsWith("$((", i)) {
      const end = substitutionEnd(text, i);
      output += markedExpansion(arithmeticValue(text.slice(i + 3, end - 2), state));
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
      output += markedExpansion(await parameterExpansion(text.slice(i + 2, end - 1), state));
      i = end;
      continue;
    }
    const next = text[i + 1];
    if (["?", "$", "#", "@", "*", "-"].includes(next) || /[0-9]/.test(next ?? "")) {
      output += markedExpansion(parameterValue(next, state));
      i += 2;
      continue;
    }
    if (isNameStart(next)) {
      let end = i + 2;
      while (isNameChar(text[end])) end++;
      output += markedExpansion(parameterValue(text.slice(i + 1, end), state));
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
  const matches = [...glob.scanSync({ cwd: state.cwd, dot: false, onlyFiles: false })].sort();
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
  if (!options.single && word.fragments.length === 1 &&
      word.fragments[0].quote === "double" && word.fragments[0].text === "$@")
    return state.args.slice(1);
  const segments = [];
  for (let index = 0; index < word.fragments.length; index++) {
    const fragment = word.fragments[index];
    const source = fragment.quote === "none" && !options.noTilde
      ? expandTildes(fragment.text, state, Boolean(options.assignment))
      : fragment.text;
    let text = fragment.quote === "single"
      ? source.replaceAll("\u0000", "")
      : await expandText(source, state);
    if (fragment.quote !== "none") {
      segments.push({ text: stripExpansionMarkers(text.replaceAll("\u0000", "")), quoted: true, splittable: false });
    } else {
      let plain = "";
      let splittable = false;
      const flush = () => {
        if (plain) segments.push({ text: plain, quoted: false, splittable });
        plain = "";
      };
      for (let i = 0; i < text.length; i++) {
        if (text[i] === "\u0001") { flush(); splittable = true; continue; }
        if (text[i] === "\u0002") { flush(); splittable = false; continue; }
        if (text[i] !== "\u0000") { plain += text[i]; continue; }
        flush();
        segments.push({ text: text[++i] ?? "", quoted: true, splittable: false });
      }
      flush();
    }
  }
  if (options.single) return [segments.map(({ text }) => text).join("")];
  const fields = splitFields(segments, state);
  const output = [];
  for (const field of fields)
    for (const expanded of braceFields(field)) output.push(...await pathnameFields(expanded, state));
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
    if (argv.length > 2) state.args = [previousArgs[0], ...argv.slice(2)];
    try {
      return await execute(source, state, { capture: true });
    } finally {
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

const builtins = {
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
      if (arg === "-r" || arg === "-R") raw = true;
      else if (arg === "-n") newline = false;
      else if (arg === "-l") separator = "\n";
      else if (arg === "-N") separator = terminator = "\0";
      else return result(1, "", `bunmsh: print: ${arg}: unsupported option\n`);
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
    if (argv.length === 1) {
      const listing = Object.entries(state.env)
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
    let env = { ...state.env };
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
  set: async (argv, state) => {
    if (argv.length === 1)
      return result(0, Object.entries(state.env).sort().map(([k, v]) => `${k}=${JSON.stringify(v)}\n`).join(""));
    if (argv[1] === "--") {
      state.args = [state.args[0], ...argv.slice(2)];
      return result();
    }
    return result(2, "", "bunmsh: set: option handling is not implemented yet\n");
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
  if (argv[0] === "cp")
    commandArgv = commandArgv.map((value, index) =>
      index > 0 && /^-[^-]/.test(value) ? `-${value.slice(1).replaceAll("r", "R")}` : value);
  return commandArgv;
}

async function runBunShellFallback(argv, state) {
  const shell = Bun.$`${bunShellFallbackArgv(argv)}`
    .cwd(nativePath(state.cwd))
    .env(state.env)
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
  const cmd = IS_COMPILED
    ? [...EXECUTABLE_COMMAND, "--bun-shell-fallback", ...bunShellFallbackArgv(argv)]
    : [...BUN_RUNTIME_COMMAND, BUNMSH_ENTRY, "--bun-shell-fallback", ...bunShellFallbackArgv(argv)];
  const proc = Bun.spawn({
    cmd,
    cwd: nativePath(state.cwd),
    env: {
      ...state.env,
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
      env: state.env,
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
  const writer = state.pipelineChild ? Bun.stdout.writer() : null;
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
    try {
      const data = await readFallbackFiles(operands, state, input);
      if (bytesMode) return result(0, data.slice(0, count));
      return result(0, decoder.decode(data).split(/(?<=\n)/).slice(0, count).join(""));
    } catch (error) { return result(1, "", `bunmsh: head: ${error.message}\n`); }
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
    const text = decoder.decode(await readFallbackFiles(args, state, input));
    let lines = text.split("\n");
    const trailing = lines.at(-1) === "";
    if (trailing) lines.pop();
    if (kind === "tail") {
      lines = tailFromStart
        ? lines.slice(Math.max(0, tailCount - 1))
        : lines.slice(-tailCount);
    } else {
      lines.sort((a, b) => numeric ? Number(a) - Number(b) : a.localeCompare(b));
      if (unique) lines = lines.filter((line, index) => index === 0 || line !== lines[index - 1]);
      if (reverse) lines.reverse();
    }
    return result(0, lines.length ? `${lines.join("\n")}\n` : "");
  } catch (error) { return result(1, "", `bunmsh: ${kind}: ${error.message}\n`); }
}

async function runWcFallback(argv, state, input) {
  let flags = "", i = 1;
  while (/^-[lwc]+$/.test(argv[i] ?? "")) flags += argv[i++].slice(1);
  if (!flags) flags = "lwc";
  try {
    const data = await readFallbackFiles(argv.slice(i), state, input);
    const text = decoder.decode(data);
    const values = [];
    if (flags.includes("l")) values.push((text.match(/\n/g) ?? []).length);
    if (flags.includes("w")) values.push(text.trim() ? text.trim().split(/\s+/).length : 0);
    if (flags.includes("c")) values.push(data.byteLength);
    return result(0, `${values.join(" ")}\n`);
  } catch (error) { return result(1, "", `bunmsh: wc: ${error.message}\n`); }
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
  let del = false, i = 1;
  if (argv[i] === "-d") del = true, i++;
  if (!argv[i] || (!del && !argv[i + 1])) return result(1, "", "bunmsh: tr: missing operand\n");
  const from = expandTrSet(argv[i++]);
  const to = expandTrSet(argv[i] ?? "");
  const text = decoder.decode(await readFallbackInput(input));
  let output = "";
  for (const ch of text) {
    const index = from.indexOf(ch);
    if (index < 0) output += ch;
    else if (!del) output += to[Math.min(index, Math.max(0, to.length - 1))] ?? "";
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
    env: state.env,
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
  try {
    const data = await readFallbackFiles(operands, state, input);
    const digest = createHash(algorithm).update(data).digest("hex");
    return result(0, `${digest}${operands.length === 1 && operands[0] !== "-" ? `  ${operands[0]}` : ""}\n`);
  } catch (error) { return result(1, "", `bunmsh: ${algorithm}sum: ${error.message}\n`); }
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
  let output = "", inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "[") inClass = true;
    if (ch === "]" && inClass) inClass = false;
    if (!inClass && ch === "\\" && i + 1 < pattern.length && "+?|(){}".includes(pattern[i + 1])) {
      output += pattern[++i];
      continue;
    }
    if (!inClass && "+?|(){}".includes(ch)) output += `\\${ch}`;
    else output += ch;
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
  while (argv[i]?.startsWith("-") && argv[i] !== "-") {
    if (argv[i] === "--") { i++; break; }
    const colorOption = /^--colou?r(?:=(always|auto|never))?$/.exec(argv[i]);
    if (colorOption) {
      colorMode = colorOption[1] ?? "always";
      i++;
      continue;
    }
    if (!/^-[EFiqvnorx]+$/.test(argv[i]))
      return result(2, "", `bunmsh: grep: unsupported option: ${argv[i]}\n`);
    flags += argv[i++].slice(1);
  }
  const pattern = argv[i++];
  if (pattern === undefined) return result(2, "", "bunmsh: grep: missing pattern\n");
  let regex;
  const regexSource = flags.includes("F")
    ? pattern.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")
    : grepPosixClasses(flags.includes("E") ? pattern : grepBasicRegex(pattern));
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
  let matched = false;
  const output = [];
  const processLine = (line, lineNumber, label, showLabel) => {
    regex.lastIndex = 0;
    const isMatch = regex.test(line);
    regex.lastIndex = 0;
    if (isMatch === invert) return false;
    matched = true;
    if (quiet) return true;
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
  if (operands.length) {
    try {
      const files = grepFiles(operands, state, flags.includes("r"));
      const showLabel = files.length > 1 || flags.includes("r");
      for (const file of files) {
        const lines = (await Bun.file(file.path).text()).split("\n");
        if (lines.at(-1) === "") lines.pop();
        for (let line = 0; line < lines.length; line++)
          if (processLine(lines[line], line + 1, file.shown, showLabel)) return result(0);
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
  return result(matched ? 0 : 1, output.join(""));
}

function splitSedCommands(script) {
  const commands = [];
  let start = 0, escaped = false;
  for (let i = 0; i < script.length; i++) {
    if (escaped) { escaped = false; continue; }
    if (script[i] === "\\") { escaped = true; continue; }
    if (script[i] === ";") {
      commands.push(script.slice(start, i).trim());
      start = i + 1;
    }
  }
  commands.push(script.slice(start).trim());
  return commands.filter(Boolean);
}

function readSedField(command, start, delimiter) {
  let value = "";
  for (let i = start; i < command.length; i++) {
    if (command[i] === "\\" && i + 1 < command.length) {
      if (command[i + 1] === delimiter) value += command[++i];
      else value += command[i] + command[++i];
    } else if (command[i] === delimiter) return [value, i + 1];
    else value += command[i];
  }
  throw new Error("unterminated substitute command");
}

function sedReplacement(value) {
  let output = "";
  for (let i = 0; i < value.length; i++) {
    if (value[i] === "\\" && /[1-9]/.test(value[i + 1] ?? "")) output += `$${value[++i]}`;
    else if (value[i] === "\\" && i + 1 < value.length) output += value[++i];
    else if (value[i] === "&") output += "$&";
    else if (value[i] === "$") output += "$$";
    else output += value[i];
  }
  return output;
}

function compileSedCommand(source, extended) {
  const numberedPrint = /^(\d+)p$/.exec(source);
  if (numberedPrint) return { type: "print", line: Number(numberedPrint[1]) };
  if (!source.startsWith("s") || source.length < 2)
    throw new Error(`unsupported command: ${source}`);
  const delimiter = source[1];
  const [pattern, replacementStart] = readSedField(source, 2, delimiter);
  const [replacement, flagsStart] = readSedField(source, replacementStart, delimiter);
  const flags = source.slice(flagsStart);
  if (!/^[gp]*$/.test(flags)) throw new Error(`unsupported substitute flags: ${flags}`);
  const regexSource = grepPosixClasses(extended ? pattern : grepBasicRegex(pattern));
  return {
    type: "substitute",
    regex: new RegExp(regexSource, flags.includes("g") ? "g" : ""),
    replacement: sedReplacement(replacement),
    print: flags.includes("p"),
  };
}

function applySed(text, commands, quiet) {
  const trailingNewline = text.endsWith("\n");
  const lines = text.split("\n");
  if (trailingNewline) lines.pop();
  const output = [];
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    for (const command of commands) {
      if (command.type === "print") {
        if (command.line === index + 1) output.push(line);
        continue;
      }
      command.regex.lastIndex = 0;
      const matched = command.regex.test(line);
      command.regex.lastIndex = 0;
      if (matched) {
        line = line.replace(command.regex, command.replacement);
        if (command.print) output.push(line);
      }
    }
    if (!quiet) output.push(line);
  }
  if (!output.length) return "";
  return output.join("\n") + (trailingNewline ? "\n" : "");
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
    if (!/^-[nEri]+$/.test(option))
      return result(1, "", `bunmsh: sed: unsupported option: ${option}\n`);
    quiet ||= option.includes("n");
    extended ||= option.includes("E") || option.includes("r");
    inPlace ||= option.includes("i");
  }
  if (!scripts.length && i < argv.length) scripts.push(argv[i++]);
  if (!scripts.length) return result(1, "", "bunmsh: sed: missing script\n");
  let commands;
  try { commands = scripts.flatMap(splitSedCommands).map((script) => compileSedCommand(script, extended)); }
  catch (error) { return result(1, "", `bunmsh: sed: ${error.message}\n`); }
  const operands = argv.slice(i);
  if (inPlace && !operands.length) return result(1, "", "bunmsh: sed: -i requires a file operand\n");
  try {
    if (!operands.length) {
      const text = decoder.decode(await readFallbackInput(input));
      return result(0, applySed(text, commands, quiet));
    }
    let stdout = "";
    for (const operand of operands) {
      const file = isAbsolute(nativePath(operand)) ? nativePath(operand) : resolvePath(nativePath(state.cwd), nativePath(operand));
      const changed = applySed(await Bun.file(file).text(), commands, quiet);
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

async function runCutFallback(argv, _state, input) {
  let spec, i = 1;
  if (argv[i] === "-c") spec = argv[++i], i++;
  else if (argv[i]?.startsWith("-c")) spec = argv[i++].slice(2);
  if (!spec || i !== argv.length) return result(1, "", "bunmsh: cut: usage: cut -c LIST\n");
  try {
    const ranges = cutCharacterRanges(spec);
    const text = decoder.decode(await readFallbackInput(input));
    const trailing = text.endsWith("\n");
    const lines = text.split("\n");
    if (trailing) lines.pop();
    const output = lines.map((line) => [...line].filter((_ch, index) =>
      ranges.some(([start, end]) => index + 1 >= start && index + 1 <= end)).join("")).join("\n");
    return result(0, output + (trailing ? "\n" : ""));
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
  if (argv.length - i !== 2) return result(1, "", "bunmsh: ln: usage: ln [-sf] target link_name\n");
  const target = nativePath(argv[i]);
  let link = isAbsolute(nativePath(argv[i + 1]))
    ? nativePath(argv[i + 1])
    : resolvePath(nativePath(state.cwd), nativePath(argv[i + 1]));
  try {
    if (!noTargetDirectory) {
      try {
        if (statSync(link).isDirectory()) link = resolvePath(link, pathBasename(target));
      } catch {}
    }
    if (force) try { unlinkSync(link); } catch {}
    if (symbolic) symlinkSync(target, link); else {
      const source = isAbsolute(target) ? target : resolvePath(nativePath(state.cwd), target);
      linkSync(source, link);
    }
    return result();
  } catch (error) { return result(1, "", `bunmsh: ln: ${error.message}\n`); }
}

function runChmodFallback(argv, state) {
  if (argv.length < 3) return result(1, "", "bunmsh: chmod: usage: chmod MODE FILE...\n");
  const mode = argv[1];
  let status = 0, stderr = "";
  for (const operand of argv.slice(2)) {
    const path = isAbsolute(nativePath(operand)) ? nativePath(operand) : resolvePath(nativePath(state.cwd), nativePath(operand));
    try {
      if (/^[0-7]{3,4}$/.test(mode)) chmodSync(path, Number.parseInt(mode, 8));
      else if (mode === "+x" || mode === "a+x") chmodSync(path, statSync(path).mode | 0o111);
      else throw new Error(`unsupported mode: ${mode}`);
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
      env: state.env,
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

const fallbackBuiltins = {
  basename: async (argv) => {
    const i = argv[1] === "--" ? 2 : 1;
    if (i >= argv.length || argv.length - i > 2)
      return result(1, "", "bunmsh: basename: usage: basename string [suffix]\n");
    let name = pathBasename(argv[i]);
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
  sort: (argv, state, input) => runTextFilter(argv, state, input, "sort"),
  date: async (argv) => runDateFallback(argv),
  md5sum: (argv, state, input) => runHashFallback(argv, state, input, "md5"),
  sha256sum: (argv, state, input) => runHashFallback(argv, state, input, "sha256"),
  grep: runGrepFallback,
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

export function createState(options = {}) {
  const env = canonicalEnvironment({ ...process.env, ...(options.env ?? {}) });
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
    getoptsOffset: 1,
    args: options.args ?? ["bunmsh"],
    lastStatus: 0,
    exitRequested: false,
    exitStatus: 0,
    pipelineChild: options.pipelineChild ?? false,
  };
}

function hasCompoundSyntax(source) {
  if (/(^|\n)\s*(?:\(|[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\)\s*\{)/.test(source)) return true;
  let commandStart = true;
  for (const token of tokenize(source)) {
    if (token.type === "op") {
      if ([";", "&&", "||", "|"].includes(token.value)) commandStart = true;
      continue;
    }
    const word = token.fragments.length === 1 && token.fragments[0].quote === "none"
      ? token.fragments[0].text : null;
    if (commandStart && ["if", "while", "until", "for", "case"].includes(word)) return true;
    if (!(commandStart && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word ?? ""))) commandStart = false;
  }
  return false;
}

function compoundLogicalSource(source) {
  const tokens = tokenize(source);
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
    if (!commandStart) continue;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word ?? "")) continue;
    // Like mksh's KEYWORD lexer mode, these words are special only where a
    // command may begin. Physical newlines are not required around them.
    if (["if", "while", "until", "for", "case"].includes(word) && token.offset > 0)
      breaks.add(token.offset);
    if (["elif", "else", "fi", "done", "esac"].includes(word))
      breaks.add(token.offset);
    if (["then", "do", "else"].includes(word) && tokens[index + 1])
      breaks.add(tokens[index + 1].offset);
    commandStart = ["if", "while", "until", "elif", "then", "do", "else"].includes(word);
  }
  let logical = source;
  for (const offset of [...breaks].sort((a, b) => b - a))
    if (offset > 0 && source[offset - 1] !== "\n")
      logical = `${logical.slice(0, offset)}\n${logical.slice(offset)}`;
  return logical;
}

// A leaf command line inside a compound body (if/while/for/case) is scanned
// one physical line at a time, but a here-document's body lives on the lines
// that follow it. Grow the line by re-tokenizing with more lines appended
// until the heredoc(s) it opens are fully resolved, so the folded lines never
// get misread as separate commands or as clauses of the surrounding compound.
function growHeredocLine(lines, index) {
  const line = lines[index];
  if (!line.includes("<<")) return { source: line, next: index + 1 };
  let end = index;
  let candidate = line;
  while (true) {
    try {
      tokenize(candidate, { strict: true });
      return { source: candidate, next: end + 1 };
    } catch (error) {
      if (!(error instanceof ShellSyntaxError) ||
          !error.message.startsWith("unterminated here-document"))
        throw error;
      end++;
      if (end >= lines.length) throw error;
      candidate += `\n${lines[end]}`;
    }
  }
}

function parseCompoundScript(source) {
  const lines = compoundLogicalSource(source.replace(/\\\r?\n/g, "")).split(/\r?\n/);
  const parseSequence = (start, stops = []) => {
    const nodes = [];
    let i = start;
    while (i < lines.length) {
      const line = lines[i];
      const trimmed = line.trim();
      if (stops.some((stop) => stop.test(trimmed))) break;
      if (!trimmed || trimmed.startsWith("#")) { i++; continue; }

      const functionMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\{\s*$/.exec(trimmed);
      if (functionMatch) {
        const body = parseSequence(i + 1, [/^}\s*;?$/]);
        if (body.index >= lines.length) throw new ShellSyntaxError(`unterminated function ${functionMatch[1]}`);
        nodes.push({ type: "function", name: functionMatch[1], body: body.nodes });
        i = body.index + 1;
        continue;
      }

      const subshellMatch = /^\((.*)\)\s*;?$/.exec(trimmed);
      if (subshellMatch) {
        nodes.push({ type: "subshell", source: subshellMatch[1] });
        i++;
        continue;
      }

      if (/^if(?:\s|$)/.test(trimmed)) {
        const branches = [];
        let header = trimmed;
        while (!/;\s*then\s*$/.test(header) && ++i < lines.length)
          header += ` ${lines[i].trim()}`;
        if (!/;\s*then\s*$/.test(header)) throw new ShellSyntaxError("if requires then");
        let condition = header.replace(/^if\s*/, "").replace(/;\s*then\s*$/, "");
        i++;
        while (true) {
          const body = parseSequence(i, [/^elif(?:\s|$)/, /^else\s*;?$/, /^fi\s*;?$/]);
          branches.push({ condition, body: body.nodes });
          i = body.index;
          const stop = lines[i]?.trim() ?? "";
          if (/^elif(?:\s|$)/.test(stop)) {
            header = stop;
            while (!/;\s*then\s*$/.test(header) && ++i < lines.length)
              header += ` ${lines[i].trim()}`;
            if (!/;\s*then\s*$/.test(header)) throw new ShellSyntaxError("elif requires then");
            condition = header.replace(/^elif\s*/, "").replace(/;\s*then\s*$/, "");
            i++;
            continue;
          }
          let otherwise = [];
          if (/^else\s*;?$/.test(stop)) {
            const body = parseSequence(i + 1, [/^fi\s*;?$/]);
            otherwise = body.nodes;
            i = body.index;
          }
          if (!/^fi\s*;?$/.test(lines[i]?.trim() ?? ""))
            throw new ShellSyntaxError("unterminated if");
          nodes.push({ type: "if", branches, otherwise });
          i++;
          break;
        }
        continue;
      }
      if (/^(?:while|until)(?:\s|$)/.test(trimmed)) {
        const kind = trimmed.startsWith("until") ? "until" : "while";
        let header = trimmed;
        while (!/;\s*do\s*$/.test(header) && ++i < lines.length)
          header += ` ${lines[i].trim()}`;
        if (!/;\s*do\s*$/.test(header)) throw new ShellSyntaxError(`${kind} requires do`);
        const condition = header.replace(new RegExp(`^${kind}\\s*`), "").replace(/;\s*do\s*$/, "");
        const body = parseSequence(i + 1, [/^done(?:\s*<\s*.+)?\s*;?$/]);
        const done = /^done(?:\s*<\s*(.+?))?\s*;?$/.exec(lines[body.index]?.trim() ?? "");
        if (!done)
          throw new ShellSyntaxError(`unterminated ${kind}`);
        nodes.push({ type: "loop", kind, condition, body: body.nodes, input: done[1] ?? null });
        i = body.index + 1;
        continue;
      }
      if (/^for(?:\s|$)/.test(trimmed)) {
        let header = trimmed;
        while (!/;\s*do\s*$/.test(header) && ++i < lines.length)
          header += ` ${lines[i].trim()}`;
        const match = /^for\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+in\s+(.*?))?\s*;\s*do\s*$/.exec(header);
        if (!match) throw new ShellSyntaxError("invalid for command");
        const body = parseSequence(i + 1, [/^done\s*;?$/]);
        if (!/^done\s*;?$/.test(lines[body.index]?.trim() ?? ""))
          throw new ShellSyntaxError("unterminated for");
        nodes.push({ type: "for", name: match[1], words: match[2] ?? null, body: body.nodes });
        i = body.index + 1;
        continue;
      }
      if (/^case(?:\s|$)/.test(trimmed)) {
        let header = trimmed;
        while (!/\s+in\s*$/.test(header) && ++i < lines.length)
          header += ` ${lines[i].trim()}`;
        const match = /^case\s+(.+?)\s+in\s*$/.exec(header);
        if (!match) throw new ShellSyntaxError("case requires in");
        const arms = [];
        i++;
        while (i < lines.length && !/^esac\s*;?$/.test(lines[i].trim())) {
          if (!lines[i].trim() || lines[i].trim().startsWith("#")) { i++; continue; }
          const arm = /^(.+?)\)\s*$/.exec(lines[i].trim());
          if (!arm) throw new ShellSyntaxError("case pattern requires )");
          const bodyLines = [];
          i++;
          while (i < lines.length && !/^esac\s*;?$/.test(lines[i].trim())) {
            const current = lines[i];
            const terminator = current.indexOf(";;");
            if (terminator >= 0) {
              if (current.slice(0, terminator).trim()) bodyLines.push(current.slice(0, terminator));
              i++;
              break;
            }
            bodyLines.push(current);
            i++;
          }
          arms.push({ patterns: arm[1].split("|").map((pattern) => pattern.trim()), body: parseCompoundScript(bodyLines.join("\n")) });
        }
        if (!/^esac\s*;?$/.test(lines[i]?.trim() ?? "")) throw new ShellSyntaxError("unterminated case");
        nodes.push({ type: "case", word: match[1], arms });
        i++;
        continue;
      }
      const grown = growHeredocLine(lines, i);
      nodes.push({ type: "command", source: grown.source });
      i = grown.next;
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

async function executeNodeList(nodes, state, options = {}) {
  const capture = options.capture ?? true;
  const stdout = [], stderr = [];
  let execution = result(state.lastStatus);
  const append = (value) => {
    if (!capture) return;
    if (value.stdout.byteLength) stdout.push(value.stdout);
    if (value.stderr.byteLength) stderr.push(value.stderr);
  };
  for (const node of nodes) {
    if (state.exitRequested) break;
    if (node.type === "function") {
      state.functions[node.name] = node.body;
      continue;
    }
    if (node.type === "command") {
      execution = await execute(node.source, state, { capture, simple: true });
      append(execution);
      continue;
    }
    if (node.type === "subshell") {
      const child = {
        ...state,
        env: { ...state.env },
        aliases: { ...state.aliases },
        functions: { ...state.functions },
        readonly: new Set(state.readonly),
        directoryHistory: [...state.directoryHistory],
        tabs: [...state.tabs],
        exitRequested: false,
        exitStatus: 0,
      };
      execution = await execute(node.source, child, { capture });
      append(execution);
      state.lastStatus = execution.status;
      continue;
    }
    if (node.type === "loop") {
      const previousReadLines = state.readLines;
      let ranBody = false;
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
          const checked = await execute(node.condition, state, { capture, simple: true });
          append(checked);
          const proceed = node.kind === "until" ? checked.status !== 0 : checked.status === 0;
          if (!proceed || state.exitRequested) {
            if (!ranBody) execution = result();
            break;
          }
          execution = await executeNodeList(node.body, state, { capture });
          ranBody = true;
          append(execution);
          if (state.exitRequested) break;
        }
      } catch (error) {
        execution = result(1, "", `bunmsh: ${error.message}\n`);
        append(execution);
      } finally {
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
      for (const value of values) {
        if (state.readonly.has(node.name)) { execution = readonlyError(node.name); break; }
        state.env[node.name] = value;
        execution = await executeNodeList(node.body, state, { capture });
        append(execution);
        if (state.exitRequested) break;
      }
      state.lastStatus = execution.status;
      continue;
    }
    if (node.type === "case") {
      const parsed = parse(`__case ${node.word}`)[0]?.pipeline[0];
      const value = (await expandWord(parsed.words[1], state, { single: true }))[0] ?? "";
      execution = result();
      for (const arm of node.arms) {
        let matches = false;
        for (let pattern of arm.patterns) {
          pattern = pattern.replace(/^(['"])(.*)\1$/, "$2");
          pattern = stripExpansionMarkers(await expandText(pattern, state));
          if (globPatternRegex(pattern, true, true, true).test(value)) { matches = true; break; }
        }
        if (!matches) continue;
        execution = await executeNodeList(arm.body, state, { capture });
        append(execution);
        break;
      }
      state.lastStatus = execution.status;
      continue;
    }
    let selected = null;
    for (const branch of node.branches) {
      let condition = branch.condition.trim();
      let negate = false;
      while (/^!\s+/.test(condition)) { negate = !negate; condition = condition.replace(/^!\s+/, ""); }
      const checked = await execute(condition, state, { capture, simple: true });
      append(checked);
      if ((checked.status === 0) !== negate) { selected = branch.body; break; }
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
  state.args = [previousArgs[0], ...argv.slice(1)];
  try { return await executeNodeList(state.functions[name], state); }
  finally { state.args = previousArgs; }
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
    env: state.env,
    stdin: input === null ? "inherit" : input,
    stdout: captureStdout || stdoutSink ? "pipe" : "inherit",
    stderr: captureStderr || runtimeOptions.stderrSink ? "pipe" : "inherit",
    onExit(proc, exitCode, signalCode, error) {
      runtimeOptions.onExit?.(proc, exitCode, signalCode, error);
    },
  };
  try {
    const proc = Bun.spawn(options);
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
    const outputPromise = captureStdout
      ? new Response(proc.stdout).arrayBuffer()
      : Promise.resolve(new ArrayBuffer(0));
    const streamPromise = stdoutSink
      ? Promise.race([
          proc.stdout.pipeTo(stdoutSink).catch(() => {
            try { proc.kill(pipelineKillSignal); } catch {}
          }),
          abandonStreaming,
        ])
      : Promise.resolve();
    const errorStreamPromise = runtimeOptions.stderrSink
      ? Promise.race([
          proc.stderr.pipeTo(runtimeOptions.stderrSink).catch(() => {}),
          abandonStreaming,
        ])
      : Promise.resolve();
    const errorPromise = captureStderr
      ? new Response(proc.stderr).arrayBuffer()
      : Promise.resolve(new ArrayBuffer(0));
    const [status, output, error] = await Promise.all([
      proc.exited,
      outputPromise,
      errorPromise,
      streamPromise,
      errorStreamPromise,
    ]);
    const execution = result(status, new Uint8Array(output), new Uint8Array(error));
    execution.stdoutStreamed = Boolean(stdoutSink);
    execution.stderrStreamed = Boolean(runtimeOptions.stderrSink);
    return execution;
  } catch (error) {
    return result(127, "", `bunmsh: ${argv[0]}: ${error.message}\n`);
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

function pipelineBuiltinState(state) {
  return {
    ...state,
    env: {
      ...state.env,
      [PIPELINE_STATE_ENV]: JSON.stringify({
        aliases: state.aliases,
        functions: state.functions,
        readonly: [...state.readonly],
        args: state.args,
        pathSearch: state.pathSearch,
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
  
  let commandState = state;
  if (options.pipelineStage && runsInPipelineSubprocess(commandArgv, commandState))
    return runExternal(
      pipelineBuiltinArgv(commandArgv),
      pipelineBuiltinState(commandState),
      input,
      captureStdout,
      captureStderr,
      options.stdoutSink,
      { ...options, pipelineKillSignal: "SIGTERM" },
    );
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

function redirectInput(path) {
  const fd = openSync(path, "r");
  return Readable.toWeb(createReadStream(path, { fd, autoClose: true }));
}

function redirectOutput(path, append) {
  const fd = openSync(path, append ? "a" : "w");
  return Writable.toWeb(createWriteStream(path, { fd, autoClose: true }));
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
  if (expanded.length === 0) {
    for (const name of Object.keys(localEnv))
      if (state.readonly.has(name)) return readonlyError(name);
    Object.assign(state.env, localEnv);
    return result(state.expansionStatus ?? 0);
  }
  const alias = aliasEligible ? state.aliases[expanded[0]] : null;
  if (alias) expanded.splice(0, 1, ...alias);

  let input = options.input ?? null;
  let stdoutPath = null;
  let stdoutAppend = false;
  let stderrPath = null;
  let stderrAppend = false;
  let stdoutToStderr = false;
  let stderrToStdout = false;
  for (const redirect of command.redirects) {
    if (redirect.op === "1>&2") { stdoutToStderr = true; continue; }
    if (redirect.op === "2>&1") { stderrToStdout = true; continue; }
    if (redirect.op === "<<" || redirect.op === "<<-") {
      const heredoc = redirect.heredoc ?? { body: "", expand: false };
      const content = heredoc.expand
        ? stripExpansionMarkers(
            (await expandText(heredocLiteralPass(heredoc.body), state)).replaceAll("\u0000", ""),
          )
        : heredoc.body;
      if (input instanceof ReadableStream) {
        try { await input.cancel(); } catch {}
      }
      input = redirectHeredoc(content);
      continue;
    }
    if (redirect.op === "<<<") {
      const [word] = await expandWord(redirect.target, state, { single: true, noTilde: true });
      if (input instanceof ReadableStream) {
        try { await input.cancel(); } catch {}
      }
      input = redirectHeredoc(`${word}\n`);
      continue;
    }
    const targets = await expandWord(redirect.target, state, { single: true });
    const target = targets[0];
    const path = target.startsWith("/") ? target : `${state.cwd}/${target}`;
    if (redirect.op === "<") {
      try {
        if (input instanceof ReadableStream) {
          try { await input.cancel(); } catch {}
        }
        input = redirectInput(path);
      } catch (error) {
        return result(1, "", `bunmsh: ${target}: ${error.message}\n`);
      }
    } else if (redirect.op === ">" || redirect.op === ">>") {
      stdoutPath = path;
      stdoutAppend = redirect.op === ">>";
    } else {
      stderrPath = path;
      stderrAppend = redirect.op === "2>>";
    }
  }


  let stdoutRedirect = null;
  let stderrRedirect = null;
  try {
    if (stdoutPath !== null) {
      // A command-level redirect replaces the pipeline's stdout connection.
      // Close that unused connection now so the next stage observes EOF.
      if (options.stdoutSink) {
        try { await options.stdoutSink.getWriter().close(); } catch {}
      }
      stdoutRedirect = redirectOutput(stdoutPath, stdoutAppend);
    }
    if (stderrPath !== null)
      stderrRedirect = redirectOutput(stderrPath, stderrAppend);
  } catch (error) {
    return result(1, "", `bunmsh: ${stdoutPath ?? stderrPath}: ${error.message}\n`);
  }

  const commandState = options.subshell
    ? {
        ...state,
        env: { ...state.env, ...localEnv },
        directoryHistory: [...state.directoryHistory],
        tabs: [...state.tabs],
        readonly: new Set(state.readonly),
      }
    : state;
  if (!options.subshell) {
    for (const name of Object.keys(localEnv))
      if (commandState.readonly.has(name)) return readonlyError(name);
    Object.assign(commandState.env, localEnv);
  }

  const captureStdout = (options.captureStdout || stdoutToStderr) && stdoutRedirect === null;
  const captureStderr = (options.captureStderr || stderrToStdout) && stderrRedirect === null;
  const execution = await runCommandArgv(
    expanded,
    commandState,
    input,
    captureStdout,
    captureStderr,
    {
      pipelineStage: Boolean(options.pipelineStage || stdoutRedirect || stderrRedirect),
      stdoutSink: stdoutRedirect ?? options.stdoutSink ?? null,
      stderrSink: stderrRedirect,
      onSpawn: options.onSpawn,
      onExit: options.onExit,
    },
  );

  if (stdoutToStderr && execution.stdout.byteLength) {
    execution.stderr = concatBytes([execution.stderr, execution.stdout]);
    execution.stdout = bytes();
  }
  if (stderrToStdout && execution.stderr.byteLength) {
    execution.stdout = concatBytes([execution.stdout, execution.stderr]);
    execution.stderr = bytes();
  }

  return execution;
}

async function runPipeline(pipeline, state, options = {}) {
  if (pipeline.length === 1)
    return runCommand(pipeline[0], state, {
      captureStdout: Boolean(options.capture),
      captureStderr: Boolean(options.capture),
    });

  const links = Array.from(
    { length: pipeline.length - 1 },
    () => new TransformStream(),
  );
  const linksConnected = links.map((_, i) => {
    const stdoutRedirected = pipeline[i].redirects.some((redirect) =>
      redirect.op === ">" || redirect.op === ">>");
    const stdinRedirected = pipeline[i + 1].redirects.some((redirect) =>
      ["<", "<<", "<<-", "<<<"].includes(redirect.op));
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
      input: i === 0 ? null : links[i - 1].readable,
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
  source = normalizeSource(source);
  if (source === "?") {
    const execution = result(0, `${state.lastStatus}\n`);
    state.lastStatus = 0;
    if (!io.capture) await writeStream(process.stdout, execution.stdout);
    return execution;
  }
  const rawSource = source.trimStart();
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
        if (state.exitRequested) break;
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
      execution = await executeNodeList(parseCompoundScript(source), state, {
        capture: Boolean(io.capture),
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

  let jobs;
  try {
    jobs = parse(source);
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
  for (const job of jobs) {
    if (job.connector === "&&" && execution.status !== 0) continue;
    if (job.connector === "||" && execution.status === 0) continue;
    execution = await runPipeline(job.pipeline, state, { capture: io.capture });
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
    if (state.exitRequested) break;
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
    const inherited = JSON.parse(serialized);
    const env = { ...process.env };
    delete env[PIPELINE_STATE_ENV];
    return createState({
      env,
      cwd: process.cwd(),
      aliases: inherited.aliases,
      functions: inherited.functions,
      readonly: inherited.readonly,
      args: inherited.args,
      pathSearch: inherited.pathSearch,
      pipelineChild: true,
    });
  } catch {
    return createState();
  }
}

export function decode(data) {
  return decoder.decode(data);
}
