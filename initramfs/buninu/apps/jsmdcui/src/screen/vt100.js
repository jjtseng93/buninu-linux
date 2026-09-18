// Minimal VT100/ANSI terminal emulator for the terminal pane.
// Maintains a cell grid and parses common escape sequences.

const ANSI_COLORS = [
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightblack", "brightred", "brightgreen", "brightyellow",
  "brightblue", "brightmagenta", "brightcyan", "brightwhite",
];

function blankCell() {
  return { ch: " ", combining: [], filler: false, fg: "default", bg: "default", bold: false, italic: false, underline: false, reverse: false };
}

function findCSIEnd(str, start) {
  for (let i = start; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 0x40 && c <= 0x7E) return i;  // final byte
    if (c < 0x20 && c !== 0x1b) return -1; // unexpected control
  }
  return -1; // incomplete
}

function toHex2(n) {
  return ((n ?? 0) & 0xFF).toString(16).padStart(2, "0");
}

function isZeroWidthCodePoint(cp) {
  return (
    cp === 0x200D ||
    (cp >= 0x0300 && cp <= 0x036F) ||
    (cp >= 0x1AB0 && cp <= 0x1AFF) ||
    (cp >= 0x1DC0 && cp <= 0x1DFF) ||
    (cp >= 0x20D0 && cp <= 0x20FF) ||
    (cp >= 0xFE00 && cp <= 0xFE0F) ||
    (cp >= 0xFE20 && cp <= 0xFE2F) ||
    (cp >= 0xE0100 && cp <= 0xE01EF)
  );
}

function isWideCodePoint(cp) {
  if (cp < 0x1100) return false;
  return (
    cp <= 0x115F ||
    cp === 0x2329 || cp === 0x232A ||
    (cp >= 0x2E80 && cp <= 0x303E) ||
    (cp >= 0x3040 && cp <= 0x33FF) ||
    (cp >= 0x3400 && cp <= 0x4DBF) ||
    (cp >= 0x4E00 && cp <= 0xA4C6) ||
    (cp >= 0xA960 && cp <= 0xA97C) ||
    (cp >= 0xAC00 && cp <= 0xD7A3) ||
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0xFE10 && cp <= 0xFE19) ||
    (cp >= 0xFE30 && cp <= 0xFE4F) ||
    (cp >= 0xFF01 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    (cp >= 0x1B000 && cp <= 0x1B0FF) ||
    (cp >= 0x1F004 && cp <= 0x1F0CF) ||
    (cp >= 0x1F18F && cp <= 0x1F19A) ||
    (cp >= 0x1F200 && cp <= 0x1F2FF) ||
    (cp >= 0x1F300 && cp <= 0x1FAFF) ||
    (cp >= 0x20000 && cp <= 0x2FFFD) ||
    (cp >= 0x30000 && cp <= 0x3FFFD)
  );
}

function charWidth(ch) {
  if (!ch) return 0;
  const cp = ch.codePointAt(0);
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0) || isZeroWidthCodePoint(cp)) return 0;
  return isWideCodePoint(cp) ? 2 : 1;
}

export class VT100 {
  constructor(cols, rows) {
    this.cols = Math.max(1, cols);
    this.rows = Math.max(1, rows);
    this.cells = [];
    this.cx = 0;
    this.cy = 0;
    this.wrapPending = false;
    this.savedCursor = { x: 0, y: 0 };
    this.scrollTop = 0;
    this.scrollBottom = this.rows - 1;
    this.sgr = { fg: "default", bg: "default", bold: false, italic: false, underline: false, reverse: false };
    this.pending = "";
    // scrollback
    this.scrollback = [];       // oldest first, each entry is a cols-length cell array
    this.maxScrollback = 500;
    this.scrollOffset = 0;      // 0 = live view; n = n rows scrolled back into history
    // mouse reporting: set by the application via ?1000h / ?1002h / ?1003h
    this.mouseMode = false;
    this.keyboardProtocolFlags = 0;
    this.keyboardProtocolStack = [];
    this.modifyOtherKeys = 0;
    this.formatOtherKeys = 0;
    this._initCells();
  }

  _initCells() {
    this.cells = Array.from({ length: this.cols * this.rows }, () => blankCell());
  }

  _idx(x, y) { return y * this.cols + x; }

  _cell(x, y) {
    if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return null;
    return this.cells[this._idx(x, y)];
  }

  _copyStyleTo(cell) {
    cell.fg = this.sgr.fg;
    cell.bg = this.sgr.bg;
    cell.bold = this.sgr.bold;
    cell.italic = this.sgr.italic;
    cell.underline = this.sgr.underline;
    cell.reverse = this.sgr.reverse;
  }

