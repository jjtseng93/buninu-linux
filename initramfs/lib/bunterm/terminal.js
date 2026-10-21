import {bgraParser} from './raw-protocol.js';
// /lib/bunterm/terminal.js — a graphical terminal on the Linux framebuffer.
//
//   Bun.spawn({ terminal })  ──── PTY output ────▶ KittyGraphicsParser
//      ▲                                            │ plain     │ APC
//      │ keyboard / replies                         ▼           ▼
//   jsgotty BunPtyBackend        @xterm/headless Terminal   ImageStore
//                                              │ buffer        │ placements
//                                              ▼               ▼
//                                   Renderer (CanvasKit) ──▶ /dev/fb0
//
// The PTY, the terminal emulation and the kitty packet parser are reused
// from jsgotty and xterm.js; only the cell renderer, the images and the
// keyboard are Buninu's own.

import { createRequire } from "node:module";
import { runGraphics, activeConsole } from "../fbdev.js";
import { loadCanvasKit, openCanvas, loadFontSet } from "../canvas.js";
import { Terminal } from "../xterm/xterm-headless.mjs";
import { UnicodeGraphemesAddon } from "../xterm/addon-unicode-graphemes.mjs";
import { Renderer, defaultTheme } from "./renderer.js";
import { ImageStore } from "./images.js";
import { openKeyboard, translateKeys } from "./input.js";
import { claimVirtualConsole, listVirtualTerminals } from "./vt.js";
import { createFpsMeter } from "./fps.js";
import { createVtMenu } from "./vt-menu.js";
import { attachGeometry } from "./geometry.js";
import { terminalMouseEvent } from "./pointer-report.js";
import { attachClipboard, readClipboard, writeClipboard, pasteText } from "./clipboard.js";
import { createSelection } from "./selection.js";
import { createCommands } from "./commands.js";
import { attachKeyboard as createKeyboard } from "./keyboard.js";

const require = createRequire(import.meta.url);

// jsgotty is CommonJS and guards its server start on require.main, so this
// only loads the classes.
export const loadJsgotty = () => {
  const gotty = require("../../buninu/apps/jsgotty/gotty.js");
  if (!gotty.BunPtyBackend) {
    throw new Error("this jsgotty does not export BunPtyBackend; bunterm needs jsgotty ≥ 1.1.12");
  }
  return gotty;
};

const writeTerminal = (term, data) => new Promise((resolve) => term.write(data, resolve));

