// Eval manually; counts completed Kitty <img> loads, not physical display flips.
window.startGottyFpsDebug = ({endpoint, duration=600000}={}) => {
  window.stopGottyFpsDebug?.(); window.stopKittyFPS?.();
  const box=document.createElement('div');
  box.style.cssText='position:fixed;top:0;right:0;z-index:2147483647;background:#000b;color:cyan;padding:4px 8px;font:16px monospace;pointer-events:none';
  box.textContent='Kitty: 0 FPS';document.body.append(box);
  const session=Date.now().toString(36),ids=new WeakMap();let id=0,previous=0,started=performance.now(),last=started,frames=[],busy=false,dropped=0,sequence=0,stopped=false;
  const records=[];window.__gottyFpsRecords=records;
  const load=e=>{const el=e.target;if(!el.matches?.('img.kitty-image__content'))return;
    const now=performance.now();if(!ids.has(el))ids.set(el,++id);
    if(frames.length<2000)frames.push({t:now,id:ids.get(el),gap:previous?now-previous:null,w:el.naturalWidth,h:el.naturalHeight});else dropped++;
    previous=now;
  };
  document.addEventListener('load',load,true);
  const flush=()=>{
    const now=performance.now(),batch=frames;frames=[];
    const gaps=batch.map(f=>f.gap).filter(g=>g!==null).sort((a,b)=>a-b);
    const row={session,sequence:sequence++,time:Date.now(),timeOrigin:performance.timeOrigin,elapsed:now-last,fps:batch.length*1000/(now-last),hidden:document.hidden,frames:batch,dropped,
      p95:gaps[Math.floor(gaps.length*.95)]??null,p99:gaps[Math.floor(gaps.length*.99)]??null,max:gaps.at(-1)??null};last=now;
    box.textContent=`Kitty: ${row.fps.toFixed(1)} FPS`;
    records.push(row);if(records.length>600)records.shift();window.__gottyFpsLatest=row;
    if(endpoint&&!busy){busy=true;fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(row),signal:AbortSignal.timeout(5000)})
      .then(r=>{if(!r.ok)throw Error('HTTP '+r.status);window.__gottyFpsDeliveryError=null;})
      .catch(e=>{window.__gottyFpsDeliveryError=String(e);dropped+=batch.length;}).finally(()=>{busy=false;});}
    else if(endpoint)dropped+=batch.length;
  };
  const timer=setInterval(flush,1000);
  const expiry=setTimeout(()=>window.stopGottyFpsDebug?.(),Math.max(1000,Math.min(duration,600000)));
  window.stopGottyFpsDebug=()=>{if(stopped)return;stopped=true;document.removeEventListener('load',load,true);clearInterval(timer);clearTimeout(expiry);box.remove();};
  return 'Kitty FPS enabled (image loads; auto-stop in at most 10 minutes)';
};
