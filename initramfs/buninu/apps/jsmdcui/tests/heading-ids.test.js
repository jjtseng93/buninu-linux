import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWui } from "../runmd.mjs";
import {
  collectMarkdownHeadingDeclarations,
  collectRawHtmlHeadingDeclarations,
  normalizeUnicodeHeadingId,
  renderMarkdownWithHeadingIds,
} from "../src/cui/heading-ids.mjs";
import {
  isMdcuiId,
  parseMdcuiIdentity,
  parseMdcuiIdSelector,
} from "../src/cui/identity.mjs";

test("Unicode heading IDs normalize visible text without changing existing ASCII slugs", () => {
  expect(normalizeUnicodeHeadingId("使用者 設定！")).toBe("使用者-設定");
  expect(normalizeUnicodeHeadingId("中文，標題！")).toBe("中文-標題");
  expect(normalizeUnicodeHeadingId("e\u0301 設定")).toBe("é-設定");
  expect(normalizeUnicodeHeadingId("ＵＩ Café 設定")).toBe("ui-café-設定");

  const rendered = renderMarkdownWithHeadingIds(
    "# **進階** `設定` & 說明！\n\n# Hello 中文 World\n",
  );
  expect(rendered.normalized).toBe(true);
  expect(rendered.headings.map(heading => heading.id)).toEqual([
    "進階-設定-說明",
    "hello-world",
  ]);
  expect(rendered.headings[0].html).toBe(
    "<strong>進階</strong> <code>設定</code> &amp; 說明！",
  );
});

test("distinct empty Bun bases get independent Unicode IDs and duplicates get suffixes", () => {
  const rendered = renderMarkdownWithHeadingIds(`# 中文

# 🎉

# 日本語

# 中文

# 中文，設定

# 中文 設定！
`);
  const ids = rendered.headings.map(heading => heading.id);
  expect(ids[0]).toBe("中文");
  expect(ids[1]).toMatch(/^mdcui-h-[0-9a-f]{16}$/);
  expect(ids[2]).toBe("日本語");
  expect(ids[3]).toBe("中文-1");
  expect(ids[4]).toBe("中文-設定");
  expect(ids[5]).toBe("中文-設定-1");
  expect(new Set(ids).size).toBe(ids.length);
  expect(normalizeUnicodeHeadingId("🎉")).toBe(ids[1]);
  expect(normalizeUnicodeHeadingId("🎊")).not.toBe(ids[1]);
});

test("fallback IDs avoid existing IDs and raw HTML headings are not rewritten", () => {
  const rendered = renderMarkdownWithHeadingIds(`# ＦＯＯ

# foo

<h1 id="-1">raw heading</h1>
`);
  expect(rendered.headings.map(heading => heading.id)).toEqual([
    "foo-1",
    "foo",
  ]);
  expect(rendered.html).toContain('<h1 id="-1">raw heading</h1>');
});

test("identical raw HTML headings do not make Markdown heading alignment ambiguous", () => {
  const rendered = renderMarkdownWithHeadingIds(`<h1 id="中文">中文</h1>

# 中文

<h1 id="">中文</h1>
`);
  expect(rendered.normalized).toBe(true);
  expect(rendered.headings.map(heading => heading.id)).toEqual(["中文-1"]);
  expect(rendered.html).toContain('<h1 id="中文">中文</h1>');
  expect(rendered.html).toContain('<h1 id="中文-1">中文</h1>');
  expect(rendered.html).toContain('<h1 id="">中文</h1>');
});

test("heading discovery ignores comments and opaque raw HTML", () => {
  for (const opaque of [
    '<textarea><h1 id=""></textarea>',
    '<script type="text/plain"><h1 id=""></script>',
    '<!-- <h1 id="中文">comment only</h1> -->',
  ]) {
    const rendered = renderMarkdownWithHeadingIds(`${opaque}

# 中文
`);
    expect(rendered.normalized).toBe(true);
    expect(rendered.headings.map(heading => heading.id)).toEqual(["中文"]);
    expect(rendered.html).toContain(opaque);
    expect(rendered.html).toContain('<h1 id="中文">中文</h1>');
  }
});

