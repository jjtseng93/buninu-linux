import { basename, dirname, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import child_process from "node:child_process";
import { ASSETS_ROOT } from "./assetsPacker.js";


export const IS_COMPILED = isCompiledBinary();
export const REPO_ROOT = IS_COMPILED
  ? getExeDirname()
  : resolve(import.meta.dirname, ASSETS_ROOT);
//  This file's own directory. Not derived from REPO_ROOT: the only user
//  is buildExecutable(), which already refuses to run when IS_COMPILED,
//  so REPO_ROOT there is always the source tree, and going back down
//  through it would hard-code this folder name.
const SINGLE_EXE_DIR = import.meta.dirname;


export function isCompiledBinary(argv = process.argv) {
  const entry = argv?.[1];
  return Boolean(
    entry?.startsWith?.("/$bunfs/") ||
    entry?.startsWith?.("B:/~BUN")
  );
}

export function getExeDirname() {
  const argv = process.argv
  const execPath = process.execPath
  
  const bn = basename(execPath);
  if (bn.startsWith("ld") || 
      bn.startsWith("libld") ||
      bn.startsWith("linker") ) {
    const realArgv = readFileSync("/proc/self/cmdline", "utf8").match(/[^\0]+/g);
    return dirname(realArgv?.[1] ?? execPath);
  }
  return dirname(execPath) || process.cwd();
}

export function getDirnameFromUrl(importMetaUrl) {
  return dirname(fileURLToPath(importMetaUrl));
}

export function stringifyNonPrimitiveDefineValues(argv, name) {
  const definePrefix = `${name}=`;
  const numberLiteral = /^[+-]?(?:(?:0[xX][\dA-Fa-f](?:_?[\dA-Fa-f])*)|(?:0[bB][01](?:_?[01])*)|(?:0[oO][0-7](?:_?[0-7])*)|(?:(?:\d(?:_?\d)*)(?:\.(?:\d(?:_?\d)*)?)?|\.(?:\d(?:_?\d)*))(?:[eE][+-]?\d(?:_?\d)*)?)$/;

  // Parse scalar literals as data. Never evaluate a user-provided expression.
  const normalize = (definition) => {
    if (!definition.startsWith(definePrefix)) return definition;
    const source = definition.slice(definePrefix.length);
    const trimmed = source.trim();
    let value;
    let parsed = false;

    try {
      value = JSON.parse(source);
      parsed = true;
    } catch {
      try {
        if (globalThis.Bun?.JSON5) {
          value = globalThis.Bun.JSON5.parse(source);
          parsed = true;
        }
      } catch {}
    }

    if (parsed && typeof value === "string") {
      return definePrefix + JSON.stringify(value);
    }
    if (
      (parsed && (
        value === null
        || typeof value === "number"
        || typeof value === "boolean"
      ))
      || trimmed === "undefined"
      || numberLiteral.test(trimmed)
    ) {
      return definition;
    }
    return definePrefix + JSON.stringify(source);
  };

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--define" && typeof argv[i + 1] === "string") {
      argv[i + 1] = normalize(argv[i + 1]);
    } else if (argv[i]?.startsWith?.("--define=")) {
      argv[i] = "--define="
        + normalize(argv[i].slice("--define=".length));
    }
  }
  return argv;
}

