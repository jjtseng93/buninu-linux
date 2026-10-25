import test from 'node:test';
import assert from 'node:assert/strict';
import {ModeProbe,captureTerminalModes} from '../client-modes.mjs';
import modes from '../terminal-modes.js';
import {PassThrough} from 'node:stream';
const {TerminalModeTracker}=modes;
test('private reply split at every byte preserves typing and both Kitty stacks',()=>{
 const p=new ModeProbe('a'.repeat(32));const t=new TerminalModeTracker();
 t.consume(Buffer.from('\x1b[>1u\x1b[?1049h\x1b[>11u'));
 const reply=p.privatePrefix+Buffer.from(JSON.stringify(t.snapshot())).toString('base64')+'\x07';
 const out=[];for(const c of Buffer.from('before'+reply+'after'))out.push(p.consume(Buffer.from([c])));
 assert.equal(Buffer.concat(out).toString(),'beforeafter');assert.equal(p.complete,true);assert.deepEqual(p.state,t.snapshot());
 assert.equal(p.consume('\x1b').toString(),'\x1b','Escape is immediate after successful negotiation');
});
test('standard replies are consumed once; later application queries pass unchanged',()=>{
 const p=new ModeProbe();p.standardQuery();
 const replies='\x1b[?1049;2$y\x1b[?1002;1$y\x1b[?7;0$y\x1b[?11u';
 assert.equal(p.consume(replies).length,0);assert.equal(p.state.mouse,'DRAG');assert.equal(p.state.alternate,false);
 assert.equal(p.state.kitty.normal.flags,11);assert.equal(p.state.dec.wraparound,null);
 assert.equal(p.consume(replies).toString(),replies);
});
test('no reply does not mean defaults, nor intercept application replies forever',()=>{
 const p=new ModeProbe();p.standardQuery();p.replyDeadline=1;
 const reply='\x1b[?1049;1$y\x1b[?11u';assert.equal(p.consume(reply).toString(),reply);
 assert.equal(p.state.alternate,null);assert.equal(p.state.kitty.normal.flags,null);
});
test('foreign nonce, keys, mouse and a large paste are transparent',()=>{
 const p=new ModeProbe();const data=Buffer.from('\x1b]777;jsgotty-modes;other;ignored\x07\x1b[<64;3;4M'+ '漢字'.repeat(200000));
 assert.deepEqual(p.consume(data),data);
});
test('capture falls back after silence and restores stdin raw state',async()=>{
 const input=new PassThrough();input.isTTY=true;input.isRaw=false;input.setRawMode=v=>{input.isRaw=v;};
 const output=new PassThrough();output.isTTY=true;const sent=[];output.on('data',b=>sent.push(b.toString()));
 const result=await captureTerminalModes(input,output,{timeout:30});
 assert.equal(input.isRaw,false);assert.equal(result.state.mouse,null);assert.equal(sent.length,2);
 assert.match(sent[0],/jsgotty-modes/);assert.match(sent[1],/\?1049\$p/);
});

for (const unsupportedFirst of [false,true]) {
 test(`unsupported mouse modes count as inactive replies (${unsupportedFirst?'first':'last'})`,()=>{
  const p=new ModeProbe();p.standardQuery();
  const known='\x1b[?1000;2$y\x1b[?1002;2$y\x1b[?1003;2$y\x1b[?1006;2$y';
  const unsupported='\x1b[?9;0$y\x1b[?1016;0$y';
  p.consume(unsupportedFirst?unsupported+known:known+unsupported);
  assert.equal(p.state.mouse,'NONE');assert.equal(p.state.encoding,'DEFAULT');
  p.consume('\x1b[?7;0$y\x1b[?25;0$y\x1b[?1049;0$y');
  assert.equal(p.state.dec.wraparound,null);assert.equal(p.state.cursorHidden,null);assert.equal(p.state.alternate,null);
  const local=new TerminalModeTracker();Object.assign(local,structuredClone(p.state));
  local.consume(Buffer.from('\x1b[?1003h\x1b[?1006h'));
  const cleanup=modes.modeTransition(local.snapshot(),p.state);
  assert.ok(cleanup.includes('\x1b[?1003l'));assert.ok(cleanup.includes('\x1b[?1006l'));
  local.consume(Buffer.from(cleanup));assert.equal(local.mouse,'NONE');assert.equal(local.encoding,'DEFAULT');
 });
}
test('unsupported replies do not override active modes or fill unanswered fields',()=>{
 const p=new ModeProbe();p.standardQuery();
 p.consume('\x1b[?9;0$y\x1b[?1016;0$y');
 assert.equal(p.state.mouse,null);assert.equal(p.state.encoding,null);
 p.consume('\x1b[?1002;1$y\x1b[?1006;1$y');
 assert.equal(p.state.mouse,'DRAG');assert.equal(p.state.encoding,'SGR');
 p.consume('\x1b[?1000;0$y\x1b[?1003;0$y');
 assert.equal(p.state.mouse,'DRAG');
});

