import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strippedName } from "../initramfs/lib/tar-strip.js";
import { excludeMatcher } from "../initramfs/lib/tar-exclude.js";

const work = mkdtempSync(join(tmpdir(), "buninu-tar-strip-"));
const cli = join(import.meta.dir, "../initramfs/bin/tar");
afterAll(() => rmSync(work, { recursive: true, force: true }));
let sequence = 0;
const run = (args, input) => spawnSync(process.execPath, [cli, ...args], { input, encoding: "utf8" });

// Small ustar fixtures, including links and extension headers Bun.Archive
// cannot create. All extraction is confined to this test's private directory.
function tar(entries) {
  const chunks = [];
  for (const { name, data = "", type = "0", target = "" } of entries) {
    const body = Buffer.from(data);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(body.length.toString(8).padStart(11, "0") + "\0", 124);
    header.write("00000000000\0", 136);
    header.fill(32, 148, 156);
    header.write(type, 156);
    header.write(target, 157, 100);
    header.write("ustar\0", 257);
    header.write("00", 263);
    const sum = header.reduce((a, b) => a + b, 0);
    header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
    chunks.push(header, body, Buffer.alloc((512 - body.length % 512) % 512));
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)]);
}

const payload = tar([
  { name: "top.txt", data: "skip" },
  { name: "package/", type: "5" },
  { name: "package/empty/", type: "5" },
  { name: "package/lib/a.txt", data: "hello" },
  { name: "package/hard", type: "1", target: "package/lib/a.txt" },
  { name: "package/sym", type: "2", target: "lib/a.txt" },
  { name: "package/absolute", type: "2", target: "/bin/busybox" },
]);

function extract(bytes, flags = ["--strip-components=1"], stdin = false) {
  const dir = join(work, String(sequence++));
  const archive = dir + ".tar";
  writeFileSync(archive, bytes);
  const result = run(["-xf", stdin ? "-" : archive, "-C", dir, ...flags], stdin ? bytes : undefined);
  return { dir, archive, ...result };
}

test("exclude matches path boundaries, ancestors, dot paths and wildcard patterns", () => {
  const excluded = excludeMatcher(["package/usr/", "*.map", ".wh.*"]);
  for (const name of ["package/usr", "./package/usr/a/b", "package/lib/a.map", "package/.wh.foo"])
    expect(excluded(name)).toBe(true);
  for (const name of ["package/usr2/a", "package/user/a", "package/lib/a.js"])
    expect(excluded(name)).toBe(false);
});

test("exclude works before strip, with zero strip, compression and stdin", () => {
  const bytes = tar([
    { name: "package/usr/deep/data", data: "excluded without a directory header" },
    { name: "package/usr/link", type: "2", target: "/outside" },
    { name: "package/keep[*].js", data: "keep literal name" },
    { name: "package/usr2/data", data: "keep boundary" },
    { name: "package/debug.map", data: "exclude repeated pattern" },
    { name: "package/hard", type: "1", target: "package/usr/deep/data" },
  ]);
  for (const strip of [0, 1]) {
    for (const input of [bytes, Bun.gzipSync(bytes), Bun.zstdCompressSync(bytes)]) {
      const result = extract(input, [`--strip-components=${strip}`, "--exclude=package/usr", "--exclude", "*.map"], true);
      expect(result.status).toBe(0);
      const root = strip ? result.dir : join(result.dir, "package");
      expect(readFileSync(join(root, "keep[*].js"), "utf8")).toBe("keep literal name");
      expect(existsSync(join(root, "usr"))).toBe(false);
      expect(existsSync(join(root, "hard"))).toBe(false);
      expect(existsSync(join(root, "debug.map"))).toBe(false);
      expect(existsSync(join(root, "usr2/data"))).toBe(true);
    }
  }
});

test("exclude handles listing, all excluded, member selection and missing arguments", () => {
  const result = extract(payload, ["--exclude=*"]);
  expect(result.status).toBe(0);
  expect(existsSync(join(result.dir, "package"))).toBe(false);
  const listed = run(["-tf", result.archive, "--exclude=package"]);
  expect(listed.status).toBe(0);
  expect(listed.stdout.trim()).toBe("top.txt");
  const selected = extract(payload, ["--strip-components=1", "package/lib", "--exclude=package/lib"]);
  expect(selected.status).toBe(0);
  expect(existsSync(join(selected.dir, "lib"))).toBe(false);
  expect(run(["-xf", "unused", "--exclude"]).status).toBe(2);
});

