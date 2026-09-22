// /lib/bunterm/glyphs.js — box drawing, block, shade, Powerline and legacy
// computing characters drawn as vectors instead of font glyphs, so they meet
// their neighbours exactly at every cell size.
//
// The shape tables are ported from xterm.js's addon-webgl CustomGlyphs.ts
// (Copyright (c) 2021 The xterm.js authors, MIT License; see /lib/xterm/
// LICENSE). The SVG-style path strings are kept as they are there; only the
// drawing side is rewritten for Skia.

// Block elements: rectangles on an 8x8 grid of the cell.
const blockElementDefinitions = {
  "▀": [{ x: 0, y: 0, w: 8, h: 4 }],
  "▁": [{ x: 0, y: 7, w: 8, h: 1 }],
  "▂": [{ x: 0, y: 6, w: 8, h: 2 }],
  "▃": [{ x: 0, y: 5, w: 8, h: 3 }],
  "▄": [{ x: 0, y: 4, w: 8, h: 4 }],
  "▅": [{ x: 0, y: 3, w: 8, h: 5 }],
  "▆": [{ x: 0, y: 2, w: 8, h: 6 }],
  "▇": [{ x: 0, y: 1, w: 8, h: 7 }],
  "█": [{ x: 0, y: 0, w: 8, h: 8 }],
  "▉": [{ x: 0, y: 0, w: 7, h: 8 }],
  "▊": [{ x: 0, y: 0, w: 6, h: 8 }],
  "▋": [{ x: 0, y: 0, w: 5, h: 8 }],
  "▌": [{ x: 0, y: 0, w: 4, h: 8 }],
  "▍": [{ x: 0, y: 0, w: 3, h: 8 }],
  "▎": [{ x: 0, y: 0, w: 2, h: 8 }],
  "▏": [{ x: 0, y: 0, w: 1, h: 8 }],
  "▐": [{ x: 4, y: 0, w: 4, h: 8 }],
  "▔": [{ x: 0, y: 0, w: 8, h: 1 }],
  "▕": [{ x: 7, y: 0, w: 1, h: 8 }],
  "▖": [{ x: 0, y: 4, w: 4, h: 4 }],
  "▗": [{ x: 4, y: 4, w: 4, h: 4 }],
  "▘": [{ x: 0, y: 0, w: 4, h: 4 }],
  "▙": [{ x: 0, y: 0, w: 4, h: 8 }, { x: 0, y: 4, w: 8, h: 4 }],
  "▚": [{ x: 0, y: 0, w: 4, h: 4 }, { x: 4, y: 4, w: 4, h: 4 }],
  "▛": [{ x: 0, y: 0, w: 4, h: 8 }, { x: 4, y: 0, w: 4, h: 4 }],
  "▜": [{ x: 0, y: 0, w: 8, h: 4 }, { x: 4, y: 0, w: 4, h: 8 }],
  "▝": [{ x: 4, y: 0, w: 4, h: 4 }],
  "▞": [{ x: 4, y: 0, w: 4, h: 4 }, { x: 0, y: 4, w: 4, h: 4 }],
  "▟": [{ x: 4, y: 0, w: 4, h: 8 }, { x: 0, y: 4, w: 8, h: 4 }],
  // Legacy computing: vertical and horizontal one eighth blocks
  "\u{1FB70}": [{ x: 1, y: 0, w: 1, h: 8 }],
  "\u{1FB71}": [{ x: 2, y: 0, w: 1, h: 8 }],
  "\u{1FB72}": [{ x: 3, y: 0, w: 1, h: 8 }],
  "\u{1FB73}": [{ x: 4, y: 0, w: 1, h: 8 }],
  "\u{1FB74}": [{ x: 5, y: 0, w: 1, h: 8 }],
  "\u{1FB75}": [{ x: 6, y: 0, w: 1, h: 8 }],
  "\u{1FB76}": [{ x: 0, y: 1, w: 8, h: 1 }],
  "\u{1FB77}": [{ x: 0, y: 2, w: 8, h: 1 }],
  "\u{1FB78}": [{ x: 0, y: 3, w: 8, h: 1 }],
  "\u{1FB79}": [{ x: 0, y: 4, w: 8, h: 1 }],
  "\u{1FB7A}": [{ x: 0, y: 5, w: 8, h: 1 }],
  "\u{1FB7B}": [{ x: 0, y: 6, w: 8, h: 1 }],
  "\u{1FB7C}": [{ x: 0, y: 0, w: 1, h: 8 }, { x: 0, y: 7, w: 8, h: 1 }],
  "\u{1FB7D}": [{ x: 0, y: 0, w: 1, h: 8 }, { x: 0, y: 0, w: 8, h: 1 }],
  "\u{1FB7E}": [{ x: 7, y: 0, w: 1, h: 8 }, { x: 0, y: 0, w: 8, h: 1 }],
  "\u{1FB7F}": [{ x: 7, y: 0, w: 1, h: 8 }, { x: 0, y: 7, w: 8, h: 1 }],
  "\u{1FB80}": [{ x: 0, y: 0, w: 8, h: 1 }, { x: 0, y: 7, w: 8, h: 1 }],
  "\u{1FB81}": [{ x: 0, y: 0, w: 8, h: 1 }, { x: 0, y: 2, w: 8, h: 1 }, { x: 0, y: 4, w: 8, h: 1 }, { x: 0, y: 7, w: 8, h: 1 }],
  "\u{1FB82}": [{ x: 0, y: 0, w: 8, h: 2 }],
  "\u{1FB83}": [{ x: 0, y: 0, w: 8, h: 3 }],
  "\u{1FB84}": [{ x: 0, y: 0, w: 8, h: 5 }],
  "\u{1FB85}": [{ x: 0, y: 0, w: 8, h: 6 }],
  "\u{1FB86}": [{ x: 0, y: 0, w: 8, h: 7 }],
  "\u{1FB87}": [{ x: 6, y: 0, w: 2, h: 8 }],
  "\u{1FB88}": [{ x: 5, y: 0, w: 3, h: 8 }],
  "\u{1FB89}": [{ x: 3, y: 0, w: 5, h: 8 }],
  "\u{1FB8A}": [{ x: 2, y: 0, w: 6, h: 8 }],
  "\u{1FB8B}": [{ x: 1, y: 0, w: 7, h: 8 }],
  "\u{1FB95}": [
    { x: 0, y: 0, w: 2, h: 2 }, { x: 4, y: 0, w: 2, h: 2 },
    { x: 2, y: 2, w: 2, h: 2 }, { x: 6, y: 2, w: 2, h: 2 },
    { x: 0, y: 4, w: 2, h: 2 }, { x: 4, y: 4, w: 2, h: 2 },
    { x: 2, y: 6, w: 2, h: 2 }, { x: 6, y: 6, w: 2, h: 2 },
  ],
  "\u{1FB96}": [
    { x: 2, y: 0, w: 2, h: 2 }, { x: 6, y: 0, w: 2, h: 2 },
    { x: 0, y: 2, w: 2, h: 2 }, { x: 4, y: 2, w: 2, h: 2 },
    { x: 2, y: 4, w: 2, h: 2 }, { x: 6, y: 4, w: 2, h: 2 },
    { x: 0, y: 6, w: 2, h: 2 }, { x: 4, y: 6, w: 2, h: 2 },
  ],
  "\u{1FB97}": [{ x: 0, y: 2, w: 8, h: 2 }, { x: 0, y: 6, w: 8, h: 2 }],
};

