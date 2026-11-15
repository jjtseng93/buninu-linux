import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDu } from "../src/du.js";

// What holds on every system, Windows included: options combine, lines stream, sizes format.
const directory = mkdtempSync(join(tmpdir(), "bunmsh-du-unit-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
mkdirSync(join(directory, "a", "inner"), { recursive: true });
mkdirSync(join(directory, "b"));
writeFileSync(join(directory, "a", "inner", "f"), Buffer.alloc(3000));
writeFileSync(join(directory, "b", "g"), Buffer.alloc(1536));

test("combined short options read as GNU's: -sbhc and -shc", async () => {
  const bytes = await runDu(["du", "-sbhc", "a", "b"], { cwd: directory });
  expect(bytes).toEqual({ status: 0, stdout: "3.0K\ta\n1.5K\tb\n4.5K\ttotal\n", stderr: "" });
  const usage = await runDu(["du", "-shc", "a", "b"], { cwd: directory });
  expect(usage.stdout.trim().split("\n").map((line) => line.split("\t")[1])).toEqual(["a", "b", "total"]);
  expect(await runDu(["du", "-b", "-d1", "a"], { cwd: directory, platform: "linux" })).toMatchObject({ stdout: "3000\ta/inner\n3000\ta\n" });
});

test("the first line is written before the walk goes on to the next operand", async () => {
  const seen = [];
  const output = await runDu(["du", "-sb", "a", "b"], { cwd: directory, write: (text) => {
    // Removing b from inside the first write proves a's line went out before b was walked.
    if (!seen.length) rmSync(join(directory, "b"), { recursive: true });
    seen.push(text);
  } });
  expect(seen[0]).toBe("3000\ta\n");
  expect(output.stderr).toBe("bunmsh: du: cannot access 'b': No such file or directory\n");
  expect(output.status).toBe(1);
  mkdirSync(join(directory, "b"));
  writeFileSync(join(directory, "b", "g"), Buffer.alloc(1536));
});

test("human sizes round up, one decimal below 10, as GNU's human_ceiling", async () => {
  const sized = async (bytes, ...options) => {
    writeFileSync(join(directory, "sized"), Buffer.alloc(bytes));
    return (await runDu(["du", "-b", ...options, "sized"], { cwd: directory })).stdout.split("\t")[0];
  };
  expect(await sized(0, "-h")).toBe("0");
  expect(await sized(1023, "-h")).toBe("1023");
  expect(await sized(1024, "-h")).toBe("1.0K");
  expect(await sized(1025, "-h")).toBe("1.1K");
  expect(await sized(10239, "-h")).toBe("10K");
  expect(await sized(10241, "-h")).toBe("11K");
  expect(await sized(1048575, "-h")).toBe("1.0M");
  expect(await sized(1500, "--si")).toBe("1.5k");
});

test("Windows paths print with backslashes", async () => {
  const output = await runDu(["du", "-b", "a"], { cwd: directory, platform: "win32" });
  expect(output.stdout).toBe("3000\ta\\inner\n3000\ta\n");
});

test("exclude files resolve relative to the shell cwd", async () => {
  writeFileSync(join(directory, "exclude.txt"), "inner\n");
  expect(await runDu(["du", "-sb", "-X", "exclude.txt", "a"], { cwd: directory }))
    .toEqual({ status: 0, stdout: "0\ta\n", stderr: "" });
});

test.skipIf(process.platform === "win32")("count-links still stops ancestor symlink cycles", async () => {
  const root = join(directory, "cycle");
  mkdirSync(root);
  writeFileSync(join(root, "data"), "abc");
  mkdirSync(join(root, "child"));
  symlinkSync(root, join(root, "child", "loop"));
  const result = await runDu(["du", "-slbL", "cycle"], { cwd: directory });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("3\tcycle\n");
  expect(result.stderr).toContain("directory cycle");
});

test("the total ignores --threshold, as GNU prints it", async () => {
  expect(await runDu(["du", "-sb", "-t", "100000", "-c", "a"], { cwd: directory }))
    .toEqual({ status: 0, stdout: "3000\ttotal\n", stderr: "" });
});
