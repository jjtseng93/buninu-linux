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
test('shipped xterm reports horizontal, vertical and diagonal wheel events', {skip:!process.env.CHROMIUM_HEADLESS,timeout:60000},async()=>{
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
   const term=wrapper.term;
   const write=s=>new Promise(r=>term.write(s,r));
   const equal=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(JSON.stringify({actual:a,expected:b}));};
   await write('\\x1b[?1002h\\x1b[?1006h');
   const screen=term.element.querySelector('.xterm-screen'), rect=screen.getBoundingClientRect();
   const wheel=(deltaX,deltaY,mods={})=>{
    sent.length=0;
    const event=new WheelEvent('wheel',{clientX:rect.left+20,clientY:rect.top+20,deltaX,deltaY,deltaMode:1,bubbles:true,cancelable:true,...mods});
    screen.dispatchEvent(event);
    if(term._core.coreMouseService.areMouseEventsActive&&!event.defaultPrevented)throw Error('Wheel default was not prevented');
    return sent.map(s=>Number(s.match(/<([0-9]+);/)[1]));
   };
   equal(wheel(-1,0),[66]);equal(wheel(1,0),[67]);
   equal(wheel(0,-1,{shiftKey:true}),[68]);equal(wheel(0,1,{shiftKey:true}),[69]);
   equal(wheel(0,-1),[64]);equal(wheel(0,1),[65]);
   equal(wheel(1,-1),[67,64]);
   equal(wheel(-1,0,{shiftKey:true,altKey:true,ctrlKey:true}),[94]);
   for(let bits=0;bits<8;bits++) {
    const mods={shiftKey:!!(bits&1),altKey:!!(bits&2),ctrlKey:!!(bits&4)};
    for(const [dx,dy,code] of [[0,-1,64],[0,1,65],[-1,0,66],[1,0,67]])
     equal(wheel(dx,dy,mods),[code+(bits<<2)]);
   }
   await write('\\x1b[?1002l');equal(wheel(1,0),[]);
   wrapper.close();return 'ok';
  })()`});
  assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));assert.equal(result.result.value,'ok');
 }finally{
  ws?.close();if(child.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}}
  server.closeAllConnections();await new Promise(r=>server.close(r));
 }
});
