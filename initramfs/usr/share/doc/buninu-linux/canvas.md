# canvas — CanvasKit (Skia) on the Linux framebuffer

`/lib/canvas.js` runs Skia, compiled to WebAssembly as CanvasKit, on top of
`/lib/fbdev.js`. Skia rasterizes straight into a buffer that already has the
framebuffer's pixel layout, so a frame reaches `/dev/fb0` with one `memcpy`
and no per-pixel conversion in JavaScript.

## Drawing with Skia

```js
import { runGraphics } from "/lib/fbdev.js";
import { loadCanvasKit, openCanvas, loadFontSet } from "/lib/canvas.js";

const CanvasKit = await loadCanvasKit();
const fonts = loadFontSet(CanvasKit, "ui");

await runGraphics(async (display, { onRestore }) => {
  const screen = openCanvas(CanvasKit, display);
  const paint = new CanvasKit.Paint();
  paint.setAntiAlias(true);
  paint.setColor(CanvasKit.Color(64, 200, 255));
  const font = new CanvasKit.Font(fonts.regular, 32);

  screen.canvas.clear(CanvasKit.BLACK);
  screen.canvas.drawCircle(display.width / 2, display.height / 2, 120, paint);
  screen.canvas.drawText("Buninu 你好 😀", 40, 60, paint, font);
  screen.flush();

  await new Promise((resolve) => setTimeout(resolve, 3000));
  screen.close();
});
```

`screen.canvas` is a Skia `Canvas` with the full CanvasKit API: paths,
gradients, shaders, image filters, `drawImage`, `drawGlyphs`, `Paragraph`
layout with font fallback, PNG/JPEG decoding, and so on.

## Exports

| Export | Purpose |
| --- | --- |
| `loadCanvasKit()` | Loads `/lib/canvaskit/canvaskit.wasm` once per process and resolves to the `CanvasKit` object. The wasm heap starts at 128 MiB. |
| `openCanvas(CanvasKit, display)` | Binds a raster surface to an open `Framebuffer`. Returns `{ canvas, surface, width, height, colorType, flush(), close() }`. While open, `display.pixels` is the surface's own memory, so `drawLine()`, `fillPolygon()` and `flush()` from `fbdev.js` keep working on the same frame. `close()` hands the last frame back to the JavaScript buffer. |
| `pickColorType(CanvasKit, display)` | The Skia `ColorType` matching the framebuffer: `BGRA_8888` for the usual 32-bit XRGB (efifb, simpledrm), `RGBA_8888`, `RGB_565`; `null` for anything else, which `openCanvas` rejects. |
| `loadFontSet(CanvasKit, name)` | A font set from `/usr/share/fonts/fonts.json` (`"terminal"` or `"ui"`) as `{ regular, bold, fallback, typefaces, fontMgr, families, delete() }`. `fontMgr` and `families` are what `ParagraphStyle` wants; a collection such as Noto Sans CJK registers every face and yields its preferred one (TC). |
| `fontCatalogue()`, `fontPath(name)`, `loadFontData(name)` | The parsed `fonts.json`, a font's path, and its bytes (cached). |

## Formats

The framebuffer reports its channels as bit offsets. Skia can rasterize
directly into three of the layouts Linux uses:

| Framebuffer | Skia |
| --- | --- |
| 32 bpp, red@16 green@8 blue@0 (XRGB8888) | `BGRA_8888` |
| 32 bpp, red@0 green@8 blue@16 (XBGR8888) | `RGBA_8888` |
| 16 bpp, 5-6-5 | `RGB_565` |

For a 24 bpp or paletted framebuffer, draw with the HTML canvas emulation
instead and copy through `blitImageData()`:

```js
const canvas = CanvasKit.MakeCanvas(display.width, display.height);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#40c8ff";
ctx.fillRect(0, 0, 200, 100);
blitImageData(display, ctx.getImageData(0, 0, display.width, display.height));
flush(display);
```

That path converts every pixel in JavaScript and is fine for static screens.

## Fonts

`/usr/share/fonts/fonts.json` lists the bundled files and two sets:

| Set | Regular | Fallback order |
| --- | --- | --- |
| `terminal` | DejaVu Sans Mono (+ Bold) | Noto Color Emoji, Noto Color Emoji Flags, Noto Sans CJK, Noto Sans Symbols, Noto Sans Symbols2 |
| `ui` | Roboto | Noto Sans CJK, Noto Color Emoji, Noto Color Emoji Flags, Noto Sans Symbols, Noto Sans Symbols2 |

Files load on first use and are copied into the wasm heap; the CJK
collection is 32 MiB, so a program that never draws CJK text should not
load a set containing it. Each file's license sits beside it.

## See also

- `/lib/canvas.js`, `/lib/canvaskit/` (CanvasKit 0.41.1, BSD-3-Clause)
- `/lib/fbdev.js` — `fbdev.md`
- `/lib/bunterm/` — the terminal built on this (`bunterm.md`)
- CanvasKit API: https://skia.org/docs/user/modules/canvaskit/
