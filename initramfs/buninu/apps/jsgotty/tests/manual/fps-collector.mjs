// bun tests/manual/fps-collector.mjs [log.jsonl]
import {appendFileSync} from 'node:fs';
import {resolve} from 'node:path';
const log=resolve(process.argv[2]||'jsgotty-fps.jsonl'),token=crypto.randomUUID();
const source=await Bun.file(new URL('./fps-debug.js',import.meta.url)).text();
let rows=0;
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Private-Network':'true','Cache-Control':'no-store'};
const server=Bun.serve({hostname:'127.0.0.1',port:0,maxRequestBodySize:262144,async fetch(req){
 if(new URL(req.url).pathname!=='/'+token)return new Response('',{status:404});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return new Response('',{status:405,headers});
 if(rows>=1200)return new Response('',{status:429,headers});
 try{const row=await req.json();appendFileSync(log,JSON.stringify({receivedAt:Date.now(),...row})+'\n',{mode:0o600});rows++;return new Response(null,{status:204,headers});}
 catch{return new Response('',{status:400,headers});}
}});
const endpoint=`http://127.0.0.1:${server.port}/${token}`;
const script=log+'.inject.js';await Bun.write(script,source+'\nwindow.startGottyFpsDebug({endpoint:'+JSON.stringify(endpoint)+'});\n');
console.log(JSON.stringify({endpoint,log,script,pid:process.pid}));
