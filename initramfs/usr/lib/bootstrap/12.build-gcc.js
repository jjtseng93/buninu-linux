#!/usr/bin/env bun
import {
  chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync,
  readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import {
  bootstrap, cli, sha256,
} from "./lib/common.js";
import {
  buildRoot, command, configure,
  makeIn, patch, deps, ready,
  resultRoot, source, sourceRoot, stage, useLog,
  toolchain, tools,
} from "./lib/build.js";

const gccCommit = "9d2b63d100ae7c99ee8b128fb41086fd85c8f57d";

async function main(args) {
  const { arch, triple } = stage(
    12, "gcc", args
  );
  // GCC's ARM vendor 4.7 branch has
  // both the ARM64 and x64 backends.
  // Pin the full commit, not a branch.
  const src = await source(
    "gcc@4.7-9d2b63d",
    "gcc-" + gccCommit
  );
  const build = buildRoot + "/gcc-4.7";
  prepareGcc(src, arch);
  // Install native assembler/linker
  // before building target libgcc.
  installBinutils();
  await configure(src, build, [
    "--build=" + triple,
    "--host=" + triple,
    "--target=" + triple,
    "--prefix=" + resultRoot,
    "--enable-languages=c",
    "--disable-build-with-cxx",
    "--disable-bootstrap",
    "--disable-libquadmath",
    "--disable-decimal-float",
    "--disable-fixed-point",
    "--disable-lto",
    "--disable-libgomp",
    "--disable-multilib",
    "--disable-multiarch",
    "--disable-libmudflap",
    "--disable-libssp",
    "--disable-libitm", "--disable-nls",
    "--disable-werror",
    "--with-gmp=" + deps,
    "--with-mpfr=" + deps,
    "--with-mpc=" + deps,
    "--with-build-time-tools=" +
      toolchain + "/bin",
    "--with-as=" +
      resultRoot + "/bin/as",
    "--with-ld=" +
      resultRoot + "/bin/ld",
    "--with-native-system-header-dir=" +
      "/usr/include",
  ]);

  // Explicit make assignments avoid
  // cached missing-tool commands.
  await makeIn(build, [
    "M4=" + tools + "/m4",
    "FLEX=" + tools + "/flex", "all",
  ]);
  // Install compiler, headers, CRT
  // support and libgcc into result.
  await makeIn(build, [
    "install-gcc",
  ]);
  await makeIn(build, [
    "install-target-libgcc",
  ]);
  // Test with all intermediate trees
  // hidden, then restore them.
  await verifyGcc(arch, triple);
  ready(
    12, "GCC 4.7 C compiler + libgcc"
  );
  console.log(
    "Compiler: " +
    resultRoot + "/bin/gcc"
  );
  console.log(
    "Stop: GCC 4.7 milestone reached."
  );
}

function prepareGcc(src, arch) {
  const header = "bootstrap-musl.h";
  const text = `/* Local ordinary Linux-musl bootstrap target settings. */
#undef GNU_USER_DYNAMIC_LINKER
#define GNU_USER_DYNAMIC_LINKER "/lib/ld-musl-${arch}.so.1"
#undef GNU_USER_DYNAMIC_LINKER64
#define GNU_USER_DYNAMIC_LINKER64 "/lib/ld-musl-${arch}.so.1"
#undef OPTION_GLIBC
#define OPTION_GLIBC 0
#undef TARGET_C99_FUNCTIONS
#define TARGET_C99_FUNCTIONS 1
#undef TARGET_HAS_SINCOS
#define TARGET_HAS_SINCOS 1
#undef INT_FAST16_TYPE
#define INT_FAST16_TYPE "int"
#undef INT_FAST32_TYPE
#define INT_FAST32_TYPE "int"
#undef UINT_FAST16_TYPE
#define UINT_FAST16_TYPE "unsigned int"
#undef UINT_FAST32_TYPE
#define UINT_FAST32_TYPE "unsigned int"
`;
  writeFileSync(src + "/gcc/config/" + header, text);
  const path = src + "/gcc/config.gcc";
  const config = readFileSync(path, "utf8");
  const marker = "# Buninu native musl bootstrap";
  if (!config.includes(marker)) writeFileSync(path, config + `\n${marker}\ncase $target in\n  aarch64-*-linux-musl*|x86_64-*-linux-musl*) tm_file="$tm_file ${header}" ;;\nesac\n`);
  patch(src + "/libiberty/regex.c", "# ifdef REGEX_MALLOC\n", "/* TinyCC: use the existing heap allocation path. */\n# if defined __TINYC__ && !defined REGEX_MALLOC\n#  define REGEX_MALLOC 1\n# endif\n# ifdef REGEX_MALLOC\n");
  patch(src + "/libiberty/argv.c", '#include "libiberty.h"', '#include <stdlib.h>\n#include "libiberty.h"');
}

function verificationSource(arch) {
  return  `#include <stdint.h>
#include <stdio.h>
#ifdef __gnu_linux__
#error musl must not claim glibc
#endif
#if !defined(__linux__) || !defined(${arch === "aarch64" ? "__aarch64__" : "__x86_64__"})
#error unexpected target
#endif
typedef char fast16[__builtin_types_compatible_p(__INT_FAST16_TYPE__,int_fast16_t)?1:-1];
typedef char fast32[__builtin_types_compatible_p(__UINT_FAST32_TYPE__,uint_fast32_t)?1:-1];
static volatile unsigned __int128 large=((unsigned __int128)1<<100)+123,divisor=7;
int main(void){unsigned __int128 a=large,b=divisor,q=a/b,r=a%b;
if(q*b+r!=a||r>=b)return 1;
puts("GCC 4.7 C and libgcc runtime verified");return 0;}
`;
}

function installBinutils() {
  mkdirSync(resultRoot + "/bin", { recursive: true });
  rmSync(resultRoot + "/verified.json", { force: true });
  for (const name of ["as", "ld", "ar", "ranlib", "nm", "objcopy", "objdump", "readelf", "strip", "size", "strings", "addr2line", "c++filt"]) {
    // Copy bytes, not symlinks into the intermediate toolchain tree.
    const target = resultRoot + "/bin/" + name;
    copyFileSync(toolchain + "/bin/" + name, target);
    chmodSync(target, 0o755);
  }
  const notices = resultRoot + "/share/licenses/bootstrap";
  mkdirSync(notices, { recursive: true });
  copyFileSync(bootstrap + "/NOTICE.md", notices + "/NOTICE.md");
  copyFileSync(bootstrap + "/LICENSE", notices + "/LICENSE");
  cpSync(bootstrap + "/LICENSES", notices + "/LICENSES", { recursive: true });
  // Keep notices with the installed binaries, including static dependencies.
  for (const directory of ["gcc-" + gccCommit, "binutils-2.39", "gmp-4.3.2", "mpfr-2.4.2", "mpc-0.8.1"]) {
    const target = resultRoot + "/share/licenses/" + directory;
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(sourceRoot + "/" + directory)) {
      if (/^(COPYING|COPYRIGHT|LICENSE)/.test(name) && statSync(sourceRoot + "/" + directory + "/" + name).isFile()) {
        copyFileSync(sourceRoot + "/" + directory + "/" + name, target + "/" + name);
      }
    }
  }
}

