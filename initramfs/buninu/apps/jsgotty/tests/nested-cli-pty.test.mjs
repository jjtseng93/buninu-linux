// Actual client.mjs processes and PTYs over WebSockets; servers below simulate
// only attach/detach and preserve the production TerminalModeTracker snapshots.
// bun test tests/nested-cli-pty.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import modes from '../terminal-modes.js';
const {TerminalModeTracker}=modes;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,label){for(let i=0;i<300;i++){if(check())return;await sleep(10);}throw Error('Timed out: '+label);}
function tracker(sequence=''){const t=new TerminalModeTracker();t.consume(Buffer.from(sequence));return t;}
function simulatedServer(initial, viewer=false){
 const state=tracker(initial);let socket=null,input=()=>{};
 const server=Bun.serve({hostname:'127.0.0.1',port:0,
  fetch(req,server){if(server.upgrade(req))return;return new Response('fixture');},
  websocket:{
   message(ws,message){const text=String(message);
    if(text[0]==='{'){
     socket=ws;ws.send('m'+JSON.stringify({...state.snapshot(),kittyRestore:1}));
     ws.send('a'+JSON.stringify({role:viewer?'viewer':'writer',writable:!viewer}));
    }else if(text[0]==='1')input(Buffer.from(text.slice(1),'base64'));
    else if(text[0]==='2')ws.send('2');
   },close(ws){if(socket===ws)socket=null;}
  }});
 return {state,server,get socket(){return socket;},set input(fn){input=fn;},
  output(data){state.consume(Buffer.from(data));socket?.send('1'+Buffer.from(data).toString('base64'));},
  detach(){socket?.close(1000,'test detach');},
  url:`ws://127.0.0.1:${server.port}/ws`};
}
const client=path.resolve(import.meta.dirname,'../client.mjs');
function spawnClient(url,onData){
 return Bun.spawn([process.execPath,client,url,'-r','preserved'],{
  terminal:{cols:100,rows:30,data(terminal,data){onData(terminal,Buffer.from(data));}},
 });
}
// Emulate the outer browser's private parser reply; the separate Chromium test
// checks this against the real bundled xterm parser and rendering queue.
function terminalEndpoint(parent){
 const state=tracker();Object.assign(state,structuredClone(parent));let pending='',output='';
 return {state,get output(){return output;},data(terminal,data){
  output+=data.toString('latin1');
  state.consume(data);pending+=data.toString('latin1');
  const re=/\x1b\]777;jsgotty-modes;([a-f0-9]{32})\x07/g;let m;
  while((m=re.exec(pending)))terminal.write(`\x1b]777;jsgotty-modes;${m[1]};${Buffer.from(JSON.stringify({...state.snapshot(),kittyRestore:1})).toString('base64')}\x07`);
  const start=pending.lastIndexOf('\x1b]');pending=start>=0&&!pending.slice(start).includes('\x07')?pending.slice(start):'';
 }};
}
test('real nested CLI PTYs: detach each client, preserve parents, direct fresh attach', {skip:typeof Bun==='undefined',timeout:30000},async()=>{
 const parentA=tracker('\x1b[=1u\x1b[>9u\x1b[?2004h').snapshot();
 const b=simulatedServer('\x1b[>3u\x1b[?1049h\x1b[>11u\x1b[?1002h\x1b[?1006h');
 const c=simulatedServer('\x1b[>9u\x1b[?1049h\x1b[>1u\x1b[>11u\x1b[?1003h\x1b[?1016h');
 const parentB=b.state.snapshot(),outer=terminalEndpoint(parentA);const children=[];
 const spawn=(url,onData)=>{const p=spawnClient(url,onData);children.push(p);return p;};
 let first,second;
 const equals=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const freshAttach=async server=>{
  const clean=terminalEndpoint(tracker().snapshot());
  const proc=spawn(server.url,clean.data);await until(()=>server.socket,'fresh socket');
  await until(()=>equals(clean.state.snapshot(),server.state.snapshot()),'fresh terminal restore');
  server.detach();await proc.exited;proc.terminal.close();
  assert.deepEqual(clean.state.snapshot(),tracker().snapshot(),'fresh terminal cleanup');
 };
 try{
  first=spawn(b.url,outer.data);await until(()=>b.socket,'middle attach');
  await until(()=>equals(outer.state.snapshot(),parentB),'middle initial state');
  b.input=data=>second?.terminal.write(data);
  second=spawn(c.url,(_,data)=>b.output(data));await until(()=>c.socket,'inner attach');
  await until(()=>equals(outer.state.snapshot(),c.state.snapshot()),'nested initial state');
  // Close innermost transport, keeping both its PTY state and the middle server.
  c.detach();await second.exited;second.terminal.close();
  await until(()=>equals(outer.state.snapshot(),parentB),'inner cleanup restores parent');
  c.output('\x1b[<u\x1b[?1049l\x1b[>3u\x1b[?1000l');
  await freshAttach(c);
  second=spawn(c.url,(_,data)=>b.output(data));await until(()=>c.socket,'inner reattach');
  await until(()=>equals(outer.state.snapshot(),c.state.snapshot()),'inner resumed state');
  // Drop middle transport; innermost CLI remains alive and keeps tracking.
  b.detach();await first.exited;first.terminal.close();
  assert.deepEqual(outer.state.snapshot(),parentA,'middle cleanup restores original parent stack');
  c.output('\x1b[?1049h\x1b[>9u\x1b[?1002h\x1b[?1006h');
  await until(()=>equals(b.state.snapshot(),c.state.snapshot()),'output while middle detached');
  await freshAttach(b);
  first=spawn(b.url,outer.data);await until(()=>b.socket,'middle reattach');
  await until(()=>equals(outer.state.snapshot(),c.state.snapshot()),'middle resumed state');
  // CLI clients must forward OSC52 untouched to the actual outer emulator.
  const osc52='\x1b]52;c;dGVzdA==\x07\x1b]52;c;?\x1b\\';
  c.output(osc52);await until(()=>outer.output.includes(osc52),'OSC52 pass-through');
  // Real input still traverses both clients after querying/restoring.
  let received='';c.input=data=>{received+=data.toString();};
  first.terminal.write('\x1b[120;9u');await until(()=>received.includes('\x1b[120;9u'),'Super-X input through both clients');
  c.detach();await second.exited;second.terminal.close();
  await until(()=>equals(outer.state.snapshot(),parentB),'final inner cleanup');
  b.detach();await first.exited;first.terminal.close();
  assert.deepEqual(outer.state.snapshot(),parentA);
 }finally{
  for(const p of children){try{p.kill();p.terminal.close();}catch{}}
  b.server.stop(true);c.server.stop(true);
 }
});
test('real viewer PTYs exit with legacy and Kitty Ctrl-C/D/Q and restore parent', {skip:typeof Bun==='undefined',timeout:30000},async()=>{
 for(const [key,code] of [[3,130],[4,0],[17,0],[99,130],[100,0],[113,0]]){
  const server=simulatedServer('\x1b[>11u',true);
  const outer=terminalEndpoint(tracker().snapshot());
  const proc=spawnClient(server.url,outer.data);
  try{
   await until(()=>outer.output.includes('Exit by Ctrl+C/D/Q'),'viewer ready');
   const sequence=key<32?String.fromCharCode(key):'\x1b['+key+';5u';
   for(const byte of Buffer.from(sequence)) proc.terminal.write(Buffer.from([byte]));
   await until(()=>proc.exitCode!==null,'viewer exited');
   assert.equal(await proc.exited,code);
   assert.deepEqual(outer.state.snapshot(),tracker().snapshot());
  }finally{
   if(proc.exitCode===null){proc.kill();await proc.exited;}
   proc.terminal.close();server.server.stop(true);
  }
 }
});
