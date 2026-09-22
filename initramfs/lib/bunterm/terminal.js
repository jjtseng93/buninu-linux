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
import { runGraphics } from "../fbdev.js";
import { loadCanvasKit, openCanvas, loadFontSet } from "../canvas.js";
import { Terminal } from "../xterm/xterm-headless.mjs";
import { UnicodeGraphemesAddon } from "../xterm/addon-unicode-graphemes.mjs";
import { Renderer, defaultTheme } from "./renderer.js";
import { ImageStore } from "./images.js";
import { openKeyboard, translateKeys } from "./input.js";

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
  fontSize = 16,
  lineHeight = 1,
  theme = defaultTheme,
  scrollback = 1000,
  cursorBlink = true,
  env = {},
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
  const kitty = new KittyGraphicsParser();

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
  let blinkOn = true;
  const cursorHidden = () => Boolean(term._core?.coreService?.isCursorHidden);
  const paint = () => {
    if (frameTimer) clearTimeout(frameTimer);
    frameTimer = null;
    const buffer = term.buffer.active;
    return renderer.render(term, {
      cursor: { x: buffer.cursorX, y: buffer.cursorY, visible: blinkOn && !cursorHidden() },
      images: images.visible(),
    });
  };
  const requestFrame = () => {
    frameTimer ??= setTimeout(paint, 16);
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

  // Keyboard bytes from the console, rewritten for the program's key mode.
  const input = (bytes) => {
    const applicationCursorKeys = Boolean(term._core?.coreService?.decPrivateModes?.applicationCursorKeys);
    const text = translateKeys(bytes.toString("latin1"), { applicationCursorKeys });
    backend.write(Buffer.from(text, "latin1"));
    resetBlink();
    requestFrame();
  };

  // Waits until every byte received so far has been parsed, then paints.
  const settle = async () => {
    await queue;
    return paint();
  };

  const close = () => {
    if (closed) return;
    closed = true;
    if (blinkTimer) clearInterval(blinkTimer);
    if (frameTimer) clearTimeout(frameTimer);
    frameTimer = null;
    backend.close();
    images.delete();
    renderer.delete();
    term.dispose();
  };

  paint();
  return { term, backend, renderer, images, kitty, paint, requestFrame, settle, input, exited, close };
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

  return runGraphics(async (display, { onRestore, onAcquire }) => {
    const screen = openCanvas(CanvasKit, display);
    const session = createSession({ CanvasKit, screen, fonts, ...options });
    // Coming back from another console (Ctrl-Alt-Fn): fbcon has drawn over
    // the framebuffer, so repaint everything.
    onAcquire(() => {
      session.renderer.invalidate();
      session.paint();
    });
    let keyboard = null;
    try {
      keyboard = openKeyboard({
        device: consoleDevice,
        onData: session.input,
        onError: (error) => {
          console.error(`bunterm: keyboard: ${error.message}`);
          session.backend.close();
        },
      });
      onRestore(() => keyboard.close());
      return await session.exited;
    } finally {
      keyboard?.close();
      session.close();
      screen.close();
    }
  }, { device, console: consolePaths });
};