// One terminal session: a program on a PTY, the emulator fed from it, and a
// renderer painting onto `screen` (an open canvas from canvas.js). Frames
// are coalesced, so whatever arrives between two paints is drawn together,
// at most ~60 times a second. `exited` resolves with the program's status.
export const createSession = ({
  CanvasKit,
  screen,
  fonts,
  command = "/bin/sh",
  argv = [],
  fontSize = 13,
  lineHeight = 1,
  theme = defaultTheme,
  scrollback = 1000,
  cursorBlink = true,
  mouse = true,
  clipboard = true,
  env = {},
  vtMenu = null,
  onError = (error) => console.error(`bunterm: ${error?.stack ?? error}`),
}) => {
  const { BunPtyBackend, KittyGraphicsParser } = loadJsgotty();
  const renderer = new Renderer({ CanvasKit, screen, fonts, fontSize, lineHeight, theme });
  const term = new Terminal({
    cols: renderer.columns,
    rows: renderer.rows,
    allowProposedApi: true,
    scrollback,
  });
  term.loadAddon(new UnicodeGraphemesAddon());
  term.unicode.activeVersion = "15-graphemes";
  const images = new ImageStore({ CanvasKit, term, renderer });
  const kitty = new (bgraParser(KittyGraphicsParser,screen.display))({ binaryData: true });

  const backend = new BunPtyBackend({
    command,
    argv,
    width: renderer.columns,
    height: renderer.rows,
    closeSignal: "SIGHUP",
    closeTimeout: -1,
    // JSMDCUI_KITTY_MODE=extended: jsmdcui sends Markdown images as kitty
    // placements with the original JPEG/WebP/GIF bytes (jsgotty's U= MIME
    // extension); Skia decodes those directly, so nothing is transcoded.
    headerEnv: { COLORTERM: "truecolor", TERM_PROGRAM: "bunterm", JSMDCUI_KITTY_MODE: "extended", ...env },
  });

  let frameTimer = null;
  let active = true;
  let blinkOn = true;
  const cursorHidden = () => Boolean(term._core?.coreService?.isCursorHidden);
  // Only set when a pointer is attached; without one the renderer is called
  // exactly as before.
  let pointer = null;
  let menu = null;
  const fps = createFpsMeter();
  let fpsTimer = null;
  let keyboardProtocol = null;
  let consoleKeyboard = null;
  const paint = () => {
    if (frameTimer) clearTimeout(frameTimer);
    frameTimer = null;
    if (!active) return false;
    const buffer = term.buffer.active;
    // cursorY counts from the buffer's base, so a scrolled-back viewport
    // moves the cursor down the screen and eventually off it.
    const row = buffer.baseY + buffer.cursorY - buffer.viewportY;
    if (menu?.visible || selection.active) renderer.invalidate();
    const visibleImages = images.visible();
    const rendered = renderer.render(term, {
      cursor: {
        x: buffer.cursorX,
        y: row,
        visible: blinkOn && !cursorHidden() && row >= 0 && row < renderer.rows,
      },
      images: visibleImages,
      pointer,
      overlay: () => { selection.draw(); fps.draw(renderer); if (menu?.visible) menu.draw(renderer); },
    });
    if (rendered && fps.enabled) fps.presented(visibleImages);
    return rendered;
  };
  const requestFrame = () => {
    if (!active) return;
    frameTimer ??= setTimeout(paint, 16);
  };
  const changed = () => { renderer.invalidate(); requestFrame(); };
  const selection = createSelection(term, renderer, changed);
  const setFontSize = size => {
    renderer.setFontSize(size);
    selection.clear();
    term.resize(renderer.columns, renderer.rows);
    backend.resize(renderer.columns, renderer.rows);
    changed();
  };
  const copy = async () => {
    if (!clipboard) throw new Error("Clipboard disabled (--no-clipboard)");
    if (!selection.active) throw new Error("Drag to select text first (application mouse reporting must be off)");
    await writeClipboard(selection.text());
  };
  const paste = async () => {
    if (!clipboard) throw new Error("Clipboard disabled (--no-clipboard)");
    const text = await readClipboard();
    if (closed) return;
    pasteText(term, text, value => backend.write(Buffer.from(value, "utf8")));
    menu?.close();
    term.scrollToBottom();
    changed();
  };
  const toggleFps = () => {
    if (fpsTimer) clearInterval(fpsTimer);
    fpsTimer = null;
    if (fps.toggle(images.visible())) fpsTimer = setInterval(() => {
      fps.sample();
      if (active) { renderer.invalidateRows(0,1); requestFrame(); }
    },1000);
    renderer.invalidateRows(0,1); requestFrame();
  };
  const commands = createCommands({fontSize:()=>renderer.fontSize,setFontSize,copy,paste,
    switchVT: number => vtMenu?.select(number)});
  if (vtMenu) menu = createVtMenu({
    ...vtMenu, width: screen.width, height: screen.height, rowHeight: renderer.cellHeight,
    changed,
    controls: {fpsEnabled:()=>fps.enabled,toggleFps,fontSize:()=>renderer.fontSize,cellHeight:()=>renderer.cellHeight,execute:line=>commands.execute(line)},
  });
  const suspend = () => {
    keyboardProtocol?.blur();
    selection.stop();
    active = false;
    menu?.close();
    if (frameTimer) clearTimeout(frameTimer);
    frameTimer = null;
  };
  const resume = () => {
    if (active) return;
    active = true;
    consoleKeyboard?.clearHeld();
    renderer.invalidate();
    paint();
  };
  const blinkTimer = cursorBlink
    ? setInterval(() => { blinkOn = !blinkOn; requestFrame(); }, 500)
    : null;
  const resetBlink = () => {
    blinkOn = true;
    if (blinkTimer) blinkTimer.refresh();
  };

  // Output is processed in order: plain text is parsed before the kitty
  // packet that follows it, so placements see the right cursor position.
  let queue = Promise.resolve();
  const pump = (chunk) => {
    queue = queue.then(async () => {
      const { events } = kitty.consume(chunk);
      for (const event of events) {
        if (event.kind === "plain") {
          // A selection is a snapshot of the displayed cells. Drop it before
          // output scrolls/replaces those cells, rather than copying stale rows.
          selection.clear();
          await writeTerminal(term, event.data);
          continue;
        }
        const buffer = term.buffer.active;
        const graphic = kitty.parsePacket(event.packet, { row: buffer.cursorY + 1, col: buffer.cursorX + 1 });
        if (!graphic) continue;
        const motion = await images.handle(graphic);
        if (motion) await writeTerminal(term, motion);
        const ack = kitty.acknowledge(graphic);
        if (ack) backend.write(Buffer.from(ack, "utf8"));
      }
      requestFrame();
    }).catch(onError);
  };

  let closed = false;
  const exited = new Promise((resolve) => {
    backend.onExit(() => { queue.then(() => resolve(backend.proc?.exitCode ?? 0)); });
  });
  backend.onData(pump);
  term.onData((data) => backend.write(Buffer.from(data, "utf8")));
  attachGeometry({ term, renderer, reply: text => backend.write(Buffer.from(text, "utf8")) });
  // OSC 52 copy and paste go straight to xclip; replies return to the program.
  // Without it (--no-clipboard) xterm.js ignores OSC 52 and nothing reaches xclip.
  if (clipboard) attachClipboard({ term, reply: (text) => backend.write(Buffer.from(text, "utf8")), onError });

  // Keyboard bytes from the console, rewritten for the program's key mode.
  const input = (bytes) => {
    if (!active) return;
    if (menu?.input(bytes)) return;
    const applicationCursorKeys = Boolean(term._core?.coreService?.decPrivateModes?.applicationCursorKeys);
    const text = translateKeys(bytes.toString("latin1"), { applicationCursorKeys });
    backend.write(Buffer.from(text, "latin1"));
    // Typing returns to the live screen, as every terminal does.
    if (term.buffer.active.viewportY !== term.buffer.active.baseY) {
      term.scrollToBottom();
      renderer.invalidate();
    }
    resetBlink();
    requestFrame();
  };
  const attachKeyboard = device => {
    consoleKeyboard = device;
    keyboardProtocol = createKeyboard({
      term,
      setEnhanced: value => device.setEnhanced(value),
      write: text => {
        backend.write(Buffer.from(text,"utf8"));
        term.scrollToBottom(); resetBlink(); changed();
      },
      localInput: (event, text) => {
        if (!menu?.visible) return false;
        if (text) menu.input(Buffer.from(text,"utf8"));
        return true;
      },
      switchVT: number => { Promise.resolve(vtMenu?.select(number)).catch(onError); },
      switchRelative: delta => {
        try {
          const number = Math.max(1,Math.min(63,activeConsole({fd:device.fd})+delta));
          Promise.resolve(vtMenu?.select(number)).catch(onError);
        } catch (error) { onError(error); }
      },
      onError,
    });
  };
  const keyEvent = event => { if (active) keyboardProtocol?.event(event); };

  // Turns a pointer report from mouse.js into the mouse sequences the
  // program asked for. xterm.js's CoreMouseService owns the protocol: it
  // knows which events the program enabled (DECSET 1000/1002/1003), encodes
  // them (SGR 1006, pixel 1016, or the default form) and sends them through onData, so
  // nothing here builds an escape sequence. Reports arrive only while a
  // pointer is open, and this is the only place the terminal sees one.
  const CoreMouseButton = { LEFT: 0, MIDDLE: 1, RIGHT: 2, NONE: 3, WHEEL: 4 };
  const CoreMouseAction = { UP: 0, DOWN: 1, LEFT: 2, RIGHT: 3, MOVE: 32 };
  const heldButton = (buttons) => (buttons.left ? CoreMouseButton.LEFT
    : buttons.middle ? CoreMouseButton.MIDDLE
    : buttons.right ? CoreMouseButton.RIGHT
    : CoreMouseButton.NONE);

  // Scrolls the viewport when the program is not reading the mouse itself:
  // through the scrollback on the normal screen, and as arrow keys on the
  // alternate screen, which has no scrollback and is what a pager expects.
  const wheelScroll = (notches) => {
    const lines = notches * 3;
    if (term.buffer.active.type === "alternate") {
      const application = Boolean(term._core?.coreService?.decPrivateModes?.applicationCursorKeys);
      const key = `\u001b${application ? "O" : "["}${lines > 0 ? "A" : "B"}`;
      backend.write(Buffer.from(key.repeat(Math.abs(lines)), "latin1"));
      return;
    }
    const before = term.buffer.active.viewportY;
    term.scrollLines(-lines);
    if (term.buffer.active.viewportY !== before) {
      // Every row on screen is different now, and identical text at the same
      // row would otherwise hash the same as before.
      renderer.invalidate();
      requestFrame();
    }
  };

  const reportMouse = (report) => {
    // /dev/input is global rather than routed through the active VT.  Do not
    // draw or send mouse input to a terminal whose console is off-screen.
    if (!active) return;
    pointer = { x: report.x, y: report.y };
    requestFrame();
    if (menu?.pointer(report)) {
      selection.stop();
      keyboardProtocol?.blur();
      return;
    }
    const service = term._core?.coreMouseService;
    if (!service?.areMouseEventsActive) {
      if (report.wheel) wheelScroll(report.wheel);
      selection.pointer(report);
      return;
    }
    selection.clear();
    const send = (button, action) => {
      try {
        service.triggerMouseEvent(terminalMouseEvent(report, renderer, button, action));
      } catch (error) {
        onError(error);
      }
    };
    for (const name of report.released) {
      send(CoreMouseButton[name.toUpperCase()], CoreMouseAction.UP);
    }
    for (const name of report.pressed) {
      send(CoreMouseButton[name.toUpperCase()], CoreMouseAction.DOWN);
    }
    if (report.moved) send(heldButton(report.buttons), CoreMouseAction.MOVE);
    for (let notch = 0; notch < Math.abs(report.wheel); notch++) {
      send(CoreMouseButton.WHEEL, report.wheel > 0 ? CoreMouseAction.UP : CoreMouseAction.DOWN);
    }
    for (let notch = 0; notch < Math.abs(report.hwheel); notch++) {
      send(CoreMouseButton.WHEEL, report.hwheel > 0 ? CoreMouseAction.RIGHT : CoreMouseAction.LEFT);
    }
  };

  // The pointer is opened only when asked for, by a module that is imported
  // only then, so a machine without one — or a broken input layer — cannot
  // affect a plain session.
  let pointerDevice = null;
  const attachPointer = async () => {
    if (!mouse) return null;
    const { openPointer, findPointers } = await import("./mouse.js");
    const devices = findPointers();
    if (!devices.length) throw new Error("no pointing device in /dev/input (is the evdev module loaded?)");
    pointerDevice = openPointer({
      devices,
      width: screen.width,
      height: screen.height,
      onSync: reportMouse,
      onError,
    });
    pointer = { x: pointerDevice.state.x, y: pointerDevice.state.y };
    paint();
    return pointerDevice;
  };

  // Waits until every byte received so far has been parsed, then paints.
  const settle = async () => {
    await queue;
    return paint();
  };

  const close = () => {
    if (closed) return;
    closed = true;
    active = false;
    if (blinkTimer) clearInterval(blinkTimer);
    if (fpsTimer) clearInterval(fpsTimer);
    fpsTimer = null;
    if (frameTimer) clearTimeout(frameTimer);
    frameTimer = null;
    backend.close();
    try { keyboardProtocol?.dispose(); } catch (error) { onError(error); }
    keyboardProtocol = null;
    pointerDevice?.close();
    pointerDevice = null;
    images.delete();
    renderer.delete();
    term.dispose();
  };

  paint();
  return {
    term, backend, renderer, images, kitty,
    paint, requestFrame, suspend, resume, settle, input, exited, close, attachPointer, reportMouse, wheelScroll,
    attachKeyboard, keyEvent, selection, setFontSize, commands,
  };
};

