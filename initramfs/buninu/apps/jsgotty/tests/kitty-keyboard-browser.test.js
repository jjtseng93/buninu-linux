// Opt-in real bundled-xterm integration; no browser/dependency downloads.
// CHROMIUM_HEADLESS=/path/to/chromium-headless-shell node --test tests/kitty-keyboard-browser.test.js
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const WebSocket=require('ws');
const root=path.join(__dirname,'../static');
test('shipped xterm parses Kitty modes and delivers one encoded DOM event per key', {skip:!process.env.CHROMIUM_HEADLESS,timeout:60000},async()=>{
 const bundle=fs.readFileSync(path.join(root,'js/gotty.js'),'utf8').replace('(i.nc = void 0));','(i.nc = void 0)); window.TestGoTTYXterm = i(634).GoTTYXterm;');
 const server=http.createServer((req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);}
  else if(req.url==='/keyboard.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,'js/kitty-keyboard.js')));}
  else res.end('<!doctype html><div id="fixture" style="width:800px;height:600px"></div><script src="/keyboard.js"></script><script src="/bundle.js"></script><script>window.wrapper=new TestGoTTYXterm(document.getElementById("fixture"));window.sent=[];wrapper.onInput(b=>sent.push(new TextDecoder().decode(b)));wrapper.kittyKeyboard.android=true;</script>');
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const child=spawn(process.env.CHROMIUM_HEADLESS,['--no-sandbox','--disable-gpu','--remote-debugging-port=0','http://127.0.0.1:'+server.address().port],{detached:true,stdio:['ignore','ignore','pipe']});
 let ws;
 try{
  const endpoint=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Browser startup timeout: '+log)),15000);child.on('error',reject);child.on('exit',code=>{clearTimeout(timer);reject(Error('Browser exited '+code+': '+log));});child.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
  const u=new URL(endpoint);let tab;
  for(let i=0;i<50;i++){tab=(await (await fetch('http://'+u.host+'/json/list')).json()).find(x=>x.type==='page');if(tab)break;await new Promise(r=>setTimeout(r,100));}
  ws=new WebSocket(tab.webSocketDebuggerUrl);await once(ws,'open');let id=0;const pending=new Map();ws.on('message',data=>{const m=JSON.parse(data);if(pending.has(m.id)){const {resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(m.error):resolve(m.result);}});
  const call=(method,params)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  for(let i=0;i<50;i++){const r=await call('Runtime.evaluate',{expression:'Boolean(window.wrapper)',returnByValue:true});if(r.result.value)break;await new Promise(r=>setTimeout(r,100));}
  const result=await call('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
   const term=wrapper.term, kb=wrapper.kittyKeyboard;
   const write=s=>new Promise(r=>term.write(s,r));
   const equal=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(JSON.stringify({actual:a,expected:b}));};
   const key=(type,key,code,mods={})=>term.textarea.dispatchEvent(new KeyboardEvent(type,{key,code,bubbles:true,cancelable:true,...mods}));
   await write('\\x1b[?u');equal(sent.splice(0),['\\x1b[?0u']);
   // Split escape sequence across writes: only the parser may enable the mode.
   await write('\\x1b[>');await write('11u');equal(kb.flags,11);
   key('keydown','Meta','MetaLeft');key('keydown','x','KeyX',{ctrlKey:true,shiftKey:true});
   key('keypress','x','KeyX',{ctrlKey:true,shiftKey:true});key('keyup','x','KeyX',{ctrlKey:true,shiftKey:true});key('keyup','Meta','MetaLeft');
   equal(sent.splice(0),['\\x1b[57444;9u','\\x1b[120;14u','\\x1b[120;14:3u','\\x1b[57444;1:3u']);
   await write('\\x1b[?1049h');equal(kb.flags,0);await write('\\x1b[>1u');equal(kb.flags,1);
   await write('\\x1b[?1049l');equal(kb.flags,11);
   await write('\\x1b[<u');equal(kb.flags,0);
   key('keydown','c','KeyC',{ctrlKey:true,keyCode:67});key('keyup','c','KeyC',{ctrlKey:true,keyCode:67});equal(sent.splice(0),['\\x03']);
   await write('\\x1b[>11u');await write('\\x1bc');equal(kb.flags,0);
   await write('\\x1b[?u');equal(sent.splice(0),['\\x1b[?0u']);
   wrapper.close();return 'ok';
  })()`});
  assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));assert.equal(result.result.value,'ok');
 }finally{
  ws?.close();if(child.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}}
  server.closeAllConnections();await new Promise(r=>server.close(r));
 }
});
