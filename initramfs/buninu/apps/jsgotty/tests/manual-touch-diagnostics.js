// Injected only by manual-touch-diagnostics.mjs. Observes without cancelling events.
(()=>{
 const endpoint=globalThis.__touchDiagnosticEndpoint, rows=[];
 const state=()=>({viewport:document.querySelector('meta[name=viewport]')?.content,
  width:innerWidth,clientWidth:document.documentElement.clientWidth,dpr:devicePixelRatio,
  visual:visualViewport&&{scale:visualViewport.scale,width:visualViewport.width,height:visualViewport.height,x:visualViewport.offsetLeft,y:visualViewport.offsetTop},
  mouse:globalThis.__gottyXterm?.modes?.mouseTrackingMode});
 const push=row=>{rows.push({time:Date.now(),...row});if(rows.length>500)rows.shift()};
 const describe=el=>el?.tagName+'.'+String(el?.className||'');
 for(const type of ['touchstart','touchend','touchcancel','pointerdown','pointerup','pointercancel','mousedown','mouseup','click','dblclick','contextmenu']){
  document.addEventListener(type,e=>{
   const point=e.changedTouches?.[0]||e;
   const row={type,target:describe(e.target),trusted:e.isTrusted,cancelable:e.cancelable,
    prevented:e.defaultPrevented,detail:e.detail,touches:e.touches?.length,
    pointerType:e.pointerType,x:point.clientX,y:point.clientY,
    touchAction:e.target?.nodeType===1?getComputedStyle(e.target).touchAction:null,...state()};
   queueMicrotask(()=>push({...row,preventedAfter:e.defaultPrevented}));
  },{capture:true,passive:true});
 }
 for(const type of ['resize','scroll'])visualViewport?.addEventListener(type,()=>push({type:'visual-'+type,...state()}));
 new MutationObserver(()=>push({type:'viewport-change',...state()})).observe(document.head,{attributes:true,subtree:true,childList:true});
 let term;
 setInterval(()=>{
  const current=globalThis.__gottyXterm;
  if(current&&current!==term){term=current;term.onData(data=>{
   // Only terminal mouse reports; never collect typed commands or clipboard data.
   if(/^\x1b\[<(\d+;){2}\d+[mM]$/.test(data)||data.startsWith('\x1b[M'))push({type:'xterm-mouse',data,...state()});
  });push({type:'xterm-ready',...state()});}
  if(rows.length)fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(rows.splice(0)),keepalive:true}).catch(()=>{});
 },500);
 push({type:'diagnostic-ready',...state()});
 globalThis.__touchDiagnostics={state,mark:label=>push({type:'mark',label,...state()})};
})();
