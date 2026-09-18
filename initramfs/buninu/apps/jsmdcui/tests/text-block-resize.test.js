import { expect, test } from "bun:test";
import { resizeMdcuiTextBlock } from "../src/cui/text-block-resize.mjs";

function buffer(lines, cursorY = 0) {
  let undoCalls = 0;
  return {
    encoding: "mdcui",
    lines: lines.slice(),
    cursor: { x: 0, y: cursorY },
    pushUndo() { undoCalls++; },
    undoCalls() { return undoCalls; },
    invalidateHighlightFrom() {},
    ensureCursor() {},
  };
}

function installRowMetadata(target) {
  const heading = {
    id: "later",
    level: 1,
    ordinal: 0,
    position: 0,
    row: 3,
    column: 0,
  };
  target._mdcuiTuiSourceText = "# source";
  target._mdcuiAnsiText = target.lines.join("\n");
  target._mdcuiHeadingTaskListAnchors = new Map([
    ["before", { index: 1, indent: "" }],
    ["at-resize", { index: 2, indent: "" }],
    ["after", { index: 3, indent: "" }],
  ]);
  target._mdcuiHeadingRowIndex = {
    source: target._mdcuiTuiSourceText,
    ansiText: target._mdcuiAnsiText,
    lines: target.lines,
    lineCount: target.lines.length,
    valid: true,
    entries: [heading],
    byRow: new Map([[heading.row, heading]]),
    byOrdinal: new Map([[heading.ordinal, heading]]),
  };
  return target._mdcuiHeadingRowIndex;
}

test("the lower-left corner adds a row to the nearest text frame", () => {
  const target = buffer([
    "┌─ text#中文-欄位",
    "│ value",
    "└─",
  ], 2);

  expect(resizeMdcuiTextBlock(target, 2, 0)).toBe("added");
  expect(target.lines).toEqual([
    "┌─ text#中文-欄位",
    "│ value",
    "│ ",
    "└─",
  ]);
  expect(target.cursor.y).toBe(3);
  expect(target.undoCalls()).toBe(1);
});

test("prefixed text frames resize only at their visible lower-left corner", () => {
  const scenarios = [
    {
      lines: [
        "    ┌─ text#listed",
        "    │ value",
        "    └─",
      ],
      corner: 4,
      emptyRow: "    │ ",
    },
    {
      lines: [
        "│ ┌─ text#quoted",
        "│ │ value",
        "│ └─",
      ],
      corner: 2,
      emptyRow: "│ │ ",
    },
  ];

  for (const scenario of scenarios) {
    const target = buffer(scenario.lines, 2);

    expect(resizeMdcuiTextBlock(target, 2, 0)).toBeNull();
    expect(target.lines).toEqual(scenario.lines);
    expect(target.undoCalls()).toBe(0);

    expect(resizeMdcuiTextBlock(target, 2, scenario.corner)).toBe("added");
    expect(target.lines).toEqual([
      ...scenario.lines.slice(0, 2),
      scenario.emptyRow,
      scenario.lines[2],
    ]);
    expect(target.undoCalls()).toBe(1);
  }
});

test("row resizing keeps task-list anchors and cached heading rows aligned", () => {
  const target = buffer([
    "┌─ text#field",
    "│ value",
    "└─",
    "Later",
  ], 2);
  const headingIndex = installRowMetadata(target);

  expect(resizeMdcuiTextBlock(target, 2, 0)).toBe("added");
  expect([...target._mdcuiHeadingTaskListAnchors.values()].map(anchor => anchor.index))
    .toEqual([1, 3, 4]);
  expect(target._mdcuiHeadingRowIndex).toBe(headingIndex);
  expect(headingIndex.entries[0].row).toBe(4);
  expect(headingIndex.byRow.has(3)).toBe(false);
  expect(headingIndex.byRow.get(4)?.id).toBe("later");
  expect(headingIndex.byOrdinal.get(0)).toBe(headingIndex.byRow.get(4));
  expect(headingIndex.ansiText).toBe(target._mdcuiAnsiText);
  expect(headingIndex.lineCount).toBe(target.lines.length);

  expect(resizeMdcuiTextBlock(target, 0, 0)).toBe("removed");
  expect([...target._mdcuiHeadingTaskListAnchors.values()].map(anchor => anchor.index))
    .toEqual([1, 2, 3]);
  expect(target._mdcuiHeadingRowIndex).toBe(headingIndex);
  expect(headingIndex.entries[0].row).toBe(3);
  expect(headingIndex.byRow.has(4)).toBe(false);
  expect(headingIndex.byRow.get(3)?.id).toBe("later");
  expect(headingIndex.byOrdinal.get(0)).toBe(headingIndex.byRow.get(3));
  expect(headingIndex.ansiText).toBe(target._mdcuiAnsiText);
  expect(headingIndex.lineCount).toBe(target.lines.length);
});

test("the upper-left corner removes only an empty trailing text row", () => {
  const target = buffer([
    "┌─ text#field",
    "│ value",
    "│ ",
    "└─",
  ]);

  expect(resizeMdcuiTextBlock(target, 0, 0)).toBe("removed");
  expect(target.lines).toEqual([
    "┌─ text#field",
    "│ value",
    "└─",
  ]);
  expect(target.undoCalls()).toBe(1);
});

test("prefixed text frames remove a trailing row at their visible upper-left corner", () => {
  const scenarios = [
    {
      lines: [
        "    ┌─ text#listed",
        "    │ value",
        "    │ ",
        "    └─",
      ],
      corner: 4,
    },
    {
      lines: [
        "│ ┌─ text#quoted",
        "│ │ value",
        "│ │ ",
        "│ └─",
      ],
      corner: 2,
    },
  ];

  for (const scenario of scenarios) {
    const target = buffer(scenario.lines);

    expect(resizeMdcuiTextBlock(target, 0, 0)).toBeNull();
    expect(target.lines).toEqual(scenario.lines);
    expect(target.undoCalls()).toBe(0);

    expect(resizeMdcuiTextBlock(target, 0, scenario.corner)).toBe("removed");
    expect(target.lines).toEqual([
      scenario.lines[0],
      scenario.lines[1],
      scenario.lines[3],
    ]);
    expect(target.undoCalls()).toBe(1);
  }
});

test("a textarea bottom cannot pair with an earlier text header", () => {
  const lines = [
    "┌─ text#first",
    "│ first",
    "└─",
    "",
    "┌─ textarea#second",
    "│ second",
    "└─",
  ];
  const target = buffer(lines, 6);

  expect(resizeMdcuiTextBlock(target, 6, 0)).toBe("unchanged");
  expect(target.lines).toEqual(lines);
  expect(target.undoCalls()).toBe(0);
});

test("frame matching stops at the nearest same-indent boundary", () => {
  const lines = [
    "┌─ text#first",
    "│ first",
    "└─",
    "┌─ unknown#closer",
    "│ closer",
    "└─",
  ];
  const target = buffer(lines, 5);

  expect(resizeMdcuiTextBlock(target, 5, 0)).toBe("unchanged");
  expect(target.lines).toEqual(lines);
  expect(target.undoCalls()).toBe(0);
});
