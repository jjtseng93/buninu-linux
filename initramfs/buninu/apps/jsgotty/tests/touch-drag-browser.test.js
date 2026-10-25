// Opt-in real bundled-xterm integration; no browser/dependency downloads.
// CHROMIUM_HEADLESS=/path/to/chromium-headless-shell node --test tests/touch-drag-browser.test.js
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const WebSocket=require('ws');
const root=path.join(__dirname,'../static');
test('touch double-tap drag and image-menu right click use bundled xterm', {skip:!process.env.CHROMIUM_HEADLESS,timeout:60000},async()=>{
 const bundle=fs.readFileSync(path.join(root,'js/gotty.js'),'utf8').replace('(i.nc = void 0));','(i.nc = void 0)); window.TestGoTTYXterm = i(634).GoTTYXterm;');
 const server=http.createServer((req,res)=>{
  if(req.url==='/index.css'){res.setHeader('Content-Type','text/css');res.end(fs.readFileSync(path.join(root,'css/index.css')));}
  else if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle);}
  else if(req.url==='/gestures.js'){
   const source=fs.readFileSync(path.join(root,'js/kitty.js'),'utf8');
   res.setHeader('Content-Type','text/javascript');
   res.end(source.slice(source.indexOf('  function reportTouchMouse('),source.indexOf('  function ensureContextMenu('))+source.slice(source.indexOf('  function ensureContextMenu('),source.indexOf('  function bindImageContextMenu('))+source.slice(source.indexOf('  function bindImageContextMenu('),source.indexOf('  function bindImageContextMenu(')+source.slice(source.indexOf('  function bindImageContextMenu(')).indexOf('\n  function ',5))+'\nbindTouchScrolling();bindImageContextMenu();');
  }
  else if(req.url==='/keyboard.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(root,'js/kitty-keyboard.js')));}
  else res.end('<!doctype html><div id="terminal"><div id="fixture" style="width:800px;height:600px"></div></div><link rel="stylesheet" href="/index.css"><script src="/keyboard.js"></script><script src="/bundle.js"></script><script>window.wrapper=new TestGoTTYXterm(document.getElementById("fixture"));window.sent=[];wrapper.onInput(b=>sent.push(new TextDecoder().decode(b)));wrapper.kittyKeyboard.android=true;</script>');
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
   const terminal=document.getElementById('fixture');terminal.__gottyXterm=term;
   const screen=term.element.querySelector('.xterm-screen'), rect=screen.getBoundingClientRect();
   const state={placements:new Map()};
   const xtermElements=()=>({screen});
   const DEFAULT_TOUCH_SCROLL_THRESHOLD=24;
   const removePlacementNode=node=>node.remove();
   eval(await (await fetch('/gestures.js')).text());
   const touch=(type,x=30,y=30,count=1)=>{
    const point=new Touch({identifier:1,target:screen,clientX:rect.left+x,clientY:rect.top+y});
    const touches=type==='touchend'||type==='touchcancel'?[]:count===1?[point]:[point,new Touch({identifier:2,target:screen,clientX:rect.left+x+30,clientY:rect.top+y})];
    const event=new TouchEvent(type,{bubbles:true,cancelable:true,touches,changedTouches:[point]});
    screen.dispatchEvent(event);return event.defaultPrevented;
   };
   const codes=()=>sent.map(s=>{const m=s.match(/<([0-9]+);[0-9]+;[0-9]+([Mm])/);return m?m[1]+m[2]:s;});
   let focusCalls=0;const originalFocus=term._core.focus;term._core.focus=function(...args){focusCalls++;return originalFocus.apply(this,args);};
   const firstTap=()=>{touch('touchstart');touch('touchend');
    // Browser compatibility mouse sequence after an ordinary tap.
    for(const type of ['mousedown','mouseup'])screen.dispatchEvent(new MouseEvent(type,{bubbles:true,clientX:rect.left+30,clientY:rect.top+30,button:0,buttons:type==='mousedown'?1:0}));};
   sent.length=0;firstTap();equal(codes(),['0M','0m']);
   const focusBeforeDrag=focusCalls;
   if(!touch('touchstart'))throw Error('Second press must suppress compatibility click');
   equal(codes(),['0M','0m','0M']); // still held, no premature release
   touch('touchmove',80,70);touch('touchend',80,70);
   equal(codes(),['0M','0m','0M','32M','0m']);
   equal(focusCalls,focusBeforeDrag);
   sent.length=0;firstTap();touch('touchstart');touch('touchend');
   equal(codes(),['0M','0m','0M','0m']); // ordinary double click
   for(const cancel of [()=>touch('touchcancel'),()=>touch('touchstart',30,30,2),()=>window.dispatchEvent(new Event('blur')),()=>state.cancelTouchGesture()]){
    sent.length=0;firstTap();touch('touchstart');cancel();touch('touchend');equal(codes(),['0M','0m','0M','0m']);
   }
   sent.length=0;firstTap();touch('touchstart');
   touch('touchmove',-200,-200);touch('touchend',-200,-200);
   equal(codes(),['0M','0m','0M','32M','0m']); // release outside grid still reaches application
   sent.length=0;touch('touchstart');touch('touchmove',30,90);touch('touchend',30,90);
   if(!codes().length||codes().some(x=>!x.startsWith('64')))throw Error('Single touch must remain scrolling: '+codes());
   sent.length=0;touch('touchstart');touch('touchmove',30,90);touch('touchend',30,90);
   if(codes().some(x=>x==='0M'))throw Error('Scroll must not arm double tap');
   // Use precisely the existing image context-menu path, with its original location.
   const node=document.createElement('div');node.style.zIndex='0';node.getBoundingClientRect=()=>({left:0,top:0,right:1000,bottom:1000});state.placements.set('image',node);
   screen.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:rect.left+30,clientY:rect.top+30,button:2}));
   if(state.contextMenu.root.hidden)throw Error('Menu missing');
   const focusBeforeRight=focusCalls;
   sent.length=0;state.contextMenu.rightButton.click();equal(focusCalls,focusBeforeRight);equal(codes(),['2M','2m']);
   if(!state.contextMenu.root.hidden||!state.placements.has('image'))throw Error('Right click must hide menu and preserve image');
   await write('\\x1b[?1002l');state.cancelTouchGesture();sent.length=0;
   firstTap();touch('touchstart');touch('touchmove',80,70);touch('touchend');
   if(codes().some(x=>/^[032][Mm]$/.test(x)))throw Error('No application mouse reporting outside mouse mode');
   state.cancelTouchGesture();state.placements.clear();
   term.focus();const textarea=term.textarea;
   screen.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:rect.left+30,clientY:rect.top+30,button:2}));
   if(document.activeElement!==textarea)throw Error('Context menu must keep textarea focused for native paste');
   const data=new DataTransfer();data.setData('text/plain','paste-check');sent.length=0;
   textarea.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
   if(!sent.join('').includes('paste-check'))throw Error('Paste stopped working');
   equal(getComputedStyle(textarea).touchAction,'none');
   equal(getComputedStyle(screen).touchAction,'manipulation');
   touch('touchstart');
   if(document.activeElement!==textarea)throw Error('Touch must not blur the input');
   touch('touchend');
   wrapper.close();return 'ok';
  })()`});
  assert.equal(result.exceptionDetails,undefined,JSON.stringify(result.exceptionDetails));assert.equal(result.result.value,'ok');
 }finally{
  ws?.close();if(child.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}}
  server.closeAllConnections();await new Promise(r=>server.close(r));
 }
});
