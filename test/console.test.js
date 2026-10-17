import {test,expect} from 'bun:test';
import {toArrayBuffer} from 'bun:ffi';
import {configureConsole} from '../initramfs/lib/console.js';
const memory=p=>Buffer.from(toArrayBuffer(p,0,4));
test('boot console establishes a session and foreground group without stealing',()=>{
 const events=[];
 const symbols={getsid:()=>0,setsid(){events.push('session');return 1;},getpgrp:()=>1,
 ioctl(fd,op,p){
  expect(fd).toBe(0);
  if(op===0x5401)return 0;
  if(op===0x540f)return -1;
  if(op===0x540e){expect(p).toBeNull();events.push('control');return 0;}
  if(op===0x5410){events.push(`foreground ${memory(p).readInt32LE()}`);return 0;}
  throw Error('unexpected ioctl');
 }};
 expect(configureConsole({pid:1,symbols})).toEqual({configured:true,pgrp:1});
 expect(events).toEqual(['session','control','foreground 1']);
});
test('existing controlling PTY and noninteractive input are left unchanged',()=>{
 for(const tty of [true,false]){
  let writes=0;
  const symbols={ioctl(fd,op,p){if(op===0x5401)return tty?0:-1;if(op===0x540f){memory(p).writeInt32LE(123);return 0;}writes++;throw Error('terminal modified');}};
  expect(configureConsole({pid:1,symbols}).configured).toBe(false);expect(writes).toBe(0);
 }
 expect(configureConsole({pid:2,symbols:{}}).reason).toBe('not PID 1');
});
test('session leader skips setsid and a rejected ownership request is not forced',()=>{
 let attempts=0;
 const symbols={getsid:()=>1,setsid(){throw Error('setsid must not run');},ioctl(fd,op,p){
  if(op===0x5401)return 0;
  if(op===0x540f)return -1;
  if(op===0x540e){attempts++;expect(p).toBeNull();return -1;}
  throw Error('must not change foreground after failure');
 }};
 expect(()=>configureConsole({pid:1,symbols})).toThrow('TIOCSCTTY');expect(attempts).toBe(1);
});

test('REPL hands a cooked baseline to children and restores raw mode on return',async()=>{
 const {handoffConsole}=await import('../initramfs/lib/console.js');
 const events=[],input={isRaw:true,setRawMode(raw){this.isRaw=raw;events.push(raw?'raw':'cooked');}};
 const restore=handoffConsole({input,repl:{pause(){events.push('pause');},resume(){events.push('resume');}}});
 expect(input.isRaw).toBe(false);expect(events).toEqual(['pause','cooked']);
 restore();restore();expect(input.isRaw).toBe(true);expect(events).toEqual(['pause','cooked','raw','resume']);
});
test('non-raw input is preserved and failed handoff resumes the REPL',async()=>{
 const {handoffConsole}=await import('../initramfs/lib/console.js');
 let resumed=0;
 const repl={pause(){},resume(){resumed++;}};
 handoffConsole({input:{isRaw:false},repl})();expect(resumed).toBe(1);
 const input={isRaw:true,setRawMode(raw){if(!raw)throw Error('termios failed');}};
 expect(()=>handoffConsole({input,repl})).toThrow('termios failed');expect(resumed).toBe(2);
});
