// Manual WebView zoom diagnostics. Does not change focus, selection or gestures.
window.startGottyZoomDebug = ({endpoint} = {}) => {
  window.stopGottyZoomDebug?.();
  window.__zoomDiag?.stop();
  const logs = [], cleanup = [], started = Date.now();
  const session = Math.random().toString(36).slice(2);
  let stopped = false;
  const label = el => el ? `${el.tagName || ''}#${el.id || ''}.${String(el.className || '')}` : null;
  const record = event => {
    if (stopped || logs.length >= 4000 || Date.now() - started > 600000) return;
    const v = window.visualViewport, active = document.activeElement;
    const row = {session, sequence:logs.length, time:Date.now(), type:event.type,
      target:label(event.target), active:label(active), trusted:event.isTrusted,
      touches:event.touches?.length, viewport:document.querySelector('meta[name=viewport]')?.content,
      scale:v?.scale, offset:v ? [v.offsetLeft,v.offsetTop] : null,
      size:v ? [v.width,v.height] : null, scroll:[scrollX,scrollY],
      selection:document.getSelection()?.type,
      fontSize:active ? getComputedStyle(active).fontSize : null};
    logs.push(row);
    if(endpoint) fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(row)})
      .catch(e=>{window.__gottyZoomDeliveryError=String(e)});
  };
  const listen=(target,type)=>{
    target.addEventListener(type,record,{capture:true,passive:true});
    cleanup.push(()=>target.removeEventListener(type,record,true));
  };
  for(const type of ['touchstart','touchend','touchcancel','mousedown','mouseup','click',
    'contextmenu','focusin','focusout','selectionchange','visibilitychange'])listen(document,type);
  if(window.visualViewport)for(const type of ['resize','scroll'])listen(visualViewport,type);
  const observer=new MutationObserver(()=>record({type:'viewport-mutation'}));
  const meta=document.querySelector('meta[name=viewport]');
  if(meta)observer.observe(meta,{attributes:true});
  cleanup.push(()=>observer.disconnect());
  window.stopGottyZoomDebug=()=>{stopped=true;cleanup.forEach(fn=>fn())};
  window.__gottyZoomRecords=logs;
  window.markGottyZoomDebug=label=>record({type:'mark:'+label});
  record({type:'ready'});
  return 'Zoom diagnostics started';
};
