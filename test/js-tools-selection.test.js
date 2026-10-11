import { expect, test } from "bun:test";
import { jsToolsEnabled } from "../scripts/js-tools.js";

test("JS tools default on and only explicit 0/off/false disable them", () => {
  for (const value of [null, "", "1", "on", "true", "yes", "no", "2", " "])
    expect(jsToolsEnabled(value)).toBe(true);
  for (const value of ["0", "off", "false", "OFF", "False", " false ", "\t0\n"])
    expect(jsToolsEnabled(value)).toBe(false);
  const previous = process.env.BUNINU_JS_TOOLS;
  try {
    delete process.env.BUNINU_JS_TOOLS;
    expect(jsToolsEnabled()).toBe(true);
    process.env.BUNINU_JS_TOOLS = "off";
    expect(jsToolsEnabled()).toBe(false);
  } finally {
    if (previous === undefined) delete process.env.BUNINU_JS_TOOLS;
    else process.env.BUNINU_JS_TOOLS = previous;
  }
});
