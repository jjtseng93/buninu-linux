import { test, expect } from 'bun:test';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareWindowsLaunchers } from '../prepare.js';
import { buildLoader } from '../index.js';

test.skipIf(process.platform === 'win32')('WINDIR on non-Windows cannot trigger any installation', () => {
  const previous = process.env.WINDIR;
  try {
    process.env.WINDIR = 'C:\\Windows';
    // A nonexistent root would throw if the installer touched the filesystem.
    expect(() => prepareWindowsLaunchers(join(tmpdir(), crypto.randomUUID(), 'absent'))).not.toThrow();
  } finally {
    if (previous === undefined) delete process.env.WINDIR; else process.env.WINDIR = previous;
  }
});

test.skipIf(process.platform !== 'win32')('prepare copies Bun, repairs missing files, and preserves unchanged files', () => {
  const root = mkdtempSync(join(tmpdir(), 'buninu-prepare-'));
  const bin = join(root, 'bin');
  const runtime = join(bin, process.arch === 'arm64' ? 'bun-wa.exe' : 'bun-wx.exe');
  const launcher = join(bin, 'probe.exe');
  try {
    mkdirSync(bin);
    mkdirSync(join(root, 'apps', 'bunmsh'), { recursive: true });
    writeFileSync(join(root, 'apps', 'cmdlist'), '# commands\nprobe\nprobe\n');
    writeFileSync(join(bin, 'probe.sh'), '# fixture\n');
    writeFileSync(join(root, 'apps', 'bunmsh', 'index.js'), 'console.log(JSON.stringify(process.argv.slice(3)))');
    prepareWindowsLaunchers(root);
    expect(statSync(runtime).size).toBe(statSync(process.execPath).size);
    expect(readFileSync(launcher)).toEqual(buildLoader(process.arch));
    expect(readFileSync(join(bin, "bun.exe"))).toEqual(buildLoader(process.arch, "bun"));
    const run = Bun.spawnSync([launcher, '', 'a & b', '中文'], { stdout: 'pipe', stderr: 'pipe' });
    expect(run.exitCode).toBe(0);
    expect(JSON.parse(run.stdout.toString())).toEqual(['', 'a & b', '中文']);
    const timestamps = [runtime, launcher].map(p => statSync(p).mtimeMs);
    prepareWindowsLaunchers(root);
    expect([runtime, launcher].map(p => statSync(p).mtimeMs)).toEqual(timestamps);
    rmSync(runtime);
    rmSync(launcher);
    prepareWindowsLaunchers(root);
    expect(existsSync(runtime)).toBe(true);
    expect(readFileSync(launcher)).toEqual(buildLoader(process.arch));
    expect(readFileSync(join(bin, "bun.exe"))).toEqual(buildLoader(process.arch, "bun"));
    // Initializing from the bundled Bun must not attempt to overwrite itself.
    const helper = join(root, 'self.mjs');
    writeFileSync(helper, `import {prepareWindowsLaunchers} from ${JSON.stringify(new URL('../prepare.js', import.meta.url).href)};prepareWindowsLaunchers(${JSON.stringify(root)});`);
    const self = Bun.spawnSync([runtime, helper], { stdout: 'pipe', stderr: 'pipe' });
    expect({ exit: self.exitCode, error: self.stderr.toString() }).toEqual({ exit: 0, error: '' });
    // User executables must not be silently replaced with launchers.
    writeFileSync(join(root, 'apps', 'cmdlist'), 'custom\n');
    writeFileSync(join(bin, 'custom.exe'), 'user file');
    expect(() => prepareWindowsLaunchers(root)).toThrow('Refusing to replace');
    expect(readFileSync(join(bin, 'custom.exe'), 'utf8')).toBe('user file');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 30000);


test.skipIf(process.platform !== 'win32')('init prepares launchers before normal and direct child startup', () => {
  const root = mkdtempSync(join(tmpdir(), 'buninu-init-'));
  try {
    for (const name of ['bin/init.js', 'apps/win32-shloader/prepare.js', 'apps/win32-shloader/index.js', 'apps/win32-shloader/code.js']) {
      const target = join(root, name);
      mkdirSync(join(target, '..'), { recursive: true });
      copyFileSync(new URL('../../../' + name, import.meta.url), target);
    }
    mkdirSync(join(root, 'apps', 'bunmsh'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({name: 'init-probe', version: '0', scripts: {start: 'bun child.js', local: 'bun child.js'}}));
    writeFileSync(join(root, 'apps', 'cmdlist'), 'bunmsh\n');
    writeFileSync(join(root, 'bin', 'bunmsh.sh'), '# fixture\n');
    writeFileSync(join(root, 'apps', 'bunmsh', 'index.js'), 'console.log(JSON.stringify(process.argv.slice(3)))');
    writeFileSync(join(root, 'child.js'), `import {existsSync} from 'node:fs';
      if (!existsSync('bin/bunmsh.exe') || !existsSync('bin/${process.arch === 'arm64' ? 'bun-wa' : 'bun-wx'}.exe')) process.exit(42);
      console.log('READY');`);
    const start = (...args) => Bun.spawnSync([process.execPath, join(root, 'bin', 'init.js'), ...args], {stdout: 'pipe', stderr: 'pipe'});
    const help = start('--version');
    expect(help.exitCode).toBe(0);
    expect(existsSync(join(root, 'bin', 'bunmsh.exe'))).toBe(false);
    for (const args of [[], ['--local']]) {
      const normal = start(...args);
      expect({exit: normal.exitCode, output: normal.stdout.toString().trim()}).toEqual({exit: 0, output: 'READY'});
    }
    rmSync(join(root, 'bin', 'bunmsh.exe'));
    const direct = start('--bunmsh', '', 'a & b', 'a"b', '中文');
    expect(direct.exitCode).toBe(0);
    expect(JSON.parse(direct.stdout.toString())).toEqual(['', 'a & b', 'a"b', '中文']);
  } finally { rmSync(root, {recursive: true, force: true}); }
}, 30000);
