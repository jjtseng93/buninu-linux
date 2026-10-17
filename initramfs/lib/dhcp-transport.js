import {libc,ptr,check,errno,SysError,cString,withInetSocket} from './dlopen.js';
import {ipv4,wrapIPv4,unwrapIPv4} from './dhcp.js';
export function interfaceInfo(name) {
  if(!/^[a-zA-Z0-9_.:-]{1,15}$/.test(name))throw new Error('invalid interface name');
  return withInetSocket(ioctl=>{
    const req=Buffer.alloc(40);req.write(name);ioctl(0x8933,req,'SIOCGIFINDEX');const index=req.readInt32LE(16);
    ioctl(0x8927,req,'SIOCGIFHWADDR');if(req.readUInt16LE(16)!==1)throw new Error('DHCP requires an Ethernet-compatible interface');
    return {index,mac:Buffer.from(req.subarray(18,24))};
  });
}
const sockaddr=(ip,port)=>{const b=Buffer.alloc(16);b.writeUInt16LE(2);b.writeUInt16BE(port,2);ipv4(ip).copy(b,4);return b;};
export function openTransport(name,{index}) {
  const f=libc.symbols, descriptors=[];
  try {
    // Packet sockets work before the interface has any IPv4 address or route.
    const raw=check('socket(AF_PACKET): requires CAP_NET_RAW',f.socket(17,2|0x800|0x80000,0x0008));descriptors.push(raw);
    const link=Buffer.alloc(20);link.writeUInt16LE(17);link.writeUInt16BE(0x0800,2);link.writeInt32LE(index,4);link[11]=6;link.fill(255,12,18);
    check('bind(AF_PACKET)',f.bind(raw,ptr(link),link.length));
    // Reserve the client UDP port and use kernel routing/ARP for unicast renew
    // and release. The packet socket receives both broadcast and unicast replies.
    const udp=check('socket(UDP)',f.socket(2,2|0x800|0x80000,17));descriptors.push(udp);
    const device=cString(name);check('SO_BINDTODEVICE',f.setsockopt(udp,1,25,ptr(device),device.length));
    const local=sockaddr('0.0.0.0',68);check('bind UDP port 68 (another DHCP client may be running)',f.bind(udp,ptr(local),16));
    const buffer=Buffer.alloc(65535);
    return {
      send(payload,server){
        const destination=server?sockaddr(server,67):link;
        const bytes=server?payload:wrapIPv4(payload,payload.subarray(12,16).join('.'));
        check('sendto(DHCP)',Number(f.sendto(server?udp:raw,ptr(bytes),bytes.length,0,ptr(destination),destination.length)));
      },
      receive(){
        // Drain the UDP copy so its receive buffer does not remain full.
        for(let i=0;i<64;i++)if(f.recv(udp,ptr(buffer),buffer.length,0)<0)break;
        for(let i=0;i<64;i++){
          const n=f.recv(raw,ptr(buffer),buffer.length,0);
          if(n<0){const code=errno();if(code===11||code===4)return null;throw new SysError('recv(DHCP)',code);}
          const payload=unwrapIPv4(buffer.subarray(0,Number(n)));if(payload)return Buffer.from(payload);
        }
        return null;
      },
      close(){for(const fd of descriptors.splice(0))f.close(fd);},
    };
  }catch(error){for(const fd of descriptors)f.close(fd);throw error;}
}
