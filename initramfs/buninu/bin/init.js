#!/usr/bin/env bun

import pkg from "../package.json" with { type: "json" };
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { homedir, tmpdir as systemTmpDir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const binDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(binDir, "..");
const REPO_ROOT = rootDir;

function fail(message) {
  console.error(`${pkg.name}: ${message}`);
  process.exit(1);
}

function usage() {
  return `${pkg.name} - ${pkg.description}

Usage:
  ${pkg.name} [init options] [jsgotty options]

Init options:
  --local
    Start Buninu in this terminal
      instead of a Remote Shell
      reached from a browser
      (via jsgotty, the default)

  -h, --help
    Show this help and exit
  -V, --version
    Show version & runtime info, then exit

  --readme
    Render README.md in the terminal and exit
  --changelog
    Render CHANGELOG.md in the terminal and exit

  --readme-tui
    Open README.md as a Terminal UI
  --readme-wui
    Serve README.md as a Web UI

  --export [output.tgz]
    Export this Buninu installation
    (default: ./buninu.tgz)

  --export-config [output.json]
    Export Buninu's package.json
    (default: ./buninu.json)

Install options:
  -i, --install [dir]    
    Install this package into <dir>/${pkg.name}
    (default: .)

  -si, --strip-install [dir]  
    Install into <dir> directly
    Without a top-level directory of its own
      
  (--install --help for full options)
  
Remote Shell options:
  --shell <path|name>
    Override buninu.shell for this run
  --command <command>
    Override buninu.command for this run

Direct app launch
(must be the first argument)
(skips the shell/command startup flow entirely):

  --jsgotty [args...]    
    Spawn jsgotty directly,
      forwarding remaining arguments,
      and exit with its exit code
  (--jsgotty --help = jsgotty options)
  
  --jsmdcui [args...]
    Spawn jsmdcui directly, 
      same forwarding behavior
      
  --bunmsh [args...]
    Spawn bunmsh directly, 
      same forwarding behavior
      
  --musl-la [args...]
    Spawn musl-la directly,
      same forwarding behavior

Package configuration:
  package.json contains a buninu section for default and platform settings.
  buninu.shell          Select the shell to start
  buninu.command        Run a startup command before entering the shell
  buninu.exitAfterCmd   Exit after buninu.command instead of falling back to
                         the shell (default: false)

All other options are forwarded to jsgotty. Without buninu.command, the
selected shell starts directly. With a command, it runs from the package.json
directory and then returns to the interactive shell regardless of exit status,
unless buninu.exitAfterCmd is true, in which case it exits instead.
`;
}

async function handleInformationArguments(arguments_) {
  if (arguments_.includes("-h") || arguments_.includes("--help")) {
    console.log(usage());
    return true;
  }

  if (arguments_.includes("-V") || arguments_.includes("--version")) {
    console.log(`${pkg.name}: ${pkg.description}`);
    console.log("Version:", pkg.version);
    console.log("Runtime:", `Bun ${Bun.version}`);
    console.log("Platform:", `${process.platform}/${process.arch}`);
    return true;
  }

  const exportOption = readExportArgument(arguments_);
  if (exportOption) {
    await exportInstallation(exportOption.output);
    return true;
  }

  const exportConfigOption = readExportConfigArgument(arguments_);
  if (exportConfigOption) {
    await exportConfig(exportConfigOption.output);
    return true;
  }

  if (arguments_.includes("--readme")) {
    const readmePath = resolve(REPO_ROOT, "README.md");
    if (!await pathExists(readmePath)) fail(`README not found: ${readmePath}`);
    const markdown = await Bun.file(readmePath).text();
    process.stdout.write(Bun.markdown.ansi(markdown, { hyperlinks: true }));
    if (!markdown.endsWith("\n")) process.stdout.write("\n");
    return true;
  }

  const markdownUi = arguments_.includes("--readme-tui")
    ? "--tui"
    : arguments_.includes("--readme-wui")
      ? "--wui"
      : null;
  if (markdownUi) {
    await openReadmeMarkdownUi(markdownUi);
    return true;
  }

  if (arguments_.includes("--changelog")) {
    const changelogPath = resolve(REPO_ROOT, "CHANGELOG.md");
    if (!await pathExists(changelogPath)) fail(`CHANGELOG not found: ${changelogPath}`);
    const markdown = await Bun.file(changelogPath).text();
    process.stdout.write(Bun.markdown.ansi(markdown, { hyperlinks: true }));
    if (!markdown.endsWith("\n")) process.stdout.write("\n");
    return true;
  }

  return false;
}

// jsmdcui writes five generated companion files beside the Markdown it opens
// (`*.md.front.js`, `*.md.back.js`, `*.md.html`, `*.md-rpc.js`,
// `*.md-server.js`), and needs that directory to be writable. Run it on a copy
// under TMPDIR rather than on README.md in place: an installation is the
// user's to keep, `--export` would carry the generated files to another
// machine, an update never deletes them again, and under `npx` the package
// directory is a cache that should not be written to at all. Nothing is lost
// by the move -- the README's only image is a remote URL, and what makes it
// navigable is same-document `#heading-id` links, which resolve wherever the
// file sits.
async function openReadmeMarkdownUi(mode) {
  const readmePath = resolve(REPO_ROOT, "README.md");
  if (!await pathExists(readmePath)) fail(`README not found: ${readmePath}`);

  const entry = resolve(rootDir, "apps", "jsmdcui", "src", "index.js");
  if (!await pathExists(entry)) fail(`jsmdcui not found: ${entry}`);

  const environment = await detectEnvironment();
  const workDir = resolve(resolveTmpDir(environment), "buninu-readme");
  // Start from a clean directory so a stale generated file from an older
  // README can never be served in place of a freshly generated one.
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const target = resolve(workDir, "README.md");
  await Bun.write(target, Bun.file(readmePath));

  // jsmdcui's entry point is a bundled CLI with no exports: it reads
  // process.argv at the top level and runs. Set the argv it expects and import
  // it, so this stays one process instead of spawning a second Bun.
  process.argv = [process.argv[0], entry, mode, target];
  await import(entry);

  // jsmdcui owns the process from here on: it holds the terminal UI, or the
  // Web UI server, open. Never resolve -- returning would hand control back to
  // the caller, whose process.exit(0) would cut the UI off before it draws.
  // This keeps no handle of its own, so once jsmdcui's are gone the process
  // still ends on its own.
  await new Promise(() => {});
}

function readExportArgument(arguments_) {
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--export") {
      const next = arguments_[index + 1];
      return { output: next || "buninu.tgz" };
    }
    if (argument.startsWith("--export=")) {
      const output = argument.slice("--export=".length);
      if (!output) fail("--export= requires an output path");
      return { output };
    }
  }
  return null;
}

