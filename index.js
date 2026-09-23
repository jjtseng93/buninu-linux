#!/usr/bin/env bun

// Single entry point over the build scripts. The scripts stay the source of
// truth and run fine on their own; this adds one command, a usage screen,
// stage flags that combine, and a check that the tools each stage needs are
// present before anything starts. Written against node: APIs only, so it runs
// under node as well as bun.

import pkg from "./package.json" with { type: "json" };
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { accessSync, constants, copyFileSync, existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));
const invocationDir = process.cwd();

// Guest architectures. The names are Alpine's and the kernel's; the aliases
// are what Go, Docker, Node and Apple call the same CPUs. scripts/arch.sh
// holds everything else that differs between them.
const architectures = {
  x86_64: { aliases: ["amd64", "x64"], efi: "BOOTX64.EFI", binutils: "x86_64-w64-mingw32", apt: "binutils-mingw-w64-x86-64" },
  aarch64: { aliases: ["arm64"], efi: "BOOTAA64.EFI", binutils: "aarch64-linux-gnu", apt: "binutils-aarch64-linux-gnu" },
};

function normalizeArch(name) {
  for (const [arch, { aliases }] of Object.entries(architectures)) {
    if (name === arch || aliases.includes(name)) return arch;
  }
  fail(`unknown architecture ${name} (use x86_64/amd64 or aarch64/arm64)`);
}

// What vda/EFI/BOOT holds decides the guest for a bare -r, as in run-qemu.sh.
function builtArch() {
  return existsSync(resolve(rootDir, "vda/EFI/BOOT", architectures.aarch64.efi)) ? "aarch64" : "x86_64";
}

// Pipeline order. Flags select stages; this array fixes the order they run in.
// The fetch and build stages can run inside the Docker image from ./Dockerfile
// (--docker, and always on macOS); run always uses the host's QEMU.
const stages = [
  {
    flag: "fetch",
    short: "f",
    scripts: ["fetch-alpine.sh", "fetch-bun.sh"],
    tools: () => ["curl", "unzip", "tar", "gzip", "sha256sum"],
  },
  {
    flag: "build",
    short: "b",
    scripts: ["build-uki.sh", "build-image.sh"],
    tools: (arch) => [
      "fakeroot", "cpio", "gzip",
      `${architectures[arch].binutils}-objcopy`, `${architectures[arch].binutils}-objdump`,
      "parted", "mkfs.fat", "mmd", "mcopy",
    ],
  },
  {
    flag: "run",
    short: "r",
    scripts: ["run-qemu.sh"],
    tools: (arch) => [`qemu-system-${arch}`],
  },
];

function fail(message) {
  console.error(`${pkg.name}: ${message}`);
  process.exit(1);
}

function usage() {
  return `${pkg.name} - ${pkg.description}

Usage:
  ${pkg.name} [-f] [-b] [-r] [--arch ARCH] [--docker] [--export] [--linux-lts]
               [--real] [-- qemu arguments]

Stages (always run in this order, whichever you pick):
  -f, --fetch   download and verify the pinned kernel, musl, GCC runtime,
                EFI stub and Bun      (fetch-alpine.sh, fetch-bun.sh)
  -b, --build   pack the initramfs, assemble the UKI, write vda.img
                                       (build-uki.sh, build-image.sh)
  -r, --run     boot vda.img under QEMU (run-qemu.sh), with KVM or
                Hypervisor.framework when the guest matches the host CPU

  --arch ARCH   guest architecture: x86_64 (default; alias amd64, x64) or
                aarch64 (alias arm64, native speed on Apple Silicon). A bare
                -r boots whichever one vda.img was last built for
  --docker      run fetch and build inside a Debian container built from
                ./Dockerfile; always on for macOS, which lacks the toolchain

  --export      after -b/--build, copy the image to
                ./buninu-linux-${pkg.version}.img (x86_64) or
                ./buninu-linux-${pkg.version}-aarch64.img

  --linux-lts   use Alpine's general-purpose linux-lts kernel for fetch/build
                (the default is the smaller linux-virt kernel)
  --real        build for a physical machine: use linux-lts, make tty0 the
                primary console, and include USB xHCI/HID keyboard modules
                (x86_64 only)

  -h, --help    show this
  -V, --version show name, version, runtime and platform
  --readme      render README.md in the terminal and exit

Short flags combine: -fbr is the whole pipeline, -br is what an edit to
initramfs/init.js needs, -r just boots what is already there. Anything after
-- goes to qemu-system-x86_64 or qemu-system-aarch64 verbatim (for example:
-r -- -smp 4).

Fetch and build need the Debian toolchain from README "Build environment"
(PRoot, a Debian or Ubuntu host, or --docker); run needs QEMU (Termux
pkg, apt, or brew install qemu). Tools missing for the stages you picked are
reported before anything starts.
`;
}

