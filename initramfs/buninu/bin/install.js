#!/usr/bin/env bun

import pkg from "../package.json" with { type: "json" };
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  lutimesSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const binDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(binDir, "..");

function fail(message) {
  console.error(`${pkg.name}: ${message}`);
  process.exit(1);
}

export function installUsage() {
  return `${pkg.name} install - copy this installation to a durable directory

Usage:
  ${pkg.name} --install [target-dir]
  ${pkg.name} --strip-install [target-dir]

Install options:
  -i,  --install [dir]        Install into <dir>/${pkg.name}/ (default mode)
  -si, --strip-install [dir]  Install into <dir>/ directly, no top-level
                               directory of its own
  -f,  --force                Install over the destination as is, replacing
                               local changes instead of merging them
  -y,  --yes                  Do not ask before replacing files that were
                               edited locally
  -h,  --help                 Show this help and exit

The target directory defaults to the current directory, so running this
script with no arguments installs into ./${pkg.name}/.

Installing over an existing ${pkg.name} updates it. Files are only added and
overwritten, never deleted, so anything the installation added of its own
survives, and the three files both sides write to are merged:

  package.json    the local buninu section is kept, every other field is
                   taken from this package
  apps/cmdlist    command names the installation added are kept
  .bashrc         kept when it only adds to the shipped one, otherwise kept
                   as is with the shipped version left beside it as
                   .bashrc.dist

Relative symbolic links are copied exactly as stored rather than followed,
so bin/androidNativeLibs and the multicall command links survive the copy
and are rebuilt for the destination platform on the next normal startup.
`;
}

export function parseInstallArguments(arguments_) {
  let strip = false;
  let force = false;
  let yes = false;
  let help = false;
  let target = null;

  const setTarget = (value, option) => {
    if (!value) fail(`${option} requires a directory`);
    if (target !== null) fail(`install accepts one target directory, got: ${value}`);
    target = value;
  };

  for (const argument of arguments_) {
    if (argument === "-i" || argument === "--install") {
      strip = false;
    } else if (argument === "-si" || argument === "--strip-install") {
      strip = true;
    } else if (argument.startsWith("--install=")) {
      strip = false;
      setTarget(argument.slice("--install=".length), "--install");
    } else if (argument.startsWith("--strip-install=")) {
      strip = true;
      setTarget(argument.slice("--strip-install=".length), "--strip-install");
    } else if (argument === "-f" || argument === "--force") {
      force = true;
    } else if (argument === "-y" || argument === "--yes") {
      yes = true;
    } else if (argument === "-h" || argument === "--help") {
      help = true;
    } else if (argument.startsWith("-")) {
      fail(`unknown install option: ${argument}`);
    } else {
      setTarget(argument, "install");
    }
  }

  return { strip, force, yes, help, target: target ?? process.cwd() };
}

