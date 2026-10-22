import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { stageNpm } from "../scripts/stage-npm.js";
import { npmPackages, npmDownloadsDir } from "../scripts/fetch-npm.js";
import { ensureBrowserResources, ensureLandResources } from "../initramfs/lib/browser-resources.js";

const work = mkdtempSync(join(tmpdir(), "buninu-stage-npm-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));
let sequence = 0;
const fresh = () => { const dir = join(work, String(sequence++)); mkdirSync(dir); return dir; };

async function fixture() {
  const downloadsDir = fresh();
  const packages = [];
  for (const name of ["buninu-browser", "buninu-land", "@drxiaozhi/casty", "@drxiaozhi/jspulse", "@drxiaozhi/jspinyin"]) {
    const bin = name.split("/").pop();
    const data = await new Bun.Archive({
      "package/package.json": JSON.stringify({ name, version: "1.0.0", type: "module", bin: { [bin]: "index.js" } }),
      "package/index.js": "#!/usr/bin/env bun\n",
      "package/LICENSE": "keep license",
      "package/usr/README.md": "keep resource documentation",
      "package/usr/lib/canvaskit/data": "only browser excludes this",
      "package/usr/share/fonts/data": "only browser excludes this",
      "package/lib/data": "keep data",
      "package/vendor/canvaskit/canvaskit.wasm": "different wasm must be retained",
    }, { compress: "gzip" }).bytes();
    const archive = bin + ".tgz";
    writeFileSync(join(downloadsDir, archive), data);
    packages.push({ name, version: "1.0.0", archive, sha256: createHash("sha256").update(data).digest("hex") });
  }
  return { downloadsDir, packages };
}

test("stages standard scoped layout, manifest, bins and browser-only exclusion", async () => {
  const cfg = await fixture(), root = fresh();
  stageNpm(root, cfg);
  const lib = join(root, "usr/lib");
  expect(JSON.parse(readFileSync(join(lib, "package.json"))).dependencies)
    .toEqual(Object.fromEntries(cfg.packages.map(p => [p.name, p.version])));
  for (const pkg of cfg.packages) {
    const dir = join(lib, "node_modules", pkg.name);
    expect(readFileSync(join(dir, "LICENSE"), "utf8")).toBe("keep license");
    expect(existsSync(join(dir, "package"))).toBe(false);
    expect(readFileSync(join(dir, "usr/README.md"), "utf8")).toBe("keep resource documentation");
    expect(existsSync(join(dir, "usr/lib/canvaskit"))).toBe(pkg.name !== "buninu-browser");
    expect(existsSync(join(dir, "usr/share/fonts"))).toBe(pkg.name !== "buninu-browser");
    expect(readFileSync(join(dir, "vendor/canvaskit/canvaskit.wasm"), "utf8")).toBe("different wasm must be retained");
    expect(statSync(join(dir, "index.js")).mode & 0o111).toBe(0o111);
    expect(readlinkSync(join(lib, "node_modules/.bin", pkg.name.split("/").pop())))
      .toBe(`../${pkg.name}/index.js`);
  }
  expect(() => stageNpm(root, cfg)).toThrow("already exists");
});

test("rejects missing/corrupt cache before writing a staging destination", async () => {
  const cfg = await fixture(), root = fresh();
  writeFileSync(join(cfg.downloadsDir, cfg.packages[3].archive), "corrupt");
  expect(() => stageNpm(root, cfg)).toThrow("SHA-256 mismatch");
  expect(existsSync(join(root, "usr"))).toBe(false);
  rmSync(join(cfg.downloadsDir, cfg.packages[3].archive));
  expect(() => stageNpm(root, cfg)).toThrow("fetch stage");
});

test("resource links use distinct relative destinations, repeat safely and preserve npm resources", () => {
  const root = fresh();
  mkdirSync(join(root, "lib/canvaskit"), { recursive: true });
  mkdirSync(join(root, "usr/share/fonts"), { recursive: true });
  const browser = join(root, "usr/lib/node_modules/buninu-browser");
  mkdirSync(browser, { recursive: true });
  ensureBrowserResources(browser, root);
  ensureBrowserResources(browser, root);
  for (const [local, shared] of [["usr/lib/canvaskit", "lib/canvaskit"], ["usr/share/fonts", "usr/share/fonts"]]) {
    const link = join(browser, local), target = readlinkSync(link);
    expect(target.startsWith("/")).toBe(false);
    expect(resolve(link, "..", target)).toBe(join(root, shared));
    expect(statSync(link).isDirectory()).toBe(true);
  }
  const fonts = join(browser, "usr/share/fonts");
  rmSync(fonts); mkdirSync(fonts); writeFileSync(join(fonts, "custom"), "preserved");
  ensureBrowserResources(browser, root);
  expect(readFileSync(join(fonts, "custom"), "utf8")).toBe("preserved");
});

test("distribution launcher ensures resources then forwards to local casty without bunx", async () => {
  const cfg = await fixture(), root = fresh();
  stageNpm(root, cfg);
  const browser = join(root, "usr/lib/node_modules/buninu-browser");
  mkdirSync(join(root, "lib/canvaskit"), { recursive: true });
  mkdirSync(join(root, "usr/share/fonts"), { recursive: true });
  mkdirSync(join(root, "bin"));
  copyFileSync(new URL("../initramfs/bin/buninu-browser", import.meta.url), join(root, "bin/buninu-browser"));
  copyFileSync(new URL("../initramfs/lib/browser-resources.js", import.meta.url), join(root, "lib/browser-resources.js"));
  writeFileSync(join(browser, "index.js"), `
    import { statSync } from 'node:fs';
    if (!statSync(import.meta.dir + '/usr/lib/canvaskit').isDirectory()) throw Error('missing');
    export const chooseFrontend = args => ({ frontend: 'casty', args: args[0] === '--casty' ? args.slice(1) : args });
  `);
  writeFileSync(join(root, "usr/lib/node_modules/@drxiaozhi/casty/index.js"),
    "console.log(JSON.stringify({args:process.argv.slice(2),engine:process.env.CASTY_BROWSER}));");
  for (const args of [
    ["https://example.test", "--", "--chromium"],
    ["--", "--help"],
    ["--", "--version"],
    ["--", "--window-size=160,90"],
  ]) {
    const result = spawnSync(process.execPath, [join(root, "bin/buninu-browser"), "--casty", ...args], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ args, engine: join(browser, "buninu-browser.js") });
  }
});

test("land launcher selects bundled casty and preserves package frontend dispatch", async () => {
  const cfg = await fixture(), root = fresh();
  stageNpm(root, cfg);
  const land = join(root, "usr/lib/node_modules/buninu-land");
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, "lib"), { recursive: true });
  copyFileSync(new URL("../initramfs/lib/browser-resources.js", import.meta.url), join(root, "lib/browser-resources.js"));
  const launcher = join(root, "bin/buninu-land");
  copyFileSync(new URL("../initramfs/bin/buninu-land", import.meta.url), launcher);
  writeFileSync(join(land, "index.js"), `
    export const chooseFrontend = args => ({
      frontend: !args.length || args[0] === '--casty' || args[0] === 'about:blank' ? 'casty' : 'other',
      args: args[0] === '--casty' ? args.slice(1) : args,
    });
    if (import.meta.main) console.log(JSON.stringify({ package: true, args: process.argv.slice(2) }));
  `);
  writeFileSync(join(root, "usr/lib/node_modules/@drxiaozhi/casty/index.js"),
    "console.log(JSON.stringify({args:process.argv.slice(2),engine:process.env.CASTY_BROWSER}));");
  for (const args of [[], ['about:blank'], ['--casty', '--', '--socket=wayland-test']]) {
    const result = spawnSync(process.execPath, [launcher, ...args], {
      encoding: "utf8", env: { ...process.env, CASTY_BROWSER: '/previous/browser' },
    });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      args: ['--no-shortcuts', ...(args[0] === '--casty' ? args.slice(1) : args)],
      engine: join(land, "compositor.js"),
    });
  }
  for (const args of [['--headless', '--help'], ['--help'], ['--version'], ['--docs'], ['--gtk']]) {
    const result = spawnSync(process.execPath, [launcher, ...args], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ package: true, args });
  }
});

