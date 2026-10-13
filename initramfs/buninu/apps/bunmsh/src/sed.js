// The fallback operates on pattern/hold spaces, with a program counter for
// branches. Parsing delimiters before command separators preserves s/;/x/.
export function compileSed(script, regexSource) {
  let i = 0, lastPattern = null;
  const commands = [], groups = [], labels = new Map();
  const space = () => { while (/[ \t\r]/.test(script[i] ?? "") && i < script.length) i++; };
  const field = delimiter => {
    let value = "";
    for (; i < script.length; i++) {
      const ch = script[i];
      if (ch === delimiter) { i++; return value; }
      if (ch === "\\" && i + 1 < script.length) {
        const next = script[++i];
        value += next === delimiter && !'.*[]^$\\'.includes(next) ? next : `\\${next}`;
      } else value += ch;
    }
    throw new Error("unterminated sed field");
  };
  const regex = pattern => {
    if (pattern) lastPattern = pattern;
    if (lastPattern === null) throw new Error("no previous regular expression");
    return regexSource(lastPattern);
  };
  const address = () => {
    if (script[i] === "$") { i++; return {last:true}; }
    if (/\d/.test(script[i] ?? "")) { const match = /^\d+/.exec(script.slice(i))[0]; i += match.length; return {line:Number(match)}; }
    if (script[i] === "/") { i++; return {regex:new RegExp(regex(field("/")))}; }
    return null;
  };
  while (i < script.length) {
    space();
    if (";\n".includes(script[i])) { i++; continue; }
    if (script[i] === "#") { while (i < script.length && script[i] !== "\n") i++; continue; }
    if (i >= script.length) break;
    const first = address(); space();
    let second = null;
    if (script[i] === ",") { i++; space(); second = address(); if (!second) throw new Error("missing range address"); }
    space(); const invert = script[i] === "!"; if (invert) { i++; space(); }
    const op = script[i++], command = {op, first, second, invert};
    const index = commands.length;
    if (op === "{") groups.push(index);
    else if (op === "}") { const open = groups.pop(); if (open === undefined) throw new Error("unexpected }"); commands[open].end = index; }
    else if (op === "s" || op === "y") {
      const delimiter = script[i++];
      const pattern = field(delimiter), replacement = field(delimiter);
      if (op === "y") {
        const unescape = s => s.replace(/\\n/g,"\n").replace(/\\(.)/g,"$1");
        command.from = unescape(pattern); command.to = unescape(replacement);
        if (command.from.length !== command.to.length) throw new Error("unequal y strings");
      } else {
        const flags = /^[gp0-9]*/.exec(script.slice(i))[0]; i += flags.length;
        command.regex = new RegExp(regex(pattern), "g");
        command.replacement = replacement;
        command.global = flags.includes("g"); command.print = flags.includes("p");
        command.occurrence = Number(/\d+/.exec(flags)?.[0] ?? 1);
      }
    } else if ([":","b","t","T"].includes(op)) {
      space(); const start = i; while (i < script.length && !";\n}".includes(script[i])) i++;
      command.label = script.slice(start,i).trim();
      if (op === ":") labels.set(command.label,index);
    } else if (op === "r") {
      space(); const start=i; while (i<script.length && script[i]!=="\n") i++;
      command.file=script.slice(start,i);
      if (!command.file) throw new Error("r requires a filename");
    } else if (["a","i","c"].includes(op)) {
      space(); if (script[i] === "\\") { i++; if (script[i] === "\n") i++; }
      let text = "";
      while (i < script.length && script[i] !== "\n") {
        if (script[i] === "\\" && script[i+1] === "\n") { text += "\n"; i+=2; }
        else text += script[i++];
      }
      command.text = text;
    } else if (!"pPdDqnhHgGxN=".includes(op ?? "")) throw new Error(`unsupported sed command: ${op}`);
    commands.push(command);
  }
  if (groups.length) throw new Error("unclosed sed group");
  for (const command of commands) if (["b","t","T"].includes(command.op)) {
    command.target = command.label ? labels.get(command.label) : commands.length;
    if (command.target === undefined) throw new Error(`undefined sed label: ${command.label}`);
  }
  return commands;
}

