import {test, expect} from 'bun:test';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {bgraParser, BGRA_FORMAT} from '../initramfs/lib/bunterm/raw-protocol.js';
import {ownMapping, retainMapping} from '../initramfs/lib/mapped-frame.js';
import {createRawImage, rawImageData, skiaImage} from '../initramfs/lib/raw-image.js';
import {ImageStore} from '../initramfs/lib/bunterm/images.js';
const {KittyGraphicsParser} = createRequire(import.meta.url)('../initramfs/buninu/apps/jsgotty/gotty.js');
const CK = {ColorType:{RGBA_8888:1,BGRA_8888:2}};
function fixture() {
  const dir=fs.mkdtempSync(join(tmpdir(),'tty-graphics-protocol-lifetime-'));
  const parser=new (bgraParser(KittyGraphicsParser))({binaryData:true});
  const term={buffer:{active:{type:'alternate',baseY:0,cursorY:0,cursorX:0,viewportY:0}}};
  const store=new ImageStore({CanvasKit:CK,term,renderer:{cellWidth:1,cellHeight:1,offsetX:0,offsetY:0,rows:10,invalidateRows(){}}});
  const parse=(control,payload='')=>parser.parsePacket(Buffer.from(control+';'+payload),{row:1,col:1});
  let serial=0;
  return {parser,store,parse,frame(id=1,format=BGRA_FORMAT){
    const path=join(dir,'frame'+serial++);fs.writeFileSync(path,Buffer.from([1,2,3,255]));
    return parse(`a=T,t=t,f=${format},s=1,v=1,i=${id},C=1`,Buffer.from(path).toString('base64'));
  },close(){parser.dispose();store.delete();fs.rmSync(dir,{recursive:true,force:true});}};
}

test('replacement protects parser results and renderer until their independent owners release',async()=>{
  const f=fixture();
  try {
    using first=f.frame();const bytes=first.image.data;
    await f.store.handle(first);
    using second=f.frame();
    expect(bytes.byteLength).toBe(4); // parser replaced, renderer/result still own old frame
    await f.store.handle(second);
    expect(bytes.byteLength).toBe(4); // result is still borrowed
    first[Symbol.dispose]();first[Symbol.dispose]();
    expect(bytes.byteLength).toBe(0);
    const next=second.image.data;
    f.parser.dispose();second[Symbol.dispose]();
    expect(next.byteLength).toBe(4); // renderer outlives parser
    f.store.delete();expect(next.byteLength).toBe(0);
  } finally {f.close();}
});

test('multiple placements and lowercase deletion retain pixels for re-placement',async()=>{
  const f=fixture();
  try {
    using first=f.frame(1,32);const bytes=first.image.data;
    await f.store.handle(first);first[Symbol.dispose]();
    using second=f.parse('a=p,i=1,p=two,C=1');await f.store.handle(second);second[Symbol.dispose]();
    expect(f.store.visible()).toHaveLength(2);
    await f.store.handle(f.parse('a=d,d=i,i=1,p=two'));
    expect(f.store.visible()).toHaveLength(1);expect(bytes.byteLength).toBe(4);
    await f.store.handle(f.parse('a=d,d=a'));
    expect(f.store.visible()).toHaveLength(0);expect(bytes.byteLength).toBe(4);
    using again=f.parse('a=p,i=1,C=1');await f.store.handle(again);again[Symbol.dispose]();
    expect(rawImageData(f.store.visible()[0].image).pixels[0]).toBe(1);
    await f.store.handle(f.parse('a=d,d=A'));
    expect(bytes.byteLength).toBe(0);
  } finally {f.close();}
});

test('queued frames survive replacement and parser shutdown before consumer handles them',async()=>{
  const f=fixture();
  try {
    using first=f.frame();using second=f.frame();f.parser.dispose();
    await f.store.handle(first);first[Symbol.dispose]();
    expect(first.image.data.byteLength).toBe(4);
    await f.store.handle(second);expect(first.image.data.byteLength).toBe(0);
    second[Symbol.dispose]();f.store.delete();expect(second.image.data.byteLength).toBe(0);
    expect(f.frame()).toBeNull();
  } finally {f.close();}
});

