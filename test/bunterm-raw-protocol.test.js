import {test,expect} from 'bun:test';
import {createRequire} from 'node:module';
import {preferredPixelFormat,bgraParser,BGRA_FORMAT} from '../initramfs/lib/bunterm/raw-protocol.js';
const {KittyGraphicsParser}=createRequire(import.meta.url)('../initramfs/buninu/apps/jsgotty/gotty.js');
const field=offset=>({offset,length:8,msbRight:0});
const fb=(red=16,blue=0)=>({bitsPerPixel:32,fields:{red:field(red),green:field(8),blue:field(blue),transp:{length:0}}});
test('native preference follows framebuffer bitfields; browser parser remains unchanged',()=>{
 for(const [display,preferred] of [[fb(),'bgra'],[fb(0,16),'rgba'],[{bitsPerPixel:16},'png'],[undefined,'png']]){
  expect(preferredPixelFormat(display)).toBe(preferred);
  const p=new (bgraParser(KittyGraphicsParser,display))({binaryData:true});
  const packet=Buffer.from(`a=q,f=${BGRA_FORMAT},s=1,v=1,i=41;AAAA/w==`);
  expect(p.parsePacket(packet,{}).responseMessage).toBe('OK Buninu1 '+preferred);
  expect(new KittyGraphicsParser().parsePacket(packet,{}).responseMessage).toBe('OK');
  expect(p.images.size).toBe(0);
  expect(p.parsePacket(Buffer.from(`a=q,f=${BGRA_FORMAT},s=2,v=1,i=41;AAAA/w==`),{}).responseMessage).toStartWith('ERROR:');
 }
 const bad=fb();bad.fields.red.msbRight=1;
 expect(preferredPixelFormat(bad)).toBe('png');expect(preferredPixelFormat(fb(),false)).toBe('png');
});
