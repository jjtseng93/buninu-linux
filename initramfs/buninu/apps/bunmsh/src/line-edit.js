export function toggleSavedText(line, cursor, saved, side) {
  line = String(line ?? "");
  cursor = Math.max(0, Math.min(line.length, Number.isFinite(cursor) ? cursor : line.length));
  saved = String(saved ?? "");

  if (side === "head") {
    if (cursor > 0) {
      return {
        line: line.slice(cursor),
        cursor: 0,
        saved: line.slice(0, cursor),
        changed: true,
      };
    }
    if (saved) {
      return {
        line: saved + line,
        cursor: saved.length,
        saved: "",
        changed: true,
      };
    }
  } else if (side === "tail") {
    if (cursor < line.length) {
      return {
        line: line.slice(0, cursor),
        cursor,
        saved: line.slice(cursor),
        changed: true,
      };
    }
    if (saved) {
      return {
        line: line + saved,
        cursor,
        saved: "",
        changed: true,
      };
    }
  }

  return { line, cursor, saved, changed: false };
}
