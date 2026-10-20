import {test,expect} from "bun:test";
import {loadCanvasKit,loadFontSet} from "../initramfs/lib/canvas.js";
import {Renderer} from "../initramfs/lib/bunterm/renderer.js";
import {Terminal} from "../initramfs/lib/xterm/xterm-headless.mjs";
import {createVtMenu} from "../initramfs/lib/bunterm/vt-menu.js";

test("real CanvasKit redraws resized text and overlay with fresh font metrics", async () => {
  const CanvasKit=await loadCanvasKit(), fonts=loadFontSet(CanvasKit,"terminal");
  const surface=CanvasKit.MakeSurface(800,480);
  const screen={width:800,height:480,canvas:surface.getCanvas(),flush:()=>surface.flush()};
  const renderer=new Renderer({CanvasKit,screen,fonts});
  const term=new Terminal({cols:renderer.columns,rows:renderer.rows,allowProposedApi:true});
  try {
    await new Promise(resolve=>term.write("Hello 中文 👨‍👩‍👧\r\nSelection and font resize",resolve));
    const columns=renderer.columns;
    renderer.render(term);
    renderer.setFontSize(20);
    expect(renderer.columns).toBeLessThan(columns);
    term.resize(renderer.columns,renderer.rows);
    const menu=createVtMenu({list:()=>[{number:1,label:"tty1 — initial console"}],select(){},changed(){renderer.invalidate();},
      width:800,height:480,rowHeight:renderer.cellHeight,
      controls:{fontSize:()=>renderer.fontSize,cellHeight:()=>renderer.cellHeight,execute:()=>""}});
    menu.pointer({x:0,y:0,pressed:["left"],buttons:{left:true},wheel:0});
    renderer.render(term,{overlay:()=>menu.draw(renderer)});
    const image=surface.makeImageSnapshot();
    expect(image.width()).toBe(800);
    image.delete();
    renderer.setFontSize(13);
    expect(renderer.columns).toBe(columns);
    expect(()=>renderer.setFontSize(NaN)).toThrow();
  } finally {term.dispose();renderer.delete();fonts.delete();surface.delete();}
},20000);
