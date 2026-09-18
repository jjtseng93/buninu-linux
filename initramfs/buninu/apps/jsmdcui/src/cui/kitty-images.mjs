import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logKittyPlacement } from "./kitty-debug.mjs";
import { fetchHttpBytes as defaultFetchHttpBytes } from "../platform/commands.js";
import { canonicalHtmlBundleImageHref } from "../../single-exe/assetsHelper.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const REMOTE_IMAGE_TIMEOUT_MS = 10_000;

export function renderAnsiWithDataImages(markdown, options = {}) {
  const dataUrls = [];
  const protectedMarkdown = String(markdown ?? "").replace(
    /(!\[[^\]]*\]\()(data:image\/[^)\s]+)(\))/giu,
    (whole, opening, href, closing) => {
      const index = dataUrls.push(href) - 1;
      return `${opening}https://mdcui.invalid/data-image/${index}${closing}`;
    },
  );
  let ansi = String(Bun.markdown.ansi(protectedMarkdown, options));
  for (let index = 0; index < dataUrls.length; index++) {
    ansi = ansi.replaceAll(
      `https://mdcui.invalid/data-image/${index}`,
      dataUrls[index],
    );
  }
  return ansi;
}

async function withTimeout(promise, timeoutMs, onTimeout) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => {
            try { onTimeout?.(); } catch {}
            reject(new Error("remote image timed out"));
          },
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function imageSize(buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(PNG)) {
    return { mime: "image/png", width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  const gif = buffer.toString("ascii", 0, 6);
  if (buffer.length >= 10 && (gif === "GIF87a" || gif === "GIF89a")) {
    return { mime: "image/gif", width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 26 && buffer.toString("ascii", 0, 2) === "BM") {
    return { mime: "image/bmp", width: Math.abs(buffer.readInt32LE(18)), height: Math.abs(buffer.readInt32LE(22)) };
  }
  if (buffer.length >= 16 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const kind = buffer.toString("ascii", 12, 16);
    if (kind === "VP8 " && buffer.length >= 30) {
      return {
        mime: "image/webp",
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }
    if (kind === "VP8L" && buffer.length >= 25) {
      const bits = buffer[21] | (buffer[22] << 8) | (buffer[23] << 16) | (buffer[24] << 24);
      return {
        mime: "image/webp",
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
      };
    }
    if (kind === "VP8X" && buffer.length >= 30) {
      return {
        mime: "image/webp",
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 8 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(offset);
      if (length < 2 || offset + length > buffer.length) break;
      const sof = (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (sof && length >= 7) {
        return { mime: "image/jpeg", width: buffer.readUInt16BE(offset + 5), height: buffer.readUInt16BE(offset + 3) };
      }
      offset += length;
    }
  }
  const svg = buffer.subarray(0, Math.min(buffer.length, 8192)).toString("utf8");
  if (svg.includes("<svg")) {
    const width = svg.match(/\bwidth=["']([0-9.]+)(?:px)?["']/i); //'
    const height = svg.match(/\bheight=["']([0-9.]+)(?:px)?["']/i); //'
    if (width && height) {
      return { mime: "image/svg+xml", width: Math.round(Number(width[1])), height: Math.round(Number(height[1])) };
    }
    const viewBox = svg.match(/\bviewBox=["'][^"']*?([0-9.]+)[ ,]+([0-9.]+)\s*["']/i);
    if (viewBox) {
      return { mime: "image/svg+xml", width: Math.round(Number(viewBox[1])), height: Math.round(Number(viewBox[2])) };
    }
  }
  return null;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? ""));
}

function imageDataUrlBytes(href) {
  const match = /^data:(image\/[^;,]+)((?:;[^,]*)?),(.*)$/isu.exec(href);
  if (!match) return null;
  try {
    return /;base64(?:;|$)/iu.test(match[2])
      ? Buffer.from(match[3].replace(/\s+/gu, ""), "base64")
      : Buffer.from(decodeURIComponent(match[3]), "utf8");
  } catch {
    return null;
  }
}

function imageSource(href, markdownPath, allowUrl) {
  try {
    if (href.startsWith("data:image/")) {
      const data = imageDataUrlBytes(href);
      return data ? { kind: "data", value: data } : null;
    }
    if (href.startsWith("file:")) return { kind: "local", value: fileURLToPath(href) };
    if (process.platform === "win32" && /^[A-Za-z]:[\\/]/.test(href)) {
      return { kind: "local", value: resolve(href) };
    }
    if (isHttpUrl(href)) {
      return allowUrl ? { kind: "remote", value: new URL(href).href } : null;
    }
    if (href.startsWith("//")) {
      if (!allowUrl) return null;
      const protocol = isHttpUrl(markdownPath) ? new URL(markdownPath).protocol : "https:";
      return { kind: "remote", value: new URL(`${protocol}${href}`).href };
    }
    if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(href)) return null;
    if (isHttpUrl(markdownPath)) {
      return allowUrl ? { kind: "remote", value: new URL(href, markdownPath).href } : null;
    }
    const decoded = decodeURIComponent(href.replace(/[?#].*$/, ""));
    return {
      kind: "local",
      value: resolve(markdownPath ? dirname(markdownPath) : process.cwd(), decoded),
    };
  } catch {
    return null;
  }
}

function stableImageId(pathname, line, data) {
  let hash = 2166136261;
  for (const byte of Buffer.concat([Buffer.from(`${pathname}\0${line}\0`), data])) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2147483646 + 1;
}

async function convertToKittyPng(data) {
  return Buffer.from(await new Bun.Image(data).png().toBuffer());
}

export function fitKittyImageToWidth(image, maxCols) {
  const originalCols = Math.max(1, Math.trunc(Number(image?.cols) || 1));
  const originalRows = Math.max(1, Math.trunc(Number(image?.rows) || 1));
  const availableCols = Math.max(1, Math.trunc(Number(maxCols) || 1));
  const cols = Math.min(originalCols, availableCols);
  const rows = Math.max(1, Math.round(originalRows * cols / originalCols));
  return { cols, rows };
}

export async function prepareKittyImages(ansiText, markdownPath, terminalCols = 80, options = {}) {
  const inputLines = String(ansiText).split("\n");
  const outputLines = [];
  const images = [];
  const maxCols = Math.max(1, Math.trunc(Number(terminalCols) || 80));
  const oscImage = /\x1b\]8;;([^\x1b]*)\x1b\\(?=[^\n]*📷)/;
  const bundledImages = await options.getBundledImageMap?.() ?? null;
  const remoteBudgetMs = Number.isFinite(options.remoteTimeoutMs)
    ? Math.max(1, Math.trunc(options.remoteTimeoutMs))
    : REMOTE_IMAGE_TIMEOUT_MS;
  const remoteDeadline = Date.now() + remoteBudgetMs;

  for (let sourceLine = 0; sourceLine < inputLines.length; sourceLine++) {
    const line = inputLines[sourceLine];
    const match = line.match(oscImage);
    const bundledPath = match
      ? bundledImages?.get(canonicalHtmlBundleImageHref(match[1]))
      : null;
    const source = bundledPath
      ? { kind: "bundled", value: bundledPath }
      : match ? imageSource(match[1], markdownPath, options.allowUrl === true) : null;
    if (!source) {
      outputLines.push(line);
      continue;
    }
    try {
      let data;
      if (source.kind === "data") {
        data = source.value;
      } else if (source.kind === "remote") {
        const fetchBytes = options.fetchHttpBytes ?? defaultFetchHttpBytes;
        const timeoutMs = remoteDeadline - Date.now();
        if (timeoutMs <= 0) throw new Error("remote image budget exhausted");
        const controller = new AbortController();
        data = Buffer.from(await withTimeout(
          fetchBytes(source.value, {
            timeoutMs,
            signal: controller.signal,
          }),
          timeoutMs,
          () => controller.abort(),
        ));
      } else {
        const file = Bun.file(source.value);
        if (!(await file.exists())) throw new Error("missing image");
        data = Buffer.from(await file.arrayBuffer());
      }
      let size = imageSize(data);
      if (!size?.width || !size?.height) throw new Error("unsupported image");
      if (options.kittyMode === "compat" && size.mime !== "image/png") {
        data = await convertToKittyPng(data);
        size = imageSize(data);
        if (size?.mime !== "image/png" || !size.width || !size.height)
          throw new Error("PNG conversion failed");
      }
      const estimatedCols = Math.max(1, Math.round(size.width / 8));
      const cols = Math.min(maxCols, estimatedCols);
      const rows = Math.max(1, Math.round((cols * size.height) / size.width / 2));
      const lineIndex = outputLines.length;
      outputLines.push(line, ...Array(Math.max(0, rows - 1)).fill(""));
      const sourcePath = source.kind === "data" ? `data:${size.mime}` : source.value;
      images.push({
        id: stableImageId(sourcePath, sourceLine, data),
        line: lineIndex,
        cols,
        rows,
        pixelWidth: size.width,
        pixelHeight: size.height,
        mime: size.mime,
        data,
        path: sourcePath,
      });
      logKittyPlacement("image-prepared", {
        path: sourcePath,
        sourceKind: source.kind,
        sourceLine,
        renderedLine: lineIndex,
        imageId: images.at(-1).id,
        intrinsicWidth: size.width,
        intrinsicHeight: size.height,
        cols,
        rows,
        terminalCols: maxCols + 1,
      });
    } catch {
      // An unavailable or unsupported image remains the normal Markdown link.
      outputLines.push(line);
    }
  }
  return { rendered: outputLines.join("\n"), images };
}
