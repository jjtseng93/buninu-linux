#!/bin/bun
// /lib/fbdev.js — small Linux framebuffer drawing API and executable demo.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { libc, cString, ptr, errno, strerror, toArrayBuffer } from "./dlopen.js";
import { showDocument } from "./document.js";

const O_RDWR = 2;
const FBIOGET_VSCREENINFO = 0x4600;
const FBIOGET_FSCREENINFO = 0x4602;
const FB_TYPE_PACKED_PIXELS = 0;
const KDSETMODE = 0x4b3a;
const KD_TEXT = 0;
const KD_GRAPHICS = 1;
const VT_SETMODE = 0x5602;
const VT_GETSTATE = 0x5603;
const VT_RELDISP = 0x5605;
const VT_ACTIVATE = 0x5606;
const VT_WAITACTIVE = 0x5607;
const VT_AUTO = 0;
const VT_PROCESS = 1;
const VT_ACKACQ = 2;
const SIGUSR1 = 10;
const SIGUSR2 = 12;
const PROT_READ = 1;
const PROT_WRITE = 2;
const MAP_SHARED = 1;
const MS_SYNC = 4;
const MAP_FAILED = 0xffffffffffffffffn;

const fail = (operation) => {
  const code = errno();
  throw new Error(`${operation}: ${strerror(code)}`);
};

const openDevice = (path) => {
  const fd = libc.symbols.open(cString(path), O_RDWR, 0);
  if (fd === -1) fail(`open(${path})`);
  return fd;
};

const ioctlBuffer = (fd, request, buffer, operation) => {
  if (libc.symbols.ioctl(fd, request, ptr(buffer)) === -1) fail(operation);
};

const ioctlValue = (fd, request, value, operation) => {
  if (libc.symbols.ioctl(fd, request, value) === -1) fail(operation);
};

const u32 = (view, offset) => view.getUint32(offset, true);

const bitfield = (view, offset) => ({
  offset: u32(view, offset),
  length: u32(view, offset + 4),
  msbRight: u32(view, offset + 8),
});

const channelBits = (value, field) => {
  if (!field.length) return 0;
  const maximum = 2 ** field.length - 1;
  const scaled = Math.round(Math.max(0, Math.min(255, value)) * maximum / 255);
  return scaled * 2 ** field.offset;
};

const encodePixel = (color, fields) => {
  const r = Number(color?.r ?? 255);
  const g = Number(color?.g ?? 255);
  const b = Number(color?.b ?? 255);
  const a = Number(color?.a ?? 255);
  return channelBits(r, fields.red)
    + channelBits(g, fields.green)
    + channelBits(b, fields.blue)
    + channelBits(a, fields.transp);
};

const point = (value) => {
  if (Array.isArray(value)) return { x: Number(value[0]), y: Number(value[1]) };
  return { x: Number(value?.x), y: Number(value?.y) };
};

export const normalizePoints = (values) => {
  if (!Array.isArray(values)) return [];
  if (values.every((value) => typeof value === "number")) {
    const evenLength = values.length - values.length % 2;
    const output = [];
    for (let index = 0; index < evenLength; index += 2) {
      output.push({ x: values[index], y: values[index + 1] });
    }
    return output.filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y));
  }
  return values.map(point)
    .filter(({ x, y }) => Number.isFinite(x) && Number.isFinite(y));
};

export const parsePoints = (values) => {
  const numbers = values.flatMap((value) => String(value).split(/[\s,]+/u))
    .filter(Boolean)
    .map((value) => {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error(`invalid coordinate: ${value}`);
      return number;
    });
  return normalizePoints(numbers);
};

