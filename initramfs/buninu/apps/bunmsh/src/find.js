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

export async function runFind(argv, state, platform = process.platform, execute = null) {
  let index = 1;
  const roots = [];
  while (index < argv.length && argv[index] !== "!" && argv[index] !== "-not" &&
      !argv[index].startsWith("-")) roots.push(argv[index++]);
  if (!roots.length) roots.push(".");
  let minDepth = 0, maxDepth = Infinity, print0 = false, negate = false, explicitPrint = false;
  const predicates = [];
  const actions = [];
  while (index < argv.length) {
    const option = argv[index++];
    if (option === "!" || option === "-not") { negate = !negate; continue; }
    if (option === "-print") { explicitPrint = true; continue; }
    if (option === "-print0") { explicitPrint = true; print0 = true; continue; }
    if (option === "-exec") {
      const command = [];
      while (index < argv.length && argv[index] !== ";" && argv[index] !== "+")
        command.push(argv[index++]);
      const terminator = argv[index++];
      if (!command.length || (terminator !== ";" && terminator !== "+"))
        return { status: 2, stdout: "", stderr: "bunmsh: find: -exec: missing command or terminator\n" };
      if (!command.includes("{}"))
        return { status: 2, stdout: "", stderr: "bunmsh: find: -exec: command must contain {}\n" };
      actions.push({ command, mode: terminator });
      continue;
    }
    const argument = argv[index++];
    if (argument === undefined)
      return { status: 2, stdout: "", stderr: `bunmsh: find: ${option}: missing argument\n` };
    let predicate;
    if (option === "-name" || option === "-iname") {
      const regex = globRegex(argument, option === "-iname");
      predicate = (entry) => regex.test(basename(entry.shown));
    } else if (option === "-path" || option === "-ipath") {
      const regex = globRegex(argument, option === "-ipath");
      predicate = (entry) => regex.test(entry.shown);
    } else if (option === "-type") {
      if (!/^[fdl]$/.test(argument))
        return { status: 2, stdout: "", stderr: `bunmsh: find: unsupported type: ${argument}\n` };
      predicate = (entry) => argument === "f" ? entry.stats.isFile() :
        argument === "d" ? entry.stats.isDirectory() : entry.stats.isSymbolicLink();
    } else if (option === "-mindepth" || option === "-maxdepth") {
      if (!/^\d+$/.test(argument))
        return { status: 2, stdout: "", stderr: `bunmsh: find: ${option}: invalid depth: ${argument}\n` };
      if (option === "-mindepth") minDepth = Number(argument); else maxDepth = Number(argument);
      continue;
    } else return { status: 2, stdout: "", stderr: `bunmsh: find: unsupported option: ${option}\n` };
    predicates.push(negate ? (entry) => !predicate(entry) : predicate);
    negate = false;
  }
  if (negate) return { status: 2, stdout: "", stderr: "bunmsh: find: expected expression after !\n" };
  let status = 0, stdout = "", stderr = "";
  const decoder = new TextDecoder();
  const appendExecution = (execution) => {
    stdout += typeof execution.stdout === "string" ? execution.stdout : decoder.decode(execution.stdout);
    stderr += typeof execution.stderr === "string" ? execution.stderr : decoder.decode(execution.stderr);
  };
  const matches = [];
  const emit = (shown) => { stdout += shown + (print0 ? "\0" : "\n"); };
  const visit = async (native, shown, depth) => {
    let stats;
    try { stats = lstatSync(native); }
    catch (error) { status = 1; stderr += `bunmsh: find: ${shown}: ${error.message}\n`; return; }
    const entry = { shown, stats };
    if (depth >= minDepth && predicates.every((predicate) => predicate(entry))) {
      matches.push(shown);
      if (!actions.length || explicitPrint) emit(shown);
      for (const action of actions) if (action.mode === ";") {
        if (!execute) return;
        const command = action.command.map((argument) => argument === "{}" ? shown : argument);
        appendExecution(await execute(command));
      }
    }
    if (!stats.isDirectory() || depth >= maxDepth) return;
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
  for (const action of actions) if (action.mode === "+" && matches.length) {
    if (!execute) continue;
    const command = action.command.flatMap((argument) => argument === "{}" ? matches : [argument]);
    const execution = await execute(command);
    appendExecution(execution);
    if (execution.status !== 0) status = 1;
  }
  return { status, stdout, stderr };
}
