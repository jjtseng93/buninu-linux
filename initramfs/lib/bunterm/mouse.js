// /lib/bunterm/mouse.js — pointing devices through the Linux input layer.
//
// Read from /dev/input/event*, where the kernel reports one 24-byte
// input_event per axis, button or wheel notch, ending each batch with an
// EV_SYN. Relative devices (a mouse) move the pointer by their deltas;
// absolute ones (QEMU's USB tablet, a touchscreen) place it directly, which
// needs the axis range from EVIOCGABS. This module is only loaded when
// bunterm is asked for a mouse.

import { closeSync, existsSync, openSync, read, readFileSync, readdirSync } from "node:fs";
import { libc, ptr } from "../dlopen.js";

const EVENT_SIZE = 24;
const EV_SYN = 0x00;
const EV_KEY = 0x01;
const EV_REL = 0x02;
const EV_ABS = 0x03;
const REL_X = 0x00;
const REL_Y = 0x01;
const REL_WHEEL = 0x08;
const REL_HWHEEL = 0x06;
const ABS_X = 0x00;
const ABS_Y = 0x01;
const BTN_LEFT = 0x110;
const BTN_RIGHT = 0x111;
const BTN_MIDDLE = 0x112;
const BTN_TOUCH = 0x14a;

// struct input_absinfo { s32 value, minimum, maximum, fuzz, flat, resolution }
const EVIOCGABS = (axis) => 0x80184540 + axis;

const buttonNames = {
  [BTN_LEFT]: "left",
  [BTN_RIGHT]: "right",
  [BTN_MIDDLE]: "middle",
  [BTN_TOUCH]: "left",
};

const capability = (directory, name) => {
  try {
    // A capability file is a space-separated list of 64-bit hex words, most
    // significant first, so the last word holds bits 0-63.
    const words = readFileSync(`${directory}/${name}`, "utf8").trim().split(/\s+/u).reverse();
    return (bit) => {
      const word = words[Math.floor(bit / 64)];
      return word ? (BigInt(`0x${word}`) >> BigInt(bit % 64)) & 1n ? true : false : false;
    };
  } catch {
    return () => false;
  }
};

// Every /dev/input/event* that looks like a pointer, with how it reports
// position. A device with both relative and absolute axes counts as absolute.
export const findPointers = (directory = "/dev/input") => {
  const found = [];
  let names = [];
  try {
    names = readdirSync(directory).filter((name) => /^event\d+$/u.test(name));
  } catch {
    return found;
  }
  for (const name of names.sort()) {
    const sysfs = `/sys/class/input/${name}/device/capabilities`;
    if (!existsSync(sysfs)) continue;
    const relative = capability(sysfs, "rel");
    const absolute = capability(sysfs, "abs");
    const keys = capability(sysfs, "key");
    const hasRelative = relative(REL_X) && relative(REL_Y);
    const hasAbsolute = absolute(ABS_X) && absolute(ABS_Y);
    const hasButton = keys(BTN_LEFT) || keys(BTN_TOUCH);
    if (!hasButton || (!hasRelative && !hasAbsolute)) continue;
    let label = name;
    try {
      label = readFileSync(`/sys/class/input/${name}/device/name`, "utf8").trim() || name;
    } catch {}
    found.push({
      path: `${directory}/${name}`,
      name: label,
      kind: hasAbsolute ? "absolute" : "relative",
      wheel: relative(REL_WHEEL),
    });
  }
  return found;
};

const absoluteRange = (fd, axis) => {
  const info = new Int32Array(6);
  if (libc.symbols.ioctl(fd, EVIOCGABS(axis), ptr(info)) === -1) return null;
  const [, minimum, maximum] = info;
  return maximum > minimum ? { minimum, maximum } : null;
};

