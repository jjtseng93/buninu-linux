import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { colorJson, fenceFor, main, renderFancy } from "../src/cat-fancy.js";

describe("catfancy", () => {
  test("parses data formats into colored pretty JSON", () => {
    for (const [name, source] of [
      ["data.json", '{"name":"bun","count":2}'],
      ["data.json5", "{name: 'bun', count: 2}"],
      ["data.toml", 'name = "bun"\ncount = 2\n'],
    ]) {
      const output = renderFancy(source, name);
      expect(output).toContain("\x1b[38;2;");
      expect(Bun.stripANSI(output)).toBe('{\n  "name": "bun",\n  "count": 2\n}\n');
    }
  });

  test("uses Bun markdown ANSI rendering with hyperlinks", () => {
    const output = renderFancy("# Docs\n\n[Site](https://example.com)\n", "README.md");
    expect(output).toContain("\x1b]8;;https://example.com");
    expect(Bun.stripANSI(output)).toContain("Docs");
  });

  test("leaves files without a preview format unchanged", () => {
    expect(renderFancy("plain text\n", "notes.txt")).toBe("plain text\n");
  });

  test("wraps JS-family files in a ```javascript fence and renders via markdown", () => {
    for (const name of ["app.js", "app.mjs", "app.cjs", "app.jsx"]) {
      const output = renderFancy("const x = 1;\n", name);
      expect(output).toContain("\x1b[");
      const stripped = Bun.stripANSI(output);
      // The box border marks it as an actually-parsed fenced code block, not
      // just source text that happens to contain the word "javascript".
      expect(stripped).toContain("┌─ javascript");
      expect(stripped).toContain("└─");
      expect(stripped).toContain("const x = 1;");
    }
  });

  test("wraps TS-family files in a ```typescript fence and renders via markdown", () => {
    for (const name of ["app.ts", "app.mts", "app.cts", "app.tsx"]) {
      const output = renderFancy("const x: number = 1;\n", name);
      expect(output).toContain("\x1b[");
      const stripped = Bun.stripANSI(output);
      expect(stripped).toContain("┌─ typescript");
      expect(stripped).toContain("└─");
      expect(stripped).toContain("const x: number = 1;");
    }
  });

  test("fenceFor widens past the longest backtick run already in the source", () => {
    expect(fenceFor("plain source, no backticks")).toBe("```");
    expect(fenceFor("has `one` backtick pair")).toBe("```");
    expect(fenceFor('has "```" a triple run')).toBe("````");
    expect(fenceFor('has "````" a quadruple run')).toBe("`````");
  });

  test("a source ``` run doesn't prematurely close the widened fence", () => {
    const source = 'const s = `` + "```" + `` ;\n';
    expect(fenceFor(source)).toBe("````");
    const output = renderFancy(source, "weird.js");
    const stripped = Bun.stripANSI(output);
    // Genuinely parsed as one fenced block (box border present), with the
    // source's own ``` surviving as literal code content on its one content
    // line -- not treated as a fence closer, and not left as raw unparsed
    // markdown source.
    expect(stripped).toContain("┌─ javascript");
    expect(stripped).toContain("└─");
    expect(stripped).toContain('│ const s = `` + "```" + `` ;');
    expect(stripped.split("\n")).not.toContain("````");
  });

  test("reads files relative to cwd and reports parser errors", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bunmsh-catfancy-"));
    try {
      await Bun.write(join(directory, "data.toml"), 'enabled = true\n');
      await Bun.write(join(directory, "bad.json"), "{");
      const good = await main(["catfancy", "data.toml"], directory);
      expect(good.status).toBe(0);
      expect(Bun.stripANSI(good.stdout)).toBe('{\n  "enabled": true\n}\n');
      const excluded = await main([
        "catfancy", "--exclude", "*.json", "bad.json", "data.toml",
      ], directory);
      expect(excluded.status).toBe(0);
      expect(Bun.stripANSI(excluded.stdout)).toBe('{\n  "enabled": true\n}\n');
      const bad = await main(["catfancy", "bad.json"], directory);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toContain("bunmsh: catfancy: bad.json:");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("colors JSON keys, strings, numbers, and constants", () => {
    const output = colorJson('{"key":"value","n":1,"ok":true}');
    expect((output.match(/\x1b\[38;2;/g) ?? []).length).toBeGreaterThanOrEqual(6);
    expect(Bun.stripANSI(output)).toBe('{"key":"value","n":1,"ok":true}');
  });
});
