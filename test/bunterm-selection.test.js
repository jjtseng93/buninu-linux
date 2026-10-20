import {test,expect} from "bun:test";
import {Terminal} from "../initramfs/lib/xterm/xterm-headless.mjs";
import {createSelection} from "../initramfs/lib/bunterm/selection.js";
import {pasteText} from "../initramfs/lib/bunterm/clipboard.js";
const write = (term,text) => new Promise(resolve=>term.write(text,resolve));
const point = (x,y,pressed=[],released=[]) => ({x,y,pressed,released,moved:true});
test("selection joins wraps, includes wide graphemes and works backwards", async () => {
  const term=new Terminal({cols:8,rows:4,allowProposedApi:true});
  try {
    await write(term,"ab中文efghij\r\nlast");
    const s=createSelection(term,{offsetX:0,offsetY:0,cellWidth:1,cellHeight:1},()=>{});
    s.pointer(point(3,0,["left"]));
    s.pointer(point(1,1,[],["left"]));
    expect(s.text()).toBe("中文efgh");
    s.pointer(point(1,1,["left"]));
    s.pointer(point(3,0,[],["left"]));
    expect(s.text()).toBe("中文efgh");
    s.pointer(point(0,1,["left"]));
    s.pointer(point(3,2,[],["left"]));
    expect(s.text()).toBe("ghij\nlast");
    await write(term,"\x1b[?1000h");
    expect(s.pointer(point(0,0,["left"]))).toBe(false);
    expect(s.active).toBe(false);
  } finally {term.dispose();}
});
test("paste uses one negotiated bracketed write, strips embedded ESC, normalizes LF", async () => {
  const term=new Terminal({allowProposedApi:true}),out=[];
  try {
    pasteText(term,"a\nb\r\nc",s=>out.push(s));
    expect(out.pop()).toBe("a\rb\rc");
    await write(term,"\x1b[?2004h");
    pasteText(term,"a\n\x1b[201~b",s=>out.push(s));
    expect(out.pop()).toBe("\x1b[200~a\r[201~b\x1b[201~");
    await write(term,"\x1b[?2004l");
    pasteText(term,"text",s=>out.push(s));
    expect(out).toEqual(["text"]);
  } finally {term.dispose();}
});
