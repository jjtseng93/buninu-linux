import { test, expect } from "bun:test";
import { createVtMenu } from "../initramfs/lib/bunterm/vt-menu.js";
import { createCommands } from "../initramfs/lib/bunterm/commands.js";
const report = (x, y, pressed = [], released = []) => ({ x, y, pressed, released, buttons: {left: pressed.includes("left")}, wheel: 0, moved: false });
function fixture(extra = {}) {
  const selected = [];
  const menu = createVtMenu({ width: 800, height: 600, rowHeight: 16,
    list: () => [{number:1,label:"initial"}, {number:3,label:"bunterm"}],
    select: n => selected.push(n), changed() {}, ...extra });
  return {menu, selected};
}
test("new bunterm is below the tty list, inherits live font size, and prevents double launch", async () => {
  let size=13, finish; const calls=[];
  const {menu,selected}=fixture({controls:{fontSize:()=>size,execute:()=>""},
    create:n=>{calls.push(n);return new Promise(resolve=>{finish=resolve;});}});
  menu.pointer(report(0,0,["left"]));
  const labels=[];
  menu.draw({cellWidth:8,cellHeight:16,CanvasKit:{XYWHRect:(...r)=>r,ClipOp:{Intersect:0}},
    paintFor:c=>c,drawText:text=>labels.push(text),
    canvas:{save(){},restore(){},clipRect(){},drawRect(){}}});
  expect(labels.indexOf("+ 新增 bunterm / New bunterm")).toBe(labels.indexOf("bunterm",2)+1);
  size=20;
  menu.input(Buffer.from("\x1b[B".repeat(5)+"\r\r"));
  await Bun.sleep(0);
  expect(calls).toEqual([20]);expect(selected).toEqual([]);
  finish();await Bun.sleep(0);expect(menu.visible).toBe(false);
});

test("failed new bunterm launch keeps the menu usable", async () => {
  const {menu}=fixture({controls:{fontSize:()=>13,execute:()=>""},create:()=>{throw Error("No next tty available");}});
  menu.pointer(report(0,0,["left"]));
  menu.input(Buffer.from("\x1b[B".repeat(5)+"\r"));
  await Bun.sleep(0);expect(menu.visible).toBe(true);
  const labels=[];
  menu.draw({cellWidth:8,cellHeight:16,CanvasKit:{XYWHRect:(...r)=>r,ClipOp:{Intersect:0}},
    paintFor:c=>c,drawText:text=>labels.push(text),
    canvas:{save(){},restore(){},clipRect(){},drawRect(){}}});
  expect(labels).toContain("No next tty available");
  menu.input(Buffer.from("\x1b"));expect(menu.visible).toBe(false);
});
test("only the top-left four pixels open the menu; open and selection clicks never leak", () => {
  const {menu,selected} = fixture();
  expect(menu.pointer(report(2,1,["left"]))).toBe(false);
  expect(menu.pointer(report(1,2,["left"]))).toBe(false);
  expect(menu.pointer(report(1,1,["right"]))).toBe(false);
  expect(menu.pointer(report(1,1,["left"]))).toBe(true);
  expect(menu.visible).toBe(true);
  expect(menu.pointer(report(1,1,[],["left"]))).toBe(true);
  expect(menu.pointer(report(20,55,["left"]))).toBe(true);
  expect(selected).toEqual([3]);
  expect(menu.visible).toBe(false);
  expect(menu.pointer(report(20,55,[],["left"]))).toBe(true);
  expect(menu.pointer(report(30,60))).toBe(false);
});
test("menu consumes application input, supports keyboard selection and dismissal", () => {
  const {menu,selected} = fixture();
  menu.pointer(report(0,0,["left"]));
  expect(menu.input(Buffer.from("shell command"))).toBe(true);
  menu.input(Buffer.from("\x1b[B"));
  menu.input(Buffer.from("\r"));
  expect(selected).toEqual([3]);
  menu.pointer(report(0,0,[],["left"]));
  menu.pointer(report(0,0,["left"]));
  menu.input(Buffer.from("\x1b"));
  expect(menu.visible).toBe(false);
  expect(menu.input(Buffer.from("x"))).toBe(false);
});
test("short screens scroll selection; renderer overlays are clipped", () => {
  const {menu,selected} = fixture({height:72});
  menu.pointer(report(0,0,["left"]));
  menu.pointer({...report(10,10), wheel:-1});
  const text=[];
  menu.draw({cellWidth:8, cellHeight:16, CanvasKit:{XYWHRect:(...r)=>r,ClipOp:{Intersect:0}},
    paintFor: c=>c, drawText: t=>text.push(t),
    canvas:{save(){},restore(){},clipRect(){},drawRect(){}}});
  expect(text).toContain("bunterm");
  expect(text).not.toContain("initial");
  menu.input(Buffer.from("\r"));
  expect(selected).toEqual([3]);
});
test("outside click dismisses without selecting or leaking its release", () => {
  const {menu,selected} = fixture();
  menu.pointer(report(0,0,["left"]));
  menu.pointer(report(0,0,[],["left"]));
  expect(menu.pointer(report(700,300,["left"]))).toBe(true);
  expect(menu.visible).toBe(false);
  expect(menu.pointer(report(700,300,[],["left"]))).toBe(true);
  expect(selected).toEqual([]);
});

