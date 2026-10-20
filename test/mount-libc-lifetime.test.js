import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Run the real command with a libc whose path disappears after the first
// successful mount change. Never mount or unmount anything on the host.
async function invoke(name,args){
 const dir=mkdtempSync(join(tmpdir(),'buninu-mount-libc-'));
 const mock=join(dir,'libc.mjs');
 writeFileSync(mock,`
 let hidden=false;
 const bound=new Map();
 const functions={mount:()=>{if(hidden)return -1;hidden=true;return 0;},
 umount2:()=>{if(hidden)return -1;hidden=true;return 0;},
 errno:()=>5,strerror:()=> 'mock I/O error'};
 export const libc={symbols:new Proxy({}, {get(_target,name){
   if(!bound.has(name)){
     if(hidden)throw Error('Cannot load libc symbol '+name);
     bound.set(name,functions[name]);
   }
   return bound.get(name);
 }})};
 export const ptr=x=>x,cString=x=>x,errno=()=>libc.symbols.errno(),
 strerror=code=>libc.symbols.strerror(code),Errno={},SysError=class extends Error{};
 `);
 const source=readFileSync(new URL('../initramfs/bin/'+name,import.meta.url),'utf8')
 .replace('"../lib/dlopen.js"',JSON.stringify(mock))
 .replace('import { showDocument } from "../lib/document.js";','const showDocument=async()=>{};')
 .replace('import { modprobe, tryModprobe, modulesDirectory, ModuleNotFound } from "../lib/modprobe.js";',
 'const modprobe=()=>[],tryModprobe=()=>[],modulesDirectory=()=>"";class ModuleNotFound extends Error{}');
 const entry=join(dir,'command.mjs');writeFileSync(entry,source);
 try{
   const child=Bun.spawn([process.execPath,entry,...args],{stdout:'pipe',stderr:'pipe'});
   const stderr=new Response(child.stderr).text();
   return {status:await child.exited,stderr:await stderr};
 }finally{rmSync(dir,{recursive:true,force:true});}
}

test('read-only bind reports remount failure after the libc path is hidden',async()=>{
 const r=await invoke('mount',['--bind','-o','ro','/fake-source','/fake-target']);
 expect(r.status).toBe(32);expect(r.stderr).toContain('mount: mock I/O error');
 expect(r.stderr).not.toContain('Cannot load libc symbol');
});

test('later unmount failure reports strerror after an earlier target hides libc',async()=>{
 const r=await invoke('umount',['/fake-lib','/fake-missing']);
 expect(r.status).toBe(32);expect(r.stderr).toContain('umount: /fake-missing: mock I/O error.');
 expect(r.stderr).not.toContain('Cannot load libc symbol');
});