async function verifyGcc(arch, triple) {
  const gcc = resultRoot + "/bin/gcc";
  const work = mkdtempSync("/tmp/bootstrap-result-check-");
  const hidden = [];
  // No compiler search-path overrides: exercise the installed defaults.
  const env = {
    PATH: resultRoot + "/bin:/bin:/usr/bin",
    SHELL: "/bin/sh", CONFIG_SHELL: "/bin/sh", CC: gcc,
    LD_LIBRARY_PATH: resultRoot + "/lib:" + resultRoot + "/lib64",
  };
  useLog(resultRoot + "/verification.log");
  try {
    for (const path of [sourceRoot, deps, toolchain, buildRoot]) {
      const backup = path + ".verification-hidden";
      if (existsSync(backup)) throw new Error(`Restore interrupted verification directory first: ${backup} -> ${path}`);
      renameSync(path, backup);
      hidden.push([path, backup]);
    }
    const version = (await command([gcc, "-dumpversion"], work, env, true)).trim();
    if (!/^4\.7\./.test(version)) throw new Error(`Unexpected GCC version: ${version}`);
    for (const name of ["libgcc.a", "libgcc_s.so.1", "crtbegin.o", "crtend.o", "crtbeginS.o", "crtendS.o"]) {
      const path = (await command([gcc, "-print-file-name=" + name], work, env, true)).trim();
      if (!path.startsWith(resultRoot + "/") || !existsSync(path)) throw new Error(`Missing installed support file: ${name}: ${path}`);
      if (name === "libgcc_s.so.1") env.LD_LIBRARY_PATH = path.slice(0, path.lastIndexOf("/")) + ":" + env.LD_LIBRARY_PATH;
    }
    writeFileSync(work + "/verify.c", verificationSource(arch));
    for (const optimization of ["-O0", "-O2"]) {
      await command([gcc, optimization, "verify.c", "-o", "verify-gcc"], work, env);
      const headers = await command([resultRoot + "/bin/readelf", "-l", "verify-gcc"], work, env, true);
      if (!headers.includes(`/lib/ld-musl-${arch}.so.1`)) throw new Error("Wrong musl interpreter");
      await command([work + "/verify-gcc"], work, env);
    }
    // Exercise installed crtbeginS/crtendS and shared libgcc, too.
    writeFileSync(work + "/shared.c", "__int128 divide(__int128 a,__int128 b){return a/b;}\n");
    writeFileSync(work + "/shared-main.c", "extern __int128 divide(__int128,__int128);int main(void){return divide(((__int128)1<<100)+1,7)!=(((__int128)1<<100)+1)/7;}\n");
    await command([gcc, "-shared", "-fPIC", "-shared-libgcc", "shared.c", "-o", "libverify.so"], work, env);
    await command([gcc, "shared-main.c", "-L.", "-lverify", "-Wl,-rpath,$ORIGIN", "-o", "verify-shared"], work, env);
    await command([work + "/verify-shared"], work, env);
    const files = [];
    function inventory(directory, prefix = "") {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = prefix + entry.name;
        if (entry.isDirectory()) inventory(directory + "/" + entry.name, path + "/");
        else if (statSync(directory + "/" + entry.name).isFile() && !["verified.json", "verification.log"].includes(path)) {
          const bytes = readFileSync(directory + "/" + entry.name);
          files.push({ path, bytes: bytes.length, sha256: sha256(bytes) });
        }
      }
    }
    inventory(resultRoot);
    writeFileSync(resultRoot + "/verified.json", JSON.stringify({
      version, arch, triple, compiler: gcc, independentOf: hidden.map(([path]) => path),
      requires: ["/usr/include", "/usr/lib", "/lib"], files,
    }, null, 2) + "\n");
  } finally {
    // Restore in reverse order even when a compiler check fails.
    for (const [path, backup] of hidden.reverse()) renameSync(backup, path);
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.main) await cli(main);
