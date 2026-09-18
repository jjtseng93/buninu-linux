import { basename } from "node:path";
import { Loc } from "./loc.js";

export const BTDefault = { Kind: 0, Scratch: false, Readonly: false };
export const BTHelp = { Kind: 1, Scratch: true, Readonly: true };
export const BTLog = { Kind: 2, Scratch: true, Readonly: true };
export const BTScratch = { Kind: 3, Scratch: true, Readonly: false };
export const BTRaw = { Kind: 4, Scratch: true, Readonly: false };
export const BTInfo = { Kind: 5, Scratch: true, Readonly: true };

export class BufferCore {
  constructor({ text = "", path = "", type = BTDefault, settings = {} } = {}) {
    this.Path = path;
    this.AbsPath = path;
    this.Name = path ? basename(path) : "No name";
    this.Type = type;
    this.Settings = { filetype: "unknown", tabstospaces: false, tabsize: 4, ...settings };
    this.lines = normalizeText(text).split("\n");
    if (this.lines.length === 0) this.lines = [""];
    this.Messages = [];
    this.diffBase = "";
    this.modified = false;
  }

  Line(n) {
    return this.lines[n] ?? "";
  }

  LineBytes(n) {
    return new TextEncoder().encode(this.Line(n));
  }

  LinesNum() {
    return this.lines.length;
  }

  Size() {
    return new TextEncoder().encode(this.Bytes()).byteLength;
  }

  Bytes() {
    return this.lines.join("\n");
  }

  FileType() {
    return this.Settings.filetype ?? "unknown";
  }

  SetOption(option, value) {
    this.Settings[option] = parseOption(value);
  }

  DoSetOptionNative(option, value) {
    this.Settings[option] = value;
  }

  Insert(loc, text) {
    const pos = normalizeLoc(loc);
    const line = this.Line(pos.Y);
    const before = line.slice(0, pos.X);
    const after = line.slice(pos.X);
    const parts = normalizeText(text).split("\n");
    if (parts.length === 1) {
      this.lines[pos.Y] = before + parts[0] + after;
    } else {
      const replacement = [before + parts[0], ...parts.slice(1, -1), parts.at(-1) + after];
      this.lines.splice(pos.Y, 1, ...replacement);
    }
    this.modified = true;
  }

  Replace(start, end, text) {
    const s = normalizeLoc(start);
    const e = normalizeLoc(end);
    if (s.Y === e.Y) {
      const line = this.Line(s.Y);
      this.lines[s.Y] = line.slice(0, s.X) + text + line.slice(e.X);
    } else {
      const first = this.Line(s.Y).slice(0, s.X);
      const last = this.Line(e.Y).slice(e.X);
      const parts = normalizeText(text).split("\n");
      const replacement = parts.length === 1 ? [first + parts[0] + last] : [first + parts[0], ...parts.slice(1, -1), parts.at(-1) + last];
      this.lines.splice(s.Y, e.Y - s.Y + 1, ...replacement);
    }
    this.modified = true;
  }

  SetDiffBase(text) {
    this.diffBase = String(text);
  }

  AddMessage(message) {
    this.Messages.push(message);
  }

  ClearMessages(owner) {
    this.Messages = this.Messages.filter((message) => message.Owner !== owner);
  }

  ClearAllMessages() {
    this.Messages = [];
  }
}

export function byteOffset(pos, buffer) {
  const loc = normalizeLoc(pos);
  let offset = 0;
  for (let y = 0; y < loc.Y; y++) offset += buffer.Line(y).length + 1;
  return offset + buffer.Line(loc.Y).slice(0, loc.X).length;
}

function normalizeLoc(value) {
  if (value instanceof Loc) return value;
  return new Loc(value?.X ?? value?.x ?? 0, value?.Y ?? value?.y ?? 0);
}

function normalizeText(text) {
  return String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function parseOption(value) {
  if (value === "on" || value === "true") return true;
  if (value === "off" || value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(String(value))) return Number(value);
  return value;
}
