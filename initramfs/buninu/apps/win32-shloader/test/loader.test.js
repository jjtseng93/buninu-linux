import { test, expect, describe, beforeAll, afterAll } from 'bun:test';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { buildLoader } from '../index.js';
import { nativeCode } from '../code.js';

for (const [arch, machine] of [['x64', 0x8664], ['arm64', 0xaa64]]) {
  test(`${arch}: deterministic small PE, checked-in code matches assembly source`, () => {
    const exe = buildLoader(arch);
    expect(exe).toEqual(buildLoader(arch));
    expect(exe).not.toEqual(buildLoader(arch, 'bun'));
    expect(buildLoader(arch, 'bun').length).toBeLessThanOrEqual(4096);
    expect(exe.length).toBeLessThanOrEqual(4096);
    expect(exe.toString('ascii', 0, 2)).toBe('MZ');
    const pe = exe.readUInt32LE(0x3c);
    expect(exe.toString('ascii', pe, pe + 4)).toBe('PE\0\0');
    expect(exe.readUInt16LE(pe + 4)).toBe(machine);
    expect(exe.readUInt16LE(pe + 24)).toBe(0x20b);
    expect(exe.readUInt16LE(pe + 24 + 68)).toBe(3);
    const source = readFileSync(new URL(`../${arch}.S`, import.meta.url));
    expect(createHash('sha256').update(source).digest('hex')).toBe(nativeCode[arch].sourceSHA256);
    expect(exe.includes(Buffer.from('cmd.exe'))).toBe(false);
    expect(exe.includes(Buffer.from('KERNEL32.dll'))).toBe(true);
    expect(exe.includes(Buffer.from((arch === 'arm64' ? 'bun-wa.exe' : 'bun-wx.exe') + '\0', 'utf16le'))).toBe(true);
    expect(exe.includes(Buffer.from((arch === 'arm64' ? 'bun-wx.exe' : 'bun-wa.exe') + '\0', 'utf16le'))).toBe(false);
    expect(exe.includes(Buffer.from('..\\apps\\bunmsh\\index.js\0', 'utf16le'))).toBe(true);
  });
}
test('unsupported architectures fail explicitly', () => {
  expect(() => buildLoader('ia32')).toThrow('Architecture');
  expect(() => buildLoader('x64', 'bad')).toThrow('Mode');
});

