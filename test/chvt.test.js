import { test, expect } from "bun:test";
import { parseChvt, switchVt } from "../initramfs/lib/chvt.js";

test("chvt accepts VT numbers and help, rejects invalid input before opening devices", async () => {
  expect(parseChvt(["2"])).toEqual({ number: 2 });
  expect(parseChvt(["63"])).toEqual({ number: 63 });
  for (const flag of ["-h", "--help"]) expect(parseChvt([flag]).help).toBe(true);
  for (const args of [[], ["0"], ["64"], ["-1"], ["2x"], ["1", "2"]]) expect(() => parseChvt(args)).toThrow();
  await expect(switchVt(0, {})).rejects.toThrow();
});

test("chvt skips PTY/non-VT consoles, activates only a validated VT and closes descriptors", async () => {
  const events = [];
  await switchVt(2, {
    openConsole([path]) {
      events.push(path);
      if (path === "/dev/tty0") throw Error("missing");
      return { path, close: () => events.push(`close ${path}`) };
    },
    activeConsole(device) { if (device.path === "/dev/tty") throw Error("not a VT"); },
    activateConsole(device, number) { events.push(`activate ${device.path} ${number}`); },
  });
  expect(events).toEqual(["/dev/tty0", "/dev/tty", "close /dev/tty", "/dev/console", "activate /dev/console 2", "close /dev/console"]);
});

test("chvt closes console on failed switch without overriding VT owner or trying another switch", async () => {
  let closed = 0, opened = 0;
  await expect(switchVt(1, {
    openConsole() { opened++; return { close() { closed++; } }; },
    activeConsole() { return 2; },
    activateConsole() { throw Error("switch denied"); },
  })).rejects.toThrow("switch denied");
  expect(opened).toBe(1);
  expect(closed).toBe(1);
});

test("chvt CLI help and invalid arguments work without a Linux console", () => {
  for (const flag of ["-h", "--help"]) {
    const result = Bun.spawnSync([process.execPath, "initramfs/bin/chvt", flag]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("bunterm");
  }
  const invalid = Bun.spawnSync([process.execPath, "initramfs/bin/chvt", "0"]);
  expect(invalid.exitCode).toBe(1);
  expect(invalid.stderr.toString()).toContain("usage:");
});