test("heading discovery never promotes code or escaped HTML into raw headings", () => {
  for (const prefix of [
    '```html\n<h1 id="中文">code</h1>\n```',
    '`<h1 id="中文">inline code</h1>`',
    '    <h1 id="中文">indented code</h1>',
    '&lt;h1 id="中文"&gt;escaped&lt;/h1&gt;',
  ]) {
    const rendered = renderMarkdownWithHeadingIds(`${prefix}

# 中文
`);
    expect(rendered.normalized).toBe(true);
    expect(rendered.headings.map(heading => heading.id)).toEqual(["中文"]);
    expect(collectRawHtmlHeadingDeclarations(prefix)).toEqual([]);
  }
});

test("fake heading tags in Markdown text cannot suppress raw ID collisions", () => {
  for (const fake of [
    "# `<h1 id=fake>`",
    "# \\<h1 id=fake>",
  ]) {
    const markdown =
      `<h2 id=中文>Raw</h2>\n\n${fake}\n\n# 中文\n`;
    expect(
      collectRawHtmlHeadingDeclarations(markdown).map(item => item.id),
    ).toEqual(["中文"]);
    const rendered = renderMarkdownWithHeadingIds(markdown);
    expect(rendered.normalized).toBe(true);
    expect(rendered.headings.at(-1).id).toBe("中文-1");
  }
});

test("raw heading discovery follows HTML raw-text boundaries and source lines", () => {
  const markdown = `<script><fake title="</script>">
<h1 id="actual">actual</h1>
</script>
<pre><h2 id="inside-pre">inside pre</h2></pre>
`;
  expect(collectRawHtmlHeadingDeclarations(markdown)).toEqual([
    {
      id: "actual",
      kind: "raw HTML heading",
      line: 2,
      source: '<h1 id="actual">actual</h1>',
    },
    {
      id: "inside-pre",
      kind: "raw HTML heading",
      line: 4,
      source: '<pre><h2 id="inside-pre">inside pre</h2></pre>',
    },
  ]);
});

test("raw heading IDs use browser-equivalent named entity values", () => {
  expect(
    collectRawHtmlHeadingDeclarations('<h1 id="caf&eacute;">Café</h1>'),
  ).toEqual([
    {
      id: "café",
      kind: "raw HTML heading",
      line: 1,
      source: '<h1 id="caf&eacute;">Café</h1>',
    },
  ]);
  expect(
    collectRawHtmlHeadingDeclarations('<h1 id="price-&#128">Price</h1>'),
  ).toEqual([
    {
      id: "price-€",
      kind: "raw HTML heading",
      line: 1,
      source: '<h1 id="price-&#128">Price</h1>',
    },
  ]);
});

test("collision IDs preserve Bun inline heading slug semantics", () => {
  const sources = [
    "# `fake`\n",
    "# A<br>B\n",
    "# A ![Foo](image.png) B\n",
    "# A<img alt=Foo>B\n",
    "# 中文 <script>hidden</script>\n",
    "# ＦＯＯ 中文\n",
    "# e\u0301 中文\n",
    "# [Foo][reference]\n\n[reference]: /\n",
  ];

  for (const markdown of sources) {
    const runtime = renderMarkdownWithHeadingIds(markdown);
    const declarations = collectMarkdownHeadingDeclarations(markdown);
    expect(declarations.map(declaration => declaration.id)).toEqual(
      runtime.headings.map(heading => heading.id),
    );
  }
});

test("raw heading discovery follows browser parsing for malformed and nested HTML", () => {
  const markdown = `<h1 id="中文"/>self-closing syntax</h1>

<h2 id="open">unclosed

# before <h3 id="inline">nested</h3> after

<script><!--<script></script><h4 id="fake">not a heading</h4></script>

<template><h5 id="template">not in the document tree</h5></template>
`;
  expect(collectRawHtmlHeadingDeclarations(markdown)).toEqual([
    {
      id: "中文",
      kind: "raw HTML heading",
      line: 1,
      source: '<h1 id="中文"/>self-closing syntax</h1>',
    },
    {
      id: "open",
      kind: "raw HTML heading",
      line: 3,
      source: '<h2 id="open">unclosed',
    },
    {
      id: "inline",
      kind: "raw HTML heading",
      line: 5,
      source: '# before <h3 id="inline">nested</h3> after',
    },
  ]);
});