function readExportConfigArgument(arguments_) {
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--export-config") {
      const next = arguments_[index + 1];
      return { output: next || "buninu.json" };
    }
    if (argument.startsWith("--export-config=")) {
      const output = argument.slice("--export-config=".length);
      if (!output) fail("--export-config= requires an output path");
      return { output };
    }
  }
  return null;
}

async function exportInstallation(output) {
  const outputPath = resolve(process.cwd(), output);
  const tar = Bun.which(process.platform === "win32" ? "tar.exe" : "tar") || Bun.which("tar");
  if (!tar) fail("tar was not found in PATH");

  mkdirSync(dirname(outputPath), { recursive: true });
  const temporaryDir = mkdtempSync(resolve(systemTmpDir(), "buninu-export-"));
  const temporaryArchive = resolve(temporaryDir, "buninu.tgz");
  const temporaryBackup = resolve(temporaryDir, "previous-output.tgz");
  const hadExistingOutput = existsSync(outputPath);
  let exportError = null;
  try {
    // Keep the previous output recoverable, but remove it from its original
    // path while tar walks REPO_ROOT so an in-tree export cannot include itself.
    if (hadExistingOutput) {
      if (!lstatSync(outputPath).isFile()) throw new Error(`export path is not a file: ${outputPath}`);
      await Bun.write(temporaryBackup, Bun.file(outputPath));
      unlinkSync(outputPath);
    }
    const process_ = Bun.spawn(
      [tar, "-czf", temporaryArchive, "-C", dirname(REPO_ROOT), basename(REPO_ROOT)],
      { env: { ...process.env }, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
    );
    const status = await process_.exited;
    if (status !== 0) throw new Error(`tar failed with exit ${status}`);
    await Bun.write(outputPath, Bun.file(temporaryArchive));
  } catch (error) {
    exportError = error;
    if (hadExistingOutput && await pathExists(temporaryBackup)) {
      await Bun.write(outputPath, Bun.file(temporaryBackup));
    }
  } finally {
    rmSync(temporaryDir, { recursive: true, force: true });
  }

  if (exportError) fail(exportError?.message || String(exportError));
  console.log(outputPath);
}

async function exportConfig(output) {
  const outputPath = resolve(process.cwd(), output);

  if (existsSync(outputPath)) {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    let answer;
    try {
      answer = await rl.question(`${outputPath} already exists and may be overwritten. Continue? [y/N] `);
    } finally {
      rl.close();
    }
    if (!/^[yY]/.test(answer.trim())) fail("Cancelled: output file was not overwritten");
  }

  const packageJsonPath = resolve(REPO_ROOT, "package.json");
  await Bun.write(outputPath, Bun.file(packageJsonPath));
  console.log(outputPath);
}

function splitCommand(command) {
  const words = [];
  let word = "";
  let quote = "";
  let escaped = false;

  for (const char of command.trim()) {
    if (escaped) {
      word += char;
      escaped = false;
    } else if (char === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (char === quote) quote = "";
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (word) words.push(word), word = "";
    } else {
      word += char;
    }
  }

  if (escaped || quote) fail("invalid quoting in package.json scripts.start");
  if (word) words.push(word);
  return words;
}

async function pathExists(path) {
  return Bun.file(path).exists();
}

async function findCommand(command) {
  if (!command) return null;
  if (command.includes("/") || command.includes("\\")) {
    const path = isAbsolute(command) ? command : resolve(rootDir, command);
    return await pathExists(path) ? path : null;
  }
  return Bun.which(command);
}

async function detectEnvironment() {
  const windows = process.platform === "win32" || Boolean(process.env.WINDIR);
  const termux = !windows && await pathExists("/data/data/com.termux/files/usr/bin/bash");
  const android = !windows && !termux && (
    process.platform === "android" ||
    await pathExists("/system/bin/linker64") ||
    Boolean(process.env.ANDROID_ROOT && process.env.ANDROID_DATA)
  );

  if (windows) {
    return {
      name: "windows",
      shell:
        Bun.which("pwsh.exe") ||
        Bun.which("powershell.exe") ||
        await findCommand(process.env.COMSPEC) ||
        Bun.which("cmd.exe") ||
        "cmd.exe",
    };
  }

  if (termux) {
    return {
      name: "linux",
      shell:
        // await findCommand(process.env.SHELL) ||
        Bun.which("bash") ||
        Bun.which("sh") ||
        "/bin/sh",
    };
  }

  if (android) {
    return {
      name: "android",
      shell:
        // await findCommand(process.env.SHELL) ||
        (await pathExists("/system/bin/sh") ? "/system/bin/sh" : null) ||
        Bun.which("bash") ||
        Bun.which("sh") ||
        "/bin/sh",
    };
  }

  if (process.platform === "darwin") {
    return {
      name: "macos",
      shell:
        // await findCommand(process.env.SHELL) ||
        Bun.which("zsh") ||
        Bun.which("bash") ||
        Bun.which("sh") ||
        "/bin/zsh",
    };
  }

  if (process.platform === "linux") {
    return {
      name: "linux",
      shell:
        // await findCommand(process.env.SHELL) ||
        Bun.which("bash") ||
        Bun.which("sh") ||
        "/bin/sh",
    };
  }

  return {
    name: `unix:${process.platform}`,
    shell:
      // await findCommand(process.env.SHELL) ||
      Bun.which("bash") ||
      Bun.which("sh") ||
      "/bin/sh",
  };
}

async function runPlatformSwitch(environment) {
  const scriptName = environment.name === "android"
    ? "switch_to_android.sh"
    : environment.name === "linux"
      ? "switch_to_linux.sh"
      : null;
  if (!scriptName) return;

  const scriptPath = resolve(binDir, scriptName);
  if (!await pathExists(scriptPath)) {
    fail(`platform switch script does not exist: ${scriptPath}`);
  }

  const shell = environment.name === "android" && await pathExists("/system/bin/sh")
    ? "/system/bin/sh"
    : Bun.which("sh") || "/bin/sh";
  const result = Bun.spawn([shell, scriptPath], {
    cwd: rootDir,
    env: { ...process.env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await result.exited;
  if (status !== 0) {
    fail(`${scriptName} failed with exit ${status}`);
  }
}

async function rebuildNativeSymlinks(environment) {
  if (environment.name === "windows") return;

  const platformLinks = environment.name === "android"
    ? {
        bun: "androidNativeLibs/libbun.so",
        shloader: "androidNativeLibs/libsh-loader.so",
      }
    : {
        bun: "bun.sh",
        shloader: "multicall.sh",
      };
  const cmdlistPath = resolve(rootDir, "apps", "cmdlist");
  if (!await pathExists(cmdlistPath)) {
    fail(`command list does not exist: ${cmdlistPath}`);
  }

  const commandNames = [...new Set(
    (await Bun.file(cmdlistPath).text())
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  )];
  for (const name of commandNames) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
      fail(`invalid command name in ${cmdlistPath}: ${name}`);
    }
  }

  const links = Object.fromEntries([
    ...Object.entries(platformLinks),
    ...commandNames.map((name) => [name, "shloader"]),
  ]);

  for (const [name, target] of Object.entries(links)) {
    const linkPath = resolve(binDir, name);
    try {
      const existing = lstatSync(linkPath);
      if (!existing.isSymbolicLink()) {
        fail(`cannot rebuild symlink over non-symlink: ${linkPath}`);
      }
      unlinkSync(linkPath);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    symlinkSync(target, linkPath);
  }
}

function getFreePort() {
  const listener = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data() {},
    },
  });
  const port = listener.port;
  listener.stop(true);
  return port;
}

