import { describe, expect, test } from "bun:test";
import { createWebDollar } from "../src/cui/rpc.mjs";
import {
  addTuiTableRowSeparators,
  markHeadingTableRows,
} from "../src/cui/table-render.mjs";
import {
  captureTuiRerenderState,
  clearTuiSourceDependentState,
  createTuiSelector,
  indexTuiHeadingRows,
  markTuiTableCellDirtyAtPosition,
  restoreTuiRerenderState,
  spliceTuiBufferLines,
  toggleTuiHeadingAt,
  tuiTableCellAtPosition,
  tuiCheckboxRerenderMismatchMessage,
} from "../src/plugins/js-bridge.js";
import { colorAnsiPlainRange } from "../src/cui/table-row-edit.mjs";

function tuiSelector(markdown) {
  const ansi = String(Bun.markdown.ansi(markdown, { hyperlinks: true, columns: 80 }));
  const buffer = {
    lines: Bun.stripANSI(ansi).split("\n"),
    _mdcuiTuiSourceText: markdown,
    _mdcuiAnsiText: ansi,
    cursor: { x: 0, y: 0 },
    ensureCursor() {},
    invalidateHighlightFrom() {},
  };
  indexTuiHeadingRows(buffer);
  return { $: createTuiSelector(() => buffer), buffer };
}

function tuiTableSelector(markdown, columns = 24) {
  const plan = markHeadingTableRows(markdown);
  const rendered = String(Bun.markdown.ansi(
    plan.markdown,
    { hyperlinks: true, columns },
  ));
  const ansi = addTuiTableRowSeparators(rendered, plan);
  const buffer = {
    lines: Bun.stripANSI(ansi).split("\n"),
    _mdcuiTuiSourceText: markdown,
    _mdcuiAnsiText: ansi,
    _ansiStyleLines: Bun.stripANSI(ansi).split("\n").map(line =>
      Array.from({ length: line.length }, () => ({ fg: "white" }))
    ),
    cursor: { x: 0, y: 0 },
    ensureCursor() {},
    invalidateHighlightFrom() {},
    pushUndo() {
      this.undoCount = (this.undoCount ?? 0) + 1;
    },
  };
  indexTuiHeadingRows(buffer);
  return { $: createTuiSelector(() => buffer), buffer };
}

const markdown = `## Features

- [x] Search
- [ ] Notifications
  - [x] Nested notification option
- [x] Offline

Paragraph between lists.

- [x] Later list item

## Next
`;

describe("TUI heading task-list Array methods", () => {
  test("push and unshift accept multiple items and return the new direct length", () => {
    const { $ } = tuiSelector(markdown);
    const features = $("#features");

    expect(features.push("Export", { value: "Sync", checked: true })).toBe(5);
    expect(features.val()).toEqual(["Search", "Offline", "Sync"]);
    expect(features.unshift("First", { label: "Pinned", checked: true })).toBe(7);
    expect(features.val()).toEqual(["Pinned", "Search", "Offline", "Sync"]);
  });

  test("pop and shift return removed labels and remove nested children with the parent", () => {
    const { $, buffer } = tuiSelector(markdown);
    const features = $("#features");

    expect(features.shift()).toBe("Search");
    expect(buffer.lines.some((line) => line.includes("Search"))).toBe(false);
    expect(features.shift()).toBe("Notifications");
    expect(buffer.lines.some((line) => line.includes("Nested notification option"))).toBe(false);
    expect(features.pop()).toBe("Offline");
    expect(features.pop()).toBeUndefined();
  });

  test("an emptied list keeps its insertion point for later pushes", () => {
    const { $ } = tuiSelector("## Features\n\n- [ ] Only\n\n## Next\n");
    const features = $("#features");

    expect(features.pop()).toBe("Only");
    expect(features.pop()).toBeUndefined();
    expect(features.push({ value: "Again", checked: true })).toBe(1);
    expect(features.val()).toEqual(["Again"]);
  });

  test("an empty child list keeps its position across block resizing and ancestor visibility", () => {
    const scenarios = [
      { tag: "text", value: "one\ntwo\nthree\nfour", label: "After growing text" },
      { tag: "textarea", value: "one", label: "After shrinking textarea" },
    ];

    for (const scenario of scenarios) {
      const source = `# Parent

\`\`\`${scenario.tag}#editor
one
two
\`\`\`

## Child

- [ ] Only child item

## Later

Later body.

# End
`;
      const { $, buffer } = tuiSelector(source);
      const child = $("#child");

      expect(child.pop()).toBe("Only child item");
      $(`${scenario.tag}#editor`).val(scenario.value);
      $("#parent").hide().show();

      expect(child.push(scenario.label)).toBe(1);

      const childHeading = buffer.lines.findIndex((line) => line.trim() === "Child");
      const inserted = buffer.lines.findIndex((line) => line.includes(scenario.label));
      const laterHeading = buffer.lines.findIndex((line) => line.trim() === "Later");
      expect(inserted).toBeGreaterThan(childHeading);
      expect(inserted).toBeLessThan(laterHeading);
      expect(child.slice()).toEqual([{ value: scenario.label, checked: false }]);
    }
  });

  test("a hidden section keeps relative empty-list anchors when a preceding block grows", () => {
    const source = `\`\`\`text#before
one
\`\`\`

# Parent

## Child

- [ ] Only child item

# End
`;
    const { $, buffer } = tuiSelector(source);
    const child = $("#child");

    expect(child.pop()).toBe("Only child item");
    $("#parent").hide();
    $("text#before").val("one\ntwo\nthree\nfour");
    $("#parent").show();
    expect(child.push("After hidden growth")).toBe(1);

    const childHeading = buffer.lines.findIndex((line) => line.trim() === "Child");
    const inserted = buffer.lines.findIndex((line) => line.includes("After hidden growth"));
    const endHeading = buffer.lines.findIndex((line) => line.trim() === "End");
    expect(inserted).toBeGreaterThan(childHeading);
    expect(inserted).toBeLessThan(endHeading);
    expect(child.slice()).toEqual([{ value: "After hidden growth", checked: false }]);
  });

  test("nested hidden sections restore every empty-list anchor independently", () => {
    const source = `# Parent

## Alpha

- [ ] Only alpha

### Deep

- [ ] Only deep

## Beta

- [ ] Only beta

# End
`;
    const { $, buffer } = tuiSelector(source);
    const alpha = $("#alpha");
    const deep = $("#deep");
    const beta = $("#beta");

    expect(alpha.pop()).toBe("Only alpha");
    expect(deep.pop()).toBe("Only deep");
    expect(beta.pop()).toBe("Only beta");

    alpha.hide();
    $("#parent").hide().show();
    alpha.show();

    expect(alpha.push("Restored alpha")).toBe(1);
    expect(deep.push("Restored deep")).toBe(1);
    expect(beta.push("Restored beta")).toBe(1);
    expect(alpha.slice()).toEqual([{ value: "Restored alpha", checked: false }]);
    expect(deep.slice()).toEqual([{ value: "Restored deep", checked: false }]);
    expect(beta.slice()).toEqual([{ value: "Restored beta", checked: false }]);

    const positions = Object.fromEntries(
      ["Alpha", "Restored alpha", "Deep", "Restored deep", "Beta", "Restored beta", "End"]
        .map((text) => [text, buffer.lines.findIndex((line) => line.includes(text))]),
    );
    expect(positions.Alpha).toBeLessThan(positions["Restored alpha"]);
    expect(positions["Restored alpha"]).toBeLessThan(positions.Deep);
    expect(positions.Deep).toBeLessThan(positions["Restored deep"]);
    expect(positions["Restored deep"]).toBeLessThan(positions.Beta);
    expect(positions.Beta).toBeLessThan(positions["Restored beta"]);
    expect(positions["Restored beta"]).toBeLessThan(positions.End);
  });

  test("val and mutations stop at the first rendered task list", () => {
    const { $ } = tuiSelector(markdown);
    const features = $("#features");

    expect(features.val()).toEqual(["Search", "Offline"]);
    expect(features.pop()).toBe("Offline");
    expect(features.val()).toEqual(["Search"]);
  });

  test("a loose task list remains one list across indented item content", () => {
    const { $ } = tuiSelector(`## Features

- [x] First

  More detail

- [x] Second

Paragraph after the list.

- [x] Later list
`);
    const features = $("#features");

    expect(features.val()).toEqual(["First", "Second"]);
    expect(features.pop()).toBe("Second");
    expect(features.pop()).toBe("First");
    expect(features.pop()).toBeUndefined();
  });

  test("splice follows Array indexing, insertion, deletion, and return semantics", () => {
    const { $, buffer } = tuiSelector(markdown);
    const features = $("#features");

    expect(features.splice()).toEqual([]);
    expect(features.splice(1, 1, { value: "Replacement", checked: true }, "Extra"))
      .toEqual(["Notifications"]);
    expect(buffer.lines.some((line) => line.includes("Nested notification option"))).toBe(false);
    expect(features.val()).toEqual(["Search", "Replacement", "Offline"]);
    expect(features.splice(-1)).toEqual(["Offline"]);
    expect(features.splice(1, undefined, "Inserted")).toEqual([]);
    expect(features.splice(0, Infinity)).toEqual(["Search", "Inserted", "Replacement", "Extra"]);
    expect(features.val()).toEqual([]);
    expect(features.splice(0, 0, { label: "Again", checked: true })).toEqual([]);
    expect(features.val()).toEqual(["Again"]);
  });

  test("slice returns read-only item snapshots with checked state", () => {
    const { $ } = tuiSelector(markdown);
    const features = $("#features");

    const result = features.slice(0, 2);
    expect(result).toEqual([
      { value: "Search", checked: true },
      { value: "Notifications", checked: false },
    ]);
    result[0].value = "Changed snapshot";
    result[0].checked = false;
    expect(features.slice(-1)).toEqual([{ value: "Offline", checked: true }]);
    expect(features.val()).toEqual(["Search", "Offline"]);
  });

  test("a heading without a task list cannot create one implicitly", () => {
    const { $, buffer } = tuiSelector("## Empty\n\nParagraph.\n");
    expect($("#empty").push("No target")).toBe(0);
    expect($("#empty").unshift("No target")).toBe(0);
    expect($("#empty").pop()).toBeUndefined();
    expect($("#empty").shift()).toBeUndefined();
    expect(buffer._mdcuiMutationMacros).toBeUndefined();
  });

  test("does not borrow a task list from outside the heading's Markdown container", () => {
    const scenarios = [
      {
        source: `> ## Quoted
>
> Inside quote.

- [x] Outside quote
`,
        id: "quoted",
        outside: "Outside quote",
      },
      {
        source: `- Item

    ## Listed

    Inside list item.

- [x] Outside list item
`,
        id: "listed",
        outside: "Outside list item",
      },
    ];

    for (const scenario of scenarios) {
      const { $, buffer } = tuiSelector(scenario.source);
      const heading = $(`#${scenario.id}`);

      expect(heading.val()).toEqual([]);
      expect(heading.slice()).toEqual([]);
      expect(heading.push("Must stay absent")).toBe(0);
      expect(buffer.lines.some(line => line.includes(scenario.outside)))
        .toBe(true);
      expect(buffer.lines.some(line => line.includes("Must stay absent")))
        .toBe(false);
    }
  });

  test("uses and mutates a direct task list inside a blockquote", () => {
    const source = `> ## Quoted
>
> - [x] Inside checked
> - [ ] Inside unchecked

- [x] Outside quote
`;
    const { $, buffer } = tuiSelector(source);
    const quoted = $("#quoted");

    expect(quoted.val()).toEqual(["Inside checked"]);
    expect(quoted.slice()).toEqual([
      { value: "Inside checked", checked: true },
      { value: "Inside unchecked", checked: false },
    ]);
    expect(quoted.push({ value: "Inside added", checked: true })).toBe(3);
    expect(quoted.val()).toEqual(["Inside checked", "Inside added"]);
    expect(buffer.lines.some(line =>
      line.startsWith("│") && line.includes("Inside added")
    )).toBe(true);
    expect(buffer.lines.some(line =>
      line.includes("Outside quote") && line.includes("☒")
    )).toBe(true);
  });

  test("does not mistake a blockquote table cell for a task-list item", () => {
    const source = `> ## Quoted
>
> | Value |
> | --- |
> | ☒ Not a task |
>
> - [x] Real task
`;
    const { $ } = tuiSelector(source);

    expect($("#quoted").val()).toEqual(["Real task"]);
    expect($("#quoted").slice()).toEqual([
      { value: "Real task", checked: true },
    ]);
  });

  test("mutations against a hidden heading fail without recording a macro", () => {
    const { $, buffer } = tuiSelector(markdown);
    const features = $("#features");

    features.hide();
    expect(features.push("Hidden addition")).toBe(0);
    expect(features.pop()).toBeUndefined();
    expect(features.shift()).toBeUndefined();
    expect(features.unshift("Hidden first")).toBe(0);
    expect(features.splice(0, 1, "Hidden replacement")).toEqual([]);
    expect(buffer._mdcuiMutationMacros).toBeUndefined();

    features.show();
    expect(buffer.lines.some((line) => line.includes("Hidden addition"))).toBe(false);
    expect(features.val()).toEqual(["Search", "Offline"]);
  });

  test("a preceding hidden section does not extend a later heading into its child list", () => {
    const source = `## Earlier

### Earlier child

Earlier body.

## Parent

Parent has no list.

### Child

- [x] Child checkbox
`;
    const { $, buffer } = tuiSelector(source);

    $("#earlier").hide();
    expect($("#parent").val()).toEqual([]);
    expect($("#parent").slice()).toEqual([]);
    expect($("#parent").push("Must not reach child")).toBe(0);
    expect(buffer._mdcuiMutationMacros).toBeUndefined();
    expect($("#child").val()).toEqual(["Child checkbox"]);
    expect(buffer.lines.some((line) => line.includes("Must not reach child"))).toBe(false);
  });

  test("a heading concealed by its parent cannot resolve to an earlier same-level heading", () => {
    const source = `## Wrong

- [x] Wrong item

# Parent

## Hidden

- [x] Hidden item

## Also hidden

Body.

# End
`;
    const { $, buffer } = tuiSelector(source);
    const hidden = $("#hidden");

    $("#parent").hide();
    expect(hidden.line()).toBe(0);
    expect(hidden.text()).toBe("");
    expect(hidden.val()).toEqual([]);
    expect(hidden.slice()).toEqual([]);
    expect(hidden.push("Must not reach Wrong")).toBe(0);
    expect(hidden.pop()).toBeUndefined();
    expect(hidden.shift()).toBeUndefined();
    expect(hidden.unshift("Must not reach Wrong first")).toBe(0);
    expect(hidden.splice(0, 1, "Must not replace Wrong")).toEqual([]);
    expect($("#wrong").slice()).toEqual([{ value: "Wrong item", checked: true }]);
    expect(buffer._mdcuiMutationMacros).toBeUndefined();
    expect(buffer.lines.some((line) => line.includes("Must not"))).toBe(false);
  });
});