function hasEntries(path) {
  try {
    return readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

function readTextOrNull(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function readJsonOrNull(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

// Null when the directory is an installation to update, otherwise the reason it
// was not taken for one. Saying which check failed is what separates "this is
// someone else's directory" from "this installation is damaged", which
// otherwise arrive as the same refusal.
//
// Identity rests on the name in package.json alone. A missing bin/init.js means
// an installation is broken, not that it is somebody else's, and refusing there
// would leave --force as the only way to repair it — which would take the
// user's own configuration down with it instead of merging it back.
function notInstallReason(path) {
  const manifest = readJsonOrNull(resolve(path, "package.json"));
  if (!manifest) return "it has no readable package.json";
  if (manifest.name !== pkg.name) {
    return `its package.json is "${manifest.name}", not ${pkg.name}`;
  }
  return null;
}

// True when every line of `base` is still present in `current`, in order, so
// the only edits are insertions. A line inserted in the middle leaves the
// lines below it untouched by this reading, which is what a line-by-line
// comparison gets wrong: it reports everything past the insertion as changed.
// Equivalent to the shipped version being a subsequence of the installed one,
// which is the same thing as a line diff whose only operation is insert.
function isAdditionsOnly(base, current) {
  let index = 0;
  for (const line of current) {
    if (index < base.length && base[index] === line) index += 1;
  }
  return index === base.length;
}

// Matches how bin/init.js reads the list when it rebuilds the command links.
function commandNames(text) {
  return [...new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  )];
}

// Read what the destination owns before the copy overwrites it. Only the three
// files a user and the package both write to need this; everything else is
// owned outright by one side or the other.
function readInstalledState(destination) {
  return {
    buninu: readJsonOrNull(resolve(destination, "package.json"))?.buninu,
    cmdlist: readTextOrNull(resolve(destination, "apps", "cmdlist")),
    bashrc: readTextOrNull(resolve(destination, ".bashrc")),
  };
}

// Files applyMerge already protects. They show up as modified the moment the
// installation is configured at all, so asking about them would be noise that
// trains the answer rather than informing it.
const MERGED_PATHS = new Set(["package.json", "apps/cmdlist", ".bashrc"]);

const DIFF_TIMEOUT_MS = 60_000;

// `bun pm diff <name>@<version> <dir>` compares the published version an
// installation reports against the installation itself, so the registry holds
// the pristine copy and nothing has to be recorded locally to find out what
// the user changed. Files it calls added are theirs and are never deleted by
// an update; only modified ones are about to be written over.
async function findLocalChanges(destination, version) {
  const argv = [
    process.execPath, "pm", "diff",
    `${pkg.name}@${version}`, destination,
    "--name-only", "--json",
  ];

  // On a line of its own, unprefixed, and on stdout rather than stderr with
  // the rest of the output, so it stands out and `2>/dev/null` leaves just the
  // command: copy it and run it by hand without --json to read the list, or
  // without --name-only to see the changes themselves rather than which files
  // hold them.
  console.log(`  ${argv.join(" ")}`);

  const child = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, DIFF_TIMEOUT_MS);

  let status;
  let stdout;
  let stderr;
  try {
    [status, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
  } catch (error) {
    return { files: null, error: error.message };
  } finally {
    clearTimeout(timer);
  }

  if (timedOut) {
    return { files: null, error: `bun pm diff did not finish within ${DIFF_TIMEOUT_MS / 1000}s` };
  }

  if (status !== 0) {
    const reason = stderr.trim().split(/\r?\n/).at(-1);
    return { files: null, error: reason || `bun pm diff exited with ${status}` };
  }

  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    return { files: null, error: "bun pm diff did not return JSON" };
  }

  const modified = (report.files ?? [])
    .filter((file) => file.status === "modified" && !MERGED_PATHS.has(file.path));

  return {
    files: modified.filter((file) => !isModeOnlyChange(file)).map((file) => file.path),
    modeOnly: modified.filter(isModeOnlyChange).length,
    error: null,
  };
}

// Publishing normalises file modes, so a file can come back from the registry
// with a different executable bit and identical contents. bun pm diff calls
// that a modification, and reporting it would mean a freshly installed tree
// listing files nobody has touched. modeBefore and modeAfter are only present
// when the mode differs at all; the rest is what says the bytes did not.
function isModeOnlyChange(file) {
  return file.modeBefore !== undefined &&
    file.linesAdded === 0 &&
    file.linesRemoved === 0 &&
    file.bytesBefore === file.bytesAfter;
}

// Returns null when there is no terminal to ask at, which the caller reports
// rather than treating as either answer.
async function confirm(question) {
  if (!process.stdin.isTTY) return null;
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await readline.question(question)).trim().toLowerCase() === "y";
  } finally {
    readline.close();
  }
}

function applyMerge(destination, installed) {
  const notes = [];

  // package.json: the package owns every field except the buninu section,
  // which is the user's configuration and travels with the installation.
  if (installed.buninu !== undefined) {
    const path = resolve(destination, "package.json");
    const shipped = readJsonOrNull(path);
    if (shipped) {
      shipped.buninu = installed.buninu;
      writeFileSync(path, `${JSON.stringify(shipped, null, 2)}\n`);
      notes.push("package.json: kept the local buninu section");
    }
  }

  // apps/cmdlist: a set of names, so the shipped list plus whatever names the
  // installation added is the whole merge. Appending only the extras keeps
  // this idempotent across repeated updates.
  if (installed.cmdlist !== null) {
    const path = resolve(destination, "apps", "cmdlist");
    const shippedText = readTextOrNull(path) ?? "";
    const shipped = commandNames(shippedText);
    const extras = commandNames(installed.cmdlist).filter((name) => !shipped.includes(name));
    if (extras.length) {
      writeFileSync(
        path,
        `${shippedText.replace(/\n*$/, "\n")}\n# Added by this installation, kept across updates\n${extras.join("\n")}\n`,
      );
      notes.push(`apps/cmdlist: kept ${extras.length} local command name(s): ${extras.join(", ")}`);
    }
  }

  // .bashrc: free-form text the user edits directly, so it can only be merged
  // when the shipped lines all survive in it. Without a copy of the version
  // this installation was built from there is no third side to merge against,
  // so anything else is reported rather than guessed at.
  if (installed.bashrc !== null) {
    const path = resolve(destination, ".bashrc");
    const shipped = readTextOrNull(path) ?? "";
    if (installed.bashrc !== shipped) {
      writeFileSync(path, installed.bashrc);
      if (isAdditionsOnly(shipped.split(/\r?\n/), installed.bashrc.split(/\r?\n/))) {
        notes.push(".bashrc: kept, it only adds to the shipped one");
      } else {
        writeFileSync(`${path}.dist`, shipped);
        notes.push(".bashrc: kept as is, the shipped version is now .bashrc.dist");
      }
    }
  }

  return notes;
}

