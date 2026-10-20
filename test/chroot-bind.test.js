import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseChrootArguments,resolveBindings,resolveGuestPath} from '../initramfs/lib/chroot-options.js';

test('chroot bind arguments expand shared tmp, repeat, and stop at NEWROOT',()=>{
 const result=parseChrootArguments(['-n','-b','/host:/guest','--shared-tmp','--bind=/same','/root','echo','-b','unchanged'],{TMPDIR:'/host temp'});
 expect(result.options).toMatchObject({mount:false,binds:['/host:/guest','/host temp:/tmp','/same']});
 expect(result.positional).toEqual(['/root','echo','-b','unchanged']);
 expect(()=>parseChrootArguments(['--shared-tmp','/root'],{})).toThrow('TMPDIR');
 expect(()=>parseChrootArguments(['-b'])).toThrow('requires');
 expect(()=>parseChrootArguments(['--bind='])).toThrow('requires');
 expect(parseChrootArguments(['--','-root','sh']).positional).toEqual(['-root','sh']);
});

test('bind resolution preserves same-path destinations and confines guest symlinks',()=>{
 const dir=mkdtempSync(join(tmpdir(),'buninu-bind-path-'));
 try{
  mkdirSync(join(dir,'root'));mkdirSync(join(dir,'host'));writeFileSync(join(dir,'file'),'data');
  const binds=resolveBindings(['host','file:/etc/config','host:/tmp','file:/tmp'],dir);
  expect(binds.find(b=>b.inside===join(dir,'host'))?.source).toBe(join(dir,'host'));
  expect(binds.find(b=>b.inside==='/tmp')?.file).toBe(true);
  expect(()=>resolveBindings(['host:relative'],dir)).toThrow('absolute');
  expect(()=>resolveBindings(['host:/'],dir)).toThrow('root');
  expect(()=>resolveBindings(['missing:/ok'],dir)).toThrow();
  symlinkSync('/run/tmp',join(dir,'root/tmp'));
  expect(resolveGuestPath(join(dir,'root'),'/tmp')).toBe('/run/tmp');
  symlinkSync('../../outside',join(dir,'root/escape'));
  expect(resolveGuestPath(join(dir,'root'),'/escape')).toBe('/outside');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

// Execute the actual CLI with recorded syscall bindings. No host mounts or
// chroot occur; this also exercises failure cleanup and the -n interaction.
async function invoke(argumentsFor,env={}) {
 const dir=mkdtempSync(join(tmpdir(),'buninu-bind-cli-')),root=join(dir,'root'),host=join(dir,'host'),log=join(dir,'calls');
 mkdirSync(root);mkdirSync(host);mkdirSync(join(dir,'fail'));writeFileSync(join(dir,'file'),'data');
 const mock=join(dir,'libc.js');
 writeFileSync(mock,`import {appendFileSync} from 'node:fs';
 const record=(name,...args)=>appendFileSync(${JSON.stringify(log)},JSON.stringify([name,...args.map(a=>typeof a==='bigint'?String(a):a)])+'\\n');
 let entered=false;
 const bound=new Map();
 const functions={mount:(...a)=>{record('mount',...a);return a[0]?.endsWith('/fail')?-1:0;},
 umount2:(...a)=>{record('umount',...a);return process.env.MOCK_UNMOUNT_FAIL?-1:0;},
 chroot:(...a)=>{record('chroot',...a);entered=true;return 0;},
 strerror:()=> 'mock mount denied',errno:()=>process.env.MOCK_UNMOUNT_FAIL?5:1};
 export const libc={symbols:new Proxy({}, {get(_target,name){
   if(!bound.has(name)){
     record('resolve',name);
     if(entered||process.env.MOCK_MISSING_SYMBOL===name)throw Error('Cannot load libc symbol '+name);
     bound.set(name,functions[name]);
   }
   return bound.get(name);
 }})};
 export const ptr=x=>x,cString=x=>x,errno=()=>libc.symbols.errno(),strerror=code=>libc.symbols.strerror(code),Errno={EINVAL:22,EPERM:1};`);
 const source=readFileSync(new URL('../initramfs/bin/chroot',import.meta.url),'utf8')
  .replace('"../lib/dlopen.js"',JSON.stringify(mock))
  .replace('"../lib/chroot-options.js"',JSON.stringify(new URL('../initramfs/lib/chroot-options.js',import.meta.url).pathname))
  .replace('import { showDocument } from "../lib/document.js";','const showDocument=async()=>{};');
 const entry=join(dir,'chroot.mjs');writeFileSync(entry,source);
 try{
  const child=Bun.spawn([process.execPath,entry,...argumentsFor({dir,root,host}),root,'/bin/true'],{env:{...process.env,...env,TMPDIR:host},stdout:'pipe',stderr:'pipe'});
  const stderr=new Response(child.stderr).text();const status=await child.exited;
  return {status,stderr:await stderr,calls:readFileSync(log,'utf8').trim().split('\n').map(JSON.parse),root,host,dir};
 }finally{rmSync(dir,{recursive:true,force:true});}
}

test('explicit binds work with -n, create files, and unwind in reverse depth order',async()=>{
 const r=await invoke(({dir,host})=>['-n','-b',`${host}:/work`,'-b',`${dir}/file:/work/config/file`]);
 expect(r.status).toBe(0);
 expect(r.calls.filter(c=>c[0]==='mount'&&c[1]===r.host)[0]).toEqual(['mount',r.host,r.root+'/work','none','20480',null]);
 expect(r.calls.filter(c=>c[0]==='umount').map(c=>c[1])).toEqual(['/work/config/file','/work']);
});
test('shared tmp replaces default tmpfs and bind failure cleans up even with -k',async()=>{
 const shared=await invoke(()=>['--shared-tmp']);expect(shared.status).toBe(0);
 expect(shared.calls.some(c=>c[0]==='mount'&&c[1]===shared.host&&c[2]===shared.root+'/tmp')).toBe(true);
 expect(shared.calls.some(c=>c[0]==='mount'&&c[1]==='tmpfs'&&c[2]===shared.root+'/tmp')).toBe(false);
 const failure=await invoke(({host,dir})=>['-n','-k','-b',`${host}:/first`,'-b',`${dir}/fail:/second`]);
 expect(failure.status).toBe(125);expect(failure.stderr).toContain('mock mount denied');
 expect(failure.calls.some(c=>c[0]==='chroot')).toBe(false);
 expect(failure.calls.filter(c=>c[0]==='umount').map(c=>c[1])).toEqual([failure.root+'/first']);
});

test('cleanup symbols are resolved before mounting and remain usable after chroot',async()=>{
 const r=await invoke(({host})=>['-n','-b',`${host}:/work`],{MOCK_UNMOUNT_FAIL:'1'});
 expect(r.status).toBe(0);
 expect(r.stderr).toContain('chroot: unmount /work: mock mount denied');
 expect(r.stderr).not.toContain('Cannot load libc symbol');
 const firstMount=r.calls.findIndex(c=>c[0]==='mount');
 for(const name of ['umount2','strerror','errno']){
   const index=r.calls.findIndex(c=>c[0]==='resolve'&&c[1]===name);
   expect(index).toBeGreaterThanOrEqual(0);expect(index).toBeLessThan(firstMount);
 }
 expect(r.calls.filter(c=>c[0]==='umount').map(c=>c[2])).toEqual([0,2]);
});

test('missing cleanup symbol fails before any mount, including keep-mounts',async()=>{
 const r=await invoke(({host})=>['-n','-k','-b',`${host}:/work`],{MOCK_MISSING_SYMBOL:'umount2'});
 expect(r.status).toBe(125);expect(r.stderr).toContain('Cannot load libc symbol umount2');
 expect(r.calls.some(c=>['mount','chroot','umount'].includes(c[0]))).toBe(false);
});

test('no-mount chroot without binds does not require umount2',async()=>{
 const r=await invoke(()=>['-n'],{MOCK_MISSING_SYMBOL:'umount2'});
 expect(r.status).toBe(0);
 expect(r.calls.some(c=>c[0]==='resolve'&&c[1]==='umount2')).toBe(false);
});
