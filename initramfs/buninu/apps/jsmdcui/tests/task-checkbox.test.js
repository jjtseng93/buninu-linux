import { expect, test } from "bun:test";
import {
  toggleTaskCheckboxBeforeColumn,
  updateAnsiTaskCheckbox,
} from "../src/cui/task-checkbox.mjs";

test("task checkbox toggle reports its position and new checked state", () => {
  expect(toggleTaskCheckboxBeforeColumn("  ☐ todo", 4)).toEqual({
    line: "  ☒ todo",
    toggled: true,
    checkboxAt: 2,
    checked: true,
  });
  expect(toggleTaskCheckboxBeforeColumn("  ☒ todo", 4)).toEqual({
    line: "  ☐ todo",
    toggled: true,
    checkboxAt: 2,
    checked: false,
  });
});

test("task checkbox toggle updates Bun Markdown ANSI color with the glyph", () => {
  const unchecked = "  \x1b[2m☐ \x1b[0mtodo";
  const checked = "  \x1b[32m☒ \x1b[0mtodo";
  expect(updateAnsiTaskCheckbox(unchecked, 2, true)).toBe(checked);
  expect(updateAnsiTaskCheckbox(checked, 2, false)).toBe(unchecked);
});

test("ANSI checkbox lookup ignores OSC 8 hyperlink metadata", () => {
  const prefix = "\x1b]8;;https://example.test\x1b\\link\x1b]8;;\x1b\\ ";
  expect(updateAnsiTaskCheckbox(`${prefix}\x1b[2m☐ \x1b[0mtodo`, 5, true))
    .toBe(`${prefix}\x1b[32m☒ \x1b[0mtodo`);
});