describe("TUI heading section visibility", () => {
  const sectionMarkdown = `# First

First body.

## Child

Child body.

### Grandchild

Grandchild body.

## Sibling

Sibling body.

# Second

Second body.
`;

  test("hide keeps the heading and hides through the next equal or higher heading", () => {
    const { $, buffer } = tuiSelector(sectionMarkdown);
    const child = $("#child");

    expect(child.hide()).toBe(child);
    expect(buffer.lines.some(line => line.includes("Child"))).toBe(true);
    expect(buffer.lines.some(line => line.includes("Child body."))).toBe(false);
    expect(buffer.lines.some(line => line.includes("Grandchild"))).toBe(false);
    expect(buffer.lines.some(line => line.includes("Sibling body."))).toBe(true);
    expect(buffer.lines.some(line => line.includes("Second body."))).toBe(true);
  });

  test("show restores the section and toggle switches the id-centered state", () => {
    const { $, buffer } = tuiSelector(sectionMarkdown);
    const child = $("#child");

    child.hide();
    child.show();
    expect(buffer.lines.some(line => line.includes("Child body."))).toBe(true);
    expect(buffer.lines.some(line => line.includes("Grandchild body."))).toBe(true);

    child.toggle();
    expect(buffer.lines.some(line => line.includes("Child body."))).toBe(false);
    child.toggle();
    expect(buffer.lines.some(line => line.includes("Child body."))).toBe(true);
  });

  test("show, hide, and toggle update a child while its parent is hidden", () => {
    const scenarios = [
      { initiallyHidden: false, method: "hide", visible: false },
      { initiallyHidden: true, method: "show", visible: true },
      { initiallyHidden: false, method: "toggle", visible: false },
      { initiallyHidden: true, method: "toggle", visible: true },
    ];

    for (const scenario of scenarios) {
      const { $, buffer } = tuiSelector(sectionMarkdown);
      const first = $("#first");
      const child = $("#child");
      if (scenario.initiallyHidden) child.hide();
      first.hide();

      child[scenario.method]();

      expect(buffer._mdcuiIdStore.get("first").headingVisibility.hidden).toBe(true);
      expect(buffer.lines.some(line => line.includes("First body."))).toBe(false);
      first.show();
      expect(buffer.lines.some(line => line.includes("Child body.")))
        .toBe(scenario.visible);
      expect(Boolean(buffer._mdcuiIdStore.get("child")?.headingVisibility?.hidden))
        .toBe(!scenario.visible);
    }
  });

  test("a deep toggle crosses multiple hidden ancestors without exposing them", () => {
    const { $, buffer } = tuiSelector(sectionMarkdown);
    const first = $("#first");
    const child = $("#child");
    const grandchild = $("#grandchild");

    $("#second").hide();
    child.hide();
    first.hide();
    buffer.cursor = { x: 0, y: buffer.lines.length - 1 };
    buffer.modified = false;
    const cursor = { ...buffer.cursor };

    grandchild.toggle();

    expect(buffer.cursor).toEqual(cursor);
    expect(buffer.modified).toBe(false);
    expect(buffer._mdcuiIdStore.get("first").headingVisibility.hidden).toBe(true);
    expect(buffer._mdcuiIdStore.get("child").headingVisibility.hidden).toBe(true);
    expect(buffer._mdcuiIdStore.get("grandchild").headingVisibility.hidden).toBe(true);
    expect(buffer._mdcuiIdStore.get("second").headingVisibility.hidden).toBe(true);

    first.show();
    child.show();
    expect(buffer.lines.some(line => line.includes("Grandchild"))).toBe(true);
    expect(buffer.lines.some(line => line.includes("Grandchild body."))).toBe(false);
    grandchild.show();
    expect(buffer.lines.some(line => line.includes("Grandchild body."))).toBe(true);
  });

  test("visibility changes do not mark the read-only rendered buffer modified", () => {
    const { $, buffer } = tuiSelector(sectionMarkdown);
    buffer.modified = false;

    $("#first").hide();
    expect(buffer.modified).toBe(false);
    expect(buffer._mdcuiIdStore.get("first").headingVisibility.hidden).toBe(true);
    $("#first").show();
    expect(buffer.modified).toBe(false);
    expect(buffer._mdcuiIdStore.has("first")).toBe(false);
  });

  test("heading visibility shares a general id record without replacing other state", () => {
    const { $, buffer } = tuiSelector(sectionMarkdown);
    const shared = { customState: { count: 1 } };
    buffer._mdcuiIdStore = new Map([["child", shared]]);

    $("#child").hide();
    expect(buffer._mdcuiIdStore.get("child").customState).toEqual({ count: 1 });
    expect(buffer._mdcuiIdStore.get("child").headingVisibility.hidden).toBe(true);
    $("#child").show();
    expect(buffer._mdcuiIdStore.get("child")).toBe(shared);
    expect(buffer._mdcuiIdStore.get("child").headingVisibility).toBeUndefined();
  });

  test("a collapsed earlier section does not break a later heading reference", () => {
    const { $, buffer } = tuiSelector(sectionMarkdown);

    $("#child").hide();
    $("#sibling").hide();
    expect(buffer.lines.some(line => line.includes("Sibling"))).toBe(true);
    expect(buffer.lines.some(line => line.includes("Sibling body."))).toBe(false);

    $("#sibling").show();
    expect(buffer.lines.some(line => line.includes("Sibling body."))).toBe(true);
    expect(buffer.lines.some(line => line.includes("Grandchild body."))).toBe(false);
  });

  test("show resolves the heading again after preceding text changes the line count", () => {
    const { $, buffer } = tuiSelector(sectionMarkdown);
    const sibling = $("#sibling");

    sibling.hide();
    spliceTuiBufferLines(buffer, 0, 0, ["Inserted one", "Inserted two"], {
      ansi: ["Inserted one", "Inserted two"],
    });
    sibling.show();

    const headingIndex = buffer.lines.findIndex(line => line.includes("Sibling"));
    expect(headingIndex).toBeGreaterThan(1);
    expect(buffer.lines.slice(headingIndex + 1).some(line => line.includes("Sibling body."))).toBe(true);
  });

  test("the heading's first character is a fixed toggle target", () => {
    const { buffer } = tuiSelector(sectionMarkdown);
    const headingRow = buffer.lines.findIndex(line => line.includes("Child"));
    const firstCharacter = buffer.lines[headingRow].search(/\S/);

    expect(toggleTuiHeadingAt(buffer, headingRow, firstCharacter + 1)).toBe(false);
    expect(toggleTuiHeadingAt(buffer, headingRow, firstCharacter)).toBe(true);
    const headingRows = buffer._mdcuiHeadingRowIndex;
    expect(headingRows.byRow.get(headingRow).id).toBe("child");
    expect(headingRows.entries.some((heading) => heading.id === "grandchild")).toBe(false);
    expect(buffer.lines.some(line => line.includes("Child body."))).toBe(false);
    expect(toggleTuiHeadingAt(buffer, headingRow, firstCharacter)).toBe(true);
    expect(buffer._mdcuiHeadingRowIndex).toBe(headingRows);
    expect(headingRows.entries.some((heading) => heading.id === "grandchild")).toBe(true);
    expect(buffer.lines.some(line => line.includes("Child body."))).toBe(true);
  });

  test("a normalized Chinese heading ID restores first-character toggling", () => {
    const source = `# 中文 設定！

Chinese body.

# 結束

End body.
`;
    const { $, buffer } = tuiSelector(source);
    const headingRow = buffer.lines.findIndex(line =>
      line.trim() === "中文 設定！"
    );
    const firstCharacter = buffer.lines[headingRow].search(/\S/);
    const heading = buffer._mdcuiHeadingRowIndex.byRow.get(headingRow);

    expect(heading).toMatchObject({
      id: "中文-設定",
      level: 1,
      ordinal: 0,
    });
    const selection = $("#中文-設定");
    const nested = $($({ id: "中文-設定", value: "decoy" }));
    expect(selection.id).toBe("中文-設定");
    expect(nested.id).toBe("中文-設定");
    expect(nested.text()).toBe("中文 設定！");
    expect(nested.data()).toBe(selection.data());

    expect(toggleTuiHeadingAt(buffer, headingRow, firstCharacter)).toBe(true);
    expect(buffer.lines.some(line => line.includes("Chinese body."))).toBe(false);
    expect(buffer.lines.some(line => line.trim() === "結束")).toBe(true);
    expect(toggleTuiHeadingAt(buffer, headingRow, firstCharacter)).toBe(true);
    expect(buffer.lines.some(line => line.includes("Chinese body."))).toBe(true);
  });

  test("blockquote and list headings keep the TUI row index valid", () => {
    const source = `# Top

> ## 引用標題
>
> Quoted body.

- ## 清單標題

  List body.

# End
`;
    const { $, buffer } = tuiSelector(source);
    const quotedRow = $("#引用標題").line() - 1;
    const listRow = $("#清單標題").line() - 1;
    const topRow = $("#top").line() - 1;

    expect(buffer._mdcuiHeadingRowIndex.valid).toBe(true);
    expect(buffer._mdcuiHeadingRowIndex.entries).toHaveLength(4);
    expect(buffer._mdcuiHeadingRowIndex.byRow.get(quotedRow)?.column)
      .toBe(buffer.lines[quotedRow].indexOf("引"));
    expect(buffer._mdcuiHeadingRowIndex.byRow.get(listRow)?.column)
      .toBe(buffer.lines[listRow].indexOf("清"));

    expect(toggleTuiHeadingAt(
      buffer,
      quotedRow,
      buffer.lines[quotedRow].search(/\S/),
    )).toBe(false);
    expect(toggleTuiHeadingAt(
      buffer,
      quotedRow,
      buffer.lines[quotedRow].indexOf("引"),
    )).toBe(true);
    expect(buffer.lines.some(line => line.includes("Quoted body."))).toBe(false);
    expect(buffer.lines.some(line => line.includes("清單標題"))).toBe(true);
    expect(toggleTuiHeadingAt(
      buffer,
      topRow,
      buffer.lines[topRow].indexOf("Top"),
    )).toBe(true);
  });

  test("nested heading sections stop at their Markdown container boundary", () => {
    const scenarios = [
      {
        source: `> ## Quoted
>
> Inside quote.

Outside quote.

### Outside lower

Outside heading body.
`,
        id: "quoted",
        inside: "Inside quote.",
        outside: "Outside quote.",
      },
      {
        source: `- Item

    ## Listed

    Inside list.

Outside list.

### Outside lower

Outside heading body.
`,
        id: "listed",
        inside: "Inside list.",
        outside: "Outside list.",
      },
    ];

    for (const scenario of scenarios) {
      const { $, buffer } = tuiSelector(scenario.source);
      const heading = $(`#${scenario.id}`);

      expect(heading.hide()).toBe(heading);
      expect(buffer.lines.some(line => line.includes(scenario.inside)))
        .toBe(false);
      expect(buffer.lines.some(line => line.includes(scenario.outside)))
        .toBe(true);
      expect(buffer.lines.some(line => line.includes("Outside lower")))
        .toBe(true);

      heading.show();
      expect(buffer.lines.some(line => line.includes(scenario.inside)))
        .toBe(true);
    }
  });

  test("blockquote visibility stops before a following top-level list", () => {
    const source = `> ## Quoted
>
> Inside quote.

- Outside list item
`;
    const { $, buffer } = tuiSelector(source);
    const original = buffer.lines.slice();
    const quoted = $("#quoted");

    quoted.hide();
    expect(buffer.lines.some(line => line.includes("Inside quote."))).toBe(false);
    expect(buffer.lines.some(line => line.includes("Outside list item"))).toBe(true);

    quoted.show();
    expect(buffer.lines).toEqual(original);
  });

  test("double-blockquote visibility crosses compact quote marker rows only", () => {
    const source = `> > ## Deep
> >
> > Deep body.
>
> Outer body.

Outside body.
`;
    const { $, buffer } = tuiSelector(source);
    const original = buffer.lines.slice();
    const deep = $("#deep");

    expect(buffer.lines.some(line => line === "││")).toBe(true);
    deep.hide();
    expect(buffer.lines.some(line => line.includes("Deep body."))).toBe(false);
    expect(buffer.lines.some(line => line.includes("Outer body."))).toBe(true);
    expect(buffer.lines.some(line => line.includes("Outside body."))).toBe(true);

    deep.show();
    expect(buffer.lines).toEqual(original);
  });

  test("a large document resolves the cursor row without rebuilding per heading", () => {
    const headingCount = 2000;
    const source = Array.from(
      { length: headingCount },
      (_, index) => `## Topic ${index}\n\nBody ${index}.`,
    ).join("\n\n");
    const { buffer } = tuiSelector(source);
    const lastRow = buffer.lines.findLastIndex((line) =>
      line.trim() === `Topic ${headingCount - 1}`
    );
    const firstCharacter = buffer.lines[lastRow].search(/\S/);
    const headingRows = buffer._mdcuiHeadingRowIndex;

    expect(toggleTuiHeadingAt(buffer, lastRow, firstCharacter)).toBe(true);
    expect(buffer._mdcuiHeadingRowIndex).toBe(headingRows);
    expect(headingRows.valid).toBe(true);
    expect(headingRows.entries).toHaveLength(headingCount);
    expect(headingRows.byRow.get(lastRow)).toMatchObject({
      id: `topic-${headingCount - 1}`,
      ordinal: headingCount - 1,
      level: 2,
    });

    expect(toggleTuiHeadingAt(buffer, lastRow, firstCharacter)).toBe(true);
    expect(buffer._mdcuiHeadingRowIndex).toBe(headingRows);
    const bodyRow = buffer.lines.findIndex((line) =>
      line.trim() === `Body ${headingCount - 1}.`
    );
    expect(toggleTuiHeadingAt(buffer, bodyRow, buffer.lines[bodyRow].search(/\S/))).toBe(false);
    expect(buffer._mdcuiHeadingRowIndex).toBe(headingRows);
  });

  test("text block row-count changes move cached heading rows in place", () => {
    const source = `# Parent

\`\`\`text#editor
one
\`\`\`

## Child

Child body.

# End
`;
    const { $, buffer } = tuiSelector(source);
    const parentRow = buffer.lines.findIndex((line) => line.trim() === "Parent");
    const parentColumn = buffer.lines[parentRow].search(/\S/);
    expect(toggleTuiHeadingAt(buffer, parentRow, parentColumn)).toBe(true);
    expect(toggleTuiHeadingAt(buffer, parentRow, parentColumn)).toBe(true);
    const headingRows = buffer._mdcuiHeadingRowIndex;
    const oldChildRow = headingRows.entries.find((heading) => heading.id === "child").row;

    $("text#editor").val("one\ntwo\nthree\nfour");

    const child = headingRows.entries.find((heading) => heading.id === "child");
    expect(buffer._mdcuiHeadingRowIndex).toBe(headingRows);
    expect(child.row).toBeGreaterThan(oldChildRow);
    expect(headingRows.byRow.has(oldChildRow)).toBe(false);
    expect(headingRows.byRow.get(child.row)?.id).toBe("child");
    expect(toggleTuiHeadingAt(
      buffer,
      child.row,
      buffer.lines[child.row].search(/\S/),
    )).toBe(true);
    expect(buffer.lines.some((line) => line.includes("Child body."))).toBe(false);
  });

  test("a direct rerender invalidates row metadata and mismatches fail closed", () => {
    const source = `# First

This paragraph is deliberately long enough to wrap at a narrow render width.

## Child

Child body.
`;
    const { buffer } = tuiSelector(source);
    const firstRow = buffer.lines.findIndex((line) => line.trim() === "First");
    const firstColumn = buffer.lines[firstRow].search(/\S/);
    expect(toggleTuiHeadingAt(buffer, firstRow, firstColumn)).toBe(true);
    expect(toggleTuiHeadingAt(buffer, firstRow, firstColumn)).toBe(true);
    const wideHeadingRows = buffer._mdcuiHeadingRowIndex;

    const narrowAnsi = String(Bun.markdown.ansi(
      source,
      { hyperlinks: true, columns: 20 },
    ));
    buffer.lines = Bun.stripANSI(narrowAnsi).split("\n");
    buffer._mdcuiAnsiText = narrowAnsi;
    const childRow = buffer.lines.findIndex((line) => line.trim() === "Child");
    expect(toggleTuiHeadingAt(
      buffer,
      childRow,
      buffer.lines[childRow].search(/\S/),
    )).toBe(true);
    expect(buffer._mdcuiHeadingRowIndex).not.toBe(wideHeadingRows);
    expect(buffer._mdcuiHeadingRowIndex.byRow.get(childRow)?.id).toBe("child");

    const mismatched = tuiSelector("# First\n\n# Second\n").buffer;
    const oneHeadingAnsi = String(Bun.markdown.ansi(
      "# First\n",
      { hyperlinks: true, columns: 80 },
    ));
    mismatched.lines = Bun.stripANSI(oneHeadingAnsi).split("\n");
    mismatched._mdcuiAnsiText = oneHeadingAnsi;
    const row = mismatched.lines.findIndex((line) => line.trim() === "First");
    const column = mismatched.lines[row].search(/\S/);
    expect(toggleTuiHeadingAt(mismatched, row, column)).toBe(false);
    const failedIndex = mismatched._mdcuiHeadingRowIndex;
    expect(failedIndex.valid).toBe(false);
    expect(toggleTuiHeadingAt(mismatched, row, column)).toBe(false);
    expect(mismatched._mdcuiHeadingRowIndex).toBe(failedIndex);
  });
});

