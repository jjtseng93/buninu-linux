// /lib/bunterm/images.js — kitty graphics protocol placements on the cell
// grid.
//
// jsgotty's KittyGraphicsParser has already split the APC packets out of the
// PTY stream and assembled chunked transfers; this module turns its
// "placement" / "delete" events into Skia images anchored to terminal lines.
// A placement is tied to an xterm.js marker, so it scrolls with the text and
// disappears when its line leaves the scrollback.

const number = (value, fallback = 0) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// Decodes a transferred image into a Skia Image. Format 100 is PNG (or any
// encoded format Skia knows); 24 and 32 are raw RGB / RGBA. Bun.Image, when
// present, transcodes encodings Skia cannot read on its own.
export const decodeImage = async (CanvasKit, image) => {
  const bytes = Buffer.from(image.data, "base64");
  if (image.format === 24 || image.format === 32) {
    const { width, height } = image;
    if (!width || !height) throw new Error("raw image without dimensions");
    let pixels = bytes;
    if (image.format === 24) {
      pixels = Buffer.alloc(width * height * 4, 255);
      for (let i = 0, o = 0; i < bytes.length; i += 3, o += 4) {
        pixels[o] = bytes[i];
        pixels[o + 1] = bytes[i + 1];
        pixels[o + 2] = bytes[i + 2];
      }
    }
    const decoded = CanvasKit.MakeImage({
      width, height,
      colorType: CanvasKit.ColorType.RGBA_8888,
      alphaType: CanvasKit.AlphaType.Unpremul,
      colorSpace: CanvasKit.ColorSpace.SRGB,
    }, pixels, width * 4);
    if (!decoded) throw new Error("raw image rejected");
    return decoded;
  }
  let decoded = CanvasKit.MakeImageFromEncoded(bytes);
  if (!decoded && typeof Bun !== "undefined" && Bun.Image) {
    const png = await new Bun.Image(bytes).png().toBuffer();
    decoded = CanvasKit.MakeImageFromEncoded(png);
  }
  if (!decoded) throw new Error("undecodable image data");
  return decoded;
};

export class ImageStore {
  constructor({ CanvasKit, term, renderer }) {
    this.CanvasKit = CanvasKit;
    this.term = term;
    this.renderer = renderer;
    this.images = new Map();      // image id → Skia Image
    this.imageSources = new Map(); // image id → parser image object
    this.placements = new Map();  // placement key → placement
    this.counter = 0;
    this.coveredKey = "";
    this.coveredRows = new Set();
  }

  // Handles one parsed graphic. Returns the control sequence that moves the
  // cursor past a placement (to be written to the terminal), or "".
  async handle(graphic) {
    if (!graphic) return "";
    if (graphic.kind === "delete") {
      this.remove(graphic.delete);
      return "";
    }
    if (graphic.kind !== "placement") return "";
    const { control, image } = graphic;
    let decoded = this.images.get(image.id);
    const replacesImage = decoded && this.imageSources.get(image.id) !== image;
    if (!decoded || replacesImage) {
      try {
        const replacement = await decodeImage(this.CanvasKit, image);
        if (replacesImage) {
          // Kitty requires retransmitting a non-zero image id to delete the
          // old image and all its placements.  Screen-streaming clients such
          // as casty deliberately reuse one id for every frame.
          for (const placement of [...this.placements.values()]) {
            if (placement.imageId === image.id) this.dispose(placement);
          }
          decoded.delete();
        }
        decoded = replacement;
      } catch (error) {
        graphic.responseMessage = `EBADPNG:${error.message}`;
        return "";
      }
      this.images.set(image.id, decoded);
      this.imageSources.set(image.id, image);
    }
    const { cellWidth, cellHeight } = this.renderer;
    const buffer = this.term.buffer.active;
    const sourceX = number(control.x);
    const sourceY = number(control.y);
    const sourceWidth = number(control.w) || decoded.width() - sourceX;
    const sourceHeight = number(control.h) || decoded.height() - sourceY;
    const columns = number(control.c) || Math.max(1, Math.ceil(sourceWidth / cellWidth));
    const rows = number(control.r) || Math.max(1, Math.ceil(sourceHeight / cellHeight));
    // xterm.js only issues markers in the normal buffer. On the alternate
    // screen (full-screen programs) there is no scrollback, so the placement
    // is anchored to a fixed row instead and dropped when that screen ends.
    const marker = buffer.type === "normal" ? this.term.registerMarker(0) : null;
    const placementId = control.p ?? null;
    const key = `${image.id}:${placementId ?? `auto${++this.counter}`}`;
    const existing = this.placements.get(key);
    if (existing) this.dispose(existing);
    const placement = {
      key,
      imageId: image.id,
      placementId,
      marker,
      bufferType: buffer.type,
      fixedLine: buffer.baseY + buffer.cursorY,
      get line() { return this.marker ? this.marker.line : this.fixedLine; },
      get isDisposed() {
        return this.marker ? this.marker.isDisposed : this.bufferType !== this.term.buffer.active.type;
      },
      term: this.term,
      column: buffer.cursorX,
      columns,
      rows,
      offsetX: number(control.X),
      offsetY: number(control.Y),
      source: [sourceX, sourceY, sourceX + sourceWidth, sourceY + sourceHeight],
      zIndex: number(control.z),
    };
    this.placements.set(key, placement);
    this.invalidate(placement);
    if (control.C === "1") return "";
    // Move the cursor below the image, the way jsgotty does for its browser
    // terminal: one line feed per image row (so the screen scrolls when the
    // image runs past the bottom, and the placement's marker scrolls with
    // it), then to the column after the image.
    return `${"\r\n".repeat(rows)}\u001b[${buffer.cursorX + columns + 1}G`;
  }

