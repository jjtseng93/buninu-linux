import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const projectRoot = join(import.meta.dir, "..");

test("bundled help is byte-for-byte identical to README", async () => {
  const [readme, help] = await Promise.all([
    readFile(join(projectRoot, "README.md")),
    readFile(join(projectRoot, "runtime", "help", "help.md")),
  ]);

  expect(help.equals(readme)).toBe(true);
});
