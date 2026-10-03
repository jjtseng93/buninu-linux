// /lib/fat.js — FAT32 for /bin/mkfs.fat, /bin/mmd, /bin/mcopy and /bin/mdir.
//
// Layout and directory entries follow what mkfs.fat 4.2 and mtools 4.0 write,
// so the same operations give the same bytes (the boot code of mkfs.fat
// aside: the boot sector here only halts): geometry and cluster size by
// image size, 32 reserved sectors with the FSInfo sector at 1 and the backup
// boot sector at 6, the smallest FAT that holds every cluster, data aligned
// to the cluster size, clusters allocated in order from the start, 8.3 names
// with the NT lower-case flags where they suffice and VFAT long names (and a
// NAME~N alias) where not. Only FAT32 and 512-byte sectors are supported.

import { closeSync, fstatSync, openSync, readSync, writeSync } from "node:fs";

export class FatError extends Error {}

const SECTOR = 512;
const MiB = 1024 * 1024;
const FREE = 0;
const END = 0x0fffffff;
const ATTR = { READ_ONLY: 0x01, HIDDEN: 0x02, SYSTEM: 0x04, VOLUME: 0x08, DIRECTORY: 0x10, ARCHIVE: 0x20, LONG_NAME: 0x0f };

const readAt = (fd, position, length) => {
  const buffer = Buffer.alloc(length);
  for (let done = 0; done < length;) {
    const count = readSync(fd, buffer, done, length - done, position + done);
    if (count === 0) throw new FatError(`unexpected end of image at ${position + done}`);
    done += count;
  }
  return buffer;
};

const writeAt = (fd, position, buffer) => {
  for (let done = 0; done < buffer.length;) done += writeSync(fd, buffer, done, buffer.length - done, position + done);
};

/** "image" or mtools' "image@@offset" (offset in bytes, or with K, M, G). */
export const parseImageSpec = (spec) => {
  const at = spec.lastIndexOf("@@");
  if (at < 0) return { path: spec, offset: 0 };
  const match = /^(\d+)([KMGkmg]?)$/.exec(spec.slice(at + 2));
  if (!match) throw new FatError(`bad offset in ${spec}`);
  return { path: spec.slice(0, at), offset: Number(match[1]) * ({ "": 1, k: 1024, m: MiB, g: 1024 * MiB }[match[2].toLowerCase()]) };
};

// --- time ------------------------------------------------------------------

/** "Now" for new entries: SOURCE_DATE_EPOCH when set, as mtools and mkfs.fat do. */
export const now = () => {
  const epoch = process.env.SOURCE_DATE_EPOCH;
  return epoch !== undefined && /^\d+$/.test(epoch) ? { date: new Date(Number(epoch) * 1000), fromEpoch: true } : { date: new Date(), fromEpoch: false };
};

/** DOS date and time words, in local time or UTC. */
export const dosTime = (date, utc = false) => {
  const get = (name) => date[`get${utc ? "UTC" : ""}${name}`]();
  const year = Math.min(Math.max(get("FullYear"), 1980), 2107);
  return {
    date: ((year - 1980) << 9) | ((get("Month") + 1) << 5) | get("Date"),
    time: (get("Hours") << 11) | (get("Minutes") << 5) | Math.floor(get("Seconds") / 2),
  };
};

// --- names -----------------------------------------------------------------

