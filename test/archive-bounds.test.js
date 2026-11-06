import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { crc32 } from '../initramfs/lib/crc32.js';
const root=mkdtempSync(join(tmpdir(),'buninu-archive-bounds-'));
afterAll(()=>rmSync(root,{recursive:true,force:true}));
let serial=0;
function run(tool, bytes, flags) {
 const file=join(root,`${++serial}.${tool==='tar'?'tar':'zip'}`);writeFileSync(file,bytes);
 const result=spawnSync(process.execPath,[join(import.meta.dir,'../initramfs/bin',tool),...flags,file],{encoding:'utf8',timeout:5000});
 expect(result.error).toBeUndefined();return result;
}
function header(name, size, type='0') {
 const b=Buffer.alloc(512);b.write(name,0,100);b.write('0000644\0',100);
 b.write('0000000\0',108);b.write('0000000\0',116);b.write(size,124,12);
 b.write('00000000000\0',136);b.fill(32,148,156);b.write(type,156);b.write('ustar\0',257);b.write('00',263);
 b.write(b.reduce((a,v)=>a+v,0).toString(8).padStart(6,'0')+'\0 ',148);return b;
}
function member(name,data='',type='0') {
 const b=Buffer.from(data);return Buffer.concat([header(name,b.length.toString(8),type),b,Buffer.alloc((512-b.length%512)%512)]);
}
function pax(key,value) {
 const body=Buffer.from(` ${key}=${value}\n`);let n=body.length+1;
 while(String(n).length+body.length!==n)n=String(n).length+body.length;
 return Buffer.concat([Buffer.from(String(n)),body]);
}
const tar=Buffer.concat([member('hello.txt','hello'),Buffer.alloc(1024)]);
for(const encoding of ['plain','gzip','zstd']) test(`tar lists and extracts ${encoding}`,()=>{
 const bytes=encoding==='plain'?tar:encoding==='gzip'?gzipSync(tar):Bun.zstdCompressSync(tar);
 const listed=run('tar',bytes,['-tf']);expect(listed.status).toBe(0);expect(listed.stdout).toContain('hello.txt');
 const dest=join(root,`extract-${encoding}`);const result=run('tar',bytes,['-C',dest,'-xf']);
 expect(result.status).toBe(0);expect(readFileSync(join(dest,'hello.txt'),'utf8')).toBe('hello');
});
for(const size of ['-1000','77777777777','1x','NaN']) test(`tar refuses size ${size}`,()=>{
 const result=run('tar',header('bad',size),['-tf']);expect(result.status).not.toBe(0);expect(result.stderr).toContain('tar:');
});
for(const value of ['-512','NaN','Infinity','9007199254740993']) test(`tar refuses pax size ${value}`,()=>{
 const bytes=Buffer.concat([member('pax',pax('size',value),'x'),header('file','0')]);
 expect(run('tar',bytes,['-tf']).status).not.toBe(0);
});
test('tar refuses truncated padding, trailing header and later corrupt checksum',()=>{
 for(const bytes of [Buffer.concat([header('file','1'),Buffer.from('x')]),Buffer.concat([tar,Buffer.from('x')]),Buffer.concat([tar,Buffer.alloc(512,42)])])
  expect(run('tar',bytes,['-tf']).status).not.toBe(0);
});
test('tar refuses malformed pax records',()=>{
 for(const data of ['0 size=0\n','999 size=0\n','xx size=0\n','1 size=0\n'])
  expect(run('tar',Buffer.concat([member('pax',data,'x'),member('file')]),['-tf']).status).not.toBe(0);
});
test('tar preserves concatenated streams and UTF8 pax names',()=>{
 const bytes=Buffer.concat([tar,member('pax',pax('path','中文.txt'),'x'),member('name','x'),Buffer.alloc(1024)]);
 const listed=run('tar',bytes,['-tf']);expect(listed.status).toBe(0);expect(listed.stdout).toContain('中文.txt');
 const dest=join(root,'concat');expect(run('tar',bytes,['-C',dest,'-xf']).status).toBe(0);
 expect(readFileSync(join(dest,'中文.txt'),'utf8')).toBe('x');
});
function zip({method=0,zip64=false,comment=''}={}) {
 const name=Buffer.from('hello.txt'), body=Buffer.from('hello'),raw=method===8?deflateRawSync(body):body;
 const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt16LE(method,8);
 local.writeUInt32LE(crc32(body),14);local.writeUInt32LE(raw.length,18);local.writeUInt32LE(body.length,22);local.writeUInt16LE(name.length,26);
 const start=Buffer.concat([local,name,raw]),h=Buffer.alloc(46),extra=Buffer.alloc(zip64?28:0);
 h.writeUInt32LE(0x02014b50);h.writeUInt16LE(method,10);h.writeUInt32LE(crc32(body),16);
 h.writeUInt32LE(zip64?0xffffffff:raw.length,20);h.writeUInt32LE(zip64?0xffffffff:body.length,24);
 h.writeUInt16LE(name.length,28);h.writeUInt16LE(extra.length,30);h.writeUInt32LE(zip64?0xffffffff:0,42);
 if(zip64){extra.writeUInt16LE(1);extra.writeUInt16LE(24,2);extra.writeBigUInt64LE(5n,4);extra.writeBigUInt64LE(BigInt(raw.length),12);}
 const central=Buffer.concat([h,name,extra]),end=Buffer.alloc(22),extension=[];
 if(zip64){const z=Buffer.alloc(56),l=Buffer.alloc(20);z.writeUInt32LE(0x06064b50);z.writeBigUInt64LE(44n,4);
 z.writeBigUInt64LE(1n,24);z.writeBigUInt64LE(1n,32);z.writeBigUInt64LE(BigInt(central.length),40);z.writeBigUInt64LE(BigInt(start.length),48);
 l.writeUInt32LE(0x07064b50);l.writeBigUInt64LE(BigInt(start.length+central.length),8);l.writeUInt32LE(1,16);extension.push(z,l);}
 end.writeUInt32LE(0x06054b50);end.writeUInt16LE(zip64?65535:1,8);end.writeUInt16LE(zip64?65535:1,10);
 end.writeUInt32LE(zip64?0xffffffff:central.length,12);end.writeUInt32LE(zip64?0xffffffff:start.length,16);end.writeUInt16LE(Buffer.byteLength(comment),20);
 return {bytes:Buffer.concat([start,central,...extension,end,Buffer.from(comment)]),central:start.length,extra:start.length+46+name.length};
}
for(const method of [0,8]) for(const zip64 of [false,true]) test(`zip method ${method}, zip64 ${zip64}: list, test, pipe, extract`,()=>{
 const {bytes}=zip({method,zip64});
 for(const flag of ['-l','-t','-p']) {const r=run('unzip',bytes,[flag]);expect(r.status).toBe(0);expect(r.stdout).toContain(flag==='-p'?'hello':flag==='-l'?'hello.txt':'OK');}
 const dest=join(root,`zip-${method}-${zip64}`);expect(run('unzip',bytes,['-d',dest]).status).toBe(0);
 expect(readFileSync(join(dest,'hello.txt'),'utf8')).toBe('hello');
});
const mutations={
 'directory allocation':(b,c,e)=>b.writeUInt32LE(0xfffffff0,b.length-10),
 'entry count':(b,c,e)=>{b.writeUInt16LE(200,b.length-14);b.writeUInt16LE(200,b.length-12)},
 'name overrun':(b,c)=>b.writeUInt16LE(65000,c+28),
 'extra record overrun':(b,c,e)=>b.writeUInt16LE(65535,e+2),
 'short ZIP64 field':(b,c,e)=>b.writeUInt16LE(1,e+2),
 'unsafe ZIP64 value':(b,c,e)=>b.writeBigUInt64LE(2n**63n,e+4),
 'missing ZIP64 field':(b,c,e)=>b.writeUInt16LE(42,e),
 'local offset':(b,c,e)=>b.writeBigUInt64LE(2n**60n,e+20),
 'unsafe directory offset':(b,c,e)=>b.writeBigUInt64LE(2n**63n,b.length-98+48),
};
for(const [name,mutate] of Object.entries(mutations)) test(`zip rejects ${name}`,()=>{
 const fixture=zip({zip64:!['directory allocation','entry count','name overrun'].includes(name)});mutate(fixture.bytes,fixture.central,fixture.extra);
 const r=run('unzip',fixture.bytes,['-l']);expect(r.status).not.toBe(0);expect(r.stderr).toContain('unzip:');expect(r.stderr).not.toContain('RangeError');
});
test('zip rejects local variable-length header crossing directory',()=>{
 const {bytes}=zip();bytes.writeUInt16LE(65000,26);expect(run('unzip',bytes,['-t']).status).not.toBe(0);
});
test('deflate cannot inflate beyond declared size',()=>{
 const {bytes,central}=zip({method:8});bytes.writeUInt32LE(1,central+24);expect(run('unzip',bytes,['-t']).status).not.toBe(0);
});
test('zip ignores fake EOCD signature within comment',()=>{
 const {bytes}=zip({comment:'PK\x05\x06'+'x'.repeat(30)});expect(run('unzip',bytes,['-t']).status).toBe(0);
});

