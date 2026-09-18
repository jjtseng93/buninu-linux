const decoder = new TextDecoder();

export const ENABLE_MOUSE = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";
export const DISABLE_MOUSE = "\x1b[?1006l\x1b[?1002l\x1b[?1000l";
export const ENABLE_PASTE = "\x1b[?2004h";
export const DISABLE_PASTE = "\x1b[?2004l";

export class KeyEvent {
  constructor(key, raw) {
    this.type = "key";
    this.key = key;
    this.raw = raw;
  }
}

export class MouseEvent {
  constructor({ x, y, button, action, modifiers = 0, raw = "" }) {
    this.type = "mouse";
    this.x = x;
    this.y = y;
    this.button = button;
    this.action = action;
    this.modifiers = modifiers;
    this.raw = raw;
  }
}

export class PasteEvent {
  constructor(text, raw) {
    this.type = "paste";
    this.text = text;
    this.raw = raw;
  }
}

export class ResizeEvent {
  constructor(cols, rows) {
    this.type = "resize";
    this.cols = cols;
    this.rows = rows;
  }
}

export function parseInputEvents(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const text = typeof data === "string" ? data : decoder.decode(data);
  const paste = parseBracketedPaste(text);
  if (paste) return [paste];
  const events = [...parseSgrMouseEvents(text), ...parseX10MouseEvents(bytes)];
  if (events.length > 0) return events.sort((a, b) => text.indexOf(a.raw) - text.indexOf(b.raw));
  return parseKeyEvents(text);
}

function parseBracketedPaste(text) {
  const start = text.indexOf("\x1b[200~");
  const end = text.indexOf("\x1b[201~");
  if (start === -1 || end === -1 || end < start) return null;
  const raw = text.slice(start, end + 7);
  return new PasteEvent(text.slice(start + 6, end), raw);
}

export function parseSgrMouse(text) {
  return parseSgrMouseSequence(text);
}

function parseSgrMouseEvents(text) {
  const events = [];
  const re = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;
  for (const match of text.matchAll(re)) {
    const event = sgrMatchToEvent(match);
    if (event) events.push(event);
  }
  return events;
}

