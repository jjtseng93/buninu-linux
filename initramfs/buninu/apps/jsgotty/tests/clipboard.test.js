const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {createClipboard,parseOSC52,executeOSC52,handleOSC52,ClipboardHost}=require('../clipboard.js');
const powershell=require('../clipboard-powershell.js');
function fixture(platform,available,results={}){
 const calls=[];const clipboard=createClipboard({platform,find:name=>available.includes(name)?name:null,run:(args,opts)=>{
  calls.push({args,opts});const result=results[args[0]];return typeof result==='function'?result(args,opts):(result||{ok:true,stdout:'value'});
 }});return {clipboard,calls};
}
test('xclip is first on Linux, Android, macOS and Windows',()=>{
 for(const platform of ['linux','android','darwin','win32']){
  const f=fixture(platform,['xclip','wl-copy','wl-paste','termux-clipboard-set','termux-clipboard-get','pbcopy','pbpaste','powershell.exe']);
  f.clipboard.write('你好');assert.equal(f.clipboard.read(),'value');
  assert.deepEqual(f.calls.map(c=>c.args[0]),['xclip','xclip']);
  assert.equal(f.calls[0].opts.stdin,'你好');
 }
});
test('missing or failing backends fall through per operation; empty read is success',()=>{
 const f=fixture('android',['xclip','termux-clipboard-get','termux-clipboard-set','wl-paste'],{
  xclip:{ok:false},'termux-clipboard-get':{ok:true,stdout:''},'termux-clipboard-set':{ok:true},
 });
 f.clipboard.write('cached');assert.equal(f.clipboard.read(),'');
 assert.deepEqual(f.calls.map(c=>c.args[0]),['xclip','termux-clipboard-set','xclip','termux-clipboard-get']);
 const g=fixture('linux',['wl-paste','xsel'],{'wl-paste':{ok:false}});
 assert.equal(g.clipboard.read(),'value');assert.deepEqual(g.calls.map(c=>c.args[0]),['wl-paste','xsel']);
});
test('failed host access uses cache; every read retries host before cache',()=>{
 let fail=false;const f=fixture('linux',['xclip'],{xclip:()=>fail?{ok:false}:{ok:true,stdout:'fresh'}});
 f.clipboard.write('cached');fail=true;assert.equal(f.clipboard.read(),'cached');
 fail=false;assert.equal(f.clipboard.read(),'fresh');assert.equal(f.calls.length,3);
});
test('selections, base64 Unicode, clearing and queries use OSC52 responses',()=>{
 const c=createClipboard({find:()=>null});const encoded=Buffer.from('你好\ntext').toString('base64');
 assert.equal(executeOSC52(c,parseOSC52('cp;'+encoded)),null);
 assert.equal(executeOSC52(c,parseOSC52('p;?')),`\x1b]52;p;${encoded}\x1b\\`);
 executeOSC52(c,parseOSC52('c;!'));assert.equal(executeOSC52(c,parseOSC52('c;?')),'\x1b]52;c;\x1b\\');
 executeOSC52(c,parseOSC52(';'+encoded));assert.equal(c.read('cut0'),'你好\ntext');
 assert.equal(parseOSC52('invalid;?'),null);assert.equal(parseOSC52('c;'+ 'A'.repeat(1048576)),null);
});
test('PowerShell uses original quote escaping and strips exactly one line ending',()=>{
 const calls=[];const p=powershell('powershell.exe',(args,options)=>{calls.push({args,options});return {ok:true,stdout:'text\r\n\r\n'};},r=>r.stdout);
 assert.equal(p.read(),'text\r\n');assert.equal(p.write("a'b\n$literal"),true);
 assert.equal(calls[1].args[3],"Set-Clipboard 'a''b\n$literal'");
});
test('read-only connections cannot access host clipboard or inject replies',async()=>{
 let writer=false,resolve;const writes=[],requests=[];
 const session={closed:false,isWriter:()=>writer,backend:{write:b=>writes.push(b.toString())}};
 const host={execute:r=>{requests.push(r);return new Promise(r=>resolve=r);}};
 handleOSC52(session,{},'c;?',host);assert.equal(requests.length,0);
 writer=true;handleOSC52(session,{},'c;?',host);assert.equal(requests.length,1);
 writer=false;resolve('secret');await Promise.resolve();assert.equal(writes.length,0);
 writer=true;handleOSC52(session,{},'c;?',host);resolve('reply');await Promise.resolve();assert.deepEqual(writes,['reply']);
});
test('worker preserves ordered writes/reads without touching system clipboard',async()=>{
 const host=new ClipboardHost();
 try{
  const encoded=Buffer.from('isolated cut buffer').toString('base64');
  const write=host.execute(parseOSC52('7;'+encoded));const read=host.execute(parseOSC52('7;?'));
  assert.equal(await write,null);assert.equal(await read,`\x1b]52;7;${encoded}\x1b\\`);
 }finally{await host.close();}
});

test('vendored PowerShell function remains byte-for-byte identical to jsmdcui',()=>{
 const source=fs.readFileSync(require.resolve('../clipboard-powershell.js'),'utf8');
 const body=source.slice(source.indexOf('function powershellClipboard(shell) {'),source.indexOf('\nreturn powershellClipboard(shell);'));
 assert.equal(crypto.createHash('sha256').update(body).digest('hex'),'38246f0cea399f9c6a56ac8716e11b8d3fba89233b439f31011cc75a47a7d241');
});

test('large and unpadded base64 payloads parse without recursive regexp overflow',()=>{
 const text='x'.repeat(500000);assert.equal(parseOSC52('c;'+Buffer.from(text).toString('base64')).text,text);
 assert.equal(parseOSC52('c;aGk').text,'hi');
 assert.deepEqual(parseOSC52('cs;?').registers,['clipboard']);
});
