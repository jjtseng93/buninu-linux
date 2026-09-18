#!/usr/bin/env bun

import { isAbsolute, resolve } from "node:path";
import { parseCatOperands } from "./cat-operands.js";

const PARSERS = new Map([
  ["json", JSON.parse],
  ["json5", Bun.JSON5.parse],
  ["jsonc", Bun.JSONC.parse],
  ["jsonl", Bun.JSONL.parse],
  ["ndjson", Bun.JSONL.parse],
  ["yaml", Bun.YAML.parse],
  ["yml", Bun.YAML.parse],
  ["toml", Bun.TOML.parse],
]);

if (typeof Bun.XML?.parse === "function") PARSERS.set("xml", Bun.XML.parse);

const RESET = "\x1b[0m";
const COLORS = {
  key: Bun.color("#f92672", "ansi-16m"),
  string: Bun.color("#e6db74", "ansi-16m"),
  escape: Bun.color("#a6e22e", "ansi-16m"),
  number: Bun.color("#ae81ff", "ansi-16m"),
  constant: Bun.color("#66d9ef", "ansi-16m"),
};

const extension = (name) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

const FENCE_LANGUAGES = new Map([
  ["js", "javascript"],
  ["mjs", "javascript"],
  ["cjs", "javascript"],
  ["jsx", "javascript"],
  ["ts", "typescript"],
  ["mts", "typescript"],
  ["cts", "typescript"],
  ["tsx", "typescript"],
]);

// A fence has to be at least as long as the longest run of backticks already
// in the source, or that run would close it early (CommonMark's own rule for
// nesting a fenced block inside another).
export const fenceFor = (source) => {
  const runs = source.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return "`".repeat(Math.max(3, longest + 1));
};

const pretty = (value) => {
  try {
    return JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? `${item}n` : item, 2) ?? String(value);
  } catch {
    return Bun.inspect(value, { colors: false, depth: Infinity });
  }
};

export function colorJson(source) {
  const input = String(source);
  const token = /"(?:\\(?:u[\da-fA-F]{4}|.)|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b/g;
  let output = "", cursor = 0, match;
  while ((match = token.exec(input))) {
    output += input.slice(cursor, match.index);
    const value = match[0];
    if (value.startsWith('"')) {
      const key = /^\s*:/.test(input.slice(token.lastIndex));
      let colored = value.replace(/\\(?:u[\da-fA-F]{4}|.)/g,
        (escape) => `${RESET}${COLORS.escape}${escape}${RESET}${key ? COLORS.key : COLORS.string}`);
      output += `${key ? COLORS.key : COLORS.string}${colored}${RESET}`;
    } else if (value === "true" || value === "false" || value === "null") {
      output += `${COLORS.constant}${value}${RESET}`;
    } else {
      output += `${COLORS.number}${value}${RESET}`;
    }
    cursor = token.lastIndex;
  }
  return output + input.slice(cursor);
}

export function renderFancy(source, name = "") {
  const kind = extension(name);
  if (kind === "md" || kind === "markdown")
    return String(Bun.markdown.ansi(String(source), { hyperlinks: true }));
  const fenceLanguage = FENCE_LANGUAGES.get(kind);
  if (fenceLanguage) {
    const text = String(source);
    const fence = fenceFor(text);
    return String(Bun.markdown.ansi(
      `${fence}${fenceLanguage}\n${text}\n${fence}\n`, { hyperlinks: true }));
  }
  const parser = PARSERS.get(kind);
  return parser ? `${colorJson(pretty(parser(String(source))))}\n` : String(source);
}

export async function main(argv, cwd = process.cwd(), input = Bun.stdin.stream()) {
  const parsed = parseCatOperands(argv, "catfancy");
  if (parsed.error) return { status: 1, stdout: "", stderr: parsed.error };
  const operands = parsed.operands;

  let status = 0, stdout = "", stderr = "";
  for (const operand of operands) {
    try {
      const source = operand === "-"
        ? await new Response(input).text()
        : await Bun.file(isAbsolute(operand) ? operand : resolve(cwd, operand)).text();
      stdout += renderFancy(source, operand === "-" ? "" : operand);
    } catch (error) {
      status = 1;
      stderr += `bunmsh: catfancy: ${operand}: ${error.message}\n`;
    }
  }
  return { status, stdout, stderr };
}