export class Framebuffer {
  constructor(path = "/dev/fb0") {
    this.path = path;
    this.fd = openDevice(path);
    try {
      const variable = new Uint8Array(160);
      const fixed = new Uint8Array(80);
      ioctlBuffer(this.fd, FBIOGET_VSCREENINFO, variable, "FBIOGET_VSCREENINFO");
      ioctlBuffer(this.fd, FBIOGET_FSCREENINFO, fixed, "FBIOGET_FSCREENINFO");
      const variableView = new DataView(variable.buffer);
      const fixedView = new DataView(fixed.buffer);

      this.width = u32(variableView, 0);
      this.height = u32(variableView, 4);
      this.virtualWidth = u32(variableView, 8);
      this.virtualHeight = u32(variableView, 12);
      this.xOffset = u32(variableView, 16);
      this.yOffset = u32(variableView, 20);
      this.bitsPerPixel = u32(variableView, 24);
      this.bytesPerPixel = Math.ceil(this.bitsPerPixel / 8);
      this.memoryLength = u32(fixedView, 24);
      this.type = u32(fixedView, 28);
      this.stride = u32(fixedView, 48)
        || Math.ceil(this.virtualWidth * this.bitsPerPixel / 8);
      this.fields = {
        red: bitfield(variableView, 32),
        green: bitfield(variableView, 44),
        blue: bitfield(variableView, 56),
        transp: bitfield(variableView, 68),
      };

      if (this.type !== FB_TYPE_PACKED_PIXELS) {
        throw new Error(`unsupported framebuffer type ${this.type}; packed pixels required`);
      }
      if (![16, 24, 32].includes(this.bitsPerPixel)) {
        throw new Error(`unsupported framebuffer depth ${this.bitsPerPixel} bpp`);
      }
      if (!this.width || !this.height || !this.stride) {
        throw new Error("framebuffer reports an empty display");
      }
      const minimumLength = this.stride * (this.yOffset + this.height);
      if (this.memoryLength < minimumLength) {
        throw new Error(`framebuffer memory is ${this.memoryLength} bytes; ${minimumLength} required`);
      }
      this.pixels = new Uint8Array(this.stride * this.height);
      this.address = libc.symbols.mmap(
        null,
        this.memoryLength,
        PROT_READ | PROT_WRITE,
        MAP_SHARED,
        this.fd,
        0,
      );
      if (this.address === null || this.address === 0 || this.address === 0n
          || this.address === MAP_FAILED) {
        fail(`mmap(${path})`);
      }
      this.memory = new Uint8Array(toArrayBuffer(this.address, 0, this.memoryLength));
    } catch (error) {
      if (this.address) libc.symbols.munmap(this.address, this.memoryLength);
      libc.symbols.close(this.fd);
      this.fd = -1;
      throw error;
    }
  }

  close() {
    if (this.fd < 0) return;
    if (this.address) {
      libc.symbols.munmap(this.address, this.memoryLength);
      this.address = null;
      this.memory = null;
    }
    libc.symbols.close(this.fd);
    this.fd = -1;
  }
}

export const drawPoint = (display, x, y, color = {}) => {
  x = Math.round(Number(x));
  y = Math.round(Number(y));
  if (x < 0 || y < 0 || x >= display.width || y >= display.height) return;
  let pixel = encodePixel(color, display.fields);
  const offset = y * display.stride + x * display.bytesPerPixel;
  for (let byte = 0; byte < display.bytesPerPixel; byte++) {
    display.pixels[offset + byte] = pixel % 256;
    pixel = Math.floor(pixel / 256);
  }
};

export const drawLine = (display, x1, y1, x2, y2, color = {}) => {
  x1 = Math.round(Number(x1));
  y1 = Math.round(Number(y1));
  x2 = Math.round(Number(x2));
  y2 = Math.round(Number(y2));
  const dx = Math.abs(x2 - x1);
  const sx = x1 < x2 ? 1 : -1;
  const dy = -Math.abs(y2 - y1);
  const sy = y1 < y2 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    drawPoint(display, x1, y1, color);
    if (x1 === x2 && y1 === y2) break;
    const twice = 2 * error;
    if (twice >= dy) { error += dy; x1 += sx; }
    if (twice <= dx) { error += dx; y1 += sy; }
  }
};

export const drawLines = (display, values, color = {}, close = false) => {
  const points = normalizePoints(values);
  for (let index = 1; index < points.length; index++) {
    drawLine(display, points[index - 1].x, points[index - 1].y,
      points[index].x, points[index].y, color);
  }
  if (close && points.length > 2) {
    drawLine(display, points.at(-1).x, points.at(-1).y,
      points[0].x, points[0].y, color);
  }
};

export const fillPolygon = (display, values, color = {}) => {
  const points = normalizePoints(values);
  if (points.length < 3) return;
  const minimumY = Math.max(0, Math.floor(Math.min(...points.map(({ y }) => y))));
  const maximumY = Math.min(display.height - 1,
    Math.ceil(Math.max(...points.map(({ y }) => y))));
  for (let y = minimumY; y <= maximumY; y++) {
    const scanY = y + 0.5;
    const intersections = [];
    for (let index = 0; index < points.length; index++) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      if ((a.y <= scanY && b.y > scanY) || (b.y <= scanY && a.y > scanY)) {
        intersections.push(a.x + (scanY - a.y) * (b.x - a.x) / (b.y - a.y));
      }
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const from = Math.max(0, Math.ceil(intersections[index]));
      const to = Math.min(display.width - 1, Math.floor(intersections[index + 1]));
      for (let x = from; x <= to; x++) drawPoint(display, x, y, color);
    }
  }
};

