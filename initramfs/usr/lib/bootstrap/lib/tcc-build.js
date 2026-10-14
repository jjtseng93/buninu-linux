// Standalone TinyCC build used by stage 4 inside the target musl rootfs.
import { chmodSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { bun, run } from "./common.js";

export async function buildTcc() {
  const root = "/bootstrap/src/tinycc";
  if (!["x64", "arm64"].includes(process.arch)) throw new Error("Unsupported architecture");
  const work = "/bootstrap/build/tinycc";
  const runtime = "/bootstrap/toolchain/lib/tcc";
  mkdirSync(work, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  mkdirSync("/bootstrap/toolchain/bin", { recursive: true });
  cpSync(join(root, "include"), join(runtime, "include"), { recursive: true });
  const stage1 = "/bootstrap/toolchain/bin/tcc";
  const stage2 = join(work, "tcc-stage2");
  const flags = ["-B/bootstrap/toolchain/lib/tcc", "-nostdinc", "-I/usr/include", "-I/bootstrap/toolchain/lib/tcc/include", "-L/usr/lib", "-L/lib"];

  console.log("1. Build standalone TinyCC using Bun.cc");
  await run([bun(), join(root, "bun-bootstrap.js"), join(root, "bun-tcc-cli.c"), stage1, "0"]);
  await run([stage1, "-v"]);

  if (process.arch === "x64") {
    console.log("2. Build x64 helpers for programs compiled by cc");
    const objects = [];
    for (const name of ["libtcc1", "va_list"]) {
      const object = join(work, `${name}.o`);
      await run([stage1, ...flags, "-c", join(root, "lib", `${name}.c`), "-o", object]);
      objects.push(object);
    }
    await run([stage1, "-ar", "rcs", join(runtime, "libbootstrap-tcc-x64.a"), ...objects]);
  }

  console.log("3. Rebuild TinyCC with stage1");
  await run([stage1, ...flags, join(root, "bun-tcc-cli.c"), "-lgcc_s", "-o", stage2]);
  const a = await Bun.file(stage1).bytes();
  const b = await Bun.file(stage2).bytes();
  if (!Buffer.from(a).equals(Buffer.from(b))) throw new Error("stage1/stage2 differ");
  console.log("stage1/stage2 byte-identical: true");

  if (!existsSync("/bin/cc")) throw new Error("Extract the overlay's bin/cc first");
  chmodSync("/bin/cc", 0o755);
  console.log("4. Compile and run the libc smoke test through cc");
  await run(["/bin/cc", join(root, "bun-hello-libc.c"), "-o", join(work, "hello-cc")]);
  await run([join(work, "hello-cc")]);
  if (process.arch === "x64") {
    console.log("5. Check x64 conversions and variadic calls");
    await run(["/bin/cc", join(root, "bun-runtime-check.c"), "-o", join(work, "runtime-check")]);
    await run([join(work, "runtime-check")]);
  }
  console.log("Ready: /bin/cc (TinyCC stage1)");
}

