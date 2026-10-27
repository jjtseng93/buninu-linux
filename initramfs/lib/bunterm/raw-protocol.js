import fs from "node:fs";
import {ownMapping, retainMapping} from "../mapped-frame.js";
// Buninu private extension; not a registered Kitty pixel format.
export const BGRA_FORMAT = 0x42475241;
export function preferredPixelFormat(display, littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1) {
  if (!littleEndian || display?.bitsPerPixel !== 32) return 'png';
  const f=display.fields;
  const channel=(field,offset)=>field?.offset===offset&&field.length===8&&!field.msbRight;
  const alpha=f?.transp;
  if(alpha?.length && !channel(alpha,24))return 'png';
  if(!channel(f?.green,8))return 'png';
  if(channel(f?.red,16)&&channel(f?.blue,0))return 'bgra';
  if(channel(f?.red,0)&&channel(f?.blue,16))return 'rgba';
  return 'png';
}
// Only the native renderer advertises these formats; browser jsgotty is unchanged.
export function bgraParser(Base,display) {
  return class extends Base {
    constructor(...args) {
      super(...args);
      // The parser cache and renderer have independent lifetimes. Replacing a
      // cache entry must not detach a frame still being drawn or handled.
      this.images = new MappedImages(this.images);
      this.mappingReads = [];
      this.disposed = false;
    }

    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      this.images.clear();
      this.transfers.clear();
      this.pending = Buffer.alloc(0);
      for (const release of this.mappingReads) release?.();
      this.mappingReads = [];
    }

    _readImageFile(control,payloadText,deleteAfterRead) {
      // Only complete raw temporary frames are immutable producer handoffs.
      // Ordinary files, compressed/partial transfers keep the copying reader.
      const format=Number(control.f);
      if(!deleteAfterRead || ![32,BGRA_FORMAT].includes(format) || control.O || control.S || control.o || typeof Bun.mmap!=="function")
        return super._readImageFile(control,payloadText,deleteAfterRead);
      const path=fs.realpathSync(Buffer.from(payloadText,"base64").toString("utf8"));
      const stat=fs.statSync(path),w=Number(control.s),h=Number(control.v);
      if(!this._isSafeTempGraphicsPath(path)||!stat.isFile()||!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>16777216||stat.size!==w*h*4)
        return super._readImageFile(control,payloadText,deleteAfterRead);
      let bytes;
      try { bytes=Bun.mmap(path,{shared:false}); }
      catch { return super._readImageFile(control,payloadText,deleteAfterRead); }
      // Keep the mapping through parsing, even for queries/errors that do not
      // enter the image cache. Never truncate/reuse producer files.
      this.mappingReads.push(ownMapping(bytes));
      try { fs.unlinkSync(path); } catch {}
      return Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    }

    _resolveImageData(control,payload) {
      const bytes=super._resolveImageData(control,payload);
      if(Number(control.f)===BGRA_FORMAT){
        const w=Number(control.s),h=Number(control.v);
        if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>16777216||bytes.length!==w*h*4)
          throw Error('Invalid BGRA dimensions or byte count');
      }
      return bytes;
    }
    _parsePacket(packet,cursor) {
      if (this.disposed) return null;
      const previousReads = this.mappingReads;
      this.mappingReads = [];
      try {
        const result=super._parsePacket(packet,cursor);
        const release = retainMapping(result?.image?.data);
        // The consumer uses `using` while awaiting image handling/ACKs. This
        // protects the result even if the parser cache is replaced or closed.
        if (release) result[Symbol.dispose] = release;
        if(result?.kind==='query'&&Number(result.control.f)===BGRA_FORMAT&&result.responseMessage==='OK')
          result.responseMessage='OK Buninu1 '+preferredPixelFormat(display);
        return result;
      } finally {
        for (const release of this.mappingReads) release?.();
        this.mappingReads = previousReads;
      }
    }
  };
}

class MappedImages extends Map {
  constructor(entries) {
    super();
    this.releases = new Map();
    for (const [id, image] of entries) this.set(id, image);
  }
  set(id, image) {
    const release = retainMapping(image?.data);
    this.delete(id);
    super.set(id, image);
    if (release) this.releases.set(id, release);
    return this;
  }
  delete(id) {
    this.releases.get(id)?.();
    this.releases.delete(id);
    return super.delete(id);
  }
  clear() {
    for (const release of this.releases.values()) release();
    this.releases.clear();
    super.clear();
  }
}
