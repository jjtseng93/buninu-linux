import {test,expect} from 'bun:test';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {parsePing,checksum,echoPacket,isEchoReply} from '../initramfs/lib/ping.js';
const command=resolve(import.meta.dir,'../initramfs/bin/ping');
const system=Bun.which('ping');
const separatePing6=Bun.which('ping6');
const supports6=system&&spawnSync(system,['-6','-c','1','-W','1','::1'],{encoding:'utf8',timeout:2000}).status===0;
const run=(args,reference=false)=>{
 const usePing6=reference&&args.includes('-6')&&!supports6&&separatePing6;
 const executable=reference?(usePing6?separatePing6:system):process.execPath;
 const options=reference?args.filter(a=>a!=='-4'&&(!usePing6||a!=='-6')):[command,...args];
 return spawnSync(executable,options,{encoding:'utf8',timeout:6000,env:{...process.env,LC_ALL:'C'}});
};
const summary=s=>{const m=/(\d+) packets transmitted, (\d+) (?:packets )?received,.*?(\d+)% packet loss/.exec(s);return m?m.slice(1).map(Number):null};
const probe=system?run(['-4','-c','1','-W','1','127.0.0.1'],true):null;
const available=probe?.status===0;

test('ping parses common flags and rejects malformed arguments',()=>{
 expect(parsePing(['-4nqD','-c3','-i','.2','-W','1','-w','5','-s','17','-t64','-I','lo','localhost'])).toMatchObject({family:4,count:3,interval:.2,timeout:1,deadline:5,size:17,ttl:64,source:'lo',host:'localhost',quiet:true,timestamp:true});
 expect(parsePing(['-6','--','::1']).family).toBe(6);
 for(const args of [[],['-c'],['-c','0','localhost'],['-c','Infinity','localhost'],['-W','NaN','localhost'],['-s','65508','localhost'],['-s','-1','localhost'],['-t','256','localhost'],['-i','0','localhost'],['-w','0','localhost'],['-Z','localhost'],['a','b']])expect(()=>parsePing(args)).toThrow();
 expect(parsePing(['--help']).help).toBe(true);
 expect(run(['-c','0','127.0.0.1']).status).toBe(2);
});

test('ICMP checksum, reply identity, data integrity and raw IPv4 header validation',()=>{
 for(const size of [0,1,17,56]){
  const request=echoPacket(4,123,7,size);expect(checksum(request)).toBe(0);
  const reply=Buffer.from(request);reply[0]=0;reply.writeUInt16BE(0,2);reply.writeUInt16BE(checksum(reply),2);
  const info={family:4,raw:false,id:123,seq:7,packet:request};
  expect(isEchoReply(reply,info)).toBe(true);expect(isEchoReply(request,info)).toBe(false);
  expect(isEchoReply(reply,{...info,id:124})).toBe(false);expect(isEchoReply(reply,{...info,seq:8})).toBe(false);
  const ip=Buffer.alloc(24);ip[0]=0x46;ip[9]=1;
  expect(isEchoReply(Buffer.concat([ip,reply]),{...info,raw:true})).toBe(true);
  expect(isEchoReply(reply.subarray(0,7),info)).toBe(false);
  if(size){reply[8]^=1;expect(isEchoReply(reply,info)).toBe(false);}
 }
 const packet=echoPacket(6,3,4,8),reply=Buffer.from(packet);reply[0]=129;
 expect(isEchoReply(reply,{family:6,raw:false,id:3,seq:4,packet})).toBe(true);
});

for(const size of [0,17,56,1400])test.skipIf(!available)(`system ping comparison: IPv4 count, payload ${size}, statistics and exit status`,()=>{
 const args=['-4','-n','-c','3','-i','0.2','-W','1','-s',String(size),'127.0.0.1'];
 const reference=run(args,true),actual=run(args);
 expect(actual.status).toBe(reference.status);expect(actual.status).toBe(0);
 expect(summary(actual.stdout)).toEqual(summary(reference.stdout));expect(summary(actual.stdout)).toEqual([3,3,0]);
 expect(actual.stdout).toContain(`${size+8} bytes from 127.0.0.1`);expect(actual.stdout).toContain('icmp_seq=3');
 expect(actual.stdout).toMatch(/rtt min\/avg\/max\/mdev = [\d.]+\/[\d.]+\/[\d.]+\/[\d.]+ ms/);
});

test.skipIf(!available)('system ping comparison: hostname, source address, quiet mode and TTL',()=>{
 const args=['-4','-n','-q','-c','2','-i','.2','-W','1','-t','32','-I','127.0.0.1','localhost'];
 const reference=run(args,true),actual=run(args);
 expect(actual.status).toBe(reference.status);expect(actual.status).toBe(0);expect(summary(actual.stdout)).toEqual(summary(reference.stdout));expect(actual.stdout).not.toContain('icmp_seq=');
});
const ipv6=available&&run(['-6','-c','1','-W','1','::1'],true).status===0;
test.skipIf(!ipv6)('system ping comparison: IPv6 loopback',()=>{
 const args=['-6','-n','-c','3','-i','.2','-W','1','::1'],reference=run(args,true),actual=run(args);
 expect(actual.status).toBe(reference.status);expect(actual.status).toBe(0);expect(summary(actual.stdout)).toEqual([3,3,0]);expect(summary(actual.stdout)).toEqual(summary(reference.stdout));
});
test.skipIf(!available)('system ping comparison: deadline before requested count returns failure',()=>{
 const args=['-4','-q','-c','100','-i','.2','-w','1','127.0.0.1'],reference=run(args,true),begin=performance.now(),actual=run(args);
 expect(actual.status).toBe(reference.status);expect(actual.status).toBe(1);expect(performance.now()-begin).toBeLessThan(2500);expect(summary(actual.stdout)[0]).toBeLessThan(100);
});
test.skipIf(!available)('Ctrl-C prints statistics and releases the socket',async()=>{
 const child=Bun.spawn([process.execPath,command,'-i','.2','127.0.0.1'],{stdout:'pipe',stderr:'pipe'});
 const reader=child.stdout.getReader();let output='';
 try{
  for(;;){const {value,done}=await reader.read();if(done)break;output+=new TextDecoder().decode(value);if(output.includes('icmp_seq=')){child.kill('SIGINT');break;}}
  for(;;){const {value,done}=await reader.read();if(done)break;output+=new TextDecoder().decode(value);}
  expect(await child.exited).toBe(0);expect(output).toContain('ping statistics');expect(summary(output)[1]).toBeGreaterThan(0);
 }finally{child.kill();reader.releaseLock();}
},6000);

test.skipIf(!available)('sub-200ms interval and fractional timeout are supported independently of old Android ping',()=>{
 const r=run(['-c','3','-i','.01','-W','.1','-D','127.0.0.1']);
 expect(r.status).toBe(0);expect(summary(r.stdout)).toEqual([3,3,0]);expect(r.stdout).toMatch(/\[\d+\.\d+\] 64 bytes/);
});
