import {rawImageData, rawImageOpaque, skiaImage} from './raw-image.js';
// /lib/canvas.js — CanvasKit (Skia in WebAssembly) on the Linux framebuffer.
//
// Skia draws into a buffer inside the wasm heap that already has the
// framebuffer's own pixel layout, so a frame reaches /dev/fb0 with a single
// copy: exactly what /lib/fbdev.js does with its JavaScript back buffer. The
// Framebuffer's `pixels` view is pointed at that heap buffer while a canvas is
// open, so the fbdev.js drawing calls and flush() keep working on the same
// frame and Skia and JavaScript drawing can be mixed freely.

import { readFileSync } from "node:fs";
import CanvasKitInit from "./canvaskit/canvaskit.js";
import { flush as flushFramebuffer } from "./fbdev.js";

export const canvasKitDirectory = `${import.meta.dir}/canvaskit`;
export const fontDirectory = `${import.meta.dir}/../usr/share/fonts`;

let canvasKitPromise = null;

// One CanvasKit instance per process; the wasm heap starts at 128 MiB.
export const loadCanvasKit = () => {
  canvasKitPromise ??= CanvasKitInit({
    wasmBinary: readFileSync(`${canvasKitDirectory}/canvaskit.wasm`),
  });
  return canvasKitPromise;
};

const fieldIs = (field, offset, length) =>
  field.offset === offset && field.length === length;

// Maps the kernel's bitfield description to a Skia ColorType with the same
// byte order in memory. The fields are little-endian bit offsets, so 32-bit
// red@16 green@8 blue@0 is B,G,R,X in memory: Skia's BGRA_8888. Only formats
// Skia can rasterize into directly are accepted; others must go through
// blitImageData() in fbdev.js.
export const pickColorType = (CanvasKit, display) => {
  const { red, green, blue } = display.fields;
  if (display.bitsPerPixel === 32) {
    if (fieldIs(red, 16, 8) && fieldIs(green, 8, 8) && fieldIs(blue, 0, 8)) {
      return CanvasKit.ColorType.BGRA_8888;
    }
    if (fieldIs(red, 0, 8) && fieldIs(green, 8, 8) && fieldIs(blue, 16, 8)) {
      return CanvasKit.ColorType.RGBA_8888;
    }
  }
  if (display.bitsPerPixel === 16
      && fieldIs(red, 11, 5) && fieldIs(green, 5, 6) && fieldIs(blue, 0, 5)) {
    return CanvasKit.ColorType.RGB_565;
  }
  return null;
};

const describeFields = ({ red, green, blue }) =>
  `red@${red.offset}/${red.length} green@${green.offset}/${green.length} blue@${blue.offset}/${blue.length}`;