// Runs a session on the framebuffer with the console in graphics mode and
// the keyboard in raw mode, until the program exits. `console` names the
// virtual console to use (for example /dev/tty1); by default the process's
// own console and stdin are used.
export const runTerminal = async ({ console: consoleDevice = null, device = "/dev/fb0", ...options } = {}) => {
  loadJsgotty();
  const CanvasKit = await loadCanvasKit();
  const fonts = loadFontSet(CanvasKit, "terminal");
  const consolePaths = consoleDevice ? [consoleDevice] : undefined;

  return runGraphics(async (display, { onRestore, onRelease, onAcquire }) => {
    const screen = openCanvas(CanvasKit, display);
    let switching = false;
    let keyboard = null;
    const session = createSession({ CanvasKit, screen, fonts, ...options, vtMenu: {
      list: () => {
        const current = keyboard ? activeConsole(keyboard) : null;
        return listVirtualTerminals().map(entry => ({...entry,current:entry.number===current}));
      },
      create: async fontSize => {
        // Re-scan at activation, since another session may have opened while
        // the menu was visible. The launcher detaches onto the new console;
        // its normal VT ownership checks still apply.
        const number = Math.max(1, ...listVirtualTerminals().map(entry => entry.number)) + 1;
        if (number > 63) throw new Error("沒有可用 tty / No next tty available");
        const child = Bun.spawn([process.execPath, `${import.meta.dir}/../../bin/bunterm`,
          String(number), "-s", String(fontSize), "--fb", device],
          { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
        const [status, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
        if (status !== 0) throw new Error(error.trim() || "無法啟動 / Failed to start bunterm");
      },
      select: async number => {
        if (switching) return;
        switching = true;
        try {
          // Waiting in this process would block its VT_PROCESS signal handlers.
          const child = Bun.spawn([process.execPath, `${import.meta.dir}/../../bin/chvt`, String(number)],
            { stdin: "ignore", stdout: "ignore", stderr: "pipe" });
          const [status, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
          if (status !== 0) console.error(`bunterm: ${error.trim() || "VT switch failed"}`);
        } catch (error) { console.error(`bunterm: VT switch: ${error.message}`); }
        finally { switching = false; }
      },
    } });
    onRelease(session.suspend);
    // Coming back from another console (Ctrl-Alt-Fn): fbcon or another
    // bunterm has drawn over the framebuffer, so repaint everything.
    onAcquire(session.resume);
    try {
      keyboard = openKeyboard({
        device: consoleDevice,
        onData: session.input,
        onKey: session.keyEvent,
        onError: (error) => {
          console.error(`bunterm: keyboard: ${error.message}`);
          session.backend.close();
        },
      });
      session.attachKeyboard(keyboard);
      onRestore(() => keyboard.close());
      if (options.mouse !== false) {
        // A pointer that cannot be opened is reported and the session
        // continues as a keyboard-only terminal.
        try {
          const attached = await session.attachPointer();
          if (attached?.devices.length) {
            console.error(`bunterm: mouse: ${attached.devices.map((device) => device.name).join(", ")}`);
          }
        } catch (error) {
          console.error(`bunterm: mouse: ${error.message}`);
        }
      }
      return await session.exited;
    } finally {
      try { session.close(); }
      finally {
        try { keyboard?.close(); } finally { screen.close(); }
      }
    }
  }, { device, console: consolePaths, prepareConsole: claimVirtualConsole });
};