const SHORT_CHARS = /^[A-Z0-9!#$%&'()\-@^_`{}~\x80-\xff]+$/;

/** The 11-byte short name of a valid 8.3 name, or null. Case handled by the caller. */
const shortField = (base, extension) => Buffer.from(base.padEnd(8) + extension.padEnd(3), "latin1");

/**
 * How `name` is stored: a plain 8.3 entry (with the NT flags 0x08/0x10 for an
 * all-lower-case base/extension), or a long name needing an alias.
 */
const classify = (name) => {
  if (name === "." || name === "..") return { short: shortField(name, ""), ntFlags: 0, long: false };
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot + 1) : "";
  const fits = (part, length) => part.length > 0 && part.length <= length && SHORT_CHARS.test(part.toUpperCase()) && !/[^\x20-\x7e]/.test(part);
  const caseFlag = (part, flag) => part === part.toUpperCase() ? 0 : part === part.toLowerCase() ? flag : -1;
  if (fits(base, 8) && (extension === "" || fits(extension, 3)) && (dot <= 0 || dot === name.indexOf("."))) {
    const flags = [caseFlag(base, 0x08), extension ? caseFlag(extension, 0x10) : 0];
    if (!flags.includes(-1)) return { short: shortField(base.toUpperCase(), extension.toUpperCase()), ntFlags: flags[0] | flags[1], long: false };
  }
  return { long: true };
};

/** A NAME~N.EXT alias for a long name, unique among `taken` (11-byte keys). */
const aliasFor = (name, taken) => {
  const clean = (text) => text.toUpperCase().replace(/[ .]/g, "").replace(/[^A-Z0-9!#$%&'()\-@^_`{}~]/g, "_");
  const dot = name.lastIndexOf(".");
  const base = clean(dot > 0 ? name.slice(0, dot) : name) || "_";
  const extension = clean(dot > 0 ? name.slice(dot + 1) : "").slice(0, 3);
  for (let number = 1; number < 1000000; number++) {
    const tail = `~${number}`;
    const field = shortField(base.slice(0, 8 - tail.length) + tail, extension);
    if (!taken.has(field.toString("latin1"))) return field;
  }
  throw new FatError(`no short name left for ${name}`);
};

const checksum = (short) => {
  let sum = 0;
  for (const byte of short) sum = (((sum & 1) << 7) + (sum >> 1) + byte) & 0xff;
  return sum;
};

/** The VFAT long-name entries for `name`, last part first, as they are stored. */
const longEntries = (name, short) => {
  const units = [...Buffer.from(name, "utf16le")].length / 2;
  if (units > 255) throw new FatError(`name too long: ${name}`);
  const characters = Buffer.from(name, "utf16le");
  const count = Math.ceil(units / 13);
  const sum = checksum(short);
  const entries = [];
  for (let part = count; part >= 1; part--) {
    const entry = Buffer.alloc(32);
    entry[0] = part | (part === count ? 0x40 : 0);
    entry[11] = ATTR.LONG_NAME;
    entry[13] = sum;
    const slots = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30];
    slots.forEach((offset, index) => {
      const unit = (part - 1) * 13 + index;
      const value = unit < units ? characters.readUInt16LE(unit * 2) : unit === units ? 0x0000 : 0xffff;
      entry.writeUInt16LE(value, offset);
    });
    entries.push(entry);
  }
  return entries;
};

const shortName = (entry) => {
  const base = entry.toString("latin1", 0, 8).trimEnd();
  const extension = entry.toString("latin1", 8, 11).trimEnd();
  const lower = (text, flag) => entry[12] & flag ? text.toLowerCase() : text;
  return lower(base, 0x08) + (extension ? `.${lower(extension, 0x10)}` : "");
};

// --- mkfs ------------------------------------------------------------------

/**
 * mkfs.fat's parameters for an image of `sectors` sectors: the geometry it
 * picks for a file, the cluster size of the Microsoft table, and the total
 * cut to whole tracks.
 */
export const layout = (sectors, { sectorsPerCluster } = {}) => {
  const [perTrack, heads] = sectors <= 262144 ? [32, 8] : sectors <= 524288 ? [32, 16]
    : [63, sectors < 1048576 ? 16 : sectors < 2097152 ? 32 : sectors < 4194304 ? 64 : sectors < 8388608 ? 128 : 255];
  const total = Math.floor(sectors / perTrack) * perTrack;
  const perCluster = sectorsPerCluster ?? (sectors <= 532480 ? 1 : sectors <= 16777216 ? 8 : sectors <= 33554432 ? 16 : sectors <= 67108864 ? 32 : 64);
  let reserved = 32;
  let fatSize;
  for (;;) {
    // The smallest FAT that has an entry for every cluster it leaves.
    const clustersWith = (size) => Math.floor((total - reserved - 2 * size) / perCluster);
    const needed = (size) => Math.ceil((clustersWith(size) + 2) * 4 / SECTOR);
    let low = 1;
    let high = Math.ceil((total / perCluster + 2) * 4 / SECTOR);
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (needed(middle) <= middle) high = middle; else low = middle + 1;
    }
    fatSize = low;
    // Data starts on a cluster boundary.
    const misalignment = (reserved + 2 * fatSize) % perCluster;
    if (misalignment === 0) break;
    reserved += perCluster - misalignment;
  }
  const clusters = Math.floor((total - reserved - 2 * fatSize) / perCluster);
  if (clusters < 65525) throw new FatError(`${clusters} clusters is too few for FAT32 (needs 65525; the image must be at least about 33 MiB)`);
  if (clusters > 0x0ffffff4) throw new FatError("too many clusters for FAT32");
  return { perTrack, heads, total, perCluster, reserved, fatSize, clusters };
};