describe("TUI id-centered user data", () => {
  test("data returns the same object stored under the selector id", () => {
    const { $, buffer } = tuiSelector("## Features\n\nBody.\n");
    const features = $("#features");
    const data = features.data();

    data.count = 1;
    expect(features.data()).toBe(data);
    expect(buffer._mdcuiIdStore.get("features").data).toBe(data);
    expect(features.data("count")).toBe(1);
  });

  test("data setters and removeData preserve other id state", () => {
    const { $, buffer } = tuiSelector("## Features\n\nBody.\n");
    const features = $("#features");

    features.data("model", { ready: true }).data({ count: 2, label: "x" });
    features.hide();
    features.removeData("count label");
    expect(features.data("model")).toEqual({ ready: true });
    features.removeData();
    expect(buffer._mdcuiIdStore.get("features").headingVisibility.hidden).toBe(true);
    expect(buffer._mdcuiIdStore.get("features").data).toBeUndefined();
  });

  test("legal object ids discard the object and retain identity through arbitrary nesting", () => {
    const { $, buffer } = tuiSelector("## Features\n\n- [x] Search\n");
    const features = $("#features");
    const objectTarget = {
      id: "features",
      innerHTML: "DECOY HTML",
      textContent: "DECOY TEXT",
      value: "DECOY VALUE",
    };
    const direct = $(objectTarget);
    expect(direct.text()).toBe("Features");
    expect(direct.val()).toEqual(["Search"]);
    objectTarget.id = "missing";
    let nested = direct;
    for (let depth = 0; depth < 8; depth++) nested = $(nested);

    expect(features.id).toBe("features");
    expect(nested.id).toBe("features");
    expect(nested.html()).toBe("Features");
    expect(nested.text()).toBe("Features");
    expect(nested.val()).toEqual(["Search"]);
    expect(nested.text("Ignored")).toBe(nested);
    expect(nested.val("Ignored")).toBe(nested);
    expect(objectTarget).toEqual({
      id: "missing",
      innerHTML: "DECOY HTML",
      textContent: "DECOY TEXT",
      value: "DECOY VALUE",
    });
    features.data("count", 1);
    expect($({ id: "features" }).data("count")).toBe(1);
    expect(nested.data()).toBe(features.data());
    expect(nested.push("Nested addition")).toBe(2);
    expect(buffer._mdcuiMutationMacros.at(-1).selector).toBe("#features");
    nested.hide();
    expect(buffer._mdcuiIdStore.get("features").headingVisibility.hidden).toBe(true);
  });

  test("Unicode and numeric heading IDs remain canonical through object wrapping", () => {
    const { $ } = tuiSelector("# 中文\n\nBody.\n\n# 2026 中文\n\nLater.\n");

    for (const id of ["中文", "2026"]) {
      const direct = $(`#${id}`);
      let nested = $({ id, value: "decoy" });
      for (let depth = 0; depth < 4; depth++) nested = $(nested);
      expect(nested.id).toBe(id);
      expect(nested.text()).toBe(direct.text());
      expect(nested.data()).toBe(direct.data());
    }
  });
});

