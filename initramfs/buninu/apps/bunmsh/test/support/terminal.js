// Bun.Terminal is a PTY, not an emulator. Interactive tests must answer DSR
// instead of sending subsequent commands during the shell's fallback timeout.
const pending = new WeakMap();
export function answerCursorQueries(terminal, data) {
  const text = (pending.get(terminal) ?? '') + data.toString();
  for (const _ of text.matchAll(/\x1b\[6n/g)) terminal.write('\x1b[1;1R');
  const escape = text.lastIndexOf('\x1b');
  const tail = escape < 0 ? '' : text.slice(escape);
  pending.set(terminal, tail.length < 4 && '\x1b[6n'.startsWith(tail) ? tail : '');
}
