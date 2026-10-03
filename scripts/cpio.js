#!/usr/bin/env bun
// Writes the initramfs without fakeroot, cpio or gzip: a gzipped newc
// archive of a directory tree, plus device nodes that exist only in the
// archive. pack-initramfs.sh runs it instead of `fakeroot-tcp ... cpio |
// gzip` when BUNINU_JS_CPIO=1. Written against node: APIs only, so it runs
// under node as well as bun.
//
//   scripts/cpio.js DIRECTORY OUTPUT.cpio.gz [PATH:c:MAJOR:MINOR:MODE]...
//
// e.g. dev/console:c:5:1:0600. Like `find . | sort | cpio --create
// --format=newc --owner=0:0 --reproducible` with the nodes made by mknod:
// every entry is owned by 0:0, inode numbers count up from 1 and device
// numbers of the containing filesystem are 0. Entries are sorted by name
// byte by byte, so the archive does not depend on the locale. mtimes are the
// files' own, or SOURCE_DATE_EPOCH for every entry when it is set; the
// device nodes get SOURCE_DATE_EPOCH or the current time.

import { lstatSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { constants, gzipSync } from "node:zlib";

const fail = (message) => {
  console.error(`cpio.js: ${message}`);
  process.exit(1);
};

const [directory, output, ...deviceSpecs] = process.argv.slice(2);
if (!directory || !output) fail("usage: cpio.js DIRECTORY OUTPUT.cpio.gz [PATH:c:MAJOR:MINOR:MODE]...");
const epoch = process.env.SOURCE_DATE_EPOCH === undefined ? null : Number(process.env.SOURCE_DATE_EPOCH);
if (epoch !== null && !Number.isInteger(epoch)) fail(`SOURCE_DATE_EPOCH is not a number: ${process.env.SOURCE_DATE_EPOCH}`);

const S_IFMT = 0o170000;
const S_IFDIR = 0o040000;
const S_IFREG = 0o100000;
const S_IFLNK = 0o120000;
const S_IFCHR = 0o020000;
const S_IFBLK = 0o060000;

// Every path under the directory, relative to it.
const entries = [];
const walk = (relative) => {
  for (const name of readdirSync(join(directory, relative))) {
    const path = relative ? `${relative}/${name}` : name;
    const stat = lstatSync(join(directory, path));
    entries.push({ path, stat });
    if (stat.isDirectory()) walk(path);
  }
};
walk("");

const now = Math.floor(Date.now() / 1000);
const existing = new Set(entries.map(({ path }) => path));
for (const spec of deviceSpecs) {
  const [path, kind, major, minor, mode] = spec.split(":");
  if (!path || !["c", "b"].includes(kind) || !/^\d+$/.test(major) || !/^\d+$/.test(minor) || !/^[0-7]{3,4}$/.test(mode)) {
    fail(`bad device ${spec}; expected PATH:c:MAJOR:MINOR:MODE`);
  }
  if (existing.has(path)) fail(`${path} already exists in ${directory}`);
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (parent && !existing.has(parent)) fail(`${path}: no directory ${parent} in ${directory}`);
  entries.push({
    path,
    device: { mode: (kind === "c" ? S_IFCHR : S_IFBLK) | parseInt(mode, 8), major: Number(major), minor: Number(minor) },
  });
  existing.add(path);
}
entries.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));

const chunks = [];
const hex = (value) => (value >>> 0).toString(16).padStart(8, "0");
const pad = (length) => { if (length % 4) chunks.push(Buffer.alloc(4 - (length % 4))); };
const add = (name, { ino, mode, nlink, mtime, data, rdevMajor = 0, rdevMinor = 0 }) => {
  const nameBytes = Buffer.from(`${name}\0`);
  // magic, ino, mode, uid, gid, nlink, mtime, filesize, devmajor, devminor,
  // rdevmajor, rdevminor, namesize, check
  const header = Buffer.from("070701" + [ino, mode, 0, 0, nlink, mtime, data.length, 0, 0, rdevMajor, rdevMinor, nameBytes.length, 0]
    .map(hex).join(""), "latin1");
  chunks.push(header, nameBytes);
  pad(header.length + nameBytes.length);
  chunks.push(data);
  pad(data.length);
};

entries.forEach(({ path, stat, device }, index) => {
  const ino = index + 1;
  if (device) {
    add(path, { ino, mode: device.mode, nlink: 1, mtime: epoch ?? now, data: Buffer.alloc(0), rdevMajor: device.major, rdevMinor: device.minor });
    return;
  }
  const type = stat.mode & S_IFMT;
  const mtime = epoch ?? Math.floor(stat.mtimeMs / 1000);
  let data = Buffer.alloc(0);
  let nlink = 1;
  if (type === S_IFREG) data = readFileSync(join(directory, path));
  else if (type === S_IFLNK) data = Buffer.from(readlinkSync(join(directory, path)));
  else if (type === S_IFDIR) nlink = stat.nlink;
  else fail(`${path}: unsupported file type ${type.toString(8)}; pass device nodes as PATH:c:MAJOR:MINOR:MODE`);
  add(path, { ino, mode: stat.mode, nlink, mtime, data });
});
add("TRAILER!!!", { ino: 0, mode: 0, nlink: 1, mtime: 0, data: Buffer.alloc(0) });
// GNU cpio pads the archive to a 512-byte block.
const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
if (total % 512) chunks.push(Buffer.alloc(512 - (total % 512)));

// Like `gzip -9n`: zlib leaves the name out and writes 0 as the mtime.
writeFileSync(output, gzipSync(Buffer.concat(chunks), { level: constants.Z_BEST_COMPRESSION }));
console.log(`cpio.js: ${output}: ${entries.length} entries`);