// Binds a Skia raster surface to an open Framebuffer. `display` only needs
// the fields fbdev.js's Framebuffer exposes (width, height, stride,
// bitsPerPixel, fields, pixels), so a plain object backed by memory works for
// tests and off-screen rendering.
export const openCanvas = (CanvasKit, display) => {
  const colorType = pickColorType(CanvasKit, display);
  if (colorType === null) {
    throw new Error(`no Skia color type for a ${display.bitsPerPixel} bpp framebuffer `
      + `(${describeFields(display.fields)}); use blitImageData() instead`);
  }
  const length = display.stride * display.height;
  const memory = CanvasKit.Malloc(Uint8Array, length);
  const surface = CanvasKit.MakeRasterDirectSurface({
    width: display.width,
    height: display.height,
    colorType,
    alphaType: CanvasKit.AlphaType.Opaque,
    colorSpace: CanvasKit.ColorSpace.SRGB,
  }, memory, display.stride);
  if (!surface) {
    CanvasKit.Free(memory);
    throw new Error("MakeRasterDirectSurface failed");
  }
  const previousPixels = display.pixels;
  // Start from whatever the JavaScript back buffer held (usually zeros).
  memory.toTypedArray().set(previousPixels.subarray(0, length));
  display.pixels = memory.toTypedArray();
  let open = true;
  let cachedImage = null, cachedOpaque = false;
  let imageMemory = null, imageCapacity = 0;
  const directRaw = (image, rect, source) => {
    const raw = rawImageData(image);
    if (!raw || display.bitsPerPixel !== 32 || raw.colorType !== colorType) return null;
    const [left, top, right, bottom] = rect, [sx, sy, ex, ey] = source;
    if (![...rect, ...source].every(Number.isInteger)
        || right - left !== ex - sx || bottom - top !== ey - sy
        || sx < 0 || sy < 0 || ex > raw.width || ey > raw.height || ex <= sx || ey <= sy) return null;
    return rawImageOpaque(raw) ? raw : null;
  };
  return {
    CanvasKit,
    display,
    surface,
    canvas: surface.getCanvas(),
    colorType,
    width: display.width,
    height: display.height,
    // Only exact, opaque 32-bit copies bypass Skia. Keep at most one decoded
    // image (32 MiB); scaled, translucent and 16-bit images use normal drawing.
    canDrawRawImage(image, rect, source) { return Boolean(directRaw(image, rect, source)); },
    drawOpaqueImage(image, rect, source, bands) {
      if (!open) throw new Error("canvas is closed");
      const [left, top, right, bottom] = rect;
      const [sx, sy, ex, ey] = source;
      const width = image.width(), height = image.height();
      if (display.bitsPerPixel !== 32 || ![...rect, ...source].every(Number.isInteger)
          || right - left !== ex - sx || bottom - top !== ey - sy
          || sx < 0 || sy < 0 || ex > width || ey > height
          || ex <= sx || ey <= sy || width * height * 4 > 32 * 1024 * 1024) return false;
      const raw = directRaw(image, rect, source);
      if (!raw) image = skiaImage(image);
      if (!raw && cachedImage !== image) {
        cachedImage = image;
        cachedOpaque = false;
        const size = width * height * 4;
        if (size > imageCapacity) {
          if (imageMemory) CanvasKit.Free(imageMemory);
          imageMemory = CanvasKit.Malloc(Uint8Array, size);
          imageCapacity = size;
        }
        // Supplying a destination bypasses CanvasKit's JS return-type switch,
        // which otherwise rejects BGRA and copies supported formats out of WASM.
        const info = {width, height, colorType,
          alphaType: CanvasKit.AlphaType.Unpremul, colorSpace: CanvasKit.ColorSpace.SRGB};
        let pixels = image.readPixels(0, 0, info, imageMemory, width * 4);
        let swap = false;
        if (!pixels && colorType === CanvasKit.ColorType.BGRA_8888) {
          pixels = image.readPixels(0, 0, {...info, colorType: CanvasKit.ColorType.RGBA_8888}, imageMemory, width * 4);
          swap = true;
        }
        if (pixels) {
          cachedOpaque = true;
          for (let i = 0; i < size; i += 4) {
            if (pixels[i + 3] !== 255) { cachedOpaque = false; break; }
            if (swap) {
              const red = pixels[i]; pixels[i] = pixels[i + 2]; pixels[i + 2] = red;
            }
          }
        }
      }
      if (!raw && !cachedOpaque) return false;
      surface.flush();
      // Drawing elsewhere can grow the WASM heap between cache hits.
      const sourcePixels = raw ? raw.pixels : imageMemory.toTypedArray();
      const target = memory.toTypedArray();
      const x0 = Math.max(0, left), x1 = Math.min(display.width, right);
      if (x1 <= x0) return true;
      for (const [bandTop, bandBottom] of bands) {
        const y0 = Math.max(0, top, bandTop), y1 = Math.min(display.height, bottom, bandBottom);
        for (let y = y0; y < y1; y++) {
          const offset = ((sy + y - top) * width + sx + x0 - left) * 4;
          target.set(sourcePixels.subarray(offset, offset + (x1 - x0) * 4), y * display.stride + x0 * 4);
        }
      }
      return true;
    },
    // Save/restore small overlays in native pixel format, without decoding or
    // channel conversion. Refresh the WASM view after every possible allocation.
    saveRegion(left, top, right, bottom) {
      if (!open) throw new Error("canvas is closed");
      surface.flush();
      const x = Math.max(0, Math.min(display.width, Math.floor(left))), y = Math.max(0, Math.min(display.height, Math.floor(top)));
      const width = Math.max(0, Math.min(display.width, Math.ceil(right)) - x);
      const height = Math.max(0, Math.min(display.height, Math.ceil(bottom)) - y);
      const rowBytes = width * (display.bitsPerPixel / 8);
      const pixels = new Uint8Array(rowBytes * height), source = memory.toTypedArray();
      for (let row = 0; row < height; row++) {
        const offset = (y + row) * display.stride + x * (display.bitsPerPixel / 8);
        pixels.set(source.subarray(offset, offset + rowBytes), row * rowBytes);
      }
      return {x, y, height, rowBytes, pixels};
    },
    restoreRegion(region) {
      if (!open) throw new Error("canvas is closed");
      surface.flush();
      const target = memory.toTypedArray();
      for (let row = 0; row < region.height; row++) {
        target.set(region.pixels.subarray(row * region.rowBytes, (row + 1) * region.rowBytes),
          (region.y + row) * display.stride + region.x * (display.bitsPerPixel / 8));
      }
    },
    // Finishes pending Skia work and copies the frame to the framebuffer.
    // toTypedArray() is re-read because wasm heap growth detaches old views.
    flush() {
      if (!open) throw new Error("canvas is closed");
      surface.flush();
      display.pixels = memory.toTypedArray();
      flushFramebuffer(display);
    },
    // Releases the Skia surface and heap buffer; the Framebuffer stays open
    // and gets its own back buffer back, holding the last frame.
    close() {
      if (!open) return;
      open = false;
      cachedImage = null; cachedOpaque = false;
      if (imageMemory) CanvasKit.Free(imageMemory);
      imageMemory = null; imageCapacity = 0;
      previousPixels.set(memory.toTypedArray().subarray(0, previousPixels.length));
      display.pixels = previousPixels;
      surface.delete();
      CanvasKit.Free(memory);
    },
  };
};

