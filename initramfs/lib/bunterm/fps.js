// Count newly presented Kitty images, not pointer, menu or counter repaints.
export function createFpsMeter(now = () => performance.now()) {
  let enabled = false, seen = new WeakSet(), frames = 0, since = 0, value = 0;
  return {
    get enabled() { return enabled; },
    get value() { return value; },
    toggle(images = []) {
      enabled = !enabled;
      seen = new WeakSet(images.map(({image}) => image)); frames = 0; value = 0; since = now();
      return enabled;
    },
    presented(images) {
      if (!enabled) return;
      let fresh = false;
      for (const {image} of images) {
        if (!seen.has(image)) { seen.add(image); fresh = true; }
      }
      if (fresh) frames++;
    },
    sample() {
      const time = now(), elapsed = time - since;
      value = enabled && elapsed > 0 ? frames * 1000 / elapsed : 0;
      frames = 0; since = time;
      return value;
    },
    draw(renderer) {
      if (!enabled) return;
      const label = `FPS ${value.toFixed(1)}`;
      const columns = Math.min(renderer.columns, label.length + 2);
      const width = columns * renderer.cellWidth;
      const x = renderer.offsetX + renderer.columns * renderer.cellWidth - width;
      const y = renderer.offsetY;
      renderer.canvas.drawRect(renderer.CanvasKit.XYWHRect(x,y,width,renderer.cellHeight),
        renderer.paintFor([20,25,30]));
      renderer.drawText(label,x,y,columns,[65,220,230],{align:"center"});
    },
  };
}
