const graphemeSegmenter = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

export function isMdcuiTableRow(line) {
  return /^\s*│ .* │\s*$/u.test(String(line ?? ""));
}

function graphemes(line) {
  const text = String(line ?? "");
  if (graphemeSegmenter) {
    return [...graphemeSegmenter.segment(text)].map((item, index, items) => ({
      text: item.segment,
      start: item.index,
      end: items[index + 1]?.index ?? text.length,
    }));
  }
  const result = [];
  for (let start = 0; start < text.length;) {
    const codePoint = text.codePointAt(start);
    const length = codePoint > 0xffff ? 2 : 1;
    result.push({ text: text.slice(start, start + length), start, end: start + length });
    start += length;
  }
  return result;
}

function stringWidth(text) {
  return typeof globalThis.Bun?.stringWidth === "function"
    ? Bun.stringWidth(String(text ?? ""))
    : [...String(text ?? "")].length;
}

function replacementResult(line, target, replacement, cursor) {
  const next = line.slice(0, target.start) + replacement + line.slice(target.end);
  if (stringWidth(next) !== stringWidth(line)) return null;
  return {
    line: next,
    cursor,
    start: target.start,
    end: target.end,
    replacement,
  };
}

function isTableSeparator(target) {
  return target?.text === "│";
}

function isTablePadding(line, target) {
  return target?.text === " " && (
    line[target.start - 1] === "│"
    || line[target.end] === "│"
  );
}

export function backspaceMdcuiTableRow(line, cursor) {
  const text = String(line ?? "");
  if (!isMdcuiTableRow(text)) return null;
  const target = graphemes(text)
    .filter(item => item.end <= cursor)
    .at(-1);
  if (
    !target
    || isTableSeparator(target)
    || isTablePadding(text, target)
  ) return null;
  return replacementResult(
    text,
    target,
    " ".repeat(Math.max(1, stringWidth(target.text))),
    target.start,
  );
}

export function deleteMdcuiTableRow(line, cursor) {
  const text = String(line ?? "");
  if (!isMdcuiTableRow(text)) return null;
  const target = graphemes(text)
    .find(item => item.start >= cursor || (item.start < cursor && item.end > cursor));
  if (!target || isTableSeparator(target)) return null;
  return replacementResult(
    text,
    target,
    " ".repeat(Math.max(1, stringWidth(target.text))),
    target.start,
  );
}

export function overwriteMdcuiTableRow(line, cursor, input) {
  const text = String(line ?? "");
  const value = String(input ?? "");
  if (!isMdcuiTableRow(text) || !value || /\r|\n/u.test(value)) return null;
  const inputWidth = stringWidth(value);
  const items = graphemes(text);
  const targetIndex = items.findIndex(
    item => item.start >= cursor || (item.start < cursor && item.end > cursor),
  );
  const target = items[targetIndex];
  if (
    !target
    || isTableSeparator(target)
    || (isTablePadding(text, target) && value !== " ")
  ) return null;
  if (inputWidth <= 0) return null;

  let end = target.end;
  let targetWidth = stringWidth(target.text);
  for (
    let index = targetIndex + 1;
    targetWidth < inputWidth && index < items.length;
    index++
  ) {
    const next = items[index];
    if (isTableSeparator(next) || isTablePadding(text, next)) return null;
    targetWidth += stringWidth(next.text);
    end = next.end;
  }
  if (inputWidth > targetWidth) return null;
  const replacement = value + " ".repeat(targetWidth - inputWidth);
  return replacementResult(
    text,
    { ...target, end },
    replacement,
    target.start + value.length,
  );
}

function ansiControlEnd(input, start) {
  if (input[start] !== "\x1b") return start;
  if (input[start + 1] === "[") {
    let index = start + 2;
    while (index < input.length) {
      const code = input.charCodeAt(index++);
      if (code >= 0x40 && code <= 0x7e) break;
    }
    return index;
  }
  if (input[start + 1] === "]") {
    const bel = input.indexOf("\x07", start + 2);
    const st = input.indexOf("\x1b\\", start + 2);
    if (bel < 0 && st < 0) return input.length;
    return bel >= 0 && (st < 0 || bel < st) ? bel + 1 : st + 2;
  }
  return Math.min(input.length, start + 2);
}

function ansiRawOffset(input, target, controlsAtBoundary) {
  let plain = 0;
  for (let raw = 0; raw < input.length;) {
    if (!controlsAtBoundary && plain >= target) return raw;
    if (input[raw] === "\x1b") {
      raw = ansiControlEnd(input, raw);
      continue;
    }
    if (plain >= target) return raw;
    const codePoint = input.codePointAt(raw);
    const length = codePoint > 0xffff ? 2 : 1;
    plain += length;
    raw += length;
  }
  return input.length;
}

export function replaceAnsiPlainRange(ansiLine, start, end, replacement) {
  const input = String(ansiLine ?? "");
  const rawStart = ansiRawOffset(input, start, true);
  const rawEnd = ansiRawOffset(input, end, false);
  return input.slice(0, rawStart) + replacement + input.slice(rawEnd);
}

export function replaceAnsiPlainRangePreservingControls(
  ansiLine,
  start,
  end,
  replacement,
) {
  const input = String(ansiLine ?? "");
  const rawStart = ansiRawOffset(input, start, true);
  const rawEnd = ansiRawOffset(input, end, false);
  const segment = input.slice(rawStart, rawEnd);
  let controls = "";
  let inserted = false;

  for (let raw = 0; raw < segment.length;) {
    if (segment[raw] === "\x1b") {
      const controlEnd = ansiControlEnd(segment, raw);
      controls += segment.slice(raw, controlEnd);
      raw = controlEnd;
      continue;
    }
    if (!inserted) {
      controls += String(replacement ?? "");
      inserted = true;
    }
    const codePoint = segment.codePointAt(raw);
    raw += codePoint > 0xffff ? 2 : 1;
  }
  if (!inserted) controls += String(replacement ?? "");
  return input.slice(0, rawStart) + controls + input.slice(rawEnd);
}

export function colorAnsiPlainRange(
  ansiLine,
  start,
  end,
  text,
  sgr = "\x1b[32m",
) {
  const input = String(ansiLine ?? "");
  const rawStart = ansiRawOffset(input, start, true);
  const active = [];
  for (const match of input.slice(0, rawStart).matchAll(/\x1b\[([0-9;]*)m/gu)) {
    const parameters = match[1].split(";").filter(Boolean).map(Number);
    if (parameters.length === 0 || parameters.includes(0)) active.length = 0;
    active.push(match[0]);
  }
  const replacement =
    sgr + String(text ?? "") + "\x1b[0m" + active.join("");
  return replaceAnsiPlainRangePreservingControls(
    input,
    start,
    end,
    replacement,
  );
}
