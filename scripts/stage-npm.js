// Assemble fetched packages in a disposable pack staging tree, never in the
// source initramfs. No registry access, dependency resolution or lifecycle code.
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { jsRuntime, rootDir, runIfMain } from "./arch.js";
import { npmDownloadsDir, npmPackages } from "./fetch-npm.js";

export function stageNpm(staging, { packages = npmPackages, downloadsDir = npmDownloadsDir } = {}) {
  const lib = resolve(staging, "usr/lib");
  if (existsSync(join(lib, "package.json")) || existsSync(join(lib, "node_modules"))) {
    throw new Error("npm staging destination already exists; refusing to overwrite it");
  }
  // Validate every archive before extracting any of them, including cached data.
  for (const pkg of packages) {
    const archive = join(downloadsDir, pkg.archive);
    if (!existsSync(archive)) throw new Error(`missing ${archive}; run the fetch stage first`);
    if (createHash("sha256").update(readFileSync(archive)).digest("hex") !== pkg.sha256) {
      throw new Error(`SHA-256 mismatch: ${archive}`);
    }
  }
  const runtime = jsRuntime();
  const probe = spawnSync(runtime, ["-e", "process.exit(typeof Bun === 'undefined' ? 1 : 0)"], { stdio: "ignore" });
  if (probe.status !== 0) throw new Error("JS npm extraction requires host Bun on PATH (for initramfs/bin/tar)");
  const bins = join(lib, "node_modules/.bin");
  mkdirSync(bins, { recursive: true });
  for (const pkg of packages) {
    const destination = join(lib, "node_modules", pkg.name);
    mkdirSync(destination, { recursive: true });
    const args = [join(rootDir, "initramfs/bin/tar"), "-xf", join(downloadsDir, pkg.archive),
      "-C", destination, "--strip-components=1"];
    if (pkg.name === "buninu-browser") args.push(
      "--exclude=package/usr/lib/canvaskit", "--exclude=package/usr/share/fonts");
    const result = spawnSync(runtime, args, { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`npm extraction failed: ${pkg.name}`);
    const info = JSON.parse(readFileSync(join(destination, "package.json"), "utf8"));
    if (info.name !== pkg.name || info.version !== pkg.version) throw new Error(`npm identity mismatch: ${pkg.name}`);
    const entries = typeof info.bin === "string" ? { [pkg.name.split("/").pop()]: info.bin } : info.bin ?? {};
    for (const [name, file] of Object.entries(entries)) {
      const target = resolve(destination, file);
      if (!/^[a-zA-Z0-9._-]+$/.test(name) || name === "." || name === ".."
          || !target.startsWith(destination + "/")) throw new Error(`unsafe npm bin: ${name}`);
      chmodSync(target, 0o755);
      symlinkSync(relative(bins, target), join(bins, name));
    }
  }
  writeFileSync(join(lib, "package.json"), JSON.stringify({
    name: "buninu-system-apps", private: true,
    dependencies: Object.fromEntries(packages.map(({ name, version }) => [name, version])),
  }, null, 2) + "\n");
}

runIfMain(import.meta.url, () => {
  if (!process.argv[2]) throw new Error("usage: bun scripts/stage-npm.js STAGING_DIRECTORY");
  stageNpm(process.argv[2]);
});
