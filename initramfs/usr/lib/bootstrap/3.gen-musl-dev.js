#!/usr/bin/env bun
import { cc } from "bun:ffi";
import {
  mkdtempSync, readFileSync, renameSync,
  rmSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  assertAbsent, bootstrap, cli,
  requireRootfs, validateElf,
} from "./lib/common.js";
import {
  generateHeaders,
} from "./lib/musl-headers.js";

async function main(args) {
  // Run inside the prepared rootfs.
  // This generates public headers
  // and ordinary dynamic-link CRT.
  // It does not build libc or rcrt1.
  if (args.length) throw new Error(
    "Usage: bun 3.gen-musl-dev.js"
  );
  const { arch } = requireRootfs();
  const names = [
    "crt1.o", "crti.o", "crtn.o",
  ];
  assertAbsent("/usr/include");
  for (const name of names) {
    assertAbsent(`/usr/lib/${name}`);
  }

  // Follow musl's Makefile rules in
  // JS: public headers, arch bits,
  // alltypes.h and syscall.h.
  console.log(
    "① Generating musl headers"
  );
  generateHeaders(
    arch,
    "/bootstrap/src/musl",
    "/usr/include"
  );
  // chroot mounts /tmp separately;
  // stage objects on the same FS as
  // /usr/lib for the final rename.
  const work = mkdtempSync(
    "/usr/lib/.musl-crt-"
  );
  let compiler;
  try {
    // ARM64 TCC does not handle adrp.
    // Ordinary crt1's _start_c uses
    // x0, not x1 (_DYNAMIC). Omit just
    // that unused argument in a
    // temporary header override.
    // Keep musl sources untouched.
    if (arch === "aarch64") {
      prepareArm64Startup(work);
    }

    // Bun.cc builds libtcc.c in memory
    // without standalone cc or CRT.
    // TCC_OUTPUT_OBJ emits the three
    // relocatable startup objects.
    console.log(
      "② Building CRT with Bun.cc"
    );
    compiler = cc({
      source: join(
        bootstrap,
        "lib/compile-object.c"
      ),
      library: ["gcc_s"],
      flags: ["-L/usr/lib", "-L/lib"],
      include: [
        "/bootstrap/src/tinycc",
        "/bootstrap/src/tinycc/include",
        "/usr/include",
      ],
      symbols: {
        compile_object: {
          args: [
            "cstring", "cstring",
            "cstring",
          ],
          returns: "int",
        },
      },
    });
    compileCrt(
      compiler, arch, work, names
    );
    for (const name of names) {
      renameSync(
        join(work, name),
        `/usr/lib/${name}`
      );
    }
    console.log(
      "Ready: musl headers and CRT."
    );
    console.log(
      "Next: bun " +
      "/bootstrap/" +
      "4.build-tcc.js"
    );
  } finally {
    compiler?.close();
    rmSync(work, {
      recursive: true, force: true,
    });
  }
}

function prepareArm64Startup(work) {
  const original = readFileSync("/bootstrap/src/musl/arch/aarch64/crt_arch.h", "utf8");
  const lines = original.split("\n");
  const removed = lines.filter(line => line.includes("_DYNAMIC"));
  if (removed.length !== 4 || !removed.some(line => line.includes("adrp x1"))) {
    throw new Error("Unexpected musl ARM64 startup code; refusing compatibility edit");
  }
  writeFileSync(join(work, "crt_arch.h"), lines.filter(line => !line.includes("_DYNAMIC")).join("\n"));
}

function compileCrt(compiler, arch, work, names) {
  const z = text => Buffer.from(text + "\0");
  const flags = `-nostdinc -DCRT -D_XOPEN_SOURCE=700 -I${work} -I/bootstrap/src/musl/arch/${arch} -I/bootstrap/src/musl/arch/generic -I/bootstrap/src/musl/src/include -I/bootstrap/src/musl/src/internal -I/usr/include -I/bootstrap/src/tinycc/include`;
  for (const name of names) {
    const source = name === "crt1.o" ? "/bootstrap/src/musl/crt/crt1.c" : `/bootstrap/src/musl/crt/${arch}/${name.slice(0, -2)}.s`;
    const output = join(work, name);
    console.log(`${source} -> /usr/lib/${name}`);
    const result = compiler.symbols.compile_object(z(source), z(output), z(flags));
    if (result) throw new Error(`${name}: TinyCC returned ${result}`);
    const bytes = readFileSync(output);
    validateElf(name, bytes, arch);
    if (bytes.readUInt16LE(16) !== 1) throw new Error(`${name} is not a relocatable ELF object`);
  }
}

if (import.meta.main) await cli(main);
