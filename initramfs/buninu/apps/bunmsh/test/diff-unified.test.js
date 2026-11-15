import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {unifiedFileDiff} from '../src/diff.js';
const labels=['before','after'];
test('unified hunks cover changes, context, empty ranges and missing LF',()=>{
 expect(unifiedFileDiff('a\nb\nc\n','a\nx\nc\n',{labels})).toBe('--- before\n+++ after\n@@ -1,3 +1,3 @@\n a\n-b\n+x\n c\n');
 expect(unifiedFileDiff('','x\n',{labels,context:0})).toBe('--- before\n+++ after\n@@ -0,0 +1 @@\n+x\n');
 expect(unifiedFileDiff('x\n','',{labels,context:0})).toBe('--- before\n+++ after\n@@ -1 +0,0 @@\n-x\n');
 expect(unifiedFileDiff('x','x\n',{labels})).toBe('--- before\n+++ after\n@@ -1 +1 @@\n-x\n\\ No newline at end of file\n+x\n');
 expect(unifiedFileDiff('same','same',{labels})).toBe('');
});
test('builtin accepts Flea argv, option variants, Unicode labels, and GNU-compatible hunks',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bunmsh-unified-'));
 const a=join(dir,'before'),b=join(dir,'after');
 const run=async args=>{const p=Bun.spawn([process.execPath,fileURLToPath(new URL('../index.js',import.meta.url)),'-cc','builtin','diff',...args],{stdout:'pipe',stderr:'pipe',env:{...process.env,NO_COLOR:'1',FORCE_COLOR:'0'}});return {code:await p.exited,out:await new Response(p.stdout).text(),err:await new Response(p.stderr).text()}};
 try {
  const cases=[['a\nb\nc\n','a\nx\nc\n'],['','new\n'],['gone\n',''],['last','last\n'],['中文\n','日文\n'],['a\nb\nc\nd\ne\nf\ng\nh\ni\n','A\nb\nc\nd\ne\nf\ng\nh\nI\n']];
  for(const [left,right] of cases){
   writeFileSync(a,left);writeFileSync(b,right);
   for(const flags of [['-u'],['-U','0'],['-U1'],['--unified=2']]){
    const args=[...flags,'--label','前檔','--label','後檔','--',a,b];
    const r=await run(args);expect(r.code).toBe(1);expect(r.err).toBe('');
    expect(r.out).toBe(unifiedFileDiff(left,right,{context:flags[0]==='-u'?3:flags[0]==='-U'?0:flags[0]==='-U1'?1:2,labels:['前檔','後檔']}));
    if(process.platform!=='win32' && Bun.which('diff')){
     const p=Bun.spawn([Bun.which('diff'),...args],{stdout:'pipe',stderr:'pipe',env:{...process.env,LC_ALL:'C'}});
     expect(await new Response(p.stdout).text()).toBe(r.out);expect(await p.exited).toBe(1);
    }
   }
  }
  expect((await run(['-u',a,a])).code).toBe(0);
  expect((await run(['-u',a,b+'missing'])).code).toBe(2);
  for(const flags of [['-U','-1'],['-U','x'],['--label'],['-U','9007199254740992']]) expect((await run(flags)).code).toBe(2);
  const defaults=await run(['-u',a,b]);expect(defaults.out).toMatch(/^--- [^\n]*\t\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{9} [+-]\d{4}\n/);
  if(process.platform!=='win32' && Bun.which('diff')){
   const p=Bun.spawn([Bun.which('diff'),'-u',a,b],{stdout:'pipe',stderr:'pipe',env:{...process.env,LC_ALL:'C'}});
   expect(defaults.out).toBe(await new Response(p.stdout).text());
  }
  const short=await run(['-u','-Lfirst','--label=second',a,b]);expect(short.out).toStartWith('--- first\n+++ second\n');
 }finally{rmSync(dir,{recursive:true,force:true})}
},30000);

test('builtin diff keeps Chinese, emoji and bytes that are not UTF-8 as they are',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'bunmsh-diff-bytes-'));
 const a=join(dir,'前😀'),b=join(dir,'後🎉');
 try {
  writeFileSync(a,Buffer.concat([Buffer.from('表情👍🏽\nm'),Buffer.from([0xff]),Buffer.from('\n家👨‍👩‍👧\n')]));
  writeFileSync(b,Buffer.concat([Buffer.from('表情👍🏿\nm'),Buffer.from([0xfe]),Buffer.from('\n家👨‍👩‍👧\n')]));
  for(const flags of [[],['-u','--label','舊😀','--label','新🎉']]){
   const p=Bun.spawn([process.execPath,fileURLToPath(new URL('../index.js',import.meta.url)),'-cc','builtin','diff',...flags,a,b],{stdout:'pipe',stderr:'pipe'});
   const out=Buffer.from(await new Response(p.stdout).arrayBuffer());
   expect(await p.exited).toBe(1);
   expect(out.includes(Buffer.from([0x6d,0xff,0x0a]))).toBe(true);
   expect(out.includes(Buffer.from([0x6d,0xfe,0x0a]))).toBe(true);
   expect(out.toString()).toContain('👍🏽');
   if(flags.length) expect(out.toString()).toStartWith('--- 舊😀\n+++ 新🎉\n');
  }
 }finally{rmSync(dir,{recursive:true,force:true})}
},30000);
