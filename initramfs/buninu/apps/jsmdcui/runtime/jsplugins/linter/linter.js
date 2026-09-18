// linter.js — JS port of linter.lua
// Runs linters on save, adds gutter messages via bp.Buf.AddMessage.
// micro global is available as globalThis.micro.

import { basename, dirname } from "node:path";

const GOOS = process.platform === "win32" ? "windows" : process.platform;
const devnull = GOOS === "windows" ? "NUL" : "/dev/null";

// ── Linter registry ───────────────────────────────────────────────────────────

const linters = new Map();

function makeLinter(name, filetype, cmd, args, errorformat, {
  os: osList = [], whitelist = false, domatch = false, loffset = 0, coffset = 0,
} = {}) {
  linters.set(name, { filetype, cmd, args, errorformat, osList, whitelist, domatch, loffset, coffset });
}

function removeLinter(name) { linters.delete(name); }

// ── Registrations (mirrors linter.lua preinit) ────────────────────────────────

makeLinter("gcc",         "c",           "gcc",        ["-fsyntax-only", "-Wall", "-Wextra", "%f"],                    "%f:%l:%c:.+: %m");
makeLinter("g++",         "c++",         "g++",        ["-fsyntax-only", "-Wall", "-Wextra", "%f"],                    "%f:%l:%c:.+: %m");
makeLinter("dmd",         "d",           "dmd",        ["-color=off", "-o-", "-w", "-wi", "-c", "%f"],                 "%f%(%l%):.+: %m");
makeLinter("ldc2",        "d",           "ldc2",       ["--o-", "--vcolumns", "-w", "-c", "%f"],                       "%f%(%l,%c%):[^:]+: %m");
makeLinter("gdc",         "d",           "gdc",        ["-fsyntax-only", "-Wall", "-Wextra", "%f"],                    "%f:%l:%c:.+: %m");
makeLinter("eslint",      "javascript",  "eslint",     ["-f", "json", "--no-ignore", "%f"],                            null);  // JSON parsing
makeLinter("gobuild",     "go",          "go",         ["build", "-o", devnull, "%d"],                                 "%f:%l:%c:? %m");
makeLinter("govet",       "go",          "go",         ["vet"],                                                        "%f:%l:%c: %m");
makeLinter("clippy",      "rust",        "cargo",      ["clippy", "--message-format", "short"],                        "%f:%l:%c: %m");
makeLinter("hlint",       "haskell",     "hlint",      ["%f"],                                                         "%f:%(?%l[,:]%c%)?.-: %m");
makeLinter("javac",       "java",        "javac",      ["-d", "%d", "%f"],                                             "%f:%l: error: %m");
makeLinter("jshint",      "javascript",  "jshint",     ["%f"],                                                         "%f: line %l,.+, %m");
makeLinter("literate",    "literate",    "lit",        ["-c", "%f"],                                                   "%f:%l:%m",   { domatch: true });
makeLinter("luacheck",    "lua",         "luacheck",   ["--no-color", "%f"],                                           "%f:%l:%c: %m");
makeLinter("nim",         "nim",         "nim",        ["check", "--listFullPaths", "--stdout", "--hints:off", "%f"],   "%f.%l, %c. %m");
makeLinter("clang",       "objective-c", "xcrun",      ["clang", "-fsyntax-only", "-Wall", "-Wextra", "%f"],           "%f:%l:%c:.+: %m");
makeLinter("pyflakes",    "python",      "pyflakes",   ["%f"],                                                         "%f:%l:.-:? %m");
makeLinter("mypy",        "python",      "mypy",       ["%f"],                                                         "%f:%l: %m");
makeLinter("pylint",      "python",      "pylint",     ["--output-format=parseable", "--reports=no", "%f"],            "%f:%l: %m");
makeLinter("ruff",        "python",      "ruff",       ["check", "--output-format=concise", "%f"],                     "%f:%l:%c: %m");
makeLinter("flake8",      "python",      "flake8",     ["%f"],                                                         "%f:%l:%c: %m");
makeLinter("shfmt",       "shell",       "shfmt",      ["%f"],                                                         "%f:%l:%c: %m");
makeLinter("shellcheck",  "shell",       "shellcheck", ["-f", "gcc", "%f"],                                            "%f:%l:%c:.+: %m");
makeLinter("swiftc",      "swift",       "xcrun",      ["swiftc", "%f"],                                               "%f:%l:%c:.+: %m", { os: ["darwin"], whitelist: true });
makeLinter("swiftc-linux","swift",       "swiftc",     ["%f"],                                                         "%f:%l:%c:.+: %m", { os: ["linux"],  whitelist: true });
makeLinter("yaml",        "yaml",        "yamllint",   ["--format", "parsable", "%f"],                                 "%f:%l:%c:.+ %m");
makeLinter("nix-linter",  "nix",         "nix-linter", ["%f"],                                                        "%m at %f:%l:%c",   { os: ["linux"],  whitelist: true });

