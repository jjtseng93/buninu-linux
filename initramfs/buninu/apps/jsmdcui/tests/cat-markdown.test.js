import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tui = join(import.meta.dir, "..", "tui");
const bunBin = Bun.which("bun") || process.argv0;

test("cat renders .md files once with the implicit mdcui encoding", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-cat-"));
  const markdownPath = join(dir, "sample.md");
  await writeFile(markdownPath, "# Heading\n\n- one\n- two\n");

  try {
    const implicit = Bun.spawnSync([bunBin, tui, "-cat", markdownPath], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const explicit = Bun.spawnSync([bunBin, tui, "-cat", "-encoding", "mdcui", markdownPath], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(implicit.exitCode).toBe(0);
    expect(explicit.exitCode).toBe(0);
    expect(implicit.stdout.toString()).toBe(explicit.stdout.toString());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an explicit utf8 encoding overrides the .md mdcui default", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-cat-utf8-"));
  const markdownPath = join(dir, "sample.md");
  await writeFile(markdownPath, "# Heading\n\n```js front\nalert('kept')\n```\n");

  try {
    const result = Bun.spawnSync([bunBin, tui, "-cat", "-encoding", "utf8", markdownPath], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(Bun.stripANSI(result.stdout.toString())).toContain("alert('kept')");
    expect(existsSync(markdownPath + ".front.js")).toBe(false);
    expect(existsSync(markdownPath + ".html")).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--edit overrides the .md mdcui default with utf8", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-cat-edit-"));
  const markdownPath = join(dir, "sample.md");
  await writeFile(markdownPath, "# Heading\n\n```js front\nalert('editable')\n```\n");

  try {
    const edit = Bun.spawnSync([bunBin, tui, "-cat", "--edit", markdownPath], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const utf8 = Bun.spawnSync([bunBin, tui, "-cat", "-encoding", "utf8", markdownPath], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(edit.exitCode).toBe(0);
    expect(edit.stdout.toString()).toBe(utf8.stdout.toString());
    expect(Bun.stripANSI(edit.stdout.toString())).toContain("alert('editable')");
    expect(existsSync(markdownPath + ".front.js")).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--mdcui and --tui are equivalent to -encoding mdcui", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-cat-mdcui-"));
  const markdownPath = join(dir, "sample.md");
  await writeFile(markdownPath, "# Heading\n\n- one\n- two\n");

  try {
    const flag = Bun.spawnSync([bunBin, tui, "-cat", "--mdcui", markdownPath], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const encoding = Bun.spawnSync([bunBin, tui, "-cat", "-encoding", "mdcui", markdownPath], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const tuiFlag = Bun.spawnSync([bunBin, tui, "-cat", "--tui", markdownPath], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(flag.exitCode).toBe(0);
    expect(encoding.exitCode).toBe(0);
    expect(tuiFlag.exitCode).toBe(0);
    expect(flag.stdout.toString()).toBe(encoding.stdout.toString());
    expect(tuiFlag.stdout.toString()).toBe(encoding.stdout.toString());
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("-filetype forces syntax highlighting independently of the filename", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-cat-filetype-"));
  const textPath = join(dir, "sample.txt");
  await writeFile(textPath, "const answer = 42;\n");

  try {
    const automatic = Bun.spawnSync([bunBin, tui, "-cat", textPath], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const javascript = Bun.spawnSync([bunBin, tui, "-cat", "-filetype", "javascript", textPath], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(automatic.exitCode).toBe(0);
    expect(javascript.exitCode).toBe(0);
    expect(automatic.stdout.toString()).not.toContain("\x1b[");
    expect(javascript.stdout.toString()).toContain("\x1b[");
    expect(Bun.stripANSI(javascript.stdout.toString()).trimEnd()).toBe("const answer = 42;");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
