// bun tests/manual-touch-diagnostics.mjs [shell]
// Isolated custom index: production assets are unchanged. Ctrl-C stops both servers.
import {join,resolve} from 'node:path';
import {mkdtempSync,appendFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
const root=resolve(import.meta.dir,'..'),dir=mkdtempSync(join(tmpdir(),'jsgotty-touch-'));
const log=join(dir,'events.jsonl'),token=crypto.randomUUID();
const collector=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
 if(new URL(req.url).pathname!=='/'+token)return new Response('',{status:404});
 if(req.method==='POST'){
  const data=await req.text();if(data.length<256000){try{for(const row of JSON.parse(data))appendFileSync(log,JSON.stringify(row)+'\n')}catch{}}
 }
 return new Response('ok',{headers:{'Access-Control-Allow-Origin':'*'}});
}});
const script=await Bun.file(join(import.meta.dir,'manual-touch-diagnostics.js')).text();
const injection=`<script>globalThis.__touchDiagnosticEndpoint=${JSON.stringify('http://127.0.0.1:'+collector.port+'/'+token)};${script}</script>`;
const html=(await Bun.file(join(root,'static/index.html')).text()).replace('</body>',injection+'\n</body>');
const index=join(dir,'index.html');await Bun.write(index,html);
console.log('Touch diagnostic log:',log);
const child=Bun.spawn([process.execPath,join(root,'gotty.js'),'-w','-r','--session','-p','0','--index',index,process.argv[2]||process.env.SHELL||'/system/bin/sh'],{stdio:['inherit','inherit','inherit']});
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>child.kill(sig));
try{process.exitCode=await child.exited;}finally{collector.stop(true)}
