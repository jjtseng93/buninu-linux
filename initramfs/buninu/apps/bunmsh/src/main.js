#!/usr/bin/env bun

import { createInterface } from "node:readline/promises";
import {
  builtinNames,
  createState,
  execute,
  executeArgv,
  executeBunShellFallback,
  isJavaScriptMode,
  needsMoreInput,
  pipelineChildState,
} from "./shell.js";
import {
  CommandIndex,
  FileIndex,
  VariableIndex,
  completionContext,
  fitGhost,
  historyGhost,
  javascriptContext,
  nextGhostChunk,
  variableCompletion,
  variableContext,
} from "./completion.js";
import { readAssetText } from "../single-exe/assetsHelper.js";
import { buildEarlyExit, stringifyNonPrimitiveDefineValues } from "../single-exe/compiled.js";
import { importedHistory, readlineHistory, saveBunmshHistory } from "./history.js";
import pkg from "../package.json" with { type:"json" }
import { MOUSE_OFF, MOUSE_ON, PASTE_OFF, PASTE_ON, mouseInput } from "./mouse.js";
import { homeRelativePath } from "./environment.js";

const VERSION = `
${pkg.name}: ${pkg.description}
(mksh-inspired Bun Modern Shell)
  Made by: Dr. John (醫者小智)

Version: ${pkg.version} 
`

async function printReadme() {
  const source = await readAssetText("README.md");
  console.log(
    Bun.markdown?.ansi(source, { hyperlinks: true }) || source,
  );
}

async function printChangelog() {
  const source = await readAssetText("CHANGELOG.md");
  console.log(
    Bun.markdown?.ansi(source, { hyperlinks: true }) || source,
  );
}

function usage() {
  console.log(`
Usage:
  bunmsh [options]
  bunmsh <script_path> [argv Array]
  bunmsh -c <script_text> [argv Array]
  bunmsh -cc <command> [argv Array]

Options:
  -c <script_text> [argv Array]
    Command text as shell script 
      → Parse & Execute
      
    -c 'echo "$0" "$1"' Hello world
      → Hello world
      
  -cc <command> [argv Array]
    Call Command with argv as is
      Can be alias/builtin or from PATH
      Without shell parsing
      Without shell expansions
      
    -cc echo '$HOME' '*.js'
      → $HOME *.js
    -cc lsfancy -lh
      → List cwd with emojis

  --mouse      Enable mouse events
  --builtin-only
               Skip $PATH lookup
               
  -i           Enter interactive mode
  
  -V, --version
               Show version
  -h, --help   Show this help
  --readme     Show bunmsh's README.md
  --changelog  Show bunmsh's CHANGELOG.md
  
  --build-exe
      Build ./bmsh for the current platform
  --build-for TARGET
      Cross-compile ./bmsh for TARGET
`);
}

function renderCwd(state, cwd) {
  const relative = homeRelativePath(cwd, state.env.HOME);
  return relative === null ? cwd : `~${relative}`;
}

