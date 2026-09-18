#!/usr/bin/env bun

// bunx <package>[@version] [args...]
//
// Buninu's own bunx: ensures <package> is globally installed via `bun i -g`,
// then execs the matching ~/.bun/bin/<binary> directly, forwarding the
// remaining arguments. Registered in apps/cmdlist like any other Buninu
// command; whether it actually shadows the real `bunx` (Bun's own
// ephemeral-run subcommand) depends on whether Buninu's bin/ comes before it
// in PATH -- Buninu appends its bin/ to the inherited PATH rather than
// prepending it, so an already-installed bun's own bunx will normally still
// win unless this one is invoked some other way.
//
// The "when do we reinstall" rules below are ported from real bunx's own
// decision tree (src/runtime/cli/bunx_command.rs in the Bun source tree),
// adapted from its private per-version cache to this script's single shared
// `bun i -g` install:
//   - an explicit dist-tag (e.g. "latest", "next") never reuses a cached
//     binary -- real bunx sets look_for_existing_bin = false for that case
//     and always resolves fresh.
//   - a missing binary always installs.
//   - an explicit pinned/ranged version reinstalls if bun's own global
//     install record (install/global/package.json) doesn't already list
//     that same version string for this package -- there is no equivalent
//     check in real bunx because its cache is already keyed by version; this
//     is this script's substitute, since `bun i -g` overwrites one shared
//     path regardless of version.
//   - otherwise, reinstall once the binary is older than 24h
//     (SECONDS_CACHE_VALID in bunx_command.rs), or if it can't be stat'd at
//     all -- real bunx also treats a stat failure as stale.

const fs = require("fs");
const path = require("path");

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // matches real bunx's SECONDS_CACHE_VALID

function fail(message) {
  console.error(`bunx: ${message}`);
  process.exit(1);
}

// Split "@scope/name@version" (or unscoped variants) into name/version/pkgName.
// version is "" when the spec didn't include one.
function parseSpec(spec) {
  let rest = spec;
  let scope = "";
  if (rest.startsWith("@")) {
    const slash = rest.indexOf("/");
    if (slash === -1) fail(`invalid package spec: ${spec}`);
    scope = rest.slice(0, slash);
    rest = rest.slice(slash + 1);
  }
  const at = rest.lastIndexOf("@");
  const name = at === -1 ? rest : rest.slice(0, at);
  const version = at === -1 ? "" : rest.slice(at + 1);
  return { name, version, pkgName: scope ? `${scope}/${name}` : name };
}

// A bare word like "latest"/"next"/"beta"/"canary" is an npm dist-tag.
// Anything starting with a digit, "v", or a range operator is treated as a
// real pinned version/range instead.
function isDistTag(version) {
  return !/^[vV]?\d|^[\^~<>=]/.test(version);
}

// Ask bun itself where its global bin dir is, rather than re-deriving
// $BUN_INSTALL/$HOME ourselves -- this is the same resolution bun's own
// installer used, so it can't disagree with where `bun i -g` actually put
// things (config file settings included, not just env vars).
//
// `bun pm bin -g` only works once something has been globally installed at
// least once (it errors with "no package.json" for install/global before
// that project exists). On a fresh $BUN_INSTALL/$HOME this script hasn't
// installed anything yet either, so fall back to the plain env-var
// computation for that first call -- needsInstall() below will see nothing
// at that path and install, which creates the project bun pm needs, so every
// call after the first one resolves through bun pm bin -g instead.
function globalBinDir() {
  const result = Bun.spawnSync(["bun", "pm", "bin", "-g"], {
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.exitCode === 0) return result.stdout.toString().trim();
  return path.join(process.env.BUN_INSTALL || path.join(process.env.HOME, ".bun"), "bin");
}

// `bun i -g` produces bin/<name> on POSIX (a relative symlink resolved via
// shebang) but bin/<name>.exe on Windows (a compiled shim + a companion
// .bunx metadata file -- Windows has neither reliable symlinks nor shebang
// support). Missing this suffix means every Windows lookup below finds
// nothing, which is harmless: needsInstall() just treats it as "not
// installed on this platform yet" and installs it here.
const EXE_SUFFIX = process.platform === "win32" ? ".exe" : "";

// Buninu on Android isn't actually running inside Termux, so nothing sets
// $PREFIX -- but some installed CLIs check it at runtime to find themselves
// relative to a Termux/Android system. Fake it only for the actual target
// execution below (not the `bun i -g` install step); an existing $PREFIX
// (e.g. genuinely running under Termux) is left alone.
function childEnv() {
  if (process.platform !== "android" || process.env.PREFIX) return process.env;
  return { ...process.env, PREFIX: "/data/data/com.termux/files/usr" };
}

function recordedVersion(bunInstallRoot, pkgName) {
  const manifestPath = path.join(bunInstallRoot, "install", "global", "package.json");
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return manifest.dependencies && manifest.dependencies[pkgName];
  } catch {
    return undefined;
  }
}

function needsInstall(bunInstallRoot, target, version, pkgName) {
  if (version && isDistTag(version)) return true;
  if (!fs.existsSync(target)) return true;
  if (version && recordedVersion(bunInstallRoot, pkgName) !== version) return true;
  try {
    const age = Date.now() - fs.statSync(target).mtimeMs;
    return age > CACHE_TTL_MS;
  } catch {
    return true;
  }
}

const args = process.argv.slice(2);
if (args.length < 1) fail("usage: bunx <package>[@version] [args...]");

const spec = args[0];
const forwarded = args.slice(1);
const { name: bin, version, pkgName } = parseSpec(spec);
const binDir = globalBinDir();
const bunInstallRoot = path.dirname(binDir);
const target = path.join(binDir, bin + EXE_SUFFIX);

if (needsInstall(bunInstallRoot, target, version, pkgName)) {
  // Same Android check bin/init.js's detectEnvironment() uses. Android's
  // storage (FUSE-backed app-private paths) frequently rejects hardlinks
  // and symlinks across the directories bun links between, so fall back to
  // plain file copies there; hardlink (bun's default) is fine elsewhere.
  const installArgs = ["bun", "i", "-g", spec];
  if (fs.existsSync("/system/bin/linker64")) installArgs.push("--backend=copyfile");

  const install = Bun.spawnSync(installArgs, {
    stdio: ["inherit", "inherit", "inherit"],
  });
  
  // Don't check exit code so even if
  // bun install killed by SIGSYS @issue #39060
  // bunx still runs with actually existing bin
  //if (install.exitCode !== 0) process.exit(install.exitCode ?? 1);
}

if (!fs.existsSync(target)) {
  fail(`${spec} installed but ${target} not found (binary name may differ from package name)`);
}

// Run through `bun <target>` instead of exec'ing `target` directly. Real
// bunx does the latter (relies on the OS reading the shebang), which is fine
// on desktop but not reliable here: on Android the resolved bin usually
// lives under a path mounted noexec, so the kernel refuses to exec it even
// though it's readable and chmod +x. `bun` itself is the one binary Android
// does let us execute (from nativeLibraryDir), so hand it the target as an
// argument to read+run rather than exec directly. Trade-off: a package whose
// "bin" is a real native executable (not a JS/bun script) won't run this
// way -- accepted, since that's the rarer case and this is what makes the
// common (JS-script bin) case work on Android at all.
const run = Bun.spawnSync(["bun", target, ...forwarded], {
  env: childEnv(),
  stdio: ["inherit", "inherit", "inherit"],
});
process.exit(run.exitCode ?? 1);