// ── Errorformat → JS regex ────────────────────────────────────────────────────

function parseErrorformat(ef) {
  const captures = [];
  let out = "";
  let i = 0;

  while (i < ef.length) {
    if (ef[i] === "%") {
      const next = ef[i + 1] ?? "";
      i += 2;
      switch (next) {
        case "f": captures.push("f"); out += "(.+?)"; break;
        case "l": captures.push("l"); out += "(\\d+)"; break;
        case "c": captures.push("c"); out += "(\\d+)"; break;
        case "m": captures.push("m"); out += "(.+)";  break;
        case "%": out += "%"; break;
        case "d": out += "\\d"; break;
        case "D": out += "\\D"; break;
        case "s": out += "\\s"; break;
        case "S": out += "\\S"; break;
        case "w": out += "\\w"; break;
        case "W": out += "\\W"; break;
        case "a": out += "[a-zA-Z]"; break;
        default:
          // Lua punctuation escape → literal, JS-escaped
          out += next.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");
          break;
      }
      continue;
    }

    if (ef[i] === "[") {
      let cls = "[";
      i++;
      while (i < ef.length && ef[i] !== "]") {
        if (ef[i] === "%") {
          const nc = ef[i + 1] ?? "";
          i += 2;
          if (nc === "s") cls += "\\s";
          else if (nc === "S") cls += "\\S";
          else if (nc === "d") cls += "\\d";
          else if (nc === "w") cls += "\\w";
          else if (nc === "%") cls += "%";
          else cls += nc;
        } else {
          cls += ef[i++];
        }
      }
      cls += "]";
      if (ef[i] === "]") i++;
      out += cls;
      continue;
    }

    // Lua `.-` (lazy any) → JS `.*?`
    if (ef[i] === "." && ef[i + 1] === "-") {
      out += ".*?";
      i += 2;
      continue;
    }

    // `|` is literal in Lua patterns but special in JS regex
    if (ef[i] === "|" || ef[i] === "{" || ef[i] === "}") {
      out += "\\" + ef[i++];
      continue;
    }

    out += ef[i++];
  }

  return { regex: new RegExp(out), captures };
}

const _parsedCache = new Map();
function getParsed(ef) {
  if (!_parsedCache.has(ef)) _parsedCache.set(ef, parseErrorformat(ef));
  return _parsedCache.get(ef);
}

// ── eslint JSON output parsing ────────────────────────────────────────────────

function parseEslintJson(output, bufPath) {
  let results;
  try { results = JSON.parse(output); } catch { return null; }
  if (!Array.isArray(results)) return null;

  const msgs = [];
  const bufBase = basename(bufPath);
  for (const file of results) {
    if (!file?.messages || basename(file.filePath ?? "") !== bufBase) continue;
    for (const m of file.messages) {
      msgs.push({
        line: m.line ?? 1,
        col: m.column ?? 1,
        msg: m.message ?? "",
        severity: (m.severity ?? 2) >= 2 ? micro.buffer.MTError : micro.buffer.MTWarning,
      });
    }
  }
  return msgs;
}

// ── OS filter ─────────────────────────────────────────────────────────────────

function checkFtMatch(ft, v) {
  let ftmatch = v.domatch ? new RegExp(v.filetype).test(ft) : ft === v.filetype;
  if (!ftmatch) return false;
  const hasOS = v.osList.includes(GOOS);
  if (!hasOS && v.whitelist) return false;
  if (hasOS && !v.whitelist) return false;
  return true;
}

