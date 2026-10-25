import {test,expect} from 'bun:test';
import {SyntaxDefinition,parseHeaderYaml} from '../src/highlight/parser.js';
import {Highlighter} from '../src/highlight/highlighter.js';
async function highlighter(name){
 const source=Bun.YAML.parse(await Bun.file(new URL('../runtime/syntax/'+name+'.yaml',import.meta.url)).text());
 return new Highlighter(new SyntaxDefinition(parseHeaderYaml(source),source));
}
function groupAt(result,index){let group='default';for(const [pos,value]of result.changes){if(pos>index)break;group=value;}return group;}
for(const [syntax,first]of [['html','<div class="hello">Hello</div>'],['xml','<Project Sdk="Microsoft.NET.Sdk">']]){
 test(syntax+' nested attribute returns to outer tag and does not leak to next line',async()=>{
  const h=await highlighter(syntax),r=h.highlightLine(first);
  expect(r.state).toBeNull();
  expect(groupAt(r,first.indexOf('>'))).toBe('symbol.tag');
  const next=h.highlightLine('<p>Next line</p>',r.state);
  expect(groupAt(next,3)).toBe('default');
  expect(next.state).toBeNull();
  expect([...r.changes.keys()].every(p=>p<=first.length)).toBe(true);
 });
 test(syntax+' retains an unfinished attribute across lines then exits it',async()=>{
  const h=await highlighter(syntax);
  const a=h.highlightLine('<div title="first');expect(a.state?.group).toBe('constant.string');
  const b=h.highlightLine('second">Text</div>',a.state);
  expect(groupAt(b,0)).toBe('constant.string');
  expect(groupAt(b,8)).toBe('default');expect(b.state).toBeNull();
 });
}
test('HTML multiple attributes, adjacent tags and nested escaped quotes',async()=>{
 const h=await highlighter('html');
 const line='<a href="/path" title="say \\"hi\\"">Link</a><b>next</b>';
 const r=h.highlightLine(line);
 expect(r.state).toBeNull();expect(groupAt(r,line.indexOf('Link'))).toBe('default');
 expect(groupAt(r,line.indexOf('next'))).toBe('default');
});
test('zero-width child/parent loop steps forward and keeps highlighting the line',()=>{
 const h=new Highlighter({rules:[{type:'region',group:'outer',start:/</u,end:/>/u,rules:[{type:'region',group:'inner',start:/(?=x)/u,end:/(?=x)/u,rules:[]}]},{type:'pattern',group:'keyword',regex:/END/u}]});
 let calls=0;const line='<x>END';const r=h.highlightLine(line,null,()=>{if(++calls>100)throw Error('loop');});
 expect(r.state).toBeNull();expect(calls).toBeLessThan(100);
 expect(groupAt(r,1)).toBe('outer');expect(groupAt(r,line.indexOf('END'))).toBe('keyword');
});
test('empty pattern matches advance past full Unicode characters, with or without progress',()=>{
 const h=new Highlighter({rules:[{type:'pattern',group:'empty',regex:/(?=.)/u},{type:'pattern',group:'number',regex:/42/u}]});
 for(const progress of [null,()=>{}]){
  const r=h.highlightLine('😀\0\ud80042',null,progress);
  expect(groupAt(r,4)).toBe('number');expect(r.state).toBeNull();
 }
});
test('NUL and isolated surrogate units inside HTML do not leak state',async()=>{
 const h=await highlighter('html');
 const r=h.highlightLine('<a title="\0😀\ud800">hello\0\udc00</a>');
 expect(r.state).toBeNull();
 expect(h.highlightLine('\0'.repeat(10000)).state).toBeNull();
});
test('long lines finish at their final token without recursion or truncation',()=>{
 const h=new Highlighter({rules:[{type:'region',group:'string',start:/"/u,end:/"/u,rules:[]},{type:'pattern',group:'keyword',regex:/END/u}]});
 const line='"x";'.repeat(50000)+'END';
 const r=h.highlightLine(line);
 expect(r.state).toBeNull();expect(groupAt(r,line.length-1)).toBe('keyword');
 expect([...r.changes.keys()].at(-1)).toBe(line.length);
},30000);
test('cyclic incoming state and cyclic syntax trees cannot recurse forever',()=>{
 const region={type:'region',group:'cycle',start:/</u,end:/>/u,rules:[]};region.rules.push(region);
 const h=new Highlighter({rules:[region]});
 expect(h.highlightLine('plain').state).toBeNull();
 const state={group:'cycle',rules:[]};state.parent=state;
 expect(h.highlightLine('plain',state).state).toBeNull();
});
test('externally supplied zero-width recursive state has a no-progress bound',()=>{
 const child={type:'region',group:'inner',start:/(?=x)/u,end:/$/u,rules:[]};child.rules.push(child);
 const state={group:'outer',end:/$/u,rules:[child]};
 const h=new Highlighter({rules:[]});let calls=0;
 const r=h.highlightLine('x',state,()=>{if(++calls>5000)throw Error('loop');});
 expect(r.state).toBeNull();expect(calls).toBeLessThan(5000);
});
