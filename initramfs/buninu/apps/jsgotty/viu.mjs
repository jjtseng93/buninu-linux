#!/usr/bin/env node

import fs from "fs";
import os from "os";
import path from "path";

let emitBridgeMessage = null;

const ESC = "\u001b";
const ST = `${ESC}\\`;
const APC_PREFIX = `${ESC}_G`;
const CHUNK_SIZE = 4096;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const GIF87A = Buffer.from("GIF87a", "ascii");
const GIF89A = Buffer.from("GIF89a", "ascii");
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const RIFF = Buffer.from("RIFF", "ascii");
const WEBP = Buffer.from("WEBP", "ascii");
const BMP = Buffer.from("BM", "ascii");

function stderr(message) {
  process.stderr.write(`${message}\n`);
}

function usage(exitCode = 0) {
  stderr("usage: node viu.mjs [--compat] <image>");
  process.exitCode = exitCode;
}

//  A browser terminal only reports its size to the PTY once the page has laid
//  out, so a window that was just opened, restored, resized or rotated answers
//  with a couple of columns for a few hundred milliseconds. An image sized
//  against that is emitted as a one-cell speck — indistinguishable from the
//  command having printed nothing — while the next run in the same session,
//  by which time the real size has arrived, comes out correct. Give the size a
//  short chance to settle when what we read back is too small to be a terminal
//  anyone could be looking at.
const MIN_SANE_COLS = 20;
const MIN_SANE_ROWS = 5;
const SIZE_SETTLE_TIMEOUT_MS = 400;
const SIZE_POLL_INTERVAL_MS = 25;

function terminalSizeLooksUnset() {
  return (process.stdout.columns || 0) < MIN_SANE_COLS
    || (process.stdout.rows || 0) < MIN_SANE_ROWS;
}

async function waitForStableTerminalSize() {
  if (!process.stdout.isTTY) {
    return;
  }
  const deadline = Date.now() + SIZE_SETTLE_TIMEOUT_MS;
  while (terminalSizeLooksUnset() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SIZE_POLL_INTERVAL_MS));
  }
}

function fitImageCells(width, height) {
  const terminalCols = Math.max(1, process.stdout.columns || 80);
  const maxCols = Math.max(1, terminalCols - 1);
  const estimatedCols = width > 0 ? Math.max(1, Math.round(width / 8)) : 20;
  const cols = Math.min(maxCols, estimatedCols);
  const rows = width > 0 && height > 0
    ? Math.max(1, Math.round((cols * height) / width / 2))
    : 10;
  return { cols, rows };
}

function buildControlFields(imageId, mime, cols, rows, more, compat) {
  const fields = [
    "a=T",
    "f=100",
    `i=${imageId}`,
    `p=${imageId}`,
    "q=2",
    "t=d",
    `c=${cols}`,
    `r=${rows}`,
    `m=${more ? 1 : 0}`,
  ];
  if (!compat) {
    fields.push(`U=${mime}`);
  }
  return fields.join(",");
}

function writePacket(control, payload) {
  process.stdout.write(`${APC_PREFIX}${control};${payload}${ST}`);
}

function writeKittyImage(buffer, mime, width, height, compat) {
  const base64 = buffer.toString("base64");
  let imageId = Date.now() % 2147483647;
  
  imageId = process.env.JSGOTTY_IMGID || imageId ;
  
  if(process.env.JSGOTTY_DEBUG)
    console.error(imageId)
  
  const { cols, rows } = fitImageCells(width, height);

  if (process.platform === "win32") {
    const extension = mime === "image/gif"
      ? ".gif"
      : mime === "image/jpeg"
        ? ".jpg"
        : mime === "image/bmp"
          ? ".bmp"
          : ".png";
    const tempPath = path.join(os.tmpdir(), `js-gotty-viu-${process.pid}-${Date.now()}${extension}`);
    fs.writeFileSync(tempPath, buffer);
    emitBridgeMessage({
      op: "image_file",
      id: String(imageId),
      mime,
      width,
      height,
      cols,
      rows,
      path: tempPath,
      deleteAfterRead: true,
    });
    return;
  }

  for (let offset = 0; offset < base64.length; offset += CHUNK_SIZE) {
    const payload = base64.slice(offset, offset + CHUNK_SIZE);
    const more = offset + CHUNK_SIZE < base64.length;
    writePacket(buildControlFields(imageId, mime, cols, rows, more, compat), payload);
  }
}