// buninu.xdgDataHome moves the data directory XDG-aware programs write to,
// bunmsh's command history among them, without touching HOME: a shell started
// here still finds the SSH keys and Git configuration in the user's own home.
// `true` puts it inside the installation so it travels with a copied tree; a
// string names a directory, resolved from the package.json directory when it
// is relative, the way buninu.shell already resolves one.
function configuredXdgDataHome() {
  const configured = pkg.buninu?.xdgDataHome;
  if (configured === true) return resolve(rootDir, ".local", "share");
  if (typeof configured !== "string" || !configured.trim()) return null;
  return isAbsolute(configured) ? configured : resolve(rootDir, configured);
}

function resolveTmpDir(environment) {
  const androidCacheDir = resolve(dirname(rootDir), "cache");
  return process.env.TMPDIR || (
    environment.name === "android"
      ? existsSync(androidCacheDir)
        ? androidCacheDir
        : resolve(rootDir, "tmp")
      : systemTmpDir()
  );
}

async function createChildEnvironment(environment) {
  const tmpDir = resolveTmpDir(environment);
  const homeDir = process.env.HOME || homedir() || rootDir;
  const envFile = await pathExists(resolve(rootDir, ".bashrc"))
    ? resolve(rootDir, ".bashrc")
    : await pathExists(resolve(homeDir, ".bashrc"))
      ? resolve(homeDir, ".bashrc")
      : null;

  const xdgDataHome = configuredXdgDataHome();

  mkdirSync(tmpDir, { recursive: true });
  if (xdgDataHome) mkdirSync(xdgDataHome, { recursive: true });

  const inheritedPath = process.env.PATH || "";
  const hasTermuxExecPreload =
    environment.name === "android" &&
    String(process.env.LD_PRELOAD || "").includes("libtermux-exec.so");
  const pathEntries = [
    ...(hasTermuxExecPreload ? ["/system/bin"] : []),
    inheritedPath,
    binDir,
  ].filter(Boolean);

  const childEnvironment = { ...process.env };
  for (const key of Object.keys(childEnvironment)) {
    if (key.toLowerCase() === "path") delete childEnvironment[key];
  }
  childEnvironment[environment.name === "windows" ? "Path" : "PATH"] =
    pathEntries.join(delimiter);

  return {
    ...childEnvironment,
    HOME: homeDir,
    TMPDIR: tmpDir,
    SHELL: process.env.SHELL || environment.shell,
    BUNINU_HOME: rootDir,
    ...(xdgDataHome ? { XDG_DATA_HOME: xdgDataHome } : {}),
    ...(envFile ? { ENV: envFile } : {}),
    TERM: process.env.TERM || "xterm-256color",
    COLORTERM: process.env.COLORTERM || "truecolor",
    DISPLAY: process.env.DISPLAY || "127.0.0.1:0",
  };
}

