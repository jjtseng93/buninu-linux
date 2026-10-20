import { createRequire } from "node:module";
import { legacyKey } from "./keycodes.js";
const { KittyKeyboard } = createRequire(import.meta.url)("./kitty-keyboard.cjs");

// The same protocol engine as jsgotty, with a console-mode notification.
// Wait for the console to exist before installing handlers/advertising support.
export function attachKeyboard({term, write, setEnhanced, localInput = () => false,
  switchVT = () => {}, switchRelative = () => {}, onError = () => {}}) {
  let keyboard, enhanced = false;
  const sync = () => {
    const next = Boolean(keyboard?.flags);
    if (next === enhanced) return;
    try {
      setEnhanced(next);
      enhanced = next;
      keyboard.clearHeld(false);
    } catch (error) {
      keyboard.reset();
      onError(error);
    }
  };
  const wrap = name => (id, fn) => term.parser[name](id, params => {
    const result = fn(params);
    sync();
    return result;
  });
  keyboard = new KittyKeyboard({
    parser: {registerCsiHandler:wrap("registerCsiHandler"),registerEscHandler:wrap("registerEscHandler")},
    buffer:term.buffer,options:term.options,
    input: text => write(text),
  });
  const bufferChange = term.buffer.onBufferChange(sync);
  const reserved = new Set();
  return {
    get flags() { return keyboard.flags; },
    event(event) {
      // Mediumraw disables the kernel's console shortcuts. Keep Ctrl-Alt-Fn
      // available even when a client has requested all keys.
      if (event.type === "keydown" && event.ctrlKey && event.altKey && /^F([1-9]|1[0-2])$/.test(event.key)) {
        reserved.add(event.code);
        if (!event.repeat) switchVT(Number(event.key.slice(1)));
        return;
      }
      if (event.type === "keydown" && event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey &&
          ["ArrowLeft","ArrowRight"].includes(event.key)) {
        reserved.add(event.code);
        if (!event.repeat) switchRelative(event.key === "ArrowLeft" ? -1 : 1);
        return;
      }
      if (event.type === "keyup" && reserved.delete(event.code)) return;
      const text = legacyKey(event, Boolean(term._core?.coreService?.decPrivateModes?.applicationCursorKeys));
      if (localInput(event, text)) { keyboard.clearHeld(); return; }
      if (keyboard.handle(event) && text) write(text);
    },
    blur() { keyboard.clearHeld(); reserved.clear(); },
    dispose() {
      bufferChange.dispose();
      keyboard.dispose();
      if (enhanced) setEnhanced(false);
    },
  };
}