describe("TUI source-dependent state reset", () => {
  test("checkbox count mismatches provide a visible rerender message", () => {
    expect(tuiCheckboxRerenderMismatchMessage({
      name: "tasks.md",
      _mdcuiRerenderMismatch: {
        checkboxes: { before: 3, after: 2 },
      },
    })).toBe(
      "Checkbox state restore skipped in tasks.md: count changed from 3 to 2",
    );
    expect(tuiCheckboxRerenderMismatchMessage({
      _mdcuiRerenderMismatch: {
        fenceBlocks: { before: 1, after: 2 },
      },
    })).toBe("");
  });

  test("reopen cache clearing drops old render state while preserving user data", () => {
    const oldSource = `# Topic

OLD BODY

- [ ] Original

# End
`;
    const { $, buffer } = tuiSelector(oldSource);
    const topic = $("#topic");
    const data = topic.data();
    data.count = 1;
    topic.push("Old runtime item");
    topic.hide();
    const record = buffer._mdcuiIdStore.get("topic");
    record.customState = { keep: true };
    buffer._mdcuiRerenderMismatch = { checkboxes: { before: 2, after: 1 } };
    buffer._mdcuiFenceBlockIndex = [{ stale: true }];
    buffer._mdcuiControlBlockIndex = [{ stale: true }];

    const newSource = `# Topic

NEW BODY

- [ ] Fresh

# End
`;
    const newAnsi = String(Bun.markdown.ansi(
      newSource,
      { hyperlinks: true, columns: 80 },
    ));
    buffer.lines = Bun.stripANSI(newAnsi).split("\n");
    buffer._mdcuiTuiSourceText = newSource;
    buffer._mdcuiAnsiText = newAnsi;
    clearTuiSourceDependentState(buffer);

    expect(buffer._mdcuiIdStore.get("topic")).toBe(record);
    expect(topic.data()).toBe(data);
    expect(topic.data("count")).toBe(1);
    expect(record.customState).toEqual({ keep: true });
    expect(record.headingVisibility).toBeUndefined();
    expect(buffer._mdcuiMutationMacros).toBeUndefined();
    expect(buffer._mdcuiReplayingMutations).toBe(false);
    expect(buffer._mdcuiHeadingTaskListAnchors).toBeNull();
    expect(buffer._mdcuiRerenderMismatch).toBeNull();
    expect(buffer._mdcuiFenceBlockIndex).toBeNull();
    expect(buffer._mdcuiControlBlockIndex).toBeNull();
    expect(buffer._mdcuiSourceHeadingIndex).toBeNull();
    expect(buffer._mdcuiHeadingRowIndex).toBeNull();

    topic.show();
    expect(buffer.lines.some(line => line.includes("OLD BODY"))).toBe(false);
    expect(buffer.lines.some(line => line.includes("Old runtime item"))).toBe(false);
    expect(buffer.lines.some(line => line.includes("Original"))).toBe(false);
    expect(buffer.lines.filter(line => line.includes("NEW BODY"))).toHaveLength(1);
    expect(topic.slice()).toEqual([{ value: "Fresh", checked: false }]);
  });

  test("cache clearing prunes id records that contain only visibility state", () => {
    const buffer = {
      _mdcuiIdStore: new Map([
        ["only-visibility", {
          headingVisibility: {
            hidden: true,
            ordinal: 0,
            headingCount: 0,
            segment: { lines: [], images: [] },
          },
        }],
      ]),
    };

    clearTuiSourceDependentState(buffer);

    expect(buffer._mdcuiIdStore.has("only-visibility")).toBe(false);
  });
});

describe("TUI object target wrapper", () => {
  test("text gets and sets textContent for synthetic event targets", () => {
    const { $ } = tuiSelector("Body.\n");
    const target = { textContent: "Save" };
    const wrapped = $(target);

    expect(wrapped.text()).toBe("Save");
    expect(wrapped.text("Saved")).toBe(wrapped);
    expect(target.textContent).toBe("Saved");
  });

  test("val uses value when present and otherwise falls back to textContent", () => {
    const { $ } = tuiSelector("Body.\n");
    const input = { value: "old", textContent: "label" };
    const link = { textContent: "Open" };

    expect($(input).val()).toBe("old");
    $(input).val("new");
    expect(input.value).toBe("new");
    expect(input.textContent).toBe("label");
    expect($(link).val()).toBe("Open");
    $(link).val("Close");
    expect(link.textContent).toBe("Close");
  });

  test("html reads generic innerHTML and val stringifies object values", () => {
    const { $ } = tuiSelector("Body.\n");

    expect($({ innerHTML: "<b>Body</b>" }).html()).toBe("<b>Body</b>");
    expect($({ value: 123 }).val()).toBe("123");
  });

  test("invalid object ids stay generic while missing legal ids do not", () => {
    const { $ } = tuiSelector("## Features\n\nBody.\n");
    const invalidTargets = [
      { id: "-invalid", value: "leading punctuation" },
      { id: "invalid id", value: "spaced" },
    ];
    const missing = { id: "missing", value: "decoy", textContent: "decoy" };

    for (const target of invalidTargets) {
      const wrapped = $(target);
      expect(wrapped.id).toBe("");
      expect(wrapped.val()).toBe(target.value);
      wrapped.val("updated");
      expect(target.value).toBe("updated");
    }
    expect($(missing).val()).toBe("");
    $(missing).val("ignored");
    expect(missing.value).toBe("decoy");
    expect(missing.textContent).toBe("decoy");
  });
});

describe("TUI heading text getter", () => {
  test("returns the rendered heading text without enabling a string-selector setter", () => {
    const { $, buffer } = tuiSelector("## Hello *world* & `<tag>`\n\nBody.\n");
    const heading = $("#hello-world-tag");

    expect(heading.text()).toBe("Hello world & <tag>");
    expect(heading.text("Replacement")).toBe(heading);
    expect(heading.text()).toBe("Hello world & <tag>");
    expect(buffer.lines.some((line) => line.includes("Replacement"))).toBe(false);
  });

  test("remains available while the heading section is hidden", () => {
    const { $ } = tuiSelector("## Hidden title\n\nBody.\n");
    const heading = $("#hidden-title");

    heading.hide();
    expect(heading.text()).toBe("Hidden title");
  });
});

describe("TUI heading image selection", () => {
  test("img(index).src reads OSC 8 image destinations before the next heading", () => {
    const { $ } = tuiSelector(`# Gallery

![First](one.png)

![Second](two.png)

## Child

![Child](child.png)
`);

    expect($("#gallery").img(0).src).toBe("one.png");
    expect($("#gallery").img(1).src).toBe("two.png");
    expect($("#gallery").img(2).src).toBe("");
    expect($("#child").img(0).src).toBe("child.png");
    expect($("#gallery").img(-1).src).toBe("");
  });
});

