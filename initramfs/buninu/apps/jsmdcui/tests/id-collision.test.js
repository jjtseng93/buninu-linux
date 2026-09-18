import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTuiSelector } from "../src/plugins/js-bridge.js";

const tui = join(import.meta.dir, "..", "tui");
const bunBin = Bun.which("bun") || process.argv0;

async function runCheck(markdown) {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-check-"));
  const file = join(dir, "app.md");
  await writeFile(file, markdown);
  const result = Bun.spawnSync([bunBin, tui, "--check", file], { stdout: "pipe", stderr: "pipe" });
  await rm(dir, { recursive: true, force: true });
  return result;
}

async function runOutline(markdown, extraArgs = []) {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-outline-"));
  const file = join(dir, "app.md");
  await writeFile(file, markdown);
  const result = Bun.spawnSync(
    [bunBin, tui, "--outline", ...extraArgs, file],
    { stdout: "pipe", stderr: "pipe" },
  );
  await rm(dir, { recursive: true, force: true });
  return result;
}

test("--check exits 0 and reports unique IDs", async () => {
  const result = await runCheck("## Input Path\n\n```text#output-path\nvalue\n```\n");
  expect(result.exitCode).toBe(0);
  const raw = result.stdout.toString();
  const output = Bun.stripANSI(raw);
  expect(output).toContain("No ID collisions found");
  expect(output).toContain("PASSED");
  expect(raw).toContain(`${Bun.color("#00d75f", "ansi-16m")}\x1b[1mPASSED\x1b[0m`);
});

test("--check fails closed when browser heading parsing is ambiguous", async () => {
  const result = await runCheck('<div/a< x=">TAIL\n\n# 中文\n');
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain(
    "Markdown headings could not be classified safely",
  );
  expect(result.stdout.toString()).not.toContain("PASSED");
});

test("--check reports heading/fenced-block collisions with line details", async () => {
  const result = await runCheck("## Write Status\n\n```text#write-status\nwaiting\n```\n");
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(1);
  expect(output).toContain("FAIL — Found 1 colliding ID(s)");
  expect(output).toContain("ID #write-status");
  expect(output).toContain("Declarations: 2");
  expect(output).toContain("Line 1");
  expect(output).toContain("Type: heading");
  expect(output).toContain("Source: ## Write Status");
  expect(output).toContain("Line 3");
  expect(output).toContain("Type: text fenced block");
  expect(output).toContain("Source: ```text#write-status");
  expect(result.stdout.toString()).toContain(`${Bun.color("#ff3030", "ansi-16m")}\x1b[1mFAILED\x1b[0m`);
  expect(output.lastIndexOf("FAILED")).toBeGreaterThan(output.lastIndexOf("Suggested fix"));
});

test("--check keeps fenced IDs that are followed by inline event attributes", async () => {
  const result = await runCheck(
    '## Write Status\n\n```text#write-status @keydown="refresh(); validate(event)"\nwaiting\n```\n',
  );
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(1);
  expect(output).toContain("ID #write-status");
  expect(output).toContain("Type: text fenced block");
  expect(output).toContain('Source: ```text#write-status @keydown="refresh(); validate(event)"');
});

test("--check reports duplicate fenced-block IDs", async () => {
  const result = await runCheck("```text#myid\na\n```\n\n```textarea#myid\nb\n```\n");
  expect(result.exitCode).toBe(1);
  const output = Bun.stripANSI(result.stdout.toString());
  expect(output).toContain("ID #myid");
  expect(output).toContain("Declarations: 2");
  expect(output).toContain("FAILED");
});

test("--check includes IDs on arbitrary fenced-block tags", async () => {
  const result = await runCheck("```hello#myid\nyou\n```\n\n# myid\n");
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(1);
  expect(output).toContain("ID #myid");
  expect(output).toContain("Declarations: 2");
  expect(output).toContain("Type: hello fenced block");
  expect(output).toContain("Fenced blocks: 1");
  expect(output).toContain("FAILED");
});

test("--check rejects duplicate Markdown heading IDs before Bun adds suffixes", async () => {
  const result = await runCheck("# myid\n\n# myid\n");
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(1);
  expect(output).toContain("ID #myid");
  expect(output).toContain("Declarations: 2");
  expect(output).toContain("Line 1");
  expect(output).toContain("Line 3");
  expect(output).toContain("FAILED");
});

test("--check treats a normalized Chinese heading as a selectable ID", async () => {
  const result = await runCheck("# 中文 設定！\n");
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(0);
  expect(output).toContain("Selectable IDs: 1");
  expect(output).toContain("Headings: 1");
  expect(output).toContain("PASSED");
});

test("--check reports Chinese headings that normalize to the same ID", async () => {
  const result = await runCheck("# 中文，設定\n\n# 中文 設定！\n");
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(1);
  expect(output).toContain("ID #中文-設定");
  expect(output).toContain("Declarations: 2");
  expect(output).toContain("Line 1");
  expect(output).toContain("Line 3");
  expect(output).toContain("FAILED");
});

