import {test,expect} from 'bun:test';
import {createDhcpLauncher} from '../initramfs/lib/dhcp-start.js';
const pause=ms=>Bun.sleep(ms);
function fakeChild(){
 let resolve,reject,stdout;
 const exited=new Promise((yes,no)=>{resolve=yes;reject=no;});
 return {exited,resolve,reject,kills:[],kill(signal){this.kills.push(signal);},
 stdout:new ReadableStream({start(c){stdout=c;}}),stderr:null,
 output(line){stdout.enqueue(Buffer.from(line));},end(){stdout.close();}};
}
test('launch returns immediately, isolates spawn failures and reuses running children',async()=>{
 const calls=[],logs=[],children=[];
 const launch=createDhcpLauncher({spawn(args){calls.push(args);if(args.at(-1)==='bad')throw new Error('spawn denied');const child=fakeChild();children.push(child);return child;},log:s=>logs.push(s),watchdogMs:500});
 expect(launch(['bad','eth0','eth1'])).toEqual(['eth0','eth1']);
 expect(launch(['eth0','eth1'])).toEqual([]);expect(calls.length).toBe(3);
 expect(calls[2]).toContain('--no-dns');expect(calls[2]).toContain('--metric');
 expect(logs.some(s=>s.includes('spawn denied'))).toBe(true);
 for(const child of children){child.end();child.resolve(1);}await pause(5);
 expect(logs.some(s=>s.includes('exited 1; init continues'))).toBe(true);
 expect(launch(['eth0'])).toEqual(['eth0']);children.at(-1).end();children.at(-1).resolve(0);
});
test('watchdog terminates hung acquisition and escalates if SIGTERM does not exit',async()=>{
 const child=fakeChild(),logs=[];
 const launch=createDhcpLauncher({spawn:()=>child,log:s=>logs.push(s),watchdogMs:10,killGraceMs:10});
 launch(['eth0']);await pause(60);
 expect(child.kills).toEqual(['SIGTERM','SIGKILL']);child.end();child.resolve(137);await pause(5);
 expect(logs.some(s=>s.includes('init continues'))).toBe(true);
});
test('successful one-shot exits and clears the watchdog',async()=>{
 const child=fakeChild();const launch=createDhcpLauncher({spawn:()=>child,log:()=>{},watchdogMs:20,killGraceMs:5});
 launch(['eth0']);child.output('dhclient: bound to 10.0.2.15/24, lease 86400s\n');child.end();child.resolve(0);await pause(50);
 expect(child.kills).toEqual([]);
});
test('stream rejection, exit rejection, kill failure and throwing logger cannot escape',async()=>{
 const child=fakeChild(),logs=[];
 child.stderr=new ReadableStream({start(c){c.error(null);}});
 child.kill=()=>{throw null;};
 const launch=createDhcpLauncher({spawn:()=>child,log:s=>logs.push(s),watchdogMs:5,killGraceMs:5});
 expect(()=>launch(['eth0'])).not.toThrow();await pause(30);child.end();child.reject(null);await pause(5);
 expect(logs.some(s=>s.includes('output: null'))).toBe(true);
 expect(logs.some(s=>s.includes('failed: null'))).toBe(true);
 const bad=createDhcpLauncher({spawn(){throw null;},log(){throw new Error('console failed');}});
 expect(()=>bad(['eth0'])).not.toThrow();expect(()=>bad(null)).not.toThrow();
});
