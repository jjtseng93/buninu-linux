// Eval manually. Counts delivery, bitmap decoding, image loads and animation ticks.
// Observational only: no frame dropping, focus changes or socket reconnects.
window.startKittyBackgroundDebug = (endpoint) => {
  window.stopKittyBackgroundDebug?.();
  const parse=JSON.parse,bitmap=window.createImageBitmap,history=[];
  let received=0,bytes=0,decoded=0,loads=0,ticks=0,pending=0,maxPending=0,decodeMs=0,last=performance.now(),busy=false,stopped=false,raf;
  const wrappedParse=function(...args){const v=parse.apply(this,args);if(v?.kind==='placement'&&v.image){received++;bytes+=v.image.data?.length||0;}return v;};
  const wrappedBitmap=async function(...args){const start=performance.now();pending++;maxPending=Math.max(maxPending,pending);try{return await bitmap.apply(this,args)}finally{pending--;decoded++;decodeMs+=performance.now()-start;}};
  JSON.parse=wrappedParse;if(bitmap)window.createImageBitmap=wrappedBitmap;
  const load=e=>{if(e.target.matches?.('img.kitty-image__content'))loads++;};
  document.addEventListener('load',load,true);
  const tick=()=>{ticks++;if(!stopped)raf=requestAnimationFrame(tick)};raf=requestAnimationFrame(tick);
  function flush(reason='interval'){
    const now=performance.now(),row={kind:'background-profile',time:Date.now(),elapsed:now-last,reason,hidden:document.hidden,received,bytes,decoded,loads,ticks,pending,maxPending,decodeMs};
    last=now;received=bytes=decoded=loads=ticks=decodeMs=0;maxPending=pending;
    history.push(row);if(history.length>600)history.shift();window.__kittyBackgroundLatest=row;
    if(endpoint&&!busy){busy=true;fetch(endpoint,{method:'POST',headers:{'Content-Type':'text/plain'},body:JSON.stringify(row),signal:AbortSignal.timeout(5000)}).catch(()=>{}).finally(()=>busy=false);}
  }
  const visibility=()=>flush('visibilitychange');document.addEventListener('visibilitychange',visibility);
  const timer=setInterval(flush,1000),expiry=setTimeout(()=>window.stopKittyBackgroundDebug(),600000);
  window.__kittyBackgroundHistory=history;
  window.stopKittyBackgroundDebug=()=>{stopped=true;if(JSON.parse===wrappedParse)JSON.parse=parse;if(window.createImageBitmap===wrappedBitmap)window.createImageBitmap=bitmap;document.removeEventListener('load',load,true);document.removeEventListener('visibilitychange',visibility);cancelAnimationFrame(raf);clearInterval(timer);clearTimeout(expiry);};
  return 'background diagnostic enabled';
};
