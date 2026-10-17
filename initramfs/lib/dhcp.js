// DHCPv4 codec and lease state machine. Network/configuration adapters are
// separate so protocol tests never change the host's addresses or resolver.
import { randomBytes } from 'node:crypto';
export const TYPE = { DISCOVER:1, OFFER:2, REQUEST:3, DECLINE:4, ACK:5, NAK:6, RELEASE:7 };
export const ipv4 = text => {
  const parts=String(text).split('.');
  if(parts.length!==4 || parts.some(p=>!/^\d{1,3}$/.test(p)||Number(p)>255))throw new Error(`invalid IPv4 address: ${text}`);
  return Buffer.from(parts.map(Number));
};
const address=b=>[...b].join('.');
export function checksum(b) {let n=0;for(let i=0;i<b.length;i+=2)n+=(b[i]<<8)|(b[i+1]??0);while(n>>>16)n=(n&65535)+(n>>>16);return (~n)&65535;}
export function encode({type,xid,mac,requested,server,ciaddr='0.0.0.0',hostname,secs=0,broadcast=true}) {
  const b=Buffer.alloc(240);b[0]=1;b[1]=1;b[2]=6;b.writeUInt32BE(xid,4);b.writeUInt16BE(Math.min(65535,secs),8);
  b.writeUInt16BE(broadcast?0x8000:0,10);ipv4(ciaddr).copy(b,12);Buffer.from(mac).copy(b,28,0,6);b.writeUInt32BE(0x63825363,236);
  const options=[];
  const option=(code,value)=>{value=Buffer.from(value);if(value.length>255)throw new Error('DHCP option too long');options.push(Buffer.from([code,value.length]),value);};
  option(53,[type]);option(61,[1,...mac]);
  if(requested)option(50,ipv4(requested));if(server)option(54,ipv4(server));
  if(hostname)option(12,Buffer.from(hostname));
  if(type!==TYPE.RELEASE){option(55,[1,3,6,15,28,51,58,59]);option(57,[5,220]);}
  const packet=Buffer.concat([b,...options,Buffer.from([255])]);
  return packet.length<300?Buffer.concat([packet,Buffer.alloc(300-packet.length)]):packet;
}
export function decode(b,{xid,mac}={}) {
  if(b.length<240||b[0]!==2||b[1]!==1||b[2]!==6||b.readUInt32BE(236)!==0x63825363)return null;
  if(xid!==undefined&&b.readUInt32BE(4)!==xid)return null;
  if(mac&&!b.subarray(28,34).equals(Buffer.from(mac)))return null;
  const options=new Map();
  function parse(start,end){for(let i=start;i<end;){const code=b[i++];if(code===255)return true;if(!code)continue;if(i>=end)return false;const len=b[i++];if(i+len>end)return false;options.set(code,Buffer.concat([options.get(code)??Buffer.alloc(0),b.subarray(i,i+len)]));i+=len;}return true;}
  if(!parse(240,b.length))return null;
  const overload=options.get(52);if(overload&&(overload.length!==1||overload[0]>3))return null;
  if(overload?.[0]&1)if(!parse(108,236))return null;
  if(overload?.[0]&2)if(!parse(44,108))return null;
  if(options.get(53)?.length!==1)return null;
  for(const code of [1,28,51,54,58,59])if(options.has(code)&&options.get(code).length!==4)return null;
  for(const code of [3,6])if(options.has(code)&&(!options.get(code).length||options.get(code).length%4))return null;
  const ip=code=>options.has(code)?address(options.get(code)):undefined;
  const ips=code=>{const v=options.get(code),out=[];if(v)for(let i=0;i<v.length;i+=4)out.push(address(v.subarray(i,i+4)));return out;};
  const number=code=>options.get(code)?.readUInt32BE(0);
  return {type:options.get(53)[0],xid:b.readUInt32BE(4),address:address(b.subarray(16,20)),server:ip(54),mask:ip(1),routers:options.has(3)?ips(3):undefined,dns:options.has(6)?ips(6):undefined,lease:number(51),t1:number(58),t2:number(59)};
}
export function prefixOf(mask) {
  const n=ipv4(mask).readUInt32BE(),inverse=(~n)>>>0;
  if((inverse&(inverse+1))!==0)throw new Error('DHCP supplied a non-contiguous subnet mask');
  return 32-Math.log2(inverse+1);
}
export function leaseFrom(reply,previous,now) {
  const ip=reply.address==='0.0.0.0'?previous?.address:reply.address;
  const server=reply.server,mask=reply.mask??previous?.mask;
  if(!ip||ip==='0.0.0.0'||!server||!mask||!reply.lease)throw new Error('DHCP ACK is missing address, server, mask or lease duration');
  const prefix=prefixOf(mask),seconds=reply.lease;
  let t1=reply.t1??seconds*.5,t2=reply.t2??seconds*.875;
  if(!(t1>0&&t1<t2&&t2<seconds)){t1=seconds*.5;t2=seconds*.875;}
  return {address:ip,server,mask,prefix,routers:reply.routers??previous?.routers??[],dns:reply.dns??previous?.dns??[],seconds,
    acquiredAt:now,renewAt:now+t1*1000,rebindAt:now+t2*1000,expiresAt:now+seconds*1000};
}
// SOCK_DGRAM AF_PACKET supplies/consumes the Ethernet header itself.
export function wrapIPv4(payload,source='0.0.0.0',destination='255.255.255.255') {
  const b=Buffer.alloc(28+payload.length);b[0]=0x45;b.writeUInt16BE(b.length,2);b[8]=64;b[9]=17;
  ipv4(source).copy(b,12);ipv4(destination).copy(b,16);b.writeUInt16BE(checksum(b.subarray(0,20)),10);
  b.writeUInt16BE(68,20);b.writeUInt16BE(67,22);b.writeUInt16BE(8+payload.length,24);payload.copy(b,28);
  // IPv4 allows zero UDP checksum; the IPv4 header is checksummed above.
  return b;
}
export function unwrapIPv4(b) {
  if(b.length<28||b[0]>>>4!==4||b[9]!==17)return null;
  const h=(b[0]&15)*4,n=b.readUInt16BE(2);
  if(h<20||n>b.length||n<h+8||(b.readUInt16BE(6)&0x3fff)||checksum(b.subarray(0,h)))return null;
  const len=b.readUInt16BE(h+4);
  if(b.readUInt16BE(h)!==67||b.readUInt16BE(h+2)!==68||len<8||h+len>n)return null;
  if(b.readUInt16BE(h+6)){
    const pseudo=Buffer.alloc(12);b.copy(pseudo,0,12,20);pseudo[9]=17;pseudo.writeUInt16BE(len,10);
    if(checksum(Buffer.concat([pseudo,b.subarray(h,h+len)])))return null;
  }
  return b.subarray(h+8,h+len);
}
export class NakError extends Error {}
export class DhcpClient {
  constructor({transport,mac,hostname,timeout=60,signal,log=()=>{},now=Date.now,sleep=ms=>Bun.sleep(ms),random=Math.random}) {
    Object.assign(this,{transport,mac,hostname,timeout,signal,log,now,sleep,random});
  }
  get stopped(){return this.signal?.aborted;}
  async exchange(fields,types,deadline,server) {
    const xid=randomBytes(4).readUInt32BE(),start=this.now();let retry=0,next=start;
    while(!this.stopped&&this.now()<deadline){
      if(this.now()>=next){
        const packet=encode({...fields,xid,mac:this.mac,hostname:this.hostname,secs:Math.floor((this.now()-start)/1000)});
        this.transport.send(packet,fields.broadcast===false?server:undefined);
        next=this.now()+Math.min(64000,4000*2**Math.min(retry++,4))*(.75+.5*this.random());
      }
      // Bound the work per iteration so unrelated traffic cannot starve timers.
      for(let i=0;i<64;i++){
        const packet=this.transport.receive();if(!packet)break;
        const reply=decode(packet,{xid,mac:this.mac});
        if(!reply||!types.includes(reply.type)||!reply.server||(server&&reply.server!==server))continue;
        if(reply.type===TYPE.NAK)throw new NakError('DHCP server rejected the lease');
        return {reply,sentAt:start};
      }
      await this.sleep(Math.min(20,Math.max(1,deadline-this.now())));
    }
    return null;
  }
  async acquire() {
    const deadline=this.now()+this.timeout*1000;
    while(!this.stopped&&this.now()<deadline){
      this.log('DHCPDISCOVER');
      const offer=await this.exchange({type:TYPE.DISCOVER},[TYPE.OFFER],deadline);
      if(!offer)return null;
      if(offer.reply.address==='0.0.0.0')continue;
      this.log(`DHCPOFFER ${offer.reply.address} from ${offer.reply.server}`);
      try {
        const result=await this.exchange({type:TYPE.REQUEST,requested:offer.reply.address,server:offer.reply.server},[TYPE.ACK,TYPE.NAK],Math.min(deadline,this.now()+16000),offer.reply.server);
        if(result){if(result.reply.address!==offer.reply.address)continue;return leaseFrom(result.reply,offer.reply,result.sentAt);}
      }catch(error){if(!(error instanceof NakError))throw error;await this.sleep(1000);}
    }
    return null;
  }
  async renew(lease,rebind=false) {
    this.log(rebind?'DHCPREQUEST broadcast (rebinding)':'DHCPREQUEST unicast (renewing)');
    const result=await this.exchange({type:TYPE.REQUEST,ciaddr:lease.address,broadcast:rebind},[TYPE.ACK,TYPE.NAK],rebind?lease.expiresAt:lease.rebindAt,rebind?undefined:lease.server);
    return result?leaseFrom(result.reply,lease,result.sentAt):null;
  }
  release(lease){this.transport.send(encode({type:TYPE.RELEASE,xid:randomBytes(4).readUInt32BE(),mac:this.mac,ciaddr:lease.address,server:lease.server,broadcast:false}),lease.server);}
}