export const clear = (display, color = { r: 0, g: 0, b: 0, a: 255 }) => {
  if (!color.r && !color.g && !color.b && (color.a ?? 255) === 255
      && display.fields.transp.length === 0) {
    display.pixels.fill(0);
    return;
  }
  for (let y = 0; y < display.height; y++) {
    for (let x = 0; x < display.width; x++) drawPoint(display, x, y, color);
  }
};

export const flush = (display) => {
  const visibleBytes = display.width * display.bytesPerPixel;
  for (let y = 0; y < display.height; y++) {
    const row = display.pixels.subarray(y * display.stride, y * display.stride + visibleBytes);
    const position = (y + display.yOffset) * display.stride
      + display.xOffset * display.bytesPerPixel;
    display.memory.set(row, position);
  }
  if (libc.symbols.msync(display.address, display.memoryLength, MS_SYNC) === -1) {
    fail(`msync(${display.path})`);
  }
};

// Copies an RGBA ImageData (HTML canvas layout, 4 bytes per pixel, rows of
// `width` pixels) into the in-memory frame at (x, y), converting to the
// framebuffer's own pixel format and clipping at the edges.
export const blitImageData = (display, imageData, x = 0, y = 0) => {
  const { width, height, data } = imageData;
  x = Math.round(Number(x));
  y = Math.round(Number(y));
  const fromX = Math.max(0, -x);
  const fromY = Math.max(0, -y);
  const toX = Math.min(width, display.width - x);
  const toY = Math.min(height, display.height - y);
  const color = { r: 0, g: 0, b: 0, a: 255 };
  for (let row = fromY; row < toY; row++) {
    let source = (row * width + fromX) * 4;
    for (let column = fromX; column < toX; column++, source += 4) {
      color.r = data[source];
      color.g = data[source + 1];
      color.b = data[source + 2];
      color.a = data[source + 3];
      drawPoint(display, x + column, y + row, color);
    }
  }
};

export const openFramebuffer = (path) => new Framebuffer(path);

export const openConsole = (paths = ["/dev/tty", "/dev/console", "/dev/tty0"]) => {
  const failures = [];
  for (const path of paths) {
    const fd = libc.symbols.open(cString(path), O_RDWR, 0);
    if (fd !== -1) return {
      fd,
      path,
      close() {
        if (this.fd < 0) return;
        libc.symbols.close(this.fd);
        this.fd = -1;
      },
    };
    failures.push(`${path}: ${strerror(errno())}`);
  }
  throw new Error(`cannot open a Linux console (${failures.join("; ")})`);
};

export const setConsoleGraphics = (consoleDevice) =>
  ioctlValue(consoleDevice.fd, KDSETMODE, KD_GRAPHICS, "KDSETMODE(KD_GRAPHICS)");

export const setConsoleText = (consoleDevice) =>
  ioctlValue(consoleDevice.fd, KDSETMODE, KD_TEXT, "KDSETMODE(KD_TEXT)");

// The number of the virtual console currently shown (struct vt_stat.v_active).
export const activeConsole = (consoleDevice) => {
  const state = new Uint8Array(6);
  ioctlBuffer(consoleDevice.fd, VT_GETSTATE, state, "VT_GETSTATE");
  return new DataView(state.buffer).getUint16(0, true);
};

// Switches the display and keyboard to virtual console `number` and waits
// until the kernel has completed the switch.
export const activateConsole = (consoleDevice, number) => {
  ioctlValue(consoleDevice.fd, VT_ACTIVATE, number, `VT_ACTIVATE(${number})`);
  ioctlValue(consoleDevice.fd, VT_WAITACTIVE, number, `VT_WAITACTIVE(${number})`);
};

// struct vt_mode { char mode; char waitv; short relsig, acqsig, frsig; }.
const setConsoleSwitchMode = (consoleDevice, mode) => {
  const buffer = new Uint8Array(8);
  const view = new DataView(buffer.buffer);
  buffer[0] = mode;
  if (mode === VT_PROCESS) {
    view.setInt16(2, SIGUSR1, true);
    view.setInt16(4, SIGUSR2, true);
  }
  ioctlBuffer(consoleDevice.fd, VT_SETMODE, buffer, "VT_SETMODE");
};

