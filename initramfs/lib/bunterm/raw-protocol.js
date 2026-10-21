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
      const result=super._parsePacket(packet,cursor);
      if(result?.kind==='query'&&Number(result.control.f)===BGRA_FORMAT&&result.responseMessage==='OK')
        result.responseMessage='OK Buninu1 '+preferredPixelFormat(display);
      return result;
    }
  };
}