test("exclude skips creation subtrees and never overwrites excluded destination files", () => {
  const source = extract(payload, []);
  const created = join(work, "exclude-create.tar");
  expect(run(["-cf", created, "-C", source.dir, "--exclude=package/lib", "package/lib", "top.txt"]).status).toBe(0);
  expect(run(["-tf", created]).stdout.trim()).toBe("top.txt");
  const dest = join(work, "exclude-existing");
  mkdirSync(join(dest, "package/lib"), { recursive: true });
  writeFileSync(join(dest, "package/lib/a.txt"), "original");
  const result = run(["-xf", source.archive, "-C", dest, "--exclude=package/lib"]);
  expect(result.status).toBe(0);
  expect(readFileSync(join(dest, "package/lib/a.txt"), "utf8")).toBe("original");
  expect(existsSync(join(dest, "package/hard"))).toBe(false);
});

test("strips npm prefix, preserves empty directories and both link types", () => {
  const result = extract(payload);
  expect(result.status).toBe(0);
  expect(readFileSync(join(result.dir, "lib/a.txt"), "utf8")).toBe("hello");
  expect(existsSync(join(result.dir, "top.txt"))).toBe(false);
  expect(existsSync(join(result.dir, "package"))).toBe(false);
  expect(statSync(join(result.dir, "empty")).isDirectory()).toBe(true);
  expect(statSync(join(result.dir, "hard")).ino).toBe(statSync(join(result.dir, "lib/a.txt")).ino);
  expect(readlinkSync(join(result.dir, "sym"))).toBe("lib/a.txt");
  expect(readlinkSync(join(result.dir, "absolute"))).toBe("/bin/busybox");
});

test("space form, gzip/zstd, stdin, and member filtering before stripping", () => {
  for (const bytes of [payload, Bun.gzipSync(payload), Bun.zstdCompressSync(payload)]) {
    const result = extract(bytes, ["--strip-components", "2", "package/lib"], true);
    expect(result.status).toBe(0);
    expect(readFileSync(join(result.dir, "a.txt"), "utf8")).toBe("hello");
    expect(existsSync(join(result.dir, "hard"))).toBe(false);
  }
});

test("default and explicit zero preserve the original Bun.Archive layout", () => {
  for (const flags of [[], ["--strip-components=0"]]) {
    const result = extract(payload, flags);
    expect(result.status).toBe(0);
    expect(readFileSync(join(result.dir, "package/lib/a.txt"), "utf8")).toBe("hello");
    expect(readFileSync(join(result.dir, "top.txt"), "utf8")).toBe("skip");
    expect(readlinkSync(join(result.dir, "package/sym"))).toBe("lib/a.txt");
  }
});

test("listing keeps original names and excessive stripping skips members", () => {
  const result = extract(payload, ["--strip-components=99"]);
  expect(result.status).toBe(0);
  expect(existsSync(join(result.dir, "lib"))).toBe(false);
  const listed = run(["-tf", result.archive, "--strip-components=1"]);
  expect(listed.status).toBe(0);
  expect(listed.stdout).toContain("package/lib/a.txt");
});

test("rejects malformed counts and missing arguments", () => {
  for (const count of ["", "-1", "1.5", "abc", "9007199254740992"]) {
    expect(run(["-xf", "unused", `--strip-components=${count}`]).status).toBe(2);
  }
  expect(run(["-xf", "unused", "--strip-components"]).status).toBe(2);
});

test("dot prefix counts, and GNU long names survive stripping", () => {
  expect(strippedName("./package/a", 1)).toBe("package/a");
  expect(strippedName("package//lib/a", 1)).toBe("lib/a");
  const long = "x".repeat(120);
  const result = extract(tar([
    { name: "././@LongLink", type: "L", data: `package/${long}\0` },
    { name: "placeholder", data: "long" },
    { name: "./package/dot", data: "dot" },
  ]));
  expect(result.status).toBe(0);
  expect(readFileSync(join(result.dir, long), "utf8")).toBe("long");
  expect(readFileSync(join(result.dir, "package/dot"), "utf8")).toBe("dot");
});

