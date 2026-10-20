// Linux K_MEDIUMRAW -> browser-shaped key events for the shared Kitty encoder.
// The kernel keymap supplies text; these names identify physical/function keys.
const keys = {};
const row = (start, names) => names.split(" ").forEach((name, i) => { keys[start + i] = name; });
row(1, "Escape Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal Backspace Tab");
row(16, "KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight Enter ControlLeft");
row(30, "KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote Backquote ShiftLeft Backslash");
row(44, "KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash ShiftRight NumpadMultiply AltLeft Space CapsLock");
row(59, "F1 F2 F3 F4 F5 F6 F7 F8 F9 F10 NumLock ScrollLock Numpad7 Numpad8 Numpad9 NumpadSubtract Numpad4 Numpad5 Numpad6 NumpadAdd Numpad1 Numpad2 Numpad3 Numpad0 NumpadDecimal");
row(86, "IntlBackslash F11 F12");
row(96, "NumpadEnter ControlRight NumpadDivide PrintScreen AltRight");
row(102, "Home ArrowUp PageUp ArrowLeft ArrowRight End ArrowDown PageDown Insert Delete");
Object.assign(keys, {113:"AudioVolumeMute",114:"AudioVolumeDown",115:"AudioVolumeUp",
  117:"NumpadEqual",119:"Pause",121:"NumpadComma",125:"MetaLeft",126:"MetaRight",
  127:"ContextMenu",163:"MediaTrackNext",164:"MediaPlayPause",165:"MediaTrackPrevious",
  166:"MediaStop",167:"MediaRecord",168:"MediaRewind",208:"MediaFastForward"});
row(183, "F13 F14 F15 F16 F17 F18 F19 F20 F21 F22 F23 F24");
const special = {NumpadEnter:"Enter",NumpadDivide:"/",NumpadMultiply:"*",NumpadAdd:"+",
  NumpadSubtract:"-",NumpadDecimal:".",NumpadEqual:"=",NumpadComma:","};
const navigation = ["Insert","End","ArrowDown","PageDown","ArrowLeft","Clear","ArrowRight","Home","ArrowUp","PageUp"];

// Mediumraw encodes >=128 as prefix (0 or 128), then two 7-bit groups
// with bit 7 set. Preserve incomplete triples across read() boundaries.
export class MediumRawDecoder {
  pending = [];
  feed(bytes, emit) {
    for (const byte of bytes) {
      this.pending.push(byte);
      const first = this.pending[0];
      if ((first & 127) !== 0) {
        emit(first & 127, !(first & 128));
        this.pending = [];
      } else if (this.pending.length === 3) {
        emit(((this.pending[1] & 127) << 7) | (this.pending[2] & 127), !(first & 128));
        this.pending = [];
      }
    }
  }
}

export class ConsoleKeys {
  constructor({ lookup, leds = 0 } = {}) {
    this.lookup = lookup;
    this.held = new Set();
    this.caps = Boolean(leds & 4);
    this.num = Boolean(leds & 2);
  }
  event(number, down) {
    const repeat = down && this.held.has(number);
    if (down) this.held.add(number); else this.held.delete(number);
    if (down && !repeat && number === 58) this.caps = !this.caps;
    if (down && !repeat && number === 69) this.num = !this.num;
    const shiftKey = this.held.has(42) || this.held.has(54);
    const ctrlKey = this.held.has(29) || this.held.has(97);
    const altKey = this.held.has(56);
    const altgr = this.held.has(100);
    const metaKey = this.held.has(125) || this.held.has(126);
    const code = keys[number] || `LinuxKey${number}`;
    let key = code.replace(/^(Shift|Control|Alt|Meta)(Left|Right)$/, "$1");
    if (number === 100) key = "AltGraph";
    else if (special[code]) key = special[code];
    else if (/^Numpad\d$/.test(code)) key = this.num !== shiftKey ? code.slice(6) : navigation[Number(code.slice(6))];
    else if (/^(Key|Digit|Intl)/.test(code) || ["Space","Minus","Equal","BracketLeft","BracketRight",
      "Backslash","Semicolon","Quote","Backquote","Comma","Period","Slash"].includes(code)) {
      // Exclude Ctrl/Alt from translation: the encoder needs the character,
      // not an already-collapsed control byte or an ESC prefix.
      const table = (shiftKey ? 1 : 0) | (altgr ? 2 : 0);
      let symbol = this.lookup?.(table, number);
      if ((symbol >> 8) === 11 && this.caps) symbol = this.lookup?.(table ^ 1, number);
      const type = symbol >> 8;
      key = symbol == null ? "Unidentified"
        : type === 0 || type === 11 ? String.fromCodePoint(symbol & 255)
        : type >= 16 ? String.fromCodePoint(symbol ^ 0xf000)
        : type === 4 || type === 13 ? "Dead" : "Unidentified";
    }
    return {type:down?"keydown":"keyup",code,key,repeat,shiftKey,ctrlKey,altKey,metaKey,
      location:/^Numpad/.test(code)?3:/Right$/.test(code)?2:/Left$/.test(code)?1:0,
      getModifierState: name => name === "CapsLock" ? this.caps : name === "NumLock" ? this.num : name === "AltGraph" && altgr,
      preventDefault() {}, stopPropagation() {}};
  }
}

// Recovery/plain-text path when the negotiated enhancements leave a key in
// legacy form. Used only in Kitty mode; normal console input stays unchanged.
export function legacyKey(event, applicationCursorKeys = false) {
  if (event.type !== "keydown") return "";
  const { key, ctrlKey, altKey, shiftKey } = event;
  let text = ({Enter:"\r",Tab:shiftKey?"\x1b[Z":"\t",Backspace:"\x7f",Escape:"\x1b"})[key];
  const cursor = {ArrowUp:"A",ArrowDown:"B",ArrowRight:"C",ArrowLeft:"D",Home:"H",End:"F"}[key];
  if (cursor) text = `\x1b${applicationCursorKeys?"O":"["}${cursor}`;
  const tilde = {Insert:2,Delete:3,PageUp:5,PageDown:6}[key];
  if (tilde) text = `\x1b[${tilde}~`;
  if (text === undefined && [...key].length === 1) {
    text = key;
    if (ctrlKey) {
      const n = key.toUpperCase().codePointAt(0);
      if (n >= 64 && n <= 95) text = String.fromCharCode(n & 31);
      else if (key === " " || key === "2") text = "\0";
      else if (key === "/" || key === "?") text = "\x1f";
      else if (key === "8") text = "\x7f";
    }
  }
  return text === undefined ? "" : (altKey ? "\x1b" : "") + text;
}
