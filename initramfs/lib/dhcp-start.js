// Best-effort one-shot DHCP for cfg.net. Each interface owns its result and
// bounded output buffer; a failed link never changes another link's status.
export function createDhcpLauncher({spawn=(argv,options)=>Bun.spawn(argv,options),log=console.log,
  acquisitionSeconds=20,watchdogMs=25000,killGraceMs=2000,outputGraceMs=250}={}) {
  const active=new Map();
  const messageOf=error=>String(error?.message??error);
  const clean=text=>String(text).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\x00-\x1f\x7f]/g,' ').trim();
  const report=(name,message)=>{try{log(`[dhcp ${clean(name)}] ${clean(message)}`);}catch{}};
  return function startDhcp(interfaces) {
    const started=[];
    try {
      for(const [index,name] of interfaces.entries()) {
        if(name==='lo'||active.has(name))continue;
        let child,state;
        try {
          if(!/^[a-zA-Z0-9_.:-]{1,15}$/.test(name))throw new Error('invalid interface name');
          const args=[process.execPath,`${import.meta.dir}/../bin/dhclient`,'-1','-timeout',String(acquisitionSeconds),'--metric',String(100+index)];
          // Keep a single resolver owner; init already supplies fallback DNS.
          if(index>0)args.push('--no-dns');
          args.push(name);
          child=spawn(args,{stdin:'ignore',stdout:'pipe',stderr:'pipe'});
          state={child,done:false,timer:null,killTimer:null,timedOut:false,address:null,errors:[],notes:[],readers:[]};active.set(name,state);
          const remember=(list,text)=>{list.push(clean(text).slice(0,512));if(list.length>4)list.shift();};
          const kill=signal=>{try{child.kill(signal);}catch(e){remember(state.errors,`${signal}: ${messageOf(e)}`);}};
          state.timer=setTimeout(()=>{
            if(state.done)return;
            state.timedOut=true;kill('SIGTERM');
            state.killTimer=setTimeout(()=>{if(!state.done)kill('SIGKILL');},killGraceMs);
            state.killTimer.unref?.();
          },watchdogMs);state.timer.unref?.();
          const line=(text,isError)=>{
            text=clean(text);if(!text)return;
            const bound=!isError&&/^dhclient: bound to ([^,\s]+)/.exec(text);
            if(bound)state.address=bound[1];
            else remember(isError?state.errors:state.notes,text.replace(/^dhclient:\s*/,''));
          };
          const drain=async(stream,isError)=>{
            if(!stream)return;
            const reader=stream.getReader();state.readers.push(reader);
            const decoder=new TextDecoder();let pending='';
            try {
              for(;;){
                const {done,value}=await reader.read();if(done)break;
                pending+=decoder.decode(value,{stream:true});
                let at;while((at=pending.indexOf('\n'))>=0){line(pending.slice(0,at),isError);pending=pending.slice(at+1);}
                if(pending.length>4096){line(pending.slice(0,4096),isError);pending='';}
              }
              if(pending)line(pending,isError);
            }finally{reader.releaseLock();}
          };
          const drains=[drain(child.stdout,false),drain(child.stderr,true)].map(p=>p.catch(e=>remember(state.errors,`output: ${messageOf(e)}`)));
          const finish=async(code,error)=>{
            state.done=true;clearTimeout(state.timer);clearTimeout(state.killTimer);
            // exited can resolve before the last stderr/stdout chunk arrives.
            // Bound the wait even if an inherited pipe never closes.
            let outputTimer;
            try {
              await Promise.race([Promise.all(drains),new Promise(resolve=>{outputTimer=setTimeout(resolve,outputGraceMs);})]);
            }finally{
              clearTimeout(outputTimer);
              for(const reader of state.readers){try{void reader.cancel().catch(()=>{});}catch{}}
              if(active.get(name)===state)active.delete(name);
            }
            if(state.timedOut)report(name,`failed: timed out; other interfaces are unaffected`);
            else if(error!==undefined)report(name,`failed: ${messageOf(error)}`);
            else if(code===0&&state.address)report(name,`configured ${state.address}; command finished`);
            else if(code===0)report(name,'finished without configuring an address');
            else {
              const detail=state.errors.at(-1)??state.notes.at(-1)??'no error details';
              report(name,`failed: ${detail} (exit ${code}); other interfaces are unaffected`);
            }
          };
          void Promise.resolve(child.exited).then(code=>finish(code),error=>finish(null,error??'unknown exit error')).catch(e=>report(name,`result unavailable: ${messageOf(e)}`));
          started.push(name);report(name,'requesting configuration');
        }catch(error){
          if(state){clearTimeout(state.timer);clearTimeout(state.killTimer);active.delete(name);}
          if(child){try{child.kill('SIGKILL');}catch{}}
          report(name,`failed to start: ${messageOf(error)}; other interfaces are unaffected`);
        }
      }
    }catch(error){report('setup',`failed: ${messageOf(error)}; init continues`);}
    return started;
  };
}
export const startDhcp=createDhcpLauncher();