// Never copied into an installation. A source checkout's repository is not
// part of Buninu, it is large, and copying it into a destination that is
// itself a repository would write over that repository's own objects and refs.
// Only the top level is checked: the tree ships no nested repository.
const EXCLUDED_ENTRIES = new Set([".git"]);

function copySources(source) {
  return readdirSync(source)
    .filter((entry) => !EXCLUDED_ENTRIES.has(entry))
    .map((entry) => resolve(source, entry));
}

function copyTree(source, destination) {
  // Naming the entries instead of copying `source/.` is what leaves the
  // excluded ones behind; listing them explicitly also keeps dotfiles such as
  // .bashrc in, which a bare glob would drop.
  const sources = copySources(source);

  const cp = Bun.which("cp");
  if (cp) {
    // -a implies -d, so symbolic links are recreated as links instead of being
    // followed. -f matches the fs path's force option: it unlinks and retries a
    // destination file that cannot be opened, which reinstalling over
    // read-only files (.git/objects is mode 444) needs.
    const result = Bun.spawnSync([cp, "-af", ...sources, `${destination}/`], {
      stdout: "inherit",
      stderr: "inherit",
    });
    if (result.exitCode !== 0) fail(`cp -af failed with exit ${result.exitCode}`);
    return "cp -af";
  }

  for (const entry of sources) copyEntry(entry, resolve(destination, basename(entry)));
  return "node:fs";
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
}

// Deliberately not fs.cpSync: it stats destination entries through their
// symbolic links, so reinstalling over a tree that already contains the
// dangling relative links Buninu ships (bin/musl-la -> shloader ->
// androidNativeLibs/...) fails with ENOENT before copying anything.
function copyEntry(source, destination) {
  const stats = lstatSync(source);
  const mode = stats.mode & 0o7777;

  if (stats.isSymbolicLink()) {
    // Recreate the link with its target string untouched. Resolving it would
    // turn bin/androidNativeLibs -> ../.. into a copy of the parent tree.
    rmSync(destination, { recursive: true, force: true });
    try {
      symlinkSync(readlinkSync(source), destination);
      // lutimes, not utimes: the latter follows the link and would stamp the
      // target instead. Not every platform implements it, and a link's own
      // timestamp matters to nothing here, so a failure is not worth reporting.
      try {
        lutimesSync(destination, stats.atime, stats.mtime);
      } catch {}
    } catch (error) {
      // Windows refuses symbolic links without the right privileges. Those
      // links are unused there (bin/*.bat stands in for them), so a warning
      // beats aborting an otherwise complete install.
      console.error(`${pkg.name}: skipped symbolic link ${destination}: ${error.message}`);
    }
    return;
  }

  if (stats.isDirectory()) {
    const existing = lstatOrNull(destination);
    if (existing && !existing.isDirectory()) rmSync(destination, { recursive: true, force: true });
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source)) {
      copyEntry(resolve(source, entry), resolve(destination, entry));
    }
    chmodSync(destination, mode);
    utimesSync(destination, stats.atime, stats.mtime);
    return;
  }

  // Device nodes, FIFOs and sockets. Nothing Buninu ships is one of these, and
  // recreating them needs mknod, so say what was left out instead of dropping
  // it silently and letting the gap surface later as a missing file.
  if (!stats.isFile()) {
    console.error(`${pkg.name}: skipped ${source}: not a regular file, directory, or symbolic link`);
    return;
  }

  // Read-only files (.git/objects is mode 444) cannot be written over, so
  // unlink first, the way cp -f does.
  rmSync(destination, { force: true });
  copyFileSync(source, destination);
  chmodSync(destination, mode);
  utimesSync(destination, stats.atime, stats.mtime);
}

