#!/usr/bin/env bun
import {
  existsSync, readdirSync,
  readFileSync, statSync,
  copyFileSync, writeFileSync,
} from "node:fs";
import { cli } from "./lib/common.js";
import {
  buildRoot, command, configure,
  makeIn, ready, source, stage,
  toolchain, tools,
} from "./lib/build.js";

async function main(args) {
  const { arch, triple } = stage(
    6, "binutils", args
  );
  const src = await source(
    "binutils@2.39", "binutils-2.39"
  );
  const build = buildRoot + "/binutils";
  const env = {
    CFLAGS: "-O2 -D__LITTLE_ENDIAN__=1",
  };
  await configure(src, build, [
    "--build=" + triple,
    "--host=" + triple,
    "--target=" + triple,
    "--prefix=" + toolchain,
    "--disable-nls", "--disable-werror",
    "--disable-gprofng",
    "--disable-gold", "--disable-gdb",
    "--disable-sim", "--disable-libctf",
    "--disable-shared",
    "--disable-multilib",
    "--disable-dependency-tracking",
    "--without-debuginfod",
    "--without-zstd",
  ], env);
  await makeIn(build, ["all"], env);
  restoreManpages(src, build);
  await makeIn(build, ["install"], env);
  await runtime(arch);
  await command([
    toolchain + "/bin/as", "--version",
  ]);
  await command([
    toolchain + "/bin/ld", "--version",
  ]);
  ready(6, "Binutils and TCC runtime");
}

function restoreManpages(src, build) {
  for (const dir of ["gas/doc", "binutils/doc", "ld", "gprof"]) {
    for (const name of readdirSync(src + "/" + dir).filter(n => n.endsWith(".1"))) {
      const target = `${build}/${dir}/${name}`;
      if (existsSync(target) && statSync(target).size === 0) copyFileSync(`${src}/${dir}/${name}`, target);
    }
  }
}

async function runtime(arch) {
  const cwd = buildRoot + "/tcc-runtime";
  if (arch === "aarch64") {
    await command([tools + "/cc", "-c", "/bootstrap/src/tinycc/lib/lib-arm64.c", "-o", "lib-arm64.o"], cwd);
    await command([toolchain + "/bin/ar", "rcs", toolchain + "/lib/tcc/libbootstrap-tcc-arm64.a", "lib-arm64.o"], cwd);
  }
  const code = `static volatile long double a=1.5L,b=2.0L;
int main(void){long double x=a,y=b;return x*y!=3.0L||x/y!=0.75L||x+y!=3.5L||x-y!=-0.5L||!(x<y)||(double)(x*y)!=3.0;}`;
  // command() creates the working directory before compilation.
  await command([toolchain + "/bin/ar", "--version"], cwd);
  writeFileSync(cwd + "/quad.c", code);
  await command([tools + "/cc", "quad.c", "-o", "quad"], cwd);
  await command([cwd + "/quad"], cwd);
}

if (import.meta.main) await cli(main);
