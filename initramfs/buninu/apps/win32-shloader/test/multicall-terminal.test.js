import {test, expect} from 'bun:test';
import {mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath, pathToFileURL} from 'node:url';
const source=fileURLToPath(new URL('../../../',import.meta.url));

// Exercise the Windows multicall branch inside a real PTY on POSIX, where
// Bun.Terminal is available. Real Windows ConPTY is also checked manually.
test.skipIf(process.platform==='win32')('multicall shell fallback preserves terminal streams and arguments',async()=>{
 const root=mkdtempSync(join(tmpdir(),'buninu-multicall-tty-'));
 let terminal,proc,timer,text='';
 try{
  for(const dir of ['bin','apps/bunmsh','apps/probe'])mkdirSync(join(root,dir),{recursive:true});
  copyFileSync(join(source,'bin/multicall.sh'),join(root,'bin/multicall.sh'));
  writeFileSync(join(root,'apps/bunmsh/index.js'),'import '+JSON.stringify(pathToFileURL(join(source,'apps/bunmsh/index.js')).href)+';');
  writeFileSync(join(root,'apps/probe/probe.sh'),'exec bun "$(dirname "$0")/probe.js" "$@"\n');
  writeFileSync(join(root,'apps/probe/probe.js'),'console.log("PROBE="+JSON.stringify({tty:[!!process.stdin.isTTY,!!process.stdout.isTTY,!!process.stderr.isTTY],args:process.argv.slice(2)}));');
  terminal=new Bun.Terminal({cols:120,rows:24,data(t,data){text+=data.toString()}});
  const args=['','space 中文','a&b','%PATH%','a"b'];
  proc=Bun.spawn([process.execPath,join(root,'apps/bunmsh/index.js'),join(root,'bin/multicall.sh'),...args],{env:{...process.env,BUNINU_SH_CALLER:join(root,'bin/probe.exe')},terminal});
  timer=setTimeout(()=>proc.kill(),10000);
  expect(await proc.exited).toBe(0);
  await Bun.sleep(30);
  const line=Bun.stripANSI(text).split(/\r?\n/).find(line=>line.startsWith('PROBE='));
  expect(JSON.parse(line.slice(6))).toEqual({tty:[true,true,true],args});
 }finally{
  clearTimeout(timer);
  if(proc&&proc.exitCode===null){proc.kill();await proc.exited;}
  terminal?.close();rmSync(root,{recursive:true,force:true});
 }
},15000);