export async function buildExecutable(target = "",build_outfile="single.exe", bunArgs = []) {
 
  let outfile = resolve(process.cwd(), build_outfile);
  const normalizedTarget = String(target || "").trim();
  const extraBunArgs = Array.from(bunArgs ?? [], String);
  if(!globalThis.Bun || IS_COMPILED)
  {
    console.log("Build exe can only be run by Bun in the source tree");
    return 1;
  }
  
  let bunBin=Bun.which('bun') || process.argv0;

  const steps = [
    {
      label: "Pack assets",
      cwd: SINGLE_EXE_DIR,
      cmd: bunBin,
      args: ["./packAssets.sh"],
    },
    {
      label: "Compile executable",
      cwd: SINGLE_EXE_DIR,
      cmd: bunBin,
      args: [
        "build",
        "--format=esm",
        "--compile",
        "--minify",
        "--bytecode",
        "./entry.mjs",
        `--outfile=${outfile}`,
        `--metafile-md=${outfile}.meta.md`,
        ...(normalizedTarget ? [`--target=${normalizedTarget}`] : []),
        ...extraBunArgs,
      ],
    },
  ];

  for (const step of steps) {
  
    console.log('');
    console.log(Bun?.markdown?.ansi?.('## '+step.label)||step.label); 
    
    console.log("Running: ",step.cmd,step.args)
  
    const result = child_process.spawnSync(step.cmd, step.args, {
      cwd: step.cwd,
      stdio: "inherit",
      env: process.env,
    });
    
    console.log("");
    console.log(Bun?.markdown?.ansi?.(
      '- Status: '+result.status+' for '+step.label
    )||result.status);



    if (result.error || result.status !== 0) {
    
      if (result.error) {
        console.error(result.error);
      }
      
      if (step.label == "Pack assets") {
        console.log("Pack assets failed; continuing with the existing assets.tar if available");
      }
      
    }
    
    
  }  //  for steps of build

  const isWindows = normalizedTarget
    ? normalizedTarget.toLowerCase().includes("windows")
    : process.platform === "win32";
  if (isWindows && !outfile.toLowerCase().endsWith(".exe")) {
    outfile += ".exe";
  }
  if(await Bun.file(outfile).exists())
  {
    console.log(`Built executable: ${outfile}`);
    return 0;
  }
  else
  {
    console.log(`Error while building executable: ${outfile}`);
    return 1;
  }
}

export const buildExe = buildExeAssets;

export async function buildEarlyExit(argv,build_outfile) {
  argv = argv || process.argv

  const buildExeIndex = argv.indexOf("--build-exe");
  const buildForIndex = argv.indexOf("--build-for");

  if (buildExeIndex === -1 && buildForIndex === -1) {
    return false;
  }
  
  if (IS_COMPILED) {
    console.error("--build-exe & --build-for are only available in the source tree");
    process.exit(1);
  }

  if (buildForIndex !== -1) {
    const target = argv[buildForIndex + 1];
    if (!target || target.startsWith("-")) {
      console.error("Missing target value for --build-for");
      process.exit(2);
    }
    process.exit(await buildExe(target, build_outfile, argv.slice(buildForIndex + 2)));
  }

  process.exit(await buildExe(null, build_outfile, argv.slice(buildExeIndex + 1)));
}