function replacementText(template, args) {
  let output = "";
  for (let i = 0; i < template.length; i++) {
    if (template[i] === "&") output += args[0];
    else if (template[i] === "\\" && i + 1 < template.length) {
      const ch = template[++i];
      output += /[1-9]/.test(ch) ? (args[Number(ch)] ?? "") : ch === "n" ? "\n" : ch;
    } else output += template[i];
  }
  return output;
}

export function applySed(text, commands, quiet, readFile = () => "") {
  if (!text) return "";
  const trailing = text.endsWith("\n"), lines = text.split("\n");
  if (trailing) lines.pop();
  const active = new Set(), output = [];
  let hold = "";
  for (let index = 0; index < lines.length; index++) {
    let pattern = lines[index], deleted = false, changed = false, quit = false;
    const appended = [];
    const emit = value => output.push(value + (index < lines.length-1 || trailing ? "\n" : ""));
    const matches = a => a.last ? index === lines.length-1 : a.line !== undefined ? index+1 === a.line : a.regex.test(pattern);
    for (let pc = 0; pc < commands.length; pc++) {
      const c = commands[pc];
      let selected = !c.first || matches(c.first);
      if (c.second) {
        const wasActive = active.has(pc);
        selected ||= wasActive;
        if (selected) {
          active.add(pc);
          if ((wasActive || !c.second.regex) && (c.second.line !== undefined ? index+1 >= c.second.line : matches(c.second))) active.delete(pc);
        }
      }
      if (c.invert) selected = !selected;
      if (!selected) { if (c.op === "{") pc = c.end; continue; }
      if (c.op === "s") {
        let count = 0, replaced = false;
        pattern = pattern.replace(c.regex,(...args) => {
          count++;
          if (count !== c.occurrence && !(c.global && count >= c.occurrence)) return args[0];
          replaced = true; return replacementText(c.replacement,args);
        });
        changed ||= replaced;
        if (replaced && c.print) emit(pattern);
      } else if (c.op === "y") pattern = [...pattern].map(ch => { const at=c.from.indexOf(ch); return at<0 ? ch : c.to[at]; }).join("");
      else if (c.op === "p") emit(pattern);
      else if (c.op === "P") emit(pattern.split("\n")[0]);
      else if (c.op === "=") emit(String(index+1));
      else if (c.op === "h") hold = pattern;
      else if (c.op === "H") hold += "\n" + pattern;
      else if (c.op === "g") pattern = hold;
      else if (c.op === "G") pattern += "\n" + hold;
      else if (c.op === "x") [pattern,hold] = [hold,pattern];
      else if (c.op === "d") { deleted=true; break; }
      else if (c.op === "D") { const nl=pattern.indexOf("\n"); if (nl<0) { deleted=true; break; } pattern=pattern.slice(nl+1); pc=-1; }
      else if (c.op === "q") { quit=true; break; }
      else if (c.op === "n" || c.op === "N") {
        if (c.op === "n" && !quiet) emit(pattern);
        if (index+1 >= lines.length) { deleted = c.op === "n"; quit=true; break; }
        pattern = (c.op === "N" ? pattern + "\n" : "") + lines[++index]; changed=false;
      } else if (["b","t","T"].includes(c.op)) {
        const take = c.op === "b" || (c.op === "t" ? changed : !changed);
        if (c.op !== "b") changed=false;
        if (take) pc=c.target-1;
      } else if (c.op === "r") appended.push(readFile(c.file));
      else if (c.op === "a") appended.push(c.text+"\n");
      else if (c.op === "i") output.push(c.text+"\n");
      else if (c.op === "c") { if (!c.second || !active.has(pc)) output.push(c.text+"\n"); deleted=true; break; }
    }
    if (!quiet && !deleted) emit(pattern);
    output.push(...appended);
    if (quit) break;
  }
  return output.join("");
}