/**
 * Writes an empty FAT32 filesystem of `sectors` sectors at `offset` in `fd`.
 * `invariant` fixes the volume ID and times as mkfs.fat --invariant does.
 */
export const format = (fd, { offset = 0, sectors, label = "NO NAME", volumeId = null, hidden = 0, invariant = false, sectorsPerCluster } = {}) => {
  const geometry = layout(sectors, { sectorsPerCluster });
  const { date, fromEpoch } = invariant ? { date: new Date(1426325213 * 1000), fromEpoch: true } : now();
  const id = volumeId ?? (invariant ? 0x1234abcd : fromEpoch ? Math.floor(date.getTime() / 1000) >>> 0 : (Math.random() * 2 ** 32) >>> 0);
  const labelField = Buffer.from(label.toUpperCase().slice(0, 11).padEnd(11), "latin1");

  const boot = Buffer.alloc(SECTOR);
  boot.set([0xeb, 0x58, 0x90], 0);
  boot.write("mkfs.fat", 3, "latin1");
  boot.writeUInt16LE(SECTOR, 11);
  boot[13] = geometry.perCluster;
  boot.writeUInt16LE(geometry.reserved, 14);
  boot[16] = 2; // FATs
  boot[21] = 0xf8; // media: fixed disk
  boot.writeUInt16LE(geometry.perTrack, 24);
  boot.writeUInt16LE(geometry.heads, 26);
  boot.writeUInt32LE(hidden, 28);
  boot.writeUInt32LE(geometry.total, 32);
  boot.writeUInt32LE(geometry.fatSize, 36);
  boot.writeUInt32LE(2, 44); // root directory cluster
  boot.writeUInt16LE(1, 48); // FSInfo sector
  boot.writeUInt16LE(6, 50); // backup boot sector
  boot[64] = 0x80; // drive number
  boot[66] = 0x29; // extended boot signature
  boot.writeUInt32LE(id, 67);
  labelField.copy(boot, 71);
  boot.write("FAT32   ", 82, "latin1");
  boot.set([0xf4, 0xeb, 0xfd], 90); // not bootable: hlt; jmp $-1
  boot.writeUInt16LE(0xaa55, 510);

  const info = Buffer.alloc(SECTOR);
  info.writeUInt32LE(0x41615252, 0);
  info.writeUInt32LE(0x61417272, 484);
  info.writeUInt32LE(geometry.clusters - 1, 488); // the root directory takes one
  info.writeUInt32LE(2, 492);
  info.writeUInt32LE(0xaa550000, 508);

  // Reserved sectors, both FATs and the root directory cluster start zeroed.
  const zeroLength = (geometry.reserved + 2 * geometry.fatSize + geometry.perCluster) * SECTOR;
  const chunk = Buffer.alloc(Math.min(zeroLength, 4 * MiB));
  for (let done = 0; done < zeroLength; done += chunk.length) writeAt(fd, offset + done, chunk.subarray(0, Math.min(chunk.length, zeroLength - done)));
  writeAt(fd, offset, boot);
  writeAt(fd, offset + SECTOR, info);
  writeAt(fd, offset + 6 * SECTOR, boot);
  writeAt(fd, offset + 7 * SECTOR, info);
  const fatStart = Buffer.alloc(12);
  fatStart.writeUInt32LE(0x0ffffff8, 0); // media in entry 0
  fatStart.writeUInt32LE(0x0fffffff, 4);
  fatStart.writeUInt32LE(0x0ffffff8, 8); // root directory: one cluster
  for (let copy = 0; copy < 2; copy++) writeAt(fd, offset + (geometry.reserved + copy * geometry.fatSize) * SECTOR, fatStart);
  if (label.toUpperCase() !== "NO NAME") {
    const entry = Buffer.alloc(32);
    labelField.copy(entry, 0);
    entry[11] = ATTR.VOLUME;
    // mkfs.fat stamps the label in UTC for SOURCE_DATE_EPOCH and --invariant.
    const stamp = dosTime(date, fromEpoch);
    entry.writeUInt16LE(stamp.time, 14);
    entry.writeUInt16LE(stamp.date, 16);
    entry.writeUInt16LE(stamp.date, 18);
    entry.writeUInt16LE(stamp.time, 22);
    entry.writeUInt16LE(stamp.date, 24);
    writeAt(fd, offset + (geometry.reserved + 2 * geometry.fatSize) * SECTOR, entry);
  }
  return { ...geometry, volumeId: id };
};