// Shade characters: a repeating pixel pattern (1 = filled).
const patternDefinitions = {
  "░": [[1, 0, 0, 0], [0, 0, 0, 0], [0, 0, 1, 0], [0, 0, 0, 0]],
  "▒": [[1, 0], [0, 0], [0, 1], [0, 0]],
  "▓": [[0, 1], [1, 1], [1, 0], [1, 1]],
};

const Shapes = {
  TOP_TO_BOTTOM: "M.5,0 L.5,1",
  LEFT_TO_RIGHT: "M0,.5 L1,.5",
  TOP_TO_RIGHT: "M.5,0 L.5,.5 L1,.5",
  TOP_TO_LEFT: "M.5,0 L.5,.5 L0,.5",
  LEFT_TO_BOTTOM: "M0,.5 L.5,.5 L.5,1",
  RIGHT_TO_BOTTOM: "M0.5,1 L.5,.5 L1,.5",
  MIDDLE_TO_TOP: "M.5,.5 L.5,0",
  MIDDLE_TO_LEFT: "M.5,.5 L0,.5",
  MIDDLE_TO_RIGHT: "M.5,.5 L1,.5",
  MIDDLE_TO_BOTTOM: "M.5,.5 L.5,1",
  T_TOP: "M0,.5 L1,.5 M.5,.5 L.5,0",
  T_LEFT: "M.5,0 L.5,1 M.5,.5 L0,.5",
  T_RIGHT: "M.5,0 L.5,1 M.5,.5 L1,.5",
  T_BOTTOM: "M0,.5 L1,.5 M.5,.5 L.5,1",
  CROSS: "M0,.5 L1,.5 M.5,0 L.5,1",
  TWO_DASHES_HORIZONTAL: "M.1,.5 L.4,.5 M.6,.5 L.9,.5",
  THREE_DASHES_HORIZONTAL: "M.0667,.5 L.2667,.5 M.4,.5 L.6,.5 M.7333,.5 L.9333,.5",
  FOUR_DASHES_HORIZONTAL: "M.05,.5 L.2,.5 M.3,.5 L.45,.5 M.55,.5 L.7,.5 M.8,.5 L.95,.5",
  TWO_DASHES_VERTICAL: "M.5,.1 L.5,.4 M.5,.6 L.5,.9",
  THREE_DASHES_VERTICAL: "M.5,.0667 L.5,.2667 M.5,.4 L.5,.6 M.5,.7333 L.5,.9333",
  FOUR_DASHES_VERTICAL: "M.5,.05 L.5,.2 M.5,.3 L.5,.45 L.5,.55 M.5,.7 L.5,.95",
};

