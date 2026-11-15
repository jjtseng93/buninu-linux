import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createState, execute, decode } from '../src/shell.js';

const cwd = mkdtempSync(join(tmpdir(), 'bunmsh-merged-'));
const main = fileURLToPath(new URL('../src/main.js', import.meta.url));
writeFileSync(join(cwd, 'good'), 'match\n');
afterAll(() => rmSync(cwd, { recursive: true, force: true }));

for (const [command, status, line] of [['grep match', 2, 'good:match\n'], ['du -b', 1, '6\tgood\n']]) {
  const name = command.split(' ')[0];
  const error = `bunmsh: ${name}: ${name === 'du' ? "cannot access 'missing'" : 'missing'}: No such file or directory\n`;
  test(`${name} preserves merged ordering in direct and captured execution`, async () => {
    for (const [operands, expected] of [['missing good', error + line], ['good missing', line + error]]) {
      const script = `builtin ${command} ${operands} 2>&1`;
      const captured = await execute(script, createState({ cwd }), { capture: true });
      expect(captured.status).toBe(status);
      expect(decode(captured.stdout)).toBe(expected);
      expect(decode(captured.stderr)).toBe('');
      const child = Bun.spawn([process.execPath, main, '-c', script], { cwd, stdout: 'pipe', stderr: 'pipe' });
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect({ out, err, code }).toEqual({ out: expected, err: '', code: status });
    }
  });
}

test('merged grep reports an error before waiting on open stdin', async () => {
  const child = Bun.spawn([process.execPath, main, '-c', 'builtin grep match missing - 2>&1'], {
    cwd, stdin: 'pipe', stdout: 'pipe', stderr: 'pipe',
  });
  const reader = child.stdout.getReader();
  let timer;
  try {
    const first = await Promise.race([
      reader.read(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('diagnostic withheld until EOF')), 5000); }),
    ]);
    expect(first.done).toBe(false);
    expect(Buffer.from(first.value).toString()).toBe('bunmsh: grep: missing: No such file or directory\n');
    child.stdin.write('match\n');
    child.stdin.end();
    let rest = '';
    for (;;) { const part = await reader.read(); if (part.done) break; rest += Buffer.from(part.value).toString(); }
    expect(rest).toBe('(standard input):match\n');
    expect(await child.exited).toBe(2);
    expect(await new Response(child.stderr).text()).toBe('');
  } finally {
    clearTimeout(timer);
    child.kill();
    await child.exited;
    reader.releaseLock();
  }
});
