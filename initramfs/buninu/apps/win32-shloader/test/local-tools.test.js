import {test, expect} from 'bun:test';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {join,dirname,normalize} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
const source=fileURLToPath(new URL('../../../',import.meta.url));
// Exercise the real bunmsh and production wrappers; only leaf apps are argv
// receivers, so opening editors, browsers, speech or transfers has no side effects.
const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
test.skipIf(process.platform!=='win32'||!process.env.BUNINU_TEST_BUNMSH)('every BAT tool through init --local preserves literal arguments',()=>{
 const root=mkdtempSync(join(tmpdir(),'buninu-all-tools-'));
 const put=(name,data)=>{mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),data)};
 const copy=name=>{mkdirSync(dirname(join(root,name)),{recursive:true});copyFileSync(join(source,name),join(root,name))};
 try{
  for(const name of ['bin/init.js','apps/cmdlist',...['prepare.js','index.js','code.js'].map(n=>'apps/win32-shloader/'+n)])copy(name);
  const bats=readdirSync(join(source,'bin')).filter(n=>n.endsWith('.bat'));
  for(const name of readdirSync(join(source,'bin')).filter(n=>n.endsWith('.bat')||n.endsWith('.sh')))copy('bin/'+name);
  copy('apps/jsmdcui/jsmdcui.sh');
  put('package.json',JSON.stringify({name:'all-tools-probe',version:'0',scripts:{start:'bun apps/bunmsh/index.js',local:'bun apps/bunmsh/index.js'}}));
  put('apps/bunmsh/index.js','import '+JSON.stringify(pathToFileURL(process.env.BUNINU_TEST_BUNMSH).href)+';');
  const receiver='console.log(JSON.stringify({entry:import.meta.path,args:process.argv.slice(2)}));';
  for(const name of ['jsmdcui/src/index.js','jsgotty/gotty.js','jsgotty/rz.js','jsgotty/sz.js','bunx/bunx.js','tts/tts.js','xclip/xclip.js','xdg-open/xdg-open.js','native-bridge/native-bridge.js'])put('apps/'+name,receiver);
  put('receiver.mjs',receiver);
  const args=['','a b','中文 😀','%PATH%','!PATH!','a^b','a&b','a|b','a<b','a>b','(a)','a"b',"a'b",'C:\\space dir\\','a\nb','a\rb','x'.repeat(2048),''];
  // Isolate the test from an outer Buninu shell without changing init's PATH policy.
  const env={...process.env};
  for(const key of Object.keys(env))if(key.toLowerCase()==='path')delete env[key];
  // init is launched by absolute path; afterward every tool, including bun,
  // must resolve to the new EXEs without relying on an external Bun in PATH.
  env.Path=join(process.env.SystemRoot||'C:/Windows','System32');
  const run=cmd=>{put('commands.sh',cmd+'\n');return Bun.spawnSync([process.execPath,join(root,'bin/init.js'),'--local',join(root,'commands.sh')],{cwd:root,env,stdout:'pipe',stderr:'pipe',timeout:20000})};
  for(const bat of bats){
   const name=bat.slice(0,-4);
   const cmd=name==='bun'?['bun',join(root,'receiver.mjs'),...args]:name==='bunmsh'?['bunmsh','-c','exec bun '+quote(join(root,'receiver.mjs'))+' "$@"','probe',...args]:[name,...args];
   const r=run(cmd.map(quote).join(' '));
   expect({tool:name,exit:r.exitCode,error:r.stderr.toString().replace(/^all-tools-probe[^\n]*\n/,'')}).toEqual({tool:name,exit:0,error:''});
   const rows=r.stdout.toString().trim().split(/\r?\n/).map(s=>JSON.parse(s));
   if(name==='buninu-help')expect(rows.map(r=>[r.args[0],normalize(r.args[1])])).toEqual([['--cat',join(root,'README.md')],['--viu',join(root,'icon.png')]]);
   else expect(rows[0].args).toEqual(name==='glow'?['--cat',...args]:name==='showimg'?['--viu',...args]:args);
   expect(rows.every(r=>r.entry.startsWith(root))).toBe(true);
   console.log('PASS '+name);
  }
 }finally{rmSync(root,{recursive:true,force:true})}
},120000);