//  Multi-package variant of buildExecutable().
//
//  Every package that ships assets vendors its own single-exe/, and its
//  assetsHelper imports its assetsPacker, so a packer shows up in the
//  bundle's module graph exactly when that package is actually reachable
//  from this entry point. A scan build writes that graph to a metafile,
//  and each packer found there appends its own namespaced members to one
//  shared assets.tar before the real compile runs.
export async function buildExeAssets(target = "", build_outfile = "single.exe", bunArgs = []) {
  let outfile = resolve(process.cwd(), build_outfile);
  const normalizedTarget = String(target || "").trim();
  const extraBunArgs = Array.from(bunArgs ?? [], String);

  if (!globalThis.Bun || IS_COMPILED) {
    console.log("Build exe can only be run by Bun in the source tree");
    return 1;
  }

  const bunBin = Bun.which("bun") || process.argv0;
  const ownPacker = resolve(SINGLE_EXE_DIR, "assetsPacker.js");
  const archive = resolve(SINGLE_EXE_DIR, "assets.tar");
  const metafile = `${outfile}.meta.json`;
  const scanDir = `${outfile}.scan`;

  //  ASSETS_BUNFS swaps the tar for `--compile --asset`: every packer
  //  copies into one fixed build/assets, and --asset keeps only that
  //  folder's basename, so the members land at assets/<name>@<version>/
  //  exactly as the tar back end writes them.
  const bunfs = Boolean(process.env.ASSETS_BUNFS);
  const staging = resolve(REPO_ROOT, "build", "assets");

  //  Nothing loads a tar in bunfs mode, so the asset loader — and the
  //  `assets.tar` it imports — cannot be in the graph. Everything else in
  //  entry.mjs still has to run, so the compile entry is a generated copy
  //  of it with that one import removed.
  //
  //  Handing the main program to `bun build` directly would be simpler and
  //  breaks two ways. Whatever entry.mjs does after the import is lost, and
  //  a CommonJS program relying on a `require.main` guard the bundler
  //  inlines to false would never start. Worse, `--bytecode` only marks the
  //  chunk as an async module when a top-level await appears in an
  //  unwrapped part's own source; a main program that reaches top-level
  //  await only through `__esm`-wrapped dependencies is then evaluated on
  //  the sync path, its suspended generator is dropped, and the binary
  //  exits 0 having run nothing. entry.mjs awaits in its own source, so the
  //  copy carries that flag the way the tar build always has.
  const bunfsEntry = resolve(SINGLE_EXE_DIR, ".bunfs-entry.mjs");
  const dropBunfsEntry = () => bunfs && rmSync(bunfsEntry, { force: true });

  if (bunfs && !writeBunfsEntry(resolve(SINGLE_EXE_DIR, "entry.mjs"), bunfsEntry)) {
    return 1;
  }

  const compileEntry = bunfs ? bunfsEntry : "./entry.mjs";

  const step = (label, args, cwd) => {
    console.log("");
    console.log(Bun?.markdown?.ansi?.("## " + label) || label);
    console.log("Running: ", bunBin, args);

    const result = child_process.spawnSync(bunBin, args, {
      cwd,
      stdio: "inherit",
      env: process.env,
    });

    console.log("");
    console.log(Bun?.markdown?.ansi?.("- Status: " + result.status + " for " + label) || result.status);

    if (result.error) console.error(result.error);
    return result.status ?? 1;
  };

  //  What each packer is told to write into, and in which mode.
  const packInto = bunfs ? ["-f", staging] : ["-f", archive, "-p"];

  if (bunfs) {
    mkdirSync(staging, { recursive: true });
    console.log("");
    console.log(`Staging assets into ${staging}`);
  } else if (step("Pack own assets", [ownPacker, ...packInto], SINGLE_EXE_DIR) !== 0) {
    //  Tar mode packs first: the scan below has to resolve entry.mjs's
    //  `with { type: "file" }` import of the archive.
    console.error("Own assets failed to pack");
    return 1;
  }

  //  Bundle only. The binary is thrown away, so skip --compile, --minify
  //  and --bytecode; the module graph is the same and it is much faster.
  if (step("Scan module graph", ["build", compileEntry, "--target=bun", `--metafile=${metafile}`, `--outdir=${scanDir}`], SINGLE_EXE_DIR) !== 0) {
    console.error("Scan build failed");
    dropBunfsEntry();
    return 1;
  }

  const packers = findAssetPackers(metafile, SINGLE_EXE_DIR, bunfs ? "" : ownPacker);
  rmSync(scanDir, { recursive: true, force: true });

  console.log("");
  console.log(`Found ${packers.length} asset packer(s) to run`);

  for (const packer of packers) {
    const name = dirname(dirname(packer)).split("/").pop();

    //  Tar mode appends to a shared archive; folder mode needs no -r
    //  because each package owns its own <name>@<version> subtree.
    const args = bunfs ? [packer, ...packInto] : [packer, ...packInto, "-r"];

    if (step(`Pack ${name}`, args, dirname(packer)) !== 0) {
      console.error(`Failed to pack assets from ${packer}`);
      dropBunfsEntry();
      return 1;
    }
  }

  //  Compress last. Every packer above reads the archive and writes it
  //  back uncompressed, so this has to happen after the final append.
  //  libarchive sniffs the format on read, so assetsLoader needs no
  //  change to consume it. Nothing to compress in bunfs mode.
  if (bunfs) {
    // no archive in this mode
  } else if (process.env.ASSETS_NO_GZIP) {
    console.log("");
    console.log("ASSETS_NO_GZIP is set, leaving the archive uncompressed");
  } else {
    console.log("");
    console.log(Bun?.markdown?.ansi?.("## Compress assets") || "Compress assets");

    try {
      const raw = await Bun.file(archive).bytes();
      const gzipped = Bun.gzipSync(raw, { level: 9 });

      await Bun.write(archive, gzipped);

      const pct = raw.byteLength ? Math.round((1 - gzipped.byteLength / raw.byteLength) * 100) : 0;
      console.log(`${raw.byteLength} -> ${gzipped.byteLength} bytes (-${pct}%)`);
    } catch (e) {
      console.error("Could not compress the archive; continuing uncompressed");
      console.error(e);
    }
  }

  if (step("Compile executable", [
    "build",
    "--format=esm",
    "--compile",
    "--minify",
    "--bytecode",
    compileEntry,
    ...(bunfs ? ["--asset", staging] : []),
    `--outfile=${outfile}`,
    `--metafile-md=${outfile}.meta.md`,
    ...(normalizedTarget ? [`--target=${normalizedTarget}`] : []),
    ...extraBunArgs,
  ], SINGLE_EXE_DIR) !== 0) {
    console.error("Compile failed");
  }

  dropBunfsEntry();

  const isWindows = normalizedTarget ? normalizedTarget.toLowerCase().includes("windows") : process.platform === "win32";
  if (isWindows && !outfile.toLowerCase().endsWith(".exe")) {
    outfile += ".exe";
  }

  if (await Bun.file(outfile).exists()) {
    console.log(`Built executable: ${outfile}`);
    return 0;
  }

  console.log(`Error while building executable: ${outfile}`);
  return 1;
}