const NORMAL = 1;
const BOLD = 3;

// Box drawing: per line weight, a path string or a function of the double
// line spacing (xp, yp) that returns one.
const S = Shapes;
const boxDrawingDefinitions = {
  "─": { [NORMAL]: S.LEFT_TO_RIGHT },
  "━": { [BOLD]: S.LEFT_TO_RIGHT },
  "│": { [NORMAL]: S.TOP_TO_BOTTOM },
  "┃": { [BOLD]: S.TOP_TO_BOTTOM },
  "┌": { [NORMAL]: S.RIGHT_TO_BOTTOM },
  "┏": { [BOLD]: S.RIGHT_TO_BOTTOM },
  "┐": { [NORMAL]: S.LEFT_TO_BOTTOM },
  "┓": { [BOLD]: S.LEFT_TO_BOTTOM },
  "└": { [NORMAL]: S.TOP_TO_RIGHT },
  "┗": { [BOLD]: S.TOP_TO_RIGHT },
  "┘": { [NORMAL]: S.TOP_TO_LEFT },
  "┛": { [BOLD]: S.TOP_TO_LEFT },
  "├": { [NORMAL]: S.T_RIGHT },
  "┣": { [BOLD]: S.T_RIGHT },
  "┤": { [NORMAL]: S.T_LEFT },
  "┫": { [BOLD]: S.T_LEFT },
  "┬": { [NORMAL]: S.T_BOTTOM },
  "┳": { [BOLD]: S.T_BOTTOM },
  "┴": { [NORMAL]: S.T_TOP },
  "┻": { [BOLD]: S.T_TOP },
  "┼": { [NORMAL]: S.CROSS },
  "╋": { [BOLD]: S.CROSS },
  "╴": { [NORMAL]: S.MIDDLE_TO_LEFT },
  "╸": { [BOLD]: S.MIDDLE_TO_LEFT },
  "╵": { [NORMAL]: S.MIDDLE_TO_TOP },
  "╹": { [BOLD]: S.MIDDLE_TO_TOP },
  "╶": { [NORMAL]: S.MIDDLE_TO_RIGHT },
  "╺": { [BOLD]: S.MIDDLE_TO_RIGHT },
  "╷": { [NORMAL]: S.MIDDLE_TO_BOTTOM },
  "╻": { [BOLD]: S.MIDDLE_TO_BOTTOM },
  // Double
  "═": { [NORMAL]: (xp, yp) => `M0,${.5 - yp} L1,${.5 - yp} M0,${.5 + yp} L1,${.5 + yp}` },
  "║": { [NORMAL]: (xp) => `M${.5 - xp},0 L${.5 - xp},1 M${.5 + xp},0 L${.5 + xp},1` },
  "╒": { [NORMAL]: (xp, yp) => `M.5,1 L.5,${.5 - yp} L1,${.5 - yp} M.5,${.5 + yp} L1,${.5 + yp}` },
  "╓": { [NORMAL]: (xp) => `M${.5 - xp},1 L${.5 - xp},.5 L1,.5 M${.5 + xp},.5 L${.5 + xp},1` },
  "╔": { [NORMAL]: (xp, yp) => `M1,${.5 - yp} L${.5 - xp},${.5 - yp} L${.5 - xp},1 M1,${.5 + yp} L${.5 + xp},${.5 + yp} L${.5 + xp},1` },
  "╕": { [NORMAL]: (xp, yp) => `M0,${.5 - yp} L.5,${.5 - yp} L.5,1 M0,${.5 + yp} L.5,${.5 + yp}` },
  "╖": { [NORMAL]: (xp) => `M${.5 + xp},1 L${.5 + xp},.5 L0,.5 M${.5 - xp},.5 L${.5 - xp},1` },
  "╗": { [NORMAL]: (xp, yp) => `M0,${.5 + yp} L${.5 - xp},${.5 + yp} L${.5 - xp},1 M0,${.5 - yp} L${.5 + xp},${.5 - yp} L${.5 + xp},1` },
  "╘": { [NORMAL]: (xp, yp) => `M.5,0 L.5,${.5 + yp} L1,${.5 + yp} M.5,${.5 - yp} L1,${.5 - yp}` },
  "╙": { [NORMAL]: (xp) => `M1,.5 L${.5 - xp},.5 L${.5 - xp},0 M${.5 + xp},.5 L${.5 + xp},0` },
  "╚": { [NORMAL]: (xp, yp) => `M1,${.5 - yp} L${.5 + xp},${.5 - yp} L${.5 + xp},0 M1,${.5 + yp} L${.5 - xp},${.5 + yp} L${.5 - xp},0` },
  "╛": { [NORMAL]: (xp, yp) => `M0,${.5 + yp} L.5,${.5 + yp} L.5,0 M0,${.5 - yp} L.5,${.5 - yp}` },
  "╜": { [NORMAL]: (xp) => `M0,.5 L${.5 + xp},.5 L${.5 + xp},0 M${.5 - xp},.5 L${.5 - xp},0` },
  "╝": { [NORMAL]: (xp, yp) => `M0,${.5 - yp} L${.5 - xp},${.5 - yp} L${.5 - xp},0 M0,${.5 + yp} L${.5 + xp},${.5 + yp} L${.5 + xp},0` },
  "╞": { [NORMAL]: (xp, yp) => `${S.TOP_TO_BOTTOM} M.5,${.5 - yp} L1,${.5 - yp} M.5,${.5 + yp} L1,${.5 + yp}` },
  "╟": { [NORMAL]: (xp) => `M${.5 - xp},0 L${.5 - xp},1 M${.5 + xp},0 L${.5 + xp},1 M${.5 + xp},.5 L1,.5` },
  "╠": { [NORMAL]: (xp, yp) => `M${.5 - xp},0 L${.5 - xp},1 M1,${.5 + yp} L${.5 + xp},${.5 + yp} L${.5 + xp},1 M1,${.5 - yp} L${.5 + xp},${.5 - yp} L${.5 + xp},0` },
  "╡": { [NORMAL]: (xp, yp) => `${S.TOP_TO_BOTTOM} M0,${.5 - yp} L.5,${.5 - yp} M0,${.5 + yp} L.5,${.5 + yp}` },
  "╢": { [NORMAL]: (xp) => `M0,.5 L${.5 - xp},.5 M${.5 - xp},0 L${.5 - xp},1 M${.5 + xp},0 L${.5 + xp},1` },
  "╣": { [NORMAL]: (xp, yp) => `M${.5 + xp},0 L${.5 + xp},1 M0,${.5 + yp} L${.5 - xp},${.5 + yp} L${.5 - xp},1 M0,${.5 - yp} L${.5 - xp},${.5 - yp} L${.5 - xp},0` },
  "╤": { [NORMAL]: (xp, yp) => `M0,${.5 - yp} L1,${.5 - yp} M0,${.5 + yp} L1,${.5 + yp} M.5,${.5 + yp} L.5,1` },
  "╥": { [NORMAL]: (xp) => `${S.LEFT_TO_RIGHT} M${.5 - xp},.5 L${.5 - xp},1 M${.5 + xp},.5 L${.5 + xp},1` },
  "╦": { [NORMAL]: (xp, yp) => `M0,${.5 - yp} L1,${.5 - yp} M0,${.5 + yp} L${.5 - xp},${.5 + yp} L${.5 - xp},1 M1,${.5 + yp} L${.5 + xp},${.5 + yp} L${.5 + xp},1` },
  "╧": { [NORMAL]: (xp, yp) => `M.5,0 L.5,${.5 - yp} M0,${.5 - yp} L1,${.5 - yp} M0,${.5 + yp} L1,${.5 + yp}` },
  "╨": { [NORMAL]: (xp) => `${S.LEFT_TO_RIGHT} M${.5 - xp},.5 L${.5 - xp},0 M${.5 + xp},.5 L${.5 + xp},0` },
  "╩": { [NORMAL]: (xp, yp) => `M0,${.5 + yp} L1,${.5 + yp} M0,${.5 - yp} L${.5 - xp},${.5 - yp} L${.5 - xp},0 M1,${.5 - yp} L${.5 + xp},${.5 - yp} L${.5 + xp},0` },
  "╪": { [NORMAL]: (xp, yp) => `${S.TOP_TO_BOTTOM} M0,${.5 - yp} L1,${.5 - yp} M0,${.5 + yp} L1,${.5 + yp}` },
  "╫": { [NORMAL]: (xp) => `${S.LEFT_TO_RIGHT} M${.5 - xp},0 L${.5 - xp},1 M${.5 + xp},0 L${.5 + xp},1` },
  "╬": { [NORMAL]: (xp, yp) => `M0,${.5 + yp} L${.5 - xp},${.5 + yp} L${.5 - xp},1 M1,${.5 + yp} L${.5 + xp},${.5 + yp} L${.5 + xp},1 M0,${.5 - yp} L${.5 - xp},${.5 - yp} L${.5 - xp},0 M1,${.5 - yp} L${.5 + xp},${.5 - yp} L${.5 + xp},0` },
  // Diagonal
  "╱": { [NORMAL]: "M1,0 L0,1" },
  "╲": { [NORMAL]: "M0,0 L1,1" },
  "╳": { [NORMAL]: "M1,0 L0,1 M0,0 L1,1" },
  // Mixed weight
  "╼": { [NORMAL]: S.MIDDLE_TO_LEFT, [BOLD]: S.MIDDLE_TO_RIGHT },
  "╽": { [NORMAL]: S.MIDDLE_TO_TOP, [BOLD]: S.MIDDLE_TO_BOTTOM },
  "╾": { [NORMAL]: S.MIDDLE_TO_RIGHT, [BOLD]: S.MIDDLE_TO_LEFT },
  "╿": { [NORMAL]: S.MIDDLE_TO_BOTTOM, [BOLD]: S.MIDDLE_TO_TOP },
  "┍": { [NORMAL]: S.MIDDLE_TO_BOTTOM, [BOLD]: S.MIDDLE_TO_RIGHT },
  "┎": { [NORMAL]: S.MIDDLE_TO_RIGHT, [BOLD]: S.MIDDLE_TO_BOTTOM },
  "┑": { [NORMAL]: S.MIDDLE_TO_BOTTOM, [BOLD]: S.MIDDLE_TO_LEFT },
  "┒": { [NORMAL]: S.MIDDLE_TO_LEFT, [BOLD]: S.MIDDLE_TO_BOTTOM },
  "┕": { [NORMAL]: S.MIDDLE_TO_TOP, [BOLD]: S.MIDDLE_TO_RIGHT },
  "┖": { [NORMAL]: S.MIDDLE_TO_RIGHT, [BOLD]: S.MIDDLE_TO_TOP },
  "┙": { [NORMAL]: S.MIDDLE_TO_TOP, [BOLD]: S.MIDDLE_TO_LEFT },
  "┚": { [NORMAL]: S.MIDDLE_TO_LEFT, [BOLD]: S.MIDDLE_TO_TOP },
  "┝": { [NORMAL]: S.TOP_TO_BOTTOM, [BOLD]: S.MIDDLE_TO_RIGHT },
  "┞": { [NORMAL]: S.RIGHT_TO_BOTTOM, [BOLD]: S.MIDDLE_TO_TOP },
  "┟": { [NORMAL]: S.TOP_TO_RIGHT, [BOLD]: S.MIDDLE_TO_BOTTOM },
  "┠": { [NORMAL]: S.MIDDLE_TO_RIGHT, [BOLD]: S.TOP_TO_BOTTOM },
  "┡": { [NORMAL]: S.MIDDLE_TO_BOTTOM, [BOLD]: S.TOP_TO_RIGHT },
  "┢": { [NORMAL]: S.MIDDLE_TO_TOP, [BOLD]: S.RIGHT_TO_BOTTOM },
  "┥": { [NORMAL]: S.TOP_TO_BOTTOM, [BOLD]: S.MIDDLE_TO_LEFT },
  "┦": { [NORMAL]: S.LEFT_TO_BOTTOM, [BOLD]: S.MIDDLE_TO_TOP },
  "┧": { [NORMAL]: S.TOP_TO_LEFT, [BOLD]: S.MIDDLE_TO_BOTTOM },
  "┨": { [NORMAL]: S.MIDDLE_TO_LEFT, [BOLD]: S.TOP_TO_BOTTOM },
  "┩": { [NORMAL]: S.MIDDLE_TO_BOTTOM, [BOLD]: S.TOP_TO_LEFT },
  "┪": { [NORMAL]: S.MIDDLE_TO_TOP, [BOLD]: S.LEFT_TO_BOTTOM },
  "┭": { [NORMAL]: S.RIGHT_TO_BOTTOM, [BOLD]: S.MIDDLE_TO_LEFT },
  "┮": { [NORMAL]: S.LEFT_TO_BOTTOM, [BOLD]: S.MIDDLE_TO_RIGHT },
  "┯": { [NORMAL]: S.MIDDLE_TO_BOTTOM, [BOLD]: S.LEFT_TO_RIGHT },
  "┰": { [NORMAL]: S.LEFT_TO_RIGHT, [BOLD]: S.MIDDLE_TO_BOTTOM },
  "┱": { [NORMAL]: S.MIDDLE_TO_RIGHT, [BOLD]: S.LEFT_TO_BOTTOM },
  "┲": { [NORMAL]: S.MIDDLE_TO_LEFT, [BOLD]: S.RIGHT_TO_BOTTOM },
  "┵": { [NORMAL]: S.TOP_TO_RIGHT, [BOLD]: S.MIDDLE_TO_LEFT },
  "┶": { [NORMAL]: S.TOP_TO_LEFT, [BOLD]: S.MIDDLE_TO_RIGHT },
  "┷": { [NORMAL]: S.MIDDLE_TO_TOP, [BOLD]: S.LEFT_TO_RIGHT },
  "┸": { [NORMAL]: S.LEFT_TO_RIGHT, [BOLD]: S.MIDDLE_TO_TOP },
  "┹": { [NORMAL]: S.MIDDLE_TO_RIGHT, [BOLD]: S.TOP_TO_LEFT },
  "┺": { [NORMAL]: S.MIDDLE_TO_LEFT, [BOLD]: S.TOP_TO_RIGHT },
  "┽": { [NORMAL]: `${S.TOP_TO_BOTTOM} ${S.MIDDLE_TO_RIGHT}`, [BOLD]: S.MIDDLE_TO_LEFT },
  "┾": { [NORMAL]: `${S.TOP_TO_BOTTOM} ${S.MIDDLE_TO_LEFT}`, [BOLD]: S.MIDDLE_TO_RIGHT },
  "┿": { [NORMAL]: S.TOP_TO_BOTTOM, [BOLD]: S.LEFT_TO_RIGHT },
  "╀": { [NORMAL]: `${S.LEFT_TO_RIGHT} ${S.MIDDLE_TO_BOTTOM}`, [BOLD]: S.MIDDLE_TO_TOP },
  "╁": { [NORMAL]: `${S.MIDDLE_TO_TOP} ${S.LEFT_TO_RIGHT}`, [BOLD]: S.MIDDLE_TO_BOTTOM },
  "╂": { [NORMAL]: S.LEFT_TO_RIGHT, [BOLD]: S.TOP_TO_BOTTOM },
  "╃": { [NORMAL]: S.RIGHT_TO_BOTTOM, [BOLD]: S.TOP_TO_LEFT },
  "╄": { [NORMAL]: S.LEFT_TO_BOTTOM, [BOLD]: S.TOP_TO_RIGHT },
  "╅": { [NORMAL]: S.TOP_TO_RIGHT, [BOLD]: S.LEFT_TO_BOTTOM },
  "╆": { [NORMAL]: S.TOP_TO_LEFT, [BOLD]: S.RIGHT_TO_BOTTOM },
  "╇": { [NORMAL]: S.MIDDLE_TO_BOTTOM, [BOLD]: `${S.MIDDLE_TO_TOP} ${S.LEFT_TO_RIGHT}` },
  "╈": { [NORMAL]: S.MIDDLE_TO_TOP, [BOLD]: `${S.LEFT_TO_RIGHT} ${S.MIDDLE_TO_BOTTOM}` },
  "╉": { [NORMAL]: S.MIDDLE_TO_RIGHT, [BOLD]: `${S.TOP_TO_BOTTOM} ${S.MIDDLE_TO_LEFT}` },
  "╊": { [NORMAL]: S.MIDDLE_TO_LEFT, [BOLD]: `${S.TOP_TO_BOTTOM} ${S.MIDDLE_TO_RIGHT}` },
  // Dashed
  "╌": { [NORMAL]: S.TWO_DASHES_HORIZONTAL },
  "╍": { [BOLD]: S.TWO_DASHES_HORIZONTAL },
  "┄": { [NORMAL]: S.THREE_DASHES_HORIZONTAL },
  "┅": { [BOLD]: S.THREE_DASHES_HORIZONTAL },
  "┈": { [NORMAL]: S.FOUR_DASHES_HORIZONTAL },
  "┉": { [BOLD]: S.FOUR_DASHES_HORIZONTAL },
  "╎": { [NORMAL]: S.TWO_DASHES_VERTICAL },
  "╏": { [BOLD]: S.TWO_DASHES_VERTICAL },
  "┆": { [NORMAL]: S.THREE_DASHES_VERTICAL },
  "┇": { [BOLD]: S.THREE_DASHES_VERTICAL },
  "┊": { [NORMAL]: S.FOUR_DASHES_VERTICAL },
  "┋": { [BOLD]: S.FOUR_DASHES_VERTICAL },
  // Curved
  "╭": { [NORMAL]: (xp, yp) => `M.5,1 L.5,${.5 + (yp / .15 * .5)} C.5,${.5 + (yp / .15 * .5)},.5,.5,1,.5` },
  "╮": { [NORMAL]: (xp, yp) => `M.5,1 L.5,${.5 + (yp / .15 * .5)} C.5,${.5 + (yp / .15 * .5)},.5,.5,0,.5` },
  "╯": { [NORMAL]: (xp, yp) => `M.5,0 L.5,${.5 - (yp / .15 * .5)} C.5,${.5 - (yp / .15 * .5)},.5,.5,0,.5` },
  "╰": { [NORMAL]: (xp, yp) => `M.5,0 L.5,${.5 - (yp / .15 * .5)} C.5,${.5 - (yp / .15 * .5)},.5,.5,1,.5` },
};

