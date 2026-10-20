// Local overlay; none of its input is sent to the PTY.
import { StringDecoder } from "node:string_decoder";

export function createVtMenu({ list, select, changed, width, height, rowHeight, controls = null }) {
  let row = Math.max(24, Math.ceil(rowHeight + 8));
  let capacity = Math.max(1, Math.floor(height / row) - 2);
  const panelWidth = Math.min(width, 420);
  let entries = null, selected = 0, offset = 0, swallow = false;
  let command = [], caret = 0, editing = false, status = "", escape = "";
  let decoder = new StringDecoder("utf8");
  const layout = () => {
    row = Math.max(24, Math.ceil((controls?.cellHeight?.() ?? rowHeight) + 8));
    capacity = Math.max(1, Math.floor(height / row) - 2);
    if (selected >= offset + capacity) offset = selected - capacity + 1;
  };
  const close = () => { entries = null; editing = false; changed(); };
  const move = delta => {
    selected = Math.max(0, Math.min(entries.length - 1, selected + delta));
    offset = Math.max(0, Math.min(offset, selected));
    if (selected >= offset + capacity) offset = selected - capacity + 1;
    changed();
  };
  const run = (line) => {
    // Promise.resolve().then also catches synchronous callbacks.
    Promise.resolve().then(() => controls.execute(line)).then(message => {
      status = message || ""; changed();
    }).catch(error => { status = error.message; changed(); });
  };
  const choose = (right = false) => {
    const target = entries[selected];
    if (target?.kind === "font") { run(`font ${right ? "+" : "-"}`); return; }
    if (target?.kind === "clipboard") {
      run(right ? "paste" : "copy");
      return;
    }
    if (target?.kind === "command") { editing = true; changed(); return; }
    close(); if (target) select(target.number);
  };
  return {
    get visible() { return entries !== null; },
    close,
    pointer(report) {
      layout();
      if (swallow && !entries) {
        if (!Object.values(report.buttons).some(Boolean)) swallow = false;
        return true;
      }
      if (!entries) {
        if (report.x < 0 || report.y < 0 || report.x >= 2 || report.y >= 2 || !report.pressed.includes("left")) return false;
        entries = [...(controls ? [{kind:"font"}, {kind:"clipboard"}, {kind:"command"}] : []), ...list()];
        selected = 0; offset = 0; swallow = true; status = ""; escape = "";
        decoder = new StringDecoder("utf8"); changed(); return true;
      }
      swallow = Object.values(report.buttons).some(Boolean);
      if (report.wheel) move(-Math.sign(report.wheel));
      const index = Math.floor(report.y / row) - 1 + offset;
      const inside = report.x >= 0 && report.x < panelWidth && report.y >= row && index >= offset && index < Math.min(entries.length, offset + capacity);
      if (inside && report.moved && !editing) { selected = index; changed(); }
      if (report.pressed.includes("left")) {
        swallow = true;
        if (inside) {
          selected = index; editing = false;
          if (entries[index].kind !== "font" || report.x < 64 || report.x >= panelWidth-64)
            choose(report.x >= panelWidth/2);
          else changed();
        } else close();
      } else if (report.pressed.includes("right")) { swallow = true; close(); }
      return true;
    },
    input(bytes) {
      if (!entries) return false;
      layout();
      const text = decoder.write(bytes);
      if (text === "\x1b" && !escape || text === "\x03") { close(); return true; }
      // Parse multiple keys in one console read, retaining incomplete CSI/SS3.
      const input = escape + text; escape = "";
      for (let i = 0; i < input.length;) {
        let key = String.fromCodePoint(input.codePointAt(i));
        if (key === "\x1b") {
          const rest = input.slice(i);
          const match = /^\x1b(?:\[[0-9;]*[A-Za-z~]|O[A-Za-z])/.exec(rest);
          if (!match) { if (/^\x1b(?:\[[0-9;]*|O)?$/.test(rest)) escape = rest; break; }
          key = match[0];
        }
        i += key.length;
        if (key === "\x03") { close(); break; }
        if (key === "\t" && controls) {
          editing = !editing;
          if (editing && controls) { selected = 2; move(0); }
        } else if (editing) {
          if (key === "\r" || key === "\n") { run(command.join("")); command = []; caret = 0; }
          else if (key === "\x7f" || key === "\b") { if (caret) command.splice(--caret,1); }
          else if (key === "\x1b[3~") command.splice(caret,1);
          else if (["\x1b[D","\x1bOD"].includes(key)) caret = Math.max(0,caret-1);
          else if (["\x1b[C","\x1bOC"].includes(key)) caret = Math.min(command.length,caret+1);
          else if (["\x01","\x1b[H","\x1bOH"].includes(key)) caret = 0;
          else if (["\x05","\x1b[F","\x1bOF"].includes(key)) caret = command.length;
          else if (key === "\x15") { command = []; caret = 0; }
          else if (key.codePointAt(0) >= 32 && !key.startsWith("\x1b") && command.length < 1024) command.splice(caret++,0,key);
        } else if (["\x1b[A", "\x1bOA", "k"].includes(key)) move(-1);
        else if (["\x1b[B", "\x1bOB", "j"].includes(key)) move(1);
        else if (key === "\r" || key === "\n") { choose(); if (!entries) break; }
        else if (controls && ["+","-","\x1b[C","\x1b[D"].includes(key) && entries[selected]?.kind === "font")
          choose(key === "+" || key === "\x1b[C");
        else if (controls && entries[selected]?.kind === "clipboard" && ["c","p","\x1b[C","\x1b[D"].includes(key))
          choose(key === "p" || key === "\x1b[C");
      }
      changed();
      return true;
    },
    draw(renderer) {
      if (!entries) return;
      layout();
      const { canvas, CanvasKit } = renderer;
      const visible = entries.slice(offset, offset + capacity);
      const rect = (y, color) => canvas.drawRect(CanvasKit.XYWHRect(0, y, panelWidth, row), renderer.paintFor(color));
      const text = (value, y, x = 8, span = panelWidth - 16, align = "left") => renderer.drawText(value, x, y + (row - renderer.cellHeight) / 2,
        Math.max(1, Math.floor(span / renderer.cellWidth)), [240, 240, 240], {align});
      canvas.save();
      canvas.clipRect(CanvasKit.XYWHRect(0, 0, panelWidth, Math.min(height, (visible.length + 2) * row)), CanvasKit.ClipOp.Intersect, false);
      rect(0, [35, 40, 48]); text(controls ? "bunterm" : "Switch terminal", 0);
      visible.forEach((entry, i) => {
        const y = (i + 1) * row;
        rect(y, i + offset === selected ? [45, 80, 125] : [25, 29, 35]);
        if (entry.kind === "font") {
          text("[-]",y,8,48);
          text(`🔤 字體 Font ${controls.fontSize()}`,y,64,Math.max(1,panelWidth-128),"center");
          text("[+]",y,Math.max(8,panelWidth-40),32);
          return;
        }
        if (entry.kind === "clipboard") {
          text("📋 複製 Copy",y,8,panelWidth/2-16);
          text("📥 貼上 Paste",y,panelWidth/2+8,panelWidth/2-16);
          return;
        }
        if (entry.kind === "command") {
          canvas.drawRect(CanvasKit.XYWHRect(4,y+2,panelWidth-8,row-4),renderer.paintFor(editing?[80,170,220]:[85,95,105]));
          canvas.drawRect(CanvasKit.XYWHRect(5,y+3,panelWidth-10,row-6),renderer.paintFor([225,230,235]));
          const placeholder = !command.length && !editing;
          const label = placeholder ? "Click to type a command…"
            : `${command.slice(Math.max(0,caret-24),caret).join("")}${editing?"│":""}${command.slice(caret).join("")}`;
          renderer.drawText(label,10,y+(row-renderer.cellHeight)/2,
            Math.max(1,Math.floor((panelWidth-20)/renderer.cellWidth)),
            placeholder?[100,110,120]:[20,25,30],{align:"left"});
          return;
        }
        const label = `${entry.label}${entry.current ? " (current)" : ""}`;
        text(label, y);
      });
      const y = (visible.length + 1) * row;
      rect(y, [35, 40, 48]); text(status || (controls ? "Tab: command · Enter · Esc" : "↑↓ / wheel · Enter · Esc"), y);
      canvas.restore();
    },
  };
}
