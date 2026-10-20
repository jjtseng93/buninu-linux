const test=require('node:test');
const assert=require('node:assert/strict');
const {KittyKeyboard,SUPPORTED}=require('../static/js/kitty-keyboard.js');
function setup(android=true) {
  const handlers=new Map(),sent=[];
  const term={parser:{registerCsiHandler:(id,fn)=>{handlers.set((id.prefix||id.intermediates||'')+id.final,fn);return {dispose(){}};},registerEscHandler:(id,fn)=>{handlers.set('ESC'+id.final,fn);return {dispose(){}};}},buffer:{active:{type:'normal'}},options:{},input:(s,user)=>sent.push([s,user])};
  const keyboard=new KittyKeyboard(term,{android});
  const mode=(prefix,params=[])=>handlers.get(prefix+'u')(params);
  const event=(options={})=>({type:'keydown',key:'a',code:'KeyA',keyCode:65,location:0,repeat:false,ctrlKey:false,altKey:false,shiftKey:false,metaKey:false,getModifierState:()=>false,preventDefault(){this.prevented=true;},stopPropagation(){},...options});
  const send=options=>{const e=event(options);return {e,result:keyboard.handle(e)};};
  return {keyboard,term,sent,handlers,mode,send,event};
}
test('negotiation, bit operations, bounded stacks, separate screens and reset',()=>{
 const t=setup();t.mode('?');assert.deepEqual(t.sent.pop(),['\x1b[?0u',false]);
 t.mode('>',[11]);t.mode('>',[1]);t.mode('<');assert.equal(t.keyboard.flags,11);
 t.mode('=',[2,3]);assert.equal(t.keyboard.flags,9);t.mode('=',[2,2]);assert.equal(t.keyboard.flags,11);
 t.term.buffer.active.type='alternate';assert.equal(t.keyboard.flags,0);t.mode('>',[3]);
 t.term.buffer.active.type='normal';assert.equal(t.keyboard.flags,11);
 for(let i=0;i<100;i++)t.mode('>',[1]);assert.equal(t.keyboard.state.stack.length,32);
 t.mode('<',[99999]);assert.equal(t.keyboard.flags,0);
 t.mode('=',[31]);assert.equal(t.keyboard.flags,SUPPORTED);t.mode('=',[0]);assert.equal(t.keyboard.flags,0);
 t.handlers.get('ESCc')();t.term.buffer.active.type='alternate';assert.equal(t.keyboard.flags,0);
});
test('all sixteen Shift/Alt/Ctrl/Super combinations stay distinct for all letters and navigation',()=>{
 for(const key of [...'abcdefghijklmnopqrstuvwxyz','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab','Enter','Backspace','Insert','PageUp','PageDown','F1','F12','PrintScreen']) {
  const seen=new Set();
  for(let mask=0;mask<16;mask++) {
   const t=setup();t.mode('>',[11]);t.send({key,code:key.length===1?'Key'+key.toUpperCase():key,shiftKey:!!(mask&1),altKey:!!(mask&2),ctrlKey:!!(mask&4),metaKey:!!(mask&8)});
   assert.equal(t.sent.length,1,`${key} ${mask}`);seen.add(t.sent[0][0]);
  }
  assert.equal(seen.size,16,key);
 }
});
test('Android Meta pair repairs missing metaKey, including keyup and combinations',()=>{
 const t=setup();t.mode('>',[11]);
 t.send({key:'Meta',code:'',keyCode:91});
 assert.deepEqual(t.sent.pop(),['\x1b[57444;9u',true]);
 const {e}=t.send({key:'x',code:'',keyCode:88,ctrlKey:true,shiftKey:true});
 assert.equal(e.metaKey,true);assert.equal(e.getModifierState('Meta'),true);
 assert.deepEqual(t.sent.pop(),['\x1b[120;14u',true]);
 t.send({type:'keyup',key:'x',code:'',keyCode:88,ctrlKey:true,shiftKey:true});assert.equal(t.sent.pop()[0],'\x1b[120;14:3u');
 t.send({type:'keyup',key:'Meta',code:'',keyCode:91});assert.equal(t.sent.pop()[0],'\x1b[57444;1:3u');
 t.send({key:'x',code:'KeyX'});assert.equal(t.sent.pop()[0],'\x1b[120u');
});
test('both Meta keys, repeats and focus cleanup do not leave modifiers held',()=>{
 const t=setup();t.mode('>',[11]);
 t.send({key:'Meta',code:'MetaLeft',location:1});t.send({key:'Meta',code:'MetaRight',location:2});
 t.send({type:'keyup',key:'Meta',code:'MetaLeft',location:1});assert.equal(t.sent.at(-1)[0],'\x1b[57444;9:3u');
 t.send({repeat:true});assert.equal(t.sent.at(-1)[0],'\x1b[97;9:2u');
 t.keyboard.clearHeld();assert.equal(t.keyboard.metaKeys.size,0);
 t.send();assert.equal(t.sent.at(-1)[0],'\x1b[97u');
});
test('legacy remains unchanged; disabling mode restores text and ordinary controls',()=>{
 const t=setup();assert.equal(t.send({ctrlKey:true}).result,true);assert.equal(t.sent.length,0);
 t.mode('>',[1]);assert.equal(t.send().result,true);
 for(const key of ['Tab','Enter','Backspace'])assert.equal(t.send({key,code:key}).result,true);
 t.send({ctrlKey:true,key:'i',code:'KeyI'});assert.equal(t.sent.pop()[0],'\x1b[105;5u');
 t.send({ctrlKey:true,shiftKey:true,key:'I',code:'KeyI'});assert.equal(t.sent.pop()[0],'\x1b[105;6u');
 t.mode('<');assert.equal(t.send({ctrlKey:true}).result,true);
});
test('printable keys in disambiguation mode do not generate release events',()=>{
 const t=setup();t.mode('>',[3]);t.send();t.send({type:'keyup'});assert.equal(t.sent.length,0);
 t.send({ctrlKey:true});t.send({type:'keyup',ctrlKey:true});assert.deepEqual(t.sent.map(s=>s[0]),['\x1b[97;5u','\x1b[97;5:3u']);
});
test('dead Alt keys recover before encoding; regular composition is untouched',()=>{
 const t=setup();t.mode('>',[11]);
 for(const k of 'ENUI'){t.send({key:'Dead',code:'Key'+k,altKey:true});assert.equal(t.sent.pop()[0],`\x1b[${k.toLowerCase().charCodeAt(0)};3u`);}
 assert.equal(t.send({isComposing:true,key:'Process'}).result,true);
 assert.equal(t.send({key:'Dead',altKey:false}).result,true);
});
test('AltGr is not encoded as Ctrl+Alt; non-Latin layout key values are preserved',()=>{
 const t=setup();t.mode('>',[11]);
 t.send({key:'€',code:'KeyE',ctrlKey:true,altKey:true,getModifierState:k=>k==='AltGraph'});assert.equal(t.sent.pop()[0],'\x1b[8364u');
 t.send({key:'ф',code:'KeyA',ctrlKey:true});assert.equal(t.sent.pop()[0],'\x1b[1092;5u');
});
test('keypad, media and lock modifiers have dedicated encodings',()=>{
 const t=setup();t.mode('>',[11]);
 t.send({key:'Enter',code:'NumpadEnter',location:3});assert.equal(t.sent.pop()[0],'\x1b[57414u');
 t.send({key:'AudioVolumeUp',code:'AudioVolumeUp'});assert.equal(t.sent.pop()[0],'\x1b[57439u');
 t.send({getModifierState:k=>k==='CapsLock'});assert.equal(t.sent.pop()[0],'\x1b[97;65u');
});
test('normal non-Android Meta and input disabled are not rewritten',()=>{
 const t=setup(false);t.mode('>',[11]);t.send({key:'Meta',code:'MetaLeft'});const {e}=t.send();assert.equal(e.metaKey,false);
 t.term.options.disableStdin=true;const count=t.sent.length;assert.equal(t.send({metaKey:true}).result,true);assert.equal(t.sent.length,count);
});
test('keypress cannot duplicate encoded keydown, but later ordinary text is not swallowed',()=>{
 const t=setup();t.mode('>',[1]);t.send({ctrlKey:true});assert.equal(t.send({type:'keypress',ctrlKey:true}).result,false);
 t.send({key:'b',code:'KeyB'});assert.equal(t.send({type:'keypress',key:'b',code:'KeyB'}).result,true);
});
test('Android release-only accent shortcuts still use Kitty encoding',()=>{
 const t=setup();t.mode('>',[11]);t.send({type:'keyup',key:'Dead',code:'',keyCode:69,altKey:true});
 assert.deepEqual(t.sent.map(x=>x[0]),['\x1b[101;3u','\x1b[101;3:3u']);
});
test('Omarchy workspace and monitor chords retain all modifiers',()=>{
 for(const key of [...'1234567890','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab','Home','`']) {
  const t=setup();t.mode('>',[11]);
  t.send({key,code:key.length===1?'':key,metaKey:true,shiftKey:true,altKey:true});
  assert.match(t.sent.at(-1)[0],/;12[~uABCDH]$/);
  t.send({key,code:key.length===1?'':key,metaKey:true,shiftKey:true,ctrlKey:true});
  assert.match(t.sent.at(-1)[0],/;14[~uABCDH]$/);
 }
});
