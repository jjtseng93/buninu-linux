// CHROMIUM_HEADLESS=/usr/local/bin/chromium-headless-shell bun test tests/kitty-flow-browser.test.js
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const WebSocket=require('ws'),{KittyFrameFlow}=require('../kitty-flow.js');
test('real browser resumes latest image after visibility loss or suspended animation callbacks',{skip:!process.env.CHROMIUM_HEADLESS,timeout:30000},async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../static/js/kitty.js'));
 const server=http.createServer((req,res)=>{
  if(req.url==='/kitty.js'){res.setHeader('Content-Type','text/javascript');res.end(source);return;}
  res.end(`<div id="terminal" style="width:800px;height:600px"><div class="xterm-screen"></div></div><div id="kitty-overlay"></div>
<script>window.hidden=false;Object.defineProperty(document,'hidden',{get:()=>window.hidden});window.held=[];window.suspended=false;const raf=window.requestAnimationFrame.bind(window);window.requestAnimationFrame=fn=>suspended?(held.push(fn),0):raf(fn);</script>
<script src="/kitty.js"></script><script>window.messages=[];window.socket=new WebSocket('ws://'+location.host);socket.onmessage=e=>messages.push(e.data);</script>`);
 });server.listen(0,'127.0.0.1');await once(server,'listening');
 const wss=new WebSocket.WebSocketServer({server});let flow,socket,count=0,last=null;
 wss.on('connection',ws=>{socket=ws;flow=new KittyFrameFlow(g=>{count++;last=g;ws.send('7'+JSON.stringify(g));});ws.on('message',m=>{if(String(m)[0]==='G')flow.control(JSON.parse(String(m).slice(1)))});ws.send('a{"kittyFrameFlow":1}');});
 const child=spawn(process.env.CHROMIUM_HEADLESS,['--no-sandbox','--disable-gpu','--remote-debugging-port=0','http://127.0.0.1:'+server.address().port],{stdio:['ignore','ignore','pipe']});let cdp;
 try{
  const endpoint=await new Promise((resolve,reject)=>{let log='';child.on('error',reject);child.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m)resolve(m[1]);});});
  let tab;for(let i=0;i<100;i++){tab=(await(await fetch('http://'+new URL(endpoint).host+'/json/list')).json()).find(x=>x.type==='page');if(tab)break;await new Promise(r=>setTimeout(r,20));}
  cdp=new WebSocket(tab.webSocketDebuggerUrl);await once(cdp,'open');let id=0;const pending=new Map();cdp.on('message',data=>{const m=JSON.parse(data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result)}});
  const call=(method,params)=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});cdp.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  const until=async check=>{for(let i=0;i<100;i++){if(await check())return;await new Promise(r=>setTimeout(r,20));}throw Error('fixture timed out')};
  await until(()=>flow?.enabled);
  const png=await evaluate(`(()=>{const c=document.createElement('canvas');c.width=c.height=1;c.getContext('2d').fillRect(0,0,1,1);return c.toDataURL().split(',')[1]})()`);
  const frame=n=>({kind:'placement',control:{i:'1',C:'1',c:'2',r:'2'},cursor:{row:1,col:1},image:{id:'1',format:100,data:png},testFrame:n});
  flow.graphic(frame(0));await until(()=>flow.inFlight.size===0);
  await evaluate('window.hidden=true;document.dispatchEvent(new Event("visibilitychange"))');await until(()=>flow.visible===false);
  const before=count;for(let n=1;n<=1800;n++)flow.graphic(frame(n));assert.equal(count,before);assert.equal(flow.pending.size,1);
  socket.send('1'+Buffer.from('TEXT_WHILE_HIDDEN').toString('base64'));
  await until(async()=>await evaluate('messages.some(x=>x.startsWith("1"))'));
  await evaluate('window.hidden=false;document.dispatchEvent(new Event("visibilitychange"))');await until(()=>flow.inFlight.size===0&&last.testFrame===1800);
  assert.equal(count,before+1);
  // A renderer can freeze without delivering visibilitychange. Missing rAF
  // acknowledgements still bound the server to two outstanding frames.
  await evaluate('window.suspended=true');const baseline=count;
  for(let n=1801;n<=3600;n++)flow.graphic(frame(n));assert.equal(count,baseline+2);assert.equal(flow.pending.size,1);
  await until(async()=>await evaluate('held.length>=2'));
  await evaluate('window.suspended=false;for(const fn of held.splice(0))requestAnimationFrame(fn)');
  await until(()=>flow.inFlight.size===0&&last.testFrame===3600);assert.equal(count,baseline+3);
  await until(async()=>await evaluate('document.querySelector("img.kitty-image__content").naturalWidth===1'));
 }finally{cdp?.close();for(const ws of wss.clients)ws.terminate();wss.close();server.close();child.kill();}
});
