// The build stage, as build-uki.sh and build-image.sh do it with
// BUNINU_JS_UKI=1 and the JS FAT/GPT tools: fetch what is missing, pack the
// initramfs, assemble the UKI with scripts/uki.js, and write vda.img, a GPT
// disk whose one partition is a FAT32 ESP holding the UKI.
//
//   node scripts/build.js            BUNINU_ARCH, LINUX_FLAVOR and REAL_MACHINE
//                                    as in arch.js; SOURCE_DATE_EPOCH fixes the
//                                    archive's mtimes and the ESP's times
//
// The ESP is formatted in place inside vda.img rather than in a temporary
// file copied in with dd; the bytes are the same.

import { spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { format, openVolume } from "../initramfs/lib/fat.js";
import { TYPES, randomGuid, writeGpt } from "../initramfs/lib/gpt.js";
import { config, jsRuntime, rootDir, runIfMain } from "./arch.js";
import { fetchAlpine } from "./fetch.js";
import { pack } from "./pack.js";

const nonEmpty = (path) => existsSync(path) && statSync(path).size > 0;

/**
 * The kernel command line. Everything before `--` needs an `=`: the kernel
 * appends any bare word to init's argv. Everything after `--` becomes
 * argv[1..]: Bun is PID 1, and `-e import('/init.js')` avoids opening an
 * entry file before /proc exists. The console listed last is the one the
 * kernel opens as init's fd 0/1/2: the serial port, or tty0 on --real.
 */
export const cmdline = (cfg) => [
  ...(cfg.real
    ? [
      `console=${cfg.serialConsole},115200`,
      "console=tty0",
      "REAL_MACHINE=1",
    ]
    : [
      "console=tty0",
      `console=${cfg.serialConsole},115200`,
    ]),
  "panic=0",
  "PATH=/bin",
  `KERNEL_RELEASE=${cfg.kernelRelease}`,
  "rdinit=/bin/bun",
  "--",
  "-e",
  "import('/init.js')",
].join(" ");

/** build-uki.sh: fetch the kernel if missing, pack, and assemble vda/EFI/BOOT/<name>. */
export const uki = async (cfg = config()) => {
  const missing = !nonEmpty(cfg.kernelImage)
    || !nonEmpty(join(cfg.kernelDir, cfg.efiStub))
    || !nonEmpty(join(cfg.modulesRoot, "modules.dep"))
    || (cfg.real && (
      !nonEmpty(join(cfg.modulesRoot, "kernel/drivers/hid/usbhid/usbhid.ko"))
      || !nonEmpty(join(cfg.modulesRoot, "kernel/drivers/acpi/battery.ko"))
    ));
  if (missing) await fetchAlpine(cfg);
  pack(cfg);

  const build = join(rootDir, "build");
  const boot = join(rootDir, "vda/EFI/BOOT");
  mkdirSync(build, { recursive: true });
  mkdirSync(boot, { recursive: true });
  writeFileSync(join(build, "cmdline"), cmdline(cfg));
  // Only this architecture's removable-media name may remain: firmware of the
  // other architecture ignores it, but run-qemu.sh reads the guest from it.
  for (const name of readdirSync(boot)) {
    if (name.endsWith(".EFI") && name !== cfg.efiBootName) rmSync(join(boot, name), { force: true });
  }
  const result = spawnSync(jsRuntime(), [
    join(rootDir, "scripts/uki.js"),
    join(cfg.kernelDir, cfg.efiStub),
    join(boot, cfg.efiBootName),
    `.osrel=${join(build, "os-release")}`,
    `.cmdline=${join(build, "cmdline")}`,
    `.linux=${cfg.kernelImage}`,
    `.initrd=${join(build, "initramfs.cpio.gz")}`,
  ], { stdio: ["ignore", "ignore", "inherit"] });
  if (result.status !== 0) throw new Error("scripts/uki.js failed");
  console.log(`Built ${cfg.arch} UKI with Alpine linux-${cfg.flavor} at vda/EFI/BOOT/${cfg.efiBootName}`);
};

/** build-image.sh: vda.img, 128 MiB, GPT with the ESP from sector 2048 to the last usable one. */
export const image = (cfg = config()) => {
  const efi = join(rootDir, "vda/EFI/BOOT", cfg.efiBootName);
  if (!nonEmpty(efi)) throw new Error(`no ${cfg.arch} EFI payload ${efi} yet; build the UKI first`);
  const diskSectors = (128 * 1024 * 1024) / 512;
  const espStart = 2048;
  const espEnd = diskSectors - 34;
  const path = join(rootDir, "vda.img");
  rmSync(path, { force: true });
  const fd = openSync(path, "w+");
  try {
    ftruncateSync(fd, diskSectors * 512);
    writeGpt(fd, diskSectors, {
      diskGuid: randomGuid(),
      entries: [{
        number: 1,
        type: TYPES.esp,
        guid: randomGuid(),
        first: espStart,
        last: espEnd,
        name: "ESP",
      }],
    });
    format(fd, {
      offset: espStart * 512,
      sectors: espEnd - espStart + 1,
      label: "EFIBOOT",
      hidden: espStart,
    });
  } finally {
    closeSync(fd);
  }
  const volume = openVolume(`${path}@@${espStart * 512}`);
  try {
    volume.mkdir("/EFI");
    volume.mkdir("/EFI/BOOT");
    volume.writeFile(`/EFI/BOOT/${cfg.efiBootName}`, readFileSync(efi));
  } finally {
    volume.close();
  }
  console.log(`Packed vda/EFI/BOOT/${cfg.efiBootName} into vda.img`);
};

export const buildAll = async (cfg = config()) => {
  await uki(cfg);
  image(cfg);
};

runIfMain(import.meta.url, () => buildAll());
