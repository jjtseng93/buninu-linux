#!/usr/bin/env bun
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  assertAbsent, cli, isBuninuLinux,
  normalizeArch, options,
} from "./lib/common.js";
import {
  installSources, localSeed,
  releaseSeed, sourceArchives,
  validateSeed, writeSeed,
} from "./lib/seed.js";
import { printEntry } from "./2.enter-rootfs.js";

async function main(args) {
  // Optional arguments: ARCH ROOTFS.
  // ARCH defaults to this Bun's CPU.
  // ROOTFS defaults to roota / rootx
  // in the current working directory.
  const selected = options(args);
  if (!selected) return;
  const { arch, rootfs } = selected;
  assertAbsent(rootfs);
  const parent = statSync(
    dirname(rootfs)
  );
  if (!parent.isDirectory()) {
    throw new Error(
      "ROOTFS parent must exist"
    );
  }

  // Bundled musl 1.2.6 + TinyCC +
  // overlay; verify before any writes.
  // No musl-dev APK is required.
  const archives = sourceArchives();
  const work = mkdtempSync(
    join(tmpdir(), "buninu-bootstrap-")
  );
  try {
    // Local mode reads /etc/os-release
    // ID=buninu-linux, then copies:
    // /bin/bun, /lib/ld-musl-*.so.1,
    // libgcc_s.so.1, libstdc++.so.6,
    // resolv.conf, tar, unzip, env,
    // their JS helpers and bunmsh.
    // Resolve links to copy real data.
    const local = isBuninuLinux()
      && arch === normalizeArch(
        process.arch
      );
    console.log(
      "① Preparing runtime and tools " +
      (local ? "from this Buninu Linux"
        : "from buninu-linux@0.9.56")
    );

    // Otherwise fetch npm 0.9.56:
    // native/<arch>/lib -> rootfs libs
    // initramfs tools -> same paths.
    // Fetch musl Bun 1.4.2 ZIP for
    // the selected arch -> /bin/bun.
    // URLs + SHA-256: downloads.md,
    // parsed as YAML, like the repo's
    // scripts/npm-packages.md.
    const files = local
      ? localSeed(arch)
      : await releaseSeed(arch, work);
    if (local) console.log(
      "② Reusing system musl-bun"
    );
    validateSeed(files, arch);
    writeSeed(
      rootfs, arch, files,
      local ? "local" : "npm@0.9.56"
    );

    // Extract musl and TinyCC into
    // /bootstrap/src. The overlay
    // adds build recipes and /bin/cc.
    // Stage 3 already needs TinyCC
    // source to generate CRT objects.
    // Copy stages 1–12 and helpers to
    // /bootstrap in rootfs.
    console.log(
      "③ Extracting musl, TinyCC " +
      "and bootstrap overlay sources"
    );
    await installSources(
      rootfs, archives
    );
    console.log(
      `Prepared ${arch}: ${rootfs}`
    );
    printEntry(rootfs);
  } finally {
    // Preserve a partially written
    // rootfs for inspection on error.
    rmSync(work, {
      recursive: true, force: true,
    });
  }
}

if (import.meta.main) await cli(main);
