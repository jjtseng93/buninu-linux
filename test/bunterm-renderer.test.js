import {test,expect} from "bun:test";
import {loadCanvasKit,loadFontSet} from "../initramfs/lib/canvas.js";
import {Renderer} from "../initramfs/lib/bunterm/renderer.js";
import {Terminal} from "../initramfs/lib/xterm/xterm-headless.mjs";
import {createVtMenu} from "../initramfs/lib/bunterm/vt-menu.js";

test("real CanvasKit redraws resized text and overlay with fresh font metrics", async () => {
  const CanvasKit=await loadCanvasKit(), fonts=loadFontSet(CanvasKit,"terminal");
  const surface=CanvasKit.MakeSurface(800,480);
  const screen={width:800,height:480,canvas:surface.getCanvas(),flush:()=>surface.flush()};
  const renderer=new Renderer({CanvasKit,screen,fonts});
  const term=new Terminal({cols:renderer.columns,rows:renderer.rows,allowProposedApi:true});
  try {
    await new Promise(resolve=>term.write("Hello 中文 👨‍👩‍👧\r\nSelection and font resize",resolve));
    const columns=renderer.columns;
    renderer.render(term);
    renderer.setFontSize(20);
    expect(renderer.columns).toBeLessThan(columns);
    term.resize(renderer.columns,renderer.rows);
    const menu=createVtMenu({list:()=>[{number:1,label:"tty1 — initial console"}],select(){},changed(){renderer.invalidate();},
      width:800,height:480,rowHeight:renderer.cellHeight,
      controls:{fontSize:()=>renderer.fontSize,cellHeight:()=>renderer.cellHeight,execute:()=>""}});
    menu.pointer({x:0,y:0,pressed:["left"],buttons:{left:true},wheel:0});
    renderer.render(term,{overlay:()=>menu.draw(renderer)});
    const image=surface.makeImageSnapshot();
    expect(image.width()).toBe(800);
    image.delete();
    renderer.setFontSize(13);
    expect(renderer.columns).toBe(columns);
    expect(()=>renderer.setFontSize(NaN)).toThrow();
  } finally {term.dispose();renderer.delete();fonts.delete();surface.delete();}
},20000);

test("local pointer restores exact pixels across images, edges, text and font changes", async () => {
  const {openCanvas}=await import('../initramfs/lib/canvas.js');
  const CK=await loadCanvasKit(), fonts=loadFontSet(CK,'terminal');
  const make=()=>{
    const display={width:320,height:200,stride:1296,bitsPerPixel:32,
      fields:{red:{offset:16,length:8},green:{offset:8,length:8},blue:{offset:0,length:8}},pixels:new Uint8Array(1296*200)};
    const screen=openCanvas(CK,display);screen.flush=()=>screen.surface.flush();
    return screen;
  };
  const screen=make(),reference=make();
  reference.drawOpaqueImage = undefined;
  const r=new Renderer({CanvasKit:CK,screen,fonts}), ref=new Renderer({CanvasKit:CK,screen:reference,fonts});
  const term=new Terminal({cols:r.columns,rows:r.rows,allowProposedApi:true});
  const imageSurface=CK.MakeSurface(37,29);imageSurface.getCanvas().clear(CK.Color(30,90,170));
  const image=imageSurface.makeImageSnapshot(), images=[{image,rect:[0,20,320,200]}];
  let imageDraws=0;const draw=r.drawImages.bind(r);r.drawImages=(...args)=>{imageDraws++;return draw(...args);};
  const check=(pointer,cursor={x:1,y:0,visible:true})=>{
    const options={pointer,cursor,images};r.render(term,options);ref.invalidate();ref.render(term,options);
    expect(screen.saveRegion(0,0,320,200).pixels).toEqual(reference.saveRegion(0,0,320,200).pixels);
  };
  try {
    await new Promise(resolve=>term.write('Hello world',resolve));
    check({x:100,y:100});const initial=imageDraws;
    for(const point of [{x:101,y:101},{x:0,y:0},{x:319,y:199},{x:150.5,y:78.5},null])check(point);
    expect(imageDraws).toBe(initial);
    check({x:20,y:20});
    await new Promise(resolve=>term.write('\rChanged',resolve));check({x:20,y:20});
    check({x:50,y:50},{x:2,y:0,visible:false});
    r.setFontSize(24);ref.setFontSize(24);term.resize(r.columns,r.rows);check({x:318,y:198});
    check(null);
  } finally {term.dispose();r.delete();ref.delete();image.delete();imageSurface.delete();screen.close();reference.close();fonts.delete();}
},20000);

