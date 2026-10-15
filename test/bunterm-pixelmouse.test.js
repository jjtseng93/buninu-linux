import {test,expect} from 'bun:test';
import {Terminal} from '../initramfs/lib/xterm/xterm-headless.mjs';
import {terminalMouseEvent} from '../initramfs/lib/bunterm/pointer-report.js';
test('bunterm negotiates 1016 and emits real pixel press, release and same-cell motion',async()=>{
 const term=new Terminal({cols:80,rows:24,allowProposedApi:true}),out=[];term.onData(s=>out.push(s));
 const write=s=>new Promise(r=>term.write(s,r));
 const renderer={offsetX:5,offsetY:7,cellWidth:10,cellHeight:20};
 const send=(x,y,action)=>term._core.coreMouseService.triggerMouseEvent(terminalMouseEvent({x,y},renderer,0,action));
 try{
 await write('\x1b[?1016$p');expect(out.pop()).toBe('\x1b[?1016;2$y');
 await write('\x1b[?1003h\x1b[?1006h\x1b[?1016h\x1b[?1016$p');expect(out.pop()).toBe('\x1b[?1016;1$y');
 send(30,68,1);expect(out.pop()).toBe('\x1b[<0;25;61M');
 send(30,68,0);expect(out.pop()).toBe('\x1b[<0;25;61m');
 send(31,68,32);expect(out.pop()).toBe('\x1b[<32;26;61M');
 send(32,68,32);expect(out.pop()).toBe('\x1b[<32;27;61M');
 await write('\x1b[?1016l\x1b[?1006h');send(30,68,1);expect(out.pop()).toBe('\x1b[<0;3;4M');
 }finally{term.dispose();}
});

test('geometry queries use terminal content pixels and exclude framebuffer margins',async()=>{
 const {attachGeometry}=await import('../initramfs/lib/bunterm/geometry.js');
 const term=new Terminal({cols:80,rows:24,allowProposedApi:true}),out=[];
 const renderer={offsetX:5,offsetY:7,cellWidth:10,cellHeight:20};
 const handler=attachGeometry({term,renderer,reply:s=>out.push(s)});
 try{await new Promise(r=>term.write('\x1b[14t\x1b[16t',r));expect(out).toEqual(['\x1b[4;480;800t','\x1b[6;20;10t']);}
 finally{handler.dispose();term.dispose();}
});
