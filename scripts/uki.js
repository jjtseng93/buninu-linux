#!/usr/bin/env bun
// Assembles a UKI without binutils: the systemd EFI stub (a PE32+ image,
// x86_64 or aarch64) with .osrel, .cmdline, .linux and .initrd added as
// read-only data sections. build-uki.sh runs it instead of objdump/objcopy
// when BUNINU_JS_UKI=1. Written from the PE/COFF specification against
// node: APIs only, so it runs under node as well as bun.
//
//   scripts/uki.js STUB OUTPUT .osrel=FILE .cmdline=FILE .linux=FILE .initrd=FILE
//
// The section addresses follow build-uki.sh: the conventional offsets from
// the image base (.osrel +0x20000, .cmdline +0x30000, .linux +0x2000000,
// .initrd +0x3000000), moved up when the stub or the kernel is larger. The
// stub's own headers and sections are kept where they are; the new sections
// are appended to the file. TimeDateStamp is SOURCE_DATE_EPOCH when set,
// otherwise the stub's own, so the output depends only on the inputs.

import { readFileSync, writeFileSync } from "node:fs";

const fail = (message) => {
  console.error(`uki.js: ${message}`);
  process.exit(1);
};

const [stubPath, outputPath, ...pairs] = process.argv.slice(2);
if (!stubPath || !outputPath) fail("usage: uki.js STUB OUTPUT .osrel=FILE .cmdline=FILE .linux=FILE .initrd=FILE");
const files = new Map();
for (const pair of pairs) {
  const separator = pair.indexOf("=");
  if (separator < 1) fail(`expected .section=FILE, got ${pair}`);
  files.set(pair.slice(0, separator), pair.slice(separator + 1));
}
const order = [".osrel", ".cmdline", ".linux", ".initrd"];
for (const name of order) if (!files.has(name)) fail(`missing ${name}=FILE`);
if (files.size !== order.length) fail(`only ${order.join(", ")} are supported`);

const stub = readFileSync(stubPath);
if (stub.toString("latin1", 0, 2) !== "MZ") fail(`${stubPath} is not a PE image`);
const pe = stub.readUInt32LE(0x3c);
if (stub.toString("latin1", pe, pe + 4) !== "PE\0\0") fail(`${stubPath} is not a PE image`);
const coff = pe + 4;
const sectionCount = stub.readUInt16LE(coff + 2);
const optionalSize = stub.readUInt16LE(coff + 16);
const optional = coff + 20;
if (stub.readUInt16LE(optional) !== 0x20b) fail(`${stubPath} is not PE32+`);
if (stub.readUInt32LE(coff + 8) !== 0) fail(`${stubPath} has a COFF symbol table, which is not supported`);
const imageBase = stub.readBigUInt64LE(optional + 24);
const sectionAlignment = stub.readUInt32LE(optional + 32);
const fileAlignment = stub.readUInt32LE(optional + 36);
const stubImageSize = stub.readUInt32LE(optional + 56);
const headersSize = stub.readUInt32LE(optional + 60);
const directoryCount = stub.readUInt32LE(optional + 108);
// A signature (the certificate table) covers the file up to its end;
// appending after it would invalidate it.
if (directoryCount > 4 && stub.readUInt32LE(optional + 112 + 4 * 8 + 4) !== 0) {
  fail(`${stubPath} is signed; adding sections would break the signature`);
}

const table = optional + optionalSize;
let firstData = stub.length;
for (let index = 0; index < sectionCount; index++) {
  const header = table + index * 40;
  const raw = stub.readUInt32LE(header + 20);
  if (stub.readUInt32LE(header + 16) && raw) firstData = Math.min(firstData, raw);
}
const tableEnd = table + (sectionCount + order.length) * 40;
if (tableEnd > Math.min(headersSize, firstData)) {
  fail(`no room in ${stubPath}'s headers for ${order.length} more section headers`);
}

const alignUp = (value, alignment) => Math.ceil(value / alignment) * alignment;
const data = order.map((name) => readFileSync(files.get(name)));
const [, , kernel] = data;
const osrel = Math.max(0x20000, alignUp(stubImageSize, 0x10000));
const cmdline = osrel + 0x10000;
const linux = Math.max(0x2000000, alignUp(cmdline + 0x10000, 0x1000000));
const initrd = Math.max(0x3000000, alignUp(linux + kernel.length, 0x1000000));
const addresses = [osrel, cmdline, linux, initrd];
if (data[0].length > 0x10000 || data[1].length > 0x10000) fail(".osrel and .cmdline must each fit in 64 KiB");

// Section contents go after everything already in the file, each at a
// FileAlignment boundary and padded to a multiple of it.
let offset = alignUp(stub.length, fileAlignment);
const pointers = data.map((bytes) => {
  const pointer = offset;
  offset += alignUp(bytes.length, fileAlignment);
  return pointer;
});
const output = Buffer.alloc(offset);
stub.copy(output);
order.forEach((name, index) => {
  const header = table + (sectionCount + index) * 40;
  const bytes = data[index];
  output.fill(0, header, header + 40);
  output.write(name, header, 8, "latin1");
  output.writeUInt32LE(bytes.length, header + 8); // VirtualSize
  output.writeUInt32LE(addresses[index], header + 12); // VirtualAddress
  output.writeUInt32LE(alignUp(bytes.length, fileAlignment), header + 16); // SizeOfRawData
  output.writeUInt32LE(pointers[index], header + 20); // PointerToRawData
  // IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ: objcopy's
  // contents,alloc,load,readonly,data.
  output.writeUInt32LE(0x40000040, header + 36);
  bytes.copy(output, pointers[index]);
});
output.writeUInt16LE(sectionCount + order.length, coff + 2);
// SizeOfCode, SizeOfInitializedData and SizeOfUninitializedData: the raw
// sizes of the sections of each kind, recomputed as objcopy does.
const sizes = [0, 0, 0];
for (let index = 0; index < sectionCount + order.length; index++) {
  const header = table + index * 40;
  const characteristics = output.readUInt32LE(header + 36);
  const rawSize = output.readUInt32LE(header + 16);
  [0x20, 0x40, 0x80].forEach((flag, kind) => { if (characteristics & flag) sizes[kind] += rawSize; });
}
sizes.forEach((size, kind) => output.writeUInt32LE(size >>> 0, optional + 4 + kind * 4));
output.writeUInt32LE(alignUp(initrd + data[3].length, sectionAlignment), optional + 56); // SizeOfImage
if (process.env.SOURCE_DATE_EPOCH !== undefined) {
  output.writeUInt32LE(Number(process.env.SOURCE_DATE_EPOCH) >>> 0, coff + 4);
}

// The PE checksum: 16-bit one's-complement-style sum of the file with the
// CheckSum field itself taken as zero, plus the file length.
output.writeUInt32LE(0, optional + 64);
let sum = 0;
for (let index = 0; index + 1 < output.length; index += 2) {
  sum += output.readUInt16LE(index);
  sum = (sum & 0xffff) + (sum >>> 16);
}
if (output.length & 1) {
  sum += output[output.length - 1];
  sum = (sum & 0xffff) + (sum >>> 16);
}
output.writeUInt32LE(((sum & 0xffff) + output.length) >>> 0, optional + 64);

writeFileSync(outputPath, output);
const hex = (value) => `0x${value.toString(16)}`;
console.log(`uki.js: ${outputPath}: image base ${hex(imageBase)}, ${order.map((name, index) => `${name} +${hex(addresses[index])}`).join(", ")}`);
