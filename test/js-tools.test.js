// The JS tools in initramfs/bin against the tools they stand in for, called
// with the flags the build scripts use. Outputs must be byte for byte the
// same, except where noted: mkfs.fat's boot code (GPL; ours only halts),
// the random GUIDs of parted, and gzip's compressed bytes (zlib is a
// different deflate encoder, so only its decompressed output is compared).
// A test is skipped when the reference tool is not installed.
//
//   bun test test/js-tools.test.js

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGpt, writeGpt } from "../initramfs/lib/gpt.js";

const bin = join(import.meta.dir, "../initramfs/bin");
const work = mkdtempSync(join(tmpdir(), "buninu-js-tools-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
const path = (name) => join(work, name);

// Same times everywhere, so mkfs.fat's volume ID and every FAT timestamp agree.
const env = { ...process.env, SOURCE_DATE_EPOCH: "1700000000", LC_ALL: "C" };
const have = (tool) => spawnSync("sh", ["-c", `command -v ${tool}`], { env }).status === 0;

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { env, cwd: work, maxBuffer: 1 << 30, ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} exited ${result.status}: ${result.stderr}`);
  return result.stdout;
};
const gnu = (tool, args, options) => run(tool, args, options);
const js = (tool, args, options) => run(process.execPath, [join(bin, tool), ...args], options);
const pick = (which) => (which === "gnu" ? gnu : js);

/** Deterministic pseudo-random bytes (compressible enough to be realistic). */
const bytes = (length, seed = 1) => {
  const buffer = Buffer.alloc(length);
  let state = seed;
  for (let index = 0; index < length; index++) {
    state = (state * 1103515245 + 12345) >>> 0;
    buffer[index] = index % 7 === 0 ? 0 : state >>> 24;
  }
  return buffer;
};

/** mkfs.fat's boot code (bytes 90..509 of the boot sector and its backup) is not compared. */
const maskBootCode = (image, offset = 0) => {
  for (const sector of [0, 6]) image.fill(0, offset + sector * 512 + 90, offset + sector * 512 + 510);
  return image;
};

const expectSameBytes = (a, b) => {
  expect(a.length).toBe(b.length);
  const first = a.findIndex((byte, index) => byte !== b[index]);
  expect(first).toBe(-1);
};

describe("gzip", () => {
  const payload = bytes(200_000);
  test.skipIf(!have("gzip"))("gzip -dc decompresses GNU gzip -9n output, as fetch-alpine.sh does with .ko.gz", () => {
    writeFileSync(path("payload"), payload);
    const compressed = gnu("gzip", ["-9n", "-c", path("payload")]);
    expectSameBytes(js("gzip", ["-dc"], { input: compressed }), gnu("gzip", ["-dc"], { input: compressed }));
  });
  test.skipIf(!have("gzip"))("concatenated members (an .apk) decompress as one stream", () => {
    const members = Buffer.concat([gnu("gzip", ["-9n"], { input: payload.subarray(0, 1000) }), gnu("gzip", ["-9n"], { input: payload.subarray(1000) })]);
    expectSameBytes(js("gzip", ["-dc"], { input: members }), gnu("gzip", ["-dc"], { input: members }));
  });
  test.skipIf(!have("gzip"))("gunzip -c and zcat match gzip -dc", () => {
    const compressed = gnu("gzip", ["-9n"], { input: payload });
    writeFileSync(path("payload.gz"), compressed);
    expectSameBytes(js("gunzip", ["-c", path("payload.gz")]), payload);
    expectSameBytes(js("zcat", [path("payload.gz")]), payload);
  });
  test.skipIf(!have("gzip"))("gzip -9n output is a valid gzip stream for GNU gzip (bytes differ: another encoder)", () => {
    expectSameBytes(gnu("gzip", ["-dc"], { input: js("gzip", ["-9n"], { input: payload }) }), payload);
  });
  test("in place: FILE -> FILE.gz -> FILE", () => {
    writeFileSync(path("inplace"), payload);
    js("gzip", [path("inplace")]);
    expect(() => statSync(path("inplace"))).toThrow();
    js("gunzip", [path("inplace.gz")]);
    expectSameBytes(readFileSync(path("inplace")), payload);
  });
});

describe("unzip", () => {
  test.skipIf(!have("zip") || !have("unzip"))("unzip -p MEMBER matches Info-ZIP, as fetch-bun.sh extracts bun", () => {
    writeFileSync(path("bun"), bytes(3_000_000, 7));
    writeFileSync(path("notes.txt"), "stored\n");
    run("sh", ["-c", "mkdir -p zipped/dir && cp bun zipped/dir/bun && cp notes.txt zipped/ && zip -qr -X archive.zip zipped && zip -q -0 -X archive.zip notes.txt"]);
    for (const member of ["zipped/dir/bun", "notes.txt", "zipped/notes.txt"]) {
      expectSameBytes(js("unzip", ["-p", path("archive.zip"), member]), gnu("unzip", ["-p", path("archive.zip"), member]));
    }
  });
  test.skipIf(!have("zip") || !have("unzip"))("unzip -d extracts the same tree as Info-ZIP", () => {
    js("unzip", ["-q", "-o", path("archive.zip"), "-d", path("js-tree")]);
    gnu("unzip", ["-q", "-o", path("archive.zip"), "-d", path("gnu-tree")]);
    expectSameBytes(readFileSync(path("js-tree/zipped/dir/bun")), readFileSync(path("gnu-tree/zipped/dir/bun")));
    expect(statSync(path("js-tree/zipped/dir/bun")).mode).toBe(statSync(path("gnu-tree/zipped/dir/bun")).mode);
  });
  const official = join(import.meta.dir, "../downloads/x86_64/bun-linux-x64-musl-baseline-1.4.2.zip");
  test.skipIf(!have("unzip") || !(() => { try { return statSync(official).isFile(); } catch { return false; } })())(
    "the pinned Bun release zip, as fetch-bun.sh reads it", () => {
      const member = "bun-linux-x64-musl-baseline/bun";
      expectSameBytes(js("unzip", ["-p", official, member]), gnu("unzip", ["-p", official, member]));
    });
});

describe("truncate and dd", () => {
  test.skipIf(!have("truncate"))("truncate -s SIZE creates the same sparse file as coreutils", () => {
    const size = String(260063 * 512);
    js("truncate", ["-s", size, path("js-t")]);
    gnu("truncate", ["-s", size, path("gnu-t")]);
    expect(statSync(path("js-t")).size).toBe(statSync(path("gnu-t")).size);
    js("truncate", ["-s", "+1M", path("js-t")]);
    gnu("truncate", ["-s", "+1M", path("gnu-t")]);
    expectSameBytes(readFileSync(path("js-t")), readFileSync(path("gnu-t")));
  });
  test.skipIf(!have("dd"))("dd bs=512 seek= count= conv=notrunc,sparse status=none, as build-image.sh places the ESP", () => {
    const source = Buffer.concat([bytes(4096, 3), Buffer.alloc(8192), bytes(1000, 4)]);
    writeFileSync(path("esp-part"), source);
    for (const which of ["gnu", "js"]) {
      writeFileSync(path(`${which}-disk`), bytes(64 * 512, 9));
      pick(which)("dd", [`if=${path("esp-part")}`, `of=${path(`${which}-disk`)}`, "bs=512", "seek=8", `count=${Math.ceil(source.length / 512)}`, "conv=notrunc,sparse", "status=none"]);
    }
    expectSameBytes(readFileSync(path("js-disk")), readFileSync(path("gnu-disk")));
  });
  test.skipIf(!have("dd"))("dd without notrunc cuts the output at the seek point", () => {
    for (const which of ["gnu", "js"]) {
      writeFileSync(path(`${which}-cut`), bytes(10_000, 5));
      pick(which)("dd", [`if=${path("esp-part")}`, `of=${path(`${which}-cut`)}`, "bs=512", "seek=2", "count=3", "status=none"]);
    }
    expectSameBytes(readFileSync(path("js-cut")), readFileSync(path("gnu-cut")));
  });
});

describe("FAT32: mkfs.fat, mmd, mcopy", () => {
  const fatTools = have("mkfs.fat") && have("mmd") && have("mcopy");
  const uki = bytes(5_000_000, 11);

  test.skipIf(!fatTools)("the ESP of build-image.sh: mkfs.fat -F 32 -h 2048 -n EFIBOOT, mmd, mcopy", () => {
    writeFileSync(path("uki.efi"), uki);
    for (const which of ["gnu", "js"]) {
      const tool = pick(which);
      const image = path(`${which}-esp.img`);
      tool("truncate", ["-s", String(260063 * 512), image]);
      tool("mkfs.fat", ["-F", "32", "-h", "2048", "-n", "EFIBOOT", image]);
      tool("mmd", ["-i", image, "::/EFI", "::/EFI/BOOT"]);
      tool("mcopy", ["-i", image, path("uki.efi"), "::/EFI/BOOT/BOOTX64.EFI"]);
    }
    expectSameBytes(maskBootCode(readFileSync(path("js-esp.img"))), maskBootCode(readFileSync(path("gnu-esp.img"))));
  });

  test.skipIf(!fatTools)("--invariant, lower-case and long names, and a directory that outgrows its cluster", () => {
    writeFileSync(path("small.bin"), bytes(5000, 13));
    for (const which of ["gnu", "js"]) {
      const tool = pick(which);
      const image = path(`${which}-edge.img`);
      tool("truncate", ["-s", String(100000 * 512), image]);
      tool("mkfs.fat", ["--invariant", "-F", "32", "-n", "MYLABEL", image]);
      tool("mmd", ["-i", image, "::/EFI", "::/EFI/BOOT", "::/Mixed Case Dir"]);
      tool("mcopy", ["-i", image, path("small.bin"), "::/EFI/BOOT/lower.efi"]);
      tool("mcopy", ["-i", image, path("small.bin"), "::/Mixed Case Dir/Long File Name.txt"]);
      tool("mcopy", ["-i", image, path("small.bin"), "::/README"]);
      for (let index = 1; index <= 40; index++) tool("mcopy", ["-i", image, path("small.bin"), `::/EFI/file${index}.dat`]);
    }
    expectSameBytes(maskBootCode(readFileSync(path("js-edge.img"))), maskBootCode(readFileSync(path("gnu-edge.img"))));
  });

  test.skipIf(!fatTools)("each side reads the other's image (mcopy -n -i IMAGE ::/file out)", () => {
    gnu("mcopy", ["-n", "-i", path("js-esp.img"), "::/EFI/BOOT/BOOTX64.EFI", path("from-js.efi")]);
    js("mcopy", ["-n", "-i", path("gnu-esp.img"), "::/EFI/BOOT/BOOTX64.EFI", path("from-gnu.efi")]);
    expectSameBytes(readFileSync(path("from-js.efi")), uki);
    expectSameBytes(readFileSync(path("from-gnu.efi")), uki);
  });

  test.skipIf(!have("fsck.fat") || !fatTools)("fsck.fat -n finds nothing wrong in the JS image", () => {
    expect(gnu("fsck.fat", ["-n", path("js-edge.img")]).toString()).toContain("files,");
  });
});

describe("GPT: parted", () => {
  test.skipIf(!have("parted"))("parted -s IMAGE mklabel gpt / unit s mkpart ESP fat32 / set 1 esp on, as build-image.sh", () => {
    const sectors = 262144;
    for (const which of ["gnu", "js"]) {
      const tool = pick(which);
      const image = path(`${which}-gpt.img`);
      tool("truncate", ["-s", String(sectors * 512), image]);
      tool("parted", ["-s", image, "mklabel", "gpt"]);
      tool("parted", ["-s", image, "unit", "s", "mkpart", "ESP", "fat32", "2048s", `${sectors - 34}s`]);
      tool("parted", ["-s", image, "set", "1", "esp", "on"]);
    }
    // The GUIDs are random on both sides: give ours parted's, then compare everything.
    const reference = openSync(path("gnu-gpt.img"), "r");
    const gnuTable = readGpt(reference, sectors);
    closeSync(reference);
    const ours = openSync(path("js-gpt.img"), "r+");
    const jsTable = readGpt(ours, sectors);
    expect(jsTable.entries.map(({ guid, ...rest }) => rest)).toEqual(gnuTable.entries.map(({ guid, ...rest }) => rest));
    jsTable.diskGuid = gnuTable.diskGuid;
    jsTable.entries.forEach((entry, index) => { entry.guid = gnuTable.entries[index].guid; });
    writeGpt(ours, sectors, jsTable);
    closeSync(ours);
    expectSameBytes(readFileSync(path("js-gpt.img")), readFileSync(path("gnu-gpt.img")));
  });

  test.skipIf(!have("sfdisk") || !have("parted"))("sfdisk reads the JS table", () => {
    const dump = gnu("sfdisk", ["-d", path("js-gpt.img")]).toString();
    expect(dump).toContain("start=        2048, size=      260063, type=C12A7328-F81F-11D2-BA4B-00A0C93EC93B");
    expect(dump).toContain('name="ESP"');
  });
});
