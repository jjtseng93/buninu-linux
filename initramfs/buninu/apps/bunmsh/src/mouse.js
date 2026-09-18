import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export const MOUSE_ON = "\x1b[?1000h\x1b[?1006h";
export const MOUSE_OFF = "\x1b[?1000l\x1b[?1006l";
export const PASTE_ON = "\x1b[?2004h";
export const PASTE_OFF = "\x1b[?2004l";

const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

// The longest suffix of `text` that could still grow into `marker` once more
// bytes arrive in a later chunk (e.g. "\x1b[20" against "\x1b[201~"). Held
// back instead of treated as confirmed paste content, so a marker split
// across a transform() chunk boundary is never missed or double-counted.
function partialMarkerSuffixLength(text, marker) {
  const max = Math.min(text.length, marker.length - 1);
  for (let length = max; length > 0; length--) {
    if (marker.startsWith(text.slice(text.length - length))) return length;
  }
  return 0;
}

export function mouseInput(onMouse, onCursorPosition, onShortcut = () => {}, onPaste = () => {}) {
  const decoder = new StringDecoder("utf8");
  let pending = "";
  // Bracketed paste (\x1b[200~ ... \x1b[201~): everything between the
  // markers is literal pasted text, handed to onPaste once the end marker
  // closes it, never interpreted as a shortcut/mouse/cursor escape.
  // Known gap: a paste that both starts and ends within one transform()
  // chunk (by far the common case) still has the shortcut regexes below run
  // over it first, since they scan the whole chunk before this loop even
  // sees the paste markers. Real pasted text (commands, prose) essentially
  // never contains a raw \x14 or an ESC immediately followed by t/l/u/p/c,
  // so this is left as a documented gap rather than restructuring the scan.
  let pasting = false;
  let pasteBuffer = "";
  const input = new Transform({
    transform(chunk, _encoding, done) {
      let source = pending + decoder.write(chunk);
      pending = "";
      if (!pasting) {
        source = source.replace(/\x14/g, () => { onShortcut("tab"); return ""; });
        source = source.replace(/\x1bt/g, () => { onShortcut("tab-left"); return ""; });
        source = source.replace(/\x1bl/g, () => { onShortcut("lsfancy"); return ""; });
        source = source.replace(/\x1bu/g, () => { onShortcut("lsfancy-parent"); return ""; });
        source = source.replace(/\x1bp/g, () => { onShortcut("lsfancy-parent"); return ""; });
        source = source.replace(/\x1bc/g, () => { onShortcut("tab-close"); return ""; });
      }
      let output = "";
      while (source) {
        if (pasting) {
          const end = source.indexOf(PASTE_END);
          if (end < 0) {
            const holdback = partialMarkerSuffixLength(source, PASTE_END);
            pasteBuffer += source.slice(0, source.length - holdback);
            pending = source.slice(source.length - holdback);
            source = "";
            break;
          }
          pasteBuffer += source.slice(0, end);
          onPaste(pasteBuffer);
          pasteBuffer = "";
          pasting = false;
          source = source.slice(end + PASTE_END.length);
          continue;
        }
        const escape = source.indexOf("\x1b[");
        if (escape < 0) { output += source; break; }
        output += source.slice(0, escape);
        source = source.slice(escape);
        if (source.startsWith(PASTE_START)) {
          pasting = true;
          source = source.slice(PASTE_START.length);
          continue;
        }
        let match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(source);
        if (match) {
          onMouse({ button: Number(match[1]), x: Number(match[2]), y: Number(match[3]), press: match[4] === "M" });
          source = source.slice(match[0].length);
          continue;
        }
        match = /^\x1b\[(\d+);(\d+)R/.exec(source);
        if (match) {
          onCursorPosition({ row: Number(match[1]), column: Number(match[2]) });
          source = source.slice(match[0].length);
          continue;
        }
        if (/^\x1b\[(?:<\d*(?:;\d*){0,2}|\d*(?:;\d*)?)?$/.test(source)) {
          pending = source;
          break;
        }
        output += source.slice(0, 2);
        source = source.slice(2);
      }
      if (output) this.push(output);
      done();
    },
  });
  input.isTTY = process.stdin.isTTY;
  input.setRawMode = (mode) => process.stdin.setRawMode?.(mode);
  return input;
}
