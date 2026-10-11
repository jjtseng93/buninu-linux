import { afterAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strippedName } from "../initramfs/lib/tar-strip.js";

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
