const BASIC = {
  black: 0,
  red: 1,
  green: 2,
  yellow: 3,
  blue: 4,
  magenta: 5,
  cyan: 6,
  white: 7,
  brightblack: 8,
  lightblack: 8,
  brightred: 9,
  lightred: 9,
  brightgreen: 10,
  lightgreen: 10,
  brightyellow: 11,
  lightyellow: 11,
  brightblue: 12,
  lightblue: 12,
  brightmagenta: 13,
  lightmagenta: 13,
  brightcyan: 14,
  lightcyan: 14,
  brightwhite: 15,
  lightwhite: 15,
};

export function styleToAnsi(style = {}) {
  const codes = [0];
  if (style.bold) codes.push(1);
  if (style.italic) codes.push(3);
  if (style.underline) codes.push(4);
  if (style.reverse) codes.push(7);
  codes.push(...colorCodes(style.fg, false));
  codes.push(...colorCodes(style.bg, true));
  return `\x1b[${codes.join(";")}m`;
}

export function resetStyle() {
  return "\x1b[0m";
}

export function styleResetTo(style = {}) {
  return resetStyle() + styleToAnsi(style);
}

function colorCodes(color, background) {
  if (color == null || color === "default") return [];
  const base = background ? 48 : 38;
  if (typeof color === "number") return [base, 5, color];
  const value = String(color).toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(value)) {
    const r = Number.parseInt(value.slice(1, 3), 16);
    const g = Number.parseInt(value.slice(3, 5), 16);
    const b = Number.parseInt(value.slice(5, 7), 16);
    return [base, 2, r, g, b];
  }
  if (value in BASIC) return [base, 5, BASIC[value]];
  return [];
}