test('multiple active replies preserve individual switches and select explicit priorities',()=>{
 const p=new ModeProbe();p.standardQuery();
 for(const n of [1003,1002,1000,1016,1006])p.consume(`\x1b[?${n};1$y`);
 p.consume('\x1b[?9;2$y');
 assert.equal(p.state.mouse,'ANY');assert.equal(p.state.encoding,'SGR_PIXELS');
 assert.deepEqual(p.state.mouseModeBits,{9:false,1000:true,1002:true,1003:true});
 assert.deepEqual(p.state.mouseEncodingBits,{1006:true,1016:true});
 assert.deepEqual(modes.validateSnapshot(p.state),p.state);
 const bits={9:true,1000:false,1002:false,1003:false,1006:false,1016:false};
 const cleanup=modes.modeTransition(new TerminalModeTracker().snapshot(),p.state);
 for(const [,n,on] of cleanup.matchAll(/\x1b\[\?(\d+)([hl])/g))bits[n]=on==='h';
 assert.deepEqual(bits,{...p.state.mouseModeBits,...p.state.mouseEncodingBits});
 // The same sequence on an exclusive xterm-style terminal ends at the
 // effective mode, without trying to change its parser semantics.
 const exclusive=new TerminalModeTracker();exclusive.consume(Buffer.from(cleanup));
 assert.equal(exclusive.mouse,'ANY');assert.equal(exclusive.encoding,'SGR_PIXELS');
});

test('partial query restoration leaves unreported switches untouched',()=>{
 const p=new ModeProbe();p.standardQuery();p.consume('\x1b[?1000;2$y\x1b[?1006;1$y');
 const cleanup=modes.modeTransition(new TerminalModeTracker().snapshot(),p.state,{normalizeMouse:true});
 assert.equal(cleanup,'\x1b[?1000l\x1b[?1006h');
});

test('normalization clears every conflicting switch, even if aggregate appears unchanged',()=>{
 for(const target of [{mouse:'NONE',encoding:'DEFAULT'},{mouse:'VT200',encoding:'SGR'}]){
  const state={...new TerminalModeTracker().snapshot(),...target};
  const bits={9:true,1000:true,1002:true,1003:true,1006:true,1016:true};
  const seq=modes.modeTransition(state,state,{normalizeMouse:true});
  for(const [,n,on] of seq.matchAll(/\x1b\[\?(\d+)([hl])/g))bits[n]=on==='h';
  assert.deepEqual(bits,{9:false,1000:target.mouse==='VT200',1002:false,1003:false,1006:target.encoding==='SGR',1016:false});
 }
});

test('hidden Kitty restore requires an explicit capability in a valid private reply',()=>{
 for(const advertised of [undefined,0,true,1]){
  const p=new ModeProbe(),reply={...new TerminalModeTracker().snapshot(),kittyRestore:advertised};
  p.consume(p.privatePrefix+Buffer.from(JSON.stringify(reply)).toString('base64')+'\x07');
  assert.equal(p.complete,true);assert.equal(p.kittyRestore,advertised===1);
 }
});