  _clearCellRaw(x, y) {
    const cell = this._cell(x, y);
    if (cell) Object.assign(cell, blankCell());
  }

  _breakWideAt(x, y) {
    const cell = this._cell(x, y);
    if (!cell) return;
    if (cell.filler) this._clearCellRaw(x - 1, y);
    if (x + 1 < this.cols && this._cell(x + 1, y)?.filler) this._clearCellRaw(x + 1, y);
  }

  _setCell(x, y, ch, width = 1) {
    if (width === 0) {
      const targetX = this.cx > 0 ? this.cx - 1 : 0;
      const cell = this._cell(targetX, this.cy);
      if (cell && !cell.filler) cell.combining.push(ch);
      return;
    }
    if (width > 1 && x >= this.cols - 1) {
      this.cx = 0;
      this._lineFeed();
      x = this.cx;
      y = this.cy;
    }
    this._breakWideAt(x, y);
    if (width > 1) this._breakWideAt(x + 1, y);
    const cell = this._cell(x, y);
    if (!cell) return;
    cell.ch = ch;
    cell.combining = [];
    cell.filler = false;
    this._copyStyleTo(cell);
    if (width > 1) {
      const filler = this._cell(x + 1, y);
      if (filler) {
        Object.assign(filler, blankCell());
        filler.filler = true;
        this._copyStyleTo(filler);
      }
    }
  }

  _clearCell(x, y) {
    this._breakWideAt(x, y);
    this._clearCellRaw(x, y);
  }

  _clearLineFrom(x, y) {
    for (let i = x; i < this.cols; i++) this._clearCell(i, y);
  }

  _clearLineTo(x, y) {
    for (let i = 0; i <= x; i++) this._clearCell(i, y);
  }

  _clearLine(y) {
    for (let i = 0; i < this.cols; i++) this._clearCell(i, y);
  }

  _scrollUp(n = 1) {
    for (let count = 0; count < n; count++) {
      // Save the line scrolling off the top into scrollback history
      const row = [];
      for (let x = 0; x < this.cols; x++) row.push({ ...this.cells[this._idx(x, this.scrollTop)] });
      this.scrollback.push(row);
      if (this.scrollback.length > this.maxScrollback) this.scrollback.shift();

      for (let y = this.scrollTop; y < this.scrollBottom; y++) {
        for (let x = 0; x < this.cols; x++) {
          this.cells[this._idx(x, y)] = { ...this.cells[this._idx(x, y + 1)] };
        }
      }
      this._clearLine(this.scrollBottom);
    }
  }

  // Adjust scrollback view. delta > 0 = scroll back (older), delta < 0 = scroll forward (newer).
  scroll(delta) {
    this.scrollOffset = Math.max(0, Math.min(this.scrollback.length, this.scrollOffset + delta));
  }

  _scrollDown(n = 1, fromRow = this.scrollTop) {
    for (let count = 0; count < n; count++) {
      for (let y = Math.min(this.scrollBottom, this.rows - 2); y >= fromRow; y--) {
        for (let x = 0; x < this.cols; x++) {
          this.cells[this._idx(x, y + 1)] = { ...this.cells[this._idx(x, y)] };
        }
      }
      this._clearLine(fromRow);
    }
  }

  _lineFeed() {
    this.wrapPending = false;
    if (this.cy < this.scrollBottom) {
      this.cy++;
    } else {
      this._scrollUp(1);
    }
  }

  _moveCursor(x, y) {
    this.cx = Math.min(this.cols - 1, Math.max(0, x));
    this.cy = Math.min(this.rows - 1, Math.max(0, y));
    this.wrapPending = false;
  }