function parsePngSize(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return null;
  }
  if (buffer.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error("invalid PNG: missing IHDR");
  }
  return {
    mime: "image/png",
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function parseGifSize(buffer) {
  if (buffer.length < 10 || (!buffer.subarray(0, 6).equals(GIF87A) && !buffer.subarray(0, 6).equals(GIF89A))) {
    return null;
  }
  return {
    mime: "image/gif",
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
  };
}

function parseBmpSize(buffer) {
  if (buffer.length < 26 || !buffer.subarray(0, 2).equals(BMP)) {
    return null;
  }
  const dibSize = buffer.readUInt32LE(14);
  if (dibSize >= 40 && buffer.length >= 26) {
    return {
      mime: "image/bmp",
      width: Math.abs(buffer.readInt32LE(18)),
      height: Math.abs(buffer.readInt32LE(22)),
    };
  }
  if (dibSize === 12 && buffer.length >= 22) {
    return {
      mime: "image/bmp",
      width: buffer.readUInt16LE(18),
      height: buffer.readUInt16LE(20),
    };
  }
  return { mime: "image/bmp", width: 0, height: 0 };
}

function parseJpegSize(buffer, options = {}) {
  if (buffer.length < 4 || !buffer.subarray(0, 2).equals(JPEG_SOI)) {
    return null;
  }

  let orientation = 1;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;

    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > buffer.length) {
      break;
    }

    const size = buffer.readUInt16BE(offset);
    if (size < 2 || offset + size > buffer.length) {
      break;
    }

    if (marker === 0xe1 && size >= 10) {
      orientation = parseExifOrientation(buffer.subarray(offset + 2, offset + size), orientation);
    }

    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isSof && size >= 7) {
      let height = buffer.readUInt16BE(offset + 3);
      let width = buffer.readUInt16BE(offset + 5);
      if (!options.compat && orientation >= 5 && orientation <= 8) {
        [width, height] = [height, width];
      }
      return {
        mime: "image/jpeg",
        height,
        width,
      };
    }

    offset += size;
  }

  return { mime: "image/jpeg", width: 0, height: 0 };
}

function parseExifOrientation(exifBuffer, fallback = 1) {
  if (exifBuffer.length < 14 || exifBuffer.toString("ascii", 0, 6) !== "Exif\0\0") {
    return fallback;
  }

  const tiffOffset = 6;
  const littleEndian =
    exifBuffer[tiffOffset] === 0x49 && exifBuffer[tiffOffset + 1] === 0x49;
  const bigEndian =
    exifBuffer[tiffOffset] === 0x4d && exifBuffer[tiffOffset + 1] === 0x4d;
  if (!littleEndian && !bigEndian) {
    return fallback;
  }

  const readU16 = (at) =>
    littleEndian ? exifBuffer.readUInt16LE(at) : exifBuffer.readUInt16BE(at);
  const readU32 = (at) =>
    littleEndian ? exifBuffer.readUInt32LE(at) : exifBuffer.readUInt32BE(at);

  if (readU16(tiffOffset + 2) !== 0x002a) {
    return fallback;
  }

  const ifd0Offset = tiffOffset + readU32(tiffOffset + 4);
  if (ifd0Offset + 2 > exifBuffer.length) {
    return fallback;
  }

  const entryCount = readU16(ifd0Offset);
  for (let index = 0; index < entryCount; index += 1) {
    const entryOffset = ifd0Offset + 2 + index * 12;
    if (entryOffset + 12 > exifBuffer.length) {
      break;
    }
    const tag = readU16(entryOffset);
    if (tag !== 0x0112) {
      continue;
    }
    const type = readU16(entryOffset + 2);
    const count = readU32(entryOffset + 4);
    if (type !== 3 || count < 1) {
      return fallback;
    }
    return readU16(entryOffset + 8);
  }

  return fallback;
}

