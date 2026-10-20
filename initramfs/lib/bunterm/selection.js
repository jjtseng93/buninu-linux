// Coordinates are buffer cells, not UTF-16 indices. Endpoints include a whole
// grapheme, even when the mouse hits the continuation cell of a wide character.
export function createSelection(term, renderer, changed) {
  let anchor = null, end = null, dragging = false;
  const clear = () => { if (anchor) { anchor = end = null; dragging = false; changed(); } };
  const point = report => {
    const x = Math.max(0, Math.min(term.cols - 1, Math.floor((report.x - renderer.offsetX) / renderer.cellWidth)));
    const y = term.buffer.active.viewportY + Math.max(0, Math.min(term.rows - 1,
      Math.floor((report.y - renderer.offsetY) / renderer.cellHeight)));
    return {x,y};
  };
  const bounds = () => {
    if (!anchor) return null;
    let [a,b] = anchor.y < end.y || anchor.y === end.y && anchor.x <= end.x ? [anchor,end] : [end,anchor];
    const first = term.buffer.active.getLine(a.y), last = term.buffer.active.getLine(b.y);
    let start = a.x, stop = b.x;
    if (first?.getCell(start)?.getWidth() === 0) start = Math.max(0,start-1);
    if (last?.getCell(stop)?.getWidth() === 0) stop = Math.max(0,stop-1);
    stop += Math.max(1,last?.getCell(stop)?.getWidth() || 1);
    return {a:{x:start,y:a.y},b:{x:stop,y:b.y}};
  };
  return {
    clear,
    stop() { dragging = false; },
    get active() { return !!anchor; },
    pointer(report) {
      if (term._core?.coreMouseService?.areMouseEventsActive) { clear(); return false; }
      if (report.pressed.includes("left")) { anchor = end = point(report); dragging = true; changed(); }
      if (dragging && (report.moved || report.released.includes("left"))) { end = point(report); changed(); }
      if (report.released.includes("left")) dragging = false;
      return true;
    },
    text() {
      const range = bounds();
      if (!range) return "";
      const {a,b} = range;
      let text = "";
      for (let y = a.y; y <= b.y; y++) {
        const line = term.buffer.active.getLine(y);
        if (!line) continue;
        const start = y === a.y ? a.x : 0, stop = y === b.y ? b.x : term.cols;
        if (y > a.y && !line.isWrapped) text += "\n";
        // Wrapped rows join without a newline or lost meaningful spaces.
        const nextWrapped = y < b.y && term.buffer.active.getLine(y + 1)?.isWrapped;
        text += line.translateToString(!nextWrapped, start, stop);
      }
      return text;
    },
    draw() {
      const range = bounds();
      if (!range) return;
      const {a,b} = range, top = term.buffer.active.viewportY;
      for (let y = Math.max(a.y,top); y <= Math.min(b.y,top+term.rows-1); y++) {
        const start = y === a.y ? a.x : 0, stop = y === b.y ? b.x : term.cols;
        renderer.canvas.drawRect(renderer.cellRect(start,y-top,stop-start),
          renderer.paintFor([70,150,220],95));
      }
    },
  };
}