// --- an existing filesystem --------------------------------------------------

export class Volume {
  constructor(fd, offset = 0) {
    this.fd = fd;
    this.offset = offset;
    const boot = readAt(fd, offset, SECTOR);
    if (boot.readUInt16LE(510) !== 0xaa55) throw new FatError("no FAT boot sector (missing 0x55AA)");
    if (boot.readUInt16LE(11) !== SECTOR) throw new FatError(`${boot.readUInt16LE(11)}-byte sectors are not supported`);
    if (boot.readUInt16LE(22) !== 0 || boot.readUInt16LE(17) !== 0) throw new FatError("only FAT32 is supported");
    this.perCluster = boot[13];
    this.reserved = boot.readUInt16LE(14);
    this.fats = boot[16];
    this.total = boot.readUInt32LE(32);
    this.fatSize = boot.readUInt32LE(36);
    this.rootCluster = boot.readUInt32LE(44);
    this.infoSector = boot.readUInt16LE(48);
    this.clusterBytes = this.perCluster * SECTOR;
    this.dataStart = this.reserved + this.fats * this.fatSize;
    this.clusters = Math.floor((this.total - this.dataStart) / this.perCluster);
    this.fat = readAt(fd, offset + this.reserved * SECTOR, this.fatSize * SECTOR);
    this.lastAllocated = null;
    this.dirty = false;
  }

  clusterPosition(cluster) {
    return this.offset + (this.dataStart + (cluster - 2) * this.perCluster) * SECTOR;
  }

  next(cluster) {
    return this.fat.readUInt32LE(cluster * 4) & 0x0fffffff;
  }

  setNext(cluster, value) {
    const high = this.fat.readUInt32LE(cluster * 4) & 0xf0000000;
    this.fat.writeUInt32LE((high | value) >>> 0, cluster * 4);
    this.dirty = true;
  }

  chain(start) {
    const clusters = [];
    for (let cluster = start; cluster >= 2 && cluster < 0x0ffffff8; cluster = this.next(cluster)) {
      if (clusters.length > this.clusters) throw new FatError("cluster chain loops");
      clusters.push(cluster);
    }
    return clusters;
  }

