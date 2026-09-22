// /lib/bunterm/renderer.js — paints an xterm.js headless buffer onto a Skia
// canvas as a grid of cells.
//
// Every cell is placed by the renderer itself, never by a text layout: the
// primary monospace font sets the cell size, each character is looked up in
// the primary font and then the fallback fonts, and the glyph is centred in
// the one or two cells the terminal assigned it. Box drawing and block
// characters come from glyphs.js so they join seamlessly. Only rows whose
// content changed since the last frame are repainted.

import { drawCustomGlyph, hasCustomGlyph } from "./glyphs.js";

// xterm.js's default theme.
export const defaultTheme = {
  foreground: "#ffffff",
  background: "#000000",
  cursor: "#ffffff",
  ansi: [
    "#2e3436", "#cc0000", "#4e9a06", "#c4a000", "#3465a4", "#75507b", "#06989a", "#d3d7cf",
    "#555753", "#ef2929", "#8ae234", "#fce94f", "#729fcf", "#ad7fa8", "#34e2e2", "#eeeeec",
  ],
};

const parseColor = (hex) => [
  parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
];

// The 256-colour palette: 16 theme colours, a 6x6x6 cube and 24 greys.
export const buildPalette = (theme) => {
  const palette = theme.ansi.map(parseColor);
  const steps = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) palette.push([steps[r], steps[g], steps[b]]);
    }
  }
  for (let i = 0; i < 24; i++) {
    const level = 8 + i * 10;
    palette.push([level, level, level]);
  }
  return palette;
};

const packColor = ([r, g, b]) => (r << 16) | (g << 8) | b;
const unpackColor = (packed) => [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255];

// Code points that default to emoji presentation get the colour emoji
// fonts before the monochrome symbol fonts; everything else the reverse.
const emojiPresentation = /^\p{Emoji_Presentation}/u;
const isEmojiText = (text) => emojiPresentation.test(text) || text.includes("\uFE0F");

// A cell may hold a multi-code-point grapheme (a flag, a ZWJ sequence, a
// base with combining marks). Those need shaping, so they go through the
// Paragraph API; single code points are drawn as one glyph.
const isSingleCodePoint = (text) => {
  const first = text.codePointAt(0);
  return text.length === (first > 0xffff ? 2 : 1);
};

export class Renderer {
  constructor({ CanvasKit, screen, fonts, fontSize = 16, lineHeight = 1, theme = defaultTheme }) {
    this.CanvasKit = CanvasKit;
    this.screen = screen;
    this.canvas = screen.canvas;
    this.fonts = fonts;
    this.fontSize = fontSize;
    this.theme = theme;
    this.palette = buildPalette(theme);
    this.foreground = parseColor(theme.foreground);
    this.background = parseColor(theme.background);
    this.cursorColor = parseColor(theme.cursor);

    this.typefaceIds = new Map();
    this.fontCache = new Map();
    this.metricsCache = new Map();
    this.glyphCache = new Map();
    this.paragraphCache = new Map();
    this.paintCache = new Map();

    const regular = this.fontFor(fonts.regular, fontSize);
    const metrics = regular.getMetrics();
    const advance = regular.getGlyphWidths(fonts.regular.getGlyphIDs("M"))[0];
    this.cellWidth = Math.max(1, Math.round(advance));
    this.cellHeight = Math.max(1, Math.round((metrics.descent - metrics.ascent + (metrics.leading || 0)) * lineHeight));
    this.columns = Math.max(1, Math.floor(screen.width / this.cellWidth));
    this.rows = Math.max(1, Math.floor(screen.height / this.cellHeight));
    // The grid is centred; the margins keep the background colour.
    this.offsetX = Math.floor((screen.width - this.columns * this.cellWidth) / 2);
    this.offsetY = Math.floor((screen.height - this.rows * this.cellHeight) / 2);

    // Fallback typefaces split by kind so lookup order can depend on the text.
    this.monoFallback = [];
    this.colorFallback = [];
    fonts.names.slice(fonts.bold ? 2 : 1).forEach((name, index) => {
      const typeface = fonts.fallback[index];
      (name.includes("Emoji") ? this.colorFallback : this.monoFallback).push(typeface);
    });

    this.emojiFamilies = [
      ...fonts.families.filter((name) => name.includes("Emoji")),
      ...fonts.families.filter((name) => !name.includes("Emoji")),
    ];

    this.rowHashes = new Int32Array(this.rows).fill(0);
    this.forcedRows = new Set();
    this.dirtyAll = true;
    this.lastCursor = { x: -1, y: -1, visible: false };
  }

