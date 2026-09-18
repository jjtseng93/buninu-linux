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
      expect(classified.stdout).toContain("small.txt");
      expect(classified.stdout).not.toMatch(/small\.txt[*/@=|]/);

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
    const runInTerminal = async (source) => {
      let transcript = "";
      const terminal = new Bun.Terminal({
        cols: 80,
        rows: 24,
        data(_terminal, data) { transcript += data.toString(); },
      });
      const proc = Bun.spawn({
        cmd: [process.execPath, "src/main.js", "-c", source],
        cwd: new URL("..", import.meta.url).pathname,
        env: { ...process.env, PATH: "/no/such/path" },
        terminal,
      });
      try {
        return { status: await proc.exited, transcript };
      } finally { terminal.close(); }
    };

    expect(await runInTerminal("bunmsh -cc printf nested"))
      .toEqual({ status: 0, transcript: "nested" });
    expect((await runInTerminal("bun --version"))).toEqual({
      status: 0,
      transcript: `${Bun.version}\r\n`,
    });
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