test("foreign-namespace template elements do not hide document headings", () => {
  const markdown =
    '<svg><template><h1 id="中文">Raw</h1></template></svg>\n\n# 中文\n';
  expect(collectRawHtmlHeadingDeclarations(markdown)).toEqual([
    {
      id: "中文",
      kind: "raw HTML heading",
      line: 1,
      source:
        '<svg><template><h1 id="中文">Raw</h1></template></svg>',
    },
  ]);
  expect(
    renderMarkdownWithHeadingIds(markdown).headings.map(heading => heading.id),
  ).toEqual(["中文-1"]);
});

test("raw heading markers cannot change Markdown HTML-block classification", () => {
  for (const punctuation of ["=", ".", "!", "?", "@", "#", "("]) {
    const markdown =
      `<h1\f${punctuation} id=中文>Raw</h1>\n\n# 中文\n`;
    expect(collectRawHtmlHeadingDeclarations(markdown)).toEqual([]);
    const rendered = renderMarkdownWithHeadingIds(markdown);
    expect(rendered.headings.map(heading => heading.id)).toEqual(["中文"]);
    expect(rendered.html).toContain('<h1 id="中文">中文</h1>');
  }
});

test("fake tags cannot hide later headings across HTML tokenizer states", () => {
  for (const prefix of [
    '<!-- <div title="\n-->',
    '<!wat <div title="\n>',
    '<![foo <div title="\n>',
    '<script><div x="</script>',
  ]) {
    const markdown =
      `${prefix}\n<h1 id=中文>Raw</h1>\n">\n\n# 中文\n`;
    expect(
      collectRawHtmlHeadingDeclarations(markdown).map(item => item.id),
    ).toEqual(["中文"]);
    const rendered = renderMarkdownWithHeadingIds(markdown);
    expect(rendered.headings.map(heading => heading.id))
      .toEqual(["中文-1"]);
  }
});

test("fake heading tags inside attributes never replace their owner", () => {
  const markdown =
    '<h2 id=real x=<h1/id=fake>>Body</h2>\n\n# 中文\n';
  expect(collectRawHtmlHeadingDeclarations(markdown)).toEqual([
    {
      id: "real",
      kind: "raw HTML heading",
      line: 1,
      source: '<h2 id=real x=<h1/id=fake>>Body</h2>',
    },
  ]);
  const rendered = renderMarkdownWithHeadingIds(markdown);
  expect(rendered.normalized).toBe(true);
  expect(rendered.headings.map(heading => heading.id)).toEqual(["中文"]);
  expect(rendered.html).toContain("<h2 id=real x=<h1/id=fake>>Body</h2>");
  expect(rendered.html).toContain('<h1 id="中文">中文</h1>');
});

test("unterminated fake heading attributes cannot cross comment boundaries", () => {
  const markdown = `<!-- <h1 title="
-->
<h2 id=real>Raw</h2>
">

# 中文
`;
  expect(
    collectRawHtmlHeadingDeclarations(markdown).map(item => item.id),
  ).toEqual(["real"]);
  expect(
    renderMarkdownWithHeadingIds(markdown).headings.map(heading => heading.id),
  ).toEqual(["中文"]);
});

test("abrupt HTML comments do not hide later raw headings", () => {
  for (const prefix of ["<!-->", "<!--x--!>"]) {
    const markdown = `${prefix}\n<h1 id=x>Raw</h1>\n`;
    expect(
      collectRawHtmlHeadingDeclarations(markdown).map(item => item.id),
    ).toEqual(["x"]);
  }
});

