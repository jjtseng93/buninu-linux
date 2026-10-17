import {test,expect} from 'bun:test';
import {libc,libcPath,errno,strerror,SysError,withInetSocket} from '../initramfs/lib/dlopen.js';
import {spawnSync} from 'node:child_process';
test('host libc loads automatically and exposes the platform errno',()=>{
 expect(libc.symbols.close(-1)).toBe(-1);expect(libcPath.length).toBeGreaterThan(0);expect(errno()).toBe(9);expect(strerror(9)).toContain('descriptor');expect(new SysError('close').errno).toBe(9);
 if(process.platform==='android')expect(libcPath).toBe('libc.so');
});
test('an explicit invalid libc path fails instead of silently falling back',()=>{
 const r=spawnSync(process.execPath,['-e',`const {libc}=await import(${JSON.stringify(new URL('../initramfs/lib/dlopen.js',import.meta.url).href)});libc.symbols.close(-1)`],{env:{...process.env,BUNINU_LIBC:'/nonexistent/buninu-libc.so'},encoding:'utf8'});
 expect(r.status).not.toBe(0);expect(r.stderr).toContain('/nonexistent/buninu-libc.so');
});

test('existing libc socket/ioctl helper still queries loopback without sysfs',()=>{
 const request=Buffer.alloc(40);request.write('lo');
 withInetSocket(ioctl=>ioctl(0x8933,request,'SIOCGIFINDEX'));
 expect(request.readInt32LE(16)).toBeGreaterThan(0);
});

test('manual library resolves only requested symbols and keeps working after a missing symbol',()=>{
 const moduleURL=new URL('../initramfs/lib/dlopen.js',import.meta.url).href;
 const script=`
 import {mock} from 'bun:test';
 const ffi=await import('bun:ffi');
 const calls=[];
 mock.module('bun:ffi',()=>({...ffi,dlopen(path,symbols){
   if(path!=='/manual/partial.so')throw new Error('unexpected fallback');
   const name=Object.keys(symbols)[0];calls.push(name);
   if(name!=='close')throw new Error('missing '+name);
   return {symbols:{close:()=>7},close(){}};
 }}));
 const {libc}=await import(${JSON.stringify(moduleURL)});
 if(calls.length)throw new Error('eager symbol resolution');
 if(libc.symbols.close(0)!==7)throw new Error('supported symbol failed');
 try {libc.symbols.mount;throw new Error('missing symbol accepted');}
 catch(e){if(!e.message.includes('missing mount'))throw e;}
 if(libc.symbols.close(0)!==7)throw new Error('missing symbol poisoned library');
 if(calls.filter(x=>x==='close').length!==1)throw new Error('symbol not cached');
 `;
 const r=spawnSync(process.execPath,['-e',script],{env:{...process.env,BUNINU_LIBC:'/manual/partial.so'},encoding:'utf8'});
 expect(r.stderr).toBe('');expect(r.status).toBe(0);
});
