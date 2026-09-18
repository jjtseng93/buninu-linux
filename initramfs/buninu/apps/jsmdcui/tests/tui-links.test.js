import { describe, expect, test } from "bun:test";
import {
  buildTuiLinkIndex,
  indexedTuiLinkAtPosition,
  refreshTuiLinkIndex,
  tuiLinkActivationContext,
} from "../src/cui/tui-links.mjs";
import { navigateTuiHeadingFragment } from "../src/plugins/js-bridge.js";

function markdownBuffer(markdown, columns) {
  const ansi = String(Bun.markdown.ansi(markdown, {
    hyperlinks: true,
    columns,
  }));
  return {
    encoding: "mdcui",
    lines: Bun.stripANSI(ansi).split("\n"),
    _mdcuiAnsiText: ansi,
    _mdcuiSourceText: markdown,
    _mdcuiTuiSourceText: markdown,
  };
}

describe("TUI OSC 8 link index", () => {
  test("activates every wrapped row and retains the complete rich label", () => {
    const markdown =
      'Before [Inspect **very rich label**](javascript:inspect("hello")) after';
    const buffer = markdownBuffer(markdown, 8);
    const index = buildTuiLinkIndex(
      buffer._mdcuiAnsiText,
      buffer._mdcuiTuiSourceText,
    );
    const link = index.links[0];

    expect(link.segments.length).toBeGreaterThan(2);
    expect(link.href).toBe('javascript:inspect("hello")');
    expect(link.textContent).toBe("Inspect very rich label");
    expect(link.innerHTML).toBe(
      "Inspect <strong>very rich label</strong>",
    );

    for (const segment of link.segments) {
      for (let column = segment.start; column < segment.end; column++) {
        const hit = indexedTuiLinkAtPosition(buffer, segment.row, column);
        expect(hit?.href).toBe('javascript:inspect("hello")');
        expect(hit?.textContent).toBe("Inspect very rich label");
        expect(hit?.innerHTML).toBe(
          "Inspect <strong>very rich label</strong>",
        );
      }
      if (segment.start > 0) {
        expect(
          indexedTuiLinkAtPosition(buffer, segment.row, segment.start - 1),
        ).toBeNull();
      }
      expect(
        indexedTuiLinkAtPosition(buffer, segment.row, segment.end),
      ).toBeNull();
    }

    const html = String(Bun.markdown.html(markdown));
    expect(html).toContain(
      '<a href="javascript:inspect(%22hello%22)">Inspect <strong>very rich label</strong></a>',
    );
    const payload = {
      trigger: "enter",
      link: link.href,
      linkText: link.textContent,
      linkHtml: link.innerHTML,
      linkParent: { row: 1, col: 2 },
    };
    const { event, target } = tuiLinkActivationContext(payload);
    expect(target.href).toBe('javascript:inspect("hello")');
    expect(target.textContent).toBe("Inspect very rich label");
    expect(target.innerHTML).toBe(
      "Inspect <strong>very rich label</strong>",
    );
    expect(event.target).toBe(target);
    expect(event.key).toBe("Enter");
    expect(target.parent()).toBe(payload.linkParent);
  });

  test("matches repeated hrefs in order without letting images shift metadata", () => {
    const markdown =
      "![decoy](same) [first **rich**](same) [second *rich*](same)";
    const buffer = markdownBuffer(markdown, 12);
    const index = buildTuiLinkIndex(
      buffer._mdcuiAnsiText,
      buffer._mdcuiTuiSourceText,
    );

    expect(index.links.map(link => ({
      href: link.href,
      text: link.textContent,
      html: link.innerHTML,
    }))).toEqual([
      { href: "same", text: "📷 decoy", html: null },
      {
        href: "same",
        text: "first rich",
        html: "first <strong>rich</strong>",
      },
      {
        href: "same",
        text: "second rich",
        html: "second <em>rich</em>",
      },
    ]);

    for (const expected of index.links) {
      const segment = expected.segments[0];
      const hit = indexedTuiLinkAtPosition(
        buffer,
        segment.row,
        segment.start,
      );
      expect(hit?.textContent).toBe(expected.textContent);
      expect(hit?.innerHTML).toBe(expected.innerHTML);
    }
  });

  test("does not borrow a later rich label after a same-href mismatch", () => {
    const markdown = [
      "[first <kbd>**rich**</kbd>](same)",
      "[first &lt;kbd&gt;rich&lt;/kbd&gt;](same)",
    ].join(" ");
    const buffer = markdownBuffer(markdown, 80);
    const index = buildTuiLinkIndex(
      buffer._mdcuiAnsiText,
      buffer._mdcuiTuiSourceText,
    );

    expect(index.links.map(link => ({
      text: link.textContent,
      html: link.innerHTML,
      order: link.metadataOrder,
    }))).toEqual([
      {
        text: "first <kbd>rich</kbd>",
        html: null,
        order: 0,
      },
      {
        text: "first <kbd>rich</kbd>",
        html: "first &lt;kbd&gt;rich&lt;/kbd&gt;",
        order: 1,
      },
    ]);
  });

  test("ignores wrapped blockquote prefixes when matching rich metadata", () => {
    const markdown =
      '> [Inspect **very rich label words**](javascript:inspect("quoted"))';
    const buffer = markdownBuffer(markdown, 12);
    const index = buildTuiLinkIndex(
      buffer._mdcuiAnsiText,
      buffer._mdcuiTuiSourceText,
    );
    const link = index.links[0];

    expect(link.segments.length).toBeGreaterThan(2);
    expect(link.textContent).toBe("Inspect very rich label words");
    expect(link.innerHTML).toBe(
      "Inspect <strong>very rich label words</strong>",
    );
    for (const segment of link.segments) {
      expect(
        indexedTuiLinkAtPosition(buffer, segment.row, segment.start)?.innerHTML,
      ).toBe("Inspect <strong>very rich label words</strong>");
    }
  });

  test("keeps source ordinals when hidden rows remove an identical href and label", () => {
    const markdown = [
      "[**same**](javascript:repeat())",
      "",
      "[*same*](javascript:repeat())",
    ].join("\n");
    const buffer = markdownBuffer(markdown, 80);
    const full = refreshTuiLinkIndex(buffer, { resetCatalog: true });
    expect(full.links.map(link => link.innerHTML)).toEqual([
      "<strong>same</strong>",
      "<em>same</em>",
    ]);

    const second = full.links[1];
    const ansiLines = buffer._mdcuiAnsiText.split("\n");
    const keptAnsi = ansiLines.slice(second.segments[0].row).join("\n");
    buffer._mdcuiAnsiText = keptAnsi;
    buffer.lines = Bun.stripANSI(keptAnsi).split("\n");

    const hit = indexedTuiLinkAtPosition(buffer, 0, 0);
    expect(hit?.href).toBe("javascript:repeat()");
    expect(hit?.textContent).toBe("same");
    expect(hit?.innerHTML).toBe("<em>same</em>");
  });

  test("matches Bun HTML encoding without decoding existing javascript percents", () => {
    const markdown =
      '[Inspect **rich**](javascript:inspect("a%20b",`raw`))';
    const buffer = markdownBuffer(markdown, 80);
    const hit = indexedTuiLinkAtPosition(buffer, 0, 0);

    expect(hit?.href).toBe('javascript:inspect("a%20b",`raw`)');
    expect(hit?.textContent).toBe("Inspect rich");
    expect(hit?.innerHTML).toBe("Inspect <strong>rich</strong>");
    expect(String(Bun.markdown.html(markdown))).toContain(
      'href="javascript:inspect(%22a%20b%22,%60raw%60)"',
    );
  });

  test("falls back to the complete displayed text when source metadata is missing", () => {
    const ansi =
      "\x1b]8;;javascript:raw%22value\x1b\\" +
      "\x1b[4mfirst row\nsecond row\x1b[24m" +
      "\x1b]8;;\x1b\\";
    const buffer = {
      lines: Bun.stripANSI(ansi).split("\n"),
      _mdcuiAnsiText: ansi,
      _mdcuiTuiSourceText: null,
    };

    const first = indexedTuiLinkAtPosition(buffer, 0, 0);
    const second = indexedTuiLinkAtPosition(buffer, 1, 0);
    expect(first?.href).toBe("javascript:raw%22value");
    expect(second?.href).toBe("javascript:raw%22value");
    expect(first?.textContent).toBe("first row\nsecond row");
    expect(second?.textContent).toBe("first row\nsecond row");
    expect(first?.innerHTML).toBeNull();

    const { target } = tuiLinkActivationContext({
      trigger: "mouse",
      link: second.href,
      linkText: second.textContent,
      linkHtml: second.innerHTML,
    });
    expect(target.href).toBe("javascript:raw%22value");
    expect(target.textContent).toBe("first row\nsecond row");
    expect(target.innerHTML).toBe("first row\nsecond row");
  });

  test("rebuilds a buffer index after rerender replaces ANSI and source", () => {
    const buffer = markdownBuffer("[old](javascript:old())", 80);
    expect(indexedTuiLinkAtPosition(buffer, 0, 0)?.textContent).toBe("old");

    const replacement = markdownBuffer(
      "[new **rich**](javascript:new())",
      80,
    );
    buffer.lines = replacement.lines;
    buffer._mdcuiAnsiText = replacement._mdcuiAnsiText;
    buffer._mdcuiSourceText = replacement._mdcuiSourceText;
    buffer._mdcuiTuiSourceText = replacement._mdcuiTuiSourceText;

    const hit = indexedTuiLinkAtPosition(buffer, 0, 0);
    expect(hit?.href).toBe("javascript:new()");
    expect(hit?.textContent).toBe("new rich");
    expect(hit?.innerHTML).toBe("new <strong>rich</strong>");
  });

  test("same-document fragments move to the rendered heading toggle", () => {
    const markdown = [
      "[Jump](#%E4%B8%AD%E6%96%87-%E8%A8%AD%E5%AE%9A)",
      "",
      "# Root",
      "",
      "> ## 中文 設定！",
    ].join("\n");
    const buffer = markdownBuffer(markdown, 80);
    let ensureCursorCalls = 0;
    buffer.cursor = { x: 0, y: 0 };
    buffer.scroll = { x: 0, y: 0, row: 0 };
    buffer.ensureCursor = () => { ensureCursorCalls++; };

    const link = indexedTuiLinkAtPosition(buffer, 0, 0);
    expect(link?.href).toBe(
      "#%E4%B8%AD%E6%96%87-%E8%A8%AD%E5%AE%9A",
    );
    expect(navigateTuiHeadingFragment(buffer, link.href)).toBeTrue();
    expect(buffer.lines[buffer.cursor.y]).toContain("中文 設定");
    expect(buffer.cursor.x).toBeGreaterThan(0);
    expect(buffer.allowCursorOffscreen).toBeFalse();
    expect(ensureCursorCalls).toBe(1);
  });

  test("fragment navigation ignores missing, empty, and malformed IDs", () => {
    const buffer = markdownBuffer("# Existing", 80);
    buffer.cursor = { x: 0, y: 0 };
    buffer.ensureCursor = () => {
      throw new Error("missing fragments must not move the cursor");
    };

    expect(navigateTuiHeadingFragment(buffer, "#missing")).toBeFalse();
    expect(navigateTuiHeadingFragment(buffer, "#")).toBeFalse();
    expect(navigateTuiHeadingFragment(buffer, "#%ZZ")).toBeFalse();
    expect(buffer.cursor).toEqual({ x: 0, y: 0 });
  });
});
