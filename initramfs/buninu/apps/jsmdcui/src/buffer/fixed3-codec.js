const HEX = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0"),
);
const ENCODE_TABLE = new Uint8Array(256 * 3);
const DECODE_HEX = new Int16Array(128);

DECODE_HEX.fill(-1);

for (let i = 0; i < 10; i++) {
  DECODE_HEX[0x30 + i] = i;
}
for (let i = 0; i < 6; i++) {
  DECODE_HEX[0x41 + i] = 10 + i;
  DECODE_HEX[0x61 + i] = 10 + i;
}

for (let byte = 0; byte < 256; byte++) {
  const offset = byte * 3;

  if (byte >= 0x20 && byte <= 0x7e) {
    ENCODE_TABLE[offset] = byte;
    ENCODE_TABLE[offset + 1] = 0x2e;
    ENCODE_TABLE[offset + 2] = 0x2e;
  } else {
    ENCODE_TABLE[offset] = 0x5c;
    ENCODE_TABLE[offset + 1] = HEX[byte].charCodeAt(0);
    ENCODE_TABLE[offset + 2] = HEX[byte].charCodeAt(1);
  }
}

export class Fixed3DecodeError extends SyntaxError {
  constructor(message, position) {
    super(`${message} at text offset ${position}`);
    this.name = "Fixed3DecodeError";
    this.position = position;
    this.byteOffset = Math.floor(position / 3);
  }
}

export function encodeBinary(input) {
  return encodeBinaryToBuffer(input).toString("latin1");
}

export function encodeBinaryToBuffer(input) {
  const bytes = input instanceof Uint8Array ? input : Buffer.from(input);
  const out = Buffer.allocUnsafe(bytes.byteLength * 3);
  let j = 0;

  for (let i = 0; i < bytes.byteLength; i++) {
    const offset = bytes[i] * 3;
    out[j++] = ENCODE_TABLE[offset];
    out[j++] = ENCODE_TABLE[offset + 1];
    out[j++] = ENCODE_TABLE[offset + 2];
  }

  return out;
}

export function decodeBinary(text) {
  if (typeof text !== "string") {
    throw new TypeError("decodeBinary() expects a string");
  }

  return decodeBinaryBytes(Buffer.from(text, "latin1"));
}

export function decodeBinaryBytes(input) {
  const bytes = input instanceof Uint8Array ? input : Buffer.from(input);
  const out = Buffer.allocUnsafe(Math.floor(bytes.byteLength / 3));
  let j = 0;

  for (let i = 0; i < bytes.byteLength; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];

    if (b === 0x2e && c === 0x2e) {
      out[j++] = a;
    } else {
      out[j++] = (DECODE_HEX[b] << 4) | DECODE_HEX[c];
    }
  }

  return out;
}

export function decodeBinaryStrict(text) {
  if (typeof text !== "string") {
    throw new TypeError("decodeBinary() expects a string");
  }

  if (text.length % 3 !== 0) {
    throw new Fixed3DecodeError("input length is not a multiple of 3", text.length);
  }

  const out = Buffer.allocUnsafe(text.length / 3);
  let j = 0;

  for (let i = 0; i < text.length; i += 3) {
    const a = text.charCodeAt(i);
    const b = text.charCodeAt(i + 1);
    const c = text.charCodeAt(i + 2);

    if (b === 0x2e && c === 0x2e) {
      if (a < 0x20 || a > 0x7e) {
        throw new Fixed3DecodeError("printable cell has non-printable byte", i);
      }
      out[j++] = a;
      continue;
    }

    if (a !== 0x5c) {
      throw new Fixed3DecodeError("escaped cell must start with backslash", i);
    }

    const hi = b < 128 ? DECODE_HEX[b] : -1;
    const lo = c < 128 ? DECODE_HEX[c] : -1;
    if (hi < 0 || lo < 0) {
      throw new Fixed3DecodeError("escaped cell must contain two hex digits", i);
    }

    const byte = (hi << 4) | lo;
    if (byte >= 0x20 && byte <= 0x7e) {
      throw new Fixed3DecodeError("printable byte must use c.. form", i);
    }

    out[j++] = byte;
  }

  return out;
}

export default {
  encodeBinary,
  encodeBinaryToBuffer,
  decodeBinary,
  decodeBinaryBytes,
  decodeBinaryStrict,
  Fixed3DecodeError,
};
