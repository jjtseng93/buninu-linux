// /lib/gpt.js — GUID partition tables for /bin/parted.
//
// Writes what parted writes for a disk image: a protective MBR with one 0xEE
// partition over the disk, the primary header at LBA 1 with 128 entries of
// 128 bytes from LBA 2, and the backup entries and header at the end of the
// disk; first usable LBA 34. Only 512-byte sectors.

import { readSync, writeSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { crc32 } from "./crc32.js";

export class GptError extends Error {}

export const SECTOR = 512;
const ENTRIES = 128;
const ENTRY_SIZE = 128;
const ENTRY_SECTORS = (ENTRIES * ENTRY_SIZE) / SECTOR;

export const TYPES = {
  esp: "C12A7328-F81F-11D2-BA4B-00A0C93EC93B",
  msdata: "EBD0A0A2-B9E5-4433-87C0-68B6B72699C7",
  linux: "0FC63DAF-8483-4772-8E79-3D69D8477DE4",
  swap: "0657FD6D-A4AB-43C4-84E5-0933C84B4F4F",
  bios_grub: "21686148-6449-6E6F-744E-656564454649",
};

/** GUID text to its on-disk bytes: the first three fields little-endian. */
export const guidBytes = (text) => {
  const hex = text.replace(/-/g, "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new GptError(`bad GUID ${text}`);
  const bytes = Buffer.from(hex, "hex");
  bytes.subarray(0, 4).reverse();
  bytes.subarray(4, 6).reverse();
  bytes.subarray(6, 8).reverse();
  return bytes;
};

export const guidText = (buffer, offset = 0) => {
  const bytes = Buffer.from(buffer.subarray(offset, offset + 16));
  bytes.subarray(0, 4).reverse();
  bytes.subarray(4, 6).reverse();
  bytes.subarray(6, 8).reverse();
  const hex = bytes.toString("hex").toUpperCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const randomGuid = () => randomUUID().toUpperCase();

const readAt = (fd, position, length) => {
  const buffer = Buffer.alloc(length);
  for (let done = 0; done < length;) {
    const count = readSync(fd, buffer, done, length - done, position + done);
    if (count === 0) throw new GptError("unexpected end of disk");
    done += count;
  }
  return buffer;
};

const writeAt = (fd, position, buffer) => {
  for (let done = 0; done < buffer.length;) done += writeSync(fd, buffer, done, buffer.length - done, position + done);
};

/** The usable range of a disk of `sectors` sectors. */
export const usable = (sectors) => ({ first: 2 + ENTRY_SECTORS, last: sectors - 2 - ENTRY_SECTORS });

/** The table on the disk (primary, else backup), or null when neither is valid. */
export const readGpt = (fd, sectors) => {
  for (const lba of [1, sectors - 1]) {
    const header = readAt(fd, lba * SECTOR, SECTOR);
    if (header.toString("latin1", 0, 8) !== "EFI PART") continue;
    const size = header.readUInt32LE(12);
    const check = Buffer.from(header.subarray(0, size));
    check.writeUInt32LE(0, 16);
    if (crc32(check) !== header.readUInt32LE(16)) continue;
    const count = header.readUInt32LE(80);
    const entrySize = header.readUInt32LE(84);
    const table = readAt(fd, Number(header.readBigUInt64LE(72)) * SECTOR, count * entrySize);
    if (crc32(table) !== header.readUInt32LE(88)) continue;
    const entries = [];
    for (let index = 0; index < count; index++) {
      const entry = table.subarray(index * entrySize, (index + 1) * entrySize);
      if (entry.subarray(0, 16).every((byte) => byte === 0)) continue;
      const name = entry.subarray(56, 128).toString("utf16le").replace(/\0.*$/s, "");
      entries.push({
        number: index + 1,
        type: guidText(entry, 0),
        guid: guidText(entry, 16),
        first: Number(entry.readBigUInt64LE(32)),
        last: Number(entry.readBigUInt64LE(40)),
        attributes: entry.readBigUInt64LE(48),
        name,
      });
    }
    return { diskGuid: guidText(header, 56), entries };
  }
  return null;
};

/** Writes the protective MBR and both copies of the table. */
export const writeGpt = (fd, sectors, { diskGuid, entries }) => {
  const { first, last } = usable(sectors);
  const table = Buffer.alloc(ENTRIES * ENTRY_SIZE);
  for (const entry of entries) {
    if (entry.number < 1 || entry.number > ENTRIES) throw new GptError(`partition number ${entry.number} out of range`);
    const slot = table.subarray((entry.number - 1) * ENTRY_SIZE, entry.number * ENTRY_SIZE);
    guidBytes(entry.type).copy(slot, 0);
    guidBytes(entry.guid).copy(slot, 16);
    slot.writeBigUInt64LE(BigInt(entry.first), 32);
    slot.writeBigUInt64LE(BigInt(entry.last), 40);
    slot.writeBigUInt64LE(BigInt(entry.attributes ?? 0n), 48);
    const name = Buffer.from(entry.name ?? "", "utf16le");
    if (name.length > 72) throw new GptError(`partition name too long: ${entry.name}`);
    name.copy(slot, 56);
  }
  const tableCrc = crc32(table);
  const header = (current, backup, tableLba) => {
    const buffer = Buffer.alloc(SECTOR);
    buffer.write("EFI PART", 0, "latin1");
    buffer.writeUInt32LE(0x00010000, 8);
    buffer.writeUInt32LE(92, 12);
    buffer.writeBigUInt64LE(BigInt(current), 24);
    buffer.writeBigUInt64LE(BigInt(backup), 32);
    buffer.writeBigUInt64LE(BigInt(first), 40);
    buffer.writeBigUInt64LE(BigInt(last), 48);
    guidBytes(diskGuid).copy(buffer, 56);
    buffer.writeBigUInt64LE(BigInt(tableLba), 72);
    buffer.writeUInt32LE(ENTRIES, 80);
    buffer.writeUInt32LE(ENTRY_SIZE, 84);
    buffer.writeUInt32LE(tableCrc, 88);
    buffer.writeUInt32LE(crc32(buffer.subarray(0, 92)), 16);
    return buffer;
  };
  const mbr = readAt(fd, 0, SECTOR);
  mbr.fill(0, 446, 510);
  mbr.set([0x00, 0x00, 0x02, 0x00, 0xee, 0xff, 0xff, 0xff], 446);
  mbr.writeUInt32LE(1, 454);
  mbr.writeUInt32LE(Math.min(sectors - 1, 0xffffffff), 458);
  mbr.writeUInt16LE(0xaa55, 510);
  writeAt(fd, 0, mbr);
  writeAt(fd, SECTOR, header(1, sectors - 1, 2));
  writeAt(fd, 2 * SECTOR, table);
  writeAt(fd, (sectors - 1 - ENTRY_SECTORS) * SECTOR, table);
  writeAt(fd, (sectors - 1) * SECTOR, header(sectors - 1, 1, sectors - 1 - ENTRY_SECTORS));
};
