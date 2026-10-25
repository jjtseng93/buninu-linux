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
const {ClipboardHost,handleOSC52}=require('../clipboard.js');
const root=path.join(__dirname,'../static');
test('browser OSC52 write/read reaches server clipboard and replies to PTY', {skip:!process.env.CHROMIUM_HEADLESS,timeout:60000},async()=>{
 const bundle=fs.readFileSync(path.join(root,'js/gotty.js'),'utf8').replace('(i.nc = void 0));','(i.nc = void 0)); window.TestGoTTYXterm = i(634).GoTTYXterm; window.TestWebTTY = i(609).WebTTY;');
 const server=http.createServer((req,res)=>{
  if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);}
  else if(req.url==='/keyboard.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,'js/kitty-keyboard.js')));}
  else res.end('<!doctype html><div id="fixture" style="width:800px;height:600px"></div><script src="/keyboard.js"></script><script src="/bundle.js"></script><script>window.wrapper=new TestGoTTYXterm(document.getElementById("fixture"));window.sent=[];wrapper.onInput(b=>sent.push(new TextDecoder().decode(b)));wrapper.kittyKeyboard.android=true;</script>');
 });
 const dir=fs.mkdtempSync(require('node:os').tmpdir()+'/jsgotty-clipboard-');
 const oldPath=process.env.PATH,oldFixture=process.env.JSGOTTY_CLIPBOARD_FIXTURE;
 const fake=`#!${process.execPath}
const fs=require('node:fs'),file=process.env.JSGOTTY_CLIPBOARD_FIXTURE;
const read=process.argv.includes('-o');fs.appendFileSync(file+'.log',read?'read\\n':'write\\n');
if(read)process.stdout.write(fs.readFileSync(file));else fs.writeFileSync(file,fs.readFileSync(0));
`;
 fs.writeFileSync(path.join(dir,'xclip'),fake,{mode:0o700});
 process.env.PATH=dir+path.delimiter+oldPath;process.env.JSGOTTY_CLIPBOARD_FIXTURE=path.join(dir,'data');
 const host=new ClipboardHost();
 const sockets=new WebSocket.Server({server});
 sockets.on('connection',socket=>{
  const session={closed:false,isWriter:ws=>ws===socket && socket.readyState===WebSocket.OPEN,
    backend:{write:data=>socket.send(data.toString())}};
  socket.on('message',data=>{const text=data.toString();if(text[0]==='C')handleOSC52(session,socket,text.slice(1),host);});
  socket.on('close',()=>{session.closed=true;});
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
   const socket=new WebSocket('ws://'+location.host);
   await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
   const replies=[];socket.onmessage=e=>replies.push(e.data);
   const webtty=new TestWebTTY(wrapper,null,'','');
   webtty.connection={send:data=>socket.send(data)};
   const write=s=>new Promise(r=>term.write(s,r));
   const equal=(a,b)=>{if(a!==b)throw Error(JSON.stringify({a,b}));};
   const encoded=btoa(unescape(encodeURIComponent('你好 OSC52\\n')));
   // The worker invokes an isolated fake xclip, never the system clipboard.
   await write('\\x1b]52;c;'+encoded.slice(0,2));
   await write(encoded.slice(2)+'\\x07');
   await write('\\x1b]52;c;?\\x1b\\\\');
   for(let i=0;i<200&&!replies.length;i++)await new Promise(r=>setTimeout(r,10));
   equal(replies.shift(),'\\x1b]52;c;'+encoded+'\\x1b\\\\');
   await write('\\x1b]52;c;\\x07\\x1b]52;c;?\\x07');
   for(let i=0;i<200&&!replies.length;i++)await new Promise(r=>setTimeout(r,10));
   equal(replies.shift(),'\\x1b]52;c;\\x1b\\\\');
   equal(term.buffer.active.getLine(0).translateToString(true),'');
   socket.close();
   wrapper.close();return 'ok';
  })()`});
  assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));assert.equal(result.result.value,'ok');
  assert.equal(fs.readFileSync(path.join(dir,'data.log'),'utf8'),'write\nread\nwrite\nread\n');
 }finally{
  ws?.close();if(child.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}}
  for(const socket of sockets.clients)socket.terminate();
  await host.close();sockets.close();
  process.env.PATH=oldPath;if(oldFixture===undefined)delete process.env.JSGOTTY_CLIPBOARD_FIXTURE;else process.env.JSGOTTY_CLIPBOARD_FIXTURE=oldFixture;
  fs.rmSync(dir,{recursive:true,force:true});
  server.closeAllConnections();await new Promise(r=>server.close(r));
 }
});
