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
    // Bun.Terminal emits different repaint sequences through PRoot and native
    // Android. Compare the visible terminal text rather than those sequences.
    const visible = Bun.stripANSI(transcript)
      .replaceAll("\r\r\n", "\n")
      .replaceAll("\r\n", "\n");
    expect(visible.match(/^> /gm) ?? []).toHaveLength(2);
    expect(visible).toContain("hello world\n");
    expect(visible).toContain("after:0\n");
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
});
