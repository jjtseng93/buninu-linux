import { expect, test } from "bun:test";
import { controllingTerminalInputPath } from "../src/platform/terminal.js";

test("redirected stdin uses the platform controlling-terminal input device", () => {
  expect(controllingTerminalInputPath("win32")).toBe("CONIN$");
  expect(controllingTerminalInputPath("linux")).toBe("/dev/tty");
  expect(controllingTerminalInputPath("darwin")).toBe("/dev/tty");
});