test("raw heading markers do not change quoted attribute parsing", () => {
  const markdown = `<h2 title="prefix <h1 id=fake> suffix" id="中文">Raw</h2>

# 中文
`;
  expect(collectRawHtmlHeadingDeclarations(markdown)).toEqual([
    {
      id: "中文",
      kind: "raw HTML heading",
      line: 1,
      source:
        '<h2 title="prefix <h1 id=fake> suffix" id="中文">Raw</h2>',
    },
  ]);
  const rendered = renderMarkdownWithHeadingIds(markdown);
  expect(rendered.headings.map(heading => heading.id)).toEqual(["中文-1"]);
  expect(rendered.html).toContain(
    '<h2 title="prefix <h1 id=fake> suffix" id="中文">Raw</h2>',
  );
  expect(rendered.html).toContain('<h1 id="中文-1">中文</h1>');
});

test("raw heading markers preserve slash-separated HTML attributes", () => {
  const markdown = `<h1/id=中文>Raw</h1>

# 中文
`;
  expect(collectRawHtmlHeadingDeclarations(markdown)).toEqual([
    {
      id: "中文",
      kind: "raw HTML heading",
      line: 1,
      source: "<h1/id=中文>Raw</h1>",
    },
  ]);
  const rendered = renderMarkdownWithHeadingIds(markdown);
  expect(rendered.headings.map(heading => heading.id)).toEqual(["中文-1"]);
  expect(rendered.html).toContain("<h1/id=中文>Raw</h1>");
  expect(rendered.html).toContain('<h1 id="中文-1">中文</h1>');
});

test("self-closing inline headings cannot suppress other raw collisions", () => {
  const markdown =
    "<h2 id=中文>Raw</h2>\n\ntext <h3/> tail\n\n# 中文\n";
  expect(
    collectRawHtmlHeadingDeclarations(markdown).map(item => item.id),
  ).toEqual(["中文"]);
  const rendered = renderMarkdownWithHeadingIds(markdown);
  expect(rendered.normalized).toBe(true);
  expect(rendered.headings.map(heading => heading.id)).toEqual(["中文-1"]);
});

test("heading-like custom tag names never become raw headings", () => {
  for (const punctuation of ["!", "?", "@", ".", "#", "(", "="]) {
    const markdown =
      `<h1${punctuation} id=中文>Fake</h1${punctuation}>\n\n# 中文\n`;
    expect(collectRawHtmlHeadingDeclarations(markdown)).toEqual([]);
    const rendered = renderMarkdownWithHeadingIds(markdown);
    expect(rendered.headings.map(heading => heading.id)).toEqual(["中文"]);
    expect(rendered.html).toContain('<h1 id="中文">中文</h1>');
  }
});

test("raw heading scan follows unquoted and non-HTML whitespace states", () => {
  const unquoted = `<div x=a"><h1 id=x>Raw</h1>">

# 中文
`;
  expect(
    collectRawHtmlHeadingDeclarations(unquoted).map(item => item.id),
  ).toEqual(["x"]);
  const rendered = renderMarkdownWithHeadingIds(unquoted);
  expect(rendered.headings.map(heading => heading.id)).toEqual(["中文"]);
  expect(rendered.html).toContain('<h1 id=x>Raw</h1>');
  expect(rendered.html).toContain('<h1 id="中文">中文</h1>');

  const nonHtmlWhitespace = "<h1\u00a0foo id=x>Fake</h1>\n\n# 中文\n";
  expect(collectRawHtmlHeadingDeclarations(nonHtmlWhitespace)).toEqual([]);
  expect(
    renderMarkdownWithHeadingIds(nonHtmlWhitespace)
      .headings.map(heading => heading.id),
  ).toEqual(["中文"]);
});

test("raw heading attributes preserve HTML entity and whitespace rules", () => {
  const markdown = [
    '<h1 id="caf&eacute">legacy entity</h1>',
    '<h2 id="x&AmP;y">case-sensitive entity</h2>',
    "<h3 id=x\u00a0foo=y>non-HTML whitespace</h3>",
  ].join("\n");
  expect(
    collectRawHtmlHeadingDeclarations(markdown).map(item => item.id),
  ).toEqual(["café", "x&AmP;y", "x\u00a0foo=y"]);
});

