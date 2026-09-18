import { run } from "../platform/commands.js";

export function shellSplit(input) {
  const args = [];
  let current = "";
  let quote = null;
  let escaped = false;
  let started = false;

  for (const ch of String(input)) {
    if (escaped) {
      if (ch === 'n') current += '\n';
      else if (ch === 't') current += '\t';
      else if (ch === 'r') current += '\r';
      else current += ch;
      escaped = false;
      started = true;
      continue;
    }
    if (ch === "\\" && quote !== "'") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (ch === quote) { quote = null; }
      else { current += ch; }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (started) {
        args.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += ch;
    started = true;
  }

  if (escaped) current += "\\";
  if (quote) throw new Error(`Unclosed ${quote} quote`);
  if (started) args.push(current);
  return args;
}

export async function execCommand(name, args = []) {
  const result = await run([name, ...args.map(String)], { allowFailure: true });
  const output = result.stdout + result.stderr;
  return [output, result.ok ? null : `${name} exited with ${result.code}`];
}

export async function runCommand(input) {
  const args = shellSplit(input);
  if (args.length === 0) return ["", "No arguments"];
  return execCommand(args[0], args.slice(1));
}

export function runBackgroundShell(input) {
  return async () => {
    const [output, error] = await runCommand(input);
    return error ? `${error}: ${output}` : output;
  };
}
