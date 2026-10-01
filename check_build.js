#!/usr/bin/env bun
// Content checksums of the build outputs that ignore what changes from build
// to build without changing what boots: file mtimes and inode numbers in the
// initramfs, the PE timestamp and checksum of the UKI, and the GPT GUIDs,
// FAT serial and FAT timestamps of the disk image. Two builds of the same
// inputs print the same sums.
//
//   ./check_build.js                 build/initramfs.cpio.gz, the UKI(s) under vda/EFI/BOOT, vda.img
//   ./check_build.js FILE...         any of: .cpio(.gz), PE/EFI, GPT disk image or bare FAT image
//
// Written against node: APIs only, so it runs under node as well as bun.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const sha256 = (...parts) => {
  const hasher = createHash("sha256");
  for (const part of parts) hasher.update(part);
  return hasher.digest("hex");
};

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 2 ** 32;
const ascii = (b, o, n) => String.fromCharCode(...b.subarray(o, o + n));

// --- initramfs: newc cpio, optionally gzipped -------------------------------
// Kept per entry: name, mode, uid, gid, device numbers of special files, size
// and data. Dropped: inode, mtime, link count, the containing device, and
// the order of the entries (`sort` follows the locale, and the unpacked tree
// is the same either way): entries count sorted by name, byte by byte.
function cpioSum(bytes) {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  const entries = [];
  let offset = 0;
  while (offset + 110 <= bytes.length) {
    const magic = ascii(bytes, offset, 6);
    if (magic !== "070701" && magic !== "070702") throw new Error(`not a newc cpio entry at ${offset}`);
    const field = (index) => parseInt(ascii(bytes, offset + 6 + index * 8, 8), 16);
    const [mode, uid, gid, size, rdevMajor, rdevMinor, nameSize] =
      [field(1), field(2), field(3), field(6), field(9), field(10), field(11)];
    const name = Buffer.from(bytes.subarray(offset + 110, offset + 110 + nameSize - 1));
    const data = (offset + 110 + nameSize + 3) & ~3;
    const next = (data + size + 3) & ~3;
    if (name.toString("latin1") === "TRAILER!!!") break;
    entries.push({ name, header: `\0${mode.toString(8)} ${uid} ${gid} ${rdevMajor}:${rdevMinor} ${size}\n`, data: bytes.subarray(data, data + size) });
    offset = next;
  }
  entries.sort((a, b) => Buffer.compare(a.name, b.name));
  const hasher = createHash("sha256");
  for (const { name, header, data } of entries) {
    hasher.update(name);
    hasher.update(header);
    hasher.update(data);
  }
  return { sum: hasher.digest("hex"), detail: `${entries.length} entries` };
}

// --- UKI: PE image ----------------------------------------------------------
// The whole file with the COFF TimeDateStamp and optional-header CheckSum
// zeroed, except that the .initrd section counts by its cpio content sum.
// The gzip output's size varies with the mtimes inside, so everything that
// follows it is left out too: the .initrd sizes in the section table, the
// file length (its raw data is cut out rather than zeroed), SizeOfImage and
// SizeOfInitializedData.
function peSum(bytes) {
  const pe = u32(bytes, 0x3c);
  if (ascii(bytes, pe, 4) !== "PE\0\0") throw new Error("not a PE image");
  const coff = pe + 4;
  const sections = u16(bytes, coff + 2);
  const optional = coff + 20;
  const table = optional + u16(bytes, coff + 16);
  const copy = Uint8Array.from(bytes);
  copy.fill(0, coff + 4, coff + 8); // TimeDateStamp
  copy.fill(0, optional + 64, optional + 68); // CheckSum
  let initrd = null;
  let cut = null;
  for (let index = 0; index < sections; index++) {
    const header = table + index * 40;
    const name = ascii(bytes, header, 8).replace(/\0+$/, "");
    if (name !== ".initrd") continue;
    const rawSize = u32(bytes, header + 16);
    const start = u32(bytes, header + 20);
    initrd = cpioSum(bytes.subarray(start, start + (u32(bytes, header + 8) || rawSize)));
    cut = [start, start + rawSize];
    copy.fill(0, header + 8, header + 12); // VirtualSize
    copy.fill(0, header + 16, header + 20); // SizeOfRawData
    copy.fill(0, optional + 8, optional + 12); // SizeOfInitializedData
    copy.fill(0, optional + 56, optional + 60); // SizeOfImage
    // Sections stored after it move with its size.
    for (let other = 0; other < sections; other++) {
      const otherHeader = table + other * 40;
      if (u32(bytes, otherHeader + 20) > start) copy.fill(0, otherHeader + 20, otherHeader + 24);
    }
  }
  const parts = cut ? [copy.subarray(0, cut[0]), copy.subarray(cut[1])] : [copy];
  const sum = sha256(...parts, initrd?.sum ?? "");
  return { sum, detail: initrd ? `.initrd ${initrd.sum.slice(0, 16)} (${initrd.detail})` : "no .initrd" };
}