// This tests the loader boundary, using a tiny JS interpreter fixture. The
// real bunmsh + jmi.sh path is additionally exercised in the remote smoke test.
describe.skipIf(process.platform !== 'win32')('native Windows loader', () => {
  let root, bin, exe, bun, script, interpreter;
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'buninu-loader-'));
    bin = join(root, 'bundle % ! & (中文)', 'bin');
    mkdirSync(bin, { recursive: true });
    exe = join(bin, 'probe & test.exe');
    bun = join(bin, process.arch === 'arm64' ? 'bun-wa.exe' : 'bun-wx.exe');
    script = join(bin, 'probe & test.sh');
    interpreter = join(bin, '..', 'apps', 'bunmsh', 'index.js');
    mkdirSync(dirname(interpreter), { recursive: true });
    writeFileSync(exe, buildLoader(process.arch));
    copyFileSync(process.execPath, bun); // ordinary copy, never a hardlink
    writeFileSync(script, '# placeholder for the loader path assertion\n');
    writeFileSync(interpreter, `
      const fs = require('node:fs');
      const report = {script:process.argv[2], args:process.argv.slice(3),
        cwd:process.cwd(), marker:process.env.LOADER_MARKER};
      if(process.env.LOADER_STDIN) report.stdin=fs.readFileSync(0,'utf8');
      console.log(JSON.stringify(report));
      if(process.env.LOADER_STDERR) console.error(process.env.LOADER_STDERR);
      process.exit(Number(process.env.LOADER_EXIT||0));
    `);
  });
  afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }); });
  function invoke(args, extraEnv = {}, stdin = 'ignore') {
    const r = Bun.spawnSync({ cmd: [exe, ...args], cwd: root, stdin, stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, LOADER_MARKER: 'inherited % ! & 中文', ...extraEnv }, timeout: 10000 });
    return { ...r, output: r.stdout.toString(), error: r.stderr.toString() };
  }
  test('arguments stay literal, including empty strings, CR/LF, quotes and long input', () => {
    const args = ['', 'a b', '中文 😀', '%PATH%', '!PATH!', 'a^b', 'a&b', 'a(b)',
      'a\\\\"b', '"&whoami', 'C:\\space dir\\', 'a\nb', 'a\rb', 'a\r\nb', '\t', 'x'.repeat(12000), ''];
    const r = invoke(args);
    expect(r.exitCode).toBe(0);
    const got = JSON.parse(r.output);
    expect(got.args).toEqual(args);
    expect(got.script).toBe(script);
    expect(got.cwd).toBe(root);
    expect(got.marker).toBe('inherited % ! & 中文');
  });
  test('direct Bun mode bypasses all shell scripts and preserves literal arguments', () => {
    const direct = join(bin, 'bun.exe');
    const receiver = join(root, 'direct.cjs');
    writeFileSync(direct, buildLoader(process.arch, 'bun'));
    writeFileSync(join(bin, 'bun.sh'), 'exit 99\n');
    writeFileSync(receiver, 'console.log(JSON.stringify(process.argv.slice(2)));console.error("direct-stderr");process.exit(23)');
    const args = ['', 'a b', '中文 😀', '%PATH%', '!PATH!', 'a&b', 'a"b', 'a\nb', ''];
    const r = Bun.spawnSync([direct, receiver, ...args], {stdout:'pipe', stderr:'pipe', timeout:10000});
    expect(r.exitCode).toBe(23);
    expect(JSON.parse(r.stdout.toString())).toEqual(args);
    expect(r.stderr.toString().trim()).toBe('direct-stderr');
  });
  test('stdin, stdout, stderr and nonzero exit status propagate', () => {
    const r = invoke(['io'], { LOADER_STDIN: '1', LOADER_STDERR: 'stderr-marker', LOADER_EXIT: '37' }, Buffer.from('pipe input\n中文'));
    expect(r.exitCode).toBe(37);
    expect(JSON.parse(r.output).stdin).toBe('pipe input\n中文');
    expect(r.error.trim()).toBe('stderr-marker');
  });
  test('150 deterministic random argument arrays retain exact boundaries', () => {
    let seed = 0x12345678;
    const random = n => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % n; };
    const chars = Array.from('abc XYZ0123\\"%!^&|<>()[]{};=,`\'中文😀\t\r\n');
    for (let i = 0; i < 150; i++) {
      const args = Array.from({ length: random(8) }, () => Array.from({ length: random(30) }, () => chars[random(chars.length)]).join(''));
      const r = invoke(args);
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.output).args).toEqual(args);
    }
  }, 30000);
  test('command-line overflow fails instead of overwriting the buffer', () => {
    const prefix = '"' + bun + '" "' + bin + '\\..\\apps\\bunmsh\\index.js" "' + script + '"';
    const r = invoke(['x'.repeat(32767 - prefix.length)]);
    expect(r.exitCode).toBe(206);
    expect(r.error).toContain('buninu shloader: failed');
  });
  test('companion takes priority; absent companion falls back to neighboring multicall', () => {
    const fallback = join(bin, 'multicall.sh');
    writeFileSync(fallback, '# fallback\n');
    try {
      expect(JSON.parse(invoke(['priority']).output).script).toBe(script);
      rmSync(script);
      const r = invoke(['', 'literal % ! &', 'a\nb']);
      expect(r.exitCode).toBe(0);
      expect(JSON.parse(r.output).script).toBe(fallback);
      expect(JSON.parse(r.output).args).toEqual(['', 'literal % ! &', 'a\nb']);
    } finally {
      writeFileSync(script, '# restored\n');
      rmSync(fallback, { force: true });
    }
  });
  test('neither companion nor multicall exists: exit 127', () => {
    rmSync(script);
    try {
      const r = invoke([]);
      expect(r.exitCode).toBe(127);
      expect(r.error).toContain('buninu shloader: failed');
    } finally { writeFileSync(script, '# restored\n'); }
  });
  test('missing Bun reports the Windows error and never falls back to CMD', () => {
    const isolated = join(root, 'isolated');
    mkdirSync(isolated);
    const loader = join(isolated, 'missing.exe');
    writeFileSync(loader, buildLoader(process.arch));
    writeFileSync(join(isolated, 'missing.sh'), '# companion exists\n');
    const r = Bun.spawnSync({ cmd: [loader], stdout: 'pipe', stderr: 'pipe', timeout: 10000 });
    expect(r.exitCode).toBe(2); // ERROR_FILE_NOT_FOUND
    expect(r.stderr.toString()).toContain('buninu shloader: failed');
  });
  test.skipIf(!process.env.BUNINU_TEST_BUNMSH)('real multicall dispatches all supported app suffixes without losing the command name', () => {
    const saved = readFileSync(interpreter);
    const fallback = join(bin, 'multicall.sh');
    const receiver = join(root, 'receiver.cjs');
    writeFileSync(receiver, 'console.log(JSON.stringify(process.argv.slice(2)))');
    writeFileSync(interpreter, 'import ' + JSON.stringify(pathToFileURL(process.env.BUNINU_TEST_BUNMSH).href) + ';');
    copyFileSync(new URL('../../../bin/multicall.sh', import.meta.url), fallback);
    try {
      for (const ext of ['sh', 'js', 'mjs', 'ts', 'mts']) {
        const name = 'fallback-' + ext;
        const launcher = join(bin, name + '.exe');
        writeFileSync(launcher, buildLoader(process.arch));
        const app = join(bin, '..', 'apps', name, name + '.' + ext);
        mkdirSync(dirname(app), { recursive: true });
        writeFileSync(app, ext === 'sh'
          ? 'exec bun "' + receiver.replaceAll('\\', '/') + '" "$@"\n'
          : 'console.log(JSON.stringify(process.argv.slice(2)))');
        const args = ['', 'a b', '%PATH%', '!PATH!', 'a&b', 'a\\"b', '中文', 'a\nb'];
        const r = Bun.spawnSync({ cmd: [launcher, ...args], stdout: 'pipe', stderr: 'pipe', timeout: 15000 });
        expect({ code: r.exitCode, stderr: r.stderr.toString() }).toEqual({ code: 0, stderr: '' });
        expect(JSON.parse(r.stdout.toString())).toEqual(args);
      }
    } finally {
      writeFileSync(interpreter, saved);
      rmSync(fallback, { force: true });
    }
  }, 30000);
});
