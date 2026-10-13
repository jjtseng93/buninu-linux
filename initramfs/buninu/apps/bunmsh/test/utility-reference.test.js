import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,chmodSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createState,execute,decode} from '../src/shell.js';

// Only data crosses into the guest. No host executables are mounted or spawned.
const path=process.env.BUNMSH_UTILITY_REFERENCE;
const fixtures=path ? JSON.parse(readFileSync(path,'utf8')).cases : [];
if (!path) test.skip('system diff/sed reference (set BUNMSH_UTILITY_REFERENCE)',()=>{});
for (const c of fixtures) test(`system ${c.tool} reference: ${c.name}`,async()=>{
  const cwd=mkdtempSync(join(tmpdir(),'bunmsh-utility-reference-'));
  try {
    for (const [name,content] of Object.entries(c.files)) {
      mkdirSync(dirname(join(cwd,name)),{recursive:true});writeFileSync(join(cwd,name),content);
    }
    for (const [name,mode] of Object.entries(c.modes??{})) chmodSync(join(cwd,name),mode);
    const state=createState({cwd,env:{LC_ALL:'C'},shellOptions:{posix:true}});
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    const r=await execute(['builtin',c.tool,...c.args].map(quote).join(' '),state,{capture:true,input:new Response(c.input??'').body});
    expect({status:r.status,stdout:decode(r.stdout),stderr:decode(r.stderr),...(c.modes?{modes:Object.fromEntries(Object.keys(c.modes).map(name=>[name,statSync(join(cwd,name)).mode&0o7777]))}:{})}).toEqual(c.expected);
  } finally {rmSync(cwd,{recursive:true,force:true});}
});
