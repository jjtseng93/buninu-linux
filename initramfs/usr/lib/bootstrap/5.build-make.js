#!/usr/bin/env bun
import {
  chmodSync, copyFileSync,
} from "node:fs";
import { cli } from "./lib/common.js";
import {
  buildRoot, command, configure,
  installAdapters, makeIn, patch,
  ready, shell, source, stage, tools,
} from "./lib/build.js";

async function main(args) {
  const { triple } = stage(
    5, "make", args
  );
  installAdapters();
  const src = await source(
    "make@4.4.1", "make-4.4.1"
  );
  const build = buildRoot + "/make";
  prepareMake(src);
  await configure(src, build, [
    "--build=" + triple,
    "--prefix=/bootstrap/toolchain",
    "--disable-dependency-tracking",
    "--without-guile", "--disable-nls",
  ]);

  // GNU Make provides its own
  // no-make shell bootstrap builder.
  await command(
    [shell, src + "/build.sh"],
    build
  );
  copyFileSync(
    build + "/make", tools + "/make"
  );
  chmodSync(tools + "/make", 0o755);
  await makeIn(build, ["clean"]);
  await makeIn(build);
  copyFileSync(
    build + "/make", tools + "/make"
  );
  await command(
    [tools + "/make", "--version"]
  );
  ready(5, "GNU Make self-rebuild");
}

function prepareMake(src) {
  patch(src + "/build.sh", '  LIBOBJS="${LIBOBJS:+$LIBOBJS }lib/$lo"',
    '  lo=${lo#\'${LIBOBJDIR}\'}\n  LIBOBJS="${LIBOBJS:+$LIBOBJS }lib/$lo"');
  patch(src + "/src/mkcustom.h", "char *alloca ();", "void *alloca ();");
  patch(src + "/lib/glob.c", "extern char *alloca ();", "extern void *alloca ();");
  patch(src + "/lib/alloca.c", "memory_full ();", "abort ();");
}

if (import.meta.main) await cli(main);
