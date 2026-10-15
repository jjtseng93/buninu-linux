import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { decodeImage } from '../initramfs/lib/bunterm/images.js';
const { KittyGraphicsParser } = createRequire(import.meta.url)('../initramfs/buninu/apps/jsgotty/gotty.js');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOc8AAAAASUVORK5CYII=', 'base64');
function parse(parser, control, payload = '') {
  const { events } = parser.consume(Buffer.from(`\x1b_G${control};${payload}\x1b\\`));
  return parser.parsePacket(events[0].packet, { row: 1, col: 1 });
}
async function checkDecode(image) {
  const decoded = {};
  let received;
  expect(await decodeImage({ MakeImageFromEncoded(bytes) { received = bytes; return decoded; } }, image)).toBe(decoded);
  // Identity verifies that rendering neither copies nor base64-roundtrips bytes.
  expect(received).toBe(image.data);
  expect(received.equals(png)).toBe(true);
}
test('binary parser assembles inline chunks and renderer consumes the same bytes', async () => {
  const parser = new KittyGraphicsParser({ binaryData: true });
  const encoded = png.toString('base64');
  expect(parse(parser, 'a=T,f=100,i=1,m=1', encoded.slice(0, 32))).toBeNull();
  const graphic = parse(parser, 'm=0', encoded.slice(32));
  await checkDecode(graphic.image);
  expect(parse(parser, 'a=p,i=1').image).toBe(graphic.image);
});
test('binary file transfer reads bytes without re-encoding; compressed inline also works', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bunterm-image-bytes-'));
  try {
    const path = join(dir, 'frame.png');
    writeFileSync(path, png);
    const parser = new KittyGraphicsParser({ binaryData: true });
    await checkDecode(parse(parser, 'a=T,t=f,f=100,i=1', Buffer.from(path).toString('base64')).image);
    await checkDecode(parse(parser, 'a=T,f=100,o=z,i=2', deflateSync(png).toString('base64')).image);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('default parser and legacy renderer callers retain base64 compatibility', async () => {
  const image = parse(new KittyGraphicsParser(), 'a=T,f=100,i=1', png.toString('base64')).image;
  expect(image.data).toBe(png.toString('base64'));
  let received;
  await decodeImage({ MakeImageFromEncoded(bytes) { received = bytes; return {}; } }, image);
  expect(received.equals(png)).toBe(true);
});
test('raw RGBA bytes pass directly to CanvasKit', async () => {
  const pixels = Buffer.from([1, 2, 3, 255]);
  const image = parse(new KittyGraphicsParser({ binaryData: true }), 'a=T,f=32,s=1,v=1,i=3', pixels.toString('base64')).image;
  let received;
  await decodeImage({ ColorType: { RGBA_8888: 1 }, AlphaType: { Unpremul: 1 }, ColorSpace: { SRGB: 1 },
    MakeImage(info, bytes, stride) { received = bytes; expect(stride).toBe(4); return {}; } }, image);
  expect(received).toBe(image.data);
  expect(received.equals(pixels)).toBe(true);
});
