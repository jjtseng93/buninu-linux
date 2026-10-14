// Run with Bun inside bunproot or the Buninu Linux VM.
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertAbsent, bootstrap, download, hasBuninuId, normalizeArch, options,
} from "../initramfs/usr/lib/bootstrap/lib/common.js";

const work = mkdtempSync(join(tmpdir(), "bootstrap-test-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

test("architecture aliases and optional destination", () => {
  for (const alias of ["a", "arm64", "aarch64"]) {
    expect(options([alias])).toEqual({ arch: "aarch64", rootfs: resolve("roota") });
  }
  for (const alias of ["x", "x64", "x86_64", "x86-64"]) {
    expect(options([alias])).toEqual({ arch: "x86_64", rootfs: resolve("rootx") });
  }
  const arch = normalizeArch(process.arch);
  expect(options([])).toEqual({ arch, rootfs: resolve(arch === "aarch64" ? "roota" : "rootx") });
  expect(options(["./a path's root"])).toEqual({ arch, rootfs: resolve("./a path's root") });
  expect(options(["x", "./custom"])).toEqual({ arch: "x86_64", rootfs: resolve("custom") });
  expect(() => options(["--arch", "x"])).toThrow();
  expect(() => options(["x", "one", "two"])).toThrow();
  expect(() => normalizeArch("riscv64")).toThrow();
});

test("local mode requires the exact ID, never NAME or a substring", () => {
  for (const value of ["buninu-linux", '"buninu-linux"', "'buninu-linux'"]) {
    expect(hasBuninuId(`NAME="Buninu Linux"\nID=${value}\n`)).toBe(true);
  }
  for (const text of [
    'NAME="Buninu Linux"\nID=alpine\n',
    'ID_LIKE=buninu-linux\n', '# ID=buninu-linux\n',
    'ID=buninu-linux-other\n', 'ID=buninu-linux\nID=alpine\n',
    'ID="$(echo buninu-linux)"\n',
  ]) expect(hasBuninuId(text)).toBe(false);
});

test("existing destinations, including dangling links, are refused", () => {
  const file = join(work, "file"), link = join(work, "link");
  writeFileSync(file, "keep me");
  symlinkSync("missing", link);
  expect(() => assertAbsent(file)).toThrow("Refusing existing destination");
  expect(() => assertAbsent(link)).toThrow("Refusing existing destination");
  expect(() => assertAbsent(join(work, "new"))).not.toThrow();
  expect(readFileSync(file, "utf8")).toBe("keep me");
});

test("a corrupt cached tarball is rejected before extraction or refetch", async () => {
  const old = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = work;
  try {
    const [url, pin] = Bun.YAML.parse(readFileSync(join(bootstrap, "downloads.md"), "utf8"))["buninu-linux@0.9.56"];
    const cache = join(work, "buninu-bootstrap");
    mkdirSync(cache);
    writeFileSync(join(cache, pin.slice(7) + "-" + new URL(url).pathname.split("/").at(-1)), "corrupt");
    await expect(download("buninu-linux@0.9.56")).rejects.toThrow("Cached file hash mismatch");
    await expect(download("unlisted@version")).rejects.toThrow("Missing or invalid download pin");
  } finally {
    if (old === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = old;
  }
});