  // Feed a chunk of terminal output. Returns array of response strings to send back.
  feed(text) {
    const data = this.pending + text;
    this.pending = "";
    const responses = [];
    let i = 0;

    while (i < data.length) {
      const ch = data[i];
      const code = data.charCodeAt(i);

      if (ch === "\x1b") {
        if (i + 1 >= data.length) { this.pending = data.slice(i); break; }
        const next = data[i + 1];

        if (next === "[") {
          // CSI
          const end = findCSIEnd(data, i + 2);
          if (end < 0) { this.pending = data.slice(i); break; }
          const params = data.slice(i + 2, end);
          const final = data[end];
          const resp = this._handleCSI(params, final);
          if (resp) responses.push(resp);
          i = end + 1;

        } else if (next === "]") {
          // OSC — find ST (\x1b\\) or BEL (\x07)
          const bel = data.indexOf("\x07", i + 2);
          const st  = data.indexOf("\x1b\\", i + 2);
          if (bel < 0 && st < 0) { this.pending = data.slice(i); break; }
          const endOSC = (bel >= 0 && (st < 0 || bel < st)) ? bel : st + 1;
          i = endOSC + 1;

        } else if (next === "7") {
          this.savedCursor = { x: this.cx, y: this.cy }; i += 2;
        } else if (next === "8") {
          this._moveCursor(this.savedCursor.x, this.savedCursor.y); i += 2;
        } else if (next === "M") {
          // Reverse index
          if (this.cy === this.scrollTop) this._scrollDown(1);
          else this._moveCursor(this.cx, this.cy - 1);
          i += 2;
        } else if (next === "(" || next === ")" || next === "*" || next === "+") {
          i += 3; // charset designation, skip designator
        } else if (next === "c") {
          // Full reset
          this._initCells(); this.cx = this.cy = 0;
          this.wrapPending = false;
          this.sgr = { fg: "default", bg: "default", bold: false, italic: false, underline: false, reverse: false };
          this.scrollTop = 0; this.scrollBottom = this.rows - 1;
          i += 2;
        } else if (next === "=") {
          i += 2; // application keypad mode, ignore
        } else if (next === ">") {
          i += 2; // normal keypad mode, ignore
        } else {
          i += 2; // unknown two-char escape
        }

      } else if (ch === "\r") {
        this.cx = 0; this.wrapPending = false; i++;
      } else if (ch === "\n" || ch === "\x0b" || ch === "\x0c") {
        this._lineFeed(); i++;
      } else if (ch === "\b") {
        if (this.wrapPending) this.wrapPending = false;
        else if (this.cx > 0) this.cx--;
        i++;
      } else if (ch === "\t") {
        this.cx = Math.min(this.cols - 1, (Math.floor(this.cx / 8) + 1) * 8); this.wrapPending = false; i++;
      } else if (ch === "\x07") {
        i++; // Bell: ignore
      } else if (ch === "\x0e" || ch === "\x0f") {
        i++; // SO/SI charset switch, ignore
      } else if (code >= 0x20) {
        // Printable
        const cp = data.codePointAt(i);
        const rune = String.fromCodePoint(cp);
        const width = charWidth(rune);
        if (width > 0 && this.wrapPending) {
          this.cx = 0;
          this._lineFeed();
        }
        this._setCell(this.cx, this.cy, rune, width);
        if (width > 0) {
          const nextX = this.cx + width;
          if (nextX >= this.cols) {
            this.cx = this.cols - 1;
            this.wrapPending = true;
          } else {
            this.cx = nextX;
            this.wrapPending = false;
          }
        }
        i += cp > 0xFFFF ? 2 : 1;
      } else {
        i++; // other control: skip
      }
    }

    return responses;
  }

