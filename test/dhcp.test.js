import {test,expect} from 'bun:test';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {TYPE,encode,decode,leaseFrom,wrapIPv4,unwrapIPv4,checksum,DhcpClient,NakError} from '../initramfs/lib/dhcp.js';
import {parseDhclient,Configuration,manageLease} from '../initramfs/lib/dhclient.js';
const mac=Buffer.from('020000000001','hex');
function reply(request,type,{ip='10.20.0.10',server=[10,20,0,1],duration=120}={}){
 const b=Buffer.from(request.subarray(0,240));b[0]=2;Buffer.from(ip.split('.').map(Number)).copy(b,16);
 const lease=Buffer.alloc(4);lease.writeUInt32BE(duration);
 return Buffer.concat([b,Buffer.from([53,1,type,54,4,...server,1,4,255,255,255,0,51,4]),lease,Buffer.from([3,4,...server,6,4,1,1,1,1,255])]);
}
test('DHCP CLI validates options before opening sockets',()=>{
 expect(parseDhclient(['-4','-d','-1','-v','-timeout','8','--no-dns','-H','buninu','eth0'])).toMatchObject({interface:'eth0',once:true,timeout:8,dns:false});
 expect(parseDhclient(['usb0']).interface).toBe('usb0');
 expect(parseDhclient(['--metric','120','usb0']).metric).toBe(120);
 for(const args of [['--metric','32767','eth0'],[],['-6','eth0'],['-timeout','NaN','eth0'],['-r','-1','eth0'],['eth0','eth1'],['../bad']])expect(()=>parseDhclient(args)).toThrow();
});
test('codec validates xid, MAC, truncation, options, mask and lease timers',()=>{
 const req=encode({type:TYPE.DISCOVER,xid:123,mac}),ack=reply(req,TYPE.ACK);
 expect(req.length).toBeGreaterThanOrEqual(300);expect(req.readUInt16BE(10)).toBe(0x8000);
 const parsed=decode(ack,{xid:123,mac});expect(parsed.type).toBe(TYPE.ACK);
 expect(decode(ack,{xid:456,mac})).toBeNull();expect(decode(ack,{mac:Buffer.alloc(6)})).toBeNull();
 expect(decode(ack.subarray(0,ack.length-3))).toBeNull();
 expect(leaseFrom(parsed,null,1000)).toMatchObject({prefix:24,renewAt:61000,rebindAt:106000,expiresAt:121000});
 expect(()=>leaseFrom({...parsed,mask:'255.0.255.0'},null,0)).toThrow();
 expect(leaseFrom({...parsed,t1:200,t2:100},null,0).renewAt).toBe(60000);
});
test('packet transport checks header checksum, fragmentation, ports and UDP checksum',()=>{
 const payload=reply(encode({type:1,xid:1,mac}),5);
 const packet=wrapIPv4(payload,'10.20.0.1');packet.writeUInt16BE(67,20);packet.writeUInt16BE(68,22);
 expect(unwrapIPv4(packet)).toEqual(payload);
 const bad=Buffer.from(packet);bad[12]^=1;expect(unwrapIPv4(bad)).toBeNull();
 const fragment=Buffer.from(packet);fragment.writeUInt16BE(0x2000,6);fragment.writeUInt16BE(0,10);fragment.writeUInt16BE(checksum(fragment.subarray(0,20)),10);expect(unwrapIPv4(fragment)).toBeNull();
 packet.writeUInt16BE(123,26);expect(unwrapIPv4(packet)).toBeNull();
});
test('DORA retries, ignores unrelated replies, then renews and releases via unicast',async()=>{
 let time=0,discover=0;const queue=[],sent=[];
 const transport={send(b,server){sent.push({b,server});const t=b[242];
   if(t===1&&++discover===1)return;
   if(t===1){const wrong=reply(b,2);wrong.writeUInt32BE(999,4);queue.push(wrong,reply(b,2));}
   if(t===3)queue.push(reply(b,5));
 },receive(){return queue.shift();}};
 const client=new DhcpClient({transport,mac,timeout:10,now:()=>time,sleep:async ms=>{time+=ms;},random:()=>.5});
 const lease=await client.acquire();expect(lease.address).toBe('10.20.0.10');expect(discover).toBe(2);
 time=lease.renewAt;const renewed=await client.renew(lease);expect(renewed.address).toBe(lease.address);
 const renew=sent.at(-1);expect(renew.server).toBe('10.20.0.1');expect(renew.b.subarray(12,16)).toEqual(Buffer.from([10,20,0,10]));
 expect(renew.b.readUInt16BE(10)).toBe(0);
 client.release(renewed);expect(sent.at(-1).b[242]).toBe(7);expect(sent.at(-1).server).toBe(lease.server);
});
test('acquisition times out and NAK is surfaced during renewal',async()=>{
 let time=0;const queue=[];
 const client=new DhcpClient({transport:{send(){},receive:()=>queue.shift()},mac,timeout:.05,now:()=>time,sleep:async ms=>{time+=ms;}});
 expect(await client.acquire()).toBeNull();
 client.transport.send=b=>queue.push(reply(b,6));
 await expect(client.renew({address:'10.20.0.10',server:'10.20.0.1',rebindAt:1000})).rejects.toBeInstanceOf(NakError);
});
test('configuration uses existing ip commands, preserves DNS across renewal and restores it',async()=>{
 const dir=mkdtempSync(`${tmpdir()}/dhcp-test-`),path=`${dir}/resolv.conf`,calls=[];
 try {
  writeFileSync(path,'nameserver 9.9.9.9\n');
  const config=new Configuration({interface:'eth0',dns:true,resolv:path,metric:100},async args=>calls.push(args));
  const lease={address:'10.20.0.10',prefix:24,routers:['10.20.0.1'],dns:['1.1.1.1']};
  await config.apply(lease);const renewed={...lease,dns:['8.8.8.8']};await config.apply(renewed,lease);
  expect(calls[0]).toEqual(['addr','replace','10.20.0.10/24','brd','+','dev','eth0']);
  expect(readFileSync(path,'utf8')).toContain('8.8.8.8');await config.clear(renewed);
  expect(calls).toContainEqual(['route','replace','default','via','10.20.0.1','dev','eth0','metric','100']);
  expect(calls).toContainEqual(['route','del','default','via','10.20.0.1','dev','eth0','metric','100']);
  expect(readFileSync(path,'utf8')).toBe('nameserver 9.9.9.9\n');
  await config.apply(lease);writeFileSync(path,'external edit\n');await config.clear(lease);expect(readFileSync(path,'utf8')).toBe('external edit\n');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('default invocation configures once and returns without starting renewal',async()=>{
 const events=[],lease={address:'10.20.0.10',prefix:24,seconds:60};
 const client={async acquire(){events.push('acquire');return lease;},renew(){throw new Error('must not renew');},release(){events.push('release');}};
 await manageLease(client,{async apply(){events.push('apply');},async clear(){events.push('clear');}},{log:()=>{}});
 expect(events).toEqual(['acquire','apply']);
 expect(parseDhclient(['usb0']).once).toBe(true);
});
test('one-shot keeps a successful lease but cleans up failed configuration',async()=>{
 const events=[],client={async acquire(){return {address:'10.0.0.2',prefix:24,seconds:60};},release(){events.push('release');}};
 const config={async apply(){},async clear(){events.push('clear');}};
 await manageLease(client,config,{once:true,log:()=>{}});expect(events).toEqual([]);
 config.apply=async()=>{throw new Error('route failed');};
 await expect(manageLease(client,config,{once:true,log:()=>{}})).rejects.toThrow('route failed');expect(events).toEqual(['release','clear']);
});

test('runtime libc sendto delivers a UDP datagram on loopback',async()=>{
 const {libc,ptr,check}=await import('../initramfs/lib/dlopen.js');
 let received;
 const server=await Bun.udpSocket({hostname:'127.0.0.1',port:0,socket:{data(_socket,data){received=Buffer.from(data);}}});
 const fd=check('socket',libc.symbols.socket(2,2,17));
 try{
  const target=Buffer.alloc(16);target.writeUInt16LE(2);target.writeUInt16BE(server.port,2);target.set([127,0,0,1],4);
  const data=Buffer.from('dhcp transport libc probe');
  expect(check('sendto',Number(libc.symbols.sendto(fd,ptr(data),data.length,0,ptr(target),16)))).toBe(data.length);
  for(let i=0;i<100&&!received;i++)await Bun.sleep(5);
  expect(received).toEqual(data);
 }finally{libc.symbols.close(fd);server.close();}
});