// Opens every pointer in `devices` and reports the pointer state after each
// EV_SYN: { x, y, buttons: { left, middle, right }, wheel, hwheel, moved,
// pressed, released }. Coordinates are pixels clamped to width x height.
// `speed` scales relative motion. close() releases the devices.
export const openPointer = ({
  devices = findPointers(),
  width,
  height,
  speed = 1,
  x = Math.floor(width / 2),
  y = Math.floor(height / 2),
  onSync,
  onError = () => {},
}) => {
  const state = {
    x, y,
    buttons: { left: false, middle: false, right: false },
    wheel: 0,
    hwheel: 0,
    moved: false,
    pressed: [],
    released: [],
  };
  const open = [];

  for (const device of devices) {
    let fd = -1;
    try {
      fd = openSync(device.path, "r");
      const ranges = device.kind === "absolute"
        ? { x: absoluteRange(fd, ABS_X), y: absoluteRange(fd, ABS_Y) }
        : null;
      // An absolute device without a usable range is read as relative.
      const kind = ranges?.x && ranges?.y ? "absolute" : "relative";
      open.push({ ...device, fd, kind, ranges, buffer: Buffer.alloc(EVENT_SIZE * 64), reading: true });
    } catch (error) {
      if (fd >= 0) {
        try { closeSync(fd); } catch {}
      }
      onError(new Error(`${device.path}: ${error.message}`));
    }
  }

  const clamp = (value, maximum) => Math.max(0, Math.min(maximum - 1, value));

  const apply = (entry, type, code, value) => {
    if (type === EV_REL) {
      if (code === REL_X) { state.x = clamp(Math.round(state.x + value * speed), width); state.moved = true; }
      else if (code === REL_Y) { state.y = clamp(Math.round(state.y + value * speed), height); state.moved = true; }
      else if (code === REL_WHEEL) state.wheel += value;
      else if (code === REL_HWHEEL) state.hwheel += value;
      return;
    }
    if (type === EV_ABS && entry.kind === "absolute") {
      const range = code === ABS_X ? entry.ranges.x : code === ABS_Y ? entry.ranges.y : null;
      if (!range) return;
      const span = range.maximum - range.minimum;
      const fraction = (value - range.minimum) / span;
      if (code === ABS_X) state.x = clamp(Math.round(fraction * width), width);
      else state.y = clamp(Math.round(fraction * height), height);
      state.moved = true;
      return;
    }
    if (type === EV_KEY) {
      const button = buttonNames[code];
      if (!button) return;
      const down = value !== 0;
      if (state.buttons[button] === down) return; // key repeat
      state.buttons[button] = down;
      (down ? state.pressed : state.released).push(button);
    }
  };

  const flush = () => {
    const report = {
      x: state.x,
      y: state.y,
      buttons: { ...state.buttons },
      wheel: state.wheel,
      hwheel: state.hwheel,
      moved: state.moved,
      pressed: state.pressed,
      released: state.released,
    };
    state.wheel = 0;
    state.hwheel = 0;
    state.moved = false;
    state.pressed = [];
    state.released = [];
    if (report.moved || report.wheel || report.hwheel || report.pressed.length || report.released.length) {
      try { onSync(report); } catch (error) { onError(error); }
    }
  };

  const pump = (entry) => {
    if (!entry.reading) return;
    read(entry.fd, entry.buffer, 0, entry.buffer.length, null, (error, count) => {
      if (!entry.reading) return;
      if (error) {
        if (error.code === "EAGAIN") { setTimeout(() => pump(entry), 10); return; }
        entry.reading = false;
        onError(new Error(`${entry.path}: ${error.message}`));
        return;
      }
      for (let offset = 0; offset + EVENT_SIZE <= count; offset += EVENT_SIZE) {
        const type = entry.buffer.readUInt16LE(offset + 16);
        const code = entry.buffer.readUInt16LE(offset + 18);
        const value = entry.buffer.readInt32LE(offset + 20);
        if (type === EV_SYN) flush();
        else apply(entry, type, code, value);
      }
      pump(entry);
    });
  };

  for (const entry of open) pump(entry);

  return {
    devices: open.map(({ path, name, kind }) => ({ path, name, kind })),
    state,
    close() {
      for (const entry of open) {
        entry.reading = false;
        try { closeSync(entry.fd); } catch {}
      }
      open.length = 0;
    },
  };
};
