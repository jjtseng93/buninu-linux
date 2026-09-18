import { expect, test } from "bun:test";
import {
  backspaceMdcuiTableRow,
  colorAnsiPlainRange,
  deleteMdcuiTableRow,
  isMdcuiTableRow,
  overwriteMdcuiTableRow,
  replaceAnsiPlainRange,
  replaceAnsiPlainRangePreservingControls,
} from "../src/cui/table-row-edit.mjs";

test("the minimal rendered table-row check requires both vertical edges", () => {
  expect(isMdcuiTableRow("│ cell │")).toBe(true);
  expect(isMdcuiTableRow("  │ cell │  ")).toBe(true);
  expect(isMdcuiTableRow("│cell│")).toBe(false);
  expect(isMdcuiTableRow("│ cell│")).toBe(false);
  expect(isMdcuiTableRow("│cell │")).toBe(false);
  expect(isMdcuiTableRow("│ blockquote")).toBe(false);
  expect(isMdcuiTableRow("plain │ text")).toBe(false);

  const rendered = Bun.stripANSI(String(Bun.markdown.ansi(
    "| one | two |\n| --- | --- |\n| A | B |\n",
    { columns: 40 },
  ))).split("\n");
  expect(isMdcuiTableRow(rendered.find(line => line.includes("A")))).toBe(true);
});

test("table-row backspace clears one grapheme without changing display width", () => {
  const line = "│ A中 │";
  const edit = backspaceMdcuiTableRow(line, line.indexOf("中") + 1);

  expect(edit.line).toBe("│ A   │");
  expect(edit.cursor).toBe(line.indexOf("中"));
  expect(Bun.stringWidth(edit.line)).toBe(Bun.stringWidth(line));
  expect(backspaceMdcuiTableRow(line, 1)).toBeNull();
});

test("table-row backspace stops at separator padding", () => {
  const line = "│ A │ B │";
  const leftPadding = 1;
  const middleLeftPadding = line.indexOf("│", 1) - 1;
  const middleRightPadding = line.indexOf("│", 1) + 1;
  const rightPadding = line.lastIndexOf("│") - 1;

  for (const padding of [
    leftPadding,
    middleLeftPadding,
    middleRightPadding,
    rightPadding,
  ]) {
    expect(backspaceMdcuiTableRow(line, padding + 1)).toBeNull();
  }
});

test("table-row overwrite and delete preserve separators and visual width", () => {
  const line = "│ 中B │";
  const space = overwriteMdcuiTableRow(line, line.indexOf("中"), " ");
  expect(space.line).toBe("│   B │");
  expect(space.cursor).toBe(line.indexOf("中") + 1);
  expect(Bun.stringWidth(space.line)).toBe(Bun.stringWidth(line));

  const wide = overwriteMdcuiTableRow("│ AB │", 2, "中");
  expect(wide.line).toBe("│ 中 │");
  expect(Bun.stringWidth(wide.line)).toBe(Bun.stringWidth("│ AB │"));
  expect(overwriteMdcuiTableRow(line, 0, "x")).toBeNull();
  expect(deleteMdcuiTableRow(line, line.indexOf("中")).line).toBe("│   B │");
});

test("IME-width characters consume adjacent cell columns without crossing padding", () => {
  const line = "│      │";
  const first = overwriteMdcuiTableRow(line, 2, "中");
  expect(first.line).toBe("│ 中   │");
  expect(first.cursor).toBe(3);
  expect(Bun.stringWidth(first.line)).toBe(Bun.stringWidth(line));

  const second = overwriteMdcuiTableRow(first.line, first.cursor, "文");
  expect(second.line).toBe("│ 中文 │");
  expect(Bun.stringWidth(second.line)).toBe(Bun.stringWidth(line));

  expect(overwriteMdcuiTableRow("│ A │", 2, "中")).toBeNull();
});

test("table-row overwrite preserves padding beside every separator", () => {
  const line = "│ A │ B │";
  const paddingColumns = [
    1,
    line.indexOf("│", 1) - 1,
    line.indexOf("│", 1) + 1,
    line.lastIndexOf("│") - 1,
  ];

  for (const cursor of paddingColumns) {
    expect(overwriteMdcuiTableRow(line, cursor, "x")).toBeNull();
    const space = overwriteMdcuiTableRow(line, cursor, " ");
    expect(space.line).toBe(line);
    expect(Bun.stringWidth(space.line)).toBe(Bun.stringWidth(line));
  }
});

test("ANSI range replacement keeps one surrounding OSC 8 link", () => {
  const line = "\x1b]8;;javascript:test()\x1b\\\x1b[34m☐ haha\x1b[0m\x1b]8;;\x1b\\";
  const replaced = replaceAnsiPlainRange(line, 0, 1, " ");

  expect(Bun.stripANSI(replaced)).toBe("  haha");
  expect(replaced.match(/\x1b]8;;javascript:test\(\)\x1b\\/g)).toHaveLength(1);
  expect(replaced.match(/\x1b]8;;\x1b\\/g)).toHaveLength(1);
});

test("text-only ANSI replacement retains controls inside the changed range", () => {
  const ansi =
    "\x1b[31mA\x1b[32mB"
    + "\x1b]8;;javascript:test()\x1b\\C\x1b]8;;\x1b\\"
    + "\x1b[0m";
  const replaced = replaceAnsiPlainRangePreservingControls(
    ansi,
    0,
    3,
    "XYZ",
  );

  expect(Bun.stripANSI(replaced)).toBe("XYZ");
  expect(replaced).toBe(
    "\x1b[31mXYZ\x1b[32m"
    + "\x1b]8;;javascript:test()\x1b\\\x1b]8;;\x1b\\"
    + "\x1b[0m",
  );
});

test("ANSI range color restores the style active before the glyph", () => {
  const ansi =
    "\x1b[1mA\x1b[34mB\x1b]8;;javascript:test()\x1b\\C"
    + "\x1b]8;;\x1b\\D\x1b[0m";
  const colored = colorAnsiPlainRange(ansi, 2, 3, "☒");

  expect(Bun.stripANSI(colored)).toBe("AB☒D");
  expect(colored).toContain("\x1b[32m☒\x1b[0m\x1b[1m\x1b[34m");
  expect(colored).toContain("javascript:test()");
});
