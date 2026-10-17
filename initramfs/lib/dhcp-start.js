// Best-effort background DHCP for cfg.net. This module never waits for a lease
// and consumes every child/stream rejection before it can reach PID 1.
export function createDhcpLauncher({spawn=(argv,options)=>Bun.spawn(argv,options),log=console.log,
  acquisitionSeconds=20,watchdogMs=25000,killGraceMs=2000}={}) {
  const active=new Map();
  const messageOf=error=>String(error?.message??error);
  const report=message=>{try{log(`eth: ${message}`);}catch{}};
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
          state={child,done:false,timer:null,killTimer:null};active.set(name,state);
          const kill=signal=>{try{child.kill(signal);}catch(e){report(`${name} dhclient ${signal}: ${messageOf(e)}`);}};
          state.timer=setTimeout(()=>{
            if(state.done)return;
            report(`${name} DHCP call exceeded watchdog; terminating client`);
            kill('SIGTERM');
            state.killTimer=setTimeout(()=>{if(!state.done)kill('SIGKILL');},killGraceMs);
            state.killTimer.unref?.();
          },watchdogMs);state.timer.unref?.();
          const line=text=>{
            if(text)report(`${name} ${text}`);
          };
          const drain=async stream=>{
            if(!stream)return;
            const decoder=new TextDecoder();let pending='';
            for await(const chunk of stream){
              pending+=decoder.decode(chunk,{stream:true});
              let at;while((at=pending.indexOf('\n'))>=0){line(pending.slice(0,at));pending=pending.slice(at+1);}
              // Do not let malformed/no-newline child output grow without bound.
              if(pending.length>4096){line(pending.slice(0,4096));pending='';}
            }
            if(pending)line(pending);
          };
          for(const stream of [child.stdout,child.stderr])void drain(stream).catch(e=>report(`${name} DHCP output: ${messageOf(e)}`));
          const finish=message=>{
            state.done=true;clearTimeout(state.timer);clearTimeout(state.killTimer);
            if(active.get(name)===state)active.delete(name);
            report(`${name} ${message}; init continues`);
          };
          void Promise.resolve(child.exited).then(code=>finish(`dhclient exited ${code}`),error=>finish(`dhclient failed: ${messageOf(error)}`)).catch(()=>{});
          started.push(name);report(`${name} DHCP started in background`);
        }catch(error){
          if(state){clearTimeout(state.timer);clearTimeout(state.killTimer);active.delete(name);}
          if(child){try{child.kill('SIGKILL');}catch{}}
          report(`${name} DHCP start failed: ${messageOf(error)}; init continues`);
        }
      }
    }catch(error){report(`DHCP setup failed: ${messageOf(error)}; init continues`);}
    return started;
  };
}
export const startDhcp=createDhcpLauncher();