// --- disk image: GPT with a FAT ESP, or a bare FAT filesystem ----------------
// GPT: each partition's start, size and type, but not the disk or partition
// GUIDs. FAT: the file tree (names, sizes, contents), not timestamps, serial
// or free-space contents. .EFI files inside count by their PE sum, not their length.
function diskSum(bytes) {
  if (ascii(bytes, 512, 8) !== "EFI PART") return fatSum(bytes);
  const entriesLba = u64(bytes, 512 + 72);
  const count = u32(bytes, 512 + 80);
  const entrySize = u32(bytes, 512 + 84);
  const parts = [];
  for (let index = 0; index < count; index++) {
    const entry = entriesLba * 512 + index * entrySize;
    const type = bytes.subarray(entry, entry + 16);
    if (type.every((byte) => byte === 0)) continue;
    const first = u64(bytes, entry + 32);
    const last = u64(bytes, entry + 40);
    const fs = fatSum(bytes.subarray(first * 512, (last + 1) * 512));
    parts.push(`${Buffer.from(type).toString("hex")} ${first} ${last} ${fs.sum}\n`);
  }
  const lines = parts.map((line) => line.split(" ")[3].trim().slice(0, 16));
  return { sum: sha256(...parts), detail: `${parts.length} partition(s), files ${lines.join(", ")}` };
}

function fatSum(bytes) {
  const bytesPerSector = u16(bytes, 11);
  const sectorsPerCluster = bytes[13];
  const reserved = u16(bytes, 14);
  const fats = bytes[16];
  const rootEntries = u16(bytes, 17);
  const fatSize = u16(bytes, 22) || u32(bytes, 36);
  const totalSectors = u16(bytes, 19) || u32(bytes, 32);
  if (bytes[510] !== 0x55 || bytes[511] !== 0xaa || !bytesPerSector) throw new Error("no FAT filesystem");
  const rootSectors = Math.ceil((rootEntries * 32) / bytesPerSector);
  const dataStart = (reserved + fats * fatSize + rootSectors) * bytesPerSector;
  const clusterBytes = sectorsPerCluster * bytesPerSector;
  const clusters = (totalSectors * bytesPerSector - dataStart) / clusterBytes;
  const fat32 = clusters >= 65525;
  const fat12 = clusters < 4085;
  const fatOffset = reserved * bytesPerSector;
  const nextCluster = (cluster) => {
    if (fat32) return u32(bytes, fatOffset + cluster * 4) & 0x0fffffff;
    if (!fat12) return u16(bytes, fatOffset + cluster * 2);
    const value = u16(bytes, fatOffset + Math.floor(cluster * 1.5));
    return cluster & 1 ? value >> 4 : value & 0xfff;
  };
  const end = fat32 ? 0x0ffffff8 : fat12 ? 0xff8 : 0xfff8;
  const chain = (cluster) => {
    const pieces = [];
    for (; cluster >= 2 && cluster < end; cluster = nextCluster(cluster)) {
      const start = dataStart + (cluster - 2) * clusterBytes;
      pieces.push(bytes.subarray(start, start + clusterBytes));
    }
    return Buffer.concat(pieces);
  };
  const rootStart = (reserved + fats * fatSize) * bytesPerSector;
  const root = fat32 ? chain(u32(bytes, 44)) : bytes.subarray(rootStart, rootStart + rootEntries * 32);
  const files = [];
  const walk = (directory, path) => {
    for (let offset = 0; offset + 32 <= directory.length; offset += 32) {
      const first = directory[offset];
      if (first === 0) break;
      const attributes = directory[offset + 11];
      if (first === 0xe5 || attributes === 0x0f || attributes & 0x08) continue; // deleted, long name, label
      const base = ascii(directory, offset, 8).trimEnd();
      const extension = ascii(directory, offset + 8, 3).trimEnd();
      if (base === "." || base === "..") continue;
      const name = path + base + (extension ? "." + extension : "");
      const cluster = (u16(directory, offset + 20) << 16) | u16(directory, offset + 26);
      if (attributes & 0x10) {
        files.push(`${name}/\n`);
        walk(chain(cluster), name + "/");
      } else {
        const data = chain(cluster).subarray(0, u32(directory, offset + 28));
        // A UKI's length follows its .initrd's gzip size; its PE sum covers the rest.
        const pe = isPE(data);
        files.push(`${name} ${pe ? "pe" : data.length} ${pe ? peSum(data).sum : sha256(data)}\n`);
      }
    }
  };
  walk(root, "/");
  return { sum: sha256(...files), detail: files.map((line) => line.split(" ")[0].trim()).join(" ") };
}

const isPE = (bytes) => bytes[0] === 0x4d && bytes[1] === 0x5a && bytes.length > 0x40 &&
  ascii(bytes, u32(bytes, 0x3c), 4) === "PE\0\0";

function check(path) {
  const bytes = new Uint8Array(readFileSync(path));
  if ((bytes[0] === 0x1f && bytes[1] === 0x8b) || ascii(bytes, 0, 5) === "07070") return cpioSum(bytes);
  if (isPE(bytes)) return peSum(bytes);
  return diskSum(bytes);
}

const root = dirname(fileURLToPath(import.meta.url));
let paths = process.argv.slice(2);
if (paths.length === 0) {
  const boot = join(root, "vda/EFI/BOOT");
  paths = [
    join(root, "build/initramfs.cpio.gz"),
    ...(existsSync(boot) ? readdirSync(boot).filter((name) => /\.efi$/i.test(name)).sort().map((name) => join(boot, name)) : []),
    join(root, "vda.img"),
  ].filter((path) => existsSync(path));
}
let failed = false;
for (const path of paths) {
  try {
    const { sum, detail } = check(path);
    console.log(`${sum}  ${path}  (${detail})`);
  } catch (error) {
    console.error(`${path}: ${error.message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