test("--check reports a Chinese heading and fenced-block ID collision", async () => {
  const result = await runCheck(
    "# 中文 設定！\n\n```text#中文-設定\nvalue\n```\n",
  );
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(1);
  expect(output).toContain("ID #中文-設定");
  expect(output).toContain("Type: heading");
  expect(output).toContain("Type: text fenced block");
  expect(output).toContain("FAILED");
});

test("--check includes blockquote and list headings", async () => {
  const result = await runCheck(`> # 中文

- # 中文

# 中文
`);
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(1);
  expect(output).toContain("ID #中文");
  expect(output).toContain("Declarations: 3");
  expect(output).toContain("Line 1");
  expect(output).toContain("Line 3");
  expect(output).toContain("Line 5");
});

test("--check preserves ATX closing hashes while locating source headings", async () => {
  const result = await runCheck("# 中文 ###\n\n# 中文\n");
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(1);
  expect(output).toContain("ID #中文");
  expect(output).toContain("Declarations: 2");
  expect(output).toContain("Line 1");
  expect(output).toContain("Line 3");
});

test("--check source markers do not turn a closing fence into content", async () => {
  const result = await runCheck("```\ncode\n```\n---\n# 中文\n");
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(0);
  expect(output).toContain("Selectable IDs: 1");
  expect(output).toContain("Headings: 1");
  expect(output).toContain("PASSED");
});

test("--check ignores raw-heading examples in code and escaped HTML", async () => {
  const result = await runCheck(`\`\`\`html
<h1 id="example">code sample</h1>
\`\`\`

&lt;h1 id="example"&gt;escaped sample&lt;/h1&gt;

\`\`\`text#example
value
\`\`\`
`);
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(0);
  expect(output).toContain("Selectable IDs: 1");
  expect(output).toContain("PASSED");
});

test("--check derives IDs and source lines from multiline Setext headings", async () => {
  const result = await runCheck(`Foo
bar
---

\`\`\`text#foo-bar
value
\`\`\`
`);
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(1);
  expect(output).toContain("ID #foo-bar");
  expect(output).toContain("Line 1");
  expect(output).toContain("Type: heading");
  expect(output).toContain("FAILED");
});

test("--check does not mistake an inline hash for an ATX heading", async () => {
  const result = await runCheck(`Title # note
===

\`\`\`text#title-note
value
\`\`\`
`);
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(1);
  expect(output).toContain("ID #title-note");
  expect(output).toContain("Line 1");
  expect(output).toContain("FAILED");
});

test("--check keeps list context when identifying an indented heading", async () => {
  const result = await runCheck(`-   item

    # child

\`\`\`text#child
value
\`\`\`
`);
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(1);
  expect(output).toContain("ID #child");
  expect(output).toContain("Line 3");
  expect(output).toContain("FAILED");
});

test("--check ignores heading-looking text in raw HTML and comments", async () => {
  const result = await runCheck(`<!--
# 中文
-->

<script type="text/plain">
# 中文
</script>

<div>
# 中文
</div>

# 中文
`);
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(0);
  expect(output).toContain("Selectable IDs: 1");
  expect(output).toContain("Headings: 1");
  expect(output).toContain("PASSED");
});

test("--check includes actual raw HTML heading IDs in the selector namespace", async () => {
  const result = await runCheck(`<h1 title="a > b" id="中文">Raw</h1>

# 中文
`);
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(1);
  expect(output).toContain("ID #中文");
  expect(output).toContain("Declarations: 2");
  expect(output).toContain("Type: raw HTML heading");
  expect(output).toContain("Type: heading");
  expect(output).toContain("Line 1");
  expect(output).toContain("Line 3");
});

test("--check decodes named entities in raw heading IDs", async () => {
  const result = await runCheck(`<h1 id="caf&eacute;">Café</h1>

\`\`\`text#café
value
\`\`\`
`);
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(1);
  expect(output).toContain("ID #café");
  expect(output).toContain("Type: raw HTML heading");
  expect(output).toContain("Type: text fenced block");
  expect(output).toContain("FAILED");
});

test("--check includes fenced IDs inside Markdown containers", async () => {
  const result = await runCheck(`# quote

> \`\`\`text#quote
> value
> \`\`\`

# list

- \`\`\`textarea#list
  value
  \`\`\`
`);
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(1);
  expect(output).toContain("Found 2 colliding ID(s)");
  expect(output).toContain("ID #quote");
  expect(output).toContain("ID #list");
  expect(output).toContain("FAILED");
});

test("--check ignores fence-looking text inside raw HTML", async () => {
  const result = await runCheck(`# raw-div

<div>
\`\`\`text#raw-div
value
\`\`\`
</div>

# comment

<!--
\`\`\`text#comment
value
\`\`\`
-->
`);
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(0);
  expect(output).toContain("Selectable IDs: 2");
  expect(output).toContain("PASSED");
});