//  entry.mjs, minus the import of the asset loader, written to `outFile`
//  as the compile entry for bunfs builds. Returns whether it was written.
//
//  A textual copy, not a generated stub: entry.mjs may do more than import
//  the main program, and all of it has to survive.
export function writeBunfsEntry(entryFile, outFile) {
  let src;

  try {
    src = readFileSync(entryFile, "utf8");
  } catch (e) {
    console.error(`Could not read ${entryFile}`);
    console.error(e);
    return false;
  }

  //  Whole-line side-effect import of the loader, in any of the shapes a
  //  project might have written it. Nothing else may reference it: the
  //  loader is what pulls in `assets.tar`, which no bunfs build produces.
  const loaderImport = /^[ \t]*import\s+(?:[^"'\n]*\bfrom\s+)?["'][^"'\n]*assetsLoader\.mjs["'][ \t]*;?[ \t]*$/gm; // "
  const stripped = src.replace(loaderImport, "");

  if (stripped === src) {
    console.log("");
    console.log(`No assetsLoader import found in ${entryFile}; compiling it as is`);
  }

  const header =
    "//  Generated by single-exe/compiled.js for ASSETS_BUNFS=1 builds.\n"
    + "//  A copy of entry.mjs without the asset loader; edit entry.mjs.\n";

  //  A hashbang is only a hashbang on the first line; anywhere else it is
  //  a syntax error. Keep it there and put the header underneath, unless
  //  the file is nothing but a hashbang and there is no underneath.
  const firstBreak = stripped.indexOf("\n");
  const hasHashbang = stripped.startsWith("#!");
  const hashbang = hasHashbang && firstBreak !== -1 ? stripped.slice(0, firstBreak + 1) : "";

  try {
    writeFileSync(
      outFile,
      hasHashbang && !hashbang
        ? stripped
        : hashbang + header + stripped.slice(hashbang.length),
    );
  } catch (e) {
    console.error(`Could not write ${outFile}`);
    console.error(e);
    return false;
  }

  return true;
}


//  The main program, as declared by the last import of entry.mjs. That
//  file is already the one place an adopting project edits.
export function lastEntryImport(entryFile) {
  let src;

  try {
    src = readFileSync(entryFile, "utf8");
  } catch {
    return "";
  }

  //  Drop comments first, or a commented-out import would win.
  src = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  const re = /\bimport\b[^"'\n]*["']([^"']+)["']/g; // "
  let last = "";

  for (let m; (m = re.exec(src)) !== null; ) last = m[1];

  return last;
}


//  Absolute, de-duplicated paths of every assetsPacker.js in the metafile,
//  minus `own`. Metafile input keys are relative to the build's cwd.
export function findAssetPackers(metafilePath, baseDir, own = "") {
  if (!existsSync(metafilePath)) return [];

  let meta;
  try {
    meta = JSON.parse(readFileSync(metafilePath, "utf8"));
  } catch (e) {
    console.error(`Could not read metafile ${metafilePath}`);
    console.error(e);
    return [];
  }

  const found = new Set();

  for (const key of Object.keys(meta?.inputs ?? {})) {
    if (basename(key) !== "assetsPacker.js") continue;

    const abs = resolve(baseDir, key);
    if (abs === own || !existsSync(abs)) continue;

    found.add(abs);
  }

  return [...found].sort();
}
