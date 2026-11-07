// Per browser connection. Only replaceable C=1 placements use frame credits;
// ordinary terminal output, scrolling placements and CLI clients stay ordered.
class KittyFrameFlow {
  constructor(send) { this.send=send;this.enabled=false;this.visible=true;this.sequence=0;this.inFlight=new Set();this.pending=new Map();this.tail=''; }
  control(message) {
    if(message?.version!==1)return;
    this.enabled=true;
    if(typeof message.visible==='boolean')this.visible=message.visible;
    if(Number.isSafeInteger(message.ack))this.inFlight.delete(message.ack);
    this.flush();
  }
  graphic(graphic) {
    if(!this.enabled)return false;
    if(graphic.kind==='delete'){
      const d=graphic.delete||{};
      for(const [key,g] of this.pending)if(d.scope==='a'||d.scope==='A'||String(g.image.id)===String(d.imageId))this.pending.delete(key);
      return false;
    }
    const c=graphic.control||{},id=c.i||c.I||graphic.image?.id;
    if(graphic.kind!=='placement'||!graphic.image||!id)return false;
    if(String(c.C)!=='1'){this.pending.delete(`${id}:${c.p||'0'}`);return false;}
    const key=`${id}:${c.p||'0'}`;
    // Preserve ordering among different placements when replacing an update.
    this.pending.delete(key);this.pending.set(key,graphic);this.flush();return true;
  }
  output(payload) {
    if(!this.enabled)return;
    const text=this.tail+Buffer.from(payload,'base64').toString('utf8');
    if(text.includes('\x1bc')||text.includes('\f')||/\x1b\[\?(?:1049|1047|47)[hl]/.test(text))this.pending.clear();
    this.tail=text.slice(-32);
  }
  flush() {
    while(this.enabled&&this.visible&&this.inFlight.size<2&&this.pending.size){
      const [key,graphic]=this.pending.entries().next().value;this.pending.delete(key);
      const sequence=++this.sequence;this.inFlight.add(sequence);
      this.send({...graphic,frameSequence:sequence});
    }
  }
}
module.exports={KittyFrameFlow};