test('closing while decode awaits cannot repopulate the image store',async()=>{
  const f=fixture();
  try {
    using first=f.frame();const handling=f.store.handle(first);
    f.store.delete();f.parser.dispose();await handling;
    expect(f.store.images.size).toBe(0);expect(f.store.placements.size).toBe(0);
    first[Symbol.dispose]();expect(first.image.data.byteLength).toBe(0);
  } finally {f.close();}
});

test('using releases a borrowed frame when processing throws; ordinary buffers never detach',()=>{
  const f=fixture();let bytes;
  try {
    expect(()=>{using first=f.frame();bytes=first.image.data;f.parser.dispose();throw Error('test');}).toThrow('test');
    expect(bytes.byteLength).toBe(0);
    const ordinary=Buffer.alloc(4);const image=createRawImage(CK,ordinary,1,1,1);
    image.delete();expect(ordinary.byteLength).toBe(4);
  } finally {f.close();}
});

test('failed/unsupported transfer falls back to GC without breaking cleanup',()=>{
  for(const transfer of [undefined,()=>{throw Error('not detachable');}]){
    const bytes=new Uint8Array(4);Object.defineProperty(bytes.buffer,'transfer',{value:transfer});
    const release=ownMapping(bytes),other=retainMapping(bytes);
    release();expect(bytes.byteLength).toBe(4);
    expect(()=>{other();other();release();}).not.toThrow();
    expect(bytes.byteLength).toBe(4);
  }
});

test('query/error mappings are released even though they never enter the image cache',()=>{
  const f=fixture();const mapped=[];
  const read=f.parser._readImageFile.bind(f.parser);
  f.parser._readImageFile=(...args)=>{const bytes=read(...args);mapped.push(bytes);return bytes;};
  try {
    // A query validates its file then drops its data. Exercise the same packet
    // cleanup on an exception after the read, before the cache can retain it.
    for(const fail of [false,true]){
      const path=join(tmpdir(),'tty-graphics-protocol-query-'+process.pid);fs.writeFileSync(path,Buffer.from([1,2,3,255]));
      const resolve=f.parser._resolveImageData.bind(f.parser);
      if(fail)f.parser._resolveImageData=(...args)=>{resolve(...args);throw Error('validation failed');};
      const result=f.parse(`a=q,t=t,f=${BGRA_FORMAT},s=1,v=1,i=7`,Buffer.from(path).toString('base64'));
      expect(result.responseMessage).toStartWith(fail?'ERROR:':'OK');
      expect(mapped.at(-1).byteLength).toBe(0);
    }
    expect(f.parser.images.size).toBe(0);
  } finally {f.close();}
});

test('materialized Skia images and mapped bytes both release even if Skia cleanup throws',()=>{
  const bytes=new Uint8Array(4),owner=ownMapping(bytes);
  const image=createRawImage({...CK,AlphaType:{Unpremul:1},ColorSpace:{SRGB:1},MakeImage(){return {delete(){throw Error('Skia cleanup');}};}},bytes,1,1,1);
  owner();skiaImage(image);
  expect(()=>image.delete()).toThrow('Skia cleanup');expect(bytes.byteLength).toBe(0);
  expect(()=>image.delete()).not.toThrow();
});

test('repeated mapped replacements unmap promptly without waiting for a GC',async()=>{
  const f=fixture();let previous;
  try {
    for(let i=0;i<200;i++){
      using frame=f.frame();await f.store.handle(frame);
      if(previous)expect(previous.byteLength).toBe(0);
      previous=frame.image.data;
      expect(previous[3]).toBe(255);
    }
    f.parser.dispose();f.store.delete();expect(previous.byteLength).toBe(0);
    if(process.platform==='linux'){
      const maps=fs.readFileSync('/proc/self/maps','utf8');
      // Files were unlinked at read time; lingering mappings would still have
      // their original name followed by '(deleted)' here.
      expect(maps.split('\n').filter(line=>line.includes('tty-graphics-protocol-lifetime-'))).toHaveLength(0);
    }
  } finally {f.close();}
});