describe("TUI heading-associated table cells", () => {
  const tableMarkdown = `## Table With Id

| Name | Status |
| --- | --- |
| very long content here | ready |
| other | done |
`;

  test("cell text uses zero-based coordinates and joins wrapped visual lines", () => {
    const { $ } = tuiTableSelector(tableMarkdown, 24);
    const table = $("#table-with-id");

    expect(table.cell(0, 0).text()).toBe("Name");
    expect(table.cell(1, 0).text()).toBe("very longcontenthere");
    expect(table.cell(2, 1).text()).toBe("done");
    expect(table.cell(99, 0).text()).toBe("");
    expect(table.cell(-1, 0).text("ignored")).toBeDefined();
  });

  test("cell properties and physical neighbors stay inside the table", () => {
    const { $ } = tuiTableSelector(tableMarkdown, 24);
    const table = $("#table-with-id");
    const cell = table.cell(1, 0);

    expect(cell.row).toBe(1);
    expect(cell.col).toBe(0);
    expect(cell.right().text()).toBe("ready");
    expect(cell.rt().text()).toBe("ready");
    expect(cell.up().text()).toBe("Name");
    expect(cell.down().text()).toBe("other");
    expect(cell.dn().text()).toBe("other");
    expect(cell.right().lt().text()).toBe("very longcontenthere");
    expect(cell.right().down().text()).toBe("done");
    expect(table.cell(0, 0).left()).toBeNull();
    expect(table.cell(0, 0).lt()).toBeNull();
    expect(table.cell(0, 0).up()).toBeNull();
    expect(table.cell(2, 1).right()).toBeNull();
    expect(table.cell(2, 1).rt()).toBeNull();
    expect(table.cell(2, 1).down()).toBeNull();
    expect(table.cell(2, 1).dn()).toBeNull();
    expect(table.cell(99, 0).left()).toBeNull();
  });

  test("cell val returns the first checkbox state or falls back to text", () => {
    const markdown = `## Checks

| Name | State |
| --- | --- |
| plain | [x] checked |
| empty | [ ] pending |
`;
    const { $, buffer } = tuiTableSelector(markdown, 30);
    const table = $("#checks");

    expect(table.cell(0, 0).val()).toBe("Name");
    expect(table.cell(1, 0).val()).toBe("plain");
    expect(table.cell(1, 1).val()).toBe(true);
    expect(table.cell(2, 1).val()).toBe(false);
    const uncheckedCell = table.cell(2, 1);
    expect(uncheckedCell.val(true)).toBe(uncheckedCell);
    expect(uncheckedCell.val()).toBe(true);
    expect(table.cell(1, 1).val(false).val()).toBe(false);
    expect(table.cell(1, 0).val(true).text()).toBe("plain");
    expect(buffer._mdcuiAnsiText).toContain("\x1b[32m☒");
    expect(table.cell(99, 0).val()).toBe("");
  });

  test("cell text replacement stays inside its rectangle and updates ANSI", () => {
    const { $, buffer } = tuiTableSelector(tableMarkdown, 24);
    const cell = $("#table-with-id").cell(2, 1);
    const widths = buffer.lines.map(line => Bun.stringWidth(line));
    const result = cell.text("更新✅abcdef");

    expect(result).toBe(cell);
    expect(cell.text()).toBe("更新✅");
    expect(buffer.lines.map(line => Bun.stringWidth(line))).toEqual(widths);
    expect(Bun.stripANSI(buffer._mdcuiAnsiText)).toBe(buffer.lines.join("\n"));
    expect(buffer.undoCount).toBe(1);
    expect(buffer._mdcuiMutationMacros).toBeUndefined();
  });

  test("cell text replacement preserves every ANSI and OSC 8 control", () => {
    const linkedMarkdown = `## Linked Table

| Name | Action |
| --- | --- |
| item | [open](javascript:run()) |
`;
    const { $, buffer } = tuiTableSelector(linkedMarkdown, 40);
    const controls = value => String(value).match(
      /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\x07|\x1b\\))/gu,
    ) ?? [];
    const before = controls(buffer._mdcuiAnsiText);

    $("#linked-table").cell(1, 1).text("執行");

    expect($("#linked-table").cell(1, 1).text()).toBe("執行");
    expect(controls(buffer._mdcuiAnsiText)).toEqual(before);
    expect(buffer._mdcuiAnsiText).toContain("javascript:run()");
  });

  test("a table link parent exposes the complete cell selection", () => {
    const linkedMarkdown = `## Linked Table

| Name | Action |
| --- | --- |
| item | [open](javascript:run()) |
| next | later |
`;
    const { $, buffer } = tuiTableSelector(linkedMarkdown, 40);
    const y = buffer.lines.findIndex(line => line.includes("open"));
    const x = buffer.lines[y].indexOf("open");
    const parentCell = tuiTableCellAtPosition(buffer, y, x);
    const linkTarget = { parent: () => parentCell };
    const parent = $(linkTarget).parent();

    expect(parent.row).toBe(1);
    expect(parent.col).toBe(1);
    expect(parent.text()).toBe("open");
    expect(parent.lt().text()).toBe("item");
    expect(parent.dn().text()).toBe("later");
    expect(parent.text("執行")).toBe(parent);
    expect(parent.text()).toBe("執行");
  });

  test("cell snapshots restore API replacements after a width rerender", () => {
    const { $, buffer } = tuiTableSelector(tableMarkdown, 24);
    $("#table-with-id").cell(1, 0).text("replacement value");
    const snapshot = captureTuiRerenderState(buffer);

    const rerendered = tuiTableSelector(tableMarkdown, 32).buffer;
    buffer.lines = rerendered.lines;
    buffer._mdcuiAnsiText = rerendered._mdcuiAnsiText;
    buffer._ansiStyleLines = rerendered._ansiStyleLines;
    buffer._mdcuiHeadingRowIndex = null;
    restoreTuiRerenderState(buffer, snapshot);

    expect($("#table-with-id").cell(1, 0).text()).toBe("replacement value");
    expect(buffer.undoCount).toBe(1);
  });

  test("cell snapshots restore direct edits with ANSI after a width rerender", () => {
    const { $, buffer } = tuiTableSelector(tableMarkdown, 24);
    const y = buffer.lines.findIndex(line => line.includes("very long"));
    const x = buffer.lines[y].indexOf("very");
    markTuiTableCellDirtyAtPosition(buffer, y, x);
    buffer.lines[y] =
      buffer.lines[y].slice(0, x) + "USER" + buffer.lines[y].slice(x + 4);
    const ansiLines = buffer._mdcuiAnsiText.split("\n");
    ansiLines[y] = colorAnsiPlainRange(
      ansiLines[y],
      x,
      x + 4,
      "USER",
      "\x1b[35m",
    );
    buffer._mdcuiAnsiText = ansiLines.join("\n");
    for (let index = x; index < x + 4; index++)
      buffer._ansiStyleLines[y][index] = { fg: "magenta" };
    const snapshot = captureTuiRerenderState(buffer);

    const rerendered = tuiTableSelector(tableMarkdown, 32).buffer;
    buffer.lines = rerendered.lines;
    buffer._mdcuiAnsiText = rerendered._mdcuiAnsiText;
    buffer._ansiStyleLines = rerendered._ansiStyleLines;
    buffer._mdcuiHeadingRowIndex = null;
    restoreTuiRerenderState(buffer, snapshot);

    expect($("#table-with-id").cell(1, 0).text())
      .toBe("USER longcontenthere");
    expect(buffer._mdcuiAnsiText).toContain("\x1b[35mUSER");
    const restoredY = buffer.lines.findIndex(line => line.includes("USER"));
    const restoredX = buffer.lines[restoredY].indexOf("USER");
    expect(buffer._ansiStyleLines[restoredY][restoredX]?.fg).toBe("magenta");
    expect(buffer.undoCount).toBeUndefined();
  });
});