const FILL = 0;
const STROKE = 1;

// Powerline and private-use separators (https://github.com/powerline/fontpatcher).
// Line variants extend past the cell and are clipped so the line ends stay hidden.
const powerlineDefinitions = {
  "\u{E0A0}": { d: "M.3,1 L.03,1 L.03,.88 C.03,.82,.06,.78,.11,.73 C.15,.7,.2,.68,.28,.65 L.43,.6 C.49,.58,.53,.56,.56,.53 C.59,.5,.6,.47,.6,.43 L.6,.27 L.4,.27 L.69,.1 L.98,.27 L.78,.27 L.78,.46 C.78,.52,.76,.56,.72,.61 C.68,.66,.63,.67,.56,.7 L.48,.72 C.42,.74,.38,.76,.35,.78 C.32,.8,.31,.84,.31,.88 L.31,1 M.3,.5 L.03,.59 L.03,.09 L.3,.09 L.3,.655", type: FILL },
  "\u{E0A1}": { d: "M.7,.4 L.7,.47 L.2,.47 L.2,.03 L.355,.03 L.355,.4 L.705,.4 M.7,.5 L.86,.5 L.86,.95 L.69,.95 L.44,.66 L.46,.86 L.46,.95 L.3,.95 L.3,.49 L.46,.49 L.71,.78 L.69,.565 L.69,.5", type: FILL },
  "\u{E0A2}": { d: "M.25,.94 C.16,.94,.11,.92,.11,.87 L.11,.53 C.11,.48,.15,.455,.23,.45 L.23,.3 C.23,.25,.26,.22,.31,.19 C.36,.16,.43,.15,.51,.15 C.59,.15,.66,.16,.71,.19 C.77,.22,.79,.26,.79,.3 L.79,.45 C.87,.45,.91,.48,.91,.53 L.91,.87 C.91,.92,.86,.94,.77,.94 L.24,.94 M.53,.2 C.49,.2,.45,.21,.42,.23 C.39,.25,.38,.27,.38,.3 L.38,.45 L.68,.45 L.68,.3 C.68,.27,.67,.25,.64,.23 C.61,.21,.58,.2,.53,.2 M.58,.82 L.58,.66 C.63,.65,.65,.63,.65,.6 C.65,.58,.64,.57,.61,.56 C.58,.55,.56,.54,.52,.54 C.48,.54,.46,.55,.43,.56 C.4,.57,.39,.59,.39,.6 C.39,.63,.41,.64,.46,.66 L.46,.82 L.57,.82", type: FILL },
  "\u{E0B0}": { d: "M0,0 L1,.5 L0,1", type: FILL, rightPadding: 2 },
  "\u{E0B1}": { d: "M-1,-.5 L1,.5 L-1,1.5", type: STROKE, leftPadding: 1, rightPadding: 1 },
  "\u{E0B2}": { d: "M1,0 L0,.5 L1,1", type: FILL, leftPadding: 2 },
  "\u{E0B3}": { d: "M2,-.5 L0,.5 L2,1.5", type: STROKE, leftPadding: 1, rightPadding: 1 },
  "\u{E0B4}": { d: "M0,0 L0,1 C0.552,1,1,0.776,1,.5 C1,0.224,0.552,0,0,0", type: FILL, rightPadding: 1 },
  "\u{E0B5}": { d: "M.2,1 C.422,1,.8,.826,.78,.5 C.8,.174,0.422,0,.2,0", type: STROKE, rightPadding: 1 },
  "\u{E0B6}": { d: "M1,0 L1,1 C0.448,1,0,0.776,0,.5 C0,0.224,0.448,0,1,0", type: FILL, leftPadding: 1 },
  "\u{E0B7}": { d: "M.8,1 C0.578,1,0.2,.826,.22,.5 C0.2,0.174,0.578,0,0.8,0", type: STROKE, leftPadding: 1 },
  "\u{E0B8}": { d: "M-.5,-.5 L1.5,1.5 L-.5,1.5", type: FILL },
  "\u{E0B9}": { d: "M-.5,-.5 L1.5,1.5", type: STROKE, leftPadding: 1, rightPadding: 1 },
  "\u{E0BA}": { d: "M1.5,-.5 L-.5,1.5 L1.5,1.5", type: FILL },
  "\u{E0BC}": { d: "M1.5,-.5 L-.5,1.5 L-.5,-.5", type: FILL },
  "\u{E0BD}": { d: "M1.5,-.5 L-.5,1.5", type: STROKE, leftPadding: 1, rightPadding: 1 },
  "\u{E0BE}": { d: "M-.5,-.5 L1.5,1.5 L1.5,-.5", type: FILL },
};
powerlineDefinitions["\u{E0BB}"] = powerlineDefinitions["\u{E0BD}"];
powerlineDefinitions["\u{E0BF}"] = powerlineDefinitions["\u{E0B9}"];

