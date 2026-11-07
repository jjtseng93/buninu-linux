import { lstatSync, readdirSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";

const shellPath = (value) => value.replaceAll("\\", "/");
const nativePath = (value, platform) => platform === "win32" ? value.replaceAll("/", "\\") : value;

function globRegex(pattern, insensitive = false) {
  let source = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "*") source += ".*";
    else if (ch === "?") source += ".";
    else if (ch === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end < 0) source += "\\[";
      else { source += pattern.slice(i, end + 1); i = end; }
    } else source += ch.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
  }
  return new RegExp(`${source}$`, insensitive ? "i" : "");
}

export function findIsRegularBuiltin(platform = process.platform) {
  return platform === "win32";
}

// `write`, when given, takes each result as it is found, so the caller can stream it; without it
// the results are gathered and returned whole, as a captured `$(find ...)` needs.
export async function runFind(argv, state, platform = process.platform, execute = null, write = null) {
  let index = 1;
  const roots = [];
  while (index < argv.length && argv[index] !== "!" && argv[index] !== "-not" && argv[index] !== "(" && argv[index] !== ")" &&
      !argv[index].startsWith("-")) roots.push(argv[index++]);
  if (!roots.length) roots.push(".");
  let minDepth = 0, maxDepth = Infinity;
  // The expression, parsed the POSIX way: `!` binds tightest, then -a (also implied between two
  // terms), then -o; parentheses group. -prune keeps find out of a directory it matched.
  let failure = null;
  const fail = (message) => { failure ??= message; return { kind: "false" }; };
  const peek = () => argv[index];
  let hasAction = false;
  const execs = [];
  let nesting = 0;
  const parsePrimary = () => {
    if (++nesting > 128) throw new Error("expression nesting is too deep");
    try { return parseTerm(); } finally { nesting--; }
  };
  const parseTerm = () => {
    const option = argv[index++];
    if (option === "(") {
      const inner = parseOr();
      if (argv[index++] !== ")") return fail("bunmsh: find: missing )\n");
      return inner;
    }
    if (option === "!" || option === "-not") {
      if (index >= argv.length || [")", "-o", "-or"].includes(peek())) return fail("bunmsh: find: expected expression after !\n");
      return { kind: "not", node: parsePrimary() };
    }
    if (option === "-print" || option === "-print0") { hasAction = true; return { kind: "print", nul: option === "-print0" }; }
    if (option === "-prune") return { kind: "prune" };
    if (option === "-true") return { kind: "true" };
    if (option === "-false") return { kind: "false" };
    if (option === "-exec") {
      const command = [];
      while (index < argv.length && argv[index] !== ";" && !(argv[index] === "+" && command.at(-1)?.includes("{}")))
        command.push(argv[index++]);
      const terminator = argv[index++];
      if (!command.length || (terminator !== ";" && terminator !== "+"))
        return fail("bunmsh: find: -exec: missing command or terminator\n");
      if (terminator === "+" && (command.at(-1) !== "{}" ||
          command.filter(argument => argument.includes("{}")).length !== 1))
        return fail("bunmsh: find: -exec + requires one {} as the final argument\n");
      hasAction = true;
      const node = { kind: "exec", command, mode: terminator, matches: [], matchBytes: 0 };
      execs.push(node);
      return node;
    }
    const argument = argv[index++];
    if (argument === undefined) return fail(`bunmsh: find: ${option}: missing argument\n`);
    if (option === "-name" || option === "-iname") {
      const regex = globRegex(argument, option === "-iname");
      return { kind: "test", test: (entry) => regex.test(basename(entry.shown)) };
    }
    if (option === "-path" || option === "-ipath") {
      const regex = globRegex(argument, option === "-ipath");
      return { kind: "test", test: (entry) => regex.test(entry.shown) };
    }
    if (option === "-type") {
      if (!/^[fdl]$/.test(argument)) return fail(`bunmsh: find: unsupported type: ${argument}\n`);
      return { kind: "test", test: (entry) => argument === "f" ? entry.stats.isFile() :
        argument === "d" ? entry.stats.isDirectory() : entry.stats.isSymbolicLink() };
    }
    if (option === "-mindepth" || option === "-maxdepth") {
      if (!/^\d+$/.test(argument)) return fail(`bunmsh: find: ${option}: invalid depth: ${argument}\n`);
      if (option === "-mindepth") minDepth = Number(argument); else maxDepth = Number(argument);
      return { kind: "true" };
    }
    return fail(`bunmsh: find: unsupported option: ${option}\n`);
  };
  const parseAnd = () => {
    const nodes = [parsePrimary()];
    while (index < argv.length && ![")", "-o", "-or"].includes(peek())) {
      if (peek() === "-a" || peek() === "-and") index++;
      nodes.push(parsePrimary());
    }
    return { kind: "all", nodes };
  };
  function parseOr() {
    const nodes = [parseAnd()];
    while (peek() === "-o" || peek() === "-or") {
      index++;
      nodes.push(parseAnd());
    }
    return { kind: "any", nodes };
  }
  let expression;
  try { expression = index < argv.length ? parseOr() : { kind: "true" }; }
  catch (error) { return { status: 2, stdout: "", stderr: `bunmsh: find: ${error.message}\n` }; }
  if (index < argv.length) fail(`bunmsh: find: unexpected ${argv[index]}\n`);
  if (failure) return { status: 2, stdout: "", stderr: failure };
  // With no action named, the whole expression is followed by -print.
  if (!hasAction) expression = { kind: "and", left: expression, right: { kind: "print", nul: false } };
  let status = 0, stdout = "", stderr = "";
  const decoder = new TextDecoder();
  const appendExecution = async (execution) => {
    const text = typeof execution.stdout === "string" ? execution.stdout : decoder.decode(execution.stdout);
    if (write && text) await write(text); else stdout += text;
    stderr += typeof execution.stderr === "string" ? execution.stderr : decoder.decode(execution.stderr);
  };
  const emit = async (shown, nul) => {
    const line = shown + (nul ? "\0" : "\n");
    if (write) await write(line); else stdout += line;
  };
  // Keep path batches small enough for common exec argument limits, and release
  // them during traversal instead of retaining the whole directory tree.
  const flush = async node => {
    if (!node.matches.length) return;
    const matches = node.matches;
    node.matches = [];
    node.matchBytes = 0;
    if (!execute) { status = 1; return; }
    const execution = await execute([...node.command.slice(0, -1), ...matches]);
    await appendExecution(execution);
    if (execution.status !== 0) status = 1;
  };
  const evaluate = async (node, entry) => {
    switch (node.kind) {
      case "true": return true;
      case "false": return false;
      case "test": return node.test(entry);
      case "all":
        for (const child of node.nodes) if (!(await evaluate(child, entry))) return false;
        return true;
      case "any":
        for (const child of node.nodes) if (await evaluate(child, entry)) return true;
        return false;
      case "not": return !(await evaluate(node.node, entry));
      case "and": return (await evaluate(node.left, entry)) && evaluate(node.right, entry);
      case "or": return (await evaluate(node.left, entry)) || evaluate(node.right, entry);
      case "prune": entry.prune = true; return true;
      case "print": await emit(entry.shown, node.nul); return true;
      case "exec":
        if (node.mode === "+") {
          const size = Buffer.byteLength(entry.shown) + 9;
          if (node.matchBytes + size > 32768) await flush(node);
          node.matches.push(entry.shown);
          node.matchBytes += size;
          return true;
        }
        if (!execute) return false;
        {
          const execution = await execute(node.command.map((argument) => argument.replaceAll("{}", entry.shown)));
          await appendExecution(execution);
          return execution.status === 0;
        }
    }
    return false;
  };
  const visit = async (native, shown, depth) => {
    let stats;
    try { stats = lstatSync(native); }
    catch (error) { status = 1; stderr += `bunmsh: find: ${shown}: ${error.message}\n`; return; }
    const entry = { shown, stats, prune: false };
    if (depth >= minDepth) await evaluate(expression, entry);
    if (entry.prune || !stats.isDirectory() || depth >= maxDepth) return;
    let children;
    try { children = readdirSync(native).sort(); }
    catch (error) { status = 1; stderr += `bunmsh: find: ${shown}: ${error.message}\n`; return; }
    for (const child of children)
      await visit(resolve(native, child), shown === "." ? `./${child}` : `${shown.replace(/\/$/, "")}/${child}`, depth + 1);
  };
  for (const root of roots) {
    const native = isAbsolute(nativePath(root, platform))
      ? nativePath(root, platform) : resolve(nativePath(state.cwd, platform), nativePath(root, platform));
    await visit(native, shellPath(root), 0);
  }
  for (const node of execs) if (node.mode === "+") await flush(node);
  return { status, stdout, stderr };
}
