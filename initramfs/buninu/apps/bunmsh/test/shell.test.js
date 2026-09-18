import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, statSync, symlinkSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  bunShellFallbackArgv,
  builtinNames,
  createState,
  decode,
  execute,
  colorProcessCommand,
  colorProcessTable,
  highlightShellCommand,
  executeArgv,
  formatProcessTable,
  isJavaScriptMode,
  needsMoreInput,
  parse,
  parsePosixProcessList,
  parseWindowsProcessList,
  runUnameFallback,
  SH_COLORS,
  taskkillFailure,
  tokenize,
  windowsKillCommand,
} from "../src/shell.js";
import {
  CommandIndex,
  FileIndex,
  VariableIndex,
  completionContext,
  fitGhost,
  firstPrefixMatch,
  historyGhost,
  javascriptContext,
  nextGhostChunk,
  prefixMatches,
  variableCompletion,
  variableContext,
} from "../src/completion.js";
import {
  bunmshHistoryPath,
  importedHistory,
  parseBashHistory,
  parseFishHistory,
  readlineHistory,
  saveBunmshHistory,
  safeHistoryEntry,
} from "../src/history.js";
import { isLinkerPath } from "../single-exe/compiled.js";
import { readAssetText } from "../single-exe/assetsHelper.js";
import { fancyLs } from "../src/fancy-ls.js";
import { MOUSE_OFF, MOUSE_ON, mouseInput } from "../src/mouse.js";
import { canonicalEnvironment, environmentValue, homeRelativePath } from "../src/environment.js";
import { findIsRegularBuiltin } from "../src/find.js";

async function run(source, options = {}) {
  const state = createState({
    env: { HOME: "/tmp", ...options.env },
    cwd: options.cwd ?? process.cwd(),
    args: options.args ?? ["bunmsh"],
    history: options.history ?? [],
    mouseTracking: options.mouseTracking,
    pathSearch: options.pathSearch,
  });
  const output = await execute(source, state, { capture: true });
  return {
    ...output,
    stdout: decode(output.stdout),
    stderr: decode(output.stderr),
    state,
  };
}

describe("parser", () => {
  test("recognizes supported ELF and Android dynamic linker names", () => {
    expect(isLinkerPath("/lib/ld-linux-aarch64.so.1")).toBe(true);
    expect(isLinkerPath("/lib/ld-musl-x86_64.so.1")).toBe(true);
    expect(isLinkerPath("/system/bin/linker64")).toBe(true);
    expect(isLinkerPath("/system/bin/linker")).toBe(true);
    expect(isLinkerPath("/usr/bin/ld")).toBe(false);
    expect(isLinkerPath("/usr/bin/bun")).toBe(false);
  });

  test("tokenizes quotes and operators", () => {
    const tokens = tokenize(`echo "a b" | cat && print ok`);
    expect(tokens.filter((token) => token.type === "op").map((token) => token.value))
      .toEqual(["|", "&&"]);
  });

  test("parses a pipeline", () => {
    expect(parse("echo hi | tr a-z A-Z")[0].pipeline).toHaveLength(2);
  });

  test("a bare trailing backslash asks for one more interactive line, then joins", () => {
    // This is what the interactive prompt loop's `pending` string looks like
    // the instant Enter is pressed after typing "echo hi \" -- the next
    // physical line hasn't arrived yet, so there's no following "\n" for the
    // ordinary backslash-newline splice to recognize.
    expect(needsMoreInput("echo hi \\")).toBe(true);
    expect(() => tokenize("echo hi \\", { strict: true }))
      .toThrow("unterminated line continuation");
    // Once the next line lands, `pending` gains the "\n" and the pair joins
    // into one already-complete command -- no more waiting.
    expect(needsMoreInput("echo hi \\\nbye")).toBe(false);
    expect(tokenize("echo hi \\\nbye").map((token) => token.fragments?.[0]?.text))
      .toEqual(["echo", "hi", "bye"]);
  });

  test("non-strict tokenize keeps accepting a trailing backslash as a literal word", () => {
    // Only needsMoreInput's strict parse should wait for more input; a
    // script or -c string whose last line genuinely ends in "\" at EOF keeps
    // parsing the same way it always has.
    const tokens = tokenize("echo hi \\");
    expect(tokens.at(-1).fragments).toEqual([{ text: "\\", quote: "none" }]);
  });
});

