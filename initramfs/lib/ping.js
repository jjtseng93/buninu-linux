import { isIP } from 'node:net';
import { randomBytes } from 'node:crypto';

export function parsePing(args) {
  const o={count:4,interval:1,timeout:2,deadline:Infinity,size:56,ttl:64,family:0,quiet:false,timestamp:false};
  const values={c:'count',i:'interval',W:'timeout',w:'deadline',s:'size',t:'ttl',I:'source'};
  let positional=false;
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(!positional&&arg==='--'){positional=true;continue;}
    if(!positional&&(arg==='--help'||arg==='-h')){o.help=true;continue;}
    if(!positional&&arg.startsWith('-')&&arg!=='-'){
      for(let j=1;j<arg.length;j++){
        const flag=arg[j];
        if(values[flag]){const value=arg.slice(j+1)||args[++i];if(value===undefined||value==='')throw Error(`-${flag} requires a value`);if(flag!=='I'&&(!Number.isFinite(Number(value))||!value.trim()))throw Error(`invalid ${values[flag]}`);o[values[flag]]=flag==='I'?value:Number(value);break;}
        if(flag==='4'||flag==='6')o.family=Number(flag);
        else if(flag==='q')o.quiet=true;
        else if(flag==='D')o.timestamp=true;
        else if(flag!=='n')throw Error(`unknown option -${flag}`);
      }
    }else{if(o.host)throw Error('only one destination is supported');o.host=arg;}
  }
  if(o.help)return o;
  if(!o.host)throw Error('destination required (see ping --help)');
  for(const key of ['count','size','ttl'])if((key!=='count'||o.count!==Infinity)&&(!Number.isInteger(o[key])||o[key]<(key==='size'?0:1)))throw Error(`invalid ${key}`);
  if(o.size>65507||o.ttl>255||o.count>Number.MAX_SAFE_INTEGER&&o.count!==Infinity)throw Error('count, packet size or TTL out of range');
  for(const key of ['interval','timeout','deadline'])if(!(o[key]>0)||(!Number.isFinite(o[key])&&!(key==='deadline'&&o[key]===Infinity)))throw Error(`invalid ${key}`);
  if(o.interval<.002)throw Error('minimum interval is 0.002 seconds');
  return o;
}
export function checksum(bytes) {
  let sum=0;for(let i=0;i<bytes.length;i+=2)sum+=(bytes[i]<<8)|(bytes[i+1]??0);
  while(sum>>>16)sum=(sum&65535)+(sum>>>16);return (~sum)&65535;
}
export function echoPacket(family,id,seq,size) {
  const b=Buffer.alloc(size+8);b[0]=family===6?128:8;b.writeUInt16BE(id,4);b.writeUInt16BE(seq,6);randomBytes(size).copy(b,8);
  if(family===4)b.writeUInt16BE(checksum(b),2);return b;
}
export function isEchoReply(bytes,{family,raw,id,seq,packet}) {
  let offset=0;
  if(raw&&family===4){if(bytes.length<20||bytes[0]>>>4!==4||bytes[9]!==1)return false;offset=(bytes[0]&15)*4;if(offset<20||offset>bytes.length-8)return false;}
  const b=bytes.subarray(offset);
  return b.length===packet.length&&b[0]===(family===6?129:0)&&b[1]===0&&b.readUInt16BE(4)===id&&b.readUInt16BE(6)===seq&&b.subarray(8).equals(packet.subarray(8))&&(family===6||checksum(b)===0);
}
export async function runPing(o,{log=console.log,error=console.error,forceRaw=false}={}) {
  if(!['linux','android'].includes(process.platform))throw Error('ping currently supports Linux and Android; Windows needs an ICMP API backend');
  const {libc,ptr,cString,errno,SysError,check}=await import('./dlopen.js');
  const c=libc.symbols;
  let family=o.family||isIP(o.host)||4,address=o.host;
  if(isIP(address)&&isIP(address)!==family)throw Error('destination does not match selected address family');
  if(!isIP(address)){
    const records=await Bun.dns.lookup(address,{family});address=records.find(r=>r.family===family)?.address;
    if(!address)throw Error(`no IPv${family} address for ${o.host}`);
  }
  const af=family===6?10:2;
  const sockaddr=value=>{
    const b=Buffer.alloc(family===6?28:16);b.writeUInt16LE(af,0);
    if(c.inet_pton(af,ptr(cString(value)),ptr(b.subarray(family===6?8:4)))!==1)throw Error(`invalid IPv${family} address: ${value}`);
    return b;
  };
  let raw=forceRaw,fd=c.socket(af,(raw?3:2)|0x80800,family===6?58:1);
  if(fd<0&&!raw){const code=errno();if(![1,13,93,97].includes(code))throw new SysError('ICMP socket',code);raw=true;fd=c.socket(af,3|0x80800,family===6?58:1);}
  if(fd<0)throw new SysError('ICMP socket (allow ping_group_range or CAP_NET_RAW)');
  let stop=false;const interrupt=()=>{stop=true};let transmitted=0,received=0,min=Infinity,max=0,sum=0,sumSquares=0;
  const started=performance.now(),pending=new Map();let next=started;
  const prefix=()=>o.timestamp?`[${(Date.now()/1000).toFixed(6)}] `:'';
  try{
    if(o.source){
      if(isIP(o.source)){const src=sockaddr(o.source);check('bind source address',c.bind(fd,ptr(src),src.length));}
      else{const name=cString(o.source);check('bind interface',c.setsockopt(fd,1,25,ptr(name),name.length));}
    }
    const ttl=Buffer.alloc(4);ttl.writeInt32LE(o.ttl);check('set TTL',c.setsockopt(fd,family===6?41:0,family===6?16:2,ptr(ttl),4));
    const remote=sockaddr(address);check('connect',c.connect(fd,ptr(remote),remote.length));
    const local=Buffer.alloc(28),length=Buffer.alloc(4);length.writeUInt32LE(local.length);check('getsockname',c.getsockname(fd,ptr(local),ptr(length)));
    const id=raw?randomBytes(2).readUInt16BE():local.readUInt16BE(2);
    log(`PING ${o.host} (${address}) ${o.size} data bytes`);
    process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
    const buffer=Buffer.alloc(65536);
    while(!stop&&performance.now()-started<o.deadline*1000){
      let now=performance.now();
      if(transmitted<o.count&&now>=next){
        const seq=(transmitted+1)&65535;
        // Avoid confusing a sequence that wrapped while an old probe is pending.
        if(!pending.has(seq)){
          const packet=echoPacket(family,id,seq,o.size);const sent=Number(c.send(fd,ptr(packet),packet.length,0));
          if(sent!==packet.length)throw new SysError('send');
          transmitted++;pending.set(seq,{packet,start:now});
        }
        next=now+o.interval*1000;
      }
      for(let n=0;n<64;n++){
        const size=Number(c.recv(fd,ptr(buffer),buffer.length,0));
        if(size<0){const code=errno();if(code===11)break;if(code===4)continue;if([101,111,113].includes(code)){if(!o.quiet)error(`${prefix()}ping: ${new SysError('receive',code).message}`);break;}throw new SysError('receive',code);}
        const b=buffer.subarray(0,size),offset=raw&&family===4?(b[0]&15)*4:0;
        if(size<offset+8)continue;const seq=b.readUInt16BE(offset+6),p=pending.get(seq);
        if(!p||!isEchoReply(b,{family,raw,id,seq,packet:p.packet}))continue;
        const ms=performance.now()-p.start;pending.delete(seq);received++;min=Math.min(min,ms);max=Math.max(max,ms);sum+=ms;sumSquares+=ms*ms;
        if(!o.quiet)log(`${prefix()}${p.packet.length} bytes from ${address}: icmp_seq=${seq}${raw&&family===4?` ttl=${b[8]}`:''} time=${ms.toFixed(3)} ms`);
      }
      now=performance.now();for(const [seq,p] of pending)if(now-p.start>=o.timeout*1000){pending.delete(seq);if(!o.quiet)log(`${prefix()}Request timeout for icmp_seq=${seq}`);}
      if(transmitted>=o.count&&!pending.size)break;
      const sendDelay=transmitted<o.count?next-now:10;
      await Bun.sleep(Math.max(1,Math.min(10,sendDelay,started+o.deadline*1000-now)));
    }
  }finally{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);c.close(fd);}
  log(`\n--- ${o.host} ping statistics ---`);
  log(`${transmitted} packets transmitted, ${received} received, ${transmitted?((transmitted-received)/transmitted*100).toFixed(0):0}% packet loss, time ${Math.round(performance.now()-started)}ms`);
  if(received)log(`rtt min/avg/max/mdev = ${min.toFixed(3)}/${(sum/received).toFixed(3)}/${max.toFixed(3)}/${Math.sqrt(Math.max(0,sumSquares/received-(sum/received)**2)).toFixed(3)} ms`);
  return received>0&&!(Number.isFinite(o.deadline)&&Number.isFinite(o.count)&&received<o.count)?0:1;
}