test("heading declaration source lines support CR and complex Setext blocks", () => {
  expect(
    collectMarkdownHeadingDeclarations("# one\r# two\r")
      .map(({ id, line }) => ({ id, line })),
  ).toEqual([
    { id: "one", line: 1 },
    { id: "two", line: 2 },
  ]);

  const markdown = `> para
>
> X
> ---

Foo ![alt
text](image.png) bar
---
`;
  expect(
    collectMarkdownHeadingDeclarations(markdown)
      .map(({ id, line }) => ({ id, line })),
  ).toEqual([
    { id: "x", line: 3 },
    { id: "foo-alt-text-bar", line: 6 },
  ]);

  const boundaries = `[ref]: /url
  "title"
Reference title
---

<!--
comment
-->
After comment
---
`;
  expect(
    collectMarkdownHeadingDeclarations(boundaries)
      .map(({ id, line }) => ({ id, line })),
  ).toEqual([
    { id: "reference-title", line: 3 },
    { id: "after-comment", line: 9 },
  ]);

  for (const label of ["[a\\]]", "[a\\q]", "[a\\ ]"]) {
    const escapedReference = `${label}: /url
  "title"
---
# Real
`;
    expect(
      collectMarkdownHeadingDeclarations(escapedReference)
        .map(({ id, line }) => ({ id, line })),
    ).toEqual([{ id: "real", line: 4 }]);
  }
});

test("Setext source markers do not depend on unused private-use characters", () => {
  const privateUse = Array.from(
    { length: 0xf8fe - 0xe200 },
    (_, offset) => String.fromCodePoint(0xe200 + offset),
  ).join("");
  expect(
    collectMarkdownHeadingDeclarations(`${privateUse}\n\nHeading\n---\n`)
      .at(-1),
  ).toMatchObject({
    id: "heading",
    line: 3,
  });
});

test("quoted tag delimiters preserve raw IDs and Markdown heading metadata", () => {
  const rendered = renderMarkdownWithHeadingIds(`<h1 title="a > b" id="中文">Raw</h1>

# 中文

# before <span data-x="</h1>">中文</span> after
`);
  expect(rendered.normalized).toBe(true);
  expect(rendered.headings).toHaveLength(2);
  expect(rendered.headings[0].id).toBe("中文-1");
  expect(rendered.headings[1].html)
    .toBe('before <span data-x="</h1>">中文</span> after');
  expect(rendered.html).toContain(
    '<h1 title="a > b" id="中文">Raw</h1>',
  );
  expect(rendered.html).toContain('<h1 id="中文-1">中文</h1>');
});

test("browser alignment failures never fall back to lexical heading rewrites", () => {
  const markdown = '<div/a< x=">TAIL\n\n# 中文\n';
  const rendered = renderMarkdownWithHeadingIds(markdown);
  expect(rendered.normalized).toBe(false);
  expect(rendered.headings).toEqual([]);
  expect(rendered.html).toContain('<h1 id="">中文</h1>');
  expect(rendered.html).not.toContain('<h1 id="中文">中文</h1>');
});

test("Unicode MDCUI IDs work in pure, object, and compound identities", () => {
  for (const id of ["中文", "中文-設定", "café", "e\u0301", "_中文", "中文:設定", "2026"]) {
    expect(isMdcuiId(id)).toBe(true);
    expect(parseMdcuiIdSelector(`#${id}`)).toBe(id);
  }
  for (const id of ["", "-中文", "中文 設定", "🎉"]) {
    expect(isMdcuiId(id)).toBe(false);
    expect(parseMdcuiIdSelector(`#${id}`)).toBeNull();
  }
  expect(parseMdcuiIdentity("text#中文-欄位.field")).toEqual({
    tag: "text",
    id: "中文-欄位",
    classes: ["field"],
  });
  expect(parseMdcuiIdentity("#中文-欄位.field", { selector: true })).toEqual({
    tag: null,
    id: "中文-欄位",
    classes: ["field"],
  });
});

test("createWui emits an interactive first-character toggle for Chinese headings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jsmdcui-heading-id-"));
  const markdownPath = join(directory, "app.md");
  try {
    const html = await createWui(
      "# 中文 設定！\n\nBody.\n",
      markdownPath,
    );
    expect(html).toContain('<h1 id="中文-設定">');
    expect(html).toContain(
      '<span class="mdcui-heading-toggle" role="button" tabindex="0" '
      + 'aria-expanded="true">中</span>文 設定！',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