  fontFor(typeface, size, { bold = false, italic = false } = {}) {
    let id = this.typefaceIds.get(typeface);
    if (id === undefined) {
      id = this.typefaceIds.size;
      this.typefaceIds.set(typeface, id);
    }
    const key = `${id}:${size}:${bold ? "b" : ""}${italic ? "i" : ""}`;
    let font = this.fontCache.get(key);
    if (!font) {
      font = new this.CanvasKit.Font(typeface, size);
      font.setSubpixel(true);
      font.setEdging(this.CanvasKit.FontEdging.AntiAlias);
      if (bold) font.setEmbolden(true);
      if (italic) font.setSkewX(-0.2);
      this.fontCache.set(key, font);
    }
    return font;
  }

  metricsFor(font) {
    let metrics = this.metricsCache.get(font);
    if (!metrics) {
      metrics = font.getMetrics();
      this.metricsCache.set(font, metrics);
    }
    return metrics;
  }

  paintFor(color, alpha = 255) {
    const key = packColor(color) * 256 + alpha;
    let paint = this.paintCache.get(key);
    if (!paint) {
      paint = new this.CanvasKit.Paint();
      paint.setColor(this.CanvasKit.Color(color[0], color[1], color[2], alpha / 255));
      paint.setAntiAlias(true);
      this.paintCache.set(key, paint);
    }
    return paint;
  }

  // Finds the typeface holding `text` (a single code point) and its glyph.
  resolveGlyph(text, emoji) {
    const key = (emoji ? "e" : "m") + text;
    let entry = this.glyphCache.get(key);
    if (entry === undefined) {
      entry = null;
      const order = emoji
        ? [this.fonts.regular, ...this.colorFallback, ...this.monoFallback]
        : [this.fonts.regular, ...this.monoFallback, ...this.colorFallback];
      for (const typeface of order) {
        const id = typeface.getGlyphIDs(text, 1)[0];
        if (id) {
          entry = { typeface, glyph: id };
          break;
        }
      }
      this.glyphCache.set(key, entry);
    }
    return entry;
  }

  colorOf(cell, foreground) {
    const rgb = foreground ? cell.isFgRGB() : cell.isBgRGB();
    const palette = foreground ? cell.isFgPalette() : cell.isBgPalette();
    const value = foreground ? cell.getFgColor() : cell.getBgColor();
    if (rgb) return unpackColor(value);
    if (palette) {
      // Bold text in the eight base colours uses the bright variants.
      const index = foreground && cell.isBold() && value < 8 ? value + 8 : value;
      return this.palette[index] ?? this.foreground;
    }
    return foreground ? this.foreground : this.background;
  }

  rowHash(line, columns) {
    let hash = 0x811c9dc5 | 0;
    const mix = (value) => { hash = Math.imul(hash ^ value, 0x01000193); };
    for (let x = 0; x < columns; x++) {
      const cell = line.getCell(x);
      if (!cell) break;
      mix(cell.getCode());
      mix(cell.getChars().length);
      mix(cell.getWidth());
      mix(cell.getFgColor() ^ (cell.getFgColorMode() >>> 16));
      mix(cell.getBgColor() ^ (cell.getBgColorMode() >>> 16));
      mix(cell.isBold() | cell.isItalic() | cell.isDim() | cell.isUnderline()
        | cell.isInverse() | cell.isInvisible() | cell.isStrikethrough() | cell.isBlink());
    }
    return hash;
  }

  invalidate() {
    this.dirtyAll = true;
  }

  // Marks rows [start, end) for repainting even if their text is unchanged,
  // for image placements appearing or disappearing over them.
  invalidateRows(start, end) {
    for (let row = Math.max(0, start); row < Math.min(this.rows, end); row++) this.forcedRows.add(row);
  }

  cellRect(x, y, width = 1, height = 1) {
    return this.CanvasKit.XYWHRect(this.offsetX + x * this.cellWidth, this.offsetY + y * this.cellHeight,
      width * this.cellWidth, height * this.cellHeight);
  }

