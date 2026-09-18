import { parseMdcuiIdentity } from "./identity.mjs";

function parseIdentity(value) {
  return parseMdcuiIdentity(value);
}

function parseEventAttributes(text) {
  const events = new Map();
  let offset = 0;
  while (offset < text.length) {
    while (/\s/.test(text[offset] ?? "")) offset++;
    if (offset >= text.length || text[offset] !== "@") break;
    offset++;
    const nameStart = offset;
    while (/[A-Za-z0-9_.:-]/.test(text[offset] ?? "")) offset++;
    const name = text.slice(nameStart, offset);
    while (/\s/.test(text[offset] ?? "")) offset++;
    if (!name || text[offset] !== "=") break;
    offset++;
    while (/\s/.test(text[offset] ?? "")) offset++;
    if (text[offset] !== '"') break;
    offset++;

    let code = "";
    let closed = false;
    while (offset < text.length) {
      const ch = text[offset++];
      if (ch === '"') {
        closed = true;
        break;
      }
      if (ch === "\\" && offset < text.length) {
        const next = text[offset++];
        code += next === '"' || next === "\\" ? next : `\\${next}`;
      } else {
        code += ch;
      }
    }
    if (!closed) break;
    const [eventName, ...modifiers] = name.split(".");
    if (eventName === "keydown" || eventName === "input")
      events.set(eventName, { code, modifiers: [...new Set(modifiers.filter(Boolean))] });
  }
  return events;
}

export function parseFenceDeclarations(markdown) {
  const source = String(markdown ?? "");
  const lines = source.split(/\r\n?|\n/);
  let marker = "mdcui-fence-source";
  let markerSuffix = 0;
  while (source.toLowerCase().includes(marker))
    marker = `mdcui-fence-source-${++markerSuffix}`;

  const contentOffset = (line) => {
    let offset = 0;
    const skipWhitespace = () => {
      while (line[offset] === " " || line[offset] === "\t") offset++;
    };
    skipWhitespace();
    while (offset < line.length) {
      if (line[offset] === ">") {
        offset++;
        skipWhitespace();
        continue;
      }
      const listMarker = line.slice(offset).match(
        /^(?:[-+*]|\d{1,9}[.)])(?=[ \t])/u,
      );
      if (!listMarker) break;
      offset += listMarker[0].length;
      skipWhitespace();
    }
    return offset;
  };

  const candidates = [];
  const markedLines = lines.slice();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const offset = contentOffset(line);
    const opening = line.slice(offset).match(/^(`{3,}|~{3,})([^]*)$/u);
    if (!opening) continue;

    const info = String(opening[2] ?? "");
    const leadingWhitespace = info.match(/^\s*/u)?.[0].length ?? 0;
    const infoText = info.slice(leadingWhitespace);
    const firstSpace = infoText.search(/\s/u);
    const identityText =
      firstSpace < 0 ? infoText : infoText.slice(0, firstSpace);
    const attributesText =
      firstSpace < 0 ? "" : infoText.slice(firstSpace);
    const identity = parseIdentity(identityText);
    if (!identity) continue;

    const identityStart =
      offset + opening[1].length + leadingWhitespace;
    const ordinal = candidates.length;
    candidates.push({
      ...identity,
      identity: identityText,
      events: parseEventAttributes(attributesText),
      line: index + 1,
      source: line.trim(),
    });
    markedLines[index] =
      line.slice(0, identityStart)
      + `${marker}-${ordinal}`
      + line.slice(identityStart + identityText.length);
  }
  if (candidates.length === 0) return [];

  const declarations = [];
  const languagePattern = new RegExp(`^${marker}-(\\d+)$`, "u");
  Bun.markdown.render(markedLines.join("\n"), {
    code(children, meta) {
      const match = String(meta?.language ?? "").match(languagePattern);
      const candidate = match ? candidates[Number(match[1])] : null;
      if (candidate) declarations.push(candidate);
      return "";
    },
  });
  return declarations.sort((left, right) => left.line - right.line);
}

export function fenceEventMap(markdown) {
  const result = new Map();
  for (const declaration of parseFenceDeclarations(markdown)) {
    if (
      !["text", "textarea"].includes(declaration.tag)
      || !declaration.id
      || declaration.events.size === 0
      || result.has(declaration.id)
    ) continue;
    result.set(declaration.id, declaration);
  }
  return result;
}

export function inlineFenceEventCode(handler) {
  if (!handler) return "";
  const prefix = handler.modifiers.includes("prevent") ? "event.preventDefault();" : "";
  return prefix + handler.code;
}