function renderPrompt(state, withRegions = false) {
  const tabParts = state.tabs.length > 1
    ? state.tabs.map((path, index) =>
        index === state.activeTab
          ? `\x1b[38;5;81m📂 ${renderCwd(state, path)}\x1b[0m`
          : `📁 ${renderCwd(state, path)}`)
    : null;
  const cwd = tabParts ? tabParts.join("  ") : renderCwd(state, state.cwd);
  const defaultPrompt = state.tabs.length > 1
    ? `\\w\n[${state.activeTab + 1}]$ `
    : "📁 \\w\n$ ";
  const template = state.env.PS1 ?? defaultPrompt;
  const styledTemplate = state.lastStatus === 0
    ? template
    : template.replaceAll("$", "\x1b[31m$\x1b[0m");
  const text = styledTemplate.replaceAll("\\w", cwd);
  if (!withRegions) return { text, regions: [], newTabRegion: [], inputStart: null };
  const columns = process.stdout.columns ?? 80;
  let row = 0, column = 0;
  const advance = (source, cells = null) => {
    for (let i = 0; i < source.length;) {
      const ansi = /^\x1b\[[0-9;]*m/.exec(source.slice(i));
      if (ansi) { i += ansi[0].length; continue; }
      const character = String.fromCodePoint(source.codePointAt(i));
      i += character.length;
      if (character === "\n") { row++; column = 0; continue; }
      const width = Bun.stringWidth(character);
      for (let n = 0; n < width; n++) {
        if (column >= columns) { row++; column = 0; }
        cells?.push({ row, column });
        column++;
      }
    }
  };
  let regions = [];
  const newTabRegion = [];
  if (tabParts) {
    const prefix = styledTemplate.slice(0, styledTemplate.indexOf("\\w"));
    advance(prefix);
    regions = tabParts.map((part, index) => {
      const cells = [];
      advance(part, cells);
      if (index + 1 < tabParts.length) advance("  ");
      return cells;
    });
    const marker = `[${state.activeTab + 1}]$`;
    const markerIndex = text.lastIndexOf(marker);
    if (markerIndex >= 0) {
      row = 0;
      column = 0;
      advance(text.slice(0, markerIndex + 1));
      advance(String(state.activeTab + 1), newTabRegion);
    }
  }
  // Where the editable input line begins, so a click past the prompt itself
  // can be mapped back to a character offset in the line (see
  // moveCursorToClick below) regardless of tab count or prompt wrapping.
  row = 0;
  column = 0;
  advance(text);
  return { text, regions, newTabRegion, inputStart: { row, column } };
}

async function interactive(state) {
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  let mouseTracking = terminal && state.mouseTracking;
  const commandIndex = new CommandIndex(builtinNames());
  const fileIndex = new FileIndex();
  const variableIndex = new VariableIndex();
  //  A `$` being typed outranks the word it sits in: `$ED` is a variable
  //  name, not a command or a file, wherever on the line it appears. Single
  //  quotes are the exception, since nothing expands inside them.
  const variableMatch = (line, cursor, context) => {
    if (context.quote === "'") return null;
    const variable = variableContext(line, cursor);
    return variable ? { variable } : null;
  };
  //  JavaScript mode is decided on the whole source the evaluator will see,
  //  which on a continued line is what is pending plus what is being typed.
  //  `pending` is declared further down, next to the loop that fills it; it
  //  is always initialised by the time a keystroke can reach this.
  const javascriptLine = (line) => isJavaScriptMode(pending ? `${pending}\n${line}` : line);
  //  What a JavaScript line offers: a shell variable name after `$.`, a path
  //  inside a string literal, and nothing where neither applies — shell
  //  word-splitting would only produce noise there.
  const javascriptMatches = (line, cursor) => {
    const js = javascriptContext(line, cursor);
    if (js?.kind === "variable")
      return {
        js,
        names: variableIndex.matches(state, js.prefix).map((name) => variableCompletion(js, name)),
        first: variableIndex.first(state, js.prefix),
        complete: (name) => variableCompletion(js, name),
      };
    if (js?.kind === "path")
      return {
        js,
        names: fileIndex.matches(js.prefix, state),
        first: fileIndex.first(js.prefix, state),
        complete: (name) => name,
      };
    return null;
  };
  state.history = await importedHistory(state.env);
  const history = state.history;
  // Marks everything just loaded (including whatever another session has
  // already saved) as already persisted, so this session's own history
  // saves only ever append commands actually typed here — never the
  // imported bash/fish/bunmsh history it started from. See saveBunmshHistory.
  state.historySaved = state.history.length;
  if (terminal) await commandIndex.refresh(state);
  let readline;
  let promptRegions = [];
  let newTabRegion = [];
  let inputStart = null;
  let pendingClick = null;
  let pendingCursorQuery = null;
  let lastTabClick = null;
  let mouseCommandRunning = false;
  let foregroundCommand = false;
  let promptAbort = null;
  // Set by onPaste (below) when a bracketed paste contains a newline, and
  // consumed by the main loop's readline.question() catch block right after
  // promptAbort.abort() rejects it -- see the comment there.
  let pastedLine = null;
  // A single-line paste behaves exactly like ordinary typed/pasted text
  // already did: insert it at the cursor. A multi-line one (the common case
  // this exists for -- pasting a whole multi-command tutorial block, some of
  // whose commands span several `\`-continued physical lines) cannot be fed
  // through readline a keypress at a time, since every embedded "\n" would
  // be read as its own Enter and submit each physical line separately
  // (breaking any `\` continuation, since the interrupted line wouldn't yet
  // have the next line to join with). Instead, whatever was already typed on
  // this line plus the pasted text becomes the resolved `line` value for the
  // in-flight readline.question() -- exactly as if the user had typed all of
  // it and pressed Enter once -- so it goes through the exact same
  // pending/needsMoreInput/execute path an ordinary submitted line does.
  const onPaste = (text) => {
    if (!readline) return;
    // A terminal's own line-ending convention for pasted content isn't
    // guaranteed to be "\n" -- observed in the wild: a bare "\r" (the same
    // byte Enter sends) between lines, which bunmsh's parser otherwise
    // treats as whitespace, not a statement separator (see shell.js's
    // isSpace). Bracketed-paste content specifically always means "these
    // are separate lines", so normalize every convention to "\n" here
    // before anything downstream looks at it.
    const normalized = text.replace(/\r\n?/g, "\n");
    if (!normalized.includes("\n")) {
      readline.write(normalized);
      return;
    }
    if (foregroundCommand || !promptAbort) return;
    const line = readline.line ?? "";
    const cursor = readline.cursor ?? line.length;
    pastedLine = line.slice(0, cursor) + normalized + line.slice(cursor);
    readline.line = "";
    readline.cursor = 0;
    promptAbort.abort();
  };
  const runTabShortcut = (args) => {
    if (!readline || mouseCommandRunning) return;
    mouseCommandRunning = true;
    void executeArgv(["builtin", "tab", ...args], state, { capture: true }).finally(() => {
      mouseCommandRunning = false;
      const next = renderPrompt(state, true);
      promptRegions = next.regions;
      newTabRegion = next.newTabRegion;
      inputStart = next.inputStart;
      readline.setPrompt(next.text);
      readline.prompt(true);
    });
  };
  const runFancyShortcut = (args = []) => {
    if (!readline || mouseCommandRunning) return;
    mouseCommandRunning = true;
    // readline.prompt(true) moves upward by the current prompt/edit buffer's
    // row count before repainting. Reserve those rows below the listing so it
    // clears the reserved space instead of overwriting a short lsfancy result.
    const repaintRows = readline.getCursorPos().rows;
    process.stdout.write("\r\x1b[0J\n");
    void executeArgv(["builtin", "lsfancy", ...args], state).finally(() => {
      mouseCommandRunning = false;
      if (repaintRows > 0) process.stdout.write("\n".repeat(repaintRows));
      const next = renderPrompt(state, true);
      promptRegions = next.regions;
      newTabRegion = next.newTabRegion;
      inputStart = next.inputStart;
      readline.setPrompt(next.text);
      readline.prompt(true);
    });
  };
  const queryCursor = () => new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingCursorQuery?.resolve === resolve) pendingCursorQuery = null;
      resolve(null);
    }, 60);
    pendingCursorQuery = {
      resolve(position) {
        clearTimeout(timer);
        pendingCursorQuery = null;
        resolve(position);
      },
    };
    process.stdout.write("\x1b[6n");
  });
  // Maps a click's cell position (relative to the prompt's own first row,
  // same coordinate space as promptRegions/newTabRegion) to a character
  // offset in the currently typed input line, then moves the cursor there
  // by simulating that many left/right arrow presses — the only way to
  // relocate readline's cursor and have it redraw correctly without reaching
  // into its private internals.
  const moveCursorToClick = (targetRow, targetColumn) => {
    if (!readline || !inputStart) return;
    const line = readline.line ?? "";
    const columns = process.stdout.columns ?? 80;
    let row = inputStart.row, column = inputStart.column;
    let index = line.length;
    for (let i = 0; i < line.length; i++) {
      if (row > targetRow || (row === targetRow && column >= targetColumn)) { index = i; break; }
      const width = Bun.stringWidth(line[i]);
      for (let n = 0; n < width; n++) {
        if (column >= columns) { row++; column = 0; }
        column++;
      }
    }
    const delta = index - readline.cursor;
    const key = { name: delta > 0 ? "right" : "left" };
    for (let n = 0; n < Math.abs(delta); n++) readline.write(null, key);
  };
  const filteredInput = terminal ? mouseInput((mouse) => {
    if (!mouse.press || (mouse.button & 3) !== 0 || (mouse.button & 32)) return;
    pendingClick = { ...mouse, at: Date.now() };
    process.stdout.write("\x1b[6n");
  }, (position) => {
    if (pendingCursorQuery) {
      pendingCursorQuery.resolve(position);
      return;
    }
    const { row } = position;
    if (!pendingClick || !readline) return;
    const click = pendingClick;
    pendingClick = null;
    const cursor = readline.getCursorPos();
    const relativeRow = click.y - (row - cursor.rows);
    const relativeColumn = click.x - 1;
    if (newTabRegion.some((cell) =>
      cell.row === relativeRow && cell.column === relativeColumn)) {
      lastTabClick = null;
      runTabShortcut(["n"]);
      return;
    }
    const index = promptRegions.findIndex((cells) =>
      cells.some((cell) => cell.row === relativeRow && cell.column === relativeColumn));
    if (index < 0) {
      moveCursorToClick(relativeRow, relativeColumn);
      return;
    }
    const doubleClick = lastTabClick?.index === index &&
      click.at - lastTabClick.at <= 400;
    lastTabClick = doubleClick ? null : { index, at: click.at };
    if (index !== state.activeTab) {
      state.activeTab = index;
      state.cwd = state.tabs[index];
      state.env.PWD = state.cwd;
    }
    const rendered = renderPrompt(state, true);
    promptRegions = rendered.regions;
    newTabRegion = rendered.newTabRegion;
    inputStart = rendered.inputStart;
    readline.setPrompt(rendered.text);
    if (!doubleClick || mouseCommandRunning) {
      readline.prompt(true);
      return;
    }
    runFancyShortcut();
  }, (shortcut) => {
    if (shortcut === "tab") runTabShortcut([]);
    else if (shortcut === "tab-left") runTabShortcut(["l"]);
    else if (shortcut === "lsfancy") runFancyShortcut();
    else if (shortcut === "lsfancy-parent") runFancyShortcut([".."]);
    else if (shortcut === "tab-close") runTabShortcut(["x"]);
  }, onPaste) : process.stdin;
  const completer = (line) => {
    commandIndex.refreshIfChanged(state);
    if (javascriptLine(line)) {
      const found = javascriptMatches(line, line.length);
      return found?.names.length ? [found.names, found.js.text] : [[], line];
    }
    const context = completionContext(line);
    const found = variableMatch(line, line.length, context);
    if (found) {
      const names = variableIndex.matches(state, found.variable.prefix);
      if (names.length)
        return [names.map((name) => variableCompletion(found.variable, name)), found.variable.text];
    }
    if (context.command) {
      return [
        context.prefix.includes("/")
          ? fileIndex.matches(context.prefix, state)
          : commandIndex.matches(context.prefix),
        context.prefix,
      ];
    }
    if (!context.prefix)
      return [fileIndex.matches("", state), ""];
    const fromHistory = historyGhost(history, line);
    const fileMatch = fileIndex.first(context.prefix, state);
    const ghost = fromHistory ?? (fileMatch ? fileMatch.slice(context.prefix.length) : null);
    const chunk = nextGhostChunk(ghost);
    return chunk ? [[`${line}${chunk}`], line] : [[], line];
  };
  let readlineResizeListeners = [];
  const setReadlineResizeEnabled = (enabled) => {
    for (const listener of readlineResizeListeners) {
      if (enabled) {
        if (!process.stdout.listeners("resize").includes(listener))
          process.stdout.on("resize", listener);
      } else {
        process.stdout.off("resize", listener);
      }
    }
  };
  const interrupt = () => {
    state.lastStatus = 130;
    if (foregroundCommand || promptAbort?.signal.aborted) return;
    process.stdout.write("\n");
    promptAbort?.abort();
  };
  // Unlike Ctrl-C, SIGTERM/SIGHUP (e.g. `kill <pid>`, or some terminal
  // emulators on window close) mean the process itself is being asked to
  // go away, not just the current edit. There is no general job-control
  // layer yet to also stop a foreground command's own process, so this
  // only makes sure history isn't lost: flush it immediately if one is
  // running (its own async work continues independently either way), or
  // otherwise abort the pending prompt so the main loop's own exit path —
  // and its usual cleanup — runs right away instead of only via the next
  // periodic autosave.
  const SIGNAL_EXIT_STATUS = { SIGHUP: 129, SIGTERM: 143 };
  const terminate = (signal) => {
    state.exitRequested = true;
    state.exitStatus = SIGNAL_EXIT_STATUS[signal] ?? state.exitStatus;
    if (foregroundCommand) {
      void saveBunmshHistory(state, state.env).catch(() => {});
      return;
    }
    promptAbort?.abort();
  };
  let closed;
  // Node's readline closes itself (and cannot be reused) the moment Ctrl-D
  // is pressed on an empty line — including an empty PS2 continuation line
  // mid here-document. That should only end the current construct, like
  // mksh, not the whole shell, so this rebuilds a fresh interface on the
  // same input instead of exiting. Used at startup and again after such a
  // close; it re-wires everything tied to the interface itself (the SIGINT
  // handler and the resize-repaint listeners readline registers) since a new
  // instance does not carry those over.
  const setupReadline = () => {
    const resizeListenersBeforeReadline = terminal
      ? new Set(process.stdout.listeners("resize"))
      : null;
    readline = createInterface({
      input: filteredInput,
      output: process.stdout,
      terminal,
      completer,
      history: readlineHistory(history),
      historySize: Math.max(1000, history.length + 1000),
    });
    // readline refreshes its prompt whenever stdout emits "resize", even while
    // the interface is paused. Termux emits a resize when its app returns to
    // the foreground, which otherwise paints the shell's cwd prompt over a
    // running server or other foreground command.
    readlineResizeListeners = terminal
      ? process.stdout.listeners("resize").filter(
          (listener) => !resizeListenersBeforeReadline.has(listener))
      : [];
    readline.on("SIGINT", interrupt);
    closed = new Promise((resolve) => readline.once("close", () => resolve(null)));
  };
  setupReadline();
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  process.on("SIGHUP", terminate);
  // Append-only (see saveBunmshHistory), so this is cheap and safe to run
  // unconditionally in the background — it only ever adds this session's
  // own new commands to the end of the file, never touching anything a
  // concurrent bunmsh session elsewhere has written. Failures (e.g. a full
  // disk) are swallowed rather than interrupting whatever the user is
  // typing; `tab s` still reports a real error if the user asks directly.
  const historySaveTimer = setInterval(() => {
    void saveBunmshHistory(state, state.env).catch(() => {});
  }, 60_000);
  historySaveTimer.unref?.();
  let refreshTimer = null;
  let removeGhostHooks = () => {};
  if (terminal) {
    process.stdin.pipe(filteredInput);
    if (mouseTracking) process.stdout.write(MOUSE_ON);
    process.stdout.write(PASTE_ON);
    refreshTimer = setInterval(() => void commandIndex.refresh(state), 10_000);
    refreshTimer.unref?.();

    let ghostWidth = 0;
    let startedAtEnd = false;
    let renderTask = null;
    const currentGhost = () => {
      if (readline.cursor !== readline.line.length) return null;
      if (javascriptLine(readline.line)) {
        const found = javascriptMatches(readline.line, readline.cursor);
        //  An empty name matches everything, so it ghosts nothing; Tab still
        //  lists it all, the way it does for an empty word in shell text.
        if (found?.js.prefix && found.first)
          return found.complete(found.first).slice(found.js.text.length);
        return historyGhost(history, readline.line);
      }
      const context = completionContext(readline.line, readline.cursor);
      const found = variableMatch(readline.line, readline.cursor, context);
      //  An empty name would match every variable there is, so a bare `$`
      //  ghosts nothing; Tab still lists them all, the way it does for files.
      const variableGhost = () => {
        if (!found?.variable.prefix) return null;
        const name = variableIndex.first(state, found.variable.prefix);
        return name
          ? variableCompletion(found.variable, name).slice(found.variable.text.length)
          : null;
      };
      if (context.command) {
        const ghost = variableGhost();
        if (ghost) return ghost;
        const match = context.prefix.includes("/")
          ? fileIndex.first(context.prefix, state)
          : commandIndex.first(context.prefix);
        return match ? match.slice(context.prefix.length) : null;
      }
      //  History still wins where it applies: it completes the whole line,
      //  which reaches further than one variable name.
      const fromHistory = historyGhost(history, readline.line);
      if (fromHistory) return fromHistory;
      const ghost = variableGhost();
      if (ghost) return ghost;
      const match = fileIndex.first(context.prefix, state);
      return match ? match.slice(context.prefix.length) : null;
    };
    const clearGhost = () => {
      if (!ghostWidth) return;
      process.stdout.write("\x1b[0K");
      ghostWidth = 0;
    };
    const visibleGhost = (ghost) => {
      const columns = process.stdout.columns ?? 80;
      const cursor = readline.getCursorPos?.();
      const available = Math.max(0, columns - (cursor?.cols ?? 0) - 1);
      return fitGhost(ghost, available);
    };
    const renderGhost = () => {
      renderTask = null;
      clearGhost();
      const ghost = currentGhost();
      if (!ghost) return;
      const visible = visibleGhost(ghost);
      ghostWidth = visible.width;
      if (!ghostWidth) return;
      process.stdout.write(`\x1b[2m${visible.output}\x1b[0m`);
      if (ghostWidth) process.stdout.write(`\x1b[${ghostWidth}D`);
    };
    const beforeKey = () => {
      startedAtEnd = readline.cursor === readline.line.length;
      clearGhost();
    };
    const afterKey = (_text, key = {}) => {
      if (key.name === "right" && startedAtEnd) {
        const ghost = currentGhost();
        if (ghost) readline.write(ghost);
      }
      if (renderTask !== null) clearTimeout(renderTask);
      renderTask = setTimeout(renderGhost, 0);
    };
    filteredInput.prependListener("keypress", beforeKey);
    filteredInput.on("keypress", afterKey);
    removeGhostHooks = () => {
      if (renderTask !== null) clearTimeout(renderTask);
      clearGhost();
      filteredInput.off("keypress", beforeKey);
      filteredInput.off("keypress", afterKey);
    };
  }
  // A here-document, an open quote/substitution, or an unfinished if/while/
  // for/case body all need more lines before they can run. `pending` holds
  // what has been typed so far across such a continuation, and mksh's PS2
  // prompt (default "> ") is shown instead of the normal prompt while it is
  // non-empty.
  let pending = "";
  try {
    while (!state.exitRequested) {
      const continuing = pending !== "";
      const rendered = continuing
        ? { text: state.env.PS2 ?? "> ", regions: [], newTabRegion: [],
            inputStart: { row: 0, column: Bun.stringWidth(state.env.PS2 ?? "> ") } }
        : renderPrompt(state, true);
      promptRegions = rendered.regions;
      newTabRegion = rendered.newTabRegion;
      inputStart = rendered.inputStart;
      readline.setPrompt(rendered.text);
      promptAbort = new AbortController();
      let line;
      try {
        line = await Promise.race([
          readline.question(rendered.text, { signal: promptAbort.signal }),
          closed,
        ]);
      } catch (error) {
        if (error?.name !== "AbortError") throw error;
        // onPaste aborts the same way Ctrl-C's interrupt() does, but leaves
        // pastedLine set first. Falling through to the normal resolution
        // path below with that as `line` runs it through the exact same
        // pending/needsMoreInput/execute handling a typed-and-Entered line
        // gets -- Ctrl-C itself never sets pastedLine, so that case is
        // unaffected: pending is cleared and the loop just reprompts.
        if (pastedLine === null) { pending = ""; continue; }
        line = pastedLine;
        pastedLine = null;
      } finally {
        promptAbort = null;
      }
      if (line === null && !continuing) break;
      // Ctrl-D on an empty line closes readline itself, whether that empty
      // line was the primary prompt (handled above) or a PS2 continuation
      // line. In the latter case the interface is now gone, but the
      // terminal is still there, so this is recoverable: run whatever was
      // typed so far — mksh does the same for a here-document ended this
      // way — and rebuild a fresh interface afterward instead of exiting.
      const eof = line === null;
      if (!eof) {
        // Stdin is still open: fold the new line in and, if the command is
        // still unterminated, loop back for another one under the PS2
        // prompt instead of running it.
        pending = continuing ? `${pending}\n${line}` : line;
        if (needsMoreInput(pending)) continue;
      }
      line = pending;
      pending = "";
      if (line && history.at(-1) !== line) history.push(line);
      // readline must not keep reading from the terminal while a foreground
      // program owns it.  Otherwise both processes race for input and the
      // first key (notably Ctrl-Q in full-screen editors) can be consumed by
      // the shell.  Also give the child a sane terminal mode to start from.
      // A closed-by-EOF readline can't be paused (or later resumed).
      if (!eof) {
        readline.pause();
        setReadlineResizeEnabled(false);
      }
      if (terminal) {
        if (mouseTracking) process.stdout.write(MOUSE_OFF);
        process.stdout.write(PASTE_OFF);
        process.stdin.unpipe(filteredInput);
      }
      if (terminal) process.stdin.setRawMode(false);
      foregroundCommand = true;
      let endSession = false;
      try {
        if (line) await execute(line, state);
      } finally {
        foregroundCommand = false;
        if (!state.exitRequested) {
          if (terminal) process.stdin.setRawMode(true);
          if (terminal) {
            process.stdin.pipe(filteredInput);
            // External commands stream directly to the terminal, so their
            // final byte cannot be inferred from an execution result. Ask the
            // terminal where the cursor is and terminate an unfinished line
            // before readline paints a multi-line prompt over it.
            const cursor = await queryCursor();
            if (cursor && cursor.column > 1) process.stdout.write("↩️\n");
            mouseTracking = Boolean(state.mouseTracking);
            if (mouseTracking) process.stdout.write(MOUSE_ON);
            process.stdout.write(PASTE_ON);
          }
          if (eof) {
            if (terminal) setupReadline();
            else endSession = true;
          } else {
            setReadlineResizeEnabled(true);
            readline.resume();
          }
        } else if (eof) {
          endSession = true;
        }
      }
      if (endSession) break;
    }
  } finally {
    if (terminal) {
      if (mouseTracking) process.stdout.write(MOUSE_OFF);
      process.stdout.write(PASTE_OFF);
      process.stdin.unpipe(filteredInput);
    }
    clearInterval(historySaveTimer);
    // Catches whatever the last autosave (up to 60s ago) missed, so a normal
    // exit never loses the tail of the session's history.
    await saveBunmshHistory(state, state.env).catch(() => {});
    if (refreshTimer !== null) clearInterval(refreshTimer);
    removeGhostHooks();
    readline.off("SIGINT", interrupt);
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    process.off("SIGHUP", terminate);
    readline.close();
  }
  return state.exitRequested ? state.exitStatus : state.lastStatus;
}

