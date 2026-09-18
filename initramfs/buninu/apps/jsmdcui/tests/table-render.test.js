import { expect, test } from "bun:test";
import {
  addTuiTableRowSeparators,
  convertTuiTableCheckboxes,
  markHeadingTableRows,
  markTuiTableStripeStyles,
  tuiTableStripeRows,
} from "../src/cui/table-render.mjs";

function renderHeadingTable(markdown, columns) {
  const plan = markHeadingTableRows(markdown);
  const rendered = String(Bun.markdown.ansi(
    plan.markdown,
    { hyperlinks: true, columns },
  ));
  return addTuiTableRowSeparators(rendered, plan);
}

test("table checkbox prefixes are identified before narrow Bun wrapping", () => {
  const markdown = `# Table

| A very long heading | B |
| --- | --- |
| [x] checked | [ ] pending |
`;
  const plan = markHeadingTableRows(markdown);
  expect(plan.markdown).toContain("☒ checked");
  expect(plan.markdown).toContain("☐ pending");

  const rendered = String(Bun.markdown.ansi(plan.markdown, { columns: 12 }));
  const converted = convertTuiTableCheckboxes(
    addTuiTableRowSeparators(rendered, plan),
  );
  expect(Bun.stripANSI(converted)).toContain("☒");
  expect(Bun.stripANSI(converted)).toContain("☐");
  expect(converted).toContain("\x1b[32m☒");
});

test("heading-associated TUI tables receive logical-row separators", () => {
  const markdown = `# Table

| A | B |
| --- | --- |
| one | first |
| two | second |
| three | third |
`;
  const decorated = renderHeadingTable(markdown, 40);
  const lines = Bun.stripANSI(decorated).split("\n");
  const separators = lines.filter(line => /^├─+(?:┼─+)*┤$/u.test(line));

  expect(separators).toHaveLength(3);
  expect(new Set(separators)).toEqual(new Set([separators[0]]));
  expect(Bun.stringWidth(separators[0])).toBe(
    Bun.stringWidth(lines.find(line => line.startsWith("┌"))),
  );
});

test("wrapped visual lines do not receive false logical-row separators", () => {
  const markdown = `# Table

| A | B |
| --- | --- |
| this is a long cell that wraps | value |
| next | row |
`;
  const decorated = renderHeadingTable(markdown, 20);
  const lines = Bun.stripANSI(decorated).split("\n");
  const topWidth = Bun.stringWidth(lines.find(line => line.startsWith("┌")));

  for (const line of lines.filter(line => /^[├│└]/u.test(line))) {
    expect(Bun.stringWidth(line)).toBe(topWidth);
  }
  expect(lines.filter(line => /^├─+(?:┼─+)*┤$/u.test(line))).toHaveLength(2);
});

test("wide table cell text does not break rendered-row discovery", () => {
  const markdown = `# 中文表格

| 名稱 | 狀態 |
| --- | --- |
| 中文 | 完成 |
| emoji | ✅ |
`;
  const lines = Bun.stripANSI(renderHeadingTable(markdown, 30)).split("\n");

  expect(lines.filter(line => /^├─+(?:┼─+)*┤$/u.test(line))).toHaveLength(2);
  expect([...tuiTableStripeRows(lines)]).toHaveLength(2);
});

test("TUI headers and even body display rows receive the colorscheme marker", () => {
  const lines = [
    "┌─────┬─────┐",
    "│ A   │ B   │",
    "├─────┼─────┤",
    "│ one │ 1   │",
    "├─────┼─────┤",
    "│ two │ 2   │",
    "├─────┼─────┤",
    "│ tri │ 3   │",
    "└─────┴─────┘",
  ];
  expect([...tuiTableStripeRows(lines)]).toEqual([1, 5]);

  const styles = lines.map(() => []);
  markTuiTableStripeStyles(styles, lines);
  expect(styles[1][0]?.mdcuiTableStripe).toBe(true);
  expect(styles[3][0]?.mdcuiTableStripe).toBeUndefined();
  expect(styles[5][0]?.mdcuiTableStripe).toBe(true);
  expect(styles[7][0]?.mdcuiTableStripe).toBeUndefined();
});

test("non-table box frames are left unchanged", () => {
  const ansi = "\x1b[2m┌─ js\x1b[0m\n\x1b[2m│ code\x1b[0m\n\x1b[2m└─\x1b[0m";
  expect(addTuiTableRowSeparators(ansi)).toBe(ansi);
});

test("tables without an associated heading keep Bun's original separators", () => {
  const markdown = `| A | B |
| --- | --- |
| one | 1 |
| two | 2 |
`;
  const rendered = String(Bun.markdown.ansi(markdown, { columns: 30 }));
  const plan = markHeadingTableRows(markdown);
  expect(plan.markers).toHaveLength(0);
  expect(addTuiTableRowSeparators(rendered, plan)).toBe(rendered);
});

test("TUI table cell prefixes become fixed-width checkbox glyphs", () => {
  const markdown = `| [ ] Header | Other |
| --- | --- |
| [x] checked | text [ ] unchanged |
| plain | [X] upper |
`;
  const rendered = String(Bun.markdown.ansi(markdown, { columns: 50 }));
  const converted = convertTuiTableCheckboxes(rendered);
  const before = Bun.stripANSI(rendered).split("\n");
  const after = Bun.stripANSI(converted).split("\n");

  expect(after.join("\n")).toContain("☐ Header");
  expect(after.join("\n")).toContain("☒ checked");
  expect(after.join("\n")).toContain("☒ upper");
  expect(after.join("\n")).toContain("text [ ] unchanged");
  expect(converted).toContain("\x1b[32m☒");
  expect(converted).not.toContain("\x1b[32m☐");
  expect(after.map(line => Bun.stringWidth(line))).toEqual(
    before.map(line => Bun.stringWidth(line)),
  );
});
