#!/usr/bin/env bun

// Single entry point over the build scripts. The scripts stay the source of
// truth and run fine on their own; this adds one command, a usage screen,
// stage flags that combine, and a check that the tools each stage needs are
// present before anything starts. Written against node: APIs only, so it runs
// under node as well as bun.

import pkg from "./package.json" with { type: "json" };
import { spawnSync } from "node:child_process";
import { accessSync, constants, copyFileSync, readFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));
const invocationDir = process.cwd();

// Pipeline order. Flags select stages; this array fixes the order they run in.
const stages = [
  {
    flag: "fetch",
    short: "f",
    scripts: ["fetch-alpine.sh", "fetch-bun.sh"],
    tools: ["curl", "unzip", "tar", "gzip", "sha256sum"],
  },
  {
    flag: "build",
    short: "b",
    scripts: ["build-uki.sh", "build-image.sh"],
    tools: [
      "fakeroot", "cpio", "gzip",
      "x86_64-w64-mingw32-objcopy", "x86_64-w64-mingw32-objdump",
      "parted", "mkfs.fat", "mmd", "mcopy",
    ],
  },
  {
    flag: "run",
    short: "r",
    scripts: ["run-qemu.sh"],
    tools: ["qemu-system-x86_64"],
  },
];

function fail(message) {
  console.error(`${pkg.name}: ${message}`);
  process.exit(1);
}

function usage() {
  return `${pkg.name} - ${pkg.description}

Usage:
  ${pkg.name} [-f] [-b] [-r] [--export] [--linux-lts] [--real] [-- qemu arguments]

Stages (always run in this order, whichever you pick):
  -f, --fetch   download and verify the pinned kernel, musl, GCC runtime,
                EFI stub and Bun      (fetch-alpine.sh, fetch-bun.sh)
  -b, --build   pack the initramfs, assemble the UKI, write vda.img
                                       (build-uki.sh, build-image.sh)
  -r, --run     boot vda.img under QEMU (run-qemu.sh)

  --export      after -b/--build, copy the image to
                ./buninu-linux-${pkg.version}.img

  --linux-lts   use Alpine's general-purpose linux-lts kernel for fetch/build
                (the default is the smaller linux-virt kernel)
  --real        build for a physical machine: use linux-lts, make tty0 the
                primary console, and include USB xHCI/HID keyboard modules

  -h, --help    show this
  -V, --version show name, version, runtime and platform
  --readme      render README.md in the terminal and exit

Short flags combine: -fbr is the whole pipeline, -br is what an edit to
initramfs/init.js needs, -r just boots what is already there. Anything after
-- goes to qemu-system-x86_64 verbatim (for example: -r -- -m 1G).

Fetch and build need the PRoot toolchain from README section 0; run needs
qemu-system-x86_64, which Termux provides. Tools missing for the stages you
picked are reported before anything starts.
`;
}

function parse(argv) {
  const selected = new Set();
  const passthrough = [];
  let linuxLts = false;
  let real = false;
  let exportImage = false;
  let sawSeparator = false;

  for (const argument of argv) {
    if (sawSeparator) {
      passthrough.push(argument);
    } else if (argument === "--") {
      sawSeparator = true;
    } else if (argument === "-h" || argument === "--help") {
      console.log(usage());
      process.exit(0);
    } else if (argument === "-V" || argument === "--version") {
      printVersion();
      process.exit(0);
    } else if (argument === "--readme") {
      printReadme();
      process.exit(0);
    } else if (argument === "--linux-lts") {
      linuxLts = true;
    } else if (argument === "--real") {
      real = true;
    } else if (argument === "--export") {
      exportImage = true;
    } else if (argument.startsWith("--")) {
      const stage = stages.find((s) => `--${s.flag}` === argument);
      if (!stage) fail(`unknown option ${argument}\n\n${usage()}`);
      selected.add(stage);
    } else if (argument.startsWith("-") && argument.length > 1) {
      for (const letter of argument.slice(1)) {
        const stage = stages.find((s) => s.short === letter);
        if (!stage) fail(`unknown option -${letter} in ${argument}\n\n${usage()}`);
        selected.add(stage);
      }
    } else {
      fail(`unexpected argument ${argument}\n\n${usage()}`);
    }
  }

  if (selected.size === 0) {
    console.error(usage());
    process.exit(1);
  }
  if (passthrough.length > 0 && !selected.has(stages[2])) {
    fail("arguments after -- only make sense with -r/--run");
  }
  if ((linuxLts || real) && !selected.has(stages[0]) && !selected.has(stages[1])) {
    fail("--linux-lts/--real only make sense with -f/--fetch or -b/--build");
  }
  if (exportImage && !selected.has(stages[1])) {
    fail("--export requires -b/--build (use -fb --export for a clean build)");
  }
  return { selected, passthrough, linuxLts, real, exportImage };
}

