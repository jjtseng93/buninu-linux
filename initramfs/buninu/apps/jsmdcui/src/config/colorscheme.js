export const DEFAULT_STYLE = {
  fg: "default",
  bg: "default",
  bold: false,
  italic: false,
  reverse: false,
  underline: false,
};

const COLOR_LINK = /color-link\s+(\S*)\s+"(.*)"/;
const INCLUDE = /include\s+"(.*)"/;

export class Colorscheme {
  constructor(runtime) {
    this.runtime = runtime;
    this.styles = new Map();
    this.defaultStyle = { ...DEFAULT_STYLE };
  }

  async load(name = "default", parsed = new Set()) {
    const file = this.runtime.find(0, name);
    if (!file) throw new Error(`${name} is not a valid colorscheme`);
    parsed.add(name);
    const parsedStyles = await this.parse(name, await file.text(), parsed);
    this.styles = parsedStyles;
    return this;
  }

  async parse(name, text, parsed = new Set()) {
    const styles = new Map();
    for (const rawLine of String(text).split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const include = line.match(INCLUDE);
      if (include) {
        const includeName = include[1];
        if (!parsed.has(includeName)) {
          const file = this.runtime.find(0, includeName);
          if (!file) throw new Error(`${includeName} is not a valid colorscheme`);
          parsed.add(includeName);
          const includedStyles = await this.parse(includeName, await file.text(), parsed);
          for (const [key, value] of includedStyles) styles.set(key, value);
        }
        continue;
      }

      const match = line.match(COLOR_LINK);
      if (!match) throw new Error(`Color-link statement is not valid: ${rawLine}`);
      const style = stringToStyle(match[2], this.defaultStyle);
      styles.set(match[1], style);
      if (match[1] === "default") this.defaultStyle = style;
    }
    if (styles.has("default")) this.defaultStyle = styles.get("default");
    return styles;
  }

  get(group) {
    if (!group) return this.defaultStyle;
    const parts = String(group).split(".");
    let style = this.styles.get(group);
    if (parts.length > 1) {
      let cur = "";
      for (const part of parts) {
        cur = cur ? `${cur}.${part}` : part;
        if (this.styles.has(cur)) style = this.styles.get(cur);
      }
    }
    return style ?? stringToStyle(group, this.defaultStyle);
  }
}

export function stringToStyle(input, base = DEFAULT_STYLE) {
  const text = String(input);
  const colorPart = text.split(/\s+/).at(-1) ?? "";
  const [fgRaw = "default", bgRaw = "default"] = colorPart.split(",");
  return {
    fg: stringToColor(fgRaw.trim(), base.fg),
    bg: stringToColor(bgRaw.trim(), base.bg),
    bold: base.bold || text.includes("bold"),
    italic: base.italic || text.includes("italic"),
    reverse: base.reverse || text.includes("reverse"),
    underline: base.underline || text.includes("underline"),
  };
}

export function stringToColor(value, fallback = "default") {
  const color = String(value || "default").trim();
  if (color === "default" || color === "") return fallback;
  if (/^\d+$/.test(color)) return Number(color);
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  const names = new Set([
    "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
    "brightblack", "brightred", "brightgreen", "brightyellow", "brightblue",
    "brightmagenta", "brightcyan", "brightwhite", "lightblack", "lightred",
    "lightgreen", "lightyellow", "lightblue", "lightmagenta", "lightcyan", "lightwhite",
  ]);
  return names.has(color) ? color : fallback;
}
