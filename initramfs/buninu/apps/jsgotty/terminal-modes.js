"use strict";

// All flags defined by the kitty keyboard protocol. Kept unmasked so a CLI
// client on a real kitty terminal can restore them; the browser masks its own.
const KITTY_KEYBOARD_FLAGS = 0x1f;
const TRACKED_DEC_FLAGS = {
  1: "applicationCursorKeys",
  6: "origin",
  7: "wraparound",
  45: "reverseWraparound",
  66: "applicationKeypad",
  1004: "sendFocus",
  2004: "bracketedPasteMode",
};
const MOUSE_PROTOCOLS = { 9: "X10", 1000: "VT200", 1002: "DRAG", 1003: "ANY" };
const MOUSE_ENCODINGS = { 1006: "SGR", 1016: "SGR_PIXELS" };

// Mirrors the PTY's input/protocol modes so a resumed client can be brought
// back in sync. Mode semantics follow xterm.js, which renders the output.
class TerminalModeTracker {
  constructor() {
    this.reset();
    this._state = "text";
    this._seq = "";
  }

  reset() {
    this.dec = {
      applicationCursorKeys: false,
      applicationKeypad: false,
      bracketedPasteMode: false,
      origin: false,
      reverseWraparound: false,
      sendFocus: false,
      wraparound: true,
    };
    this.cursorHidden = false;
    this.mouse = "NONE";
    this.encoding = "DEFAULT";
    this.alternate = false;
    this.kitty = { normal: { flags: 0, stack: [] }, alternate: { flags: 0, stack: [] } };
  }

  snapshot() {
    return {
      dec: { ...this.dec },
      cursorHidden: this.cursorHidden,
      mouse: this.mouse,
      encoding: this.encoding,
      alternate: this.alternate,
      kitty: {
        normal: { flags: this.kitty.normal.flags, stack: [...this.kitty.normal.stack] },
        alternate: { flags: this.kitty.alternate.flags, stack: [...this.kitty.alternate.stack] },
      },
    };
  }

  consume(buffer) {
    // Control sequences are ASCII, so bytes can be scanned without UTF-8 decoding.
    for (let i = 0; i < buffer.length; i += 1) {
      const byte = buffer[i];
      switch (this._state) {
        case "text":
          if (byte === 0x1b) {
            this._state = "esc";
          }
          break;
        case "esc":
          if (byte === 0x5b) {
            this._state = "csi";
            this._seq = "";
          } else if (byte === 0x5d || byte === 0x50 || byte === 0x5f || byte === 0x5e || byte === 0x58) {
            this._state = "string";
            this._osc = byte === 0x5d ? "" : null;
          } else if (byte === 0x1b) {
            this._state = "esc";
          } else if (byte >= 0x20 && byte <= 0x2f) {
            this._state = "esc-intermediate";
          } else {
            this._state = "text";
            this.handleEsc(byte);
          }
          break;
        case "esc-intermediate":
          if (byte < 0x20 || byte > 0x2f) {
            this._state = byte === 0x1b ? "esc" : "text";
          }
          break;
        case "csi":
          if (byte >= 0x40 && byte <= 0x7e) {
            this._state = "text";
            this.handleCsi(this._seq, String.fromCharCode(byte));
          } else if (byte === 0x1b) {
            this._state = "esc";
          } else if (byte === 0x18 || byte === 0x1a || this._seq.length >= 64) {
            this._state = "text";
          } else if (byte >= 0x20) {
            this._seq += String.fromCharCode(byte);
          }
          break;
        case "string":
          if (byte === 0x07 || byte === 0x18 || byte === 0x1a) {
            if (byte === 0x07) this.handleOsc();
            this._state = "text";
          } else if (byte === 0x1b) {
            this._state = "string-esc";
          } else if (this._osc != null) {
            this._osc = this._osc.length < 256 ? this._osc + String.fromCharCode(byte) : null;
          }
          break;
        case "string-esc":
          if (byte === 0x5c) this.handleOsc();
          else this._osc = null;
          this._state = byte === 0x1b ? "string-esc" : byte === 0x5c ? "text" : "string";
          break;
      }
    }
  }

  handleOsc() {
    const match = /^777;jsgotty-kitty-v1;(normal|alternate);(\d{1,2});(\d{1,2}(?:,\d{1,2})*)?$/.exec(this._osc || '');
    if (!match) return;
    const flags = +match[2], stack = match[3] ? match[3].split(',').map(Number) : [];
    if (flags > 31 || stack.length > 32 || stack.some(n=>n > 31)) return;
    this.kitty[match[1]] = {flags, stack};
  }

  handleEsc(byte) {
    if (byte === 0x3d) {
      this.dec.applicationKeypad = true;
    } else if (byte === 0x3e) {
      this.dec.applicationKeypad = false;
    } else if (byte === 0x63) {
      this.reset();
    }
  }

