import { expect, test } from "bun:test";
import { runBytes } from "../src/platform/commands.js";

test("runBytes terminates a child process at its hard timeout", async () => {
  const started = performance.now();
  const result = await runBytes(
    [
      process.execPath,
      "-e",
      "setInterval(() => {}, 1000)",
    ],
    { allowFailure: true, timeout: 20 },
  );

  expect(result.ok).toBe(false);
  expect(result.stderr).toContain("timed out");
  expect(performance.now() - started).toBeLessThan(1000);
});
