import { test, expect } from "bun:test";
import { syncFramebuffer, flush } from "../initramfs/lib/fbdev.js";
const display = () => ({ address: 0x10000, memoryLength: 4096, path: "/dev/fb0" });
test("unsupported framebuffer msync is probed once per mapping", () => {
  for (const code of [22, 95]) {
    const fb = display(); let calls = 0;
    const native = { msync(...args) { calls++; expect(args).toEqual([0x10000, 4096, 4]); return -1; }, errno: () => code };
    syncFramebuffer(fb, native); syncFramebuffer(fb, native);
    expect(calls).toBe(1);
    expect(fb.msyncUnsupported).toBe(true);
  }
});
test("supported sync continues every frame and retries EINTR", () => {
  const fb = display(); let calls = 0;
  const native = { msync() { return ++calls === 1 ? -1 : 0; }, errno: () => 4 };
  syncFramebuffer(fb, native); syncFramebuffer(fb, native);
  expect(calls).toBe(3);
  expect(fb.msyncUnsupported).toBeUndefined();
});
test("real mapping and I/O failures remain visible", () => {
  for (const code of [5, 12, 9]) {
    const fb = display();
    expect(() => syncFramebuffer(fb, {msync: () => -1, errno: () => code, strerror: () => `error ${code}`})).toThrow(`error ${code}`);
    expect(fb.msyncUnsupported).toBeUndefined();
  }
});
test("pixel writes continue on unsupported sync and respect framebuffer offsets and stride", () => {
  const fb = {...display(), msyncUnsupported: true, width: 2, height: 2, bytesPerPixel: 1,
    stride: 4, xOffset: 1, yOffset: 1, pixels: new Uint8Array([1,2,0,0,3,4,0,0]), memory: new Uint8Array(16)};
  flush(fb);
  expect([...fb.memory]).toEqual([0,0,0,0,0,1,2,0,0,3,4,0,0,0,0,0]);
  fb.pixels[0] = 9; flush(fb); expect(fb.memory[5]).toBe(9);
});
test("contiguous framebuffer writes preserve surrounding virtual rows", () => {
  const fb = {...display(), msyncUnsupported: true, width: 3, height: 2, bytesPerPixel: 4,
    stride: 12, xOffset: 0, yOffset: 1, pixels: Uint8Array.from({length:24},(_,i)=>i+1), memory: new Uint8Array(48).fill(90)};
  flush(fb);
  expect([...fb.memory]).toEqual([...new Uint8Array(12).fill(90),...fb.pixels,...new Uint8Array(12).fill(90)]);
  fb.yOffset=0;fb.pixels.fill(7);flush(fb);
  expect(fb.memory.subarray(0,24)).toEqual(fb.pixels);
  expect(fb.memory.subarray(36)).toEqual(new Uint8Array(12).fill(90));
});
