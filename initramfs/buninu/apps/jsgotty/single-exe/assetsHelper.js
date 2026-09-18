import { join, posix, sep } from "node:path";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { IS_COMPILED, REPO_ROOT } from "./compiled.js";
import { pkg } from "./assetsPacker.js";

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

//  This package own namespace inside a shared archive. Matches what
//  `assetsPacker -p` writes, and what `--asset ./build/assets` lands at
//  under /$bunfs/root, so one key reaches either back end.
export const SELF = `assets/${pkg.name}@${pkg.version}`;

//  "" when this build packed flat keys, SELF when it packed namespaced
//  ones. Detected from what is actually there rather than declared by a
//  build flag, which can disagree with the packer and fail silently.
//
//  NOTE: nothing reads this yet; the lookups below are still flat.
//
//  Lazy because the tar back end fills globalThis.internalAssets
//  asynchronously, so module-load time is too early to look.
let detectedPrefix;

export function assetPrefix() {
  if (detectedPrefix === undefined) detectedPrefix = detectPrefix();
  return detectedPrefix;
}

function detectPrefix() {
  const store = getAssetStore();

  if (store) {
    const keys = store instanceof Map ? store.keys() : Object.keys(store);
    for (const key of keys) if (key.startsWith(SELF + "/")) return SELF;
  }

  const base = bunfsBase();
  if (base && existsSync(join(base, SELF))) return SELF;

  return "";
}

//  `--assets-external` means "ignore what is embedded". The tar loader
//  signals it by setting the store to null; with no loader in the graph
//  (the --asset back end) it stays undefined, so only null counts.
//
//  Without this the bunfs branch below stayed live in tar builds too, and
//  since it is rooted at the binary's own /$bunfs/root, an external run
//  enumerated the executable and its embedded tar as if they were assets.
function externalAssets() {
  return globalThis.internalAssets === null;
}

//  Whether THIS package has anything embedded. A bare store check was
//  true even for an empty one, which sent every caller down the internal
//  branch to find nothing and never try the disk fallback.
export function hasInternalAssets() {
  return listInternalAssetPaths().length > 0;
}

export function assetPath(...parts) {
  return parts
    .flatMap((part) => String(part).split(/[\\/]+/))
    .filter(Boolean)
    .join("/");
}