  _handleCSI(params, final) {
    if (final === "u" && /^(?:[?<>]=?|=)/.test(params)) {
      return this._handleKeyboardProtocol(params);
    }

    // Check for private mode prefix
    const isPrivate = params.startsWith("?");
    const raw = isPrivate ? params.slice(1) : params;
    const parts = raw === "" ? [0] : raw.split(";").map(p => p === "" ? 0 : Number(p));
    const p1 = parts[0] ?? 0;
    const p2 = parts[1] ?? 0;

    switch (final) {
      case "A": this._moveCursor(this.cx, Math.max(this.scrollTop, this.cy - Math.max(1, p1))); break;
      case "B": this._moveCursor(this.cx, Math.min(this.scrollBottom, this.cy + Math.max(1, p1))); break;
      case "C": this._moveCursor(Math.min(this.cols - 1, this.cx + Math.max(1, p1)), this.cy); break;
      case "D": this._moveCursor(Math.max(0, this.cx - Math.max(1, p1)), this.cy); break;
      case "E": this._moveCursor(0, Math.min(this.rows - 1, this.cy + Math.max(1, p1))); break;
      case "F": this._moveCursor(0, Math.max(0, this.cy - Math.max(1, p1))); break;
      case "G": this._moveCursor(Math.min(this.cols - 1, Math.max(0, Math.max(1, p1) - 1)), this.cy); break;
      case "H":
        this._moveCursor(Math.max(0, Math.max(1, p2) - 1), Math.max(0, Math.max(1, p1) - 1));
        break;
      case "J":
        if (p1 === 0) {
          this._clearLineFrom(this.cx, this.cy);
          for (let y = this.cy + 1; y < this.rows; y++) this._clearLine(y);
        } else if (p1 === 1) {
          for (let y = 0; y < this.cy; y++) this._clearLine(y);
          this._clearLineTo(this.cx, this.cy);
        } else if (p1 === 2 || p1 === 3) {
          this._initCells(); this.cx = this.cy = 0;
        }
        break;
      case "K":
        if (p1 === 0) this._clearLineFrom(this.cx, this.cy);
        else if (p1 === 1) this._clearLineTo(this.cx, this.cy);
        else if (p1 === 2) this._clearLine(this.cy);
        break;
      case "L": this._scrollDown(Math.max(1, p1), this.cy); break;
      case "M": {
        const n = Math.max(1, p1);
        for (let i = 0; i < n; i++) {
          for (let y = this.cy; y < this.scrollBottom; y++) {
            for (let x = 0; x < this.cols; x++) {
              this.cells[this._idx(x, y)] = { ...this.cells[this._idx(x, y + 1)] };
            }
          }
          this._clearLine(this.scrollBottom);
        }
        break;
      }
      case "P": {
        const n = Math.max(1, p1);
        for (let x = this.cx; x < this.cols - n; x++)
          this.cells[this._idx(x, this.cy)] = { ...this.cells[this._idx(x + n, this.cy)] };
        for (let x = this.cols - n; x < this.cols; x++) this._clearCell(x, this.cy);
        break;
      }
      case "S": this._scrollUp(Math.max(1, p1)); break;
      case "T": this._scrollDown(Math.max(1, p1)); break;
      case "X": {
        const n = Math.max(1, p1);
        for (let x = this.cx; x < Math.min(this.cols, this.cx + n); x++) this._clearCell(x, this.cy);
        break;
      }
      case "d": this._moveCursor(this.cx, Math.min(this.rows - 1, Math.max(0, Math.max(1, p1) - 1))); break;
      case "f":
        if (params.startsWith(">")) this._handleXtermKeyFormat(raw);
        else {
          this._moveCursor(Math.max(0, Math.max(1, p2) - 1), Math.max(0, Math.max(1, p1) - 1));
        }
        break;
      case "m":
        if (params.startsWith(">")) this._handleXtermKeyModifier(raw);
        else this._handleSGR(parts);
        break;
      case "n":
        if (p1 === 6) return `\x1b[${this.cy + 1};${this.cx + 1}R`; // CPR
        if (p1 === 5) return "\x1b[0n"; // device status OK
        break;
      case "r":
        this.scrollTop    = Math.max(0, Math.max(1, p1) - 1);
        this.scrollBottom = Math.min(this.rows - 1, (p2 || this.rows) - 1);
        if (this.scrollTop >= this.scrollBottom) { this.scrollTop = 0; this.scrollBottom = this.rows - 1; }
        break;
      case "s": this.savedCursor = { x: this.cx, y: this.cy }; break;
      case "u":
        if (params === "") {
          this._moveCursor(this.savedCursor.x, this.savedCursor.y);
        }
        break;
      case "c":
        if (params === "" || p1 === 0) return "\x1b[?1;2c"; // primary device attributes
        break;
      case "h":
        if (isPrivate) {
          for (const n of parts) {
            if (n === 1000 || n === 1002 || n === 1003 || n === 1006) this.mouseMode = true;
          }
        }
        break;
      case "l":
        if (isPrivate) {
          for (const n of parts) {
            if (n === 1000 || n === 1002 || n === 1003 || n === 1006) this.mouseMode = false;
          }
        }
        break;
    }
    return null;
  }

  _handleKeyboardProtocol(params) {
    const parseNum = (value, fallback = 0) => {
      const n = Number(String(value ?? "").split(":")[0]);
      return Number.isFinite(n) ? n : fallback;
    };

    if (params === "?") return `\x1b[?${this.keyboardProtocolFlags}u`;
    if (params.startsWith("=")) {
      const parts = params.slice(1).split(";");
      const flags = parseNum(parts[0], 0);
      const mode = parseNum(parts[1], 1);
      if (mode === 2) this.keyboardProtocolFlags |= flags;
      else if (mode === 3) this.keyboardProtocolFlags &= ~flags;
      else this.keyboardProtocolFlags = flags;
      return null;
    }
    if (params.startsWith(">")) {
      const flags = parseNum(params.slice(1), 0);
      this.keyboardProtocolStack.push(this.keyboardProtocolFlags);
      if (this.keyboardProtocolStack.length > 32) this.keyboardProtocolStack.shift();
      this.keyboardProtocolFlags = flags;
      return null;
    }
    if (params.startsWith("<")) {
      const count = Math.max(1, parseNum(params.slice(1), 1));
      for (let i = 0; i < count; i++) {
        this.keyboardProtocolFlags = this.keyboardProtocolStack.length > 0 ? this.keyboardProtocolStack.pop() : 0;
      }
      return null;
    }
    return null;
  }