test('opaque copies match Skia for clipped crops and dirty bands; transparency and scaling fall back', async()=>{
 const {openCanvas}=await import('../initramfs/lib/canvas.js');
 const CK=await loadCanvasKit();
 const make=()=>openCanvas(CK,{width:64,height:48,stride:272,bitsPerPixel:32,
 fields:{red:{offset:16,length:8},green:{offset:8,length:8},blue:{offset:0,length:8}},pixels:new Uint8Array(272*48)});
 const a=make(),b=make();
 const data=new Uint8Array(32*24*4);for(let i=0;i<data.length;i+=4){data[i]=i%251;data[i+1]=(i*7)%253;data[i+2]=(i*13)%255;data[i+3]=255;}
 const info={width:32,height:24,colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB};
 const image=CK.MakeImage(info,data,128);
 const bands=[[0,9],[12,35]];
 try {
  for(const rect of [[5,4,37,28],[-5,-3,27,21],[55,39,87,63]]){
   a.canvas.clear(CK.Color(7,11,13));b.canvas.clear(CK.Color(7,11,13));
   expect(a.drawOpaqueImage(image,rect,[0,0,32,24],bands)).toBe(true);
   for(const [y0,y1] of bands){b.canvas.save();b.canvas.clipRect(CK.LTRBRect(0,y0,64,y1),CK.ClipOp.Intersect,false);b.canvas.drawImageRectOptions(image,CK.LTRBRect(0,0,32,24),CK.LTRBRect(...rect),CK.FilterMode.Linear,CK.MipmapMode.Linear,null);b.canvas.restore();}
   expect(a.saveRegion(0,0,64,48).pixels).toEqual(b.saveRegion(0,0,64,48).pixels);
  }
  expect(a.drawOpaqueImage(image,[0,0,64,48],[0,0,32,24],bands)).toBe(false);
  expect(a.drawOpaqueImage(image,[0.5,0,32.5,24],[0,0,32,24],bands)).toBe(false);
  data[3]=100;const alpha=CK.MakeImage(info,data,128);
  try{expect(a.drawOpaqueImage(alpha,[0,0,32,24],[0,0,32,24],bands)).toBe(false);}finally{alpha.delete();}
 }finally{image.delete();a.close();b.close();}
},20000);

test('opaque image readback reuses WASM destination and falls back when native BGRA is rejected',async()=>{
 const {openCanvas}=await import('../initramfs/lib/canvas.js');const CK=await loadCanvasKit();
 const screen=openCanvas(CK,{width:8,height:8,stride:32,bitsPerPixel:32,
 fields:{red:{offset:16,length:8},green:{offset:8,length:8},blue:{offset:0,length:8}},pixels:new Uint8Array(256)});
 const info={width:8,height:8,colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB};
 const bytes=new Uint8Array(256);for(let i=0;i<256;i+=4)bytes.set([201,71,19,255],i);
 const images=[],destinations=[];
 try{
  for(const fallback of [false,true]){
   const image=CK.MakeImage(info,bytes,32);images.push(image);
   const read=image.readPixels.bind(image);let reads=0;
   image.readPixels=(x,y,format,destination,stride)=>{reads++;expect(destination).toBeTruthy();destinations.push(destination);
    if(fallback && format.colorType===CK.ColorType.BGRA_8888)return null;
    return read(x,y,format,destination,stride);};
   for(let n=0;n<2;n++)expect(screen.drawOpaqueImage(image,[0,0,8,8],[0,0,8,8],[[0,8]])).toBe(true);
   expect(reads).toBe(fallback?2:1);
   const actual=screen.saveRegion(0,0,8,8).pixels;
   for(let i=0;i<256;i+=4)expect([...actual.subarray(i,i+4)]).toEqual([19,71,201,255]);
  }
  expect(destinations.every(d=>d===destinations[0])).toBe(true);
 }finally{images.forEach(i=>i.delete());screen.close();}
},20000);