export const hasCustomGlyph = (character) =>
  character in blockElementDefinitions
  || character in patternDefinitions
  || character in boxDrawingDefinitions
  || character in powerlineDefinitions;

// "M.5,0 L.5,1 C..." → [["M", .5, 0], ["L", .5, 1], ["C", ...]]
const parsePath = (instructions) => instructions.split(" ").map((instruction) => {
  const numbers = instruction.slice(1).split(",").map(Number);
  return [instruction[0], ...numbers];
}).filter((op) => op.length >= 3 && "MLC".includes(op[0]));

const parsedPaths = new Map();

const pathFor = (instructions) => {
  let ops = parsedPaths.get(instructions);
  if (!ops) {
    ops = parsePath(instructions);
    parsedPaths.set(instructions, ops);
  }
  return ops;
};

const clamp = (value, maximum) => Math.max(Math.min(value, maximum), 0);

// Scales 0–1 path coordinates to the cell. Box drawing coordinates snap to
// pixel centres (odd line widths) or pixel edges (even) so lines are crisp
// and meet the neighbouring cell without a seam.
const buildPath = (CanvasKit, ops, x, y, width, height, {
  snap = false, lineWidth = 1, leftPadding = 0, rightPadding = 0,
} = {}) => {
  const builder = new CanvasKit.PathBuilder();
  const drawWidth = width - leftPadding - rightPadding;
  const half = lineWidth % 2 ? 0.5 : 0;
  const translateX = (value) => {
    let result = value * drawWidth;
    if (snap && result !== 0) result = clamp(Math.round(result + half) - half, width);
    return result + x + leftPadding;
  };
  const translateY = (value) => {
    let result = value * height;
    if (snap && result !== 0) result = clamp(Math.round(result + half) - half, height);
    return result + y;
  };
  for (const op of ops) {
    if (op[0] === "M") builder.moveTo(translateX(op[1]), translateY(op[2]));
    else if (op[0] === "L") builder.lineTo(translateX(op[1]), translateY(op[2]));
    else if (op[0] === "C") {
      builder.cubicTo(translateX(op[1]), translateY(op[2]), translateX(op[3]), translateY(op[4]),
        translateX(op[5]), translateY(op[6]));
    }
  }
  const path = builder.detach();
  builder.delete();
  return path;
};

