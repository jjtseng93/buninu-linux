"use strict";
const createPowerShellClipboard = require('./clipboard-powershell.js');
// Self-contained so the worker remains valid after bundling/minification.
function clipboardRuntime(createPowerShellClipboard) {
  const {spawnSync} = require('node:child_process');
  const fs = require('node:fs');
  const path = require('node:path');
  const MAX_OSC52 = 1024 * 1024;
  function which(name) {
    if (typeof Bun !== 'undefined') return Bun.which(name);
    const names=process.platform==='win32' && !path.extname(name)
      ? [name,...(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map(ext=>name+ext)] : [name];
    for (const dir of (process.env.PATH || '').split(path.delimiter)) {
      for(const candidate of names) {
        const file=path.join(dir,candidate);
        try {fs.accessSync(file,fs.constants.X_OK);if(fs.statSync(file).isFile())return file;} catch {}
      }
    }
    return null;
  }
  function runSync(command, options={}) {
    try {
      const r=spawnSync(command[0],command.slice(1),{
        input:options.stdin, encoding:'utf8', timeout:options.timeout ?? 2000,
        maxBuffer:MAX_OSC52, stdio:['pipe',options.stdout ?? 'pipe','pipe'],windowsHide:true,
      });
      return {ok:!r.error && r.status===0,stdout:r.stdout || '',stderr:r.stderr || String(r.error || '')};
    } catch(error) {return {ok:false,stdout:'',stderr:String(error)};}
  }
  function outputOrThrow(result) {
    if (!result.ok) throw new Error(result.stderr || result.stdout || 'clipboard command failed');
    return result.stdout;
  }
  function createClipboard({find=which,run=runSync,platform=process.platform}={}) {
    const internal=new Map();
    function candidates(register,write,text) {
      const result=[];
      const command=(name,args)=>{const executable=find(name);if(executable)result.push(()=>run([executable,...args],write?{stdin:text,stdout:'ignore'}:{}));};
      // Always first, including Windows and Android. Failure does not pin a backend.
      command('xclip',['-selection',register,...(write?[]:['-o'])]);
      if(register==='clipboard') {
        command(write?'termux-clipboard-set':'termux-clipboard-get',[]);
      }
      if(register!=='secondary')command(write?'wl-copy':'wl-paste',[...(write?[]:['--no-newline']),...(register==='primary'?['--primary']:[])]);
      command('xsel',[`--${register}`,write?'--input':'--output']);
      if(register==='clipboard') {
        if(platform==='darwin')command(write?'pbcopy':'pbpaste',[]);
        if(platform==='win32')for(const name of ['pwsh.exe','powershell.exe','pwsh','powershell']){
          const shell=find(name);if(!shell)continue;
          const backend=createPowerShellClipboard(shell,run,outputOrThrow);
          result.push(()=>write?{ok:backend.write(text)}:{ok:true,stdout:backend.read()});
        }
      }
      return result;
    }
    return {
      read(register='clipboard') {
        if(/^cut[0-7]$/.test(register))return internal.get(register);
        for(const attempt of candidates(register,false))try {
          const r=attempt();if(r.ok){internal.set(register,r.stdout);return r.stdout;}
        }catch{}
        return internal.get(register);
      },
      write(text,register='clipboard') {
        internal.set(register,text);
        if(/^cut[0-7]$/.test(register))return;
        for(const attempt of candidates(register,true,text))try {if(attempt().ok)return;}catch{}
      },
    };
  }
  function parseOSC52(data) {
    if(typeof data!=='string'||data.length>MAX_OSC52)return null;
    const i=data.indexOf(';');if(i<0)return null;
    const selection=data.slice(0,i),payload=data.slice(i+1);
    if(!/^[cpqs0-7]*$/.test(selection)||selection.length>16)return null;
    const registers=[...new Set([...(selection || 's0')].map(c=>({c:'clipboard',p:'primary',q:'secondary',s:'clipboard'}[c]||`cut${c}`)))];
    if(payload==='?')return {selection,registers,read:true};
    // OSC 52 specifies clearing the selection for non-base64 data.
    const valid=/^[A-Za-z0-9+/]*={0,2}$/.test(payload) && payload.replace(/=+$/,'').length % 4 !== 1;
    return {selection,registers,read:false,text:valid?Buffer.from(payload,'base64').toString('utf8'):''};
  }
  function executeOSC52(clipboard,request) {
    if(request.read) {
      let text;
      for(const register of request.registers){text=clipboard.read(register);if(text!==undefined)break;}
      const data=Buffer.from(text ?? '', 'utf8');
      if(data.length>MAX_OSC52)return null;
      return `\x1b]52;${request.selection};${data.toString('base64')}\x1b\\`;
    }
    for(const register of request.registers)clipboard.write(request.text,register);
    return null;
  }
  return {createClipboard,parseOSC52,executeOSC52,MAX_OSC52};
}
const {createClipboard,parseOSC52,executeOSC52,MAX_OSC52}=clipboardRuntime(createPowerShellClipboard);
module.exports={createClipboard,parseOSC52,executeOSC52,MAX_OSC52};

// Run the synchronous jsmdcui-compatible backends off the server event loop.
// Inline the helpers so compiled single-file builds need no external worker file.
class ClipboardHost {
  constructor(){this.pending=new Map();this.nextId=0;this.worker=null;}
  execute(request){
    if(this.pending.size>=32)return Promise.reject(Error('clipboard queue full'));
    if(!this.worker){
      const {Worker}=require('node:worker_threads');
      const source=`const {parentPort}=require('node:worker_threads');
const runtime=(${clipboardRuntime.toString()})(${createPowerShellClipboard.toString()});
const clipboard=runtime.createClipboard();parentPort.on('message',({id,request})=>{
 try{parentPort.postMessage({id,result:runtime.executeOSC52(clipboard,request)});}
 catch(error){parentPort.postMessage({id,error:String(error)});}
});`;
      const worker=this.worker=new Worker(source,{eval:true});
      const failed=error=>{
        if(this.worker!==worker)return;
        this.worker=null;
        for(const job of this.pending.values())job.reject(error);
        this.pending.clear();worker.terminate();
      };
      worker.on('error',failed);
      worker.on('exit',()=>failed(Error('clipboard worker exited')));
      worker.on('message',({id,result,error})=>{
        const job=this.pending.get(id);if(!job)return;
        this.pending.delete(id);error?job.reject(Error(error)):job.resolve(result);
        if(!this.pending.size)worker.unref();
      });
      worker.unref();
    }
    return new Promise((resolve,reject)=>{
      const id=++this.nextId;this.pending.set(id,{resolve,reject});this.worker.ref();
      this.worker.postMessage({id,request});
    });
  }
  async close(){
    const worker=this.worker;this.worker=null;
    for(const job of this.pending.values())job.reject(Error('clipboard closed'));
    this.pending.clear();if(worker)await worker.terminate();
  }
}
// Authorization is checked both before host access and before returning data.
function handleOSC52(session,ws,payload,host){
  if(!session.isWriter(ws))return;
  const request=parseOSC52(payload);if(!request)return;
  host.execute(request).then(reply=>{
    if(reply && !session.closed && session.isWriter(ws))session.backend.write(Buffer.from(reply));
  }).catch(()=>{});
}
module.exports.ClipboardHost=ClipboardHost;
module.exports.handleOSC52=handleOSC52;