test("--check reserves malformed raw heading IDs", async () => {
  const result = await runCheck(`<h1 id="中文"/>raw</h1>

# 中文
`);
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(1);
  expect(output).toContain("ID #中文");
  expect(output).toContain("Type: raw HTML heading");
  expect(output).toContain("Type: heading");
  expect(output).toContain("FAILED");
});

test("--check ignores heading-looking text inside raw attributes", async () => {
  const result = await runCheck(
    '<h2 title="prefix <h1 id=fake> suffix" id="中文">Raw</h2>\n\n'
      + "# 中文\n",
  );
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(1);
  expect(output).toContain("ID #中文");
  expect(output).not.toContain("ID #fake");
  expect(output).toContain("FAILED");
});

test("--check preserves slash-separated raw heading attributes", async () => {
  const result = await runCheck("<h1/id=中文>Raw</h1>\n\n# 中文\n");
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(1);
  expect(output).toContain("ID #中文");
  expect(output).toContain("Type: raw HTML heading");
  expect(output).toContain("Type: heading");
  expect(output).toContain("FAILED");
});

test("--check ignores heading-like custom tag names", async () => {
  const result = await runCheck(
    "<h1! id=中文>Fake</h1!>\n\n# 中文\n",
  );
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(0);
  expect(output).toContain("Selectable IDs: 1");
  expect(output).toContain("PASSED");
});

const identityMatrix = [
  {
    name: "tag without class",
    info: "text#myid",
    selectable: true,
  },
  {
    name: "tag with class",
    info: "text#myid.field",
    selectable: true,
  },
  {
    name: "no tag and no class",
    info: "#myid",
    selectable: false,
  },
  {
    name: "no tag with class",
    info: "#myid.field",
    selectable: false,
  },
];

for (const scenario of identityMatrix) {
  test(`--check identity matrix: ${scenario.name}`, async () => {
    const result = await runCheck(`\`\`\`${scenario.info}\nvalue\n\`\`\`\n\n# myid\n`);
    const output = Bun.stripANSI(result.stdout.toString());
    expect(result.exitCode).toBe(scenario.selectable ? 1 : 0);
    expect(output).toContain(`Fenced blocks: ${scenario.selectable ? 1 : 0}`);
    if (scenario.selectable) {
      expect(output).toContain("ID #myid");
      expect(output).toContain("Declarations: 2");
      expect(output).toContain("FAILED");
    } else {
      expect(output).toContain("Selectable IDs: 1");
      expect(output).toContain("PASSED");
    }
  });
}

test("--check ignores tag and class differences when fenced-block IDs collide", async () => {
  const result = await runCheck(
    "```text#myid.left.primary\na\n```\n\n```json#myid.right.secondary\nb\n```\n",
  );
  const output = Bun.stripANSI(result.stdout.toString());
  expect(result.exitCode).toBe(1);
  expect(output).toContain("ID #myid");
  expect(output).toContain("Declarations: 2");
  expect(output).toContain("Type: text fenced block");
  expect(output).toContain("Type: json fenced block");
  expect(output).toContain("FAILED");
});

test("TUI $ selector finds one ID across every tag/class query combination", () => {
  const markdown = "```text#myid.field.primary\nvalue\n```\n";
  const buffer = { lines: markdown.trimEnd().split("\n") };
  const $ = createTuiSelector(() => buffer);
  const selectors = [
    "text#myid.field",
    "text#myid",
    "#myid.field",
    "#myid",
  ];
  for (const selector of selectors) expect($(selector).val()).toBe("value");
});

test("--check requires exactly one file", () => {
  const result = Bun.spawnSync([bunBin, tui, "--check"], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain("Usage: jsmdcui --check FILE.md");
});

test("--outline prints heading IDs as a hierarchy and fenced IDs at top level", async () => {
  const result = await runOutline(`# Root

## 中文 子項

> \`\`\`text#輸入
> value
> \`\`\`

### Deep

# Second

- \`\`\`custom#myfence
  value
  \`\`\`
`);
  expect(result.exitCode).toBe(0);
  expect(result.stderr.toString()).toBe("");
  expect(result.stdout.toString()).toBe(
    "- root\n"
      + "  - 中文-子項\n"
      + "+ 輸入\n"
      + "    - deep\n"
      + "- second\n"
      + "+ myfence\n",
  );
});

test("--outline reuses check declarations and keeps duplicate IDs", async () => {
  const result = await runOutline(`# Same

# Same

\`\`\`text#same
value
\`\`\`
`);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString()).toBe("- same\n- same\n+ same\n");
});

test("--outline fails closed when browser heading parsing is ambiguous", async () => {
  const result = await runOutline('<div/a< x=">TAIL\n\n# 中文\n');
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain(
    "Markdown headings could not be classified safely",
  );
  expect(result.stdout.toString()).toBe("");
});

test("--outline requires exactly one file", () => {
  const result = Bun.spawnSync(
    [bunBin, tui, "--outline"],
    { stdout: "pipe", stderr: "pipe" },
  );
  expect(result.exitCode).toBe(2);
  expect(result.stderr.toString()).toContain(
    "Usage: jsmdcui --outline FILE.md",
  );
});
