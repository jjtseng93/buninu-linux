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

import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('raw temporary mappings survive unlink; regular and partial files retain copying behavior',()=>{
 const dir=fs.mkdtempSync(join(tmpdir(),'tty-graphics-protocol-mmap-'));
 const parser=new (bgraParser(KittyGraphicsParser,fb()))({binaryData:true});
 const bytes=Buffer.from([1,2,3,255,4,5,6,255]);
 try{
  for(const format of [32,BGRA_FORMAT]){
   const path=join(dir,'frame');fs.writeFileSync(path,bytes);
   const got=parser._readImageFile({f:String(format),s:'2',v:'1'},Buffer.from(path).toString('base64'),true);
   expect(fs.existsSync(path)).toBe(false);expect(got).toEqual(bytes);
  }
  const path=join(dir,'regular');fs.writeFileSync(path,bytes);
  const payload=Buffer.from(path).toString('base64'),control={f:String(BGRA_FORMAT),s:'2',v:'1'};
  expect(parser._readImageFile(control,payload,false)).toEqual(bytes);expect(fs.existsSync(path)).toBe(true);
  expect(parser._readImageFile({...control,O:'4',S:'4'},payload,true)).toEqual(bytes.subarray(4));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
