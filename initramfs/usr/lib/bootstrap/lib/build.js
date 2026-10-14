import {
  appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync,
  readFileSync, readdirSync, utimesSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { bootstrap, bun, download, quote, requireRootfs } from "./common.js";

export const tools = "/bootstrap/toolchain/bin";
export const toolchain = "/bootstrap/toolchain";
export const deps = "/bootstrap/deps";
export const sourceRoot = "/bootstrap/src";
export const buildRoot = "/bootstrap/build";
export const resultRoot = "/bootstrap/result";
export function useLog(path) { log = path; }
// Build shells preserve the explicit build PATH, without the guest entry
// shell's preference for installed result tools.
export const shell = tools + "/sh";
export const make = tools + "/make";
let log;

export function stage(number, name, args) {
  if (args.length) throw new Error(`Usage: bun ${number}.build-${name}.js`);
  const { arch } = requireRootfs();
  mkdirSync(buildRoot + "/logs", { recursive: true });
  log = `${buildRoot}/logs/${number}-${name}.log`;
  note(`\n${new Date().toISOString()} Stage ${number}: ${name} (${arch})`);
  return { arch, triple: `${arch}-unknown-linux-musl` };
}

function note(text) {
  console.log(text);
  if (log) appendFileSync(log, text + "\n");
}

export function environment(extra = {}) {
  return {
    PATH: `${tools}:/bin:/usr/bin`, HOME: "/root", LC_ALL: "C",
    SHELL: shell, CONFIG_SHELL: shell, CC: tools + "/cc", CC_FOR_BUILD: tools + "/cc",
    AR: existsSync(toolchain + "/bin/ar") ? toolchain + "/bin/ar" : tools + "/bootstrap-ar",
    LD: existsSync(toolchain + "/bin/ld") ? toolchain + "/bin/ld" : tools + "/bootstrap-ld",
    RANLIB: existsSync(toolchain + "/bin/ranlib") ? toolchain + "/bin/ranlib" : ":",
    NM: toolchain + "/bin/nm", MAKE: make, MAKEINFO: ":", CFLAGS: "-O2",
    CFLAGS_FOR_TARGET: "-O2", lt_cv_sys_max_cmd_len: "32768",
    ...extra,
  };
}

export async function command(argv, cwd = buildRoot, extra = {}, capture = false) {
  mkdirSync(cwd, { recursive: true });
  note("$ " + argv.map(quote).join(" "));
  const child = Bun.spawn(argv, {
    cwd, env: environment(extra), stdin: "ignore", stdout: "pipe", stderr: "pipe",
  });
  const chunks = [];
  async function drain(stream, output, collect) {
    for await (const bytes of stream) {
      const data = Buffer.from(bytes);
      output.write(data);
      if (log) appendFileSync(log, data);
      if (collect) chunks.push(data);
    }
  }
  const [status] = await Promise.all([
    child.exited, drain(child.stdout, process.stdout, capture), drain(child.stderr, process.stderr, false),
  ]);
  if (status !== 0) throw new Error(`Command exited ${status}; see ${log}: ${argv[0]}`);
  return capture ? Buffer.concat(chunks).toString() : "";
}

export async function source(pin, directory) {
  // Verify on every stage invocation, including a cached archive.
  const archive = await download(pin);
  const target = join(sourceRoot, directory);
  if (!existsSync(target)) {
    mkdirSync(sourceRoot, { recursive: true });
    const tar = new Bun.Archive(readFileSync(archive));
    await tar.extract(sourceRoot);
    // Preserve release-generated parsers/Makefiles: extraction time must
    // not accidentally request autoconf, automake or bison regeneration.
    for (const [name, file] of await tar.files()) {
      const seconds = file.lastModified / 1000;
      utimesSync(join(sourceRoot, name), seconds, seconds);
    }
  }
  if (!existsSync(join(target, "configure"))) throw new Error(`Incomplete source tree: ${target}`);
  return target;
}

export function patch(path, before, after) {
  const old = readFileSync(path, "utf8");
  if (old.includes(after)) return;
  if (!old.includes(before)) throw new Error(`Patch context missing: ${path}`);
  writeFileSync(path, old.replaceAll(before, after));
}

export function script(path, text) {
  writeFileSync(path, "#!/bin/bun\n" + text, { mode: 0o755 });
  chmodSync(path, 0o755);
}

export function installAdapters() {
  mkdirSync(tools, { recursive: true });
  script(shell, "await import('/buninu/apps/bunmsh/src/main.js');\n");
  // Native Make/configure can exec these names; implementations remain JS.
  const names = "awk basename cat chmod cmp cp cut date diff dirname echo egrep expr false fgrep grep head ln ls mkdir mktemp mv printf pwd rm rmdir sed sleep sort tail test touch tr true uname uniq wc".split(" ");
  for (const name of names) script(`${tools}/${name}`, `
import {executeArgv,createState,finishShell} from '/buninu/apps/bunmsh/src/shell.js';
const state=createState({shellOptions:{posix:true}});
const result=await executeArgv(['builtin',${JSON.stringify(name)},...process.argv.slice(2)],state);
process.exitCode=(await finishShell(state,result.status)).status;
`);
  script(tools + "/bootstrap-ar", `import {existsSync} from 'node:fs';const ar='/bootstrap/toolchain/bin/ar';const p=Bun.spawn([...(existsSync(ar)?[ar]:['/bootstrap/toolchain/bin/tcc','-ar']),...Bun.argv.slice(2)],{stdin:'inherit',stdout:'inherit',stderr:'inherit'});process.exitCode=await p.exited;\n`);
  script(tools + "/bootstrap-ld", `import {existsSync} from 'node:fs';const ld='/bootstrap/toolchain/bin/ld';const p=Bun.spawn([existsSync(ld)?ld:'/bootstrap/toolchain/bin/tcc',...Bun.argv.slice(2)],{stdin:'inherit',stdout:'inherit',stderr:'inherit'});process.exitCode=await p.exited;\n`);
  installCc();
}

export function installCc() {
  script(tools + "/cc", `
import {existsSync} from 'node:fs';
const args=Bun.argv.slice(2);
const info=args.length===0 || args.every(a=>['-v','--version','-h','-hh','--help','-dumpversion','-dumpmachine','-print-search-dirs'].includes(a));
const linking=!info && !args.some(a=>['-c','-E','-S','-r'].includes(a));
const archive=process.arch==='x64'?'/bootstrap/toolchain/lib/tcc/libbootstrap-tcc-x64.a':'/bootstrap/toolchain/lib/tcc/libbootstrap-tcc-arm64.a';
const runtime=linking&&existsSync(archive)?[archive]:[];
const p=Bun.spawn(['/bootstrap/toolchain/bin/tcc',...args,...(info?[]:['-B/bootstrap/toolchain/lib/tcc','-nostdinc','-I/usr/include','-I/bootstrap/toolchain/lib/tcc/include','-L/usr/lib','-L/lib',...runtime,...(linking?['-lgcc_s']:[])])],{stdin:'inherit',stdout:'inherit',stderr:'inherit'});
process.exitCode=await p.exited;
`);
}

export async function configure(src, build, flags, extra = {}) {
  await command([bun(), "/buninu/apps/bunmsh/index.js", src + "/configure", ...flags], build, extra);
}

export async function makeIn(build, targets = ["all"], extra = {}) {
  const jobs = process.env.BOOTSTRAP_JOBS || "2";
  if (!/^[1-9][0-9]*$/.test(jobs)) throw new Error("BOOTSTRAP_JOBS must be a positive integer");
  await command([make, "SHELL=" + shell, "MAKEINFO=:", "-j" + jobs, ...targets], build, extra);
}

export function canonicalizers(src) {
  const binutils = sourceRoot + "/binutils-2.39";
  for (const name of ["config.sub", "config.guess"]) {
    copyFileSync(join(binutils, name), join(src, name));
    chmodSync(join(src, name), 0o755);
  }
}

export function ready(number, message) {
  note(`Stage ${number} verified: ${message}`);
  if (number < 12) {
    const next = readdirSync(bootstrap).find(name => name.startsWith(`${number + 1}.`) && name.endsWith(".js"));
    if (!next) throw new Error(`Missing stage ${number + 1}`);
    note(`Next: bun /bootstrap/${next}`);
  }
}
