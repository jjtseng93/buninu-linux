#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import { cli } from "./lib/common.js";
import {
  buildRoot, command, configure,
  makeIn, ready, source, stage, tools,
} from "./lib/build.js";

async function main(args) {
  const { triple } = stage(
    11, "flex", args
  );
  const src = await source(
    "flex@2.6.4", "flex-2.6.4"
  );
  const build = buildRoot + "/flex";
  const env = { M4: tools + "/m4" };
  await configure(src, build, [
    "--build=" + triple,
    "--host=" + triple,
    "--prefix=/bootstrap/toolchain",
    "--disable-nls",
    "--disable-dependency-tracking",
    "--disable-shared",
  ], env);
  await makeIn(
    build, ["-C", "src"], env
  );
  await makeIn(
    build, ["-C", "src", "install"],
    env
  );
  await verifyLexer(build, env);
  ready(11, "Flex generated lexer");
}

async function verifyLexer(build, env) {
  writeFileSync(build + "/verify.l", `%option noyywrap
%%
[0-9]+ return 7;
. return 1;
%%
int main(void){yy_scan_string("123");return yylex()!=7;}
`);
  await command([tools + "/flex", "-o", "verify.c", "verify.l"], build, env);
  await command([tools + "/cc", "verify.c", "-o", "verify-flex"], build, env);
  await command([build + "/verify-flex"], build, env);
}

if (import.meta.main) await cli(main);
