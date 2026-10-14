#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bootstrap, cli, requireRootfs, run,
  validateElf,
} from "./lib/common.js";
import {
  buildTcc,
} from "./lib/tcc-build.js";

async function main(args) {
  // Stage 3 must have generated
  // headers and the three CRT files.
  if (args.length) throw new Error(
    "Usage: bun 4.build-tcc.js"
  );
  const { arch } = requireRootfs();
  for (const name of [
    "crt1.o", "crti.o", "crtn.o",
  ]) {
    validateElf(
      name,
      readFileSync(`/usr/lib/${name}`),
      arch
    );
  }

  // Bun.cc -> standalone stage1 ->
  // stage2, then compare bytes.
  // Build x64 runtime helpers when
  // needed and test /bin/cc.
  await buildTcc();

  // Exercise the generated CRT:
  // argv, env, constructors,
  // destructors and exit status.
  await verifyStartup();
  console.log(
    "Ready: cc source.c -o program"
  );
  console.log(
    "Next: bun /bootstrap/" +
    "5.build-make.js"
  );
}

async function verifyStartup() {
  const output = "/bootstrap/build/tinycc/startup-check";
  await run(["/bin/cc", join(bootstrap, "lib/startup-check.c"), "-o", output]);
  const child = Bun.spawn([output, "hello", "two words"], {
    env: { PATH: "/bin:/usr/bin", CRT_TEST: "seed-free" }, stdout: "pipe", stderr: "inherit",
  });
  const stdout = await new Response(child.stdout).text();
  if (await child.exited !== 42 || stdout !== "argc/argv, environment, constructor OK\ndestructor OK\n") {
    throw new Error(`CRT startup check failed: ${stdout}`);
  }
  console.log(stdout + "exit status 42: OK");
}

if (import.meta.main) await cli(main);