  readChain(start, length = Infinity) {
    const clusters = this.chain(start);
    const buffer = Buffer.alloc(Math.min(length, clusters.length * this.clusterBytes));
    // Consecutive clusters are read in one go.
    for (let index = 0; index < clusters.length && index * this.clusterBytes < buffer.length;) {
      let run = 1;
      while (index + run < clusters.length && clusters[index + run] === clusters[index] + run) run++;
      const start = index * this.clusterBytes;
      const size = Math.min(run * this.clusterBytes, buffer.length - start);
      readAt(this.fd, this.clusterPosition(clusters[index]), size).copy(buffer, start);
      index += run;
    }
    return buffer;
  }

  /** Allocates `count` clusters, the lowest free ones first, chained in order. */
  allocate(count) {
    const found = [];
    for (let cluster = 2; cluster < this.clusters + 2 && found.length < count; cluster++) {
      if (this.next(cluster) === FREE) found.push(cluster);
    }
    if (found.length < count) throw new FatError("no space left in the filesystem");
    found.forEach((cluster, index) => this.setNext(cluster, index + 1 < found.length ? found[index + 1] : END));
    if (found.length) this.lastAllocated = found.at(-1);
    return found;
  }

  free(start) {
    for (const cluster of this.chain(start)) this.setNext(cluster, FREE);
  }

  /** Writes `bytes` over the clusters of a chain, consecutive runs at once. */
  writeClusters(clusters, bytes) {
    for (let index = 0; index < clusters.length;) {
      let run = 1;
      while (index + run < clusters.length && clusters[index + run] === clusters[index] + run) run++;
      const slice = bytes.subarray(index * this.clusterBytes, (index + run) * this.clusterBytes);
      if (slice.length) writeAt(this.fd, this.clusterPosition(clusters[index]), slice);
      index += run;
    }
  }

  /** The entries of a directory: long name, short name, attributes, cluster, size and their slots. */
  entries(cluster) {
    const buffer = this.readChain(cluster);
    const entries = [];
    let pending = [];
    for (let slot = 0; slot * 32 < buffer.length; slot++) {
      const entry = buffer.subarray(slot * 32, slot * 32 + 32);
      if (entry[0] === 0x00) break;
      if (entry[0] === 0xe5) { pending = []; continue; }
      if (entry[11] === ATTR.LONG_NAME) { pending.push({ entry, slot }); continue; }
      let longName = null;
      if (pending.length && pending.every(({ entry: part }) => part[13] === checksum(entry.subarray(0, 11)))) {
        const units = [];
        for (const { entry: part } of [...pending].reverse()) {
          for (const offset of [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30]) units.push(part.readUInt16LE(offset));
        }
        const end = units.indexOf(0);
        longName = Buffer.from(Uint16Array.from(end < 0 ? units : units.slice(0, end)).buffer).toString("utf16le");
      }
      entries.push({
        name: longName ?? shortName(entry),
        short: Buffer.from(entry.subarray(0, 11)),
        attributes: entry[11],
        cluster: (entry.readUInt16LE(20) << 16) | entry.readUInt16LE(26),
        size: entry.readUInt32LE(28),
        time: entry.readUInt16LE(22),
        date: entry.readUInt16LE(24),
        slot,
        firstSlot: pending.length ? pending[0].slot : slot,
      });
      pending = [];
    }
    return entries;
  }

  /** The entry at `path` ("/" is the root, with its cluster), or null. */
  lookup(path) {
    let current = { attributes: ATTR.DIRECTORY, cluster: this.rootCluster, name: "/", root: true };
    for (const part of path.split("/").filter(Boolean)) {
      if (!(current.attributes & ATTR.DIRECTORY)) return null;
      const lower = part.toLowerCase();
      const found = this.entries(current.cluster || this.rootCluster)
        .find((entry) => !(entry.attributes & ATTR.VOLUME) && (entry.name.toLowerCase() === lower || shortName(entry.short).toLowerCase() === lower));
      if (!found) return null;
      current = found.cluster === 0 && found.attributes & ATTR.DIRECTORY ? { ...found, cluster: this.rootCluster } : found;
    }
    return current;
  }

