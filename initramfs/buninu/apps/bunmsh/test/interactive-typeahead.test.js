import {test, expect} from 'bun:test';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

for (const delay of [0, 150, null]) test(`retains multiple submitted lines during cursor query (${delay ?? 'no'} reply)`, async () => {
  const home = mkdtempSync(join(tmpdir(), 'bunmsh-typeahead-'));
  const timers = [];
  let text = '', started = false, queried = false;
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const terminal = new Bun.Terminal({cols:80, rows:24, data(t, data) {
    const chunk = data.toString(); text += chunk;
    if (!started && text.includes('READY> ')) {
      started = true;
      later(() => t.write('printf "FIRST\\n"\r'), 0);
    }
    if (chunk.includes('\x1b[6n')) {
      if (!queried) {
        queried = true;
        // One PTY chunk: readline must not discard the second completed line.
        later(() => t.write('printf "SECOND\\n"\rprintf "THIRD\\n"\rexit\r'), 30);
      }
      if (delay !== null) later(() => t.write('\x1b[1;1R'), delay);
    }
  }});
  const proc = Bun.spawn([process.execPath, join(import.meta.dir, '../src/main.js'), '-i'], {
    env:{...process.env, HOME:home, BUNMSH_IMPORT_HISTORY:'off', PS1:'READY> ', BUNMSH_MOUSE:'0'}, terminal,
  });
  const guard = setTimeout(() => proc.kill(), 5000);
  try {
    expect(await proc.exited).toBe(0);
    const lines = Bun.stripANSI(text).replaceAll('\r', '').split('\n');
    for (const marker of ['FIRST','SECOND','THIRD']) expect(lines.filter(line => line === marker)).toHaveLength(1);
    expect(lines.indexOf('SECOND')).toBeLessThan(lines.indexOf('THIRD'));
  } finally {
    clearTimeout(guard); for (const timer of timers) clearTimeout(timer);
    if (proc.exitCode === null) {proc.kill(); await proc.exited;}
    terminal.close(); rmSync(home, {recursive:true, force:true});
  }
}, 10000);
