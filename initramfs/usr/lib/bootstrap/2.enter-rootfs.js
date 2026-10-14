#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cli, isBuninuLinux, options, quote,
} from "./lib/common.js";

export function printEntry(rootfs) {
  const marker = JSON.parse(readFileSync(join(rootfs, "etc/buninu-bootstrap.json"), "utf8"));
  console.log(`\nEnter the ${marker.arch} rootfs:`);
  console.log(isBuninuLinux()
    ? `  chroot ${quote(rootfs)} /bin/sh`
    : `  bun x bunproot -koe -r ${quote(rootfs)}`);
  console.log("Then run inside it:");
  console.log("  cd /bootstrap");
  console.log("  bun 3.gen-musl-dev.js");
  console.log("  bun 4.build-tcc.js");
}

async function main(args) {
  // Same optional ARCH / ROOTFS as
  // stage 1. Print commands only.
  const selected = options(args);
  if (!selected) return;
  printEntry(selected.rootfs);
}

if (import.meta.main) await cli(main);
