// Local overlay; none of its input is sent to the PTY.
export function createVtMenu({ list, select, changed, width, height, rowHeight }) {
  const row = Math.max(24, Math.ceil(rowHeight + 8));
  const capacity = Math.max(1, Math.floor(height / row) - 2);
  const panelWidth = Math.min(width, 420);
  let entries = null, selected = 0, offset = 0, swallow = false;
  const close = () => { entries = null; changed(); };
  const move = delta => {
    selected = Math.max(0, Math.min(entries.length - 1, selected + delta));
    offset = Math.max(0, Math.min(offset, selected));
    if (selected >= offset + capacity) offset = selected - capacity + 1;
    changed();
  };
  const choose = () => { const target = entries[selected]; close(); if (target) select(target.number); };
  return {
    get visible() { return entries !== null; },
    close,
    pointer(report) {
      if (swallow && !entries) {
        if (!Object.values(report.buttons).some(Boolean)) swallow = false;
        return true;
      }
      if (!entries) {
        if (report.x < 0 || report.y < 0 || report.x >= 2 || report.y >= 2 || !report.pressed.includes("left")) return false;
        entries = list(); selected = 0; offset = 0; swallow = true; changed(); return true;
      }
      swallow = Object.values(report.buttons).some(Boolean);
      if (report.wheel) move(-Math.sign(report.wheel));
      const index = Math.floor(report.y / row) - 1 + offset;
      const inside = report.x >= 0 && report.x < panelWidth && report.y >= row && index >= offset && index < Math.min(entries.length, offset + capacity);
      if (inside && report.moved) { selected = index; changed(); }
      if (report.pressed.includes("left")) {
        swallow = true;
        if (inside) { selected = index; choose(); } else close();
      } else if (report.pressed.includes("right")) { swallow = true; close(); }
      return true;
    },
    input(bytes) {
      if (!entries) return false;
      const text = bytes.toString("latin1");
      if (text === "\x1b" || text === "\x03") close();
      else if (["\x1b[A", "\x1bOA", "k"].includes(text)) move(-1);
      else if (["\x1b[B", "\x1bOB", "j"].includes(text)) move(1);
      else if (text === "\r" || text === "\n") choose();
      return true;
    },
    draw(renderer) {
      if (!entries) return;
      const { canvas, CanvasKit } = renderer;
      const visible = entries.slice(offset, offset + capacity);
      const rect = (y, color) => canvas.drawRect(CanvasKit.XYWHRect(0, y, panelWidth, row), renderer.paintFor(color));
      const text = (value, y) => renderer.drawText(value, 8, y + (row - renderer.cellHeight) / 2,
        Math.max(1, Math.floor((panelWidth - 16) / renderer.cellWidth)), [240, 240, 240], {});
      canvas.save();
      canvas.clipRect(CanvasKit.XYWHRect(0, 0, panelWidth, Math.min(height, (visible.length + 2) * row)), CanvasKit.ClipOp.Intersect, false);
      rect(0, [35, 40, 48]); text("Switch terminal", 0);
      visible.forEach((entry, i) => {
        const y = (i + 1) * row;
        rect(y, i + offset === selected ? [45, 80, 125] : [25, 29, 35]); text(entry.label, y);
      });
      const y = (visible.length + 1) * row;
      rect(y, [35, 40, 48]); text("↑↓ / wheel · Enter · Esc", y);
      canvas.restore();
    },
  };
}
