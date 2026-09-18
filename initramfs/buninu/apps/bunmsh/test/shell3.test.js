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
describe("CLI", () => {
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
