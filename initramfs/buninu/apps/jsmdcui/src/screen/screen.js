import process from "node:process";
import { styleToAnsi } from "../display/ansi-style.js";
import { CellBuffer } from "./cell-buffer.js";
import { DISABLE_MOUSE, DISABLE_PASTE, ENABLE_MOUSE, ENABLE_PASTE, ResizeEvent } from "./events.js";
import { logKittyPlacement } from "../cui/kitty-debug.mjs";

const CURSOR_SHAPE_SEQUENCE = {
  default: "\x1b[0 q",
  "blinking-block": "\x1b[1 q",
  block: "\x1b[2 q",
  "blinking-underline": "\x1b[3 q",
  underline: "\x1b[4 q",
  "blinking-bar": "\x1b[5 q",
  bar: "\x1b[6 q",
};

const KITTY_APC = "\x1b_G";
const KITTY_ST = "\x1b\\";
const KITTY_CHUNK_SIZE = 4096;

export function cursorShapeSequence(shape) {
  return CURSOR_SHAPE_SEQUENCE[shape] ?? CURSOR_SHAPE_SEQUENCE.block;
}

export class Screen {
  constructor({ mouse = true, kittyMode = "off" } = {}) {
    this.mouse = mouse;
    this.kittyMode = kittyMode;
    this.cols = process.stdout.columns || 80;
    this.rows = process.stdout.rows || 24;
    this.cells = new CellBuffer(this.cols, this.rows);
    this.previous = null;
    this.cursor = null;
    this.cursorVisible = false;
    this.kittyImages = [];
    this._shownKittySignature = "";
    this._shownKittyIds = [];
    this._transmittedKittyIds = new Set();
  }

  init() {
    this._shownKittySignature = "";
    this._shownKittyIds = [];
    this._transmittedKittyIds.clear();
    this.write("\x1b[?1049h\x1b[?25l");
    if (this.mouse) this.write(ENABLE_MOUSE);
    this.write(ENABLE_PASTE);
  }

  fini() {
    for (const id of this._transmittedKittyIds)
      this.write(`${KITTY_APC}a=d,d=I,i=${id},q=2;${KITTY_ST}`);
    this._shownKittySignature = "";
    this._shownKittyIds = [];
    this._transmittedKittyIds.clear();
    if (this.mouse) this.write(DISABLE_MOUSE);
    this.write(DISABLE_PASTE);
    this.write("\x1b[0 q\x1b[?25h\x1b[?1049l\x1b[0m");
  }

  SetContent(x, y, ch, combining = [], style = null) {
    this.cells.setContent(x, y, ch, style, combining);
  }

  setContent(x, y, ch, style = null, combining = []) {
    this.SetContent(x, y, ch, combining, style);
  }

  setFillerContent(x, y, style = null) {
    this.cells.setFiller(x, y, style);
  }

  GetContent(x, y) {
    return this.cells.getContent(x, y);
  }

  getContent(x, y) {
    return this.GetContent(x, y);
  }

  Fill(ch = " ", style = null) {
    this.cells.fill(ch, style);
  }

  fill(ch = " ", style = null) {
    this.Fill(ch, style);
  }

