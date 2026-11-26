import { copyFileSync, existsSync, lstatSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLoader } from './index.js';

// Called before init starts apps or exposes bin in the child PATH. WINDIR alone
// must never cause PE files to be installed on another platform.
export function prepareWindowsLaunchers(root) {
  if (process.platform !== 'win32') return;
  if (!globalThis.Bun || Bun.isStandaloneExecutable)
    throw new Error('Windows setup requires init.js to run with a regular Bun executable');
  if (!['x64', 'arm64'].includes(process.arch))
    throw new Error('Unsupported Windows Bun architecture: ' + process.arch);

  const bin = join(root, 'bin');
  const names = [...new Set(readFileSync(join(root, 'apps', 'cmdlist'), 'utf8')
    .split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#')))];
  for (const name of names) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || /^(bun|bun-wx|bun-wa)$/i.test(name))
      throw new Error('Invalid Windows launcher name: ' + name);
  }
  const loader = buildLoader(process.arch);
  const updates = [];
  for (const name of ['bun', ...names]) {
    const binary = name === 'bun' ? buildLoader(process.arch, 'bun') : loader;
    const target = join(bin, name + '.exe');
    let existing;
    try {
      const st = lstatSync(target);
      if (!st.isFile() || st.size > 65536)
        throw new Error('Refusing to replace a non-launcher: ' + target);
      existing = readFileSync(target);
      if (!existing.includes(Buffer.from('buninu shloader: failed;')))
        throw new Error('Refusing to replace a non-launcher: ' + target);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!existing?.equals(binary)) updates.push([target, binary]);
  }

  const target = join(bin, process.arch === 'arm64' ? 'bun-wa.exe' : 'bun-wx.exe');
  const source = realpathSync(process.execPath);
  const marker = join(bin, '.win32-runtime.json');
  const sourceStat = statSync(source);
  const identity = { source, size: sourceStat.size, mtimeMs: sourceStat.mtimeMs,
    version: Bun.version, revision: Bun.revision, arch: process.arch };
  let previous;
  try { previous = JSON.parse(readFileSync(marker, 'utf8')); } catch {}
  const targetStat = existsSync(target) ? lstatSync(target) : null;
  if (targetStat && !targetStat.isFile()) throw new Error('Not a regular Bun executable: ' + target);
  const sameFile = targetStat && realpathSync(target).toLowerCase() === source.toLowerCase();
  const unchanged = targetStat && previous?.target && JSON.stringify(previous.source) === JSON.stringify(identity) &&
    targetStat?.size === previous.target?.size && targetStat?.mtimeMs === previous.target?.mtimeMs;
  if (!sameFile && !unchanged) {
    atomicReplace(target, temp => copyFileSync(source, temp)); // never a hardlink
  }
  for (const [path, binary] of updates) atomicReplace(path, temp => writeFileSync(temp, binary));
  const installed = statSync(target);
  const state = JSON.stringify({ source: identity, target: { size: installed.size, mtimeMs: installed.mtimeMs } });
  if (JSON.stringify(previous) !== state) atomicReplace(marker, temp => writeFileSync(temp, state + '\n'));
}

function atomicReplace(target, write) {
  const temporary = target + '.' + crypto.randomUUID() + '.tmp';
  try {
    write(temporary);
    renameSync(temporary, target);
  } catch (error) {
    throw new Error('Cannot prepare ' + target + ': ' + error.message +
      ' (if it is in use, close that Buninu process and retry)', { cause: error });
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