export function decodeHtmlAttribute(value) {
  return String(value ?? "").replace(
    /&(?:amp|quot|apos|lt|gt|#39|#x27|#\d+|#x[\da-f]+);/gi,
    (entity) => {
      const named = {
        "&amp;": "&",
        "&quot;": "\"",
        "&apos;": "'",
        "&lt;": "<",
        "&gt;": ">",
        "&#39;": "'",
        "&#x27;": "'",
      }[entity.toLowerCase()];
      if (named != null) return named;
      const hex = /^&#x([\da-f]+);$/i.exec(entity);
      const decimal = /^&#(\d+);$/.exec(entity);
      const codePoint = Number.parseInt(hex?.[1] ?? decimal?.[1] ?? "", hex ? 16 : 10);
      try {
        return Number.isInteger(codePoint) ? String.fromCodePoint(codePoint) : entity;
      } catch {
        return entity;
      }
    },
  );
}

export function canonicalHtmlBundleImageHref(input, { htmlAttribute = false } = {}) {
  let value = String(input ?? "");
  if (htmlAttribute) value = decodeHtmlAttribute(value);
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function findHtmlBundleAsset(homepage, publicPath, {
  contentTypePrefix = "",
} = {}) {
  if (!Array.isArray(homepage?.files)) return null;
  const name = posix.basename(String(publicPath ?? "").replace(/[?#].*$/, ""));
  for (const file of homepage.files) {
    if (file?.loader !== "file") continue;
    const contentType = String(file.headers?.["content-type"] ?? "");
    if (contentTypePrefix && !contentType.startsWith(contentTypePrefix)) continue;
    if (posix.basename(String(file.path ?? "")) === name) return file;
  }
  return null;
}

export function findHtmlBundleImageAsset(homepage, publicPath) {
  return findHtmlBundleAsset(homepage, publicPath, {
    contentTypePrefix: "image/",
  });
}

export function htmlBundleImageAssetPath(homepage, publicPath) {
  return findHtmlBundleImageAsset(homepage, publicPath)?.path ?? null;
}

export async function buildHtmlBundleImageMap(
  homepage,
  sourceAttribute = "data-mdcui-src",
) {
  const images = new Map();
  if (!homepage?.index || !Array.isArray(homepage.files)) return images;
  const html = await Bun.file(homepage.index).text();
  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    const rawHref = htmlTagAttribute(tag, sourceAttribute);
    const publicPath = htmlTagAttribute(tag, "src");
    if (rawHref == null || publicPath == null) continue;
    const bundledPath = htmlBundleImageAssetPath(homepage, decodeHtmlAttribute(publicPath));
    if (!bundledPath) continue;
    images.set(
      canonicalHtmlBundleImageHref(rawHref, { htmlAttribute: true }),
      bundledPath,
    );
  }
  return images;
}

//  `bun build --compile --asset` puts the files at real paths under
//  import.meta.dir instead of into the tar map. Only in a compiled
//  binary: in the source tree this file sits in single-exe/, which is
//  not the asset root.
function bunfsBase() {
  return IS_COMPILED && !externalAssets() ? import.meta.dir : null;
}

//  Store-space keys for every regular file under <base>/<sub>.
//
//  NOTE: with no namespace, <sub> is "" and the scan starts at
//  /$bunfs/root, which also holds the executable and any file-loader
//  assets. Nothing marks those apart from real assets, so pack with -p
//  when the --asset back end is in play.
function walkBunfs(base, sub) {
  const dir = sub ? join(base, sub) : base;

  let names;
  try {
    names = readdirSync(dir, { recursive: true });
  } catch {
    return [];
  }

  const out = [];

  for (const name of names) {
    const rel = String(name).split(sep).join("/");

    try {
      if (!statSync(join(dir, String(name))).isFile()) continue;
    } catch {
      continue;
    }

    out.push(sub ? `${sub}/${rel}` : rel);
  }

  return out;
}

//  Callers always speak package-relative keys. This is the one place
//  those become store keys, so the namespace stays invisible to them.
//  Exported because a caller rolling its own fallback needs the same
//  answer — `--assets-extract` writes the archive under these keys.
export function getAssetKey(path) {
  const key = assetPath(path);
  const at = assetPrefix();
  return at ? (key ? `${at}/${key}` : at) : key;
}

//  Where the disk fallback looks for a package-relative key.
//
//  A source checkout has the plain path. A compiled binary does not:
//  `--assets-extract` writes the archive exactly as packed, namespace
//  included, so the extracted `README.md` lands at
//  `<exe dir>/assets/<name>@<version>/README.md` and the plain join
//  misses it. `assetPrefix()` cannot answer this — with
//  `--assets-external` there is no store to detect it from, which is
//  precisely when the fallback runs — so try SELF and keep the plain
//  path for archives that were packed flat.
export function assetDiskPath(path) {
  const key = assetPath(path);
  const plain = join(REPO_ROOT, key);

  if (!IS_COMPILED) return plain;

  const namespaced = join(REPO_ROOT, SELF, key);
  return existsSync(namespaced) ? namespaced : plain;
}

export function listInternalAssetPaths(prefix = "") {
  const at = assetPrefix();
  const wanted = getAssetKey(prefix);
  const store = getAssetStore();
  const found = new Set();

  if (store) for (const key of iterateAssetKeys(store)) found.add(key);

  const base = bunfsBase();
  if (base) for (const key of walkBunfs(base, wanted)) found.add(key);

  let entries = [...found];

  if (wanted) {
    const base = `${wanted}/`;
    entries = entries.filter((path) => path === wanted || path.startsWith(base));
  }

  //  Hand the namespace back off on the way out, or every caller that
  //  matches on the returned paths would have to know about it.
  if (at) {
    const cut = at.length + 1;
    entries = entries.filter((path) => path.startsWith(at + "/")).map((path) => path.slice(cut));
  }

  return entries.sort();
}

export function listInternalAssetDirs(prefix = "") {
  const normalizedPrefix = assetPath(prefix);
  const base = normalizedPrefix ? `${normalizedPrefix}/` : "";
  const dirs = new Set();

  for (const path of listInternalAssetPaths(prefix)) {
    const rest = normalizedPrefix ? path.slice(base.length) : path;
    const [dir] = rest.split("/");
    if (dir) dirs.add(dir);
  }

  return [...dirs].sort();
}

export function getInternalAsset(path) {
  const key = getAssetKey(path);

  const store = getAssetStore();
  if (store) {
    const hit = store instanceof Map ? store.get(key) : (store[key] ?? store[path]);
    if (hit != null) return hit;
  }

  //  Tar first so an existing build keeps its exact behaviour; the
  //  --asset back end answers whatever the tar does not hold.
  const base = bunfsBase();
  if (base) {
    try {
      return readFileSync(join(base, key));
    } catch {}
  }

  return null;
}

export function readInternalAssetBytes(path) {
  const value = getInternalAsset(path);
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") return textEncoder.encode(value);
  return textEncoder.encode(String(value));
}

export function readInternalAssetText(path) {
  const bytes = readInternalAssetBytes(path);
  if (!bytes) return null;
  return textDecoder.decode(bytes);
}

//  The fallback reads through node:fs so the same call works under plain
//  Node, which is the whole point of keeping the loader out of the main
//  program's module graph.
export async function readAssetText(path) {
  const internal = readInternalAssetText(path);
  if (internal != null) return internal;

  //  TextDecoder drops a leading BOM, so the embedded path never returns
  //  one; readFile keeps it. Strip it here or the same file reads
  //  differently depending on whether it was embedded.
  return (await readFile(assetDiskPath(path), "utf8")).replace(/^\uFEFF/, "");
}

export async function readAssetBytes(path) {
  const internal = readInternalAssetBytes(path);
  if (internal) return internal;

  const buf = await readFile(assetDiskPath(path));

  //  Buffer is a Uint8Array, but hand back a plain one so callers cannot
  //  come to depend on the Buffer-only methods.
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

//  Sync twins of readAssetText / readAssetBytes, for callers that cannot
//  await — argument parsing, module init, CommonJS programs. Same lookup
//  and same fallback; only the disk read differs (node:fs sync).
export function readAssetTextSync(path) {
  const internal = readInternalAssetText(path);
  if (internal != null) return internal;

  return readFileSync(assetDiskPath(path), "utf8").replace(/^\uFEFF/, "");
}

export function readAssetBytesSync(path) {
  const internal = readInternalAssetBytes(path);
  if (internal) return internal;

  const buf = readFileSync(assetDiskPath(path));
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function internalAssetSource(path) {
  return {
    name: path.split("/").pop() ?? path,
    path,
    async text() {
      return readInternalAssetText(path) ?? "";
    },
  };
}

function getAssetStore() {
  const store = globalThis.internalAssets;
  if (!store) return null;
  if (store instanceof Map) return store;
  if (typeof store === "object") return store;
  return null;
}

function iterateAssetKeys(store) {
  if (store instanceof Map) return [...store.keys()].map(String);
  return Object.keys(store);
}

function htmlTagAttribute(tag, name) {
  const escapedName = String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(tag).match(new RegExp(`\\b${escapedName}\\s*=\\s*([\"'])(.*?)\\1`, "i"));
  return match?.[2] ?? null;
}
