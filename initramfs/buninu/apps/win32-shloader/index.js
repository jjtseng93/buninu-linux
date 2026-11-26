#!/usr/bin/env bun
// Pure JS PE writer: generation needs neither a compiler nor Windows.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeCode } from './code.js';

const align = (n, alignment) => Math.ceil(n / alignment) * alignment;
const apis = [
  'GetModuleFileNameW', 'GetCommandLineW', 'SetConsoleCtrlHandler',
  'GetStdHandle', 'CreateProcessW', 'CloseHandle', 'WaitForSingleObject',
  'GetExitCodeProcess', 'ExitProcess', 'GetLastError', 'WriteFile',
  'GetFileAttributesW', 'SetEnvironmentVariableW', 'DuplicateHandle',
];


export function buildLoader(arch = 'x64', mode = 'shell') {
  if (!['shell', 'bun'].includes(mode)) throw new Error('Mode must be shell or bun');
  const template = nativeCode[arch];
  if (!template) throw new Error('Architecture must be x64 or arm64');
  const bunName = arch === 'arm64' ? 'bun-wa.exe' : 'bun-wx.exe';
  const message = `buninu shloader: failed; exit code is the Windows error. Check ${bunName} and paths.\r\n`;
  if (Buffer.byteLength(message) !== 86) throw new Error('Update native WriteFile length');
  const code = Buffer.from(template.code, 'base64');
  const textRva = 0x1000, dataRva = align(textRva + code.length, 0x1000);
  const data = Buffer.alloc(4096);
  let used = 40; // import descriptor + null descriptor
  const symbols = {};
  const allocate = (name, contents, alignment = 2) => {
    used = align(used, alignment);
    const offset = used;
    contents.copy(data, offset);
    used += contents.length;
    if (used > data.length) throw new Error('PE data exceeds reserved buffer');
    if (name) symbols[name] = dataRva + offset;
    return offset;
  };
  const wide = (name, value) => allocate(name, Buffer.from(value + '\0', 'utf16le'));
  const dll = allocate(null, Buffer.from('KERNEL32.dll\0'));
  const names = apis.map(name => allocate(null, Buffer.concat([Buffer.alloc(2), Buffer.from(name + '\0')])));
  const ilt = allocate(null, Buffer.alloc((apis.length + 1) * 8), 8);
  const iat = allocate(null, Buffer.alloc((apis.length + 1) * 8), 8);
  apis.forEach((name, i) => {
    data.writeBigUInt64LE(BigInt(dataRva + names[i]), ilt + i * 8);
    data.writeBigUInt64LE(BigInt(dataRva + names[i]), iat + i * 8);
    symbols['imp_' + name] = dataRva + iat + i * 8;
  });
  data.writeUInt32LE(dataRva + ilt, 0);
  data.writeUInt32LE(dataRva + dll, 12);
  data.writeUInt32LE(dataRva + iat, 16);
  allocate('direct_bun', Buffer.from([mode === 'bun' ? 1 : 0]), 1);
  wide('bun_name', bunName);
  wide('interpreter', '..\\apps\\bunmsh\\index.js');
  wide('multicall', 'multicall.sh');
  wide('caller_env', 'BUNINU_SH_CALLER');
  wide('quote', '"');
  wide('separator', '" "');
  allocate('error_message', Buffer.from(message), 1);
  // PIC needs no base fixups. An ABSOLUTE-only block makes rebasing explicit.
  const reloc = allocate(null, Buffer.alloc(12), 4);
  data.writeUInt32LE(textRva, reloc);
  data.writeUInt32LE(12, reloc + 4);
  const rawDataSize = align(used, 512);
  let virtualSize = align(used, 16);
  for (const [name, size] of [['startup', 112], ['process_info', 32], ['exit_code', 16],
    ['self', 65536], ['bun', 65536], ['command', 65536]]) {
    symbols[name] = dataRva + virtualSize;
    virtualSize += size;
  }
  symbols.bun_limit = symbols.bun + 65534;
  symbols.command_limit = symbols.command + 65534;

  for (const [offset, type, name, addend] of template.relocations) {
    if (!(name in symbols)) throw new Error('Unknown native symbol: ' + name);
    const target = symbols[name] + addend;
    const pc = textRva + offset;
    if (type === 2 && arch === 'x64') { // ELF R_X86_64_PC32
      code.writeInt32LE(target - pc, offset);
    } else if (arch === 'arm64') {
      let instruction = code.readUInt32LE(offset);
      if (type === 275) { // ADRP: signed page difference, split immlo/immhi
        const pages = (Math.floor(target / 4096) - Math.floor(pc / 4096)) & 0x1fffff;
        instruction = (instruction & ~0x60ffffe0) | ((pages & 3) << 29) | ((pages >>> 2) << 5);
      } else if (type === 277) { // ADD immediate lo12
        instruction = (instruction & ~0x003ffc00) | ((target & 4095) << 10);
      } else if (type === 286) { // LDR X lo12, scaled by 8
        if (target % 8) throw new Error('Unaligned import pointer');
        instruction = (instruction & ~0x003ffc00) | (((target & 4095) >>> 3) << 10);
      } else throw new Error('Unsupported ARM64 relocation: ' + type);
      code.writeUInt32LE(instruction >>> 0, offset);
    } else throw new Error('Unsupported relocation: ' + type);
  }

  const textSize = align(code.length, 512), headersSize = 512;
  const pe = Buffer.alloc(headersSize + textSize + rawDataSize);
  pe.write('MZ', 0); pe.writeUInt32LE(64, 0x3c);
  pe.write('PE\0\0', 64);
  const coff = 68, optional = 88;
  pe.writeUInt16LE(arch === 'x64' ? 0x8664 : 0xaa64, coff);
  pe.writeUInt16LE(2, coff + 2);
  pe.writeUInt16LE(240, coff + 16);
  pe.writeUInt16LE(0x22, coff + 18); // executable, large-address-aware
  pe.writeUInt16LE(0x20b, optional); // PE32+
  pe.writeUInt32LE(textSize, optional + 4);
  pe.writeUInt32LE(rawDataSize, optional + 8);
  pe.writeUInt32LE(virtualSize - used, optional + 12);
  pe.writeUInt32LE(textRva, optional + 16);
  pe.writeUInt32LE(textRva, optional + 20);
  pe.writeBigUInt64LE(0x140000000n, optional + 24);
  pe.writeUInt32LE(4096, optional + 32);
  pe.writeUInt32LE(512, optional + 36);
  pe.writeUInt16LE(6, optional + 40);
  pe.writeUInt16LE(6, optional + 48);
  pe.writeUInt32LE(align(dataRva + virtualSize, 4096), optional + 56);
  pe.writeUInt32LE(headersSize, optional + 60);
  pe.writeUInt16LE(3, optional + 68); // console application
  pe.writeUInt16LE(0x160, optional + 70); // high-entropy ASLR, dynamic base, NX
  pe.writeBigUInt64LE(0x100000n, optional + 72);
  pe.writeBigUInt64LE(0x4000n, optional + 80);
  pe.writeBigUInt64LE(0x100000n, optional + 88);
  pe.writeBigUInt64LE(0x1000n, optional + 96);
  pe.writeUInt32LE(16, optional + 108);
  const directory = (index, rva, size) => {
    pe.writeUInt32LE(rva, optional + 112 + index * 8);
    pe.writeUInt32LE(size, optional + 116 + index * 8);
  };
  directory(1, dataRva, 40);
  directory(5, dataRva + reloc, 12);
  directory(12, dataRva + iat, (apis.length + 1) * 8);
  const section = (index, name, rva, size, rawOffset, rawSize, flags) => {
    const pos = optional + 240 + index * 40;
    pe.write(name, pos);
    pe.writeUInt32LE(size, pos + 8);
    pe.writeUInt32LE(rva, pos + 12);
    pe.writeUInt32LE(rawSize, pos + 16);
    pe.writeUInt32LE(rawOffset, pos + 20);
    pe.writeUInt32LE(flags, pos + 36);
  };
  section(0, '.text', textRva, code.length, headersSize, textSize, 0x60000020);
  section(1, '.data', dataRva, virtualSize, headersSize + textSize, rawDataSize, 0xc0000040);
  code.copy(pe, headersSize);
  data.copy(pe, headersSize + textSize, 0, rawDataSize);
  return pe;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: bun apps/win32-shloader/index.js [--arch=x64|arm64] [--out=path.exe] [--mode=shell|bun]\n' +
      'Default: write both architectures under apps/win32-shloader/build/.\n' +
      'Copy the matching loader to bin/<command>.exe; it runs <command>.sh via Bun + bunmsh.');
  } else {
    const unknown = args.find(a => !/^--(?:arch|out|mode)=.+$/.test(a));
    if (unknown) throw new Error('Unknown argument: ' + unknown);
    const arch = args.find(a => a.startsWith('--arch='))?.slice(7);
    const mode = args.find(a => a.startsWith('--mode='))?.slice(7) || 'shell';
    const output = args.find(a => a.startsWith('--out='))?.slice(6);
    if (output && !arch) throw new Error('--out requires --arch');
    for (const target of arch ? [arch] : ['x64', 'arm64']) {
      const destination = output ? resolve(output) : fileURLToPath(new URL('./build/' + target + '/' + (mode === 'bun' ? 'bun' : 'shloader') + '.exe', import.meta.url));
      const binary = buildLoader(target, mode);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, binary);
      console.log(destination + ': ' + binary.length + ' bytes');
    }
  }
}
