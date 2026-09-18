import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  convertWuiTableCheckboxes,
  readMarkdownInput,
  writeRuntimeFiles,
} from "../runmd.mjs";

const indexEntry = join(import.meta.dir, "..", "src", "index.js");
const bunBin = Bun.which("bun") || process.argv0;

test("WUI table cell prefixes become interactive checkbox inputs", () => {
  const html =
    "<table><tr><th> [ ] Header</th><td>[x] checked</td>"
    + "<td>text [ ] unchanged</td><td>[X] upper</td></tr></table>";
  expect(convertWuiTableCheckboxes(html)).toBe(
    '<table contenteditable="true"><tr><th> <input type="checkbox"> Header</th>'
    + '<td><input type="checkbox" checked> checked</td>'
    + "<td>text [ ] unchanged</td>"
    + '<td><input type="checkbox" checked> upper</td></tr></table>',
  );
});

test("WUI tables become editable once without changing outside HTML cells", () => {
  const html =
    '<td>outside</td><table><tr><td class="value">inside</td>'
    + '<th contenteditable="false">fixed</th></tr></table>';
  expect(convertWuiTableCheckboxes(html)).toBe(
    '<td>outside</td><table contenteditable="true"><tr>'
    + '<td class="value">inside</td>'
    + '<th contenteditable="false">fixed</th></tr></table>',
  );
  expect(convertWuiTableCheckboxes(
    '<table contenteditable="false"><tr><td>fixed</td></tr></table>',
  )).toBe(
    '<table contenteditable="false"><tr><td>fixed</td></tr></table>',
  );
});

test("WUI writes the bundled testapp.md when it is missing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-wui-"));
  const mdpath = join(dir, "testapp.md");
  try {
    const source = await readMarkdownInput(mdpath);
    expect(source).toContain("# jsmdcui");
    expect(await readFile(mdpath, "utf8")).toBe(source);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("WUI preserves an existing testapp.md", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-wui-existing-"));
  const mdpath = join(dir, "testapp.md");
  const existing = "# Keep my WUI demo\n";
  try {
    await writeFile(mdpath, existing);
    expect(await readMarkdownInput(mdpath)).toBe(existing);
    expect(await readFile(mdpath, "utf8")).toBe(existing);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generated WUI server falls back to a system port when 3000 is occupied", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-wui-port-"));
  const mdpath = join(dir, "app.md");
  try {
    await writeRuntimeFiles(mdpath);
    const source = await readFile(`${mdpath}-server.js`, "utf8");
    expect(source).toContain('error?.code === "EADDRINUSE"');
    expect(source).toContain('serverOptions.port !== 3000 || !addressInUse');
    expect(source).toContain('Bun.serve({ ...serverOptions, port: 0 })');
    expect(source).toContain('localhost:${server.port}');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("WUI reports an external server before starting it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-wui-source-report-"));
  const mdpath = join(dir, "external.md");
  const preloadPath = join(dir, "mock-serve.mjs");
  try {
    await writeFile(mdpath, "# External WUI\n");
    await writeFile(
      preloadPath,
      `Bun.serve = () => ({ port: 34567, stop() {} });\n`,
    );
    const result = Bun.spawnSync(
      [bunBin, "--preload", preloadPath, indexEntry, "--wui", mdpath],
      {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    expect(result.exitCode).toBe(0);
    const stderr = Bun.stripANSI(result.stderr.toString());
    expect(stderr).toContain("[mdcui] Starting external WUI server:");
    expect(stderr).toContain(`${mdpath}-server.js`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
