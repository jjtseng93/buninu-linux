import {runGraphics} from '/lib/fbdev.js';
import {loadCanvasKit,openCanvas} from '/lib/canvas.js';
import {claimVirtualConsole} from '/lib/bunterm/vt.js';
// Manual native Linux benchmark; takes over tty6 temporarily.
// bun test/manual-bunterm-image-paths.js /path/to/1920x1080.png
if(!process.argv[2])throw Error('Pass a 1920x1080 PNG filename');
const CK=await loadCanvasKit(), results=[];
await runGraphics(async(display,{onRelease,onAcquire})=>{
 const screen=openCanvas(CK,display);let active=true;onRelease(()=>active=false);onAcquire(()=>active=true);
 const bytes=await Bun.file(process.argv[2]).bytes();
 const image=CK.MakeImageFromEncoded(bytes),w=image.width(),h=image.height();
 if(w!==1920||h!==1080||display.width!==1920||display.height!==1080||display.bitsPerPixel!==32)throw Error("This comparison requires a 1920x1080 image and 32-bit 1920x1080 framebuffer");
 const src=CK.LTRBRect(0,0,w,h), native=CK.LTRBRect(0,0,w,h),scaled=CK.LTRBRect(0,26,1920,1066);
 const info={width:w,height:h,colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB};
 const start=performance.now(),pixels=image.readPixels(0,0,info);
 if(!pixels)throw Error('readPixels failed');
 if(screen.colorType===CK.ColorType.BGRA_8888)for(let i=0;i<pixels.length;i+=4){const r=pixels[i];pixels[i]=pixels[i+2];pixels[i+2]=r;}results.push({readPixelsMs:performance.now()-start,width:w,height:h,bytes:pixels?.length});
 const actions={
  'rows-scaled':()=>{for(let y=0;y<1080;y+=26){screen.canvas.save();screen.canvas.clipRect(CK.LTRBRect(0,y,1920,Math.min(1080,y+26)),CK.ClipOp.Intersect,false);screen.canvas.drawImageRectOptions(image,src,scaled,CK.FilterMode.Linear,CK.MipmapMode.Linear,null);screen.canvas.restore();}},
  'single-scaled':()=>screen.canvas.drawImageRectOptions(image,src,scaled,CK.FilterMode.Linear,CK.MipmapMode.Linear,null),
  'single-1to1':()=>screen.canvas.drawImageRectOptions(image,src,native,CK.FilterMode.Linear,CK.MipmapMode.Linear,null),
  'drawImage-1to1':()=>screen.canvas.drawImage(image,0,0),
  'decode-copy-1to1':()=>{const fresh=CK.MakeImageFromEncoded(bytes);try{const p=fresh.readPixels(0,0,info);if(!p)throw Error('decode failed');if(screen.colorType===CK.ColorType.BGRA_8888)for(let i=0;i<p.length;i+=4){const r=p[i];p[i]=p[i+2];p[i+2]=r;}screen.restoreRegion({x:0,y:0,height:Math.min(h,1080),rowBytes:w*4,pixels:p});}finally{fresh.delete();}},
  'copy-1to1':()=>screen.restoreRegion({x:0,y:0,height:Math.min(h,1080),rowBytes:w*4,pixels}),
 };
 try {for(const [name,draw] of Object.entries(actions)){
   screen.canvas.clear(CK.BLACK);draw();screen.flush();
   const t=performance.now();let count=0,total=0;while(performance.now()-t<2500){if(!active)throw Error('VT switched');const t0=performance.now();draw();screen.flush();total+=performance.now()-t0;count++;await Bun.sleep(16);}
   results.push({name,ms:total/count,count});await Bun.write('/tmp/bunterm-image-paths.json',JSON.stringify(results,null,2));
 }}finally{image.delete();screen.close();}
},{console:['/dev/tty6'],prepareConsole:claimVirtualConsole});process.exit(0);