function parseWebpSize(buffer) {
  if (buffer.length < 16 || !buffer.subarray(0, 4).equals(RIFF) || !buffer.subarray(8, 12).equals(WEBP)) {
    return null;
  }
  const chunkType = buffer.toString("ascii", 12, 16);

  if (chunkType === "VP8 " && buffer.length >= 30) {
    return {
      mime: "image/webp",
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  if (chunkType === "VP8L" && buffer.length >= 25) {
    const bits =
      buffer[21] |
      (buffer[22] << 8) |
      (buffer[23] << 16) |
      (buffer[24] << 24);
    return {
      mime: "image/webp",
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  if (chunkType === "VP8X" && buffer.length >= 30) {
    return {
      mime: "image/webp",
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
    };
  }

  return { mime: "image/webp", width: 0, height: 0 };
}

function parseSvgSize(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192)).toString("utf8");
  if (!sample.includes("<svg")) {
    return null;
  }

  const widthMatch = sample.match(/\bwidth=["']([0-9.]+)(px)?["']/i);
  //'"
  const heightMatch = sample.match(/\bheight=["']([0-9.]+)(px)?["']/i);
  if (widthMatch && heightMatch) {
    return {
      mime: "image/svg+xml",
      width: Math.round(Number(widthMatch[1])),
      height: Math.round(Number(heightMatch[1])),
    };
  }

  const viewBoxMatch = sample.match(/\bviewBox=["'][^"']*?([0-9.]+)[ ,]+([0-9.]+)\s*["']/i);
  if (viewBoxMatch) {
    return {
      mime: "image/svg+xml",
      width: Math.round(Number(viewBoxMatch[1])),
      height: Math.round(Number(viewBoxMatch[2])),
    };
  }

  return { mime: "image/svg+xml", width: 0, height: 0 };
}

function guessMimeFromExtension(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    case ".svg":
      return "image/svg+xml";
    case ".avif":
      return "image/avif";
    case ".apng":
      return "image/apng";
    case ".ico":
      return "image/x-icon";
    default:
      return "application/octet-stream";
  }
}

function sniffImage(buffer, filePath, options = {}) {
  const parsed =
    parsePngSize(buffer) ||
    parseJpegSize(buffer, options) ||
    parseGifSize(buffer) ||
    parseWebpSize(buffer) ||
    parseBmpSize(buffer) ||
    parseSvgSize(buffer);

  if (parsed) {
    return parsed;
  }

  const mime = guessMimeFromExtension(filePath);
  if (mime.startsWith("image/")) {
    return { mime, width: 0, height: 0 };
  }

  throw new Error("unsupported image format");
}

async function main() {
  emitBridgeMessage = (await import('./windows-bridge-node.js')).emitBridgeMessage;

  const args = process.argv.slice(2);
  const compat = args.includes("--compat");
  const positional = args.filter((arg) => arg !== "--compat");
  const inputPath = positional[0];
  if (!inputPath || inputPath === "-h" || inputPath === "--help") {
    usage(inputPath ? 0 : 1);
    return;
  }

  const fullPath = path.resolve(inputPath);
  const buffer = fs.readFileSync(fullPath);
  const image = sniffImage(buffer, fullPath, { compat });
  await waitForStableTerminalSize();
  writeKittyImage(buffer, image.mime, image.width, image.height, compat);
}

main().catch((error) => {
  stderr(String(error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