// Shade characters are a repeating image shader, one per (pattern, color).
const shaderCache = new Map();

const patternShader = (CanvasKit, pattern, color) => {
  const key = pattern.length + ":" + color.join(",");
  let entry = shaderCache.get(key);
  if (!entry) {
    const height = pattern.length;
    const width = pattern[0].length;
    const pixels = new Uint8Array(width * height * 4);
    for (let row = 0; row < height; row++) {
      for (let column = 0; column < width; column++) {
        const offset = (row * width + column) * 4;
        pixels[offset] = color[0];
        pixels[offset + 1] = color[1];
        pixels[offset + 2] = color[2];
        pixels[offset + 3] = pattern[row][column] ? 255 : 0;
      }
    }
    const image = CanvasKit.MakeImage({
      width, height,
      colorType: CanvasKit.ColorType.RGBA_8888,
      alphaType: CanvasKit.AlphaType.Unpremul,
      colorSpace: CanvasKit.ColorSpace.SRGB,
    }, pixels, width * 4);
    const shader = image.makeShaderOptions(CanvasKit.TileMode.Repeat, CanvasKit.TileMode.Repeat,
      CanvasKit.FilterMode.Nearest, CanvasKit.MipmapMode.None);
    entry = { image, shader };
    shaderCache.set(key, entry);
  }
  return entry.shader;
};