  drawText(text, x, y, cells, color, { bold, italic, emoji }) {
    const { CanvasKit, canvas } = this;
    const available = cells * this.cellWidth;
    const paint = this.paintFor(color);
    if (isSingleCodePoint(text)) {
      const entry = this.resolveGlyph(text, emoji);
      if (!entry) return;
      const primary = entry.typeface === this.fonts.regular;
      const typeface = primary && bold && this.fonts.bold ? this.fonts.bold : entry.typeface;
      const glyph = primary && bold && this.fonts.bold ? this.fonts.bold.getGlyphIDs(text, 1)[0] : entry.glyph;
      let font = this.fontFor(typeface, this.fontSize, { bold: bold && !primary, italic });
      let advance = font.getGlyphWidths([glyph])[0];
      // A fallback glyph wider than its cells (emoji, some symbols) is
      // scaled down to fit rather than overlapping its neighbour.
      if (advance > available + 0.5) {
        const size = Math.floor(this.fontSize * available / advance);
        font = this.fontFor(typeface, size, { bold: bold && !primary, italic });
        advance = font.getGlyphWidths([glyph])[0];
      }
      const metrics = this.metricsFor(font);
      const baseline = y + (this.cellHeight - (metrics.descent - metrics.ascent)) / 2 - metrics.ascent;
      canvas.drawGlyphs([glyph], [x + (available - advance) / 2, baseline], 0, 0, font, paint);
      return;
    }
    // Grapheme clusters are shaped by the Paragraph API and cached.
    const key = `${text}|${packColor(color)}|${bold ? 1 : 0}${italic ? 1 : 0}`;
    let paragraph = this.paragraphCache.get(key);
    if (!paragraph) {
      if (this.paragraphCache.size > 512) {
        for (const [oldKey, old] of this.paragraphCache) {
          old.delete();
          this.paragraphCache.delete(oldKey);
          if (this.paragraphCache.size <= 256) break;
        }
      }
      const style = new CanvasKit.ParagraphStyle({
        textStyle: {
          color: CanvasKit.Color(color[0], color[1], color[2]),
          fontFamilies: emoji ? this.emojiFamilies : this.fonts.families,
          fontSize: this.fontSize,
          fontStyle: {
            weight: bold ? CanvasKit.FontWeight.Bold : CanvasKit.FontWeight.Normal,
            slant: italic ? CanvasKit.FontSlant.Italic : CanvasKit.FontSlant.Upright,
          },
        },
        maxLines: 1,
      });
      const builder = CanvasKit.ParagraphBuilder.Make(style, this.fonts.fontMgr);
      builder.addText(text);
      paragraph = builder.build();
      builder.delete();
      paragraph.layout(available * 2 + this.fontSize * 2);
      this.paragraphCache.set(key, paragraph);
    }
    const width = paragraph.getLongestLine();
    const height = paragraph.getHeight();
    canvas.save();
    canvas.clipRect(CanvasKit.XYWHRect(x, y, available, this.cellHeight), CanvasKit.ClipOp.Intersect, false);
    if (width > available) {
      const scale = available / width;
      canvas.translate(x, y + (this.cellHeight - height * scale) / 2);
      canvas.scale(scale, scale);
      canvas.drawParagraph(paragraph, 0, 0);
    } else {
      canvas.drawParagraph(paragraph, x + (available - width) / 2, y + (this.cellHeight - height) / 2);
    }
    canvas.restore();
  }

  drawCell(cell, column, row) {
    const width = cell.getWidth();
    if (width === 0) return;
    const { CanvasKit, canvas } = this;
    let foreground = this.colorOf(cell, true);
    let background = this.colorOf(cell, false);
    if (cell.isInverse()) [foreground, background] = [background, foreground];
    const x = this.offsetX + column * this.cellWidth;
    const y = this.offsetY + row * this.cellHeight;
    if (packColor(background) !== packColor(this.background)) {
      canvas.drawRect(CanvasKit.XYWHRect(x, y, width * this.cellWidth, this.cellHeight), this.paintFor(background));
    }
    if (cell.isInvisible()) return;
    if (cell.isDim()) {
      foreground = foreground.map((channel, index) => Math.round((channel + background[index]) / 2));
    }
    const text = cell.getChars();
    const bold = Boolean(cell.isBold());
    const italic = Boolean(cell.isItalic());
    if (text && text !== " ") {
      if (hasCustomGlyph(text)) {
        drawCustomGlyph(CanvasKit, canvas, text, x, y, width * this.cellWidth, this.cellHeight,
          this.fontSize, this.paintFor(foreground), foreground);
      } else {
        this.drawText(text, x, y, width, foreground, { bold, italic, emoji: isEmojiText(text) });
      }
    }
    if (cell.isUnderline() || cell.isStrikethrough()) {
      const paint = this.paintFor(foreground);
      const thickness = Math.max(1, Math.floor(this.fontSize / 14));
      if (cell.isUnderline()) {
        canvas.drawRect(CanvasKit.XYWHRect(x, y + this.cellHeight - thickness - 1, width * this.cellWidth, thickness), paint);
      }
      if (cell.isStrikethrough()) {
        canvas.drawRect(CanvasKit.XYWHRect(x, y + Math.round(this.cellHeight * 0.55), width * this.cellWidth, thickness), paint);
      }
    }
  }

