export class Cell {
  constructor(ch = " ", style = null, combining = [], filler = false) {
    this.ch = ch;
    this.style = style ? { ...style } : null;
    this.combining = [...combining];
    this.filler = filler; // right-half placeholder for a wide (double-width) character
    this.styleKey = styleKey(this.style);
  }

  equals(other) {
    return this.ch === other?.ch && this.styleKey === other?.styleKey && this.filler === other?.filler && arrayEquals(this.combining, other?.combining);
  }

  clone() {
    return new Cell(this.ch, this.style, this.combining, this.filler);
  }
}

export class CellBuffer {
  constructor(cols, rows, style = null) {
    this.cols = cols;
    this.rows = rows;
    this.cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => new Cell(" ", style)));
  }

  resize(cols, rows, style = null) {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.cells = Array.from({ length: rows }, (_, y) =>
      Array.from({ length: cols }, (_, x) => this.cells[y]?.[x] ?? new Cell(" ", style)));
  }

  setContent(x, y, ch, style = null, combining = [], filler = false) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    this.cells[y][x] = new Cell(ch, style, combining, filler);
  }

  setFiller(x, y, style = null) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    this.cells[y][x] = new Cell(" ", style, [], true);
  }

  getContent(x, y) {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return new Cell();
    return this.cells[y][x];
  }

  fill(ch = " ", style = null) {
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) this.setContent(x, y, ch, style);
    }
  }

  diff(previous) {
    const changes = [];
    for (let y = 0; y < this.rows; y++) {
      for (let x = 0; x < this.cols; x++) {
        const cell = this.getContent(x, y);
        if (!cell.equals(previous?.getContent(x, y))) changes.push({ x, y, cell });
      }
    }
    return changes;
  }

  clone() {
    const copy = new CellBuffer(this.cols, this.rows);
    copy.cells = this.cells.map((row) => row.map((cell) => cell.clone()));
    return copy;
  }
}

function styleKey(style) {
  if (!style) return "";
  return JSON.stringify(Object.keys(style).sort().map((key) => [key, style[key]]));
}

function arrayEquals(a = [], b = []) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}