// Draws `character` into the cell at (x, y) if it has a vector definition.
// `paint` is a fill paint carrying the foreground colour; `color` is the
// same colour as [r, g, b] for the shade shader cache. `fontSize` scales the
// line widths: 1 px up to 23 px, then one more pixel per 12 px, the way
// xterm.js's Powerline glyphs scale. Returns false when the character is not
// a custom glyph and should come from a font.
export const drawCustomGlyph = (CanvasKit, canvas, character, x, y, width, height, fontSize, paint, color) => {
  const block = blockElementDefinitions[character];
  if (block) {
    const eighthX = width / 8;
    const eighthY = height / 8;
    for (const box of block) {
      canvas.drawRect(CanvasKit.XYWHRect(x + box.x * eighthX, y + box.y * eighthY,
        box.w * eighthX, box.h * eighthY), paint);
    }
    return true;
  }

  const pattern = patternDefinitions[character];
  if (pattern) {
    const shaded = new CanvasKit.Paint();
    shaded.setShader(patternShader(CanvasKit, pattern, color));
    canvas.drawRect(CanvasKit.XYWHRect(x, y, width, height), shaded);
    shaded.delete();
    return true;
  }

  const unit = Math.max(1, Math.floor(fontSize / 12));
  const box = boxDrawingDefinitions[character];
  if (box) {
    const stroke = paint.copy();
    stroke.setStyle(CanvasKit.PaintStyle.Stroke);
    stroke.setAntiAlias(false);
    for (const [weight, instructions] of Object.entries(box)) {
      const lineWidth = unit * Number(weight);
      stroke.setStrokeWidth(lineWidth);
      const resolved = typeof instructions === "function"
        ? instructions(0.15, 0.15 / height * width)
        : instructions;
      const path = buildPath(CanvasKit, pathFor(resolved), x, y, width, height, { snap: true, lineWidth });
      canvas.drawPath(path, stroke);
      path.delete();
    }
    stroke.delete();
    return true;
  }

  const powerline = powerlineDefinitions[character];
  if (powerline) {
    const lineWidth = fontSize / 12;
    const path = buildPath(CanvasKit, pathFor(powerline.d), x, y, width, height, {
      leftPadding: (powerline.leftPadding ?? 0) * lineWidth / 2,
      rightPadding: (powerline.rightPadding ?? 0) * lineWidth / 2,
    });
    canvas.save();
    canvas.clipRect(CanvasKit.XYWHRect(x, y, width, height), CanvasKit.ClipOp.Intersect, false);
    if (powerline.type === STROKE) {
      const stroke = paint.copy();
      stroke.setStyle(CanvasKit.PaintStyle.Stroke);
      stroke.setStrokeWidth(lineWidth);
      canvas.drawPath(path, stroke);
      stroke.delete();
    } else {
      canvas.drawPath(path, paint);
    }
    canvas.restore();
    path.delete();
    return true;
  }

  return false;
};
