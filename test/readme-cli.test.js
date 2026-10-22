import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../index.js", import.meta.url));

for (const [flag, filename] of [
  ["--readme", "README.md"],
  ["--readme-zh", "README.zh.md"],
  ["--docs", "README.zh.md"],
]) {
  test(`${flag} flushes the complete document to a pipe before exiting`, async () => {
    const markdown = await Bun.file(new URL(`../${filename}`, import.meta.url)).text();
    const rendered = Bun.markdown.ansi(markdown, { hyperlinks: true });
    const expected = rendered.endsWith("\n") ? rendered : `${rendered}\n`;
    // Both real documents exceed the pipe chunk that was previously truncated.
    expect(Buffer.byteLength(expected)).toBeGreaterThan(65536);
    const child = Bun.spawn([process.execPath, entry, flag], {
      stdout: "pipe", stderr: "pipe",
    });
    const [output, errors, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(status).toBe(0);
    expect(errors).toBe("");
    expect(output).toBe(expected);
  });
}
