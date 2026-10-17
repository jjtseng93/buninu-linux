import {readFileSync,writeFileSync,mkdirSync,renameSync,unlinkSync,openSync,closeSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {DhcpClient} from './dhcp.js';
import {interfaceInfo,openTransport} from './dhcp-transport.js';
export function parseDhclient(args) {
  const o={timeout:60,dns:true,resolv:'/etc/resolv.conf',once:true,release:false,verbose:false};
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(['--help','-h','-help'].includes(a))return {...o,help:true};
    if(a==='-4'||a==='-d')continue;
    if(a==='-1')o.once=true;
    else if(a==='-r')o.release=true;
    else if(a==='-v')o.verbose=true;
    else if(a==='-q')o.quiet=true;
    else if(a==='--no-dns')o.dns=false;
    else if(['-timeout','-lf','-H','--resolv-conf','--metric'].includes(a)){
      const value=args[++i];if(!value||value.startsWith('-'))throw new Error(`${a} requires a value`);
      if(a==='-timeout'){o.timeout=Number(value);if(!Number.isFinite(o.timeout)||o.timeout<=0)throw new Error('timeout must be positive');}
      if(a==='--metric'){o.metric=Number(value);if(!Number.isInteger(o.metric)||o.metric<0||o.metric>32766)throw new Error('metric must be between 0 and 32766');}
      if(a==='-lf')o.leaseFile=resolve(value);
      if(a==='-H'){if(!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(value))throw new Error('invalid hostname');o.hostname=value;}
      if(a==='--resolv-conf')o.resolv=resolve(value);
    }else if(a.startsWith('-'))throw new Error(`unsupported option: ${a} (DHCPv4 only; see --help)`);
    else if(o.interface)throw new Error('specify one interface per process');
    else o.interface=a;
  }
  if(!o.interface||!/^[a-zA-Z0-9_.:-]{1,15}$/.test(o.interface))throw new Error('specify an Ethernet interface, e.g. dhclient eth0');
  o.leaseFile??=`/var/lib/dhclient/${o.interface}.json`;
  if(args.includes('-1')&&o.release)throw new Error('-1 and -r cannot be combined');
  return o;
}
export async function runIp(args) {
  const p=Bun.spawn([process.execPath,`${import.meta.dir}/../bin/ip`,...args],{stdout:'pipe',stderr:'pipe'});
  const [status,out,err]=await Promise.all([p.exited,new Response(p.stdout).text(),new Response(p.stderr).text()]);
  if(status)throw new Error(`ip ${args.join(' ')}: ${err.trim()||out.trim()}`);
  return out;
}
const readOptional=path=>{try{return readFileSync(path,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw e;}};
export function saveLease(path,lease) {
  mkdirSync(dirname(path),{recursive:true});const tmp=`${path}.${process.pid}.tmp`;
  writeFileSync(tmp,JSON.stringify(lease,null,2)+'\n',{mode:0o600});renameSync(tmp,path);
}
export class Configuration {
  constructor(options,ip=runIp){this.options=options;this.ip=ip;}
  metric(lease){return lease.metric===undefined?[]:['metric',String(lease.metric)];}
  async apply(lease,previous) {
    const o=this.options;
    lease.metric=o.metric;
    if(previous&&previous.routers[0]!==lease.routers[0])await this.removeRoute(previous);
    await this.ip(['addr','replace',`${lease.address}/${lease.prefix}`,'brd','+','dev',o.interface]);
    if(lease.routers[0])await this.ip(['route','replace','default','via',lease.routers[0],'dev',o.interface,...this.metric(lease)]);
    if(previous?.resolver)lease.resolver=previous.resolver;
    if(o.dns&&lease.dns.length){
      const content=`# dhclient ${o.interface}\n`+lease.dns.map(ip=>`nameserver ${ip}\n`).join('');
      const old=lease.resolver;
      // Keep the original resolver across repeated invocations, unless another writer took over.
      const current=readOptional(o.resolv);
      lease.resolver={path:o.resolv,before:old?.path===o.resolv&&current===old.written?old.before:current,written:content};
      writeFileSync(o.resolv,content);
    }
  }
  async removeRoute(lease) {
    if(!lease.routers[0])return;
    try{await this.ip(['route','del','default','via',lease.routers[0],'dev',this.options.interface,...this.metric(lease)]);}
    catch(e){if(!/No such process|No such device|Cannot find device/.test(e.message))throw e;}
  }
  async clear(lease) {
    const errors=[];
    try{await this.removeRoute(lease);}catch(e){errors.push(e);}
    // ip addr del checks the current address before deleting it.
    try{await this.ip(['addr','del',`${lease.address}/${lease.prefix}`,'dev',this.options.interface]);}
    catch(e){if(!/Cannot assign requested address|Cannot find device/.test(e.message))errors.push(e);}
    try{
      const r=lease.resolver;
      if(r&&readOptional(r.path)===r.written){if(r.before===null)unlinkSync(r.path);else writeFileSync(r.path,r.before);}
    }catch(e){errors.push(e);}
    if(errors.length)throw new AggregateError(errors,errors.map(e=>e.message).join('; '));
  }
}
// A command invocation acquires once and exits. There is no renewal daemon.
export async function manageLease(client,config,{previous,signal,log=console.log,save=()=>{},forget=()=>{}}={}) {
  let lease,kept=false;
  try {
    lease=await client.acquire();
    if(!lease){if(signal?.aborted)return 0;throw new Error('no DHCP lease received before timeout');}
    if(signal?.aborted)return 0;
    await config.apply(lease,previous);await save(lease);
    log(`bound to ${lease.address}/${lease.prefix}, lease ${lease.seconds}s; configured and exiting (no automatic renewal)`);
    kept=true;return 0;
  }finally{
    if(lease&&!kept){
      try{client.release(lease);}catch(e){log(`release: ${e.message}`);}
      await config.clear(lease);await forget();
    }
  }
}
export async function runDhclient(o) {
  if(!['linux','android'].includes(process.platform))throw new Error('dhclient requires Linux/Android networking');
  // Serialize this interface even when callers choose different lease files.
  const lock=`/run/dhclient-${o.interface}.lock`;mkdirSync(dirname(lock),{recursive:true});
  let handle;
  try{handle=openSync(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw new Error(`${lock} exists; stop the other client, or remove this lock if its process died`);throw e;}
  writeFileSync(handle,`${process.pid}\n`);
  let transport;
  const controller=new AbortController(),stop=()=>controller.abort();
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  const log=message=>{if(!o.quiet)console.log(`dhclient: ${message}`);};
  const forget=()=>{try{unlinkSync(o.leaseFile);}catch(e){if(e.code!=='ENOENT')throw e;}};
  try{
    const info=interfaceInfo(o.interface);
    await runIp(['link','set','dev',o.interface,'up']);
    try { transport=openTransport(o.interface,info); }
    catch(error) {
      if(error.errno!==97)throw error; // EAFNOSUPPORT: Alpine ships AF_PACKET as a module.
      const {modprobe}=await import('./modprobe.js');
      modprobe('af_packet');transport=openTransport(o.interface,info);
    }
    const client=new DhcpClient({transport,...info,...o,signal:controller.signal,log:o.verbose?log:()=>{}});
    const config=new Configuration(o);
    if(o.release){
      const text=readOptional(o.leaseFile);if(!text)throw new Error(`no saved lease: ${o.leaseFile}`);
      const lease=JSON.parse(text);if(lease.interface!==o.interface||lease.mac!==info.mac.toString('hex'))throw new Error('saved lease belongs to another interface');
      try{client.release(lease);}finally{await config.clear(lease);forget();}log(`released ${lease.address}`);return 0;
    }
    let previous;
    const saved=readOptional(o.leaseFile);
    if(saved){
      const candidate=JSON.parse(saved);
      if(candidate.interface===o.interface&&candidate.mac===info.mac.toString('hex'))previous=candidate;
    }
    return await manageLease(client,config,{...o,previous,signal:controller.signal,log,save:lease=>saveLease(o.leaseFile,{...lease,interface:o.interface,mac:info.mac.toString('hex')}),forget});
  }finally{
    transport?.close();process.off('SIGINT',stop);process.off('SIGTERM',stop);closeSync(handle);unlinkSync(lock);
  }
}