const directAppTargets = {
  "--jsgotty": "jsgotty",
  "--jsmdcui": "jsmdcui",
  "--bunmsh": "bunmsh",
  "--musl-la": "musl-la",
};

async function runDirectApp(name, forwardedArgs, environment) {
  const isWindows = environment.name === "windows";
  const launcherPath = resolve(binDir, isWindows ? `${name}.bat` : name);
  if (!await pathExists(launcherPath)) {
    fail(`${name} is not available on ${environment.name}: ${launcherPath}`);
  }

  const childEnvironment = await createChildEnvironment(environment);
  const argv = isWindows
    ? [process.env.ComSpec || "cmd.exe", "/c", launcherPath, ...forwardedArgs]
    : [launcherPath, ...forwardedArgs];

  const child = Bun.spawn(argv, {
    cwd: rootDir,
    env: childEnvironment,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await child.exited);
}

function readInitArguments(arguments_) {
  const forwarded = [];
  let shell = null;
  let command = null;

  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--shell" || argument === "--terminal") {
      shell = arguments_[index + 1];
      if (!shell) fail(`${argument} requires a command or executable path`);
      index += 1;
    } else if (argument.startsWith("--shell=") || argument.startsWith("--terminal=")) {
      shell = argument.slice(argument.indexOf("=") + 1);
      if (!shell) fail(`${argument.split("=")[0]} requires a command or executable path`);
    } else if (argument === "--command") {
      command = arguments_[index + 1];
      if (!command) fail("--command requires a shell command string");
      index += 1;
    } else if (argument.startsWith("--command=")) {
      command = argument.slice("--command=".length);
      if (!command) fail("--command requires a shell command string");
    } else {
      forwarded.push(argument);
    }
  }

  return { shell, command, forwarded };
}