  handleCsi(seq, final) {
    const prefix = /^[<=>?]/.test(seq) ? seq[0] : "";
    const body = prefix ? seq.slice(1) : seq;
    if (!/^[0-9;:]*$/.test(body)) {
      if (body === "!" && final === "p") {
        this.softReset();
      }
      return;
    }
    const params = body === "" ? [] : body.split(";").map((part) => {
      const value = Number.parseInt(part, 10);
      return Number.isFinite(value) ? value : 0;
    });
    if (prefix === "?" && (final === "h" || final === "l")) {
      for (const mode of params) {
        this.setPrivateMode(mode, final === "h");
      }
    } else if (final === "u" && prefix !== "?") {
      this.handleKittyKeyboard(prefix, params);
    }
  }

  softReset() {
    // DECSTR keeps the active screen and mouse reporting, like xterm.js.
    const { alternate, mouse, encoding } = this;
    this.reset();
    Object.assign(this, { alternate, mouse, encoding });
  }

  setPrivateMode(mode, enabled) {
    if (TRACKED_DEC_FLAGS[mode]) {
      this.dec[TRACKED_DEC_FLAGS[mode]] = enabled;
    } else if (MOUSE_PROTOCOLS[mode]) {
      this.mouse = enabled ? MOUSE_PROTOCOLS[mode] : "NONE";
    } else if (MOUSE_ENCODINGS[mode]) {
      this.encoding = enabled ? MOUSE_ENCODINGS[mode] : "DEFAULT";
    } else if (mode === 25) {
      this.cursorHidden = !enabled;
    } else if (mode === 47 || mode === 1047 || mode === 1049) {
      this.alternate = enabled;
    }
  }

  handleKittyKeyboard(prefix, params) {
    const state = this.kitty[this.alternate ? "alternate" : "normal"];
    const value = (index, fallback = 0) => (Number.isInteger(params[index]) ? params[index] : fallback);
    if (prefix === ">") {
      state.stack.push(state.flags);
      if (state.stack.length > 32) {
        state.stack.shift();
      }
      state.flags = value(0) & KITTY_KEYBOARD_FLAGS;
    } else if (prefix === "<") {
      let count = Math.min(value(0) || 1, 33);
      while (count--) {
        state.flags = state.stack.pop() ?? 0;
      }
    } else if (prefix === "=") {
      const flags = value(0) & KITTY_KEYBOARD_FLAGS;
      const mode = value(1) || 1;
      if (mode === 1) {
        state.flags = flags;
      } else if (mode === 2) {
        state.flags |= flags;
      } else if (mode === 3) {
        state.flags &= ~flags;
      }
    }
  }
}

const DEFAULT_MODES = new TerminalModeTracker().snapshot();
const MOUSE_PROTOCOL_MODES = { X10: 9, VT200: 1000, DRAG: 1002, ANY: 1003 };
const MOUSE_ENCODING_MODES = { SGR: 1006, SGR_PIXELS: 1016 };

function sameKitty(a, b) {
  return a.flags === b.flags && a.stack.length === b.stack.length &&
    a.stack.every((flags, index) => flags === b.stack[index]);
}

// Work only on the observed stack; never pop an arbitrary number of entries.
// With a terminal that cannot report its stack, [] denotes the unseen baseline.
function kittyTransition(from, to) {
  if (to.flags == null) return "";
  let common = 0;
  while (common < from.stack.length && common < to.stack.length &&
    from.stack[common] === to.stack[common]) common++;
  let sequence = "";
  let flags = from.flags;
  const pops = from.stack.length - common;
  if (pops) {
    sequence += `\x1b[<${pops}u`;
    flags = from.stack[common];
  }
  const first = to.stack[common] ?? to.flags;
  if (flags !== first) sequence += `\x1b[=${first};1u`;
  for (let i = common; i < to.stack.length; i++)
    sequence += `\x1b[>${to.stack[i + 1] ?? to.flags}u`;
  return sequence;
}

