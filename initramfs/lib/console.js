// The kernel opens /dev/console for init without making it a controlling
// terminal. Establish the missing session/foreground group before the REPL
// or local shell starts, so the tty driver can deliver Ctrl-C as SIGINT.
import {libc,ptr,check} from './dlopen.js';

// A child runtime remembers its inherited termios as the mode to restore
// when it leaves raw mode. Do not spawn a shell while the REPL owns raw
// input, or the shell's setRawMode(false) will restore that raw baseline.
export function handoffConsole({input=process.stdin,repl}={}) {
  const wasRaw=!!input.isRaw;
  let restored=false;
  const restore=()=>{
    if(restored)return;restored=true;
    try{if(wasRaw)input.setRawMode(true);}finally{repl?.resume();}
  };
  repl?.pause();
  try{if(wasRaw)input.setRawMode(false);}
  catch(error){restore();throw error;}
  return restore;
}

export function configureConsole({fd=0,pid=process.pid,symbols=libc.symbols}={}) {
  // This is boot setup, not something an arbitrary command should use to
  // take ownership of the caller's terminal.
  if(pid!==1)return {configured:false,reason:'not PID 1'};
  const termios=Buffer.alloc(36),group=Buffer.alloc(4);
  if(symbols.ioctl(fd,0x5401,ptr(termios))<0)return {configured:false,reason:'not a tty'};
  if(symbols.ioctl(fd,0x540f,ptr(group))===0&&group.readInt32LE()>0)
    return {configured:false,reason:'already configured',pgrp:group.readInt32LE()};
  if(check('getsid',symbols.getsid(0))!==pid)check('setsid',symbols.setsid());
  // arg=0: never steal a console belonging to another session.
  check('TIOCSCTTY',symbols.ioctl(fd,0x540e,null));
  const pgrp=check('getpgrp',symbols.getpgrp());group.writeInt32LE(pgrp);
  check('TIOCSPGRP',symbols.ioctl(fd,0x5410,ptr(group)));
  return {configured:true,pgrp};
}