  Show() {
    const changes = this.cells.diff(this.previous);
    let out = "\x1b[?25l";
    let activeStyleKey = null;
    for (const { x, y, cell } of changes) {
      if (cell.filler) continue; // right-half of a wide char; the base cell covers this column
      // If this is a wide char (next cell is its filler), clear the filler column with
      // default style first. On narrow-emoji terminals this leaves a default-bg blank
      // at the right-half column instead of stale cursor-line / syntax background, so
      // the area next to the glyph doesn't look like a colored block "covering" it.
      // On wide-emoji terminals the glyph's right half overwrites the blank harmlessly.
      const nextCell = this.cells.getContent(x + 1, y);
      if (nextCell?.filler) {
        out += this.move(y + 1, x + 2);
        out += styleToAnsi({});
        activeStyleKey = "";
        out += " ";
      }
      out += this.move(y + 1, x + 1);
      if (cell.styleKey !== activeStyleKey) {
        out += styleToAnsi(cell.style ?? {});
        activeStyleKey = cell.styleKey;
      }
      out += cell.ch + cell.combining.join("");
    }
    out += "\x1b[0m";
    if (this.cursor && this.cursorVisible) {
      out += cursorShapeSequence(this.cursor.shape) + this.move(this.cursor.y + 1, this.cursor.x + 1) + "\x1b[?25h";
    } else out += "\x1b[?25l";
    const kittySignature = this.kittyImages.map((image) =>
      `${image.id}:${image.placementId ?? image.id}:${image.x}:${image.y}:${image.cols}:${image.rows}:${image.sourceX ?? 0}:${image.sourceY ?? 0}:${image.sourceWidth ?? 0}:${image.sourceHeight ?? 0}`
    ).join("|");
    if (kittySignature !== this._shownKittySignature) {
      logKittyPlacement("screen-overlay-change", {
        previousSignature: this._shownKittySignature,
        nextSignature: kittySignature,
        deletingImageIds: this._shownKittyIds,
        terminalCols: this.cols,
        terminalRows: this.rows,
        textCursor: this.cursor,
        textCursorVisible: this.cursorVisible,
      });
      for (const id of this._shownKittyIds)
        out += `${KITTY_APC}a=d,d=i,i=${id},q=2;${KITTY_ST}`;
      for (const image of this.kittyImages) {
        const transmitted = this._transmittedKittyIds.has(image.id);
        logKittyPlacement("screen-placement-packet", {
          imageId: image.id,
          placementId: image.placementId ?? image.id,
          zeroBasedX: image.x,
          zeroBasedY: image.y,
          csiCol: image.x + 1,
          csiRow: image.y + 1,
          cols: image.cols,
          rows: image.rows,
          sourceRect: image.sourceWidth && image.sourceHeight ? {
            x: image.sourceX ?? 0,
            y: image.sourceY ?? 0,
            width: image.sourceWidth,
            height: image.sourceHeight,
          } : null,
          C: 1,
          mime: image.mime,
          bytes: image.data?.length ?? 0,
          action: transmitted ? "p" : "T",
        });
        out += this.move(image.y + 1, image.x + 1);
        const placementFields = [
          `i=${image.id}`, `p=${image.placementId ?? image.id}`, "q=2",
          ...(image.sourceWidth && image.sourceHeight ? [
            `x=${image.sourceX ?? 0}`,
            `y=${image.sourceY ?? 0}`,
            `w=${image.sourceWidth}`,
            `h=${image.sourceHeight}`,
          ] : []),
          `c=${image.cols}`, `r=${image.rows}`, "C=1",
          ...(this.kittyMode === "extended" && image.mime ? [`U=${image.mime}`] : []),
        ];
        if (transmitted) {
          out += `${KITTY_APC}a=p,${placementFields.join(",")};${KITTY_ST}`;
          continue;
        }
        const base64 = Buffer.from(image.data).toString("base64");
        for (let offset = 0; offset < base64.length; offset += KITTY_CHUNK_SIZE) {
          const payload = base64.slice(offset, offset + KITTY_CHUNK_SIZE);
          const more = offset + KITTY_CHUNK_SIZE < base64.length;
          const fields = [
            "a=T", "f=100", "t=d", ...placementFields, `m=${more ? 1 : 0}`,
          ];
          out += `${KITTY_APC}${fields.join(",")};${payload}${KITTY_ST}`;
        }
        this._transmittedKittyIds.add(image.id);
      }
      if (this.cursor && this.cursorVisible) out += this.move(this.cursor.y + 1, this.cursor.x + 1);
      this._shownKittySignature = kittySignature;
      this._shownKittyIds = [...new Set(this.kittyImages.map((image) => image.id))];
    }
    this.write(out);
    this.previous = this.cells.clone();
  }

  show() {
    this.Show();
  }

  setCursor(x, y, visible = true, shape = "block") {
    this.cursor = { x, y, shape };
    this.cursorVisible = visible;
  }

  setKittyImages(images = []) {
    this.kittyImages = this.kittyMode === "off" ? [] : images;
    logKittyPlacement("screen-frame-images", {
      count: this.kittyImages.length,
      kittyMode: this.kittyMode,
      images: this.kittyImages.map((image) => ({
        imageId: image.id,
        placementId: image.placementId ?? image.id,
        x: image.x,
        y: image.y,
        cols: image.cols,
        rows: image.rows,
        sourceX: image.sourceX ?? null,
        sourceY: image.sourceY ?? null,
        sourceWidth: image.sourceWidth ?? null,
        sourceHeight: image.sourceHeight ?? null,
      })),
    });
  }

  hideCursor() {
    this.cursorVisible = false;
    this.write("\x1b[?25l");
  }

  showCursor() {
    this.cursorVisible = true;
    this.write("\x1b[?25h");
  }

  move(row, col) {
    return `\x1b[${row};${col}H`;
  }

  clearToEndOfLine() {
    return "\x1b[K";
  }

  updateSize() {
    this.cols = process.stdout.columns || this.cols;
    this.rows = process.stdout.rows || this.rows;
    this.cells.resize(this.cols, this.rows);
    this.previous = null;
    this._shownKittySignature = "";
    return new ResizeEvent(this.cols, this.rows);
  }

  write(data) {
    process.stdout.write(data);
  }
}
