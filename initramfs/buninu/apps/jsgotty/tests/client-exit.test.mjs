import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../client.mjs',import.meta.url),'utf8');
const methods=source.slice(source.indexOf('  let exiting = false;'),source.indexOf('  const stopViewerInput ='));
function fixture(){
 const calls=[],callbacks=[];
 const handlers=vm.runInNewContext(`(()=>{${methods};return {exitClient,handleViewerInput};})()`,{
  cleanup:()=>calls.push('cleanup'),reportDisconnected:()=>calls.push('report'),
  ws:{close:()=>calls.push('close')},terminalInput:b=>b,
  process:{stdout:{write:(s,done)=>callbacks.push(done)},exit:code=>calls.push(code)},
 });
 return {calls,callbacks,...handlers};
}
for(const [input,code] of [[[3,4],130],[[4,3],0],[[17,3],0]]){
 test(`viewer exit handles first key only: ${input}`,()=>{
  const f=fixture();f.handleViewerInput(Buffer.from(input));
  assert.deepEqual(f.calls,['cleanup','report','close']);assert.equal(f.callbacks.length,1);
  assert.ok(!f.calls.includes(code),'does not exit before output flush');
  f.callbacks[0]();assert.equal(f.calls.at(-1),code);
 });
}
test('concurrent exit requests queue only one flush and retain first exit code',()=>{
 const f=fixture();f.exitClient(130);f.exitClient(143);f.exitClient(0);
 assert.equal(f.callbacks.length,1);assert.deepEqual(f.calls,['cleanup','report','close']);
 f.callbacks[0]();assert.equal(f.calls.at(-1),130);
});
for (const [key, code] of [[99,130],[100,0],[113,0]]) {
 for (const sequence of ['\x1b['+key+';5u', '\x1b['+key+';5:1u', '\x1b['+key+';197u', '\x1b[27;5;'+key+'~']) {
  test('viewer encoded Ctrl key '+JSON.stringify(sequence)+' split',()=>{
   const f=fixture();
   for(const byte of Buffer.from(sequence)) f.handleViewerInput(Buffer.from([byte]));
   assert.equal(f.callbacks.length,1);f.callbacks[0]();assert.equal(f.calls.at(-1),code);
  });
 }
}
test('viewer ignores release and other modifiers before exit press',()=>{
 const f=fixture();
 for(const sequence of ['\x1b[99;5:3u','\x1b[100;1u','\x1b[113;7u','\x1b[<0;99;100M'])
  f.handleViewerInput(Buffer.from(sequence));
 assert.equal(f.callbacks.length,0);
 f.handleViewerInput(Buffer.from('\x1b[113;5:2u'));
 assert.equal(f.callbacks.length,1);
});
