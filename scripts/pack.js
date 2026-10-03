// The initramfs, as scripts/pack-initramfs.sh packs it with BUNINU_JS_CPIO=1:
// initramfs/ with native/<arch>/ laid over it, the README, licenses and
// os-release added, written by scripts/cpio.js to build/initramfs.cpio.gz.
//
//   node scripts/pack.js             BUNINU_ARCH as in arch.js; SOURCE_DATE_EPOCH
//                                    fixes every mtime, as cpio.js does

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  lutimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { config, jsRuntime, rootDir, runIfMain } from "./arch.js";

/**
 * `cp -a SOURCE/. TARGET/`: modes, times and symlinks kept, directories
 * merged into ones already there (and given the source's mode, as cp -a does).
 */
export const copyTree = (source, target) => {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) {
    rmSync(target, { force: true });
    symlinkSync(readlinkSync(source), target);
    lutimesSync(target, stat.atime, stat.mtime);
  } else if (stat.isDirectory()) {
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(source)) copyTree(join(source, name), join(target, name));
    chmodSync(target, stat.mode & 0o7777);
    utimesSync(target, stat.atime, stat.mtime);
  } else if (stat.isFile()) {
    rmSync(target, { force: true });
    copyFileSync(source, target);
    chmodSync(target, stat.mode & 0o7777);
    utimesSync(target, stat.atime, stat.mtime);
  } else {
    throw new Error(`${source}: not a file, directory or symlink`);
  }
};

/** `cp FILE TARGET`: contents and mode, a new mtime. */
const copyFile = (source, target) => {
  rmSync(target, { force: true });
  copyFileSync(source, target);
  chmodSync(target, statSync(source).mode & 0o777 & ~process.umask());
};

/** `ln -sfn TARGET LINK` */
const link = (target, path) => {
  rmSync(path, { force: true });
  symlinkSync(target, path);
};

/**
 * The device nodes of the archive, PATH:c:MAJOR:MINOR:MODE. Nothing has
 * mounted devtmpfs when the kernel execs Bun as PID 1: console is init's fd
 * 0/1/2 and JSC aborts without urandom; the rest keep /dev usable if the
 * devtmpfs mount in init.js fails. The serial port is ttyS0 (4, 64) on
 * x86_64 and the PL011 ttyAMA0 (204, 64) on aarch64.
 */
export const devices = (cfg) => [
  "dev/console:c:5:1:0600",
  `dev/${cfg.serialConsole}:c:${cfg.serialMajor}:64:0620`,
  "dev/null:c:1:3:0666",
  "dev/zero:c:1:5:0666",
  "dev/random:c:1:8:0666",
  "dev/urandom:c:1:9:0666",
  "dev/tty:c:5:0:0666",
];

export const osRelease = (version) => [
  'NAME="Buninu Linux"',
  "ID=buninu-linux",
  `VERSION="${version}"`,
  `VERSION_ID=${version}`,
  `PRETTY_NAME="Buninu Linux ${version}"`,
  'HOME_URL="https://buninu.org"',
  'BUG_REPORT_URL="https://github.com/jjtseng93/buninu-linux/issues"',
  "LOGO=buninu-linux",
  "DEFAULT_HOSTNAME=buninu",
].map((line) => `${line}\n`).join("");

export const pack = (cfg = config()) => {
  // The directories and files made here are packed with their modes; native
  // Termux's umask 0077 would make /usr/lib and /usr/lib/os-release private.
  const previousUmask = process.umask(0o022);
  try {
    packStaging(cfg);
  } finally {
    process.umask(previousUmask);
  }
};

const packStaging = (cfg) => {
  const bun = join(cfg.nativeDir, "bin", "bun");
  if (!existsSync(bun) || !(statSync(bun).mode & 0o111)) {
    throw new Error(`no ${bun} yet; run the fetch stage first (node scripts/fetch.js)`);
  }
  const build = join(rootDir, "build");
  mkdirSync(build, { recursive: true });
  const staging = mkdtempSync(join(rootDir, ".initramfs."));
  try {
    // initramfs/ is the same for every architecture; native/<arch>/ adds bun,
    // the musl loader, the GCC runtime and the kernel modules on top of it.
    // A checkout fetched before native/ existed still has an x86_64 bun and
    // its modules under initramfs/; they are dropped rather than packed.
    copyTree(join(rootDir, "initramfs"), staging);
    rmSync(join(staging, "bin", "bun"), { force: true });
    rmSync(join(staging, "lib", "modules"), { recursive: true, force: true });
    copyTree(cfg.nativeDir, staging);
    copyFile(join(rootDir, "README.md"), join(staging, "usr/share/doc/buninu-linux/README.md"));
    for (const name of [
      "LICENSE",
      "NOTICE.md",
      "LICENSES",
    ]) copyTree(join(rootDir, name), join(staging, "usr/share/licenses", name));

    // os-release(5): the canonical file in /usr/lib, /etc/os-release a link
    // to it; build.js embeds the same file as the UKI's .osrel section.
    const { version } = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
    if (!version) throw new Error("no version in package.json");
    writeFileSync(join(build, "os-release"), osRelease(version));
    mkdirSync(join(staging, "usr/lib"), { recursive: true });
    mkdirSync(join(staging, "etc"), { recursive: true });
    copyFile(join(build, "os-release"), join(staging, "usr/lib/os-release"));
    link("../usr/lib/os-release", join(staging, "etc/os-release"));
    // LOGO names an icon-theme icon; the standard lookup paths point at the
    // icon /buninu already ships.
    mkdirSync(join(staging, "usr/share/icons/hicolor/512x512/apps"), { recursive: true });
    mkdirSync(join(staging, "usr/share/pixmaps"), { recursive: true });
    link("../../../../../../buninu/icon.png", join(staging, "usr/share/icons/hicolor/512x512/apps/buninu-linux.png"));
    link("../../../buninu/icon.png", join(staging, "usr/share/pixmaps/buninu-linux.png"));

    const cpio = spawnSync(jsRuntime(), [
      join(rootDir, "scripts/cpio.js"),
      staging,
      join(build, "initramfs.cpio.gz"),
      ...devices(cfg),
    ], { stdio: ["ignore", "ignore", "inherit"] });
    if (cpio.status !== 0) throw new Error("scripts/cpio.js failed");
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  console.log(`Built build/initramfs.cpio.gz for ${cfg.arch}`);
};

runIfMain(import.meta.url, () => pack());