function parse(argv) {
  const selected = new Set();
  const passthrough = [];
  let linuxLts = false;
  let real = false;
  let exportImage = false;
  let docker = false;
  // BUNINU_ARCH is what scripts/arch.sh reads; --arch overrides it.
  let arch = process.env.BUNINU_ARCH ? normalizeArch(process.env.BUNINU_ARCH) : null;
  let sawSeparator = false;

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (sawSeparator) {
      passthrough.push(argument);
    } else if (argument === "--") {
      sawSeparator = true;
    } else if (argument === "--arch") {
      if (index + 1 >= argv.length) fail("--arch needs a value: x86_64 or aarch64");
      arch = normalizeArch(argv[++index]);
    } else if (argument.startsWith("--arch=")) {
      arch = normalizeArch(argument.slice("--arch=".length));
    } else if (argument === "--docker") {
      docker = true;
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
  if (real && arch === "aarch64") {
    fail("--real builds an x86_64 PC image; it cannot be combined with --arch aarch64");
  }
  return { selected, passthrough, linuxLts, real, exportImage, docker, arch };
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

const inDocker = (stage) => useDocker && stage.flag !== "run";

function checkTools(selectedStages) {
  const missing = [];
  for (const stage of selectedStages) {
    const arch = stage.flag === "run" ? runArch : buildArch;
    for (const tool of inDocker(stage) ? ["docker"] : stage.tools(arch)) {
      if (!hasTool(tool)) missing.push(`${tool} (for --${stage.flag})`);
    }
  }
  if (missing.length > 0) {
    const hint = process.platform === "darwin"
      ? `
Install Docker Desktop (https://www.docker.com/products/docker-desktop/) for
-f/-b, and QEMU with its UEFI firmware for -r:
  brew install qemu
`
      : `
Run this command in Debian or Ubuntu first, or pass --docker to build in a container:
  apt install ${architectures[buildArch].apt} cpio curl dosfstools fakeroot mtools parted unzip
QEMU for -r:
  apt install qemu-system ovmf qemu-efi-aarch64
`;
    fail(`missing tools, nothing was run:\n  ${missing.join("\n  ")}\n${hint}`);
  }
  if (selectedStages.some(inDocker) && spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    fail("docker is installed but its daemon is not answering; start Docker Desktop (or dockerd) and retry");
  }
}

// The build image is tagged with a hash of the Dockerfile, so editing it
// builds a fresh image and an unchanged one is reused without a rebuild. The
// Dockerfile goes in on stdin: the build needs no context, and sending the
// checkout (downloads/ included) would only slow it down.
let dockerImageTag;
function dockerImage() {
  if (dockerImageTag) return dockerImageTag;
  const dockerfile = readFileSync(resolve(rootDir, "Dockerfile"));
  const tag = `buninu-linux-build:${createHash("sha256").update(dockerfile).digest("hex").slice(0, 12)}`;
  if (spawnSync("docker", ["image", "inspect", tag], { stdio: "ignore" }).status !== 0) {
    console.log(`\n==> [docker] building ${tag} from Dockerfile`);
    const result = spawnSync("docker", ["build", "--tag", tag, "-"], {
      input: dockerfile,
      stdio: ["pipe", "inherit", "inherit"],
    });
    if (result.error) fail(`could not start docker build: ${result.error.message}`);
    if (result.status !== 0) fail(`docker build exited with status ${result.status}`);
  }
  return (dockerImageTag = tag);
}

// In Docker the script runs as the invoking user, so everything it writes
// into the bind-mounted checkout stays owned by that user; fakeroot provides
// the root ownership the initramfs records.
function dockerRun(script, env) {
  const passEnv = ["BUNINU_ARCH", "LINUX_FLAVOR", "REAL_MACHINE", "ALPINE_MIRROR"]
    .filter((name) => env[name] !== undefined)
    .flatMap((name) => ["--env", `${name}=${env[name]}`]);
  const user = typeof process.getuid === "function"
    ? ["--user", `${process.getuid()}:${process.getgid()}`]
    : [];
  return [
    "run", "--rm", ...user,
    "--mount", `type=bind,src=${rootDir},dst=/src`, "--workdir", "/src",
    "--env", "HOME=/tmp", ...passEnv,
    dockerImage(), `./${script}`,
  ];
}

function runScript(stage, script, args = [], env = process.env) {
  const docker = inDocker(stage);
  console.log(
    `\n==> [${stage.flag}${docker ? " in docker" : ""}] ${script}${args.length ? " " + args.join(" ") : ""}`,
  );
  const result = docker
    ? spawnSync("docker", dockerRun(script, env), { stdio: "inherit" })
    : spawnSync(resolve(rootDir, script), args, { cwd: rootDir, stdio: "inherit", env });
  if (result.error) fail(`could not start ${script}: ${result.error.message}`);
  if (result.status !== 0) {
    fail(`${script} exited with status ${result.status ?? "signal " + result.signal}`);
  }
}

const { selected, passthrough, linuxLts, real, exportImage, docker, arch } = parse(process.argv.slice(2));
const ordered = stages.filter((stage) => selected.has(stage));
const useDocker = docker || process.platform === "darwin";
const buildArch = arch ?? "x86_64";
// A bare -r after -b boots what -b just built; otherwise what vda.img holds.
const runArch = arch ?? (selected.has(stages[1]) ? buildArch : builtArch());
checkTools(ordered);

const stageEnv = {
  ...process.env,
  ...(arch && { BUNINU_ARCH: arch }),
  ...((linuxLts || real) && { LINUX_FLAVOR: "lts" }),
  ...(real && { REAL_MACHINE: "1" }),
};

for (const stage of ordered) {
  // run-qemu.sh builds a missing vda.img itself, which needs the build
  // toolchain; with Docker that has to happen in the container first.
  if (stage.flag === "run" && useDocker && !selected.has(stages[1]) &&
      !existsSync(resolve(rootDir, "vda.img"))) {
    runScript(stages[1], "build-image.sh", [], { ...stageEnv, BUNINU_ARCH: runArch });
  }
  for (const script of stage.scripts) {
    runScript(stage, script, stage.flag === "run" ? passthrough : [], stageEnv);
  }
}

if (exportImage) {
  const source = resolve(rootDir, "vda.img");
  const suffix = buildArch === "x86_64" ? "" : `-${buildArch}`;
  const destination = resolve(invocationDir, `buninu-linux-${pkg.version}${suffix}.img`);
  try {
    accessSync(source, constants.R_OK);
    copyFileSync(source, destination);
  } catch (error) {
    fail(`could not export image to ${destination}: ${error.message}`);
  }
  console.log(`\nExported ${destination}`);
}
