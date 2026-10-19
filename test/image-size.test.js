import { test, expect } from "bun:test";
import { imageBytes } from "../scripts/build.js";
import { layout } from "../initramfs/lib/fat.js";
const MiB = 1024 * 1024;
test("image sizing preserves small images and fits GPU firmware payloads plus FAT metadata", () => {
  expect(imageBytes(80 * MiB)).toBe(128 * MiB);
  // Actual no-gpu EFI: the former 16 MiB reserve incorrectly made this 192 MiB.
  expect(imageBytes(113646592)).toBe(128 * MiB);
  expect(imageBytes(266 * MiB)).toBe(320 * MiB);
  for (const payload of [0, 100 * MiB, 120 * MiB, 240 * MiB, 266 * MiB, 512 * MiB, 0xffffffff]) {
    const size = imageBytes(payload);
    const geometry = layout(size / 512 - 34 - 2048 + 1);
    expect((geometry.clusters - 3) * geometry.perCluster * 512).toBeGreaterThan(payload);
    expect(size % (64 * MiB)).toBe(0);
  }
  expect(() => imageBytes(0x100000000)).toThrow("FAT32");
});
