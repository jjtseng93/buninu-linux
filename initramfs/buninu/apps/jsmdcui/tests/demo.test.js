import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMarkdownInput } from "../runmd.mjs";

const tui = join(import.meta.dir, "..", "tui");
const indexEntry = join(import.meta.dir, "..", "src", "index.js");
const demosDirectory = join(import.meta.dir, "..", "demos");
const bunBin = Bun.which("bun") || process.argv0;

test("--help describes the non-overwriting demo behavior", () => {
  const result = Bun.spawnSync([bunBin, tui, "--help"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(0);
  const output = result.stdout.toString();
  expect(output).toContain("Execute an existing ./testapp.md");
  expect(output).toContain("Or write the bundled demo if missing");
  expect(output).toContain("--demo-<filename>");
  expect(output).toContain("--demo-reader");
  expect(output).toContain("Text-to-speech reader");
  expect(output).toContain("demos/<filename>.md");
  expect(output.match(/Open it in the TUI and write 5 generated files beside it/g)?.length).toBe(2);
  expect(output).not.toContain("Alias for --demo-image-processor");
  expect(output).toContain("--cdp-maze");
  expect(output).toContain("--remote-allow-origins=ORIGINS");
});

test("--demo-list lists root and automatically discovered demos", () => {
  const result = Bun.spawnSync([bunBin, tui, "--demo-list"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(0);
  const output = result.stdout.toString();
  expect(output).toMatch(/--demo\s+testapp\.md/);
  expect(output).toMatch(/--demo-image-processor\s+demos\/image-processor\.md/);
  expect(output).toMatch(/--demo-imgtool\s+demos\/imgtool\.md/);
  expect(output).toMatch(/--demo-imgtool-zh\s+demos\/imgtool-zh\.md/);
  expect(output).toContain("compact table-based modern image processor UI");
  expect(output).toContain("long-form document image processor UI");
  expect(output).toMatch(/--demo-select\s+demos\/select\.md/);
  expect(output).toMatch(/--demo-reader\s+demos\/reader\.md\s+— text-to-speech reader/);
  expect(output).toMatch(/--demo-todo-zh\s+demos\/todo-zh\.md/);
  expect(output).not.toContain("Compatibility aliases:");
});

test("--version lists every MDCUI build define", () => {
  const result = Bun.spawnSync([bunBin, tui, "--version"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(result.exitCode).toBe(0);
  const output = result.stdout.toString();
  expect(output).toContain("MDCUI_DEFAULT_EDIT:");
  expect(output).toContain("MDCUI_DEFAULT_DEMO:");
  expect(output).toContain("MDCUI_DEFAULT_DEMO_WUI:");
  expect(output).toContain("MDCUI_OVERWRITE_DEMO:");
  expect(output).toContain("global.MDCUI_MAIN:");
  expect(output).toContain("global.MDCUI_MAIN_BASE:");

  const presenceResult = Bun.spawnSync(
    [
      bunBin,
      "--define",
      "MDCUI_DEFAULT_DEMO_WUI=0",
      indexEntry,
      "--version",
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(presenceResult.exitCode).toBe(0);
  expect(presenceResult.stdout.toString()).toContain(
    "MDCUI_DEFAULT_DEMO_WUI: enabled",
  );
});

test("--demo names allow Chinese but reject whitespace", () => {
  const unicodeResult = Bun.spawnSync(
    [bunBin, tui, "--demo-不存在的程式", "-cat", "-encoding", "utf8"],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(unicodeResult.exitCode).toBe(2);
  expect(unicodeResult.stderr.toString()).toContain(
    "Unknown demo --demo-不存在的程式",
  );
  expect(unicodeResult.stderr.toString()).not.toContain("Invalid demo option");

  const whitespaceResult = Bun.spawnSync(
    [bunBin, tui, "--demo-中文 程式", "-cat", "-encoding", "utf8"],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(whitespaceResult.exitCode).toBe(2);
  expect(whitespaceResult.stderr.toString()).toContain("Invalid demo option");
  expect(whitespaceResult.stderr.toString()).toContain(
    "whitespace is not allowed",
  );
});

test("Unicode MDCUI_MAIN overwrite starts the embedded WUI server", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jsmdcui-main-unicode-"));
  const sourceDirectory = join(directory, "source");
  const workDirectory = join(directory, "work");
  const demoName = `中文工具-${crypto.randomUUID()}`;
  const markdownName = `${demoName}.md`;
  const sourcePath = join(sourceDirectory, markdownName);
  const workPath = join(workDirectory, markdownName);
  const bundledDemoPath = join(demosDirectory, markdownName);
  const preloadPath = join(directory, "mock-serve.mjs");
  const markdown = `# 中文工具

\`\`\`js front
export async function run() {
  return await rpc.answer();
}
\`\`\`

\`\`\`js back
import { helper } from "./helper.js";
export function answer() {
  return helper();
}
\`\`\`
`;

  try {
    await mkdir(sourceDirectory);
    await mkdir(workDirectory);
    await writeFile(sourcePath, markdown);
    await writeFile(
      join(sourceDirectory, "helper.js"),
      'export function helper() { return "ok"; }\n',
    );
    await writeFile(workPath, "# stale file with a different byte length\n");
    await writeFile(
      preloadPath,
      `Bun.serve = () => ({ port: 34567, stop() {} });\n`,
    );

    const result = Bun.spawnSync(
      [
        bunBin,
        "--preload",
        preloadPath,
        "--define",
        `global.MDCUI_MAIN=${JSON.stringify(sourcePath)}`,
        indexEntry,
        "--wui",
        `--demo-${demoName}`,
        "--overwrite-demo",
      ],
      {
        cwd: workDirectory,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    expect(result.exitCode).toBe(0);
    expect(await readFile(workPath, "utf8")).toBe(markdown);
    const stderr = Bun.stripANSI(result.stderr.toString());
    expect(stderr).toContain("[mdcui] Starting embedded WUI server:");
    expect(stderr).toContain(sourcePath);
    expect(stderr).not.toContain("Cannot find module");
  } finally {
    await rm(bundledDemoPath, { force: true });
    await rm(directory, { recursive: true, force: true });
  }
});

test("--export-cdp-maze writes and overwrites the bundled solver", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-export-cdp-maze-"));
  const outputPath = join(dir, "cdp-maze.js");
  try {
    await writeFile(outputPath, "old solver\n");
    const result = Bun.spawnSync([bunBin, tui, "--export-cdp-maze"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain(`Wrote ${outputPath}`);
    const exported = await readFile(outputPath, "utf8");
    expect(exported).toContain("export async function runCdpMaze");
    expect(exported).not.toContain("old solver");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--demo writes bundled testapp.md to cwd before opening it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-demo-"));
  try {
    const result = Bun.spawnSync([bunBin, tui, "--demo", "-cat", "-encoding", "utf8"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const written = await readFile(join(dir, "testapp.md"), "utf8");
    expect(written).toContain("計算機");
    expect(Bun.stripANSI(result.stdout.toString())).toContain("計算機");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--demo preserves an existing testapp.md", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-demo-existing-"));
  const existing = "# Keep my demo\n";
  try {
    await writeFile(join(dir, "testapp.md"), existing);
    const result = Bun.spawnSync([bunBin, tui, "--demo", "-cat", "-encoding", "utf8"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(await readFile(join(dir, "testapp.md"), "utf8")).toBe(existing);
    expect(Bun.stripANSI(result.stdout.toString())).toContain("Keep my demo");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--overwrite-demo replaces an existing demo with the bundled copy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-demo-overwrite-"));
  const existing = "# Replace my demo\n";
  try {
    await writeFile(join(dir, "testapp.md"), existing);
    const result = Bun.spawnSync(
      [bunBin, tui, "--overwrite-demo", "--demo", "-cat", "-encoding", "utf8"],
      {
        cwd: dir,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    expect(result.exitCode).toBe(0);
    const written = await readFile(join(dir, "testapp.md"), "utf8");
    expect(written).toContain("計算機");
    expect(written).not.toBe(existing);
    expect(Bun.stripANSI(result.stdout.toString())).toContain("計算機");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("WUI demo loading can overwrite an existing testapp.md", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-wui-demo-overwrite-"));
  const demoPath = join(dir, "testapp.md");
  try {
    await writeFile(demoPath, "# Replace my WUI demo\n");
    const source = await readMarkdownInput(demoPath, true);

    expect(source).toContain("計算機");
    expect(await readFile(demoPath, "utf8")).toBe(source);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--demo-<filename> automatically loads a matching demos file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-demo-generic-"));
  try {
    const result = Bun.spawnSync([bunBin, tui, "--demo-todo", "-cat", "-encoding", "utf8"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const written = await readFile(join(dir, "todo.md"), "utf8");
    expect(written).toContain("# Todo List");
    expect(written).toContain("javascript:addTodo()");
    expect(Bun.stripANSI(result.stdout.toString())).toContain("Show Completed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--cdp-maze loads the maze demo", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-cdp-maze-"));
  try {
    const result = Bun.spawnSync([bunBin, tui, "--cdp-maze", "-cat", "-encoding", "utf8"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const written = await readFile(join(dir, "maze.md"), "utf8");
    expect(written).toContain("Put the cursor here");
    expect(Bun.stripANSI(result.stdout.toString())).toContain("Put the cursor here");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--demo-<filename> preserves an existing local copy", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-demo-generic-existing-"));
  const existing = "# Keep my selector demo\n";
  try {
    await writeFile(join(dir, "select.md"), existing);
    const result = Bun.spawnSync([bunBin, tui, "--demo-select", "-cat", "-encoding", "utf8"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(await readFile(join(dir, "select.md"), "utf8")).toBe(existing);
    expect(Bun.stripANSI(result.stdout.toString())).toContain("Keep my selector demo");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unknown --demo-<filename> reports an error without creating a file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-demo-unknown-"));
  try {
    const result = Bun.spawnSync([bunBin, tui, "--demo-does-not-exist", "-cat", "-encoding", "utf8"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr.toString()).toContain("Unknown demo --demo-does-not-exist");
    expect(await Bun.file(join(dir, "does-not-exist.md")).exists()).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--demo-image-processor works through generic demo discovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-imgtool-generic-"));
  try {
    const result = Bun.spawnSync([bunBin, tui, "--demo-image-processor", "-cat", "-encoding", "utf8"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(await readFile(join(dir, "image-processor.md"), "utf8")).toContain("# Bun.Image Processor");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--demo-imgtool uses generic discovery for the table image processor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-imgtool-"));
  try {
    const result = Bun.spawnSync([bunBin, tui, "--demo-imgtool", "-cat", "-encoding", "utf8"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const written = await readFile(join(dir, "imgtool.md"), "utf8");
    expect(written).toContain("# Bun.Image Processor");
    expect(written).toContain("javascript:readMetadata()");
    expect(written).toContain("optionText('common-options'");
    expect(written).toContain("cell.val(!cell.val())");
    expect(Bun.stripANSI(result.stdout.toString())).toContain("Bun.Image Processor");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--demo-imgtool preserves an existing imgtool.md", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-imgtool-existing-"));
  const existing = "# Keep my image tool\n";
  try {
    await writeFile(join(dir, "imgtool.md"), existing);
    const result = Bun.spawnSync([bunBin, tui, "--demo-imgtool", "-cat", "-encoding", "utf8"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(await readFile(join(dir, "imgtool.md"), "utf8")).toBe(existing);
    expect(Bun.stripANSI(result.stdout.toString())).toContain("Keep my image tool");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--demo-imgtool-zh uses generic discovery for the table image processor", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-imgtool-zh-"));
  try {
    const result = Bun.spawnSync([bunBin, tui, "--demo-imgtool-zh", "-cat", "-encoding", "utf8"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    const written = await readFile(join(dir, "imgtool-zh.md"), "utf8");
    expect(written).toContain("先把本機圖片路徑貼到下方");
    expect(written).toContain("javascript:readMetadata()");
    expect(written).toContain("optionText('常用選項'");
    expect(written).toContain("cell.val(!cell.val())");
    expect(Bun.stripANSI(result.stdout.toString())).toContain("先把本機圖片路徑貼到下方");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--demo-imgtool-zh preserves an existing imgtool-zh.md", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsmdcui-imgtool-zh-existing-"));
  const existing = "# 保留我的圖片工具\n";
  try {
    await writeFile(join(dir, "imgtool-zh.md"), existing);
    const result = Bun.spawnSync([bunBin, tui, "--demo-imgtool-zh", "-cat", "-encoding", "utf8"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(await readFile(join(dir, "imgtool-zh.md"), "utf8")).toBe(existing);
    expect(Bun.stripANSI(result.stdout.toString())).toContain("保留我的圖片工具");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