test("Escape after releasing the opener does not eat the next application click", () => {
  const {menu} = fixture();
  menu.pointer(report(0,0,["left"]));
  menu.pointer(report(0,0,[],["left"]));
  menu.input(Buffer.from("\x1b"));
  expect(menu.pointer(report(100,100,["left"]))).toBe(false);
});

test("font and clipboard buttons dispatch local commands; UTF-8 command editing survives split reads", async () => {
  const calls=[];
  const {menu}=fixture({controls:{fontSize:()=>13,execute:async line=>{calls.push(line);return "OK";}}});
  menu.pointer(report(0,0,["left"]));
  menu.pointer(report(0,0,[],["left"]));
  for (const [x,y] of [[10,30],[400,30],[10,55],[300,55],[10,80]]) {
    menu.pointer(report(x,y,["left"]));
    menu.pointer(report(x,y,[],["left"]));
  }
  const bytes=Buffer.from("font 16中文");
  menu.input(bytes.subarray(0,9)); menu.input(bytes.subarray(9));
  menu.input(Buffer.from("\x7f\x7f\r")); // remove the two full code points
  await new Promise(resolve=>setTimeout(resolve,0));
  expect(calls).toEqual(["font -","font +","copy","paste","font 16"]);
  expect(menu.visible).toBe(true);
  menu.input(Buffer.from("\x1b"));
});

test("command registry validates font/VT arguments and is extensible", async () => {
  let size=13; const calls=[];
  const c=createCommands({fontSize:()=>size,setFontSize:n=>{if(!Number.isInteger(n)||n<6||n>96)throw Error("size");size=n;},
    copy:()=>calls.push("copy"),paste:()=>calls.push("paste"),switchVT:n=>calls.push(n)});
  expect(await c.execute("font +")).toBe("Font: 14");
  await c.execute("font 18"); expect(size).toBe(18);
  await expect(c.execute("font nope")).rejects.toThrow();
  await expect(c.execute("vt 64")).rejects.toThrow();
  await expect(c.execute("copy extra")).rejects.toThrow();
  await expect(c.execute("unknown")).rejects.toThrow("try help");
  await c.execute("copy"); await c.execute("paste"); await c.execute("vt 3");
  expect(calls).toEqual(["copy","paste",3]);
  c.commands.set("example", args=>args.join(" "));
  expect(await c.execute("example hello world")).toBe("hello world");
});

test("menu labels current VT and renders a real left-aligned command field with centered font value", () => {
  const {menu}=fixture({list:()=>[{number:1,label:"tty1 — initial console",current:true}],
    controls:{fontSize:()=>13,execute:()=>""}});
  menu.pointer(report(0,0,["left"]));
  const labels=[];
  menu.draw({cellWidth:8,cellHeight:16,CanvasKit:{XYWHRect:(...r)=>r,ClipOp:{Intersect:0}},
    paintFor:c=>c,drawText:(text,x,y,cells,color,options)=>labels.push({text,align:options.align}),
    canvas:{save(){},restore(){},clipRect(){},drawRect(){}}});
  expect(labels).toContainEqual({text:"tty1 — initial console (current)",align:"left"});
  expect(labels).toContainEqual({text:"Click to type a command…",align:"left"});
  expect(labels).toContainEqual({text:"🔤 字體 Font 13",align:"center"});
  expect(labels).toContainEqual({text:"📋 複製 Copy",align:"left"});
  expect(labels).toContainEqual({text:"📥 貼上 Paste",align:"left"});
  expect(labels.some(x=>x.text===">")).toBe(false);
});

test("font buttons fit equally and preserve the right margin as fonts grow", () => {
  const {menu}=fixture({controls:{fontSize:()=>20,execute:()=>""}});
  menu.pointer(report(0,0,["left"]));
  for(const cellWidth of [8,12,19,58]) {
    const labels=[];
    menu.draw({cellWidth,cellHeight:24,CanvasKit:{XYWHRect:(...r)=>r,ClipOp:{Intersect:0}},
      paintFor:c=>c,drawText:(text,x,y,cells,color,options)=>labels.push({text,x,cells,align:options.align}),
      canvas:{save(){},restore(){},clipRect(){},drawRect(){}}});
    const plus=labels.find(x=>x.text==="[+]"),minus=labels.find(x=>x.text==="[-]");
    expect(plus.align).toBe("center");expect(minus.align).toBe("center");
    expect(plus.cells).toBe(minus.cells);
    expect(plus.x+plus.cells*cellWidth).toBe(412);
    expect(minus.x).toBe(8);
  }
});