const { readTar } = await import('../scripts/fetch.js');
function fetchArchive(bytes) {
 const file=join(root,`fetch-${++serial}.apk`);writeFileSync(file,gzipSync(bytes));return ()=>readTar(file);
}
test('fetch APK reader retains concatenated members and UTF8 PAX paths',()=>{
 const bytes=Buffer.concat([tar,member('pax',pax('path','中文.txt'),'x'),member('fallback','content'),Buffer.alloc(1024)]);
 const archive=fetchArchive(bytes)();expect(archive.get('hello.txt').toString()).toBe('hello');
 expect(archive.get('中文.txt').toString()).toBe('content');
});
test('fetch APK reader rejects unsafe sizes, truncated blocks and corrupt checksums',()=>{
 for(const bytes of [header('bad','-1000'),header('bad','77777777777'),Buffer.concat([tar,Buffer.from('x')]),
  Buffer.concat([tar,Buffer.alloc(512,42)]),Buffer.concat([header('bad','1'),Buffer.from('x')]),
  Buffer.concat([member('pax',pax('size','-512'),'x'),header('bad','0')]),
  member('pax','999 path=bad\n','x')]) expect(fetchArchive(bytes)).toThrow();
});
test('fetch APK reader honors GNU long names and keeps link metadata without creating links',()=>{
 const name='folder/'.repeat(20)+'file.txt';
 const link=header('alias','0','2');link.write('target',157);link.fill(32,148,156);
 link.write(link.reduce((a,v)=>a+v,0).toString(8).padStart(6,'0')+'\0 ',148);
 const archive=fetchArchive(Buffer.concat([member('././@LongLink',name+'\0','L'),member('short','content'),link,Buffer.alloc(1024)]))();
 expect(archive.get(name).toString()).toBe('content');
 expect([...archive.links()]).toEqual([['alias',{target:'target',hard:false}]]);
});