// Asks the kernel to tell this process about console switches: SIGUSR1
// before the display is taken away (answered with VT_RELDISP 1), SIGUSR2
// when it comes back (answered with VT_ACKACQ), at which point `onAcquire`
// runs so the caller can repaint what fbcon left on the screen. Returns a
// function that puts the console back into automatic switching.
export const watchConsoleSwitches = (consoleDevice, callbacks) => {
  // Keep the original (console, onAcquire) public form working.
  const onRelease = typeof callbacks === "function" ? () => {} : callbacks.onRelease;
  const onAcquire = typeof callbacks === "function" ? callbacks : callbacks.onAcquire;
  const release = () => {
    try { onRelease(); } catch {}
    try { ioctlValue(consoleDevice.fd, VT_RELDISP, 1, "VT_RELDISP"); } catch {}
  };
  const acquire = () => {
    try { ioctlValue(consoleDevice.fd, VT_RELDISP, VT_ACKACQ, "VT_RELDISP(VT_ACKACQ)"); } catch {}
    try { onAcquire(); } catch {}
  };
  process.on("SIGUSR1", release);
  process.on("SIGUSR2", acquire);
  setConsoleSwitchMode(consoleDevice, VT_PROCESS);
  return () => {
    process.off("SIGUSR1", release);
    process.off("SIGUSR2", acquire);
    try { setConsoleSwitchMode(consoleDevice, VT_AUTO); } catch {}
  };
};

export const consoleNumber = (path) => {
  const match = /^\/dev\/tty(\d+)$/.exec(path);
  return match && Number(match[1]) > 0 ? Number(match[1]) : null;
};

const waitForKey = async (setRestore) => {
  const input = process.stdin;
  if (!input.isTTY) throw new Error("interactive demo requires a TTY on stdin");
  const wasRaw = Boolean(input.isRaw);
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    input.setRawMode?.(wasRaw);
    if (!wasRaw) input.pause();
  };
  setRestore(restore);
  input.setRawMode?.(true);
  input.resume();
  try {
    await new Promise((resolve, reject) => {
      const onData = () => { cleanup(); resolve(); };
      const onError = (error) => { cleanup(); reject(error); };
      const cleanup = () => {
        input.off("data", onData);
        input.off("error", onError);
      };
      input.once("data", onData);
      input.once("error", onError);
    });
  } finally {
    restore();
    setRestore(() => {});
  }
};

const defaultTriangle = (display) => [
  { x: display.width / 2, y: display.height / 6 },
  { x: display.width / 6, y: display.height * 5 / 6 },
  { x: display.width * 5 / 6, y: display.height * 5 / 6 },
];

// Runs `draw(display, context)` with the framebuffer open and the virtual
// console in graphics mode, restoring text mode however the call ends:
// normally, by throwing, by process.exit(), or on SIGHUP/SIGINT/SIGQUIT/
// SIGTERM. `console` names the console device(s) to use; the default list
// resolves to the console the process is running on. When it names a
// specific /dev/ttyN that is not the one on screen, the display is switched
// to it first (and back afterwards), the way X servers do; `switchConsole:
// false` disables that. Console switches away and back (Ctrl-Alt-Fn) are
// allowed while drawing; `context.onAcquire(callback)` runs when the display
// returns so the caller can repaint. `context` also offers `console` (the
// open console device) and `onRestore(callback)` for cleanup that must run
// before text mode returns, such as putting a keyboard back into cooked mode.
export const runGraphics = async (draw, {
  device = "/dev/fb0", console: consolePaths, switchConsole = true,
  prepareConsole = null,
} = {}) => {
  const display = openFramebuffer(device);
  let consoleDevice;
  try {
    consoleDevice = openConsole(consolePaths);
  } catch (error) {
    display.close();
    throw error;
  }
  let graphics = false;
  let previousConsole = null;
  let unwatch = null;
  const restoreCallbacks = [];
  const releaseCallbacks = [];
  const acquireCallbacks = [];
  const restore = () => {
    while (restoreCallbacks.length) {
      try { restoreCallbacks.pop()(); } catch {}
    }
    if (unwatch) {
      unwatch();
      unwatch = null;
    }
    if (graphics) {
      try { setConsoleText(consoleDevice); } catch {}
      graphics = false;
    }
    if (previousConsole !== null) {
      try { activateConsole(consoleDevice, previousConsole); } catch {}
      previousConsole = null;
    }
  };
  const signalStatuses = new Map([
    ["SIGHUP", 129], ["SIGINT", 130], ["SIGQUIT", 131], ["SIGTERM", 143],
  ]);
  const signalHandlers = new Map([...signalStatuses].map(([signal, status]) => [
    signal,
    () => { restore(); process.exit(status); },
  ]));
  for (const [signal, handler] of signalHandlers) process.on(signal, handler);
  process.on("exit", restore);
  try {
    if (prepareConsole) {
      const cleanup = await prepareConsole(consoleDevice);
      if (typeof cleanup === "function") restoreCallbacks.push(cleanup);
    }
    const target = switchConsole ? consoleNumber(consoleDevice.path) : null;
    if (target !== null) {
      const active = activeConsole(consoleDevice);
      if (active !== target) {
        activateConsole(consoleDevice, target);
        previousConsole = active;
      }
    }
    setConsoleGraphics(consoleDevice);
    graphics = true;
    // An async draw callback runs synchronously until its first await.  Start
    // it before enabling VT_PROCESS so it can register release/acquire hooks;
    // otherwise a switch in that small window could be acknowledged without
    // giving the renderer a chance to stop.
    const drawing = draw(display, {
      console: consoleDevice,
      onRestore: (callback) => { restoreCallbacks.push(callback); },
      onRelease: (callback) => { releaseCallbacks.push(callback); },
      onAcquire: (callback) => { acquireCallbacks.push(callback); },
    });
    if (switchConsole) {
      try {
        unwatch = watchConsoleSwitches(consoleDevice, {
          onRelease: () => {
            for (const callback of releaseCallbacks) {
              try { callback(); } catch {}
            }
          },
          onAcquire: () => {
            for (const callback of acquireCallbacks) {
              try { callback(); } catch {}
            }
          },
        });
      } catch {
        // Not a virtual console (or no permission): switches stay automatic.
      }
    }
    return await drawing;
  } finally {
    restore();
    process.off("exit", restore);
    for (const [signal, handler] of signalHandlers) process.off(signal, handler);
    display.close();
    consoleDevice.close();
  }
};

