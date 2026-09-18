import { parseMdcuiIdentity } from "./identity.mjs";
import { isMdcuiEncoding } from "../runtime/encodings.js";

function frameHeader(line) {
  const match = String(line ?? "").match(
    /^([ \t│|]*)(┌─|╭─|\+-)\s*(\S+)\s*$/,
  );
  if (!match) return null;
  return {
    prefix: match[1],
    corner: match[1].length,
    border: match[2],
    identity: parseMdcuiIdentity(match[3]),
  };
}

function frameBottom(line) {
  const match = String(line ?? "").match(
    /^([ \t│|]*)(└─|╰─|\+-)\s*$/,
  );
  return match
    ? { prefix: match[1], corner: match[1].length, border: match[2] }
    : null;
}

function matchingFrameBorders(header, bottom) {
  return (
    (header === "┌─" && bottom === "└─")
    || (header === "╭─" && bottom === "╰─")
    || (header === "+-" && bottom === "+-")
  );
}

function cachedHeadingRowIndex(buf) {
  const index = buf?._mdcuiHeadingRowIndex;
  return (
    index?.valid
    && index.source === buf?._mdcuiTuiSourceText
    && index.ansiText === buf?._mdcuiAnsiText
    && index.lines === buf?.lines
    && index.lineCount === (buf?.lines?.length ?? 0)
    && Array.isArray(index.entries)
    && index.byRow instanceof Map
    && index.byOrdinal instanceof Map
  ) ? index : null;
}

function shiftTaskListAnchors(buf, start, oldEnd, delta) {
  if (!(buf?._mdcuiHeadingTaskListAnchors instanceof Map)) return;
  for (const anchor of buf._mdcuiHeadingTaskListAnchors.values()) {
    if (anchor.index >= oldEnd) anchor.index += delta;
    else if (anchor.index >= start) anchor.index = start;
  }
}

function shiftHeadingRows(buf, index, start, oldEnd, delta) {
  if (!index) return;
  const entries = index.entries
    .filter(heading => heading.row < start || heading.row >= oldEnd)
    .map(heading => heading.row >= oldEnd
      ? { ...heading, row: heading.row + delta }
      : heading
    )
    .sort((left, right) => left.row - right.row);

  index.entries = entries;
  index.byRow.clear();
  index.byOrdinal.clear();
  for (const [position, heading] of entries.entries()) {
    heading.position = position;
    index.byRow.set(heading.row, heading);
    index.byOrdinal.set(heading.ordinal, heading);
  }
  index.ansiText = buf._mdcuiAnsiText;
  index.lines = buf.lines;
  index.lineCount = buf.lines.length;
}

export function resizeMdcuiTextBlock(buf, y, x) {
  if (!buf || !isMdcuiEncoding(buf.encoding)) return null;
  const line = String(buf.lines?.[y] ?? "");
  const candidateTop = frameHeader(line);
  const top = candidateTop?.identity?.tag === "text"
    ? candidateTop
    : null;
  const bottom = frameBottom(line);
  if (!top && !bottom) return null;
  if (x !== (top?.corner ?? bottom.corner)) return null;

  let insertAt = -1;
  let removeAt = -1;
  let bodyLine = "";

  if (bottom) {
    for (let row = y - 1; row >= 0; row--) {
      const earlierBottom = frameBottom(buf.lines[row]);
      if (earlierBottom?.prefix === bottom.prefix) break;

      const header = frameHeader(buf.lines[row]);
      if (!header || header.prefix !== bottom.prefix) continue;
      if (
        header.identity?.tag !== "text"
        || !matchingFrameBorders(header.border, bottom.border)
      ) break;
      const marker = header.border === "+-" ? "|" : "│";
      insertAt = y;
      bodyLine = header.prefix + marker + " ";
      break;
    }
  } else {
    const marker = top.border === "+-" ? "|" : "│";
    for (let row = y + 1; row < buf.lines.length; row++) {
      const laterHeader = frameHeader(buf.lines[row]);
      if (laterHeader?.prefix === top.prefix) break;

      const closing = frameBottom(buf.lines[row]);
      if (!closing || closing.prefix !== top.prefix) continue;
      if (matchingFrameBorders(top.border, closing.border)) {
        const candidate = row - 1;
        if (
          candidate > y
          && String(buf.lines[candidate] ?? "") === top.prefix + marker + " "
        ) removeAt = candidate;
      }
      break;
    }
  }

  if (insertAt < 0 && removeAt < 0) return "unchanged";
  buf.pushUndo?.(true);

  const row = insertAt >= 0 ? insertAt : removeAt;
  const deleteCount = removeAt >= 0 ? 1 : 0;
  const replacement = insertAt >= 0 ? [bodyLine] : [];
  const oldEnd = row + deleteCount;
  const delta = replacement.length - deleteCount;
  const headingIndex = cachedHeadingRowIndex(buf);
  buf._mdcuiFenceBlockIndex = null;
  buf._mdcuiControlBlockIndex = null;
  buf.lines.splice(row, deleteCount, ...replacement);

  if (Array.isArray(buf._ansiStyleLines)) {
    const template = buf._ansiStyleLines[Math.max(0, row - 1)] ?? null;
    buf._ansiStyleLines.splice(
      row,
      deleteCount,
      ...replacement.map(() => template),
    );
  }
  if (typeof buf._mdcuiAnsiText === "string") {
    const ansiLines = buf._mdcuiAnsiText.split("\n");
    ansiLines.splice(row, deleteCount, ...replacement);
    buf._mdcuiAnsiText = ansiLines.join("\n");
  }
  if (Array.isArray(buf._mdcuiImages)) {
    buf._mdcuiImages = buf._mdcuiImages
      .filter(image => image.line < row || image.line >= row + deleteCount)
      .map(image => image.line >= row + deleteCount
        ? { ...image, line: image.line + delta }
        : image
      );
  }
  shiftTaskListAnchors(buf, row, oldEnd, delta);
  shiftHeadingRows(buf, headingIndex, row, oldEnd, delta);

  if (insertAt >= 0) {
    if (buf.cursor.y >= insertAt) buf.cursor.y++;
  } else if (buf.cursor.y > removeAt) {
    buf.cursor.y--;
  } else if (buf.cursor.y === removeAt) {
    buf.cursor.y = Math.max(0, removeAt - 1);
  }
  buf.invalidateHighlightFrom?.(row, { force: true });
  buf.modified = true;
  buf.ensureCursor?.();
  return insertAt >= 0 ? "added" : "removed";
}
