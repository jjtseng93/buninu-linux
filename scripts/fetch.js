// The fetch stage, as fetch-alpine.sh, fetch-bun.sh and scripts/fetch.sh do
// it: download the pinned Alpine packages and Bun release, verify their
// SHA-256, and lay out kernel/<arch>/ and native/<arch>/.
//
//   node scripts/fetch.js            both parts; BUNINU_ARCH, LINUX_FLAVOR,
//                                    REAL_MACHINE and ALPINE_MIRROR as in arch.js
//
// Unlike fetch-alpine.sh, the release's module directory is emptied first,
// so modules from an earlier --real fetch do not stay behind; and a download
// lands under its final name only once its hash matched.

import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { gunzipSync } from "node:zlib";
import { config, rootDir, runIfMain, withUmask022 } from "./arch.js";
import { filterAliases, select, trimDependencies } from "./modules.js";

const sha256File = async (path) => {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
};

/**
 * Downloads `url` to downloadsDir/name unless a file with that SHA-256 is
 * already there. The hash is both the cache key and the integrity check.
 */
export const download = async (cfg, url, name, sha256) => {
  const path = join(cfg.downloadsDir, name);
  if (existsSync(path) && (await sha256File(path)) === sha256) {
    console.log(`cached ${name}`);
    return path;
  }
  console.log(`fetch  ${name}`);
  mkdirSync(cfg.downloadsDir, { recursive: true });
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`);
  const partial = `${path}.part`;
  const hash = createHash("sha256");
  const hashing = new TransformStream({ transform(chunk, controller) { hash.update(chunk); controller.enqueue(chunk); } });
  await pipeline(Readable.fromWeb(response.body.pipeThrough(hashing)), createWriteStream(partial));
  const actual = hash.digest("hex");
  if (actual !== sha256) {
    rmSync(partial, { force: true });
    throw new Error(`${name}: SHA-256 ${actual}, expected ${sha256}`);
  }
  renameSync(partial, path);
  return path;
};

/**
 * The regular files of a tar archive (gzip members concatenated, as an .apk
 * is), by name. pax ("x") and GNU long-name ("L") headers give names longer
 * than the ustar fields.
 */
export const readTar = (path) => {
  const data = gunzipSync(readFileSync(path));
  const files = new Map();
  const links = new Map();
  let longName = null;
  let longLink = null;
  let extended = {}, global = {};
  const invalid = (reason) => { throw new Error(`${path}: ${reason}`); };
  const number = (header, start, length) => {
    if (header[start] & 0x80) {
      let value = BigInt(header[start] & 0x7f);
      for (let i = start + 1; i < start + length; i++) value = value * 256n + BigInt(header[i]);
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) invalid("unsafe tar numeric field");
      return Number(value);
    }
    const digits = header.toString("ascii", start, start + length).replace(/\0.*$/s, "").trim();
    if (digits && !/^[0-7]+$/.test(digits)) invalid("invalid tar numeric field");
    return digits ? Number.parseInt(digits, 8) : 0;
  };
  let offset = 0;
  for (; offset + 512 <= data.length;) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      offset += 512; longName = longLink = null; extended = {}; global = {}; continue;
    }
    let checksum = 0;
    for (let i = 0; i < 512; i++) checksum += i >= 148 && i < 156 ? 32 : header[i];
    if (checksum !== number(header, 148, 8)) invalid("invalid tar header checksum");
    const field = (start, length) => header.toString("utf8", start, start + length).replace(/\0.*$/s, "");
    const type = String.fromCharCode(header[156] || 0x30);
    const metadata = ["x", "X", "g", "L", "K"].includes(type);
    const attrs = { ...global, ...extended };
    if (!metadata && attrs.size !== undefined && !/^[0-9]+$/.test(attrs.size)) invalid("invalid pax size");
    const size = !metadata && attrs.size !== undefined ? Number(attrs.size) : number(header, 124, 12);
    const padded = Math.ceil(size / 512) * 512;
    if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(padded)
        || padded > data.length - offset - 512) invalid("invalid or truncated tar member size");
    const body = data.subarray(offset + 512, offset + 512 + size);
    offset += 512 + padded;
    if (type === "x" || type === "X" || type === "g") {
      // PAX lengths count bytes, not UTF-16 characters. Reject malformed records.
      const attrs = type === "g" ? global : extended;
      for (let at = 0; at < body.length;) {
        const space = body.indexOf(32, at);
        if (space < 0) invalid("invalid pax record length");
        const digits = body.toString("ascii", at, space);
        const length = /^[0-9]+$/.test(digits) ? Number(digits) : NaN;
        if (!Number.isSafeInteger(length) || length <= space - at + 1
            || length > body.length - at || body[at + length - 1] !== 10) invalid("invalid pax record length");
        const record = body.toString("utf8", space + 1, at + length - 1);
        const equals = record.indexOf("=");
        if (equals > 0) Object.defineProperty(attrs, record.slice(0, equals), {
          value: record.slice(equals + 1), writable: true, enumerable: true, configurable: true,
        });
        at += length;
      }
      continue;
    }
    if (type === "L") { longName = body.toString("utf8").replace(/\0.*$/s, ""); continue; }
    if (type === "K") { longLink = body.toString("utf8").replace(/\0.*$/s, ""); continue; }
    const prefix = field(257, 5) === "ustar" ? field(345, 155) : "";
    const name = attrs.path ?? longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = null;
    if (type === "0" || type === "\0") files.set(name.replace(/^\.\//, ""), body);
    if (type === "1" || type === "2") links.set(name.replace(/^\.\//, ""), { target: attrs.linkpath ?? longLink ?? field(157, 100), hard: type === "1" });
    longLink = null;
    extended = {};
  }
  if (offset !== data.length) invalid("truncated tar header");
  return {
    // Enumerate regular files without exposing the Map's mutation methods.
    entries() { return files.entries(); },
    links() { return links.entries(); },
    get(name) {
      const bytes = files.get(name);
      if (!bytes) throw new Error(`${path}: no ${name}`);
      return bytes;
    },
  };
};

const writeTo = (path, bytes) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
};

// Both run with umask 022 (see arch.js withUmask022): native/ and kernel/
// are packed with their modes.

/** fetch-alpine.sh: the kernel, its selected modules, musl's loader and the EFI stub. */
export const fetchAlpine = (cfg = config()) => withUmask022(async () => {
  mkdirSync(cfg.kernelDir, { recursive: true });
  mkdirSync(join(cfg.nativeDir, "lib"), { recursive: true });
  const linux = readTar(await download(cfg, `${cfg.alpineBase}/${cfg.linuxPackage}`, cfg.linuxPackage, cfg.linuxSha256));
  const musl = readTar(await download(cfg, `${cfg.alpineBase}/${cfg.muslPackage}`, cfg.muslPackage, cfg.muslSha256));
  const stub = readTar(await download(cfg, `${cfg.alpineBase}/${cfg.stubPackage}`, cfg.stubPackage, cfg.stubSha256));

  // On aarch64 vmlinuz is an EFI zboot image, started by the stub like the x86_64 bzImage.
  writeTo(cfg.kernelImage, linux.get(`boot/vmlinuz-${cfg.flavor}`));
  writeTo(join(cfg.nativeDir, "lib", cfg.muslLoader), musl.get(`lib/${cfg.muslLoader}`));
  writeTo(join(cfg.kernelDir, cfg.efiStub), stub.get(`usr/lib/systemd/boot/efi/${cfg.efiStub}`));

  const release = `lib/modules/${cfg.kernelRelease}`;
  const dep = linux.get(`${release}/modules.dep`).toString();
  const builtin = linux.get(`${release}/modules.builtin`);
  const { selected, notes } = select({ dep, builtin: builtin.toString(), packageName: cfg.linuxPackage, arch: cfg.arch, flavor: cfg.flavor, real: cfg.real, noGpu: cfg.noGpu });
  for (const note of notes) console.error(note);
  rmSync(cfg.modulesRoot, { recursive: true, force: true });
  writeTo(join(cfg.modulesRoot, "modules.builtin"), builtin);
  for (const path of selected) {
    writeTo(join(cfg.modulesRoot, path.replace(/\.gz$/, "")), gunzipSync(linux.get(`${release}/${path}`)));
  }
  writeTo(join(cfg.modulesRoot, "modules.dep"), trimDependencies(dep, selected));
  writeTo(join(cfg.modulesRoot, "modules.alias"), filterAliases(linux.get(`${release}/modules.alias`).toString(), selected));

  await (await import("./fetch-gpu.js")).fetchGpuFirmware(cfg);

  chmodSync(join(cfg.nativeDir, "lib", cfg.muslLoader), 0o755);
  console.log(`Fetched Alpine ${cfg.arch} linux-${cfg.flavor} kernel, ${selected.length} modules, musl, and the ${cfg.efiStub} UKI stub.`);
});

/** fetch-bun.sh: Bun from its release zip, and the GCC runtime it links against. */
export const fetchBun = (cfg = config()) => withUmask022(async () => {
  for (const directory of [
    cfg.downloadsDir,
    join(cfg.nativeDir, "bin"),
    join(cfg.nativeDir, "lib"),
    join(rootDir, "initramfs/dev"),
    join(rootDir, "initramfs/proc"),
    join(rootDir, "initramfs/sys"),
    join(rootDir, "initramfs/tmp"),
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  const zip = await download(cfg, cfg.bunUrl, cfg.bunZip, cfg.bunSha256);
  const libstdcpp = readTar(await download(cfg, `${cfg.alpineBase}/${cfg.libstdcppPackage}`, cfg.libstdcppPackage, cfg.libstdcppSha256));
  const libgcc = readTar(await download(cfg, `${cfg.alpineBase}/${cfg.libgccPackage}`, cfg.libgccPackage, cfg.libgccSha256));
  const loader = join(cfg.nativeDir, "lib", cfg.muslLoader);
  if (!existsSync(loader) || statSync(loader).size === 0) {
    throw new Error("fetch stage incomplete: run fetchAlpine first (node scripts/fetch.js runs both)");
  }
  // initramfs/bin/unzip: the same reader the guest has.
  const unzip = spawnSync(process.execPath, [
    join(rootDir, "initramfs/bin/unzip"),
    "-p",
    zip,
    `${cfg.bunBuild}/bun`,
  ], { maxBuffer: 1 << 30 });
  if (unzip.status !== 0) throw new Error(`unzip ${zip}: ${unzip.stderr}`);
  writeTo(join(cfg.nativeDir, "bin", "bun"), unzip.stdout);
  writeTo(join(cfg.nativeDir, "lib", "libstdc++.so.6"), libstdcpp.get("usr/lib/libstdc++.so.6.0.34"));
  writeTo(join(cfg.nativeDir, "lib", "libgcc_s.so.1"), libgcc.get("usr/lib/libgcc_s.so.1"));
  // libc as a distinct inode from the active dynamic loader: dlopen on the
  // loader inode itself deadlocks, while this physical copy is FFI-safe.
  copyFileSync(loader, join(cfg.nativeDir, "lib", cfg.muslLibc));
  chmodSync(join(rootDir, "initramfs/init.js"), 0o755);
  chmodSync(join(cfg.nativeDir, "bin", "bun"), 0o755);
  for (const name of readdirSync(join(cfg.nativeDir, "lib"))) {
    if (/\.so/.test(name)) chmodSync(join(cfg.nativeDir, "lib", name), 0o755);
  }
  console.log(`Fetched Bun ${cfg.bunVersion} and its ${cfg.arch} musl runtime into ${cfg.nativeDir}/.`);
});

export const fetchAll = async (cfg = config()) => {
  await fetchAlpine(cfg);
  await fetchBun(cfg);
  await (await import("./fetch-npm.js")).fetchNpm();
};

runIfMain(import.meta.url, () => fetchAll());
