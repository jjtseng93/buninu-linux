import { appendFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export const KITTY_DEBUG_LOG = resolve(import.meta.dirname, "../..", "kitty-placement.log");
export const KITTY_DEBUG_ENABLED = /^(1|true|yes|on)$/i.test(
  String(process.env.JSMDCUI_KITTY_DEBUG ?? ""),
);

if (KITTY_DEBUG_ENABLED) {
  try {
    writeFileSync(KITTY_DEBUG_LOG, "");
  } catch {}
}

export function logKittyPlacement(stage, details = {}) {
  if (!KITTY_DEBUG_ENABLED) return;
  try {
    appendFileSync(KITTY_DEBUG_LOG, JSON.stringify({
      time: new Date().toISOString(),
      pid: process.pid,
      stage,
      ...details,
    }) + "\n");
  } catch {}
}
