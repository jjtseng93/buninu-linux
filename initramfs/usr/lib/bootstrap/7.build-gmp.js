#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { cli } from "./lib/common.js";
import {
  buildRoot, canonicalizers, configure,
  makeIn, patch, deps, ready,
  source, stage,
} from "./lib/build.js";

async function main(args) {
  const { triple } = stage(
    7, "gmp", args
  );
  const src = await source(
    "gmp@4.3.2", "gmp-4.3.2"
  );
  const build = buildRoot + "/gmp";
  canonicalizers(src);
  patch(
    src + "/gmp-impl.h",
    "char *alloca ();",
    "void *alloca ();"
  );
  const env = { ABI: "standard" };
  await configure(src, build, [
    "--build=" + triple,
    "--host=" + triple,
    "--prefix=" + deps,
    "--disable-shared",
    "--enable-static",
    "--disable-dependency-tracking",
    "--disable-assembly",
    "--disable-cxx",
    "--enable-alloca=malloc-reentrant",
  ], env);
  checkConfiguration(src, build);
  await makeIn(build, ["all"], env);
  await makeIn(build, ["install"], env);
  ready(7, "GMP static library");
}

function checkConfiguration(src, build) {
  const log = readFileSync(build + "/config.log", "utf8");
  const recorded = log.slice(log.lastIndexOf("## confdefs.h. ##"));
  const template = readFileSync(src + "/config.in", "utf8");
  const config = readFileSync(build + "/config.h", "utf8");
  const names = new Set([...template.matchAll(/^#undef (\w+)/gm)].map(m => m[1]));
  const actual = new Map([...config.matchAll(/^#define (\w+)[ \t]+(.*)$/gm)].map(m => [m[1], m[2].trim()]));
  let checked = 0;
  for (const m of recorded.matchAll(/^#define (\w+)[ \t]+(.*)$/gm)) {
    if (!names.has(m[1])) continue;
    if (actual.get(m[1]) !== m[2].trim()) throw new Error(`GMP config.h mismatch: ${m[1]}`);
    checked++;
  }
  if (checked < 20) throw new Error("Insufficient GMP configure definitions");
}

if (import.meta.main) await cli(main);
