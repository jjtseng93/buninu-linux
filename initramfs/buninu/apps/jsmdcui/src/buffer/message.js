import { Loc } from "./loc.js";

export const MTInfo = 0;
export const MTWarning = 1;
export const MTError = 2;

export class BufferMessage {
  constructor(owner, msg, start, end, kind) {
    this.Owner = owner;
    this.Msg = msg;
    this.Start = start;
    this.End = end;
    this.Kind = kind;
  }
}

export function newMessage(owner, msg, start, end, kind) {
  return new BufferMessage(owner, msg, normalizeLoc(start), normalizeLoc(end), kind);
}

export function newMessageAtLine(owner, msg, line, kind) {
  const pos = new Loc(-1, Number(line) - 1);
  return newMessage(owner, msg, pos, pos, kind);
}

function normalizeLoc(value) {
  if (value instanceof Loc) return value;
  return new Loc(value?.X ?? value?.x ?? 0, value?.Y ?? value?.y ?? 0);
}
