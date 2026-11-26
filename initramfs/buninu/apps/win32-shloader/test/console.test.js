import {test,expect} from 'bun:test';
import {mkdtempSync,copyFileSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildLoader} from '../index.js';

// Must run in a Windows console/ConPTY: pipe-only tests cannot detect lost TTYs.
test.skipIf(process.platform!=='win32'||![process.stdin,process.stdout,process.stderr].every(s=>s.isTTY))('non-inheritable console handles survive a nested Bun launcher',()=>{
 const root=mkdtempSync(join(tmpdir(),'buninu-console-'));
 try{
  const runtime=join(root,process.arch==='arm64'?'bun-wa.exe':'bun-wx.exe');
  const loader=join(root,'bun.exe'), parent=join(root,'parent.mjs'), child=join(root,'child.mjs'), report=join(root,'result.json');
  copyFileSync(process.execPath,runtime);
  writeFileSync(loader,buildLoader(process.arch,'bun'));
  writeFileSync(child,'import fs from "node:fs";fs.writeFileSync(process.argv[2],JSON.stringify([!!process.stdin.isTTY,!!process.stdout.isTTY,!!process.stderr.isTTY]));');
  writeFileSync(parent,`
    import {dlopen,FFIType as T,ptr} from 'bun:ffi';
    const lib=dlopen('kernel32.dll',{
      GetStdHandle:{args:[T.i32],returns:T.ptr},
      SetHandleInformation:{args:[T.ptr,T.u32,T.u32],returns:T.i32},
      GetHandleInformation:{args:[T.ptr,T.ptr],returns:T.i32}
    });
    const k=lib.symbols, handles=[-10,-11,-12].map(n=>k.GetStdHandle(n));
    for(const h of handles)if(!k.SetHandleInformation(h,1,0))throw Error('cannot clear inherit flag');
    const result=Bun.spawnSync([${JSON.stringify(loader)},${JSON.stringify(child)},${JSON.stringify(report)}],{stdio:['inherit','inherit','inherit']});
    for(const h of handles){const flags=new Uint32Array(1);if(!k.GetHandleInformation(h,ptr(flags))||(flags[0]&1))throw Error('parent handle flags changed');}
    lib.close();process.exit(result.exitCode??1);
  `);
  const r=Bun.spawnSync([runtime,parent],{stdio:['inherit','inherit','inherit'],timeout:120000});
  expect(r.exitCode).toBe(0);
  expect(JSON.parse(readFileSync(report,'utf8'))).toEqual([true,true,true]);
 }finally{rmSync(root,{recursive:true,force:true});}
},150000);
