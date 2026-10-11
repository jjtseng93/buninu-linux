import { afterAll, expect, test } from "bun:test";
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "buninu-npm-launchers-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
mkdirSync(join(root, "bin"));

for (const [name, entry] of [["jspulse", "jspulse.js"]]) {
  test(`${name}: physical import launcher preserves arguments, cwd, environment and exit status`, () => {
    const source = new URL(`../initramfs/bin/${name}`, import.meta.url);
    expect(lstatSync(source).isFile()).toBe(true);
    expect(lstatSync(source).mode & 0o111).toBe(0o111);
    const launcher = join(root, "bin", name);
    copyFileSync(source, launcher);
    const pkg = join(root, "usr/lib/node_modules/@drxiaozhi", name);
    mkdirSync(pkg, { recursive: true });
    writeFileSync(join(pkg, entry), `
      console.log(JSON.stringify({args: process.argv.slice(2), cwd: process.cwd(),
        marker: process.env.BUNINU_LAUNCHER_TEST, dir: import.meta.dir}));
      process.exit(17);
    `);
    const args = ["--help", "value with spaces", "--", "-p", "4714"];
    const result = spawnSync(process.execPath, [launcher, ...args], {
      cwd: root, env: { ...process.env, BUNINU_LAUNCHER_TEST: "preserved" }, encoding: "utf8",
    });
    expect(result.status).toBe(17);
    expect(JSON.parse(result.stdout)).toEqual({ args, cwd: root, marker: "preserved", dir: pkg });
  });
}

test("jspinyin bypasses upstream bun x and forwards arguments to system jsmdcui with im.md", () => {
  const source = new URL("../initramfs/bin/jspinyin", import.meta.url);
  expect(lstatSync(source).isFile()).toBe(true);
  expect(lstatSync(source).mode & 0o111).toBe(0o111);
  const launcher = join(root, "bin/jspinyin");
  copyFileSync(source, launcher);
  const pkg = join(root, "usr/lib/node_modules/@drxiaozhi/jspinyin");
  mkdirSync(pkg, { recursive: true });
  writeFileSync(join(pkg, "index.js"), "throw new Error('upstream launcher must not run');");
  writeFileSync(join(pkg, "im.md"), "# input method");
  const system = join(root, "buninu/apps/jsmdcui/src");
  mkdirSync(system, { recursive: true });
  writeFileSync(join(system, "index.js"), `
    console.log(JSON.stringify({args: process.argv.slice(2), cwd: process.cwd(),
      marker: process.env.BUNINU_LAUNCHER_TEST, dir: import.meta.dir}));
    process.exit(23);
  `);
  const args = ["--remote-debugging-port=9222", "value with spaces"];
  const result = spawnSync(process.execPath, [launcher, ...args], {
    cwd: root, env: { ...process.env, BUNINU_LAUNCHER_TEST: "preserved" }, encoding: "utf8",
  });
  expect(result.status).toBe(23);
  expect(JSON.parse(result.stdout)).toEqual({
    args: ["--tui", ...args, join(pkg, "im.md")], cwd: root, marker: "preserved", dir: system,
  });
});
