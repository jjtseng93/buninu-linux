// Supply both coordinate systems: xterm selects cells (1006) or pixels (1016).
// Pixels are relative to the terminal content, excluding framebuffer margins.
export function terminalMouseEvent(report, renderer, button, action) {
  const x = Math.floor(report.x - renderer.offsetX);
  const y = Math.floor(report.y - renderer.offsetY);
  return {
    col: Math.floor(x / renderer.cellWidth), row: Math.floor(y / renderer.cellHeight),
    x, y, button, action, ctrl: false, alt: false, shift: false,
  };
}
