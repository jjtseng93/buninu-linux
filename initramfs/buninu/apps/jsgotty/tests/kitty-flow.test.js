const {test}=require('node:test');
const assert=require('node:assert/strict');
const {KittyFrameFlow}=require('../kitty-flow.js');
const graphic=(n,id='1')=>({kind:'placement',control:{i:id,C:'1'},cursor:{row:2,col:1},image:{id,data:String(n)}});
test('browser credits bound suspension to two frames and latest replacement',()=>{
 const sent=[],flow=new KittyFrameFlow(g=>sent.push(g));
 assert.equal(flow.graphic(graphic(0)),false); // CLI and old WebViews unchanged
 flow.control({version:1,visible:true});
 for(let n=0;n<1800;n++)assert.equal(flow.graphic(graphic(n)),true);
 assert.equal(sent.length,2);assert.equal(flow.pending.size,1);
 flow.control({version:1,ack:9999});assert.equal(sent.length,2);
 flow.control({version:1,ack:sent[0].frameSequence});
 assert.equal(sent.length,3);assert.equal(sent[2].image.data,'1799');
 flow.control({version:1,ack:sent[0].frameSequence});assert.equal(sent.length,3);
});
test('hidden viewers keep only latest per placement and resume without another update',()=>{
 const sent=[],flow=new KittyFrameFlow(g=>sent.push(g));flow.control({version:1,visible:false});
 for(let n=0;n<100;n++){flow.graphic(graphic(n,'1'));flow.graphic(graphic(n,'2'));}
 assert.equal(sent.length,0);assert.equal(flow.pending.size,2);
 flow.control({version:1,visible:true});assert.deepEqual(sent.map(g=>g.image.data),['99','99']);
});
test('delete, terminal reset and alternate screen do not resurrect pending images',()=>{
 const sent=[],flow=new KittyFrameFlow(g=>sent.push(g));flow.control({version:1,visible:false});
 flow.graphic(graphic(1));flow.graphic(graphic(2,'2'));
 assert.equal(flow.graphic({kind:'delete',delete:{imageId:'1'}}),false);
 assert.equal(flow.pending.size,1);
 flow.output(Buffer.from('\x1b[?104').toString('base64'));
 flow.output(Buffer.from('9l').toString('base64'));assert.equal(flow.pending.size,0);
 flow.graphic(graphic(3));flow.graphic({kind:'delete',delete:{scope:'a'}});
 flow.control({version:1,visible:true});assert.equal(sent.length,0);
});
test('connections have independent credits; normal scrolling images are unchanged',()=>{
 const one=[],two=[],a=new KittyFrameFlow(g=>one.push(g)),b=new KittyFrameFlow(g=>two.push(g));
 a.control({version:1,visible:false});b.control({version:1,visible:true});
 a.graphic(graphic(1));b.graphic(graphic(1));assert.equal(one.length,0);assert.equal(two.length,1);
 const scroll=graphic(2);delete scroll.control.C;assert.equal(a.graphic(scroll),false);
 // A later ordinary placement replaces the same deferred position immediately.
 assert.equal(a.pending.size,0);a.graphic(graphic(3));
 a.output(Buffer.from('ordinary text').toString('base64'));assert.equal(a.pending.size,1);
});

test('browser negotiates only on advertisement and acknowledges after animation opportunity',async()=>{
 const fs=require('node:fs'),vm=require('node:vm'),source=fs.readFileSync(require('node:path').join(__dirname,'../static/js/kitty.js'),'utf8');
 const start=source.indexOf('  // Only a server advertising'),end=source.indexOf('  function deleteImages');
 const helpers=source.slice(start,source.indexOf('  function handleKittyMessage',start));
 const frames=[],events={},sent=[],socket={readyState:1,send:m=>sent.push(JSON.parse(m.slice(1)))};
 const document={hidden:true,addEventListener:(k,fn)=>events[k]=fn};
 const api=vm.runInNewContext(`(()=>{${helpers};return {inspectFrameCapability,acknowledgeFrame}})()`,{document,state:{socket},requestAnimationFrame:fn=>frames.push(fn)});
 api.inspectFrameCapability(socket,'a{"role":"viewer"}');assert.equal(sent.length,0);
 api.inspectFrameCapability(socket,'a{"kittyFrameFlow":1}');assert.equal(sent[0].visible,false);
 api.acknowledgeFrame(socket,1);assert.equal(sent.length,1); // suspended rAF
 document.hidden=false;events.visibilitychange();assert.equal(sent[1].visible,true);
 frames.shift()();assert.equal(sent[2].ack,1);
 socket.readyState=3;api.acknowledgeFrame(socket,2);frames.shift()();assert.equal(sent.length,3);
});
