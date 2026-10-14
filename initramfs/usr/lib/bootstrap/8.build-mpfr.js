#!/usr/bin/env bun
import {
  readFileSync, writeFileSync,
} from "node:fs";
import { cli } from "./lib/common.js";
import {
  buildRoot, canonicalizers, command,
  configure, makeIn, patch, deps,
  ready, source, stage,
} from "./lib/build.js";

async function main(args) {
  const { triple } = stage(
    8, "mpfr", args
  );
  const src = await source(
    "mpfr@2.4.2", "mpfr-2.4.2"
  );
  const build = buildRoot + "/mpfr";
  canonicalizers(src);
  prepareAllocation(src);
  await configure(src, build, [
    "--build=" + triple,
    "--host=" + triple,
    "--prefix=" + deps,
    "--disable-shared",
    "--enable-static",
    "--disable-dependency-tracking",
    "--with-gmp=" + deps,
  ]);
  await makeIn(build);
  await makeIn(build, [
    "-C", "tests",
    "tadd", "tdiv", "tsqrt",
  ]);
  for (const name of [
    "tadd", "tdiv", "tsqrt",
  ]) {
    await command(
      [build + "/tests/" + name],
      build + "/tests",
      { srcdir: src + "/tests" }
    );
  }
  await makeIn(build, ["install"]);
  ready(8, "MPFR upstream tests");
}

function prepareAllocation(src) {
  const path = src + "/mpfr-gmp.h";
  patch(path, "char *alloca ();", "void *alloca ();");
  const text = readFileSync(path, "utf8");
  if (text.includes("/* Bootstrap: no working alloca. */")) return;
  const start = text.indexOf("#define TMP_ALLOC(n)"), end = text.indexOf("#define TMP_DECL(m)", start);
  if (start < 0 || end < 0) throw new Error("Unexpected MPFR allocation macros");
  writeFileSync(path, text.slice(0, start) + "/* Bootstrap: no working alloca. */\n#ifdef C_ALLOCA\n#define TMP_ALLOC(n) mpfr_tmp_allocate (&tmp_marker, (n))\n#else\n" + text.slice(start, end) + "#endif\n" + text.slice(end));
}

if (import.meta.main) await cli(main);
