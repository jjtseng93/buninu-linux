import { parseFenceDeclarations } from "./fence-events.mjs";
import {
  collectMarkdownHeadingDeclarations,
  collectRawHtmlHeadingDeclarations,
  renderMarkdownWithHeadingIds,
} from "./heading-ids.mjs";

function fencedBlockDeclarations(markdown) {
  return parseFenceDeclarations(markdown)
    .filter((declaration) => declaration.id)
    .map((declaration) => ({
      id: declaration.id,
      kind: `${declaration.tag} fenced block`,
      line: declaration.line,
      source: declaration.source,
    }));
}

export function checkMarkdownIdCollisions(markdown) {
  const rendered = renderMarkdownWithHeadingIds(markdown);
  if (!rendered.normalized)
    throw new Error("Markdown headings could not be classified safely");
  const declarations = [
    ...collectMarkdownHeadingDeclarations(markdown, { includeLevel: true }),
    ...collectRawHtmlHeadingDeclarations(markdown, {
      strict: true,
      includeLevel: true,
    }),
    ...fencedBlockDeclarations(markdown),
  ].sort((a, b) => a.line - b.line);
  const byId = new Map();
  for (const declaration of declarations) {
    if (!byId.has(declaration.id)) byId.set(declaration.id, []);
    byId.get(declaration.id).push(declaration);
  }
  const collisions = [...byId.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([id, items]) => ({ id, declarations: items }));
  return { declarations, collisions };
}

export function formatMarkdownOutline(result) {
  const lines = [];
  for (const declaration of result?.declarations ?? []) {
    if (
      declaration.kind === "heading"
      || declaration.kind === "raw HTML heading"
    ) {
      const level = Math.min(6, Math.max(1, Number(declaration.level) || 1));
      lines.push(`${"  ".repeat(level - 1)}- ${declaration.id}`);
    } else {
      lines.push(`+ ${declaration.id}`);
    }
  }
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function inlineCode(value) {
  const text = String(value);
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const delimiter = "`".repeat(longest + 1);
  const padding = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${delimiter}${padding}${text}${padding}${delimiter}`;
}

export function formatMarkdownIdCheck(path, result) {
  const headings = result.declarations.filter(
    item => item.kind === "heading" || item.kind === "raw HTML heading",
  ).length;
  const fencedBlocks = result.declarations.length - headings;
  const lines = [
    "# Markdown UI ID Check",
    "",
    `- File: ${inlineCode(path)}`,
    `- Selectable IDs: **${result.declarations.length}**`,
    `  * Headings: **${headings}**`,
    `  * Fenced blocks: **${fencedBlocks}**`,
  ];

  if (!result.collisions.length) {
    lines.push("", "## No ID collisions found");
    return lines.join("\n");
  }

  lines.push("", `## FAIL — Found ${result.collisions.length} colliding ID(s)`);
  for (const collision of result.collisions) {
    lines.push("", `### ID ${inlineCode(`#${collision.id}`)}`);
    lines.push("", `- Declarations: **${collision.declarations.length}**`);
    for (const declaration of collision.declarations) {
      lines.push(`  * Line **${declaration.line}**`);
      lines.push(`    - Type: ${declaration.kind}`);
      lines.push(`    - Source: ${inlineCode(declaration.source)}`);
    }
  }
  lines.push("", "## Suggested fix", "", "- Rename the heading or fenced block so every selectable ID is unique.");
  return lines.join("\n");
}

function statusBanner(label, color, fallbackColor) {
  const foreground = Bun.color?.(color, "ansi-16m") || fallbackColor;
  return `${foreground}\x1b[1m${label}\x1b[0m\n${foreground}\x1b[2m${"═".repeat(label.length)}\x1b[0m\n`;
}

export function formatMarkdownIdCheckAnsi(path, result) {
  let output = String(Bun.markdown.ansi(formatMarkdownIdCheck(path, result)));
  if (!output.endsWith("\n")) output += "\n";
  output += "\n" + (result.collisions.length
    ? statusBanner("FAILED", "#ff3030", "\x1b[31m")
    : statusBanner("PASSED", "#00d75f", "\x1b[32m"));
  return output;
}