test("refuses traversal before stripping and unsafe hardlink targets", () => {
  for (const entries of [
    [{ name: "../escape", data: "bad" }],
    [{ name: "package/../escape", data: "bad" }],
    [{ name: "package/hard", type: "1", target: "../outside" }],
  ]) expect(extract(tar(entries)).status).toBe(2);
});

test("PAX names and forward hardlink chains use stripped destinations", () => {
  const record = (key, value) => {
    const tail = ` ${key}=${value}\n`;
    let length = tail.length + 1;
    while (String(length).length + tail.length !== length) length = String(length).length + tail.length;
    return `${length}${tail}`;
  };
  const result = extract(tar([
    { name: "package/first", type: "1", target: "package/second" },
    { name: "package/second", type: "1", target: "package/actual" },
    { name: "pax", type: "x", data: record("path", "package/actual") },
    { name: "placeholder", data: "pax" },
  ]));
  expect(result.status).toBe(0);
  expect(readFileSync(join(result.dir, "first"), "utf8")).toBe("pax");
  expect(statSync(join(result.dir, "first")).ino).toBe(statSync(join(result.dir, "actual")).ino);
});

test("does not follow a pre-existing symlink parent or an archive symlink parent", () => {
  const out = join(work, "symlink-output");
  const outside = join(work, "outside");
  mkdirSync(out); mkdirSync(outside);
  symlinkSync(outside, join(out, "lib"));
  const archive = join(work, "symlink.tar");
  writeFileSync(archive, payload);
  expect(run(["-xf", archive, "-C", out, "--strip-components=1"]).status).toBe(2);
  expect(existsSync(join(outside, "a.txt"))).toBe(false);
  const result = extract(tar([
    { name: "package/link", type: "2", target: outside },
    { name: "package/link/nested", type: "2", target: "anything" },
  ]));
  expect(result.status).toBe(2);
  expect(existsSync(join(outside, "nested"))).toBe(false);
});

test("APK concatenated gzip/tar streams list and extract every section", () => {
  const signature = tar([{ name: ".SIGN.test", data: "signature" }]);
  const control = tar([{ name: ".PKGINFO", data: "pkgname = sample\n" }]);
  const data = tar([
    { name: "usr/include/stdio.h", data: "header\n" },
    { name: "usr/lib/crt1.o", data: "object\n" },
    { name: "usr/lib/link", type: "2", target: "crt1.o" },
  ]);
  // APK signature/control streams can omit end markers; also cover complete
  // concatenated tar archives, and a single gzip stream containing them all.
  for (const raw of [false, true]) {
    const parts = [raw ? signature.subarray(0, -1024) : signature,
      raw ? control.subarray(0, -1024) : control, data];
    for (const bytes of [Buffer.concat(parts.map(p => Bun.gzipSync(p))), Bun.gzipSync(Buffer.concat(parts))]) {
      const result = extract(bytes, [], true);
      expect(result.status).toBe(0);
      expect(readFileSync(join(result.dir, ".PKGINFO"), "utf8")).toBe("pkgname = sample\n");
      expect(readFileSync(join(result.dir, "usr/include/stdio.h"), "utf8")).toBe("header\n");
      expect(readlinkSync(join(result.dir, "usr/lib/link"))).toBe("crt1.o");
      const listed = run(["-tf", "-"], bytes);
      expect(listed.status).toBe(0);
      expect(listed.stdout.trim().split("\n")).toEqual([
        ".SIGN.test", ".PKGINFO", "usr/include/stdio.h", "usr/lib/crt1.o", "usr/lib/link",
      ]);
      const selected = extract(bytes, ["usr/include"], true);
      expect(selected.status).toBe(0);
      expect(existsSync(join(selected.dir, ".PKGINFO"))).toBe(false);
      expect(readFileSync(join(selected.dir, "usr/include/stdio.h"), "utf8")).toBe("header\n");
      const stripped = extract(bytes, ["--strip-components=2", "--exclude=usr/lib", "usr"], true);
      expect(stripped.status).toBe(0);
      expect(readFileSync(join(stripped.dir, "stdio.h"), "utf8")).toBe("header\n");
      expect(existsSync(join(stripped.dir, "crt1.o"))).toBe(false);
    }
  }
});