// Same shape as Buninu's --version. The runtime line tells you whether this
// ran under bun or node, which matters for --readme's rendering.
function printVersion() {
  const runtime =
    typeof Bun !== "undefined" ? `Bun ${Bun.version}` : `Node ${process.versions.node}`;
  console.log(`${pkg.name}: ${pkg.description}`);
  console.log("Version:", pkg.version);
  console.log("Runtime:", runtime);
  console.log("Platform:", `${process.platform}/${process.arch}`);
}

// Same as Buninu's --readme: Bun renders the Markdown to ANSI with clickable
// links. Under node there is no renderer, so the file is printed as-is.
function printReadme() {
  const path = resolve(rootDir, "README.md");
  let markdown;
  try {
    markdown = readFileSync(path, "utf8");
  } catch (error) {
    fail(`README not found: ${path} (${error.message})`);
  }
  const rendered =
    typeof Bun !== "undefined" && typeof Bun.markdown?.ansi === "function"
      ? Bun.markdown.ansi(markdown, { hyperlinks: true })
      : markdown;
  process.stdout.write(rendered.endsWith("\n") ? rendered : rendered + "\n");
}

// `command -v` without a shell: look for an executable on PATH.
function hasTool(name) {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    try {
      accessSync(join(directory, name), constants.X_OK);
      return true;
    } catch {}
  }
  return false;
}

function checkTools(selectedStages) {
  const missing = [];
  for (const stage of selectedStages) {
    for (const tool of stage.tools) {
      if (!hasTool(tool)) missing.push(`${tool} (for --${stage.flag})`);
    }
  }
  if (missing.length > 0) {
    fail(
      `missing tools, nothing was run:\n  ${missing.join("\n  ")}\n` +
        "See README section 0 for the packages that provide them.",
    );
  }
}

function runScript(stage, script, args = [], env = process.env) {
  const path = resolve(rootDir, script);
  console.log(`\n==> [${stage.flag}] ${script}${args.length ? " " + args.join(" ") : ""}`);
  const result = spawnSync(path, args, { cwd: rootDir, stdio: "inherit", env });
  if (result.error) fail(`could not start ${script}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${script} exited with status ${result.status ?? "signal " + result.signal}`);
  }
}

const { selected, passthrough, linuxLts, real, exportImage } = parse(process.argv.slice(2));
const ordered = stages.filter((stage) => selected.has(stage));
checkTools(ordered);

for (const stage of ordered) {
  for (const script of stage.scripts) {
    runScript(
      stage,
      script,
      stage.flag === "run" ? passthrough : [],
      linuxLts || real
        ? { ...process.env, LINUX_FLAVOR: "lts", ...(real && { REAL_MACHINE: "1" }) }
        : process.env,
    );
  }
}

if (exportImage) {
  const source = resolve(rootDir, "vda.img");
  const destination = resolve(invocationDir, `buninu-linux-${pkg.version}.img`);
  try {
    accessSync(source, constants.R_OK);
    copyFileSync(source, destination);
  } catch (error) {
    fail(`could not export image to ${destination}: ${error.message}`);
  }
  console.log(`\nExported ${destination}`);
}
