// Firmware is image data, not a running service. Only cfg.gpu loads GPU drivers.
import { createHash } from "node:crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, symlinkSync, statSync, mkdtempSync, renameSync } from "node:fs";
import { join, dirname, posix } from "node:path";
import pins from "./gpu-firmware.json" with { type: "json" };
import { config, runIfMain, withUmask022 } from "./arch.js";
import { download, readTar } from "./fetch.js";

const fingerprint = (cfg) => createHash("sha256").update(JSON.stringify({ revision: 2, arch: cfg.arch, release: cfg.kernelRelease, real: !!cfg.real, noGpu: !!cfg.noGpu, pins })).digest("hex");
const marker = (cfg) => join(cfg.modulesRoot, "gpu-support.json");

export const gpuReady = (cfg) => {
  try {
    const state = JSON.parse(readFileSync(marker(cfg), "utf8"));
    if (cfg.noGpu && existsSync(join(cfg.nativeDir, "lib/firmware"))) return false;
    return state.fingerprint === fingerprint(cfg) && state.files.every(path => statSync(join(cfg.nativeDir, path)).size > 0);
  } catch { return false; }
};

// Validate paths before writing; firmware packages can link across GPU folders.
export const firmwarePath = (name) => {
  if (!name.startsWith("lib/firmware/") || name.includes("\\") || posix.normalize(name) !== name || name.endsWith("/"))
    throw Error(`Invalid firmware path: ${name}`);
  return name;
};
export const firmwareLinkTarget = (name, { target, hard }) => {
  firmwarePath(name);
  if (target.startsWith("/") || target.includes("\\")) throw Error(`Invalid firmware link: ${name} -> ${target}`);
  return firmwarePath(posix.normalize(hard ? target : posix.join(posix.dirname(name), target)));
};

export const extractFirmware = (archives, staging) => {
  const files = new Map(), links = new Map();
  for (const archive of archives) {
    for (const [name, bytes] of archive.entries()) if (name.startsWith("lib/firmware/")) files.set(firmwarePath(name), bytes);
    for (const [name, link] of archive.links()) if (name.startsWith("lib/firmware/")) {
      firmwareLinkTarget(name, link);
      links.set(name, link);
    }
  }
  const directories = new Set();
  for (const name of [...files.keys(), ...links.keys()])
    for (let parent = posix.dirname(name); parent !== "."; parent = posix.dirname(parent)) directories.add(parent);
  // NVIDIA also aliases entire GPU firmware directories. Resolve links in any
  // path component, without following host filesystem links during validation.
  const resolve = (name, seen = new Set()) => {
    if (seen.has(name)) throw Error(`Firmware link cycle: ${name}`);
    seen.add(name);
    for (let prefix = name; prefix !== "."; prefix = posix.dirname(prefix)) {
      const link = links.get(prefix);
      if (link) {
        if (seen.has("link:" + prefix)) throw Error(`Firmware link cycle: ${prefix}`);
        seen.add("link:" + prefix);
        return resolve(firmwareLinkTarget(prefix, link) + name.slice(prefix.length), seen);
      }
    }
    if (files.has(name)) return files.get(name);
    if (directories.has(name)) return null;
    throw Error(`Missing firmware link target: ${name}`);
  };
  for (const name of [...files.keys(), ...links.keys()]) {
    for (let parent = posix.dirname(name); parent !== "."; parent = posix.dirname(parent))
      if (links.has(parent) || files.has(parent)) throw Error(`Firmware parent is not a directory: ${parent}`);
    if (links.has(name)) {
      if (files.has(name)) throw Error(`Duplicate firmware file/link: ${name}`);
      if (resolve(name) === null && links.get(name).hard) throw Error(`Firmware hardlink to directory: ${name}`);
    }
  }
  for (const [name, bytes] of files) {
    const path = join(staging, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes);
  }
  for (const [name, link] of links) {
    const path = join(staging, name); mkdirSync(dirname(path), { recursive: true });
    if (files.has(name)) throw Error(`Duplicate firmware file/link: ${name}`);
    if (link.hard) writeFileSync(path, resolve(name));
    else symlinkSync(link.target, path);
  }
  return [...files.keys(), ...links.keys()];
};

export const fetchGpuFirmware = (cfg = config()) => withUmask022(async () => {
  const dep = readFileSync(join(cfg.modulesRoot, "modules.dep"), "utf8");
  const builtin = readFileSync(join(cfg.modulesRoot, "modules.builtin"), "utf8");
  const pc = !cfg.noGpu && cfg.arch === "x86_64" && /\/(?:i915|xe|amdgpu|radeon|nouveau)\.ko(?:[:\n]|$)/.test(dep + "\n" + builtin);
  // Firmware bytes are architecture-independent; these pins refer to the x86_64 APKs.
  const packages = pc ? pins : [];
  const archives = [];
  for (const pkg of packages) archives.push(readTar(await download(cfg, `${cfg.alpineBase}/${pkg.name}`, pkg.name, pkg.sha256)));
  mkdirSync(join(cfg.nativeDir, "lib"), { recursive: true });
  const staging = mkdtempSync(join(cfg.nativeDir, "lib", ".gpu-firmware-"));
  try {
    const files = extractFirmware(archives, staging);
    const target = join(cfg.nativeDir, "lib/firmware");
    // This generated directory is owned by the firmware fetch stage.
    rmSync(target, { recursive: true, force: true });
    if (files.length) renameSync(join(staging, "lib/firmware"), target);
    writeFileSync(marker(cfg), JSON.stringify({ fingerprint: fingerprint(cfg), packages, files }, null, 2) + "\n");
    console.log(`GPU support: ${packages.length} firmware packages, ${files.length} files/links; drivers stay opt-in via cfg.gpu`);
  } finally { rmSync(staging, { recursive: true, force: true }); }
});

runIfMain(import.meta.url, async () => {
  if (process.argv.includes("--check")) process.exitCode = gpuReady(config()) ? 0 : 1;
  else await fetchGpuFirmware();
});