// Returns true when the update should not go ahead.
async function confirmLocalChanges(destination, version, options) {
  if (!version) {
    console.error(`${pkg.name}: it does not report a version, so it cannot be checked for local changes`);
    return false;
  }

  // Said before the check rather than after: it reaches the registry, so it can
  // sit there for a while with nothing on screen to explain the wait.
  console.error(`${pkg.name}: comparing it against the published ${version} for local changes...`);

  const { files, modeOnly, error } = await findLocalChanges(destination, version);

  // The check needs the registry, so it cannot run offline or against a version
  // that was never published. Whether anything was edited locally is then
  // unknown, which is not the same as knowing there was nothing: ask when there
  // is someone to ask, and only fall through to updating when there is not.
  if (error) {
    console.error(`${pkg.name}: could not check it for local changes: ${error}`);
    if (options.yes) return false;

    const answer = await confirm("Update without knowing what it would replace? (y/N) ");
    if (answer === null) {
      console.error(`${pkg.name}: no terminal to ask at, updating anyway`);
      return false;
    }
    if (!answer) {
      console.error(`${pkg.name}: update cancelled, nothing was changed`);
      return true;
    }
    return false;
  }

  // Worth saying rather than hiding: it explains why the count here is smaller
  // than the one the printed command reports, and a mode that keeps coming back
  // is worth knowing about even though an update is not what changed it.
  if (modeOnly) {
    console.error(
      `${pkg.name}: ${modeOnly} file(s) differ only in file mode, with identical contents; ignoring them`,
    );
  }

  if (!files.length) return false;

  console.error(
    `${pkg.name}: ${files.length} file(s) differ from ${pkg.name}@${version} and will be replaced:`,
  );
  for (const file of files) console.error(`  ${file}`);

  if (options.yes) return false;

  const answer = await confirm("Update anyway? (y/N) ");
  if (answer === null) {
    fail("not running in a terminal, pass --yes to update anyway");
  }
  if (!answer) {
    console.error(`${pkg.name}: update cancelled, nothing was changed`);
    return true;
  }
  return false;
}

export async function runInstall(arguments_ = []) {
  const options = parseInstallArguments(arguments_);
  if (options.help) {
    console.log(installUsage());
    return 0;
  }

  const target = resolve(options.target);
  const destination = options.strip ? target : resolve(target, pkg.name);

  // Copying a tree into itself either fails or recurses forever, depending on
  // which of the two copy paths runs, so refuse both shapes up front.
  const fromSource = relative(rootDir, destination);
  if (!fromSource) fail(`install destination is this installation: ${destination}`);
  if (!fromSource.startsWith("..") && !isAbsolute(fromSource)) {
    fail(`install destination is inside this installation: ${destination}`);
  }

  // An existing installation is updated rather than refused: the copy only
  // ever adds and overwrites, and the files both sides write to are merged
  // afterwards. --force skips the merge and leaves the shipped versions.
  const occupied = existsSync(destination) && hasEntries(destination);
  const reason = occupied ? notInstallReason(destination) : null;
  const update = occupied && reason === null;
  if (occupied && !update && !options.force) {
    console.error(`${pkg.name}: ${destination} is not empty, and ${reason}`);
    fail("pass --force to install over it, or name another directory");
  }

  // Named before anything is written, on every path that has found an existing
  // installation: --force replaces it without asking, so that is the one that
  // most needs to say which directory it is about to overwrite.
  if (update) {
    const installedVersion = readJsonOrNull(resolve(destination, "package.json"))?.version;
    console.error(
      installedVersion
        ? `${pkg.name}: found ${pkg.name}@${installedVersion} at ${destination}`
        : `${pkg.name}: found an unversioned ${pkg.name} installation at ${destination}`,
    );

    if (!existsSync(resolve(destination, "bin", "init.js"))) {
      console.error(`${pkg.name}: it is missing bin/init.js; updating restores it`);
    }

    if (options.force) {
      console.error(`${pkg.name}: --force, replacing it without checking for local changes`);
    } else {
      const cancelled = await confirmLocalChanges(destination, installedVersion, options);
      if (cancelled) return 1;
    }
  }

  const installed = update && !options.force ? readInstalledState(destination) : null;

  mkdirSync(destination, { recursive: true });
  const method = copyTree(rootDir, destination);
  const notes = installed ? applyMerge(destination, installed) : [];

  const action = update ? (options.force ? "overwrote" : "updated") : "installed to";
  console.error(`${pkg.name}@${pkg.version}: ${action} ${destination} (${method})`);
  for (const note of notes) console.error(`  ${note}`);
  if (update && options.force) {
    console.error("  --force: local package.json, apps/cmdlist and .bashrc were replaced");
  }
  console.error(`Start it with: bun ${resolve(destination, "bin", "init.js")}`);
  return 0;
}

if (import.meta.main) {
  process.exitCode = await runInstall(process.argv.slice(2));
}
