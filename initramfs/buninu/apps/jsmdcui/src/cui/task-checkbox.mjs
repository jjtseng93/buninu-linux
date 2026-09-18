export function toggleTaskCheckboxBeforeColumn(line, column) {
  const text = String(line ?? "");
  const end = Math.max(0, Math.min(text.length, Math.trunc(Number(column) || 0) + 1));
  const prefix = text.slice(0, end);
  const uncheckedAt = prefix.lastIndexOf("☐");
  const checkedAt = prefix.lastIndexOf("☒");
  const checkboxAt = Math.max(uncheckedAt, checkedAt);

  if (checkboxAt < 0) return { line: text, toggled: false };

  const replacement = text[checkboxAt] === "☐" ? "☒" : "☐";
  return {
    line: text.slice(0, checkboxAt) + replacement + text.slice(checkboxAt + 1),
    toggled: true,
    checkboxAt,
    checked: replacement === "☒",
  };
}

export function updateAnsiTaskCheckbox(ansiLine, checkboxAt, checked) {
  const input = String(ansiLine ?? "");
  const target = checked ? "☒" : "☐";
  const sgr = `\x1b[${checked ? "32" : "2"}m`;
  let plainIndex = 0;

  for (let i = 0; i < input.length;) {
    if (input[i] === "\x1b" && input[i + 1] === "[") {
      let end = i + 2;
      while (end < input.length) {
        const code = input.charCodeAt(end);
        if (code >= 0x40 && code <= 0x7e) { end++; break; }
        end++;
      }
      i = end;
      continue;
    }
    if (input[i] === "\x1b" && input[i + 1] === "]") {
      const bel = input.indexOf("\x07", i + 2);
      const st = input.indexOf("\x1b\\", i + 2);
      if (bel < 0 && st < 0) break;
      i = bel >= 0 && (st < 0 || bel < st) ? bel + 1 : st + 2;
      continue;
    }

    const codePoint = input.codePointAt(i);
    const charLength = codePoint > 0xffff ? 2 : 1;
    if (plainIndex === checkboxAt && (input[i] === "☐" || input[i] === "☒")) {
      const prefix = input.slice(0, i);
      const immediateSgr = prefix.match(/\x1b\[[0-9;]*m$/);
      const beforeStyle = immediateSgr
        ? prefix.slice(0, prefix.length - immediateSgr[0].length) + sgr
        : prefix;
      return beforeStyle + target + input.slice(i + charLength);
    }
    plainIndex += charLength;
    i += charLength;
  }

  return input;
}