async function main(argv) {
  if (argv[0] === "--bun-shell-fallback")
    return executeBunShellFallback(argv.slice(1));
  let command = null;
  let forwardedArgv = null;
  let forceInteractive = false;
  let forceMouse = false;
  let builtinOnly = false;
  let i = 0;
  for (; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      i++;
      break;
    }
    if (arg === "-c") {
      if (i + 1 >= argv.length) {
        console.error("bunmsh: -c requires an argument");
        return 2;
      }
      command = argv[++i];
      i++;
      break;
    }
    if (arg === "-cc") {
      forwardedArgv = argv.slice(i + 1);
      i = argv.length;
      break;
    }
    if (arg === "-i") {
      forceInteractive = true;
      continue;
    }
    if (arg === "--mouse") {
      forceMouse = true;
      continue;
    }
    if (arg === "--builtin-only") {
      builtinOnly = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      usage();
      return 0;
    }
    if (arg === "-V" || arg === "--version") {
      console.log(VERSION);
      return 0;
    }
    if (arg === "--readme") {
      await printReadme();
      return 0;
    }
    if (arg === "--changelog") {
      await printChangelog();
      return 0;
    }
    if (arg.startsWith("-")) {
      console.error(`bunmsh: ${arg}: unknown option`);
      return 2;
    }
    break;
  }

  if (forwardedArgv !== null) {
    if (forwardedArgv.length === 0) {
      console.error("bunmsh: -cc requires a command");
      return 2;
    }
    const state = pipelineChildState();
    if (forceMouse) state.mouseTracking = true;
    if (builtinOnly) state.pathSearch = false;
    const result = await executeArgv(forwardedArgv, state);
    return state.exitRequested ? state.exitStatus : result.status;
  }

  if (command !== null) {
    const name = argv[i] ?? "bunmsh";
    const state = createState({
      args: [name, ...argv.slice(i + 1)],
      mouseTracking: forceMouse || undefined,
      pathSearch: builtinOnly ? false : undefined,
    });
    const result = await execute(command, state);
    return state.exitRequested ? state.exitStatus : result.status;
  }

  if (i < argv.length) {
    const script = argv[i];
    try {
      const source = await Bun.file(script).text();
      const state = createState({
        args: [script, ...argv.slice(i + 1)],
        mouseTracking: forceMouse || undefined,
        pathSearch: builtinOnly ? false : undefined,
      });
      const result = await execute(source, state);
      if (forceInteractive && !state.exitRequested) return interactive(state);
      return state.exitRequested ? state.exitStatus : result.status;
    } catch (error) {
      console.error(`bunmsh: ${script}: ${error.message}`);
      return 1;
    }
  }

  const state = createState({
    mouseTracking: forceMouse || undefined,
    pathSearch: builtinOnly ? false : undefined,
  });
  if (forceInteractive || process.stdin.isTTY) return interactive(state);
  const source = await Bun.stdin.text();
  const result = await execute(source, state);
  return state.exitRequested ? state.exitStatus : result.status;
}