// Font catalogue: /usr/share/fonts/fonts.json names every bundled file and
// the family sets built from them. Files load lazily, since the CJK
// collection alone is 32 MiB and is copied into the wasm heap.
let catalogue = null;

export const fontCatalogue = () => {
  catalogue ??= JSON.parse(readFileSync(`${fontDirectory}/fonts.json`, "utf8"));
  return catalogue;
};

export const fontPath = (name) => {
  const entry = fontCatalogue().fonts[name];
  if (!entry) throw new Error(`unknown font ${JSON.stringify(name)}`);
  return `${fontDirectory}/${entry.file}`;
};

const fontData = new Map();

export const loadFontData = (name) => {
  let data = fontData.get(name);
  if (!data) {
    const bytes = readFileSync(fontPath(name));
    data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    fontData.set(name, data);
  }
  return data;
};

// A named font set from fonts.json as CanvasKit objects:
//   typefaces  the "regular", "bold" and each fallback font as a Typeface
//              (a collection such as Noto Sans CJK yields its preferred face)
//   fontMgr    every file of the set registered by family name, for the
//              Paragraph API; a collection registers all of its families
//   families   family names for ParagraphStyle.textStyle.fontFamilies, in
//              lookup order
export const loadFontSet = (CanvasKit, setName = "terminal") => {
  const { sets, fonts } = fontCatalogue();
  const set = sets[setName];
  if (!set) throw new Error(`unknown font set ${JSON.stringify(setName)}`);
  const names = [set.regular, set.bold, ...(set.fallback ?? [])].filter(Boolean);
  const buffers = names.map(loadFontData);
  const fontMgr = CanvasKit.FontMgr.FromData(...buffers);
  if (!fontMgr) throw new Error("FontMgr.FromData failed");
  const typefaces = {};
  names.forEach((name, index) => {
    // A collection's "preferred" family picks the face (Noto Sans CJK TC for
    // Taiwanese glyph forms); a single-face file loads directly.
    const preferred = fonts[name].preferred;
    const typeface = preferred
      ? fontMgr.matchFamilyStyle(preferred, {})
      : CanvasKit.Typeface.MakeFreeTypeFaceFromData(buffers[index]);
    if (!typeface) throw new Error(`cannot load font ${name} (${fonts[name].file})`);
    typefaces[name] = typeface;
  });
  const families = names.flatMap((name) => fonts[name].families ?? [name]);
  return {
    set,
    names,
    typefaces,
    regular: typefaces[set.regular],
    bold: set.bold ? typefaces[set.bold] : null,
    fallback: (set.fallback ?? []).map((name) => typefaces[name]),
    fontMgr,
    families,
    delete() {
      for (const typeface of Object.values(typefaces)) typeface.delete();
      fontMgr.delete();
    },
  };
};