describe("completion", () => {
  test("treats Windows Path as PATH after copying process.env", () => {
    const env = canonicalEnvironment({
      TEMP: "C:\\Temp",
      Path: "C:\\Windows;C:\\Tools",
      UserProfile: "C:\\Users\\me",
    }, "win32");
    expect(env.PATH).toBe("C:\\Windows;C:\\Tools");
    expect(env.Path).toBeUndefined();
    expect(env.HOME).toBe("C:/Users/me");
    expect(environmentValue({ path: "C:\\Bin" }, "PATH", "win32")).toBe("C:\\Bin");
    expect(canonicalEnvironment({
      HOME: "D:\\ShellHome",
      USERPROFILE: "C:\\Users\\ignored",
    }, "win32").HOME).toBe("D:/ShellHome");
    expect(canonicalEnvironment({
      HOMEDRIVE: "C:",
      HOMEPATH: "\\Users\\fallback",
    }, "win32").HOME).toBe("C:/Users/fallback");
    expect(findIsRegularBuiltin("win32")).toBe(true);
    expect(findIsRegularBuiltin("linux")).toBe(false);
  });

  test("recognizes Android app-data aliases and Windows case in HOME-relative paths", () => {
    expect(homeRelativePath(
      "/data/user/0/com.termux/files/home",
      "/data/data/com.termux/files/home",
    )).toBe("");
    expect(homeRelativePath(
      "/data/data/com.termux/files/home/project",
      "/data/user/0/com.termux/files/home",
    )).toBe("/project");
    expect(homeRelativePath(
      "c:/users/name/project",
      "C:\\Users\\Name",
      "win32",
    )).toBe("/project");
    expect(homeRelativePath("/elsewhere", "/home/name")).toBeNull();
  });

  test("removes split SGR mouse and cursor reports from readline input", async () => {
    const mice = [];
    const cursors = [];
    const shortcuts = [];
    let forwarded = "";
    const input = mouseInput(
      (event) => mice.push(event),
      (position) => cursors.push(position),
      (shortcut) => shortcuts.push(shortcut),
    );
    input.on("data", (chunk) => { forwarded += chunk.toString(); });
    input.write("echo ");
    input.write("\x1b[<0;12");
    input.write(";3M\x1b[4;9Rok\x14\x1bt\x1bl\x1bu\x1bp\x1bc");
    input.end();
    await new Promise((resolve) => input.once("end", resolve));
    expect(forwarded).toBe("echo ok");
    expect(mice).toEqual([{ button: 0, x: 12, y: 3, press: true }]);
    expect(cursors).toEqual([{ row: 4, column: 9 }]);
    expect(shortcuts).toEqual([
      "tab", "tab-left", "lsfancy", "lsfancy-parent", "lsfancy-parent",
      "tab-close",
    ]);
  });

  test("imports Bash and Fish history by default and can be disabled", async () => {
    expect(parseBashHistory("#1720000000\necho bash\n\nshared\n"))
      .toEqual(["echo bash", "shared"]);
    expect(parseFishHistory("- cmd: echo fish\n  when: 1720000001\n- cmd: shared\n"))
      .toEqual(["echo fish", "shared"]);
    expect(parseFishHistory("- cmd: echo invalid YAML: value\n  when: 1720000002\n- cmd: cp Hello2.apk /sdcard/Documents/\n"))
      .toEqual(["echo invalid YAML: value", "cp Hello2.apk /sdcard/Documents/"]);

    const home = mkdtempSync(join(tmpdir(), "bunmsh-history-"));
    try {
      mkdirSync(join(home, ".local", "share", "fish"), { recursive: true });
      await Bun.write(join(home, ".bash_history"), "echo bash\nshared\n");
      await Bun.write(join(home, ".local", "share", "fish", "fish_history"),
        "- cmd: echo fish\n  when: 1720000001\n- cmd: shared\n");
      expect(await importedHistory({ HOME: home }))
        .toEqual(["echo bash", "echo fish", "shared"]);
      expect(await importedHistory({ HOME: home, BUNMSH_IMPORT_HISTORY: "off" })).toEqual([]);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  test("rejects terminal controls from every history source and ghost lookup", () => {
    const dangerous = "cp file\x1b[2D";
    expect(safeHistoryEntry(dangerous)).toBe(false);
    expect(safeHistoryEntry("cp file\nrm file")).toBe(false);
    expect(parseBashHistory(`cp safe\n${dangerous}\n`)).toEqual(["cp safe"]);
    expect(parseFishHistory(`- cmd: cp safe\n- cmd: ${dangerous}\n`))
      .toEqual(["cp safe"]);
    expect(historyGhost([dangerous, "cp safe-file"], "cp ")).toBe("safe-file");
    expect(historyGhost([dangerous], "cp ")).toBeNull();
  });

  test("feeds saved history to readline in newest-first order", () => {
    expect(readlineHistory(["echo first", "ls", "pwd"]))
      .toEqual(["pwd", "ls", "echo first"]);
    expect(readlineHistory(["safe", "bad\x1b[2D"]))
      .toEqual(["safe"]);
  });

  test("uses platform-standard bunmsh history paths", () => {
    expect(bunmshHistoryPath({ HOME: "/home/user" }, "linux"))
      .toBe("/home/user/.local/share/bunmsh/history");
    expect(bunmshHistoryPath({ HOME: "/home/user", XDG_DATA_HOME: "/data" }, "linux"))
      .toBe("/data/bunmsh/history");
    expect(bunmshHistoryPath({ LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" }, "win32"))
      .toBe("C:\\Users\\me\\AppData\\Local/bunmsh/history");
  });

  test("finds prefix ranges in a sorted command index", () => {
    const names = ["bun", "bunx", "cat", "git"];
    expect(prefixMatches(names, "bu")).toEqual(["bun", "bunx"]);
    expect(firstPrefixMatch(names, "gi")).toBe("git");
    expect(prefixMatches(names, "")).toEqual([]);
  });

  test("recognizes command positions after assignments and operators", () => {
    expect(completionContext("bu")).toMatchObject({ command: true, prefix: "bu" });
    expect(completionContext("X=1 bu")).toMatchObject({ command: true, prefix: "bu" });
    expect(completionContext("echo hi | gr")).toMatchObject({ command: true, prefix: "gr" });
    expect(completionContext("echo bu")).toMatchObject({ command: false, prefix: "bu" });
    expect(completionContext("echo ")).toMatchObject({ command: false, prefix: "" });
  });

  test("uses recent history for ghosts and accepts one word at a time", () => {
    const history = ["git status", "git log --oneline", "git status --short"];
    expect(historyGhost(history, "git status")).toBe(" --short");
    expect(nextGhostChunk(" --short branch")).toBe(" --short ");
    expect(nextGhostChunk("branch")).toBe("branch");
  });

  test("clips long ghosts before they wrap and disturb the cursor", () => {
    const ghost = "src/proot packed/proot; PROOT_PORT_ADD=3000 bun packed/srpr.mjs";
    expect(fitGhost(ghost, 20)).toEqual({ output: "src/proot packed/pro", width: 20 });
    expect(fitGhost(ghost, 0)).toEqual({ output: "", width: 0 });
    expect(fitGhost("檔案-name", 5)).toEqual({ output: "檔案-", width: 5 });
  });

  test("indexes PATH names without checking executable permission", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bunmsh-completion-"));
    try {
      await Bun.write(`${directory}/alpha`, "not executable");
      await Bun.write(`${directory}/alpine`, "also not executable");
      const index = new CommandIndex(["alias"]);
      await index.refresh({ cwd: process.cwd(), env: { PATH: directory }, aliases: {} });
      expect(index.matches("al")).toEqual(["alias", "alpha", "alpine"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("uses the platform PATH delimiter and hides Windows executable extensions", async () => {
    const first = mkdtempSync(join(tmpdir(), "bunmsh-win-path-a-"));
    const second = mkdtempSync(join(tmpdir(), "bunmsh-win-path-b-"));
    try {
      await Bun.write(`${first}/Alpha.EXE`, "exe");
      await Bun.write(`${first}/ignored.txt`, "text");
      await Bun.write(`${second}/beta.cmd`, "cmd");
      await Bun.write(`${second}/gamma.bat`, "bat");
      const index = new CommandIndex([], { platform: "win32", pathDelimiter: ";" });
      await index.refresh({
        cwd: process.cwd(),
        env: { PATH: `${first};${second}` },
        aliases: {},
      });
      expect(index.matches("A")).toEqual(["Alpha"]);
      expect(index.matches("b")).toEqual(["beta"]);
      expect(index.matches("g")).toEqual(["gamma"]);
      expect(index.matches("i")).toEqual([]);
    } finally {
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
  });

  test("suggests files and marks directories with a trailing slash", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bunmsh-files-"));
    try {
      await Bun.write(`${directory}/alpha.txt`, "alpha");
      mkdirSync(`${directory}/alpine`);
      const index = new FileIndex();
      const state = { cwd: directory, env: {} };
      expect(index.matches("", state)).toEqual(["alpha.txt", "alpine/"]);
      expect(index.matches("al", state)).toEqual(["alpha.txt", "alpine/"]);
      expect(index.first("alpha", state)).toBe("alpha.txt");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("execution", () => {
  test("normalizes Bun Shell cp recursion and provides a PATH-independent cat", async () => {
    expect(bunShellFallbackArgv(["cp", "-rv", "a", "b"]))
      .toEqual(["cp", "-Rv", "a", "b"]);
    const directory = mkdtempSync(join(tmpdir(), "bunmsh-cat-"));
    try {
      await Bun.write(`${directory}/a.txt`, "alpha");
      await Bun.write(`${directory}/b.txt`, "beta");
      const output = await run("cat a.txt b.txt", {
        cwd: directory,
        env: { PATH: "/no/such/path" },
      });
      expect(output).toMatchObject({ status: 0, stdout: "alphabeta", stderr: "" });
      const excluded = await run("builtin cat --exclude a.txt *.txt", { cwd: directory });
      expect(excluded).toMatchObject({ status: 0, stdout: "beta", stderr: "" });
      const patternExcluded = await run("builtin cat --exclude 'a.*' *.txt", { cwd: directory });
      expect(patternExcluded).toMatchObject({ status: 0, stdout: "beta", stderr: "" });
      mkdirSync(`${directory}/source`);
      await Bun.write(`${directory}/source/item.txt`, "copied");
      const copied = await run("cp -r source target", {
        cwd: directory,
        env: { PATH: "/no/such/path" },
      });
      expect(copied).toMatchObject({ status: 0, stdout: "", stderr: "" });
      expect(await Bun.file(`${directory}/target/item.txt`).text()).toBe("copied");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("normalizes CRLF source before parsing scripts", async () => {
    const compound = [
      'value="two words"',
      'if [ "$value" = "two words" ]; then',
      "  printf '[%s]\\n' \"$value\"",
      "fi",
      "",
    ].join("\r\n");
    expect(await run(compound)).toMatchObject({
      status: 0,
      stdout: "[two words]\n",
      stderr: "",
    });

    const heredoc = [
      "builtin cat <<'EOF'",
      "$value remains literal",
      "EOF",
      "",
    ].join("\r\n");
    expect(await run(heredoc)).toMatchObject({
      status: 0,
      stdout: "$value remains literal\n",
      stderr: "",
    });
  });

  test("provides basic fallback text and utility commands", async () => {
    expect(await run("printf 'c\\na\\nb\\n' | builtin sort")).toMatchObject({ stdout: "a\nb\nc\n" });
    expect(await run("printf 'one two\\nthree\\n' | builtin wc -lwc")).toMatchObject({ stdout: "2 3 14\n" });
    expect(await run("printf 'abc\\n' | builtin tr a-z A-Z")).toMatchObject({ stdout: "ABC\n" });
    expect(await run("printf '1\\n2\\n3\\n' | builtin head -n 2")).toMatchObject({ stdout: "1\n2\n" });
    expect(await run("printf '1\\n2\\n3\\n' | builtin tail -n 2")).toMatchObject({ stdout: "2\n3\n" });
    expect(await run("printf '1\\n2\\n3\\n' | builtin tail -n +2")).toMatchObject({ stdout: "2\n3\n" });
    expect(await run("printf '1\\n2\\n3\\n' | builtin tail -n+3")).toMatchObject({ stdout: "3\n" });
    expect(await run("printf '1\\n2\\n3\\n' | builtin tac")).toMatchObject({ stdout: "3\n2\n1\n" });
    expect(await run("printf '1\\n2' | builtin tac")).toMatchObject({ stdout: "21\n" });
    expect(await run("builtin date +%F")).toMatchObject({ status: 0 });
    expect(await run("builtin sleep 1ms")).toMatchObject({ status: 0, stdout: "", stderr: "" });
  });

  test("renders asset-backed Markdown help for every documented builtin", async () => {
    const excluded = new Set([".", "..", "//", "-", "~"]);
    const titles = { "[": "test", __builtin: "builtin", chdir: "cd" };
    const files = { ":": "colon", ...titles };
    const optionDocs = new Set([
      "basename", "builtin", "bun", "bunmsh", "cat", "catfancy", "chmod", "command", "cp", "cut",
      "curl", "date", "dirname", "echo", "env", "find", "getopts", "grep", "head", "kill",
      "ln", "ls", "lsbun", "lsfancy", "mkdir", "mktemp", "mv", "print", "printf",
      "read", "readonly", "rm", "rmdir", "sed", "seq", "serve", "set", "sleep",
      "sort", "tab", "tac", "tail", "tee", "test", "touch", "tr", "unalias",
      "uname", "unset", "wc", "whence",
    ]);
    const state = createState({ env: { HOME: "/tmp", PATH: "/no/such/path" } });
    for (const name of builtinNames().filter((item) => !excluded.has(item))) {
      const output = await executeArgv(["builtin", name, "--help"], state, { capture: true });
      expect(output.status, name).toBe(0);
      const text = decode(output.stdout);
      expect(text, name).toContain("\x1b[");
      expect(Bun.stripANSI(text), name).toStartWith(titles[name] ?? name);
      const source = await readAssetText(`help/${files[name] ?? name}.md`);
      expect(source, name).toStartWith(`## ${titles[name] ?? name}`);
      expect(source, name).toContain("\n### Example\n");
      expect(source, name).toContain("\n```sh\n");
      expect(source, name).toContain("\nOutput:\n\n```text\n");
      if (optionDocs.has(files[name] ?? name))
        expect(source, name).toMatch(/^### Options(?: and forms)?$/m);
    }

    const short = await executeArgv(["builtin", "catfancy", "-h"], state, { capture: true });
    expect(short.status).toBe(0);
    expect(Bun.stripANSI(decode(short.stdout))).toStartWith("catfancy");

    const lsfancyShort = await executeArgv(
      ["builtin", "lsfancy", "-h"],
      createState({ cwd: new URL("..", import.meta.url).pathname }),
      { capture: true },
    );
    expect(lsfancyShort.status).toBe(0);
    expect(Bun.stripANSI(decode(lsfancyShort.stdout))).toContain("README.md");
    expect(Bun.stripANSI(decode(lsfancyShort.stdout))).not.toContain("Usage");

    const lsfancyHelp = await executeArgv(
      ["builtin", "lsfancy", "--help"], state, { capture: true },
    );
    expect(lsfancyHelp.status).toBe(0);
    expect(Bun.stripANSI(decode(lsfancyHelp.stdout))).toStartWith("lsfancy");

    const basenameHelp = await readAssetText("help/basename.md");
    expect(basenameHelp).toContain("basename archive.tar.gz .gz");
    expect(basenameHelp).toContain("archive.tar");
  });

  test("catfancy is a PATH-overridable fallback builtin", async () => {
    const directory = mkdtempSync(join(tmpdir(), "bunmsh-catfancy-path-"));
    try {
      await Bun.write(join(directory, "data.json5"), "{answer: 42}");
      const fallback = await run("catfancy data.json5", {
        cwd: directory,
        env: { PATH: "/no/such/path" },
      });
      expect(fallback.status).toBe(0);
      expect(Bun.stripANSI(fallback.stdout)).toBe('{\n  "answer": 42\n}\n');

      const executable = join(directory, "catfancy");
      await Bun.write(executable, "#!/bin/sh\necho external-catfancy\n");
      chmodSync(executable, 0o755);
      const external = await run("catfancy data.json5; builtin catfancy data.json5", {
        cwd: directory,
        env: { PATH: directory },
      });
      expect(external.status).toBe(0);
      expect(external.stdout).toStartWith("external-catfancy\n");
      expect(Bun.stripANSI(external.stdout)).toContain('"answer": 42');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("lsfancy classifies files by extension and always reads the directory", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bunmsh-lsfancy-"));
    try {
      mkdirSync(join(cwd, "package"));
      await Bun.write(join(cwd, "photo.png"), "image");
      await Bun.write(join(cwd, "song.mp3"), "music");
      await Bun.write(join(cwd, "app.mjs"), "js");
      await Bun.write(join(cwd, "types.mts"), "ts");
      await Bun.write(join(cwd, "page.html"), "html");
      await Bun.write(join(cwd, "style.css"), "css");
      const first = await run("builtin lsfancy", { cwd });
      expect(first.status).toBe(0);
      expect(first.stdout).toContain("📦 package/");
      expect(first.stdout).toContain("🖼️ photo.png");
      expect(first.stdout).toContain("🎵 song.mp3");
      expect(first.stdout).toContain("🟨 app.mjs");
      expect(first.stdout).toContain("🟦 types.mts");
      expect(first.stdout).toContain("🌐 page.html");
      expect(first.stdout).toContain("🎨 style.css");
      await Bun.write(join(cwd, "new.py"), "pass\n");
      expect((await run("builtin lsfancy", { cwd })).stdout).toContain("🐍 new.py");
      await Bun.write(join(cwd, "large.bin"), "x".repeat(1536));
      const long = await run("builtin lsfancy -lh large.bin", { cwd });
      expect(long.status).toBe(0);
      expect(long.stdout).toContain("1.5K");
      expect(long.stdout).toContain("📄 large.bin");
      await Bun.write(join(cwd, "time-old.txt"), "old");
      await Bun.write(join(cwd, "time-new.txt"), "new");
      utimesSync(join(cwd, "time-old.txt"), new Date(1000), new Date(1000));
      utimesSync(join(cwd, "time-new.txt"), new Date(2000), new Date(2000));
      const timed = await run("builtin lsfancy -ltr", { cwd });
      expect(timed.status).toBe(0);
      expect(timed.stdout.indexOf("time-old.txt"))
        .toBeLessThan(timed.stdout.indexOf("time-new.txt"));
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  test("lsfancy supports -S (sort by size), -1 (one per line), and -F (classify)", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bunmsh-lsfancy-flags-"));
    try {
      await Bun.write(join(cwd, "small.txt"), "x");
      await Bun.write(join(cwd, "big.txt"), "x".repeat(100));
      await Bun.write(join(cwd, "script.sh"), "#!/bin/sh\n");
      chmodSync(join(cwd, "script.sh"), 0o755);
      mkdirSync(join(cwd, "subdir"));
      symlinkSync("small.txt", join(cwd, "link_ok"));

      const bySize = await run("builtin lsfancy -S", { cwd });
      expect(bySize.status).toBe(0);
      expect(bySize.stdout.indexOf("big.txt")).toBeLessThan(bySize.stdout.indexOf("small.txt"));

      const classified = await run("builtin lsfancy -F", { cwd });
      expect(classified.status).toBe(0);
      expect(classified.stdout).toContain("subdir/");
      expect(classified.stdout).toContain("script.sh*");
      expect(classified.stdout).toContain("link_ok@");
      // A plain regular file gets no classify suffix at all.
      expect(classified.stdout).toContain("small.txt\n");

      // -1 only differs from the default in a terminal (execute()'s non-tty
      // capture path is already one entry per line either way), so exercise
      // fancyLs directly with terminal forced on to see the effect.
      const state = createState({ cwd });
      const wide = fancyLs(["lsfancy"], state, true);
      const single = fancyLs(["lsfancy", "-1"], state, true);
      expect(wide.stdout.split("\n").filter(Boolean).length).toBeLessThan(5);
      expect(single.stdout.split("\n").filter(Boolean).length).toBe(5);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  test("lsfancy -l shows a file's mtime in local time, not UTC", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bunmsh-lsfancy-localtime-"));
    try {
      await Bun.write(join(cwd, "stamped.txt"), "x");
      const stamp = new Date(2026, 2, 4, 9, 7, 0);
      utimesSync(join(cwd, "stamped.txt"), stamp, stamp);
      const pad = (n) => String(n).padStart(2, "0");
      const expected = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} `
        + `${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`;
      const long = await run("builtin lsfancy -l stamped.txt", { cwd });
      expect(long.status).toBe(0);
      expect(long.stdout).toContain(expected);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  test("lsfancy -l shows a symlink's target, including a broken one", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bunmsh-lsfancy-symlink-"));
    try {
      await Bun.write(join(cwd, "target.txt"), "hi");
      mkdirSync(join(cwd, "targetdir"));
      symlinkSync("target.txt", join(cwd, "link_ok"));
      symlinkSync("targetdir", join(cwd, "link_dir"));
      symlinkSync("/nonexistent/path", join(cwd, "link_broken"));
      symlinkSync("loop_b", join(cwd, "loop_a"));
      symlinkSync("loop_a", join(cwd, "loop_b"));
      const long = await run("builtin lsfancy -l", { cwd });
      expect(long.status).toBe(0);
      expect(long.stdout).toContain("link_ok -> target.txt");
      expect(long.stdout).toContain("link_dir -> targetdir");
      expect(long.stdout).toContain("link_broken -> /nonexistent/path");
      expect(long.stdout).toContain("loop_a -> loop_b");
      // Non-symlink entries get no "-> target" suffix at all.
      expect(long.stdout).not.toContain("target.txt ->");
      expect(long.stdout).not.toContain("targetdir/ ->");
      // A working symlink still gets the plain link icon; one whose target
      // doesn't resolve (missing, or a cycle) gets a distinct broken-link
      // icon instead, in both the plain and long listing forms.
      expect(long.stdout).toContain("🔗 link_ok");
      expect(long.stdout).toContain("🚫 link_broken");
      expect(long.stdout).toContain("🚫 loop_a");
      expect(long.stdout).toContain("🚫 loop_b");
      const plain = await run("builtin lsfancy", { cwd });
      expect(plain.stdout).toContain("🔗 link_ok");
      expect(plain.stdout).toContain("🚫 link_broken");
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  test("fallback ls is lsfancy; Bun Shell's own ls moved to lsbun", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bunmsh-ls-rename-"));
    try {
      await Bun.write(join(cwd, "photo.png"), "image");
      const asLs = await run("builtin ls", { cwd });
      expect(asLs.status).toBe(0);
      expect(asLs.stdout).toContain("🖼️ photo.png");
      const asLsfancy = await run("builtin lsfancy", { cwd });
      expect(asLsfancy.stdout).toBe(asLs.stdout);
      // Bun Shell's own implementation is still reachable, just renamed, and
      // produces its old plain (no emoji) output.
      const asLsbun = await run("builtin lsbun", { cwd });
      expect(asLsbun.status).toBe(0);
      expect(asLsbun.stdout).toContain("photo.png");
      expect(asLsbun.stdout).not.toContain("🖼️");
      // Errors report the name actually invoked, not a hardcoded "lsfancy".
      const badFlag = await run("builtin ls -Z", { cwd });
      expect(badFlag).toMatchObject({ status: 2, stdout: "", stderr: "bunmsh: ls: unsupported option: -Z\n" });
      const missing = await run("builtin ls does-not-exist", { cwd });
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain("bunmsh: ls: does-not-exist:");
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  test("fallback find filters paths and supports both -exec modes", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bunmsh-find-"));
    try {
      mkdirSync(join(cwd, "sub"));
      await Bun.write(join(cwd, "a.txt"), "a");
      await Bun.write(join(cwd, "skip.js"), "js");
      await Bun.write(join(cwd, "sub", "b.txt"), "b");
      const filtered = await run("builtin find . -type f -name '*.txt'", { cwd });
      expect(filtered).toMatchObject({
        status: 0,
        stdout: "./a.txt\n./sub/b.txt\n",
        stderr: "",
      });
      const each = await run("builtin find . -type f -name '*.txt' -exec basename {} \\;", { cwd });
      expect(each).toMatchObject({ status: 0, stdout: "a.txt\nb.txt\n", stderr: "" });
      const batch = await run("builtin find . -type f -name '*.txt' -exec echo batch {} +", { cwd });
      expect(batch).toMatchObject({
        status: 0,
        stdout: "batch ./a.txt ./sub/b.txt\n",
        stderr: "",
      });
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  test("fallback grep supports matching, output modes, quiet, and recursion", async () => {
    expect(await run("printf 'Alpha beta\\nnone\\nBETA\\n' | builtin grep -Ein 'beta'"))
      .toMatchObject({ status: 0, stdout: "1:Alpha beta\n3:BETA\n" });
    expect(await run("printf 'abc123\\n' | builtin grep -Eo '[0-9]+'"))
      .toMatchObject({ status: 0, stdout: "123\n" });
    expect(await run("printf 'keep\\ndrop\\n' | builtin grep -v drop"))
      .toMatchObject({ status: 0, stdout: "keep\n" });
    expect(await run("printf 'found\\n' | builtin grep -q found"))
      .toMatchObject({ status: 0, stdout: "" });
    expect(await run("printf 'red red\\n' | builtin grep --color=always red"))
      .toMatchObject({
        status: 0,
        stdout: "\x1b[01;31mred\x1b[m \x1b[01;31mred\x1b[m\n",
      });
    expect(await run("printf 'red\\n' | builtin grep --color=never red"))
      .toMatchObject({ status: 0, stdout: "red\n" });
    expect(await run("printf 'red\\n' | builtin grep --color=always -o red"))
      .toMatchObject({ status: 0, stdout: "\x1b[01;31mred\x1b[m\n" });
    const directory = mkdtempSync(join(tmpdir(), "bunmsh-grep-"));
    try {
      mkdirSync(`${directory}/nested`);
      await Bun.write(`${directory}/nested/a.txt`, "needle\n");
      const recursive = await run("builtin grep -rn needle nested", { cwd: directory });
      expect(recursive).toMatchObject({ status: 0, stdout: "nested/a.txt:1:needle\n" });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test("fallback head closes an infinite upstream and file utilities work", async () => {
    expect(await run("yes | builtin head -n 2")).toMatchObject({ status: 0, stdout: "y\ny\n" });
    const directory = mkdtempSync(join(tmpdir(), "bunmsh-utils-"));
    try {
      const tee = await run("printf data | builtin tee saved.txt", { cwd: directory });
      expect(tee).toMatchObject({ status: 0, stdout: "data" });
      expect(await Bun.file(`${directory}/saved.txt`).text()).toBe("data");
      const md5 = await run("builtin md5sum saved.txt", { cwd: directory });
      expect(md5.stdout).toBe("8d777f385d3dfec8815d20f7496026dc  saved.txt\n");
      const sha = await run("builtin sha256sum saved.txt", { cwd: directory });
      expect(sha.stdout).toBe("3a6eb0790f39ac87c94f3856b2dd2c5d110e6811602261a9a923d3bb23adc8b7  saved.txt\n");
      const temporary = await run("builtin mktemp -d sample.XXXXXX", { cwd: directory });
      const created = temporary.stdout.trim();
      expect(created.startsWith(`${directory}/sample.`)).toBe(true);
      expect(await run(`builtin rmdir ${created}`, { cwd: directory })).toMatchObject({ status: 0 });
      expect(await Bun.file(created).exists()).toBe(false);
      expect(await run("builtin clear")).toMatchObject({ stdout: "\x1b[2J\x1b[H" });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test("reflects bunmsh and process.argv0 through fallback commands", async () => {
    const nested = await run("bunmsh -cc printf nested", { env: { PATH: "/no/such/path" } });
    expect(nested).toMatchObject({ status: 0, stdout: "nested", stderr: "" });
    const runtime = await run("bun --version", { env: { PATH: "/no/such/path" } });
    expect(runtime).toMatchObject({ status: 0, stdout: `${Bun.version}\n`, stderr: "" });
  });

  test("env recursively dispatches env commands with isolated assignments", async () => {
    const chained = await run("env env a=1 env b=2");
    expect(chained.status).toBe(0);
    expect(chained.stdout.split("\n")).toContain("a=1");
    expect(chained.stdout.split("\n")).toContain("b=2");
    expect(chained.state.env.a).toBeUndefined();
    expect(chained.state.env.b).toBeUndefined();

    const clean = await run("env -i a=1 env b=2");
    expect(clean.stdout.split("\n").filter(Boolean).sort()).toEqual(["a=1", "b=2"]);
  });

  test("supports if, elif, negation, functions, and set --", async () => {
    const script = `
show_value() {
  if [ "$1" = "yes" ] ; then
    printf 'fn:%s' "$2"
  else
    printf bad
  fi
}
set -- alpha beta
if ! [ "$1" = "wrong" ] && [ "$2" = "beta" ] ; then
  show_value yes nested
elif [ "$1" = "alpha" ] ; then
  printf elif
else
  printf else
fi
`;
    expect(await run(script)).toMatchObject({ status: 0, stdout: "fn:nested", stderr: "" });
    expect(await run("! false; printf $?")).toMatchObject({ status: 0, stdout: "0" });
  });

  test("exec stops the current shell flow and fd duplication redirects output", async () => {
    const execution = await run("printf before; exec printf after; printf never");
    expect(execution).toMatchObject({ status: 0, stdout: "beforeafter", stderr: "" });
    expect(execution.state.exitRequested).toBe(true);
    expect(await run("printf error 1>&2")).toMatchObject({ status: 0, stdout: "", stderr: "error" });
    const directory = mkdtempSync(join(tmpdir(), "bunmsh-fd-dup-"));
    try {
      const merged = await run("builtin cat missing-file 2>&1", { cwd: directory });
      expect(merged).toMatchObject({ status: 1, stderr: "" });
      expect(merged.stdout).toContain("bunmsh: cat: missing-file:");
      expect(await Bun.file(join(directory, "&1")).exists()).toBe(false);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test("fallback script utilities cover required head grep cut ln chmod and uname forms", async () => {
    expect(await run("printf abcdef | builtin head -c 3")).toMatchObject({ stdout: "abc" });
    expect(await run("printf 'exact\\nextra\\n' | builtin grep -qFx exact")).toMatchObject({ status: 0, stdout: "" });
    expect(await run("printf '123456789\\n' | builtin cut -c6-")).toMatchObject({ stdout: "6789\n" });
    expect(await run("builtin uname -m")).toMatchObject({ status: 0 });
    const windows = runUnameFallback(["uname", "-mprs"], {
      arch: "x64",
      type: "Windows_NT",
      hostname: "windows-host",
      release: "10.0.26100",
      version: "Windows 11 Pro",
    });
    expect(decode(windows.stdout)).toBe("Windows_NT 10.0.26100 x86_64 x86_64\n");
    const directory = mkdtempSync(join(tmpdir(), "bunmsh-script-tools-"));
    try {
      await Bun.write(`${directory}/source`, "one");
      await Bun.write(`${directory}/other`, "two");
      expect(await run("builtin ln -sfT source link", { cwd: directory })).toMatchObject({ status: 0 });
      expect(readlinkSync(`${directory}/link`)).toBe("source");
      expect(await run("builtin ln -sfT other link", { cwd: directory })).toMatchObject({ status: 0 });
      expect(readlinkSync(`${directory}/link`)).toBe("other");
      expect(await run("builtin chmod 777 source; builtin chmod +x other", { cwd: directory }))
        .toMatchObject({ status: 0 });
      expect(statSync(`${directory}/source`).mode & 0o777).toBe(0o777);
      expect(statSync(`${directory}/other`).mode & 0o111).toBe(0o111);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test("evaluates raw Bun. lines before shell parsing and expansion", async () => {
    const output = await run(`  Bun.version + " $HOME * ; raw"`);
    expect(output.status).toBe(0);
    expect(output.stdout).toBe(`${Bun.version} $HOME * ; raw\n`);
    expect(output.stderr).toBe("");
  });

  test("awaits Bun. eval results, suppresses undefined, and reports errors", async () => {
    const empty = await run("Bun.sleep(0)");
    expect(empty).toMatchObject({ status: 0, stdout: "", stderr: "" });

    const failure = await run("Bun.thisMethodDoesNotExist()");
    expect(failure.status).toBe(1);
    expect(failure.stdout).toBe("");
    expect(failure.stderr).toContain("TypeError");
  });

  test("runs Bun. eval with the active shell cwd and restores the process cwd", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bunmsh-js-cwd-"));
    const previousCwd = process.cwd();
    try {
      await Bun.write(join(cwd, "relative-marker.txt"), "cwd-marker");
      const shown = await run("Bun.e, process.cwd()", { cwd });
      expect(shown).toMatchObject({ status: 0, stdout: `${cwd}\n`, stderr: "" });
      const relative = await run('Bun.file("relative-marker.txt").text()', { cwd });
      expect(relative).toMatchObject({ status: 0, stdout: "cwd-marker\n", stderr: "" });
      expect(process.cwd()).toBe(previousCwd);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  test("provides color aliases for common commands", () => {
    const state = createState();
    // toybox diff takes a bare --color; it has no =auto form.
    expect(state.aliases).toEqual({
      ls: ["ls", "--color=auto"],
      diff: ["diff", "--color"],
      grep: ["grep", "--color=auto"],
    });
  });

  test("expands variables while respecting single quotes", async () => {
    const output = await run(`X=world; print -r -- "hello $X"; print -r -- '$X'`);
    expect(output.stdout).toBe("hello world\n$X\n");
  });

  test("supports status connectors", async () => {
    const output = await run("false && echo no; false || echo yes; true && echo done");
    expect(output.stdout).toBe("yes\ndone\n");
    expect(output.status).toBe(0);
  });

  test("runs external pipelines through Bun.spawn", async () => {
    const output = await run("printf hello | tr a-z A-Z");
    expect(output.stdout).toBe("HELLO");
    expect(output.stderr).toBe("");
    expect(output.status).toBe(0);
  });

  test("keeps builtin state outside pipelines", async () => {
    const output = await run("export BUNMSH_TEST=value; print -r -- $BUNMSH_TEST");
    expect(output.stdout).toBe("value\n");
    expect(output.state.env.BUNMSH_TEST).toBe("value");
  });

  test("supports cd - and previous-child navigation", async () => {
    const cwd = process.cwd();
    const previous = await run("cd src; cd -; pwd", { cwd });
    expect(previous.stdout).toBe(`${cwd}\n${cwd}\n`);
    expect(previous.state.env.OLDPWD).toBe(`${cwd}/src`);

    const child = await run("cd src; cd ..; //; pwd", { cwd });
    expect(child.stdout).toBe(`${cwd}/src\n`);
    expect(child.state.cwd).toBe(`${cwd}/src`);
  });

  test("treats .. as cd ..", async () => {
    const cwd = process.cwd();
    const output = await run("cd src; ..; pwd", { cwd });
    expect(output.stdout).toBe(`${cwd}\n`);
    expect(output.state.cwd).toBe(cwd);
    expect(output.state.env.OLDPWD).toBe(`${cwd}/src`);
  });

  test("treats standalone - as cd -", async () => {
    const cwd = process.cwd();
    const output = await run("cd src; -; pwd", { cwd });
    expect(output.stdout).toBe(`${cwd}\n${cwd}\n`);
    expect(output.state.cwd).toBe(cwd);
    expect(output.state.env.OLDPWD).toBe(`${cwd}/src`);
  });

  test("treats standalone ~ as cd HOME", async () => {
    const cwd = process.cwd();
    const home = cwd.slice(0, cwd.lastIndexOf("/"));
    const output = await run("cd src; ~; pwd", { cwd, env: { HOME: home } });
    expect(output.stdout).toBe(`${home}\n`);
    expect(output.state.cwd).toBe(home);
    expect(output.state.env.OLDPWD).toBe(`${cwd}/src`);
  });

  test("// reports a missing child and continues", async () => {
    const output = await run("//; print still-running");
    expect(output.stdout).toBe("still-running\n");
    expect(output.stderr).toBe("bunmsh: //: no previous child directory\n");
    expect(output.status).toBe(0);
  });

  test("exposes positional parameters and status", async () => {
    const output = await run("false; print -r -- $0 $1 $# $?", {
      args: ["script", "arg"],
    });
    expect(output.stdout).toBe("script arg 1 1\n");
  });

  test("a single question mark prints the previous status and succeeds", async () => {
    const failed = await run("false");
    const execution = await execute("?", failed.state, { capture: true });
    const output = {
      ...execution,
      stdout: decode(execution.stdout),
      stderr: decode(execution.stderr),
    };
    expect(output).toMatchObject({ status: 0, stdout: "1\n", stderr: "" });
    expect(failed.state.lastStatus).toBe(0);
    expect(await run("?")).toMatchObject({ status: 0, stdout: "0\n", stderr: "" });
  });

  test("tab creates cwd-only workspaces and cycles between them", async () => {
    const cwd = process.cwd();
    const output = await run("tab; cd src; tab; pwd; tab; pwd", { cwd });
    expect(output.stdout).toBe(`${cwd}\n${cwd}/src\n`);
    expect(output.state.tabs).toEqual([cwd, `${cwd}/src`]);
    expect(output.state.activeTab).toBe(1);
    expect(output.state.cwd).toBe(`${cwd}/src`);
    expect(output.state.env.OLDPWD).toBe(cwd);
  });

  test("tab supports new, numbered, left, right, and close operations", async () => {
    const cwd = process.cwd();
    const output = await run(
      "tab n; cd src; tab n; cd ../test; tab 1; tab r; pwd; tab l; pwd; " +
        "tab 3; pwd; tab x; pwd",
      { cwd },
    );
    expect(output.stdout).toBe(`${cwd}/src\n${cwd}\n${cwd}/test\n${cwd}/src\n`);
    expect(output.state.tabs).toEqual([cwd, `${cwd}/src`]);
    expect(output.state.activeTab).toBe(1);
    expect(output.state.cwd).toBe(`${cwd}/src`);
  });

  test("tab c closes the active tab like tab x", async () => {
    const output = await run("tab n; tab c");
    expect(output.status).toBe(0);
    expect(output.state.tabs).toHaveLength(1);
    expect(output.state.activeTab).toBe(0);
  });

  test("tab mouse toggles and explicitly sets mouse tracking", async () => {
    let output = await run("tab mouse", { mouseTracking: false });
    expect(output.state.mouseTracking).toBe(true);
    output = await run("tab mouse off", { mouseTracking: true });
    expect(output.state.mouseTracking).toBe(false);
    output = await run("tab mouse true", { mouseTracking: false });
    expect(output.state.mouseTracking).toBe(true);
    output = await run("tab mouse false", { mouseTracking: true });
    expect(output.state.mouseTracking).toBe(false);
    expect(await run("tab mouse maybe")).toMatchObject({
      status: 1,
      stderr: "bunmsh: tab: mouse: expected on, off, true, or false\n",
    });
  });

  test("tab path toggles and explicitly controls PATH lookup", async () => {
    let output = await run("tab path; sh -c 'echo external'; printf builtin");
    expect(output.state.pathSearch).toBe(false);
    expect(output.stdout).toBe("builtin");
    expect(output.stderr).toContain("bunmsh: sh: not found");

    output = await run("tab path off; tab path on; sh -c 'printf external'");
    expect(output.state.pathSearch).toBe(true);
    expect(output.stdout).toBe("external");

    output = await run("tab path false; printf fallback-ok");
    expect(output.state.pathSearch).toBe(false);
    expect(output.stdout).toBe("fallback-ok");
    expect(await run("tab path maybe")).toMatchObject({
      status: 1,
      stderr: "bunmsh: tab: path: expected on, off, true, or false\n",
    });
  });

  test("which still searches PATH while direct PATH lookup is disabled", async () => {
    const shell = Bun.which("sh");
    expect(shell).toBeTruthy();
    const output = await run("tab path off; which sh; \"$(which sh)\" -c 'printf explicit-path'");
    expect(output.status).toBe(0);
    expect(output.stdout).toBe(`${shell}\nexplicit-path`);
    expect(output.stderr).toBe("");
  });

  test("tab rejects invalid selection and closing the final tab", async () => {
    const missing = await run("tab 2");
    expect(missing.status).toBe(1);
    expect(missing.stderr).toBe("bunmsh: tab: 2: no such tab\n");

    const last = await run("tab x");
    expect(last.status).toBe(1);
    expect(last.stderr).toBe("bunmsh: tab: cannot close the last tab\n");
  });

  test("tab save persists bunmsh history only when requested", async () => {
    const home = mkdtempSync(join(tmpdir(), "bunmsh-own-history-"));
    try {
      const env = { HOME: home, BUNMSH_IMPORT_HISTORY: "off" };
      const saved = await run("tab save", {
        env,
        history: ["echo first", "echo duplicate", "echo duplicate", "echo last"],
      });
      const path = join(home, ".local", "share", "bunmsh", "history");
      expect(saved).toMatchObject({ status: 0, stdout: `${path}\n`, stderr: "" });
      // The plain save appends everything as-is, one JSON value per line —
      // it does not dedupe; that is what `tab save d` is for.
      expect(Bun.JSONL.parse(await Bun.file(path).text()))
        .toEqual(["echo first", "echo duplicate", "echo duplicate", "echo last"]);
      // Reading history back still dedupes in memory (keeping the most
      // recent occurrence), regardless of what is actually on disk.
      expect(await importedHistory(env)).toEqual(["echo first", "echo duplicate", "echo last"]);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  test("saveBunmshHistory from two sessions never clobbers the other's entries", async () => {
    const home = mkdtempSync(join(tmpdir(), "bunmsh-history-concurrent-"));
    try {
      const env = { HOME: home, BUNMSH_IMPORT_HISTORY: "off" };
      // Two independent sessions, as if two bunmsh processes were running at
      // once: each only knows about its own new commands (historySaved: 0),
      // not about anything the other has written.
      const sessionA = { history: ["a1", "a2"], historySaved: 0 };
      const sessionB = { history: ["b1", "b2"], historySaved: 0 };
      await saveBunmshHistory(sessionA, env);
      await saveBunmshHistory(sessionB, env);
      expect(await importedHistory(env)).toEqual(["a1", "a2", "b1", "b2"]);
      // A keeps going and saves again; B's earlier entries must still be
      // there — a second save from one session must not touch what the
      // other already wrote (this is the whole point of appending instead
      // of rewriting the file).
      sessionA.history.push("a3");
      await saveBunmshHistory(sessionA, env);
      expect(await importedHistory(env)).toEqual(["a1", "a2", "b1", "b2", "a3"]);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  test("tab save d dedupes the whole history file", async () => {
    const home = mkdtempSync(join(tmpdir(), "bunmsh-history-dedupe-"));
    try {
      const env = { HOME: home, BUNMSH_IMPORT_HISTORY: "off" };
      await saveBunmshHistory({ history: ["x", "y", "x", "z"], historySaved: 0 }, env);
      const deduped = await run("tab s d", { env, history: [] });
      const path = join(home, ".local", "share", "bunmsh", "history");
      expect(deduped).toMatchObject({ status: 0, stderr: "" });
      expect(deduped.stdout).toContain(`${path}: 3 unique entries`);
      expect(Bun.JSONL.parse(await Bun.file(path).text())).toEqual(["y", "x", "z"]);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  test("tab save rejects an unknown modifier", async () => {
    expect(await run("tab s bogus")).toMatchObject({
      status: 1,
      stderr: "bunmsh: tab: save: expected d or dedupe\n",
    });
  });

  test("saveBunmshHistory migrates a legacy JSON-array history file to JSONL", async () => {
    const home = mkdtempSync(join(tmpdir(), "bunmsh-history-migrate-"));
    try {
      const env = { HOME: home, BUNMSH_IMPORT_HISTORY: "off" };
      const path = join(home, ".local", "share", "bunmsh", "history");
      mkdirSync(join(home, ".local", "share", "bunmsh"), { recursive: true });
      await Bun.write(path, `${JSON.stringify(["old1", "old2"], null, 2)}\n`);
      expect(await importedHistory(env)).toEqual(["old1", "old2"]);
      await saveBunmshHistory({ history: ["new1"], historySaved: 0 }, env);
      const text = await Bun.file(path).text();
      expect(text.trimStart().startsWith("[")).toBe(false);
      expect(Bun.JSONL.parse(text)).toEqual(["old1", "old2", "new1"]);
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});

describe("CLI", () => {
  test("detects highest-priority Bun. lines inside script files", async () => {
    const cwd = new URL("..", import.meta.url).pathname;
    const proc = Bun.spawn([process.execPath, "src/main.js", "test/t.sh"], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(status).toBe(0);
    expect(stdout).toBe(
      `shell-before\n${Bun.version}\n${Math.cos(1)}\n` +
        `{ message: 'shared', count: 1 }\n2\n` +
        `{ message: 'shared', count: 2 }\n` +
        `from command substitution: shared\nshell-after\n`,
    );
    expect(stderr).toBe("");
  });

  test("--readme renders the bundled README and exits", async () => {
    const proc = Bun.spawn([process.execPath, "src/main.js", "--readme"], {
      cwd: new URL("..", import.meta.url).pathname,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain("bunmsh");
    expect(stdout).toContain("Built-in documentation");
    expect(stderr).toBe("");
  });

  test("--changelog renders the bundled changelog and exits", async () => {
    const proc = Bun.spawn([process.execPath, "src/main.js", "--changelog"], {
      cwd: new URL("..", import.meta.url).pathname,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(status).toBe(0);
    expect(stdout).toContain("Changelog");
    expect(stdout).toContain("0.1.8");
    expect(stdout).toContain("serve");
    expect(stderr).toBe("");
  });

  test("expands \\w in the interactive prompt", async () => {
    const cwd = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
    const home = cwd.slice(0, cwd.lastIndexOf("/"));
    const proc = Bun.spawn([process.execPath, "src/main.js", "-i"], {
      cwd,
      env: { ...process.env, HOME: home, PS1: "[\\w] " },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write("exit\n");
    proc.stdin.end();
    const [status, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(status).toBe(0);
    expect(stdout).toBe(`[~${cwd.slice(home.length)}] `);
    expect(stderr).toBe("");
  });

  test("colors only the prompt dollar red after an error and ? reports it", async () => {
    let transcript = "";
    const terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_terminal, data) { transcript += data.toString(); },
    });
    const proc = Bun.spawn({
      cmd: [process.execPath, "src/main.js", "-i"],
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, PS1: "$ " },
      terminal,
    });
    try {
      await Bun.sleep(120);
      terminal.write("false\r");
      await Bun.sleep(80);
      terminal.write("?\r");
      await Bun.sleep(80);
      terminal.write("exit\r");
      expect(await proc.exited).toBe(0);
    } finally { terminal.close(); }
    expect(transcript).toContain("\x1b[31m$\x1b[0m ");
    expect(transcript).toContain("1\r\n");
  });

  test("shows a PS2 continuation prompt across a here-document, like mksh", async () => {
    let transcript = "";
    const terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_terminal, data) { transcript += data.toString(); },
    });
    const proc = Bun.spawn({
      cmd: [process.execPath, "src/main.js", "-i"],
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, PS1: "$ " },
      terminal,
    });
    try {
      await Bun.sleep(120);
      terminal.write("cat <<EOF\r");
      await Bun.sleep(80);
      terminal.write("hello world\r");
      await Bun.sleep(80);
      terminal.write("EOF\r");
      await Bun.sleep(120);
      terminal.write("echo after:$?\r");
      await Bun.sleep(80);
      terminal.write("exit\r");
      expect(await proc.exited).toBe(0);
    } finally { terminal.close(); }
    // Two "> " continuation prompts (for the body line and the terminator),
    // the heredoc's own output, and the shell resuming normally afterward.
    expect(transcript.match(/\r\n\x1b\[1G\x1b\[0J> /g)).toHaveLength(2);
    expect(transcript).toContain("hello world\r\n");
    expect(transcript).toContain("after:0\r\n");
  });

  test("Ctrl-C during a here-document continuation returns to the primary prompt", async () => {
    let transcript = "";
    const terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_terminal, data) { transcript += data.toString(); },
    });
    const proc = Bun.spawn({
      cmd: [process.execPath, "src/main.js", "-i"],
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, PS1: "$ " },
      terminal,
    });
    try {
      await Bun.sleep(120);
      terminal.write("cat <<EOF\r");
      await Bun.sleep(80);
      terminal.write("partial\r");
      await Bun.sleep(80);
      terminal.write("\x03");
      await Bun.sleep(120);
      terminal.write("echo back:$?\r");
      await Bun.sleep(80);
      terminal.write("exit\r");
      expect(await proc.exited).toBe(0);
    } finally { terminal.close(); }
    // The interrupt aborted the pending heredoc before `cat` ever ran, so
    // $? reflects the Ctrl-C signal (130), not a successful `cat` (0).
    expect(transcript).toContain("back:130\r\n");
  });

  test("Ctrl-D during a here-document continuation ends the body, not the shell", async () => {
    let transcript = "";
    const terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_terminal, data) { transcript += data.toString(); },
    });
    const proc = Bun.spawn({
      cmd: [process.execPath, "src/main.js", "-i"],
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, PS1: "$ " },
      terminal,
    });
    try {
      await Bun.sleep(120);
      terminal.write("cat <<EOF\r");
      await Bun.sleep(80);
      terminal.write("partial body no terminator\r");
      await Bun.sleep(80);
      // Ctrl-D on the empty PS2 line: Node's readline closes itself here,
      // like it would on an empty primary-prompt line, but that must only
      // end the here-document (leniently, like a script hitting real EOF),
      // not exit the whole shell.
      terminal.write("\x04");
      await Bun.sleep(150);
      terminal.write("echo still-alive:$?\r");
      await Bun.sleep(80);
      terminal.write("exit\r");
      expect(await proc.exited).toBe(0);
    } finally { terminal.close(); }
    expect(transcript).toContain("partial body no terminator");
    expect(transcript).toContain("still-alive:0\r\n");
  });

  test("Ctrl-D at the primary prompt still exits the shell", async () => {
    let transcript = "";
    const terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_terminal, data) { transcript += data.toString(); },
    });
    const proc = Bun.spawn({
      cmd: [process.execPath, "src/main.js", "-i"],
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, PS1: "$ " },
      terminal,
    });
    try {
      await Bun.sleep(120);
      terminal.write("echo hi\r");
      await Bun.sleep(100);
      terminal.write("\x04");
      expect(await proc.exited).toBe(0);
    } finally { terminal.close(); }
    expect(transcript).toContain("hi\r\n");
  });

  test("exiting flushes history without waiting for the periodic autosave", async () => {
    const home = mkdtempSync(join(tmpdir(), "bunmsh-history-exit-flush-"));
    try {
      const terminal = new Bun.Terminal({
        cols: 80,
        rows: 24,
        data() {},
      });
      const proc = Bun.spawn({
        cmd: [process.execPath, "src/main.js", "-i"],
        cwd: new URL("..", import.meta.url).pathname,
        env: { ...process.env, PS1: "$ ", HOME: home, BUNMSH_IMPORT_HISTORY: "off" },
        terminal,
      });
      try {
        await Bun.sleep(120);
        terminal.write("echo flush-me\r");
        await Bun.sleep(100);
        terminal.write("exit\r");
        expect(await proc.exited).toBe(0);
      } finally { terminal.close(); }
      // The 60s periodic autosave never had a chance to fire here; only the
      // on-exit flush could have written this.
      const saved = await importedHistory({ HOME: home, BUNMSH_IMPORT_HISTORY: "off" });
      expect(saved).toContain("echo flush-me");
      expect(saved).toContain("exit");
    } finally { rmSync(home, { recursive: true, force: true }); }
  });

  test.each(["SIGTERM", "SIGHUP"])(
    "%s while waiting at the prompt flushes history and exits with a signal-derived status",
    async (signal) => {
      const home = mkdtempSync(join(tmpdir(), `bunmsh-history-${signal}-`));
      try {
        const terminal = new Bun.Terminal({ cols: 80, rows: 24, data() {} });
        const proc = Bun.spawn({
          cmd: [process.execPath, "src/main.js", "-i"],
          cwd: new URL("..", import.meta.url).pathname,
          env: { ...process.env, PS1: "$ ", HOME: home, BUNMSH_IMPORT_HISTORY: "off" },
          terminal,
        });
        try {
          await Bun.sleep(120);
          terminal.write(`echo ${signal.toLowerCase()}-flush\r`);
          await Bun.sleep(100);
          proc.kill(signal);
          const expectedStatus = signal === "SIGHUP" ? 129 : 143;
          expect(await proc.exited).toBe(expectedStatus);
        } finally { terminal.close(); }
        const saved = await importedHistory({ HOME: home, BUNMSH_IMPORT_HISTORY: "off" });
        expect(saved).toContain(`echo ${signal.toLowerCase()}-flush`);
      } finally { rmSync(home, { recursive: true, force: true }); }
    },
  );

  test("preserves command output without a trailing newline before repainting", async () => {
    const cwd = new URL("..", import.meta.url).pathname;
    let transcript = "";
    let terminal;
    terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_terminal, data) {
        const text = data.toString();
        transcript += text;
        if (text.includes("\x1b[6n")) terminal.write("\x1b[4;4R");
      },
    });
    const entry = join(new URL("..", import.meta.url).pathname, "src/main.js");
    const proc = Bun.spawn({
      cmd: [Bun.which("bun") || process.argv0, entry, "-i"],
      cwd,
      env: { ...process.env, PS1: "> " },
      terminal,
    });
    try {
      await Bun.sleep(150);
      terminal.write("printf hello\r");
      await Bun.sleep(150);
      terminal.write("exit\r");
      expect(await proc.exited).toBe(0);
    } finally { terminal.close(); }
    // The "↩️" marker must appear right after the unterminated output and its
    // cursor-position query, before the next prompt is repainted. The exact
    // bytes readline uses to repaint that prompt (padding cursor moves and
    // erase-to-end-of-line codes around the "> " text) are an internal
    // implementation detail of the readline version in use, not something
    // this shell controls, so check the marker's position and that a fresh
    // prompt follows it, rather than pinning readline's own redraw bytes.
    const markerIndex = transcript.indexOf("hello\x1b[6n↩️\r\n");
    expect(markerIndex).toBeGreaterThan(-1);
    const afterMarker = transcript.slice(markerIndex);
    expect(afterMarker.indexOf("> ")).toBeGreaterThan(-1);
    expect(afterMarker.indexOf("> ")).toBeLessThan(afterMarker.indexOf("exit"));
  });

  test("Ctrl-C returns to the prompt while Ctrl-D exits, including during serve", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bunmsh-sigint-"));
    let transcript = "";
    let terminal;
    terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_terminal, data) {
        const text = data.toString();
        transcript += text;
        if (text.includes("\x1b[6n")) terminal.write("\x1b[4;1R");
      },
    });
    const entry = join(new URL("..", import.meta.url).pathname, "src/main.js");
    const proc = Bun.spawn({
      cmd: [Bun.which("bun") || process.argv0, entry, "-i"],
      cwd,
      env: { ...process.env, PORT: "0", PS1: "> " },
      terminal,
    });
    const waitFor = async (needle) => {
      for (let attempt = 0; attempt < 100 && !transcript.includes(needle); attempt++)
        await Bun.sleep(10);
      expect(transcript).toContain(needle);
    };
    try {
      await waitFor("> ");
      terminal.write("\x03");
      await Bun.sleep(30);
      terminal.write("echo prompt-survived\r");
      await waitFor("prompt-survived\r\n");
      terminal.write("builtin serve\r");
      await waitFor("http://localhost:");
      const beforeQuit = transcript.length;
      terminal.write("q\r");
      for (let attempt = 0; attempt < 100 && !transcript.slice(beforeQuit).includes("> "); attempt++)
        await Bun.sleep(10);
      expect(transcript.slice(beforeQuit)).toContain("> ");
      terminal.write("builtin serve\r");
      for (let attempt = 0; attempt < 100 &&
        !transcript.slice(beforeQuit).includes("http://localhost:"); attempt++)
        await Bun.sleep(10);
      const promptsWhileServing = transcript.split("> ").length - 1;
      terminal.resize(79, 24);
      await Bun.sleep(30);
      expect(transcript.split("> ").length - 1).toBe(promptsWhileServing);
      proc.kill("SIGINT");
      await Bun.sleep(30);
      terminal.write("echo server-survived\r");
      await waitFor("server-survived\r\n");
      terminal.write("\x04");
      expect(await proc.exited).toBe(0);
    } finally { terminal.close(); }
    expect(transcript).toContain("prompt-survived\r\n");
    expect(transcript).toContain("Serving ");
    expect(transcript).toContain("server-survived\r\n");
  });

  test("shows all tab paths and marks the active tab", async () => {
    const cwd = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
    const home = cwd.slice(0, cwd.lastIndexOf("/"));
    const shown = `~${cwd.slice(home.length)}`;
    const proc = Bun.spawn([process.execPath, "src/main.js", "-i"], {
      cwd,
      env: { ...process.env, HOME: home, PS1: "[\\w] " },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write("tab\nexit\n");
    proc.stdin.end();
    const [status, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(status).toBe(0);
    expect(stdout).toBe(
      `[${shown}] [📁 ${shown}  \x1b[38;5;81m📂 ${shown}\x1b[0m] `,
    );
    expect(stderr).toBe("");
  });

  test("adds the active tab number to the default multi-tab prompt", async () => {
    const cwd = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
    const home = cwd.slice(0, cwd.lastIndexOf("/"));
    const shown = `~${cwd.slice(home.length)}`;
    const env = { ...process.env, HOME: home };
    delete env.PS1;
    const proc = Bun.spawn([process.execPath, "src/main.js", "-i"], {
      cwd,
      env,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    proc.stdin.write("tab\nexit\n");
    proc.stdin.end();
    const [status, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    expect(status).toBe(0);
    expect(stdout).toBe(
      `📁 ${shown}\n$ 📁 ${shown}  \x1b[38;5;81m📂 ${shown}\x1b[0m\n[2]$ `,
    );
    expect(stderr).toBe("");
  });

  test("recalls saved bunmsh history with the Up arrow after startup", async () => {
    const home = mkdtempSync(join(tmpdir(), "bunmsh-readline-history-"));
    let transcript = "";
    const terminal = new Bun.Terminal({
      cols: 100,
      rows: 30,
      data(_terminal, data) { transcript += data.toString(); },
    });
    try {
      const historyPath = join(home, ".local", "share", "bunmsh", "history");
      mkdirSync(join(home, ".local", "share", "bunmsh"), { recursive: true });
      await Bun.write(historyPath, `${JSON.stringify(["echo recalled-marker"])}\n`);
      const proc = Bun.spawn({
        cmd: [Bun.which("bun") || process.argv0, "src/main.js", "-i"],
        cwd: new URL("..", import.meta.url).pathname,
        env: {
          ...process.env,
          HOME: home,
          PS1: "> ",
          BUNMSH_IMPORT_HISTORY: "off",
        },
        terminal,
      });
      await Bun.sleep(150);
      terminal.write("\x1b[A\r");
      await Bun.sleep(100);
      terminal.write("exit\r");
      expect(await proc.exited).toBe(0);
      expect(transcript).toContain("recalled-marker\r\n");
    } finally {
      terminal.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("enables terminal mouse reporting only through BUNMSH_MOUSE", async () => {
    let transcript = "";
    const terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_terminal, data) { transcript += data.toString(); },
    });
    const proc = Bun.spawn({
      cmd: [Bun.which("bun") || process.argv0, "src/main.js", "-i"],
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, PS1: "> ", BUNMSH_MOUSE: "1" },
      terminal,
    });
    try {
      await Bun.sleep(150);
      terminal.write("exit\r");
      expect(await proc.exited).toBe(0);
    } finally { terminal.close(); }
    expect(transcript).toContain(MOUSE_ON);
    expect(transcript).toContain(MOUSE_OFF);
  });

  test("--mouse enables terminal mouse reporting", async () => {
    let transcript = "";
    const terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_terminal, data) { transcript += data.toString(); },
    });
    const env = { ...process.env, PS1: "> " };
    delete env.BUNMSH_MOUSE;
    const proc = Bun.spawn({
      cmd: [Bun.which("bun") || process.argv0, "src/main.js", "--mouse", "-i"],
      cwd: new URL("..", import.meta.url).pathname,
      env,
      terminal,
    });
    try {
      await Bun.sleep(150);
      terminal.write("exit\r");
      expect(await proc.exited).toBe(0);
    } finally { terminal.close(); }
    expect(transcript).toContain(MOUSE_ON);
    expect(transcript).toContain(MOUSE_OFF);
  });

  test("--builtin-only skips PATH lookup but keeps builtins available", () => {
    const bun = Bun.which("bun") || process.argv0;
    const cwd = new URL("..", import.meta.url).pathname;
    const builtin = Bun.spawnSync({
      cmd: [bun, "src/main.js", "--builtin-only", "-c", "printf '%s' builtin-ok"],
      cwd,
    });
    expect(builtin.exitCode).toBe(0);
    expect(builtin.stdout.toString()).toBe("builtin-ok");

    const external = Bun.spawnSync({
      cmd: [bun, "src/main.js", "--builtin-only", "-c", "sh -c 'printf external'"],
      cwd,
    });
    expect(external.exitCode).toBe(127);
    expect(external.stderr.toString()).toContain("bunmsh: sh: not found");
  });

  test("tab mouse applies tracking changes immediately", async () => {
    let transcript = "";
    const terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_terminal, data) { transcript += data.toString(); },
    });
    const env = { ...process.env, PS1: "> " };
    delete env.BUNMSH_MOUSE;
    const proc = Bun.spawn({
      cmd: [Bun.which("bun") || process.argv0, "src/main.js", "-i"],
      cwd: new URL("..", import.meta.url).pathname,
      env,
      terminal,
    });
    try {
      await Bun.sleep(150);
      terminal.write("tab mouse on\r");
      await Bun.sleep(100);
      terminal.write("tab mouse off\r");
      await Bun.sleep(100);
      terminal.write("exit\r");
      expect(await proc.exited).toBe(0);
    } finally { terminal.close(); }
    expect(transcript).toContain(MOUSE_ON);
    expect(transcript).toContain(MOUSE_OFF);
  });

  test("Ctrl-T and Alt-T switch tabs without discarding the edited line", async () => {
    let transcript = "";
    const terminal = new Bun.Terminal({
      cols: 100,
      rows: 30,
      data(_terminal, data) { transcript += data.toString(); },
    });
    const env = { ...process.env };
    delete env.PS1;
    const proc = Bun.spawn({
      cmd: [Bun.which("bun") || process.argv0, "src/main.js", "-i"],
      cwd: new URL("..", import.meta.url).pathname,
      env,
      terminal,
    });
    try {
      await Bun.sleep(150);
      terminal.write("echo shortcut-preserved");
      terminal.write("\x14");
      await Bun.sleep(100);
      terminal.write("\r");
      await Bun.sleep(100);
      terminal.write("\x1bt");
      await Bun.sleep(100);
      terminal.write("exit\r");
      expect(await proc.exited).toBe(0);
    } finally { terminal.close(); }
    expect(transcript).toContain("shortcut-preserved\r\n");
    expect(transcript).toContain("[2]$ ");
    expect(transcript).toContain("[1]$ ");
  });

  test("clicking the prompt tab number creates a tab and Alt-C closes it", async () => {
    let transcript = "";
    let terminal;
    terminal = new Bun.Terminal({
      cols: 100,
      rows: 30,
      data(_terminal, data) {
        const text = data.toString();
        transcript += text;
        if (text.includes("\x1b[6n")) terminal.write("\x1b[10;6R");
      },
    });
    const env = { ...process.env };
    delete env.PS1;
    const proc = Bun.spawn({
      cmd: [Bun.which("bun") || process.argv0, "src/main.js", "--mouse", "-i"],
      cwd: new URL("..", import.meta.url).pathname,
      env,
      terminal,
    });
    try {
      await Bun.sleep(150);
      terminal.write("\x14");
      await Bun.sleep(100);
      terminal.write("\x1b[<0;2;10M");
      await Bun.sleep(120);
      terminal.write("\x1bc");
      await Bun.sleep(100);
      terminal.write("exit\r");
      expect(await proc.exited).toBe(0);
    } finally { terminal.close(); }
    expect(transcript).toContain("[3]$ ");
  });

  test("clicking inside the typed line moves the cursor there instead of appending", async () => {
    let transcript = "";
    const terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_terminal, data) {
        const text = data.toString();
        transcript += text;
        // Prompt "$ " (2 cols) + "echo hello" (10 chars) = col 13, row 1
        // (nothing has scrolled yet in a fresh session).
        if (text.includes("\x1b[6n")) terminal.write("\x1b[1;13R");
      },
    });
    const proc = Bun.spawn({
      cmd: [Bun.which("bun") || process.argv0, "src/main.js", "--mouse", "-i"],
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, PS1: "$ " },
      terminal,
    });
    try {
      await Bun.sleep(150);
      terminal.write("echo hello");
      await Bun.sleep(100);
      // Column 8 (1-based) lands right after "echo " (index 5 of the line),
      // just before "hello".
      terminal.write("\x1b[<0;8;1M");
      await Bun.sleep(150);
      terminal.write("X\r");
      await Bun.sleep(150);
      terminal.write("exit\r");
      expect(await proc.exited).toBe(0);
    } finally { terminal.close(); }
    expect(transcript).toContain("Xhello\r\n");
    expect(transcript).not.toContain("helloX\r\n");
  });

  test("Alt-L, Alt-U, and Alt-P list cwd or parent without discarding the edited line", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "bunmsh-alt-l-"));
    const child = join(cwd, "child");
    mkdirSync(child);
    await Bun.write(join(child, "alt-l-marker.txt"), "marker");
    await Bun.write(join(cwd, "alt-u-parent-marker.txt"), "marker");
    let transcript = "";
    const terminal = new Bun.Terminal({
      cols: 100,
      rows: 30,
      data(_terminal, data) { transcript += data.toString(); },
    });
    const proc = Bun.spawn({
      cmd: [Bun.which("bun") || process.argv0, "src/main.js", "-i"],
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, PS1: "> " },
      terminal,
    });
    try {
      await Bun.sleep(150);
      terminal.write(`cd ${child}\r`);
      await Bun.sleep(80);
      terminal.write("echo alt-l-preserved");
      terminal.write("\x1bl");
      await Bun.sleep(100);
      terminal.write("\x1bu");
      await Bun.sleep(100);
      terminal.write("\x1bp");
      await Bun.sleep(100);
      terminal.write("\r");
      await Bun.sleep(80);
      terminal.write("exit\r");
      expect(await proc.exited).toBe(0);
    } finally {
      terminal.close();
      rmSync(cwd, { recursive: true, force: true });
    }
    expect(transcript).toContain("alt-l-marker.txt");
    expect(transcript).toContain("alt-u-parent-marker.txt");
    expect(transcript).toContain("alt-l-preserved\r\n");
  });

  test("renders ghosts and accepts history words, file paths, and commands", async () => {
    let transcript = "";
    const terminal = new Bun.Terminal({
      cols: 100,
      rows: 30,
      data(_terminal, data) { transcript += data.toString(); },
    });
    const proc = Bun.spawn({
      cmd: [Bun.which("bun") || process.argv0, "src/main.js", "-i"],
      cwd: new URL("..", import.meta.url).pathname,
      env: { ...process.env, PS1: "> " },
      terminal,
    });
    const send = async (text) => {
      terminal.write(text);
      await Bun.sleep(80);
    };
    try {
      await Bun.sleep(150);
      await send("echo hello world\r");
      await send("echo h");
      await send("\x1b[C");
      await send("\r");
      await send("echo h");
      await send("\t");
      await send("\r");
      await send("basename pack");
      await send("\x1b[C");
      await send("\r");
      await send("pri");
      await send("\t");
      await send("\r");
      await send("exit\r");
      expect(await proc.exited).toBe(0);
    } finally {
      terminal.close();
    }
    expect(transcript).toContain("\x1b[2mello world\x1b[0m");
    expect(transcript).toContain("\x1b[2mage.json\x1b[0m");
    expect(transcript).toContain("package.json\r\n");
    expect(transcript).toContain("\x1b[2mnt\x1b[0m");
    expect(transcript).toContain("\x1b[0Knt\r");
    expect(transcript).not.toContain(MOUSE_ON);
  });
});

describe("pspa", () => {
  test("lists every PID with its full command line", async () => {
    const execution = await executeArgv(["builtin", "pspa"], createState(), { capture: true });
    expect(execution.status).toBe(0);
    const lines = decode(execution.stdout).split("\n");
    //  POSIX passes `ps -eo pid,args` through untouched, so its header is the
    //  header, and this test process has to be in the listing under itself.
    expect(lines[0]).toMatch(/^\s*PID COMMAND$/);
    const own = lines.find((line) => new RegExp(`^\\s*${process.pid} `).test(line));
    expect(own).toBeDefined();
    expect(own.length).toBeGreaterThan(String(process.pid).length + 1);
  });

  test("takes no operands", async () => {
    const execution = await executeArgv(["builtin", "pspa", "extra"], createState(), { capture: true });
    expect(execution.status).toBe(2);
    expect(decode(execution.stderr)).toBe("bunmsh: pspa: unexpected operand: extra\n");
  });

  test("parses the Windows Win32_Process listing into sorted rows", () => {
    //  What the PowerShell one-liner writes: PID, a space, then the command
    //  line — or the image name when a system process has none.
    const rows = parseWindowsProcessList(
      "4 System\r\n" +
      "9876 \"C:\\Program Files\\App\\app.exe\" --flag \"a b\"\r\n" +
      "1200 C:\\Windows\\system32\\svchost.exe -k netsvcs\r\n" +
      "\r\n",
    );
    expect(rows).toEqual([
      { pid: 4, args: "System" },
      { pid: 1200, args: "C:\\Windows\\system32\\svchost.exe -k netsvcs" },
      { pid: 9876, args: '"C:\\Program Files\\App\\app.exe" --flag "a b"' },
    ]);
  });

  test("drops the continuation lines a multi-line command line produces", () => {
    expect(parseWindowsProcessList("42 one\nwrapped continuation\n88 two\n")).toEqual([
      { pid: 42, args: "one" },
      { pid: 88, args: "two" },
    ]);
  });

  test("formats the Windows rows into the same two columns ps prints", () => {
    expect(formatProcessTable([{ pid: 4, args: "System" }, { pid: 1200, args: "svchost.exe" }]))
      .toBe("  PID COMMAND\n    4 System\n 1200 svchost.exe\n");
    //  The column widens past procps' five columns for a longer PID.
    expect(formatProcessTable([{ pid: 123456, args: "app.exe" }]))
      .toBe("   PID COMMAND\n123456 app.exe\n");
    expect(formatProcessTable([])).toBe("  PID COMMAND\n");
  });
});

describe("kill", () => {
  test("probes with signal 0 and reports an unknown pid", async () => {
    expect(await executeArgv(["builtin", "kill", "-0", String(process.pid)], createState(), { capture: true }))
      .toMatchObject({ status: 0 });
    const missing = await executeArgv(["builtin", "kill", "-0", "999999"], createState(), { capture: true });
    expect(missing.status).toBe(1);
    expect(decode(missing.stderr)).toContain("bunmsh: kill: 999999:");
    expect(await executeArgv(["builtin", "kill"], createState(), { capture: true }))
      .toMatchObject({ status: 2 });
  });

  test.skipIf(process.platform === "win32")("signals a real process", async () => {
    const proc = Bun.spawn({ cmd: ["sleep", "30"], stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    try {
      expect(await executeArgv(["builtin", "kill", String(proc.pid)], createState(), { capture: true }))
        .toMatchObject({ status: 0 });
      await proc.exited;
      expect(proc.signalCode).toBe("SIGTERM");
    } finally { proc.kill("SIGKILL"); }
  });

  test("builds the taskkill command a Windows kill goes through", () => {
    //  /T reaches the children libuv's TerminateProcess leaves running, /F is
    //  what makes it work on a console process with no message loop.
    expect(windowsKillCommand(1234)).toEqual(["taskkill", "/PID", "1234", "/T", "/F"]);
    expect(windowsKillCommand("1234")).toEqual(["taskkill", "/PID", "1234", "/T", "/F"]);
  });

  test("rewrites a taskkill failure as one of our own lines", () => {
    expect(taskkillFailure(0, "SUCCESS: The process with PID 1234 has been terminated.\r\n", ""))
      .toBeNull();
    expect(taskkillFailure(128, "", 'ERROR: The process "1234" not found.\r\n'))
      .toBe('The process "1234" not found.');
    expect(taskkillFailure(1, "ERROR: Access is denied.\r\n", "")).toBe("Access is denied.");
    expect(taskkillFailure(1, "", "")).toBe("taskkill exited with status 1");
  });
});

describe("pspac", () => {
  const wrap = (name, value) => `${SH_COLORS[name]}${value}${SH_COLORS.reset}`;

  test("reads the rows back out of the plain ps listing", () => {
    expect(parsePosixProcessList("  PID COMMAND\n    1 /init\n12771 bash -l\n\n")).toEqual([
      { pid: 1, args: "/init" },
      { pid: 12771, args: "bash -l" },
    ]);
  });

  test("dims the directory and names the program the first token really is", () => {
    const line = colorProcessCommand("/usr/bin/bash --login -l notes.txt");
    //  Colour is the only difference: the text itself is untouched.
    expect(Bun.stripANSI(line)).toBe("/usr/bin/bash --login -l notes.txt");
    expect(line).toContain(wrap("path", "/usr/bin/"));
    expect(line).toContain(wrap("type", "bash"));
    expect(line).toContain(wrap("statement", "--login"));
    expect(line).toContain(wrap("statement", "-l"));
    //  An ordinary operand is left alone.
    expect(line).toContain(" notes.txt");
    //  Word boundaries are micro's: the `sh` ending `script.sh` is one of
    //  sh.yaml's command names, and it is painted like one here too.
    expect(colorProcessCommand("bun run script.sh")).toContain(wrap("type", "sh"));

    //  A program sh.yaml's word lists have never heard of is still the
    //  command, because here the first token is known to be one.
    expect(colorProcessCommand("fish")).toBe(wrap("type", "fish"));
    expect(colorProcessCommand("")).toBe("");
  });

  test("applies sh.yaml's rules to the rest of the command line", () => {
    const source = 'if test 42 = "$HOME"; then echo ok; fi # note';
    const line = highlightShellCommand(source);
    expect(Bun.stripANSI(line)).toBe(source);
    expect(line).toContain(wrap("statement", "if"));
    expect(line).toContain(wrap("statement", "then"));
    expect(line).toContain(wrap("constant", "42"));
    expect(line).toContain(wrap("type", "test"));
    expect(line).toContain(wrap("special", "="));
    //  The string is a region, so it swallows the $HOME inside it.
    expect(line).toContain(wrap("string", '"$HOME"'));
    expect(line).toContain(wrap("comment", "# note"));
    expect(highlightShellCommand("run $HOME/bin ${PATH}"))
      .toContain(wrap("identifier", "$HOME"));
  });

  test("resolves rule precedence the way micro does", () => {
    //  The flag rule is listed after the command names, so it wins the
    //  overlap: --cat is a flag, not the coreutils cat.
    expect(highlightShellCommand("bun --cat run")).toContain(wrap("statement", "--cat"));
    //  A # inside a quoted argument does not open a comment.
    const quoted = highlightShellCommand('echo "a # b" done');
    expect(quoted).toContain(wrap("string", '"a # b"'));
    expect(quoted).toContain(wrap("statement", "done"));
  });

  test("lets a kernel thread and a quoted program keep their own colour", () => {
    expect(colorProcessCommand("[kworker/0:1]")).toBe(wrap("path", "[kworker/0:1]"));
    const windows = colorProcessCommand('"C:\\Program Files\\App\\app.exe" --flag');
    expect(Bun.stripANSI(windows)).toBe('"C:\\Program Files\\App\\app.exe" --flag');
    expect(windows).toContain(wrap("string", '"C:\\Program Files\\App\\app.exe"'));
    expect(windows).toContain(wrap("statement", "--flag"));
  });

  test("strips back to exactly what pspa prints", () => {
    const rows = [
      { pid: 1, args: "/init" },
      { pid: 4, args: "" },
      { pid: 123456, args: "/usr/bin/bun run dev" },
    ];
    expect(Bun.stripANSI(colorProcessTable(rows))).toBe(formatProcessTable(rows));
  });

  test("lists the same processes pspa does, in colour", async () => {
    const execution = await executeArgv(["builtin", "pspac"], createState(), { capture: true });
    expect(execution.status).toBe(0);
    const text = decode(execution.stdout);
    expect(text).toContain("\x1b[");
    const lines = Bun.stripANSI(text).split("\n");
    expect(lines[0]).toMatch(/^\s*PID COMMAND$/);
    expect(lines.some((line) => new RegExp(`^\\s*${process.pid} `).test(line))).toBe(true);
  });

  test("takes no operands", async () => {
    const execution = await executeArgv(["builtin", "pspac", "extra"], createState(), { capture: true });
    expect(execution.status).toBe(2);
    expect(decode(execution.stderr)).toBe("bunmsh: pspac: unexpected operand: extra\n");
  });
});

describe("variable completion", () => {
  const state = { env: { HOME: "/home/user", HOSTNAME: "box", PATH: "/bin", LOCAL_ONLY: "x" } };

  test("recognizes a name being typed after $, ${, and ${#", () => {
    expect(variableContext("echo $HO")).toMatchObject({ prefix: "HO", lead: "$", brace: false });
    expect(variableContext("echo ${HO")).toMatchObject({ prefix: "HO", lead: "${", brace: true });
    expect(variableContext("echo ${#HO")).toMatchObject({ prefix: "HO", lead: "${#", brace: true });
    //  A bare $ is a name with nothing typed yet, not a non-match.
    expect(variableContext("echo $")).toMatchObject({ prefix: "", lead: "$" });
    //  Position on the line does not matter: inside double quotes, on the
    //  right of an assignment, or where a command name would go.
    expect(variableContext('echo "$HO')).toMatchObject({ prefix: "HO" });
    expect(variableContext("X=$HO")).toMatchObject({ prefix: "HO" });
    expect(variableContext("$ED")).toMatchObject({ prefix: "ED" });
  });

  test("leaves alone every other thing a $ can start", () => {
    expect(variableContext("echo $(")).toBeNull();
    expect(variableContext("echo $(l")).toBeNull();
    expect(variableContext("echo $?")).toBeNull();
    expect(variableContext("echo $1")).toBeNull();
    //  $$ is the pid, already complete; the second $ is not a name opening.
    expect(variableContext("echo $$")).toBeNull();
    expect(variableContext("echo hi")).toBeNull();
    expect(variableContext("echo $HOME ")).toBeNull();
  });

  test("counts backslashes so an escaped dollar stays literal", () => {
    expect(variableContext(String.raw`echo \$HO`)).toBeNull();
    //  An escaped backslash is not escaping the dollar.
    expect(variableContext(String.raw`echo \\$HO`)).toMatchObject({ prefix: "HO" });
    expect(variableContext(String.raw`echo \\\$HO`)).toBeNull();
  });

  test("completes from the shell's own table, exported or not", () => {
    const index = new VariableIndex();
    expect(index.matches(state, "HO")).toEqual(["HOME", "HOSTNAME"]);
    expect(index.first(state, "LOCAL")).toBe("LOCAL_ONLY");
    expect(index.first(state, "ZZ")).toBeNull();
    //  An empty prefix lists everything, the way Tab on an empty word does.
    expect(index.matches(state, "")).toEqual(["HOME", "HOSTNAME", "LOCAL_ONLY", "PATH"]);
    expect(index.first(state, "")).toBeNull();
  });

  test("picks up a name added after the index was first built", () => {
    const index = new VariableIndex();
    const live = { env: { ...state.env } };
    expect(index.first(live, "TA")).toBeNull();
    live.env.TAG = "v1";
    expect(index.first(live, "TA")).toBe("TAG");
  });

  test("closes the brace it was given", () => {
    expect(variableCompletion(variableContext("echo $HO"), "HOME")).toBe("$HOME");
    expect(variableCompletion(variableContext("echo ${HO"), "HOME")).toBe("${HOME}");
    expect(variableCompletion(variableContext("echo ${#HO"), "HOME")).toBe("${#HOME}");
  });

  test("reports the quote a word is inside, so nothing expands in single quotes", () => {
    expect(completionContext("echo 'foo")).toMatchObject({ quote: "'" });
    expect(completionContext('echo "foo')).toMatchObject({ quote: '"' });
    expect(completionContext("echo foo")).toMatchObject({ quote: null });
  });

  test("treats $( as a command position and ) as the end of one", () => {
    expect(completionContext("echo $(l")).toMatchObject({ command: true, prefix: "l" });
    expect(completionContext("echo $(ls /tm")).toMatchObject({ command: false, prefix: "/tm" });
    expect(completionContext("echo $(date) fi")).toMatchObject({ command: false, prefix: "fi" });
  });
});

describe("javascript mode completion", () => {
  test("decides mode by the rule the evaluator dispatches on", () => {
    expect(isJavaScriptMode("Bun.e, 1")).toBe(true);
    expect(isJavaScriptMode("  Bun.file('x')")).toBe(true);
    expect(isJavaScriptMode("echo Bun.e")).toBe(false);
  });

  test("stops offering a continuation a JavaScript line could never accept", () => {
    //  A bare trailing backslash is a syntax error in JavaScript, not a
    //  request for another line, so the prompt no longer asks for one.
    expect(needsMoreInput("Bun.e; const p = \\")).toBe(false);
    //  An unterminated string still continues: that is JavaScript's own line
    //  continuation, and the evaluator accepts it.
    expect(needsMoreInput('Bun.e, "abc\\')).toBe(true);
    expect(needsMoreInput("Bun.e, `abc")).toBe(true);
    //  Shell text is untouched.
    expect(needsMoreInput("echo hi \\")).toBe(true);
    expect(needsMoreInput('echo "abc')).toBe(true);
    expect(needsMoreInput("echo hi")).toBe(false);
  });

  test("completes a shell variable after $. and nothing after a bare $", () => {
    expect(javascriptContext("Bun.e, $.HO")).toMatchObject({ kind: "variable", prefix: "HO", lead: "$." });
    expect(javascriptContext("Bun.e, $.")).toMatchObject({ kind: "variable", prefix: "" });
    //  In JavaScript a bare `$` is the table object itself; a name only
    //  starts after the dot.
    expect(javascriptContext("Bun.e, $")).toBeNull();
    expect(javascriptContext("Bun.e, 1 + 2")).toBeNull();
  });

  test("completes a path inside an unclosed string literal", () => {
    expect(javascriptContext('Bun.e, Bun.file("/tm')).toMatchObject({ kind: "path", prefix: "/tm", quote: '"' });
    expect(javascriptContext("Bun.e, Bun.file('/tm")).toMatchObject({ kind: "path", prefix: "/tm", quote: "'" });
    expect(javascriptContext("Bun.e, Bun.file(`/tm")).toMatchObject({ kind: "path", prefix: "/tm", quote: "`" });
    //  A closed string is not a path being typed.
    expect(javascriptContext('Bun.e, Bun.file("/tmp/x")')).toBeNull();
    //  An escaped quote does not close it.
    expect(javascriptContext('Bun.e, "it\\"s /tm')).toMatchObject({ kind: "path", prefix: 'it\\"s /tm' });
  });

  test("treats a template interpolation as code again", () => {
    //  Inside ${ } the cursor is back in JavaScript, so $. completes there.
    expect(javascriptContext("Bun.e, `a${$.HO")).toMatchObject({ kind: "variable", prefix: "HO" });
    //  And the template resumes after the closing brace.
    expect(javascriptContext("Bun.e, `a${b}/tm")).toMatchObject({ kind: "path", quote: "`" });
  });
});