  drawRow(line, row) {
    const { canvas } = this;
    canvas.drawRect(this.cellRect(0, row, this.columns, 1), this.paintFor(this.background));
    if (!line) return;
    for (let column = 0; column < this.columns; column++) {
      const cell = line.getCell(column);
      if (!cell) break;
      this.drawCell(cell, column, row);
    }
  }

  drawCursor(line, x, y) {
    const { CanvasKit, canvas } = this;
    const cell = line?.getCell(x);
    const width = cell?.getWidth() || 1;
    const rect = this.cellRect(x, y, width, 1);
    canvas.drawRect(rect, this.paintFor(this.cursorColor));
    if (cell) {
      // Repaint the character in the background colour over the block.
      const text = cell.getChars();
      const left = this.offsetX + x * this.cellWidth;
      const top = this.offsetY + y * this.cellHeight;
      if (text && text !== " ") {
        if (hasCustomGlyph(text)) {
          drawCustomGlyph(CanvasKit, canvas, text, left, top, width * this.cellWidth, this.cellHeight,
            this.fontSize, this.paintFor(this.background), this.background);
        } else {
          this.drawText(text, left, top, width, this.background,
            { bold: Boolean(cell.isBold()), italic: Boolean(cell.isItalic()), emoji: isEmojiText(text) });
        }
      }
    }
  }

  // Repaints what changed and flushes to the framebuffer. `cursor` is
  // { x, y, visible }; `images` is a list of { image, rect } placements in
  // screen pixels, from images.js, drawn over the text. Returns true when
  // anything was painted.
  render(term, { cursor, images = [] } = {}) {
    const buffer = term.buffer.active;
    const top = buffer.viewportY;
    const dirty = [];
    for (let row = 0; row < this.rows; row++) {
      const line = buffer.getLine(top + row);
      const hash = line ? this.rowHash(line, this.columns) : 0;
      if (this.dirtyAll || hash !== this.rowHashes[row] || this.forcedRows.has(row)) {
        dirty.push(row);
        this.rowHashes[row] = hash;
      }
    }
    this.forcedRows.clear();
    const cursorRows = new Set();
    if (this.lastCursor.visible) cursorRows.add(this.lastCursor.y);
    if (cursor?.visible) cursorRows.add(cursor.y);
    for (const row of cursorRows) {
      if (row >= 0 && row < this.rows && !dirty.includes(row)) dirty.push(row);
    }
    if (this.dirtyAll) {
      this.canvas.clear(this.CanvasKit.Color(this.background[0], this.background[1], this.background[2]));
    }
    this.dirtyAll = false;
    if (!dirty.length) return false;
    dirty.sort((a, b) => a - b);
    for (const row of dirty) this.drawRow(buffer.getLine(top + row), row);
    if (cursor?.visible && cursor.y >= 0 && cursor.y < this.rows) {
      this.drawCursor(buffer.getLine(top + cursor.y), cursor.x, cursor.y);
    }
    this.lastCursor = { x: cursor?.x ?? -1, y: cursor?.y ?? -1, visible: Boolean(cursor?.visible) };
    if (images.length) this.drawImages(images, dirty);
    this.screen.flush();
    return true;
  }

  // Redraws the parts of image placements that intersect the repainted rows.
  drawImages(images, dirtyRows) {
    const { CanvasKit, canvas } = this;
    for (const { image, rect, source } of images) {
      const [left, top, right, bottom] = rect;
      const sourceRect = source ? CanvasKit.LTRBRect(...source) : CanvasKit.LTRBRect(0, 0, image.width(), image.height());
      for (const row of dirtyRows) {
        const rowTop = this.offsetY + row * this.cellHeight;
        const rowBottom = rowTop + this.cellHeight;
        if (bottom <= rowTop || top >= rowBottom) continue;
        canvas.save();
        canvas.clipRect(CanvasKit.LTRBRect(0, rowTop, this.screen.width, rowBottom), CanvasKit.ClipOp.Intersect, false);
        canvas.drawImageRectOptions(image, sourceRect, CanvasKit.LTRBRect(left, top, right, bottom),
          CanvasKit.FilterMode.Linear, CanvasKit.MipmapMode.Linear, null);
        canvas.restore();
      }
    }
  }

  delete() {
    for (const font of this.fontCache.values()) font.delete();
    for (const paint of this.paintCache.values()) paint.delete();
    for (const paragraph of this.paragraphCache.values()) paragraph.delete();
    this.fontCache.clear();
    this.paintCache.clear();
    this.paragraphCache.clear();
  }
}
