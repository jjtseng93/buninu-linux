import {resolve,dirname,join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {SyntaxDefinition,parseHeaderYaml} from '../../src/highlight/parser.js';
import {Highlighter} from '../../src/highlight/highlighter.js';
const here=dirname(Bun.fileURLToPath(import.meta.url));
const local=resolve(here,'../../runtime/syntax');
const upstream=resolve(process.argv[2]||'../go-micro');
const oracle=resolve(process.argv[3]||'/tmp/jmi-micro-go/oracle');
const generate=process.argv.includes('--generate');
const upstreamSyntax=process.argv.includes('--upstream-syntax');
const files=[],excluded=[],definitions=[],samples={};
const definitionsByFile=new Map();
for(const name of [...new Bun.Glob('*.yaml').scanSync(local)].sort()){
 const text=await Bun.file(join(upstreamSyntax?join(upstream,'runtime/syntax'):local,name)).text();
 const source=Bun.YAML.parse(text);const def=new SyntaxDefinition(parseHeaderYaml(source),source,text);definitions.push(def);definitionsByFile.set(name,def);
 const orig=Bun.file(join(upstream,'runtime/syntax',name));
 if(!await orig.exists()||await orig.text()!==text){excluded.push(name);continue;}
 files.push(name);
 if(!generate)samples[name]=await Bun.file(join(here,'samples',name.replace(/\.yaml$/,'.txt'))).text();
}
const child=Bun.spawn([oracle,join(upstream,'runtime/syntax')],{stdin:'pipe',stdout:'pipe',stderr:'inherit'});
child.stdin.write(JSON.stringify({files,samples}));
child.stdin.end();
const raw=await new Response(child.stdout).text();
const original=JSON.parse(raw);
if(await child.exited)throw Error('micro oracle failed');
await mkdir(join(here,'samples'),{recursive:true});
const report={syntaxSource:upstreamSyntax?'upstream':'local',upstreamCommit:(await new Response(Bun.spawn(['git','-C',upstream,'rev-parse','HEAD'],{stdout:'pipe'}).stdout).text()).trim(),excluded,results:[]};
const palette=new Map();
for(const line of (await Bun.file(join(local,'../colorschemes/monokai.micro')).text()).split('\n')){
 const m=line.match(/^color-link (\S+) "([^"]+)"/);if(m)palette.set(m[1],m[2]);
}
function color(group){
 let value=palette.get(group);
 while(!value&&group.includes('.')){group=group.slice(0,group.lastIndexOf('.'));value=palette.get(group);}
 if(value==='default'||!value)value=palette.get('default');
 return value.match(/#[0-9a-fA-F]{6}/)?.[0]||'#F8F8F2';
}
const esc=Bun.escapeHTML;
function painted(text,groups){return text.split('\n').map((line,row)=>{
 const chars=[...line];let out='',start=0;
 while(start<chars.length){const g=groups[row]?.[start]||'default';let end=start+1;
  while(end<chars.length&&(groups[row]?.[end]||'default')===g)end++;
  out+=`<span title="${esc(g)}" style="color:${color(g)}">${esc(chars.slice(start,end).join(''))}</span>`;start=end;
 }return out;
}).join('\n');}
let html='<!doctype html><meta charset="utf-8"><title>micro / jmi syntax comparison</title><style>body{background:#181818;color:#eee;font:16px sans-serif}section{margin:2em 0} .pair{display:grid;grid-template-columns:1fr 1fr;gap:1em}pre{background:#282828;padding:1em;overflow:auto;font:14px monospace}summary{cursor:pointer}a{color:#66d9ef}</style><h1>micro / jmi syntax comparison</h1><p>Same Monokai palette. Hover over a character to see its syntax group. Samples are lexical test fragments, not necessarily valid programs.</p>';
for(const name of files){
 const ref=original[name],def=definitionsByFile.get(name);
 if(generate)await Bun.write(join(here,'samples',name.replace(/\.yaml$/,'.txt')),ref.text);
 const actual=new Highlighter(def,definitions).highlightString(ref.text);
 let coloredMicro=0,coloredJmi=0,different=0;const examples=[],actualGroups=[];
 ref.text.split('\n').forEach((line,row)=>{
  let offset=0,active='default';const chars=[...line],groups=[];actualGroups.push(groups);
  for(let col=0;col<chars.length;col++){
   if(actual[row].has(offset))active=actual[row].get(offset);
   groups.push(active);
   const expected=ref.groups[row]?.[col]||'default';
   if(expected!=='default')coloredMicro++;if(active!=='default')coloredJmi++;
   if(expected!==active){different++;if(examples.length<8)examples.push({line:row+1,column:col+1,text:line,micro:expected,jmi:active});}
   offset+=chars[col].length;
  }
 });
 html+=`<details><summary>${esc(name)} — ${different} different characters</summary><div class="pair"><div><h3>micro</h3><pre>${painted(ref.text,ref.groups)}</pre></div><div><h3>jmi</h3><pre>${painted(ref.text,actualGroups)}</pre></div></div></details>`;
 report.results.push({file:name,filetype:ref.filetype,coloredMicro,coloredJmi,different,examples});
}
await Bun.write(join(here,'comparison.html'),html);
await Bun.write(join(here,'report.json'),JSON.stringify(report,null,2)+'\n');
const matched=report.results.filter(r=>!r.different),diff=report.results.filter(r=>r.different),uncolored=report.results.filter(r=>!r.coloredMicro||!r.coloredJmi);
let md=`# micro / jmi syntax parity\n\nUpstream commit: ${report.upstreamCommit}\n\nSyntax source: ${report.syntaxSource}.\n\n${files.length} byte-identical YAML files tested; ${excluded.length} changed/missing files excluded.\n${matched.length} match; ${diff.length} differ; ${uncolored.length} lack non-default groups in one or both engines.\n\nComparison is by syntax group for every character, not theme RGB values.\nThese generated lexical samples exercise rule witnesses, not complete valid programs or exhaustive language coverage.\n\n| Syntax | micro colored chars | jmi colored chars | Different chars |\n|---|---:|---:|---:|\n`;
for(const r of report.results)md+=`| [${r.filetype}](samples/${r.file.replace(/\.yaml$/,'.txt')}) | ${r.coloredMicro} | ${r.coloredJmi} | ${r.different} |\n`;
md+='\n## Excluded YAML files\n\n'+excluded.map(x=>'- '+x).join('\n')+'\n\n## Differences\n\n';
for(const r of diff){md+=`### ${r.file}\n\n`;for(const e of r.examples.slice(0,3))md+=`- Line ${e.line}, column ${e.column}: micro \`${e.micro}\`, jmi \`${e.jmi}\`; ${JSON.stringify(e.text)}\n`;md+='\n';}
await Bun.write(join(here,'REPORT.md'),md);
console.log(JSON.stringify({files:files.length,excluded,matched:matched.length,differ:diff.length,uncolored:uncolored.map(r=>r.file)},null,2));
