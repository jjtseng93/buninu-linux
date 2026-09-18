import { expect, test } from "bun:test";
import { kittyModeFromEnvironment } from "../src/cui/kitty-mode.mjs";

test("Kitty mode accepts supported environment values case-insensitively", () => {
  expect(kittyModeFromEnvironment("compat")).toBe("compat");
  expect(kittyModeFromEnvironment(" EXTENDED ")).toBe("extended");
  expect(kittyModeFromEnvironment("off")).toBe("off");
});

test("Kitty mode defaults invalid or missing environment values to off", () => {
  expect(kittyModeFromEnvironment()).toBe("off");
  expect(kittyModeFromEnvironment("yes")).toBe("off");
  expect(kittyModeFromEnvironment("")).toBe("off");
});