test.skipIf(!npmPackages.every(pkg => existsSync(join(npmDownloadsDir, pkg.archive))))("real cached pins: JS and shell staging agree; browser headless help starts", () => {
  const js = fresh(), shell = fresh();
  stageNpm(js);
  const result = spawnSync("bash", [join(import.meta.dir, "../scripts/stage-npm.sh"), shell], { encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(readFileSync(join(shell, "usr/lib/package.json"), "utf8")).toBe(readFileSync(join(js, "usr/lib/package.json"), "utf8"));
  for (const root of [js, shell]) {
    expect(existsSync(join(root, "usr/lib/node_modules/buninu-land/vendor/canvaskit/canvaskit.wasm"))).toBe(false);
    expect(existsSync(join(root, "usr/lib/node_modules/buninu-browser/usr/README.md"))).toBe(true);
    expect(existsSync(join(root, "usr/lib/node_modules/buninu-browser/usr/lib/canvaskit"))).toBe(false);
    expect(existsSync(join(root, "usr/lib/node_modules/buninu-browser/usr/share/fonts"))).toBe(false);
    for (const pkg of npmPackages) {
      const info = JSON.parse(readFileSync(join(root, "usr/lib/node_modules", pkg.name, "package.json")));
      expect([info.name, info.version]).toEqual([pkg.name, pkg.version]);
    }
  }
  mkdirSync(join(js, "lib")); mkdirSync(join(js, "usr/share")); mkdirSync(join(js, "bin"));
  symlinkSync(resolve(import.meta.dir, "../initramfs/lib/canvaskit"), join(js, "lib/canvaskit"));
  symlinkSync(resolve(import.meta.dir, "../initramfs/usr/share/fonts"), join(js, "usr/share/fonts"));
  copyFileSync(new URL("../initramfs/bin/buninu-browser", import.meta.url), join(js, "bin/buninu-browser"));
  copyFileSync(new URL("../initramfs/lib/browser-resources.js", import.meta.url), join(js, "lib/browser-resources.js"));
  const help = spawnSync(process.execPath, [join(js, "bin/buninu-browser"), "--headless", "--help"], { encoding: "utf8", timeout: 15000 });
  expect(help.status).toBe(0);
  expect(help.stdout).toContain("Usage");
  copyFileSync(new URL("../initramfs/bin/buninu-land", import.meta.url), join(js, "bin/buninu-land"));
  for (const args of [["--help"], ["--headless", "--help"], ["--version"]]) {
    const landHelp = spawnSync(process.execPath, [join(js, "bin/buninu-land"), ...args], { encoding: "utf8", timeout: 15000 });
    expect(landHelp.status).toBe(0);
    expect(landHelp.stdout).toContain(args[0] === "--version" ? "0.1.3" : args[0] === "--headless" ? "Wayland compositor" : "Usage");
  }
  const landWasm = join(js, "usr/lib/node_modules/buninu-land/vendor/canvaskit/canvaskit.wasm");
  expect(readlinkSync(landWasm).startsWith("/")).toBe(false);
  expect(readFileSync(landWasm).equals(readFileSync(join(js, "lib/canvaskit/canvaskit.wasm")))).toBe(true);
  expect(existsSync(join(js, "usr/lib/node_modules/buninu-land/LICENSES/hyprland.txt"))).toBe(true);
}, 30000);

test("land resource link is relative, repeatable, and preserves a package-owned WASM", () => {
  const root = fresh(), land = join(root, "usr/lib/node_modules/buninu-land");
  mkdirSync(join(root, "lib/canvaskit"), { recursive: true });
  writeFileSync(join(root, "lib/canvaskit/canvaskit.wasm"), "shared");
  ensureLandResources(land, root); ensureLandResources(land, root);
  const wasm = join(land, "vendor/canvaskit/canvaskit.wasm");
  expect(readlinkSync(wasm).startsWith("/")).toBe(false);
  expect(readFileSync(wasm, "utf8")).toBe("shared");
  rmSync(wasm); writeFileSync(wasm, "package-owned");
  ensureLandResources(land, root);
  expect(readFileSync(wasm, "utf8")).toBe("package-owned");
});