// Lets --define process.env.SERVE_AUTO_OPEN=/index.html, =off, or =yes
// arrive unquoted from a shell: string-shaped values that aren't already a
// valid bare literal (number/boolean/null/undefined, e.g. =1) get quoted
// here, so `bun ./src/main.js --build-exe --define process.env.SERVE_AUTO_OPEN=/index.html`
// works without the caller hand-quoting the value themselves.
stringifyNonPrimitiveDefineValues(process.argv, "process.env.SERVE_AUTO_OPEN");
stringifyNonPrimitiveDefineValues(process.argv, "process.env.SERVE_MINAPK_WEBVIEW");
stringifyNonPrimitiveDefineValues(process.argv, "process.env.SERVE_RANDOM_URL");
await buildEarlyExit(process.argv, "bmsh");
process.exitCode = await main(process.argv.slice(2));
// By this point every await in main() (including interactive()'s own
// cleanup and every writeStream() call for command output) has already
// finished, so there is no legitimate reason left for the process to stay
// alive. Force the exit rather than letting the event loop decide: a killed
// pipeline stage (see runExternal's stopUpstream handling) can leave behind
// a stream operation Bun never lets finish or be canceled, which otherwise
// hangs the shell forever even though the pipeline itself already produced
// its result correctly.
process.exit(process.exitCode);