function parseSgrMouseSequence(text) {
  const match = /^\x1b\[<(\d+);(\d+);(\d+)([mM])$/.exec(text);
  return match ? sgrMatchToEvent(match) : null;
}

function sgrMatchToEvent(match) {
  const code = Number(match[1]);
  const x = Number(match[2]) - 1;
  const y = Number(match[3]) - 1;
  const release = match[4] === "m";
  const buttonCode = code & 0b11;
  const wheel = (code & 64) !== 0;
  const drag = (code & 32) !== 0;
  const modifiers = code & (4 | 8 | 16);
  let button = "left";
  if (wheel) button = buttonCode === 0 ? "wheel-up" : "wheel-down";
  else if (buttonCode === 1) button = "middle";
  else if (buttonCode === 2) button = "right";
  else if (buttonCode === 3) button = "none";
  const action = release ? "up" : drag ? "drag" : "down";
  return new MouseEvent({ x, y, button, action, modifiers, raw: match[0] });
}

function parseX10MouseEvents(bytes) {
  const events = [];
  for (let i = 0; i + 5 < bytes.length; i++) {
    if (bytes[i] !== 0x1b || bytes[i + 1] !== 0x5b || bytes[i + 2] !== 0x4d) continue;
    const code = bytes[i + 3] - 32;
    const x = bytes[i + 4] - 33;
    const y = bytes[i + 5] - 33;
    if (x < 0 || y < 0) continue;
    const buttonCode = code & 0b11;
    const wheel = (code & 64) !== 0;
    const drag = (code & 32) !== 0;
    let button = "left";
    if (wheel) button = buttonCode === 0 ? "wheel-up" : "wheel-down";
    else if (buttonCode === 1) button = "middle";
    else if (buttonCode === 2) button = "right";
    else if (buttonCode === 3) button = "none";
    const action = buttonCode === 3 ? "up" : drag ? "drag" : "down";
    events.push(new MouseEvent({ x, y, button, action, modifiers: code & (4 | 8 | 16), raw: decoder.decode(bytes.slice(i, i + 6)) }));
    i += 5;
  }
  return events;
}

const KEY_MAP = {
  "\x01": "ctrl-a",
  "\x02": "ctrl-b",
  "\x03": "ctrl-c",
  "\x04": "ctrl-d",
  "\x05": "ctrl-e",
  "\x0c": "ctrl-l",
  "\x06": "ctrl-f",
  "\x07": "ctrl-g",
  "\t": "tab",
  "\x0b": "ctrl-k",
  "\x0e": "ctrl-n",
  "\x0f": "ctrl-o",
  "\x10": "ctrl-p",
  "\x11": "ctrl-q",
  "\x12": "ctrl-r",
  "\x13": "ctrl-s",
  "\x14": "ctrl-t",
  "\x15": "ctrl-u",
  "\x16": "ctrl-v",
  "\x17": "ctrl-w",
  "\x18": "ctrl-x",
  "\x19": "ctrl-y",
  "\x1a": "ctrl-z",
  "\x1f": "ctrl-underscore",
  "\x7f": "backspace",
  "\b": "backspace",
  "\r": "enter",
  "\n": "enter",
  "\x1b": "escape",
  "\x1b[A": "up",
  "\x1b[B": "down",
  "\x1b[C": "right",
  "\x1b[D": "left",
  "\x1b[1;2A": "shift-up",
  "\x1b[1;2B": "shift-down",
  "\x1b[1;2C": "shift-right",
  "\x1b[1;2D": "shift-left",
  "\x1b[2A": "shift-up",
  "\x1b[2B": "shift-down",
  "\x1b[2C": "shift-right",
  "\x1b[2D": "shift-left",
  "\x1b[1;5A": "ctrl-up",
  "\x1b[1;5B": "ctrl-down",
  "\x1b[1;5C": "ctrl-right",
  "\x1b[1;5D": "ctrl-left",
  "\x1b[1;5H": "ctrl-home",
  "\x1b[1;5F": "ctrl-end",
  "\x1b[5H": "ctrl-home",
  "\x1b[5F": "ctrl-end",
  "\x1b[5A": "ctrl-up",
  "\x1b[5B": "ctrl-down",
  "\x1b[5C": "ctrl-right",
  "\x1b[5D": "ctrl-left",
  "\x1b[1;6A": "shift-ctrl-up",
  "\x1b[1;6B": "shift-ctrl-down",
  "\x1b[1;6C": "shift-ctrl-right",
  "\x1b[1;6D": "shift-ctrl-left",
  // Shift+Home/End
  "\x1b[1;2H": "shift-home",
  "\x1b[2;1H": "shift-home",
  "\x1b[1;2F": "shift-end",
  "\x1b[2;1F": "shift-end",
  // Shift+PageUp/Down
  "\x1b[5;2~": "shift-pageup",
  "\x1b[6;2~": "shift-pagedown",
  // Alt+arrows
  "\x1b[1;3A": "alt-up",
  "\x1b[1;3B": "alt-down",
  "\x1b[1;3C": "alt-right",
  "\x1b[1;3D": "alt-left",
  // Alt+Shift+arrows
  "\x1b[1;4A": "alt-shift-up",
  "\x1b[1;4B": "alt-shift-down",
  "\x1b[1;4C": "alt-shift-right",
  "\x1b[1;4D": "alt-shift-left",
  "\x1b[H": "home",
  "\x1b[F": "end",
  "\x1b[1~": "home",
  "\x1b[4~": "end",
  "\x1b[3~": "delete",
  "\x1b[5~": "pageup",
  "\x1b[6~": "pagedown",
  "\x1b[5;5~": "ctrl-pageup",
  "\x1b[6;5~": "ctrl-pagedown",
  "\x1b[7;5~": "ctrl-home",
  "\x1b[8;5~": "ctrl-end",
  "\x1b[Z": "backtab",
  "\x1b,": "alt-comma",
  "\x1b.": "alt-period",
  "\x1b/": "alt-/",
  "\x1b[": "alt-[",
  "\x1b]": "alt-]",
  "\x1b\t": "alt-tab",
  "\x1b\r": "alt-enter",
};

const KEY_SEQUENCES = Object.keys(KEY_MAP)
  .filter((seq) => seq !== "\x1b")
  .sort((a, b) => b.length - a.length);

function parseKeyEvents(text) {
  const events = [];
  let i = 0;
  while (i < text.length) {
    const match = KEY_SEQUENCES.find((seq) => text.startsWith(seq, i));
    if (match) {
      events.push(new KeyEvent(parseKey(match), match));
      i += match.length;
      continue;
    }

    if (text.charCodeAt(i) === 0x1b) {
      const alt = text.slice(i, i + 2);
      if (alt.length === 2 && alt[1] >= " " && alt[1] <= "~") {
        events.push(new KeyEvent(parseKey(alt), alt));
        i += 2;
      } else {
        events.push(new KeyEvent("escape", "\x1b"));
        i++;
      }
      continue;
    }

    let j = i + 1;
    while (j < text.length && text.charCodeAt(j) !== 0x1b && !KEY_MAP[text[j]]) j++;
    const raw = text.slice(i, j);
    events.push(new KeyEvent(parseKey(raw), raw));
    i = j;
  }
  return events;
}

export function parseKey(text) {
  if (KEY_MAP[text]) return KEY_MAP[text];
  // ESC + single printable ASCII -> alt-{char}
  if (text.length === 2 && text.charCodeAt(0) === 0x1b) {
    const ch = text[1];
    if (ch >= " " && ch <= "~") return `alt-${ch}`;
  }
  return text;
}
