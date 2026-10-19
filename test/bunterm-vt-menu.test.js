import { test, expect } from "bun:test";
import { createVtMenu } from "../initramfs/lib/bunterm/vt-menu.js";
const report = (x, y, pressed = [], released = []) => ({ x, y, pressed, released, buttons: {left: pressed.includes("left")}, wheel: 0, moved: false });
function fixture(extra = {}) {
  const selected = [];
  const menu = createVtMenu({ width: 800, height: 600, rowHeight: 16,
    list: () => [{number:1,label:"initial"}, {number:3,label:"bunterm"}],
    select: n => selected.push(n), changed() {}, ...extra });
  return {menu, selected};
}
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