// Escape sequence that moves a terminal known to be in `from` to `to`, emitting
// only differences: DECOM homes the cursor and 1049 overwrites the saved cursor.
function modeTransition(from, to = DEFAULT_MODES, { normalizeMouse = false, kittyRestore = false } = {}) {
  let sequence = "";
  const fromScreen = from.alternate ? "alternate" : "normal";
  const toScreen = to.alternate ? "alternate" : "normal";
  // Kitty keyboard stacks are per screen, so each is fixed while it is active.
  if (from.alternate != null && !sameKitty(from.kitty[fromScreen], to.kitty[fromScreen])) {
    sequence += kittyTransition(from.kitty[fromScreen], to.kitty[fromScreen]);
  }
  if (to.alternate != null && from.alternate !== to.alternate) {
    sequence += `\x1b[?1049${to.alternate ? "h" : "l"}`;
    if (!sameKitty(from.kitty[toScreen], to.kitty[toScreen])) {
      sequence += kittyTransition(from.kitty[toScreen], to.kitty[toScreen]);
    }
  }
  const inactive = toScreen === "normal" ? "alternate" : "normal";
  // Switching screens just to edit a hidden stack destroys alternate contents.
  // Only emit this extension after the actual terminal advertised support.
  const hidden = to.kitty[inactive];
  if (kittyRestore && from.alternate != null && to.alternate != null && fromScreen === toScreen &&
      !sameKitty(from.kitty[inactive], hidden) && hidden.flags != null && hidden.stack.every(Number.isInteger)) {
    sequence += `\x1b]777;jsgotty-kitty-v1;${inactive};${hidden.flags};${hidden.stack.join(',')}\x07`;
  }
  for (const [mode, name] of Object.entries(TRACKED_DEC_FLAGS)) {
    if (to.dec[name] == null || from.dec[name] === to.dec[name]) {
      continue;
    }
    if (name === "applicationKeypad") {
      sequence += to.dec[name] ? "\x1b=" : "\x1b>"; // more widely supported than ?66
    } else {
      sequence += `\x1b[?${mode}${to.dec[name] ? "h" : "l"}`;
    }
  }
  if (to.cursorHidden != null && from.cursorHidden !== to.cursorHidden) {
    sequence += `\x1b[?25${to.cursorHidden ? "l" : "h"}`;
  }
  // Raw query results preserve independent switches on native terminals. Reset
  // first, then enable in priority order so exclusive terminals also end in the
  // intended effective mode. Unanswered switches are never guessed.
  for (const [name, bitsName, table] of [
    ['mouse', 'mouseModeBits', MOUSE_PROTOCOL_MODES],
    ['encoding', 'mouseEncodingBits', MOUSE_ENCODING_MODES],
  ]) {
    const bits = to[bitsName];
    if (bits) {
      for (const mode of Object.values(table))
        if (bits[mode] === false) sequence += `\x1b[?${mode}l`;
      for (const mode of Object.values(table))
        if (bits[mode] === true) sequence += `\x1b[?${mode}h`;
    } else if (to[name] != null && (normalizeMouse || from[name] !== to[name])) {
      for (const mode of Object.values(table)) sequence += `\x1b[?${mode}l`;
      if (table[to[name]]) sequence += `\x1b[?${table[to[name]]}h`;
    }
  }
  return sequence;
}

function validateSnapshot(value) {
  if (!value || !value.dec || !value.kitty) throw Error("Invalid terminal modes");
  const result = new TerminalModeTracker().snapshot();
  for (const key of Object.values(TRACKED_DEC_FLAGS)) {
    if (typeof value.dec[key] !== 'boolean' && value.dec[key] !== null) throw Error("Invalid DEC mode");
    result.dec[key] = value.dec[key];
  }
  for (const key of ['alternate', 'cursorHidden']) {
    if (typeof value[key] !== 'boolean' && value[key] !== null) throw Error("Invalid screen mode");
    result[key] = value[key];
  }
  for (const [key, choices] of [['mouse', ['NONE', ...Object.values(MOUSE_PROTOCOLS)]], ['encoding', ['DEFAULT', ...Object.values(MOUSE_ENCODINGS)]]]) {
    if (value[key] !== null && !choices.includes(value[key])) throw Error("Invalid mouse mode");
    result[key] = value[key];
  }
  for (const [key, table] of [['mouseModeBits', MOUSE_PROTOCOLS], ['mouseEncodingBits', MOUSE_ENCODINGS]]) {
    if (value[key] === undefined) continue;
    if (!value[key] || typeof value[key] !== 'object') throw Error('Invalid mouse bits');
    result[key] = {};
    for (const mode of Object.keys(table)) {
      const bit = value[key][mode];
      if (bit !== null && typeof bit !== 'boolean') throw Error('Invalid mouse bit');
      result[key][mode] = bit;
    }
  }
  for (const key of ['normal', 'alternate']) {
    const state = value.kitty[key];
    const flag = n => Number.isInteger(n) && n >= 0 && n <= KITTY_KEYBOARD_FLAGS;
    if (!state || (state.flags !== null && !flag(state.flags)) || !Array.isArray(state.stack) ||
      state.stack.length > 32 || !state.stack.every(n => n === null || flag(n))) throw Error("Invalid Kitty state");
    result.kitty[key] = {flags: state.flags, stack: [...state.stack]};
  }
  return result;
}

module.exports = { TerminalModeTracker, modeTransition, validateSnapshot, TRACKED_DEC_FLAGS, MOUSE_PROTOCOLS, MOUSE_ENCODINGS };
