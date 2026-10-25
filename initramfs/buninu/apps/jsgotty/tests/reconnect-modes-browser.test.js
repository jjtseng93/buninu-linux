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
test('browser -> CLI -> CLI: independent disconnects preserve terminal modes', {skip:!process.env.CHROMIUM_HEADLESS,timeout:60000},async()=>{
 const bundle=fs.readFileSync(path.join(root,'js/gotty.js'),'utf8').replace('(i.nc = void 0));','(i.nc = void 0)); window.TestGoTTYXterm = i(634).GoTTYXterm;');
 const modesSource=fs.readFileSync(path.join(__dirname,'../terminal-modes.js'),'utf8');
 const server=http.createServer((req,res)=>{
  if(req.url==='/modes.js'){res.setHeader('Content-Type','text/javascript');res.end('(function(){var module={exports:{}};'+modesSource+';window.modes=module.exports;})();');}
  else if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);}
  else if(req.url==='/keyboard.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,'js/kitty-keyboard.js')));}
  else res.end('<!doctype html><div id="fixture" style="width:800px;height:600px"></div><script src="/modes.js"></script><script src="/keyboard.js"></script><script src="/bundle.js"></script><script>window.wrapper=new TestGoTTYXterm(document.getElementById("fixture"));window.sent=[];wrapper.onInput(b=>sent.push(new TextDecoder().decode(b)));wrapper.kittyKeyboard.android=true;</script>');
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
   const {TerminalModeTracker,validateSnapshot}=modes;
   const modeTransition=(from,to)=>modes.modeTransition(from,to,{kittyRestore:true});
   const tracker=()=>new TerminalModeTracker();
   const equal=(a,b,label)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(label+JSON.stringify({actual:a,expected:b}));};
   const snapshot=()=>validateSnapshot(wrapper.sessionModes());
   const drain=()=>new Promise(r=>wrapper.enqueueTerminal(done=>{done();r();}));
   const write=s=>new Promise(r=>term.write(s,r));

   // Mode-only restoration must preserve visible cells and cursor on either
   // screen, even if the other screen's Kitty stack differs.
   for(const alternate of [false,true]){
    await write('\\x1bcNORMAL CONTENT');
    if(alternate)await write('\\x1b[?1049hVISIBLE FULLSCREEN CONTENT');
    await write('\\x1b[4;9H');
    const view=()=>({type:term.buffer.active.type,x:term.buffer.active.cursorX,y:term.buffer.active.cursorY,
      lines:Array.from({length:term.rows},(_,i)=>term.buffer.active.getLine(i)?.translateToString(true))});
    const before=view(),from=snapshot(),to=structuredClone(from);
    const inactive=alternate?'normal':'alternate';
    to.kitty[inactive]={flags:9,stack:[0,1]};
    // No negotiated support: do not switch screens to repair a hidden stack.
    const fallback=modes.modeTransition(from,to);
    equal(fallback,'','unnegotiated hidden restore');
    await write(fallback);equal(view(),before,'fallback preserves cells/cursor');
    const sequence=modeTransition(from,to);
    if(sequence.includes('[?1047')||sequence.includes('[?1049'))throw Error('hidden restore switched screens');
    await write(sequence);
    equal(view(),before,'negotiated restore preserves cells/cursor');
    equal(snapshot(),to,'hidden stack restored without switching');
   }
   await write('\\x1bc');
   // Regression: raw xterm writes already queued before a restore, followed by
   // newer output. Restoration must happen between these two generations.
   term.write('\\x1b[?1002h\\x1b[>11u');
   wrapper.applySessionModes(tracker().snapshot());
   wrapper.writeTerminal('\\x1b[>1u');await drain();
   equal(snapshot().mouse,'NONE','pending mouse output');
   equal(snapshot().kitty.normal,{flags:1,stack:[0]},'pending Kitty output');
   await write('\\x1bc');
   const outer=tracker(),middle=tracker(),inner=tracker();
   let browserConnected=true,middleConnected=true,innerConnected=true;
   const outerOutput=s=>{outer.consume(new TextEncoder().encode(s));if(browserConnected)wrapper.writeTerminal(s);};
   const middleOutput=s=>{middle.consume(new TextEncoder().encode(s));if(middleConnected)outerOutput(s);};
   const innerOutput=s=>{inner.consume(new TextEncoder().encode(s));if(innerConnected)middleOutput(s);};
   const browserResume=async()=>{browserConnected=true;wrapper.applySessionModes(outer.snapshot());await drain();equal(snapshot(),outer.snapshot(),'browser resume');};

   const freshAttach=async(state,label)=>{
    const div=document.createElement('div');document.body.append(div);
    const fresh=new TestGoTTYXterm(div);
    // A new terminal attaches directly to that server's preserved session.
    fresh.applySessionModes(state);
    await new Promise(r=>fresh.enqueueTerminal(done=>{done();r();}));
    equal(validateSnapshot(fresh.sessionModes()),state,label+' fresh direct attach');
    // Applying the snapshot twice is idempotent, including Kitty stack depth.
    fresh.applySessionModes(state);
    await new Promise(r=>fresh.enqueueTerminal(done=>{done();r();}));
    equal(validateSnapshot(fresh.sessionModes()),state,label+' repeated snapshot');
    fresh.close();div.remove();
   };
   const a='\\x1b[=1u\\x1b[>9u\\x1b[?2004h';
   const b='\\x1b[>3u\\x1b[?1049h\\x1b[>11u\\x1b[?1002h\\x1b[?1006h';
   const c='\\x1b[>9u\\x1b[?1049h\\x1b[>1u\\x1b[>11u\\x1b[?1003h\\x1b[?1016h\\x1b[?25l';
   outerOutput(a);await drain();const parentA=outer.snapshot();
   middle.consume(new TextEncoder().encode(b));
   outerOutput(modeTransition(outer.snapshot(),middle.snapshot()));await drain();const parentB=middle.snapshot();
   inner.consume(new TextEncoder().encode(c));
   middleOutput(modeTransition(middle.snapshot(),inner.snapshot()));await drain();
   equal(snapshot(),inner.snapshot(),'both clients attached');
   // Outermost browser transport drops: both CLI sessions keep tracking output.
   browserConnected=false;wrapper.setDisconnected(true);
   innerOutput('\\x1b[<u\\x1b[?1002h\\x1b[?1006h');
   await freshAttach(outer.snapshot(),'outer disconnected');
   await browserResume();wrapper.setDisconnected(false);
   equal(snapshot(),inner.snapshot(),'browser sees offline changes');
   // Innermost CLI disconnects. Its cleanup must restore middle parent, not
   // defaults, and its remote PTY continues changing while detached.
   innerConnected=false;
   middleOutput(modeTransition(middle.snapshot(),parentB));await drain();
   equal(snapshot(),parentB,'inner CLI cleanup');
   innerOutput('\\x1b[?1049l\\x1b[>3u\\x1b[?1000l\\x1b[?1016l');
   await freshAttach(inner.snapshot(),'inner disconnected');
   innerConnected=true;middleOutput(modeTransition(middle.snapshot(),inner.snapshot()));await drain();
   equal(snapshot(),inner.snapshot(),'inner CLI resume');
   // Middle CLI disconnects while its inner CLI stays alive.
   middleConnected=false;outerOutput(modeTransition(outer.snapshot(),parentA));await drain();
   equal(snapshot(),parentA,'middle CLI cleanup');
   innerOutput('\\x1b[?1049h\\x1b[>9u\\x1b[?1002h\\x1b[?1006h');
   await freshAttach(middle.snapshot(),'middle disconnected');
   middleConnected=true;outerOutput(modeTransition(outer.snapshot(),middle.snapshot()));await drain();
   equal(snapshot(),inner.snapshot(),'middle CLI resume');
   // Drop all transports, reconnect inside-out, then repeat the browser snapshot.
   browserConnected=middleConnected=innerConnected=false;
   innerOutput('\\x1b[<u\\x1b[?2004h');
   innerConnected=true;middleOutput(modeTransition(middle.snapshot(),inner.snapshot()));
   middleConnected=true;outerOutput(modeTransition(outer.snapshot(),middle.snapshot()));
   await browserResume();await browserResume();
   equal(snapshot(),inner.snapshot(),'all layers resumed; no stack duplication');
   // Private query traverses output and returns the exact current state once.
   sent.length=0;
   await write('\\x1b]777;jsgotty-modes;0123456789abcdef0123456789abcdef\\x07');
   equal(sent.length,1,'private query reply count');
   const encoded=sent[0].split(';')[3].slice(0,-1);
   equal(JSON.parse(atob(encoded)).kittyRestore,1,'restore capability advertised');
   equal(validateSnapshot(JSON.parse(atob(encoded))),snapshot(),'private query state');
   wrapper.close();return 'ok';
  })()`});
  assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));assert.equal(result.result.value,'ok');
 }finally{
  ws?.close();if(child.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}}
  server.closeAllConnections();await new Promise(r=>server.close(r));
 }
});
