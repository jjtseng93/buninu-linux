// /lib/bunterm/input.js — keyboard bytes from a Linux virtual console.
//
// The console is read in raw mode so every key reaches the terminal
// emulator unchanged (Ctrl-C included; the program in the PTY decides what
// it means). The kernel keeps translating keys to bytes (K_XLATE), and its
// "linux" console sequences for a few keys are rewritten into the xterm
// forms that programs seeing TERM=xterm-256color expect.

import { closeSync, openSync, read } from "node:fs";
import { libc, ptr, errno, strerror } from "../dlopen.js";

const TCGETS = 0x5401;
const TCSETS = 0x5402;
// struct termios (kernel ABI): 4 x u32 flags, c_line, c_cc[19].
const TERMIOS_LENGTH = 36;
const IFLAG = 0;
const OFLAG = 4;
const CFLAG = 8;
const LFLAG = 12;
const CC = 17;
const VTIME = 5;
const VMIN = 6;

const IGNBRK = 0o1, BRKINT = 0o2, PARMRK = 0o10, ISTRIP = 0o40, INLCR = 0o100,
  IGNCR = 0o200, ICRNL = 0o400, IXON = 0o2000;
const OPOST = 0o1;
const CSIZE = 0o60, CS8 = 0o60, PARENB = 0o400;
const ISIG = 0o1, ICANON = 0o2, ECHO = 0o10, ECHONL = 0o100, IEXTEN = 0o100000;

const fail = (operation) => {
  const code = errno();
  throw new Error(`${operation}: ${strerror(code)}`);
};

const getTermios = (fd) => {
  const buffer = new Uint8Array(TERMIOS_LENGTH);
  if (libc.symbols.ioctl(fd, TCGETS, ptr(buffer)) === -1) fail("TCGETS");
  return buffer;
};

const setTermios = (fd, buffer) => {
  if (libc.symbols.ioctl(fd, TCSETS, ptr(buffer)) === -1) fail("TCSETS");
};

// cfmakeraw() on a copy of the current settings.
const rawTermios = (current) => {
  const raw = new Uint8Array(current);
  const view = new DataView(raw.buffer);
  const clear = (offset, mask) => view.setUint32(offset, view.getUint32(offset, true) & ~mask, true);
  clear(IFLAG, IGNBRK | BRKINT | PARMRK | ISTRIP | INLCR | IGNCR | ICRNL | IXON);
  clear(OFLAG, OPOST);
  clear(LFLAG, ECHO | ECHONL | ICANON | ISIG | IEXTEN);
  clear(CFLAG, CSIZE | PARENB);
  view.setUint32(CFLAG, view.getUint32(CFLAG, true) | CS8, true);
  raw[CC + VMIN] = 1;
  raw[CC + VTIME] = 0;
  return raw;
};

// Linux console sequences → xterm sequences (keys programs commonly bind).
const consoleToXterm = new Map([
  ["\u001b[[A", "\u001bOP"], ["\u001b[[B", "\u001bOQ"], ["\u001b[[C", "\u001bOR"],
  ["\u001b[[D", "\u001bOS"], ["\u001b[[E", "\u001b[15~"],
  ["\u001b[1~", "\u001b[H"], ["\u001b[4~", "\u001b[F"],
]);

const cursorKeys = new Map([
  ["\u001b[A", "\u001bOA"], ["\u001b[B", "\u001bOB"], ["\u001b[C", "\u001bOC"], ["\u001b[D", "\u001bOD"],
  ["\u001b[H", "\u001bOH"], ["\u001b[F", "\u001bOF"],
]);

// Rewrites console key sequences in `text`. With `applicationCursorKeys`
// (DECCKM set by the program) the arrow keys use the SS3 forms.
export const translateKeys = (text, { applicationCursorKeys = false } = {}) => {
  let output = "";
  let index = 0;
  while (index < text.length) {
    if (text[index] !== "\u001b") {
      output += text[index++];
      continue;
    }
    let matched = false;
    for (const [from, to] of consoleToXterm) {
      if (text.startsWith(from, index)) {
        output += applicationCursorKeys ? (cursorKeys.get(to) ?? to) : to;
        index += from.length;
        matched = true;
        break;
      }
    }
    if (matched) continue;
    if (applicationCursorKeys) {
      for (const [from, to] of cursorKeys) {
        if (text.startsWith(from, index)) {
          output += to;
          index += from.length;
          matched = true;
          break;
        }
      }
      if (matched) continue;
    }
    output += text[index++];
  }
  return output;
};

// Opens the keyboard: `device` names a console such as /dev/tty1; without
// it the process's own stdin is used (it must be a terminal). `onData`
// receives Buffers. close() restores the previous terminal settings.
export const openKeyboard = ({ device = null, onData, onError = () => {} }) => {
  const fd = device ? openSync(device, "r+") : 0;
  const saved = getTermios(fd);
  setTermios(fd, rawTermios(saved));
  let open = true;
  const chunk = Buffer.alloc(4096);
  const pump = () => {
    if (!open) return;
    read(fd, chunk, 0, chunk.length, null, (error, count) => {
      if (!open) return;
      if (error) {
        if (error.code === "EAGAIN") { setTimeout(pump, 10); return; }
        onError(error);
        return;
      }
      if (count > 0) onData(Buffer.from(chunk.subarray(0, count)));
      pump();
    });
  };
  pump();
  return {
    fd,
    close() {
      if (!open) return;
      open = false;
      try { setTermios(fd, saved); } catch {}
      if (device) closeSync(fd);
    },
  };
};
