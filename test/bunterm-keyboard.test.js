import {test,expect} from "bun:test";
import {Terminal} from "../initramfs/lib/xterm/xterm-headless.mjs";
import {ConsoleKeys,MediumRawDecoder,legacyKey} from "../initramfs/lib/bunterm/keycodes.js";
import {attachKeyboard} from "../initramfs/lib/bunterm/keyboard.js";
const write = (term,text) => new Promise(resolve=>term.write(text,resolve));
const letters = {16:"q",17:"w",18:"e",19:"r",20:"t",21:"y",22:"u",23:"i",24:"o",25:"p",
  30:"a",31:"s",32:"d",33:"f",34:"g",35:"h",36:"j",37:"k",38:"l",44:"z",45:"x",46:"c",
  47:"v",48:"b",49:"n",50:"m"};
const keys = () => new ConsoleKeys({lookup:(table,n) => {
  const letter = letters[n];
  if (letter) return 0xb00 | (table & 1 ? letter.toUpperCase() : letter).charCodeAt(0);
  return n === 57 ? 32 : n === 53 ? (table & 1 ? 63 : 47) : null;
}});
function fixture(extra = {}) {
  const term = new Terminal({allowProposedApi:true}), output = [], modes = [], switches = [];
  const keyboard = attachKeyboard({term,write:text=>output.push(text),
    setEnhanced:v=>modes.push(v),switchVT:n=>switches.push(n),...extra});
  return {term,output,modes,switches,keyboard,close(){keyboard.dispose();term.dispose();}};
}
test("mediumraw extended codes survive every possible read boundary", () => {
  const bytes = Buffer.from([30,158,0,129,183,128,129,183]); // F13 = 183
  for (let split=0;split<=bytes.length;split++) {
    const decoder = new MediumRawDecoder(), events=[];
    decoder.feed(bytes.subarray(0,split),(c,d)=>events.push([c,d]));
    decoder.feed(bytes.subarray(split),(c,d)=>events.push([c,d]));
    expect(events).toEqual([[30,true],[30,false],[183,true],[183,false]]);
  }
});
test("all Ctrl/Alt/Shift/Super letter combinations stay distinct", async () => {
  const f=fixture();
  try {
    await write(f.term,"\x1b[>9u");
    for (let bits=0;bits<16;bits++) for (const [number,letter] of Object.entries(letters)) {
      const state=keys();
      for (const [mask,code] of [[1,42],[2,56],[4,29],[8,125]]) if(bits&mask) f.keyboard.event(state.event(code,true));
      f.output.length=0;
      f.keyboard.event(state.event(Number(number),true));
      expect(f.output).toEqual([`\x1b[${letter.charCodeAt(0)}${bits?";"+(bits+1):""}u`]);
      f.keyboard.blur();
    }
  } finally {f.close();}
});
test("push/pop, repeat/release, recovery keys, independent buffers and reset", async () => {
  const f=fixture(), state=keys();
  try {
    await write(f.term,"\x1b[?u\x1b[>11u");
    expect(f.output).toEqual(["\x1b[?0u"]);
    f.output.length=0;
    f.keyboard.event(state.event(125,true));
    f.keyboard.event(state.event(50,true));
    f.keyboard.event(state.event(50,true));
    f.keyboard.event(state.event(50,false));
    f.keyboard.event(state.event(125,false));
    expect(f.output).toEqual(["\x1b[57444;9u","\x1b[109;9u","\x1b[109;9:2u","\x1b[109;9:3u","\x1b[57444;1:3u"]);
    await write(f.term,"\x1b[>1u");
    f.output.length=0;
    f.keyboard.event(state.event(28,true));
    f.keyboard.event(state.event(28,false));
    f.keyboard.event(state.event(30,true));
    expect(f.output).toEqual(["\r","a"]);
    await write(f.term,"\x1b[<u");
    expect(f.keyboard.flags).toBe(11);
    await write(f.term,"\x1b[?1049h");
    expect(f.keyboard.flags).toBe(0);
    await write(f.term,"\x1b[?1049l");
    expect(f.keyboard.flags).toBe(11);
    await write(f.term,"\x1bc");
    expect(f.keyboard.flags).toBe(0);
    expect(f.modes).toEqual([true,false,true,false]);
  } finally {f.close();}
});
test("local menu and reserved VT keys never reach the child", async () => {
  let menu=false;
  const f=fixture({localInput:()=>menu}), state=keys();
  try {
    await write(f.term,"\x1b[>11u");
    f.keyboard.event(state.event(29,true));
    f.keyboard.event(state.event(56,true));
    f.output.length=0;
    f.keyboard.event(state.event(60,true));
    f.keyboard.event(state.event(60,false));
    expect(f.switches).toEqual([2]);
    expect(f.output).toEqual([]);
    f.keyboard.blur(); f.output.length=0;
    menu=true;
    f.keyboard.event(state.event(30,true));
    f.keyboard.event(state.event(30,false));
    expect(f.output).toEqual([]);
  } finally {f.close();}
});
test("layout translation, caps, AltGr, keypad and Unicode map", () => {
  const state=keys();
  state.event(58,true); state.event(58,false);
  expect(state.event(30,true).key).toBe("A");
  state.event(42,true);
  expect(state.event(30,true).key).toBe("a");
  expect(state.event(100,true).key).toBe("AltGraph");
  expect(state.event(53,true).getModifierState("AltGraph")).toBe(true);
  const unicode=new ConsoleKeys({lookup:()=>0xf000^0x4e2d});
  expect(unicode.event(30,true).key).toBe("中");
  const num=keys();
  num.event(69,true);
  expect(num.event(79,true).key).toBe("1");
  expect(num.event(79,false).location).toBe(3);
  expect(legacyKey({type:"keydown",key:"/",ctrlKey:true})).toBe("\x1f");
});
test("failed console transition resets flags and does not strand the protocol", async () => {
  const errors=[];
  const f=fixture({setEnhanced(){throw new Error("not a VT");},onError:e=>errors.push(e.message)});
  try {
    await write(f.term,"\x1b[>11u\x1b[?u");
    expect(f.keyboard.flags).toBe(0);
    expect(f.output).toEqual(["\x1b[?0u"]);
    expect(errors).toEqual(["not a VT"]);
  } finally {f.close();}
});