export const runDemo = async ({ polygons = [], points, device = "/dev/fb0" } = {}) => {
  if (!process.stdin.isTTY) throw new Error("interactive demo requires a TTY on stdin");
  const shapes = polygons.map(normalizePoints);
  if (points !== undefined) shapes.unshift(normalizePoints(points));
  const drawableShapes = shapes.filter((polygon) => polygon.length > 0);
  for (const polygon of drawableShapes) {
    if (polygon.length < 3) {
      throw new Error("each --points/-p polygon needs at least three complete x,y pairs");
    }
  }
  console.error("fbdev: entering graphics mode; press any key to return");
  await runGraphics(async (display, { onRestore }) => {
    clear(display);
    const drawing = drawableShapes.length ? drawableShapes : [defaultTriangle(display)];
    const colors = [
      { r: 64, g: 200, b: 255, a: 255 },
      { r: 255, g: 96, b: 128, a: 255 },
      { r: 128, g: 224, b: 96, a: 255 },
      { r: 255, g: 192, b: 64, a: 255 },
    ];
    drawing.forEach((polygon, index) =>
      fillPolygon(display, polygon, colors[index % colors.length]));
    flush(display);
    await waitForKey(onRestore);
  }, { device });
};

const usage = () => {
  console.error(`Usage:
  bun /lib/fbdev.js
  bun /lib/fbdev.js --points 'x1,y1 x2,y2 x3,y3' [--points '...']
  bun /lib/fbdev.js -p 'x1,y1 x2,y2 x3,y3' [-p '...']
  bun /lib/fbdev.js -h | --help`);
};

const main = async () => {
  const arguments_ = process.argv.slice(2);
  if (arguments_.length === 1 && (arguments_[0] === "-h" || arguments_[0] === "--help")) {
    await showDocument("fbdev");
    return;
  }
  const polygons = [];
  for (let index = 0; index < arguments_.length; index++) {
    const argument = arguments_[index];
    if (argument === "-p" || argument === "--points") {
      const value = arguments_[++index];
      if (value === undefined) {
        usage();
        throw new Error(`${argument} needs one polygon coordinate list`);
      }
      polygons.push(parsePoints([value]));
    } else if (argument.startsWith("--points=")) {
      polygons.push(parsePoints([argument.slice(9)]));
    } else if (argument.startsWith("-p=")) {
      polygons.push(parsePoints([argument.slice(3)]));
    } else {
      usage();
      throw new Error(`unexpected argument: ${argument}`);
    }
  }
  await runDemo({ polygons });
};

const isDirect = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirect) {
  try {
    await main();
  } catch (error) {
    console.error(`fbdev: ${error?.message ?? error}`);
    process.exit(1);
  }
}