describe("TUI resize state restoration", () => {
  test("restores every checkbox glyph by full-text order without block filtering", () => {
    const buffer = {
      name: "glyphs.md",
      lines: [
        "Legend: ☒ done and ☐ pending",
        "│ ☒ table value │",
        "```text#sample",
        "☐ fenced value",
        "```",
      ],
      _mdcuiTuiSourceText: "",
      _mdcuiAnsiText: "",
      cursor: { x: 0, y: 0 },
      ensureCursor() {},
      invalidateHighlightFrom() {},
    };
    const snapshot = captureTuiRerenderState(buffer);
    buffer.lines = [
      "Legend: ☐ done and ☒ pending",
      "│ ☐ table value │",
      "```text#sample",
      "☒ fenced value",
      "```",
    ];
    restoreTuiRerenderState(buffer, snapshot);

    expect(buffer.lines).toEqual([
      "Legend: ☒ done and ☐ pending",
      "│ ☒ table value │",
      "```text#sample",
      "☐ fenced value",
      "```",
    ]);
    expect(buffer._mdcuiRerenderMismatch).toBeNull();
  });

  test("restores exact ANSI styles for checkbox glyphs by visible column", () => {
    const originalAnsi = [
      "中文 \x1b[1;38;2;12;34;56;48;5;20m☒\x1b[0m suffix",
      "\x1b[35m😀 ☐ tail\x1b[0m",
    ].join("\n");
    const buffer = {
      name: "styled.md",
      lines: Bun.stripANSI(originalAnsi).split("\n"),
      _mdcuiTuiSourceText: "",
      _mdcuiAnsiText: originalAnsi,
      _ansiStyleLines: [
        Array.from({ length: 20 }, () => null),
        Array.from({ length: 20 }, () => null),
      ],
      cursor: { x: 0, y: 0 },
      ensureCursor() {},
      invalidateHighlightFrom() {},
    };
    const firstX = buffer.lines[0].indexOf("☒");
    const secondX = buffer.lines[1].indexOf("☐");
    buffer._ansiStyleLines[0][firstX] = {
      bold: true,
      fg: "#0c2238",
      bg: 20,
    };
    buffer._ansiStyleLines[1][secondX] = { fg: "magenta" };
    const snapshot = captureTuiRerenderState(buffer);

    const rerenderedAnsi = [
      "中文 \x1b[31m☐\x1b[0m suffix",
      "\x1b[36m😀 ☒ tail\x1b[0m",
    ].join("\n");
    buffer.lines = Bun.stripANSI(rerenderedAnsi).split("\n");
    buffer._mdcuiAnsiText = rerenderedAnsi;
    buffer._ansiStyleLines[0][firstX] = { fg: "red" };
    buffer._ansiStyleLines[1][secondX] = { fg: "cyan" };
    restoreTuiRerenderState(buffer, snapshot);

    expect(buffer.lines).toEqual(Bun.stripANSI(originalAnsi).split("\n"));
    expect(buffer._ansiStyleLines[0][firstX]).toEqual({
      bold: true,
      fg: "#0c2238",
      bg: 20,
    });
    expect(buffer._ansiStyleLines[1][secondX]).toEqual({ fg: "magenta" });
    expect(
      Bun.sliceAnsi(buffer._mdcuiAnsiText.split("\n")[0], 5, 6),
    ).toBe(
      Bun.sliceAnsi(originalAnsi.split("\n")[0], 5, 6),
    );
    expect(
      Bun.sliceAnsi(buffer._mdcuiAnsiText.split("\n")[1], 3, 4),
    ).toBe(
      Bun.sliceAnsi(originalAnsi.split("\n")[1], 3, 4),
    );
  });

  test("preserves direct checkbox state inside a blockquote", () => {
    const source = `> ## Quoted
>
> - [ ] Inside quote

- [ ] Outside quote
`;
    const { $, buffer } = tuiSelector(source);
    const inside = buffer.lines.findIndex(line => line.includes("Inside quote"));
    buffer.lines[inside] = buffer.lines[inside].replace("☐", "☒");

    const snapshot = captureTuiRerenderState(buffer);
    const narrowAnsi = String(Bun.markdown.ansi(
      source,
      { hyperlinks: true, columns: 24 },
    ));
    buffer.lines = Bun.stripANSI(narrowAnsi).split("\n");
    buffer._mdcuiAnsiText = narrowAnsi;
    buffer._ansiStyleLines = null;
    buffer._mdcuiHeadingTaskListAnchors = null;
    restoreTuiRerenderState(buffer, snapshot);

    expect($("#quoted").val()).toEqual(["Inside quote"]);
    expect(buffer.lines.some(line =>
      line.includes("Outside quote") && line.includes("☐")
    )).toBe(true);
    expect(buffer._mdcuiRerenderMismatch).toBeNull();
  });

  test("replays a mutation recorded through arbitrarily nested id selections", () => {
    const source = "## Features\n\n- [ ] Original\n";
    const { $, buffer } = tuiSelector(source);
    const objectTarget = { id: "features", value: "DECOY" };
    let nested = $(objectTarget);
    for (let depth = 0; depth < 8; depth++) nested = $(nested);

    expect(nested.push({ value: "Added through nesting", checked: true })).toBe(2);
    expect(buffer._mdcuiMutationMacros).toHaveLength(1);
    expect(buffer._mdcuiMutationMacros[0].selector).toBe("#features");

    const snapshot = captureTuiRerenderState(buffer);
    const narrowAnsi = String(Bun.markdown.ansi(
      source,
      { hyperlinks: true, columns: 24 },
    ));
    buffer.lines = Bun.stripANSI(narrowAnsi).split("\n");
    buffer._mdcuiAnsiText = narrowAnsi;
    buffer._ansiStyleLines = null;
    buffer._mdcuiHeadingTaskListAnchors = null;
    restoreTuiRerenderState(buffer, snapshot);

    const items = nested.slice();
    expect(items).toEqual([
      { value: "Original", checked: false },
      { value: "Added through nesting", checked: true },
    ]);
    expect(items.filter(item => item.value === "Added through nesting"))
      .toHaveLength(1);
    expect(buffer._mdcuiRerenderMismatch).toBeNull();
    expect(objectTarget.value).toBe("DECOY");
  });

  test("replays Infinity, NaN, BigInt, and cyclic list mutation arguments", () => {
    const source = `## Features

- [ ] Original A
- [x] Original B
`;
    const { $, buffer } = tuiSelector(source);
    const features = $("#features");
    const cyclic = { value: "Cyclic item", checked: false };
    const bigintItem = { value: 9007199254740993n, checked: true };
    cyclic.self = cyclic;

    expect(features.splice(0, Infinity)).toEqual(["Original A", "Original B"]);
    expect(features.push(bigintItem)).toBe(1);
    expect(features.splice(NaN, 0, cyclic)).toEqual([]);
    expect(features.slice()).toEqual([
      { value: "Cyclic item", checked: false },
      { value: "9007199254740993", checked: true },
    ]);
    cyclic.value = "Mutated cyclic item";
    cyclic.checked = true;
    bigintItem.value = 0n;
    bigintItem.checked = false;

    const snapshot = captureTuiRerenderState(buffer);
    const narrowAnsi = String(Bun.markdown.ansi(
      source,
      { hyperlinks: true, columns: 24 },
    ));
    buffer.lines = Bun.stripANSI(narrowAnsi).split("\n");
    buffer._mdcuiAnsiText = narrowAnsi;
    buffer._ansiStyleLines = null;
    buffer._mdcuiHeadingTaskListAnchors = null;
    restoreTuiRerenderState(buffer, snapshot);

    expect(features.slice()).toEqual([
      { value: "Cyclic item", checked: false },
      { value: "9007199254740993", checked: true },
    ]);
    expect(buffer._mdcuiRerenderMismatch).toBeNull();
  });

  test("preserves a deep visibility change made through hidden ancestors", () => {
    const source = `# First

First body.

## Child

Child body.

### Grandchild

Grandchild body.

# End
`;
    const { $, buffer } = tuiSelector(source);
    $("#grandchild").hide();
    $("#child").hide();
    $("#first").hide();
    $("#grandchild").show();

    const snapshot = captureTuiRerenderState(buffer);
    const narrowAnsi = String(Bun.markdown.ansi(
      source,
      { hyperlinks: true, columns: 24 },
    ));
    buffer.lines = Bun.stripANSI(narrowAnsi).split("\n");
    buffer._mdcuiAnsiText = narrowAnsi;
    buffer._ansiStyleLines = null;
    buffer._mdcuiHeadingTaskListAnchors = null;
    restoreTuiRerenderState(buffer, snapshot);

    expect(buffer._mdcuiIdStore.get("first").headingVisibility.hidden).toBe(true);
    expect(buffer._mdcuiIdStore.get("child").headingVisibility.hidden).toBe(true);
    expect(buffer._mdcuiIdStore.get("grandchild")?.headingVisibility).toBeUndefined();
    $("#first").show();
    $("#child").show();
    expect(buffer.lines.some(line => line.includes("Grandchild body."))).toBe(true);
    expect(buffer._mdcuiRerenderMismatch).toBeNull();
  });

  test("replays list macros, restores checkbox order, and re-hides deepest headings first", () => {
    const source = `# Parent

- [ ] A checkbox label long enough to wrap after resizing

## Child

- [ ] Child checkbox

### Deep

- [ ] Deep checkbox

# End
`;
    const { $, buffer } = tuiSelector(source);
    $("#parent").push({ value: "Added by macro", checked: false });
    for (const needle of ["Child checkbox", "Deep checkbox"]) {
      const y = buffer.lines.findIndex((line) => line.includes(needle));
      buffer.lines[y] = buffer.lines[y].replace("☐", "☒");
    }
    $("#deep").hide();
    $("#parent").hide();

    const snapshot = captureTuiRerenderState(buffer);
    const narrowAnsi = String(Bun.markdown.ansi(source, { hyperlinks: true, columns: 24 }));
    buffer.lines = Bun.stripANSI(narrowAnsi).split("\n");
    buffer._mdcuiAnsiText = narrowAnsi;
    buffer._ansiStyleLines = null;
    buffer._mdcuiHeadingTaskListAnchors = null;
    restoreTuiRerenderState(buffer, snapshot);

    expect(buffer._mdcuiIdStore.get("parent").headingVisibility.hidden).toBe(true);
    expect(buffer._mdcuiIdStore.get("deep").headingVisibility.hidden).toBe(true);
    $("#parent").show();
    expect(buffer.lines.some((line) => line.includes("Added by macro"))).toBe(true);
    expect(buffer.lines.some((line) => line.includes("Child checkbox") && line.includes("☒"))).toBe(true);
    $("#deep").show();
    expect(buffer.lines.some((line) => line.includes("Deep checkbox") && line.includes("☒"))).toBe(true);
    expect(buffer._mdcuiRerenderMismatch).toBeNull();
  });

  test("restores direct fence body edits by block order and identity", () => {
    const source = "```text#editor\noriginal\n```\n";
    const buffer = {
      lines: source.split("\n"),
      _mdcuiTuiSourceText: source,
      _mdcuiAnsiText: source,
      cursor: { x: 0, y: 0 },
      ensureCursor() {},
      invalidateHighlightFrom() {},
    };
    buffer.lines[1] = "user input";
    buffer._mdcuiAnsiText = buffer.lines.join("\n");
    const snapshot = captureTuiRerenderState(buffer);

    buffer.lines = source.split("\n");
    buffer._mdcuiAnsiText = source;
    restoreTuiRerenderState(buffer, snapshot);

    expect(buffer.lines[1]).toBe("user input");
    expect(buffer._mdcuiRerenderMismatch).toBeNull();
  });
});

class TestText {
  constructor(text, ownerDocument) {
    this.textContent = String(text);
    this.ownerDocument = ownerDocument;
    this.parentElement = null;
  }
}

class TestElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentElement = null;
    this.childNodes = [];
    this.classList = new Set();
    this.id = "";
  }

  get children() {
    return this.childNodes.filter((node) => node instanceof TestElement);
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get nextElementSibling() {
    const siblings = this.parentElement?.children ?? [];
    const index = siblings.indexOf(this);
    return index >= 0 ? siblings[index + 1] ?? null : null;
  }

  get textContent() {
    return this.childNodes.map((node) => node.textContent).join("");
  }

  set textContent(value) {
    this.childNodes = [];
    this.append(this.ownerDocument.createTextNode(value));
  }

  append(...nodes) {
    for (const node of nodes) {
      node.parentElement = this;
      this.childNodes.push(node);
    }
  }

  insertBefore(node, before) {
    node.parentElement = this;
    const index = before == null ? -1 : this.childNodes.indexOf(before);
    if (index < 0) this.childNodes.push(node);
    else this.childNodes.splice(index, 0, node);
  }

  remove() {
    const siblings = this.parentElement?.childNodes;
    const index = siblings?.indexOf(this) ?? -1;
    if (index >= 0) siblings.splice(index, 1);
    this.parentElement = null;
  }

  matches(selector) {
    if (selector === "ul, ol") return this.tagName === "UL" || this.tagName === "OL";
    if (selector === "li.task-list-item")
      return this.tagName === "LI" && this.classList.has("task-list-item");
    return false;
  }

  closest(selector) {
    for (let node = this; node; node = node.parentElement) {
      if (selector === "label" && node.tagName === "LABEL") return node;
      if (selector === "li.task-list-item" && node.matches(selector)) return node;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (selector === 'input[type="checkbox"]' &&
            child.tagName === "INPUT" && child.type === "checkbox") matches.push(child);
        else if (selector === "img" && child.tagName === "IMG") matches.push(child);
        else if (selector === "ul, ol" && child.matches(selector)) matches.push(child);
        else if (selector === "li.task-list-item" && child.matches(selector)) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
}

describe("WUI heading image selection", () => {
  test("img(index).src reads actual image elements before the next heading section", () => {
    const documentObject = new TestDocument();
    const section = documentObject.createElement("section");
    const heading = documentObject.createElement("h1");
    heading.id = "gallery";
    const body = documentObject.createElement("p");
    const first = documentObject.createElement("img");
    const second = documentObject.createElement("img");
    first.src = "https://example.test/one.png";
    second.src = "https://example.test/two.png";
    body.append(first, second);
    const childSection = documentObject.createElement("section");
    const childHeading = documentObject.createElement("h2");
    childHeading.id = "child";
    const childImage = documentObject.createElement("img");
    childImage.src = "https://example.test/child.png";
    childSection.append(childHeading, childImage);
    section.append(heading, body, childSection);
    documentObject.root.append(section);
    const $ = createWebDollar(documentObject);

    expect($("#gallery").img(0).src).toBe("https://example.test/one.png");
    expect($("#gallery").img(1).src).toBe("https://example.test/two.png");
    expect($("#gallery").img(2).src).toBe("");
    expect($("#child").img(0).src).toBe("https://example.test/child.png");
  });
});

describe("heading scrollIntoView", () => {
  test("TUI maps browser booleans and numeric alignment shortcuts", () => {
    const ansi = String(Bun.markdown.ansi("# First\n\nBody\n\n## Target\n", {
      hyperlinks: true,
      columns: 80,
    }));
    const buffer = {
      lines: Bun.stripANSI(ansi).split("\n"),
      _mdcuiTuiSourceText: "# First\n\nBody\n\n## Target\n",
      _mdcuiAnsiText: ansi,
      cursor: { x: 0, y: 0 },
      ensureCursor() {},
    };
    indexTuiHeadingRows(buffer);
    const blocks = [];
    const $ = createTuiSelector(
      () => buffer,
      null,
      ({ block }) => blocks.push(block),
    );
    const target = $("#target");

    target.scrollIntoView();
    target.scrollIntoView(true);
    target.scrollIntoView(false);
    target.scrollIntoView(-1);
    target.scrollIntoView(0);
    target.scrollIntoView(1);
    target.scrollIntoView("anything", "ignored");

    expect(blocks).toEqual([
      "start", "start", "end", "start", "center", "end", "center",
    ]);
    expect(buffer.lines[buffer.cursor.y]).toContain("Target");
  });

  test("WUI forwards browser forms and translates numeric shortcuts", () => {
    const { $, heading } = webSelector();
    const calls = [];
    heading.scrollIntoView = (...args) => calls.push(args);
    const features = $("#features");

    features.scrollIntoView();
    features.scrollIntoView(true);
    features.scrollIntoView(false);
    features.scrollIntoView(-1);
    features.scrollIntoView(0);
    features.scrollIntoView(1);
    features.scrollIntoView({ block: "start" });

    expect(calls).toEqual([
      [],
      [true],
      [false],
      [true],
      [{ block: "center", inline: "nearest" }],
      [false],
      [{ block: "center", inline: "nearest" }],
    ]);
  });
});

class TestDocument {
  constructor() {
    this.root = new TestElement("main", this);
  }

  createElement(tagName) {
    return new TestElement(tagName, this);
  }

  createTextNode(text) {
    return new TestText(text, this);
  }

  getElementById(id) {
    return this.querySelectorAll("heading").find((element) => element.id === id) ?? null;
  }

  querySelector(selector) {
    if (!selector.startsWith("#")) return null;
    const id = selector.slice(1);
    return this.querySelectorAll("heading").find((element) => element.id === id) ?? null;
  }

  querySelectorAll(selector) {
    if (selector === "[data-mdcui-tag]" || selector === "pre > code") return [];
    if (selector === "heading") {
      const headings = [];
      const visit = (node) => {
        for (const child of node.children) {
          if (/^H[1-6]$/.test(child.tagName)) headings.push(child);
          visit(child);
        }
      };
      visit(this.root);
      return headings;
    }
    return [];
  }
}

function appendWebItem(documentObject, list, value, checked = false) {
  const item = documentObject.createElement("li");
  item.classList.add("task-list-item");
  const label = documentObject.createElement("label");
  const checkbox = documentObject.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = checked;
  label.append(checkbox, documentObject.createTextNode(value));
  item.append(label);
  list.append(item);
  return item;
}

function webSelector() {
  const documentObject = new TestDocument();
  const section = documentObject.createElement("section");
  const heading = documentObject.createElement("h2");
  heading.id = "features";
  heading.append(documentObject.createTextNode("Features"));
  const list = documentObject.createElement("ul");
  appendWebItem(documentObject, list, "Search", true);
  appendWebItem(documentObject, list, "Notifications");
  appendWebItem(documentObject, list, "Offline", true);
  section.append(heading, list);
  documentObject.root.append(section);
  return { $: createWebDollar(documentObject), documentObject, section, heading, list };
}

function nestedWebSelector() {
  const documentObject = new TestDocument();
  const outerSection = documentObject.createElement("section");
  const outerHeading = documentObject.createElement("h1");
  outerHeading.id = "first";
  outerHeading.append(documentObject.createTextNode("First"));
  const outerBody = documentObject.createElement("p");
  outerBody.append(documentObject.createTextNode("First web body."));
  const childSection = documentObject.createElement("section");
  const childHeading = documentObject.createElement("h2");
  childHeading.id = "child";
  childHeading.append(documentObject.createTextNode("Child"));
  const childBody = documentObject.createElement("p");
  childBody.append(documentObject.createTextNode("Child web body."));
  childSection.append(childHeading, childBody);
  outerSection.append(outerHeading, outerBody, childSection);
  documentObject.root.append(outerSection);
  return {
    $: createWebDollar(documentObject),
    documentObject,
    outerSection,
    outerHeading,
    childSection,
    childHeading,
    childBody,
  };
}

function webTableSelector() {
  const documentObject = new TestDocument();
  const section = documentObject.createElement("section");
  const heading = documentObject.createElement("h2");
  heading.id = "table-with-id";
  heading.append(documentObject.createTextNode("Table With Id"));
  const table = documentObject.createElement("table");
  const header = documentObject.createElement("tr");
  const name = documentObject.createElement("th");
  const action = documentObject.createElement("th");
  name.append(documentObject.createTextNode("Name"));
  action.append(documentObject.createTextNode("Action"));
  header.append(name, action);
  const body = documentObject.createElement("tr");
  const item = documentObject.createElement("td");
  const linked = documentObject.createElement("td");
  const anchor = documentObject.createElement("a");
  item.append(documentObject.createTextNode("item"));
  anchor.append(documentObject.createTextNode("open"));
  linked.append(anchor);
  body.append(item, linked);
  table.append(header, body);
  section.append(heading, table);
  documentObject.root.append(section);
  return {
    $: createWebDollar(documentObject),
    documentObject,
    heading,
    table,
    anchor,
  };
}

describe("WUI heading-associated table cells", () => {
  test("cell navigation matches TUI coordinates and bounds", () => {
    const { $ } = webTableSelector();
    const cell = $("#table-with-id").cell(1, 0);

    expect(cell.row).toBe(1);
    expect(cell.col).toBe(0);
    expect(cell.text()).toBe("item");
    expect(cell.rt().text()).toBe("open");
    expect(cell.up().text()).toBe("Name");
    expect(cell.left()).toBeNull();
    expect(cell.down()).toBeNull();
  });

  test("link parent returns its cell and text replacement retains the anchor", () => {
    const { $, anchor } = webTableSelector();
    const parent = $(anchor).parent();

    expect(parent.row).toBe(1);
    expect(parent.col).toBe(1);
    expect(parent.lt().text()).toBe("item");
    expect(parent.text("執行")).toBe(parent);
    expect(parent.text()).toBe("執行");
    expect(anchor.parentElement.textContent).toBe("執行");
    expect(anchor.parentElement.children[0]).toBe(anchor);
  });

  test("cell val returns the first checkbox state or falls back to text", () => {
    const { $, documentObject, table } = webTableSelector();
    const checkbox = documentObject.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = true;
    table.children[1].children[1].insertBefore(
      checkbox,
      table.children[1].children[1].children[0],
    );

    expect($("#table-with-id").cell(1, 0).val()).toBe("item");
    expect($("#table-with-id").cell(1, 1).val()).toBe(true);
    checkbox.checked = false;
    expect($("#table-with-id").cell(1, 1).val()).toBe(false);
    const checkedCell = $("#table-with-id").cell(1, 1);
    expect(checkedCell.val(true)).toBe(checkedCell);
    expect(checkedCell.val()).toBe(true);
    expect($("#table-with-id").cell(1, 0).val(false).text()).toBe("item");
    expect($("#table-with-id").cell(99, 0).val()).toBe("");
  });
});

describe("WUI heading task-list Array methods", () => {
  test("uses the first list and follows Array return values", () => {
    const { $ } = webSelector();
    const features = $("#features");

    expect(features.push("Export", { value: "Sync", checked: true })).toBe(5);
    expect(features.val()).toEqual(["Search", "Offline", "Sync"]);
    expect(features.unshift("First", "Second")).toBe(7);
    expect(features.shift()).toBe("First");
    expect(features.pop()).toBe("Sync");
    expect(features.val()).toEqual(["Search", "Offline"]);
  });

  test("an empty first list remains the target", () => {
    const { $, list } = webSelector();
    const features = $("#features");

    expect(features.shift()).toBe("Search");
    expect(features.shift()).toBe("Notifications");
    expect(features.shift()).toBe("Offline");
    expect(features.shift()).toBeUndefined();
    expect(features.val()).toEqual([]);
    expect(features.push({ label: "Again", checked: true })).toBe(1);
    expect(list.children).toHaveLength(1);
    expect(features.val()).toEqual(["Again"]);
  });

  test("splice follows Array indexing and returns removed labels", () => {
    const { $ } = webSelector();
    const features = $("#features");

    expect(features.splice()).toEqual([]);
    expect(features.splice(1, 1, { value: "Replacement", checked: true }, "Extra"))
      .toEqual(["Notifications"]);
    expect(features.val()).toEqual(["Search", "Replacement", "Offline"]);
    expect(features.splice(-1)).toEqual(["Offline"]);
    expect(features.splice(0, Infinity)).toEqual(["Search", "Replacement", "Extra"]);
    expect(features.splice(0, 0, { value: "Again", checked: true })).toEqual([]);
    expect(features.val()).toEqual(["Again"]);
  });

  test("slice returns read-only item snapshots with checked state", () => {
    const { $ } = webSelector();
    const features = $("#features");

    const result = features.slice(0, 2);
    expect(result).toEqual([
      { value: "Search", checked: true },
      { value: "Notifications", checked: false },
    ]);
    result[0].value = "Changed snapshot";
    result[0].checked = false;
    expect(features.slice(-1)).toEqual([{ value: "Offline", checked: true }]);
    expect(features.val()).toEqual(["Search", "Offline"]);
  });
});

describe("WUI heading section visibility", () => {
  test("hide promotes the heading and hides its section", () => {
    const { $, documentObject, section, heading } = webSelector();
    const features = $("#features");

    expect(features.hide()).toBe(features);
    expect(documentObject.root.children).toEqual([heading, section]);
    expect(heading.parentElement).toBe(documentObject.root);
    expect(section.hidden).toBe(true);
    expect(documentObject._mdcuiIdStore.get("features").headingVisibility.section).toBe(section);
  });

  test("show restores the heading as the section's first item", () => {
    const { $, documentObject, section, heading, list } = webSelector();
    const features = $("#features");

    features.hide().show();
    expect(documentObject.root.children).toEqual([section]);
    expect(section.children).toEqual([heading, list]);
    expect(section.firstChild).toBe(heading);
    expect(section.hidden).toBe(false);
    expect(documentObject._mdcuiIdStore.has("features")).toBe(false);
  });

  test("toggle switches between the promoted and restored states", () => {
    const { $, section, heading } = webSelector();
    const features = $("#features");

    features.toggle();
    expect(section.hidden).toBe(true);
    expect(heading.parentElement).not.toBe(section);
    features.toggle();
    expect(section.hidden).toBe(false);
    expect(heading.parentElement).toBe(section);
  });

  test("show, hide, and toggle update a child while its parent is hidden", () => {
    const scenarios = [
      { initiallyHidden: false, method: "hide", visible: false },
      { initiallyHidden: true, method: "show", visible: true },
      { initiallyHidden: false, method: "toggle", visible: false },
      { initiallyHidden: true, method: "toggle", visible: true },
    ];

    for (const scenario of scenarios) {
      const {
        $, documentObject, outerSection, childSection, childHeading,
      } = nestedWebSelector();
      const first = $("#first");
      const child = $("#child");
      if (scenario.initiallyHidden) child.hide();
      first.hide();

      child[scenario.method]();

      expect(outerSection.hidden).toBe(true);
      expect(documentObject._mdcuiIdStore.get("first").headingVisibility.hidden)
        .toBe(true);
      first.show();
      expect(Boolean(childSection.hidden)).toBe(!scenario.visible);
      expect(Boolean(
        documentObject._mdcuiIdStore.get("child")?.headingVisibility?.hidden,
      )).toBe(!scenario.visible);
      expect(childHeading.parentElement === childSection).toBe(scenario.visible);
    }
  });
});

describe("WUI id-centered user data", () => {
  test("document store and DOM expose the exact same data object", () => {
    const { $, documentObject, heading } = webSelector();
    const features = $("#features");
    const data = features.data();

    data.count = 1;
    expect(features.data()).toBe(data);
    expect(documentObject._mdcuiIdStore.get("features").data).toBe(data);
    expect(heading.mdcuiData).toBe(data);
    expect(features.data("count")).toBe(1);
  });

  test("document data survives DOM removal and reattaches to a replacement", () => {
    const { $, documentObject, heading } = webSelector();
    const features = $("#features");
    const model = { ready: true };
    features.data("model", model);

    heading.remove();
    expect(features.data("model")).toBe(model);

    const replacement = documentObject.createElement("h2");
    replacement.id = "features";
    documentObject.root.append(replacement);
    expect(features.data()).toBe(documentObject._mdcuiIdStore.get("features").data);
    expect(replacement.mdcuiData).toBe(features.data());
  });

  test("removeData supports keys and keeps framework visibility state", () => {
    const { $, documentObject, heading } = webSelector();
    const features = $("#features");

    features.data({ count: 1, label: "x" }).hide();
    features.removeData(["count", "label"]);
    expect(features.data()).toEqual({});
    features.data("temporary", true).removeData();
    expect(heading.mdcuiData).toBeUndefined();
    expect(documentObject._mdcuiIdStore.get("features").headingVisibility.hidden).toBe(true);
  });

  test("selection ids allow a selection to be wrapped again", () => {
    const { $, documentObject, heading } = webSelector();
    const features = $("#features");
    const nested = $($($(features)));

    expect(features.id).toBe("features");
    expect(nested.id).toBe("features");
    features.data("count", 1);
    expect(nested.data()).toBe(features.data());
    expect(nested.text()).toBe(heading.textContent);
    nested.hide();
    expect(documentObject._mdcuiIdStore.get("features").headingVisibility.hidden).toBe(true);
  });

  test("plain id objects resolve headings and nested data survives DOM removal", () => {
    const { $, documentObject, heading } = webSelector();
    const byId = $({ id: "features" });
    const nested = $($($("#features")));

    expect(byId.text()).toBe(heading.textContent);
    byId.data("count", 2);
    expect($("#features").data("count")).toBe(2);
    byId.hide();
    expect(documentObject._mdcuiIdStore.get("features").headingVisibility.hidden).toBe(true);
    byId.show();
    expect(documentObject._mdcuiIdStore.get("features").headingVisibility).toBeUndefined();

    heading.remove();
    expect(nested.data("count")).toBe(2);
    nested.data("afterRemoval", true);
    expect(documentObject._mdcuiIdStore.get("features").data.afterRemoval).toBe(true);
  });

  test("legal object ids discard decoy fields through arbitrary nesting", () => {
    const { $, heading } = webSelector();
    const objectTarget = {
      id: "features",
      innerHTML: "DECOY HTML",
      textContent: "DECOY TEXT",
      value: "DECOY VALUE",
    };
    const direct = $(objectTarget);
    expect(direct.text()).toBe(heading.textContent);
    expect(direct.val()).toEqual(["Search", "Offline"]);
    objectTarget.id = "missing";
    let nested = direct;
    for (let depth = 0; depth < 8; depth++) nested = $(nested);

    expect(nested.id).toBe("features");
    expect(nested.text()).toBe(heading.textContent);
    expect(nested.val()).toEqual(["Search", "Offline"]);
    expect(nested.val("Ignored")).toBe(nested);
    expect(heading.textContent).toBe("Features");
    expect(objectTarget.value).toBe("DECOY VALUE");
    expect(nested.push({ value: "Nested addition", checked: true })).toBe(4);
    expect(nested.val()).toEqual(["Search", "Offline", "Nested addition"]);
  });

  test("Unicode and numeric element IDs remain canonical through object wrapping", () => {
    const { $, heading } = webSelector();
    heading.classList.add("field");

    for (const id of ["中文-設定", "2026"]) {
      heading.id = id;
      let nested = $({ id, value: "decoy" });
      for (let depth = 0; depth < 4; depth++) nested = $(nested);
      expect(nested.id).toBe(id);
      expect(nested.text()).toBe("Features");
      expect(nested.data()).toBe($(`#${id}`).data());
      expect($(`h2#${id}.field`).text()).toBe("Features");
      expect($(`#${id}.field`).text()).toBe("Features");
    }
  });
});

describe("WUI object target wrapper", () => {
  test("supports $(this).text() and $(event.target).text()", () => {
    const { $, documentObject } = webSelector();
    const link = documentObject.createElement("a");
    link.append(documentObject.createTextNode("Save"));
    const wrapped = $(link);

    expect(wrapped.text()).toBe("Save");
    expect(wrapped.text("Saved")).toBe(wrapped);
    expect(link.textContent).toBe("Saved");
    expect($(link).text()).toBe("Saved");
  });

  test("val uses an object's value property or falls back to textContent", () => {
    const { $, documentObject } = webSelector();
    const input = documentObject.createElement("input");
    input.value = "old";
    const link = documentObject.createElement("a");
    link.append(documentObject.createTextNode("Open"));

    expect($(input).val()).toBe("old");
    $(input).val("new");
    expect(input.value).toBe("new");
    expect($(link).val()).toBe("Open");
    $(link).val("Close");
    expect(link.textContent).toBe("Close");
  });

  test("heading html hides the internal first-character toggle wrapper", () => {
    const { $ } = webSelector();
    const copy = {
      innerHTML: '<em><span class="mdcui-heading-toggle">T</span>itle</em>',
      querySelectorAll() {
        return [{
          childNodes: ["T"],
          replaceWith() {
            copy.innerHTML = "<em>Title</em>";
          },
        }];
      },
    };
    const heading = {
      tagName: "H2",
      cloneNode() {
        return copy;
      },
    };

    expect($(heading).html()).toBe("<em>Title</em>");
  });

  test("invalid object ids stay generic while missing legal ids do not", () => {
    const { $ } = webSelector();
    const invalidTargets = [
      { id: "-invalid", value: "leading punctuation" },
      { id: "invalid id", value: "spaced" },
    ];
    const missing = { id: "missing", value: "decoy", textContent: "decoy" };

    for (const target of invalidTargets) {
      const wrapped = $(target);
      expect(wrapped.id).toBe("");
      expect(wrapped.val()).toBe(target.value);
      wrapped.val("updated");
      expect(target.value).toBe("updated");
    }
    expect($(missing).val()).toBe("");
    $(missing).val("ignored");
    expect(missing.value).toBe("decoy");
    expect(missing.textContent).toBe("decoy");
  });

  test("pure ids with selector punctuation use id lookup", () => {
    const documentObject = new TestDocument();
    const section = documentObject.createElement("section");
    const heading = documentObject.createElement("h2");
    heading.id = "feature:item";
    heading.append(documentObject.createTextNode("Punctuation ID"));
    section.append(heading);
    documentObject.root.append(section);
    documentObject.querySelector = () => {
      throw new SyntaxError("CSS parser treats ':' as a pseudo-class");
    };
    const $ = createWebDollar(documentObject);

    expect($("#feature:item").text()).toBe("Punctuation ID");
    expect($({ id: "feature:item", textContent: "DECOY" }).text())
      .toBe("Punctuation ID");
  });

  test("a missing literal colon ID cannot fall through to a CSS pseudo-selector", () => {
    const documentObject = new TestDocument();
    const section = documentObject.createElement("section");
    const heading = documentObject.createElement("h2");
    heading.id = "feature";
    heading.append(documentObject.createTextNode("Wrong CSS match"));
    section.append(heading);
    documentObject.root.append(section);
    documentObject.querySelector = selector =>
      selector === "#feature:first-child" ? heading : null;
    const $ = createWebDollar(documentObject);

    expect($("#feature:first-child").id).toBe("feature:first-child");
    expect($("#feature:first-child").text()).toBe("");
  });
});
