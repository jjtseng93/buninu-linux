import { expect, test } from "bun:test";
import { memoryText } from "../initramfs/lib/top-memory.js";

test("used follows MemAvailable rather than subtracting all cache", () => {
  expect(memoryText({ MemTotal: 1024000, MemFree: 102400, MemAvailable: 307200,
    Buffers: 10240, Cached: 512000, SReclaimable: 20480 }))
    .toBe("MiB Mem : 1000.0 total, 100.0 free, 700.0 used, 530.0 buff/cache, 300.0 available");
});

test("zero available is a real value, not a missing field", () => {
  expect(memoryText({ MemTotal: 1024000, MemFree: 102400, MemAvailable: 0 }))
    .toContain("1000.0 used, 0.0 buff/cache, 0.0 available");
});

test("missing available uses free conservatively and labels available n/a", () => {
  expect(memoryText({ MemTotal: 1024000, MemFree: 102400, Cached: 512000 }))
    .toContain("900.0 used, 500.0 buff/cache, n/a available");
  expect(memoryText({})).toBe("MiB Mem : 0.0 total, 0.0 free, 0.0 used, 0.0 buff/cache, n/a available");
});

test("used cannot become negative with an inconsistent snapshot", () => {
  expect(memoryText({ MemTotal: 1024, MemAvailable: 2048 })).toContain("0.0 used");
});