// ── Spawn + parse ─────────────────────────────────────────────────────────────

async function spawnAndCollect(argv) {
  let proc;
  try {
    proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  } catch (err) {
    micro.pushLintLog(`[linter:${argv[0]}] spawn failed: ${err.message}`);
    return null;
  }
  const dec = new TextDecoder();
  const readAll = async (stream) => {
    const chunks = [];
    if (!stream) return "";
    const reader = stream.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(dec.decode(value, { stream: true }));
    }
    return chunks.join("");
  };
  try {
    const [out, err] = await Promise.all([readAll(proc.stdout), readAll(proc.stderr)]);
    await proc.exited;
    return out + err;
  } catch (err) {
    micro.pushLintLog(`[linter:${argv[0]}] read failed: ${err.message}`);
    return null;
  }
}

async function lint(bufAdapter, linterName, v) {
  const file = bufAdapter.Path ?? bufAdapter.path ?? "";
  const dir = dirname(file) || ".";

  const argv = [v.cmd, ...v.args.map(a => a.replace(/%f/g, file).replace(/%d/g, dir))];
  const output = await spawnAndCollect(argv);
  if (output == null) return;

  bufAdapter.ClearMessages(linterName);

  // eslint: JSON path
  if (v.errorformat === null) {
    const msgs = parseEslintJson(output, file);
    if (!msgs) {
      if (output.trim()) micro.pushLintLog(`[linter:${linterName}]\n${output.trim()}`);
      return;
    }
    for (const { line, col, msg, severity } of msgs) {
      const start = micro.buffer.Loc(col - 1 + v.coffset, line - 1 + v.loffset);
      const end   = micro.buffer.Loc(col     + v.coffset, line - 1 + v.loffset);
      bufAdapter.AddMessage(micro.buffer.newMessage(linterName, msg, start, end, severity));
    }
    micro.render();
    return;
  }

  // Generic errorformat path
  const { regex, captures } = getParsed(v.errorformat);
  const hasCol = captures.includes("c");
  const bufBase = basename(file);

  for (let rawLine of output.split("\n")) {
    rawLine = rawLine.replace(/^\s+|\s+$/g, "");
    if (!rawLine) continue;
    const m = regex.exec(rawLine);
    if (!m) continue;

    const capMap = {};
    captures.forEach((k, idx) => { capMap[k] = m[idx + 1]; });

    if (!capMap.f || basename(capMap.f) !== bufBase) continue;

    const lineNum = Number(capMap.l ?? 1);
    const colNum  = Number(capMap.c ?? 1);
    const msg     = capMap.m ?? "";

    let bmsg;
    if (hasCol && capMap.c != null) {
      const start = micro.buffer.Loc(colNum - 1 + v.coffset, lineNum - 1 + v.loffset);
      const end   = micro.buffer.Loc(colNum     + v.coffset, lineNum - 1 + v.loffset);
      bmsg = micro.buffer.newMessage(linterName, msg, start, end, micro.buffer.MTError);
    } else {
      bmsg = micro.buffer.newMessageAtLine(linterName, msg, lineNum + v.loffset, micro.buffer.MTError);
    }
    bufAdapter.AddMessage(bmsg);
  }
  micro.render();
}

async function runLinter(bp) {
  const ft   = bp.Buf.FileType();
  const buf  = bp.Buf;

  for (const [name, v] of linters) {
    if (!checkFtMatch(ft, v)) continue;
    lint(buf, name, v).catch(e => micro.pushLintLog(`[linter:${name}] ${e.message}`));
  }
}

// ── Hook registration ─────────────────────────────────────────────────────────

micro.on("init", () => {
  micro.MakeCommand("lint", async (bp) => {
    await bp.Save();
    await runLinter(bp);
  });
});

micro.on("onSave", (bp) => {
  runLinter(bp).catch(e => micro.pushLintLog(`[linter:onSave] ${e.message}`));
});

// Expose API for user init.js to override linter definitions
globalThis.linter = { makeLinter, removeLinter, linters };