function shellCommandArguments(shell, command, exitAfterCmd) {
  if (!command) return [shell];

  const shellName = basename(shell).toLowerCase();
  if (shellName === "cmd" || shellName === "cmd.exe") {
    if (exitAfterCmd) return [shell, "/d", "/s", "/c", command];
    const quotedShell = `"${shell.replaceAll('"', '""')}"`;
    return [shell, "/d", "/s", "/c", `${command} & ${quotedShell}`];
  }

  if (["powershell", "powershell.exe", "pwsh", "pwsh.exe"].includes(shellName)) {
    if (exitAfterCmd) {
      return [
        shell,
        "-NoLogo",
        "-Command",
        `& { ${command}; if (-not $?) { Write-Error 'Startup command failed' } }`,
      ];
    }
    const escapedShell = shell.replaceAll("'", "''");
    return [
      shell,
      "-NoLogo",
      "-Command",
      `& { ${command}; if (-not $?) { Write-Error 'Startup command failed' }; & '${escapedShell}' -NoExit }`,
    ];
  }

  const wrapped =
    `buninu_command=$1; shift; ( eval "$buninu_command" ); _buninu_status=$?; ` +
    `if [ "$_buninu_status" -ne 0 ]; then ` +
    `echo "buninu: startup command failed with exit $_buninu_status" >&2; ` +
    (exitAfterCmd ? `fi; exit "$_buninu_status"` : `fi; exec "$0"`);
  // Pass both the shell and startup command as argv instead of interpolating
  // them into the wrapper. This keeps the wrapper single-line and avoids LF
  // (Ctrl+J) characters in its process-list representation.
  return [shell, "-c", wrapped, shell, command];
}

