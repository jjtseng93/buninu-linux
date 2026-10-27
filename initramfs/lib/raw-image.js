// Retain immutable raw pixels until an operation actually needs a Skia Image.
// The native image store owns these handles; encoded images remain ordinary Skia images.
const rawImages = new WeakMap();
const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
export const rawImageData = image => rawImages.get(image);
export const skiaImage = image => rawImages.get(image)?.materialize() ?? image;

export function createRawImage(CanvasKit, pixels, width, height, colorType) {
  let decoded = null, closed = false;
  const data = {
    pixels, width, height, colorType,
    opaque: undefined,
    materialize() {
      if (closed) throw Error('raw image is closed');
      if (!decoded) {
        decoded = CanvasKit.MakeImage({width, height, colorType,
          alphaType: CanvasKit.AlphaType.Unpremul, colorSpace: CanvasKit.ColorSpace.SRGB}, pixels, width * 4);
        if (!decoded) throw Error('raw image rejected');
      }
      return decoded;
    },
  };
  const image = {
    width: () => width,
    height: () => height,
    delete() {
      if (closed) return;
      closed = true;
      decoded?.delete(); decoded = null;
      data.pixels = pixels = null;
      rawImages.delete(image);
    },
  };
  rawImages.set(image, data);
  return image;
}

// Check actual bytes once; raw protocol support does not imply opacity.
export function rawImageOpaque(data) {
  if (data.opaque === undefined) {
    const pixels = data.pixels;
    data.opaque = true;
    if (littleEndian && pixels.byteOffset % 4 === 0 && pixels.byteLength % 4 === 0) {
      const words = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.byteLength / 4);
      for (let i = 0; i < words.length; i++) {
        if ((words[i] >>> 24) !== 255) { data.opaque = false; break; }
      }
    } else {
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] !== 255) { data.opaque = false; break; }
      }
    }
  }
  return data.opaque;
}