  _handleXtermKeyFormat(raw) {
    const parts = raw.slice(1).split(";").map(p => Number(p));
    const id = parts[0];
    const value = parts[1];
    if (id === 4) this.formatOtherKeys = Number.isFinite(value) ? value : 0;
  }

  _handleXtermKeyModifier(raw) {
    const parts = raw.slice(1).split(";").map(p => Number(p));
    const id = parts[0];
    const value = parts[1];
    if (id === 4) this.modifyOtherKeys = Number.isFinite(value) ? value : 0;
  }

  _handleSGR(parts) {
    if (parts.length === 0 || (parts.length === 1 && parts[0] === 0)) {
      this.sgr = { fg: "default", bg: "default", bold: false, italic: false, underline: false, reverse: false };
      return;
    }
    let i = 0;
    while (i < parts.length) {
      const n = parts[i];
      switch (true) {
        case n === 0:  this.sgr = { fg: "default", bg: "default", bold: false, italic: false, underline: false, reverse: false }; break;
        case n === 1:  this.sgr.bold = true; break;
        case n === 2:  break; // dim, ignore
        case n === 3:  this.sgr.italic = true; break;
        case n === 4:  this.sgr.underline = true; break;
        case n === 7:  this.sgr.reverse = true; break;
        case n === 21:
        case n === 22: this.sgr.bold = false; break;
        case n === 23: this.sgr.italic = false; break;
        case n === 24: this.sgr.underline = false; break;
        case n === 27: this.sgr.reverse = false; break;
        case n >= 30 && n <= 37: this.sgr.fg = ANSI_COLORS[n - 30]; break;
        case n === 38: {
          const mode = parts[i + 1];
          if (mode === 5) { this.sgr.fg = parts[i + 2] ?? 0; i += 2; }
          else if (mode === 2) {
            this.sgr.fg = `#${toHex2(parts[i+2])}${toHex2(parts[i+3])}${toHex2(parts[i+4])}`;
            i += 4;
          }
          break;
        }
        case n === 39: this.sgr.fg = "default"; break;
        case n >= 40 && n <= 47: this.sgr.bg = ANSI_COLORS[n - 40]; break;
        case n === 48: {
          const mode = parts[i + 1];
          if (mode === 5) { this.sgr.bg = parts[i + 2] ?? 0; i += 2; }
          else if (mode === 2) {
            this.sgr.bg = `#${toHex2(parts[i+2])}${toHex2(parts[i+3])}${toHex2(parts[i+4])}`;
            i += 4;
          }
          break;
        }
        case n === 49: this.sgr.bg = "default"; break;
        case n >= 90 && n <= 97:  this.sgr.fg = ANSI_COLORS[n - 90 + 8]; break;
        case n >= 100 && n <= 107: this.sgr.bg = ANSI_COLORS[n - 100 + 8]; break;
      }
      i++;
    }
  }

  resize(cols, rows) {
    cols = Math.max(1, cols);
    rows = Math.max(1, rows);
    const newCells = Array.from({ length: cols * rows }, () => blankCell());
    for (let y = 0; y < Math.min(rows, this.rows); y++) {
      for (let x = 0; x < Math.min(cols, this.cols); x++) {
        newCells[y * cols + x] = { ...this.cells[this._idx(x, y)] };
      }
    }
    this.cols = cols;
    this.rows = rows;
    this.cells = newCells;
    this.cx = Math.min(this.cx, cols - 1);
    this.cy = Math.min(this.cy, rows - 1);
    this.wrapPending = false;
    this.scrollTop = 0;
    this.scrollBottom = rows - 1;
  }

  getRow(y) {
    if (y < 0 || y >= this.rows) return Array.from({ length: this.cols }, blankCell);
    if (this.scrollOffset === 0) {
      return this.cells.slice(y * this.cols, (y + 1) * this.cols);
    }
    // Map view row y to virtual history + live combined buffer
    const histStart = this.scrollback.length - this.scrollOffset;
    const virtualY = histStart + y;
    if (virtualY < 0) return Array.from({ length: this.cols }, blankCell);
    if (virtualY < this.scrollback.length) return this.scrollback[virtualY];
    const liveY = virtualY - this.scrollback.length;
    if (liveY >= this.rows) return Array.from({ length: this.cols }, blankCell);
    return this.cells.slice(liveY * this.cols, (liveY + 1) * this.cols);
  }
}
