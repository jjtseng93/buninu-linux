#!/usr/bin/env bun
import {
  cli, isBuninuLinux, options, quote,
} from "./lib/common.js";

const archAlias = /^(x|x64|x86_64|x86-64|a|arm64|aarch64)$/;

export function printEntry(rootfs = "/path/to/your/rootfs") {
  console.log("\nEnter the rootfs:");
  console.log(isBuninuLinux()
    ? `  chroot ${quote(rootfs)} /bin/sh`
    : `  bun x bunproot -koe -r ${quote(rootfs)}`);
  console.log("Then run inside it:");
  console.log("  cd /bootstrap");
  console.log("  bun 3.gen-musl-dev.js");
  console.log("  bun 4.build-tcc.js");
}

async function main(args) {
  // Print instructions only. No
  // rootfs or marker file is read.
  if (!args.length) {
    printEntry();
    return;
  }
  if (args.includes("--help") ||
      args.includes("-h")) {
    console.log(
      "Usage: bun 2.enter-rootfs.js " +
      "[ARCH] [ROOTFS]"
    );
    console.log(
      "No ROOTFS: print commands " +
      "using /path/to/your/rootfs."
    );
    return;
  }
  // Keep stage 1's argument aliases,
  // but never infer roota or rootx.
  const archOnly = args.length === 1
    && archAlias.test(args[0]);
  const selected = options(archOnly
    ? [...args, "/path/to/your/rootfs"]
    : args);
  if (!selected) return;
  printEntry(selected.rootfs);
}

if (import.meta.main) await cli(main);