  /** Adds raw 32-byte entries to a directory, growing it by a cluster if it is full. */
  addEntries(directoryCluster, raw) {
    for (;;) {
      const buffer = this.readChain(directoryCluster);
      let run = 0;
      for (let slot = 0; slot * 32 < buffer.length; slot++) {
        const first = buffer[slot * 32];
        run = first === 0x00 || first === 0xe5 ? run + 1 : 0;
        if (run === raw.length) {
          const start = slot - raw.length + 1;
          raw.forEach((entry, index) => entry.copy(buffer, (start + index) * 32));
          this.writeClusters(this.chain(directoryCluster), buffer);
          return;
        }
      }
      const clusters = this.chain(directoryCluster);
      const [added] = this.allocate(1);
      this.setNext(clusters.at(-1), added);
      writeAt(this.fd, this.clusterPosition(added), Buffer.alloc(this.clusterBytes));
    }
  }

  /** A short entry (plus long-name entries when needed) for `name` in a directory. */
  makeEntries(directoryCluster, name, { attributes, cluster, size, date }) {
    if (!name || /[\x00-\x1f"*/:<>?\\|]/.test(name) || name === "." || name === "..") throw new FatError(`invalid name: ${name}`);
    const kind = classify(name);
    let short = kind.short;
    let parts = [];
    if (kind.long) {
      const taken = new Set(this.entries(directoryCluster).map((entry) => entry.short.toString("latin1")));
      short = aliasFor(name, taken);
      parts = longEntries(name, short);
    }
    const entry = Buffer.alloc(32);
    short.copy(entry, 0);
    entry[11] = attributes;
    entry[12] = kind.long ? 0 : kind.ntFlags;
    const stamp = dosTime(date);
    entry.writeUInt16LE(stamp.time, 14);
    entry.writeUInt16LE(stamp.date, 16);
    entry.writeUInt16LE(stamp.date, 18);
    entry.writeUInt16LE(cluster >>> 16, 20);
    entry.writeUInt16LE(stamp.time, 22);
    entry.writeUInt16LE(stamp.date, 24);
    entry.writeUInt16LE(cluster & 0xffff, 26);
    entry.writeUInt32LE(size, 28);
    return [...parts, entry];
  }

  parentOf(path) {
    const parts = path.split("/").filter(Boolean);
    const name = parts.pop();
    if (!name) throw new FatError("the root directory already exists");
    const parent = this.lookup(parts.join("/"));
    if (!parent) throw new FatError(`${"/" + parts.join("/")}: no such directory`);
    if (!(parent.attributes & ATTR.DIRECTORY)) throw new FatError(`${"/" + parts.join("/")}: not a directory`);
    return { parent, name };
  }

  mkdir(path, date = now().date) {
    const { parent, name } = this.parentOf(path);
    if (this.lookup(path)) throw new FatError(`${path}: file exists`);
    const [cluster] = this.allocate(1);
    const parentCluster = parent.root ? 0 : parent.cluster;
    const block = Buffer.alloc(this.clusterBytes);
    const dot = (field, target) => {
      const entry = Buffer.alloc(32);
      Buffer.from(field.padEnd(11), "latin1").copy(entry, 0);
      entry[11] = ATTR.DIRECTORY;
      const stamp = dosTime(date);
      entry.writeUInt16LE(stamp.time, 14);
      entry.writeUInt16LE(stamp.date, 16);
      entry.writeUInt16LE(stamp.date, 18);
      entry.writeUInt16LE(target >>> 16, 20);
      entry.writeUInt16LE(stamp.time, 22);
      entry.writeUInt16LE(stamp.date, 24);
      entry.writeUInt16LE(target & 0xffff, 26);
      return entry;
    };
    dot(".", cluster).copy(block, 0);
    dot("..", parentCluster).copy(block, 32);
    writeAt(this.fd, this.clusterPosition(cluster), block);
    this.addEntries(parent.cluster, this.makeEntries(parent.cluster, name, { attributes: ATTR.DIRECTORY, cluster, size: 0, date }));
  }

  /** Writes a file at `path`; an existing file is replaced only with `overwrite`. */
  writeFile(path, bytes, { date = now().date, overwrite = false } = {}) {
    const { parent, name } = this.parentOf(path);
    const existing = this.lookup(path);
    if (existing) {
      if (existing.attributes & ATTR.DIRECTORY) throw new FatError(`${path}: is a directory`);
      if (!overwrite) throw new FatError(`${path}: file exists`);
      this.remove(path);
    }
    const clusters = this.allocate(Math.ceil(bytes.length / this.clusterBytes));
    this.writeClusters(clusters, bytes);
    this.addEntries(parent.cluster, this.makeEntries(parent.cluster, name, { attributes: ATTR.ARCHIVE, cluster: clusters[0] ?? 0, size: bytes.length, date }));
  }

  readFile(path) {
    const entry = this.lookup(path);
    if (!entry) throw new FatError(`${path}: no such file`);
    if (entry.attributes & ATTR.DIRECTORY) throw new FatError(`${path}: is a directory`);
    return this.readChain(entry.cluster, entry.size);
  }

  remove(path) {
    const { parent } = this.parentOf(path);
    const entry = this.lookup(path);
    if (!entry || entry.root) throw new FatError(`${path}: no such file`);
    if (entry.cluster) this.free(entry.cluster);
    const buffer = this.readChain(parent.cluster);
    for (let slot = entry.firstSlot; slot <= entry.slot; slot++) buffer[slot * 32] = 0xe5;
    this.writeClusters(this.chain(parent.cluster), buffer);
  }

  list(path) {
    const entry = this.lookup(path);
    if (!entry) throw new FatError(`${path}: no such file or directory`);
    if (!(entry.attributes & ATTR.DIRECTORY)) return [entry];
    return this.entries(entry.cluster);
  }

  /** Writes the FAT copies and the FSInfo sector (the backup copy is left alone, as mtools does). */
  flush() {
    if (!this.dirty) return;
    for (let copy = 0; copy < this.fats; copy++) writeAt(this.fd, this.offset + (this.reserved + copy * this.fatSize) * SECTOR, this.fat);
    let freeCount = 0;
    for (let cluster = 2; cluster < this.clusters + 2; cluster++) if (this.next(cluster) === FREE) freeCount++;
    const info = readAt(this.fd, this.offset + this.infoSector * SECTOR, SECTOR);
    if (info.readUInt32LE(0) === 0x41615252) {
      info.writeUInt32LE(freeCount, 488);
      if (this.lastAllocated !== null) info.writeUInt32LE(this.lastAllocated, 492);
      writeAt(this.fd, this.offset + this.infoSector * SECTOR, info);
    }
    this.dirty = false;
  }
}

export { ATTR };

/** Opens an mtools image spec read-write (or read-only) as a Volume. */
export const openVolume = (spec, writable = true) => {
  const { path, offset } = parseImageSpec(spec);
  let fd;
  try { fd = openSync(path, writable ? "r+" : "r"); } catch (error) { throw new FatError(`cannot open ${path}: ${error.message}`); }
  if (fstatSync(fd).size < offset + SECTOR) { closeSync(fd); throw new FatError(`${path}: no filesystem at offset ${offset}`); }
  const volume = new Volume(fd, offset);
  volume.close = () => { volume.flush(); closeSync(fd); };
  return volume;
};
