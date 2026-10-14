#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { cli } from "./lib/common.js";
import {
  buildRoot, command, configure,
  makeIn, ready, source, stage, tools,
} from "./lib/build.js";

async function main(args) {
  const { triple } = stage(
    10, "m4", args
  );
  const src = await source(
    "m4@1.4.18", "m4-1.4.18"
  );
  const build = buildRoot + "/m4";
  await configure(src, build, [
    "--build=" + triple,
    "--host=" + triple,
    "--prefix=/bootstrap/toolchain",
    "--disable-dependency-tracking",
  ]);
  await makeIn(build);
  await makeIn(build, ["install"]);
  writeFileSync(
    build + "/verify.m4",
    "define(`square',`eval($1*$1)')" +
    "square(12)\n"
  );
  const output = await command(
    [tools + "/m4", "verify.m4"],
    build, {}, true
  );
  if (output.trim() !== "144") {
    throw new Error("m4 check failed");
  }
  ready(10, "GNU m4 expansion");
}

if (import.meta.main) await cli(main);