  invalidate(placement) {
    const top = placement.line - this.term.buffer.active.viewportY;
    this.renderer.invalidateRows(top, top + placement.rows);
  }

  dispose(placement) {
    this.invalidate(placement);
    placement.marker?.dispose();
    this.placements.delete(placement.key);
  }

  remove({ scope, imageId, placementId, cursor }) {
    const wipe = scope === scope.toUpperCase();
    const targets = [];
    for (const placement of this.placements.values()) {
      switch (scope.toLowerCase()) {
        case "a":
          targets.push(placement);
          break;
        case "i":
          if (placement.imageId === imageId && (!placementId || placement.placementId === placementId)) {
            targets.push(placement);
          }
          break;
        case "c": {
          const row = placement.line - this.term.buffer.active.baseY + 1;
          const column = placement.column + 1;
          if (cursor && cursor.row >= row && cursor.row < row + placement.rows
              && cursor.col >= column && cursor.col < column + placement.columns) {
            targets.push(placement);
          }
          break;
        }
        default:
          break;
      }
    }
    for (const placement of targets) this.dispose(placement);
    if (wipe) {
      const used = new Set([...this.placements.values()].map((placement) => placement.imageId));
      for (const [id, image] of this.images) {
        if (!used.has(id)) {
          image.delete();
          this.images.delete(id);
          this.imageSources.delete(id);
        }
      }
    }
  }

  // Placements currently on screen, as { image, source, rect } in pixels.
  visible() {
    const { renderer } = this;
    const { cellWidth, cellHeight, offsetX, offsetY } = renderer;
    const viewportY = this.term.buffer.active.viewportY;
    const result = [];
    for (const placement of [...this.placements.values()]) {
      if (placement.isDisposed) {
        this.placements.delete(placement.key);
        continue;
      }
      const top = placement.line - viewportY;
      if (top + placement.rows <= 0 || top >= renderer.rows) continue;
      const image = this.images.get(placement.imageId);
      if (!image) continue;
      const left = offsetX + placement.column * cellWidth + placement.offsetX;
      const y = offsetY + top * cellHeight + placement.offsetY;
      result.push({
        image,
        source: placement.source,
        rect: [left, y, left + placement.columns * cellWidth, y + placement.rows * cellHeight],
        zIndex: placement.zIndex,
      });
    }
    // The renderer's row hashes only see text, so when placements move or
    // vanish every row they covered before or cover now is repainted.
    const covered = new Set();
    for (const { rect } of result) {
      const first = Math.floor((rect[1] - offsetY) / cellHeight);
      const last = Math.ceil((rect[3] - offsetY) / cellHeight);
      for (let row = first; row < last; row++) covered.add(row);
    }
    const key = [...covered].sort((a, b) => a - b).join(",");
    if (key !== this.coveredKey) {
      for (const row of this.coveredRows ?? []) renderer.invalidateRows(row, row + 1);
      for (const row of covered) renderer.invalidateRows(row, row + 1);
      this.coveredKey = key;
      this.coveredRows = covered;
    }
    return result.sort((a, b) => a.zIndex - b.zIndex);
  }

  delete() {
    for (const placement of [...this.placements.values()]) placement.marker?.dispose();
    this.placements.clear();
    for (const image of this.images.values()) image.delete();
    this.images.clear();
    this.imageSources.clear();
  }
}