// Install is a mode of its own rather than a startup option, so it follows the
// same "must be the first argument" rule as the direct app launches above and
// never competes with an argument being forwarded to jsgotty.
function isInstallArgument(argument = "") {
  return argument === "-i" || argument === "--install" ||
    argument === "-si" || argument === "--strip-install" ||
    argument.startsWith("--install=") || argument.startsWith("--strip-install=");
}

if (isInstallArgument(process.argv[2])) {
  const { runInstall } = await import("./install.js");
  process.exit(await runInstall(process.argv.slice(2)));
}

let startScript = pkg.scripts?.start;

if(process.argv.includes('--local'))
  startScript = pkg.scripts?.local ;

if (typeof startScript !== "string" || !startScript.trim()) {
  fail("package.json does not define scripts.start");
}

const directAppTarget = directAppTargets[process.argv[2]];
if (directAppTarget) {
  const directEnvironment = await detectEnvironment();
  await runPlatformSwitch(directEnvironment);
  await rebuildNativeSymlinks(directEnvironment);
  await runDirectApp(directAppTarget, process.argv.slice(3), directEnvironment);
}

if (await handleInformationArguments(process.argv.slice(2))) process.exit(0);

const command = splitCommand(startScript);
if (!command.length) fail("package.json scripts.start is empty");

// Use the Bun currently running init.js instead of relying on a second PATH lookup.
if (command[0] === "bun") command[0] = process.execPath;

const environment = await detectEnvironment();
await runPlatformSwitch(environment);
await rebuildNativeSymlinks(environment);
const initArguments = readInitArguments(process.argv.slice(2));
const configuredShell =
  pkg.buninu?.shell?.[environment.name] ??
  pkg.buninu?.shell?.default ??
  null;
const requestedShell =
  initArguments.shell ||
  configuredShell;

if (requestedShell) {
  const resolvedShell = await findCommand(requestedShell);
  if (!resolvedShell) {
    fail(`configured shell does not exist: ${requestedShell}`);
  }
  environment.shell = resolvedShell;
}

const commandConfiguration = pkg.buninu?.command;
const configuredCommand =
  typeof commandConfiguration === "string"
    ? commandConfiguration
    : commandConfiguration?.[environment.name] ??
      commandConfiguration?.default ??
      null;
const startupCommand = initArguments.command ?? configuredCommand;
const exitAfterCmd = Boolean(pkg.buninu?.exitAfterCmd);

const forwardedArguments = initArguments.forwarded;
const hasExplicitPort = forwardedArguments.some((argument) =>
  argument === "-p" ||
  argument === "--port" ||
  argument.startsWith("--port=")
);
const portArguments = hasExplicitPort ? [] : ["-p", String(getFreePort())];
const childEnvironment = await createChildEnvironment(environment);

const infoSuffix = 
  process.argv.includes('--local') ? 
  'bunmsh' :
  `port=${portArguments[1] || "user-defined"}, shell=${environment.shell}` ;

console.error(
  `${pkg.name}@${pkg.version}: ${environment.name}/${process.arch}, ` + infoSuffix
);

const child = Bun.spawn(
  [
    ...command,
    ...portArguments,
    ...forwardedArguments,
    ...shellCommandArguments(environment.shell, startupCommand, exitAfterCmd),
  ],
  {
    cwd: rootDir,
    env: childEnvironment,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  },
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

process.exit(await child.exited);
