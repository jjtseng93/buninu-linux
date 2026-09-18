import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
//import { Glob } from "bun";
import { defaultAllSettings, OPTION_CHOICES, LOCAL_SETTINGS } from "./defaults.js";
import { isHex3Encoding, isMdcuiEncoding } from "../runtime/encodings.js";

export class Config {
  constructor({ configDir = "" } = {}) {
    this.configDir = configDir || defaultConfigDir();
    this.globalSettings = defaultAllSettings();
    this.volatileSettings = new Set();
    this.modifiedSettings = new Set();
    this.parsedSettings = {};
  }

  async init() {
    await mkdir(this.configDir, { recursive: true });
    await this.readSettings();
    return this;
  }

  async readSettings() {
    const path = join(this.configDir, "settings.json");
    if (!existsSync(path)) return;
    const text = await readFile(path, "utf8");
    if (text.trimStart().startsWith("null") || text.trim() === "") return;
    this.parsedSettings = Bun.JSON5.parse(text);
    // jsmdcui chooses the input encoding per invocation/buffer. A persisted
    // global encoding must neither affect startup nor survive the next save.
    delete this.parsedSettings.encoding;
    this.applyParsedSettings(this.parsedSettings);
  }

  applyCliSettings(settings) {
    for (const [key, raw] of settings) {
      if (!(key in this.globalSettings)) continue;
      this.setGlobalOptionNative(key, parseSetting(raw), { volatile: true });
    }
  }

  applyParsedSettings(parsed) {
    for (const [key, value] of Object.entries(parsed)) {
      if (key.startsWith("ft:")) continue;
      if (key.startsWith("glob:")) {
        //new Glob(key.slice(5));
        continue;
      }
      if (!(key in this.globalSettings)) continue;
      this.setGlobalOptionNative(key, normalizeSetting(key, value), { modified: false });
    }
  }

  registerCommonOption(plugin, option, value) {
    this.registerGlobalOption(`${plugin}.${option}`, value);
  }

  registerGlobalOption(option, value) {
    if (!(option in this.globalSettings)) this.globalSettings[option] = value;
    if (Object.hasOwn(this.parsedSettings, option)) {
      this.setGlobalOptionNative(option, normalizeSetting(option, this.parsedSettings[option]), { modified: false });
    }
  }

  getGlobalOption(option) {
    return this.globalSettings[option];
  }

  setGlobalOptionNative(option, value, { volatile = false, modified = true } = {}) {
    if (!(option in this.globalSettings)) throw new Error(`Invalid option: ${option}`);
    validateOption(option, value);
    this.globalSettings[option] = value;
    if (volatile) this.volatileSettings.add(option);
    if (modified) this.modifiedSettings.add(option);
  }

  async saveSettings() {
    const path = join(this.configDir, "settings.json");
    const out = { ...this.parsedSettings };
    for (const key of this.modifiedSettings) {
      if (!this.volatileSettings.has(key) && !LOCAL_SETTINGS.has(key)) out[key] = this.globalSettings[key];
    }
    // Remove any local-only settings that may have leaked into parsedSettings previously.
    for (const key of LOCAL_SETTINGS) delete out[key];
    await Bun.write(path, JSON.stringify(out, null, "    ") + "\n");
    this.parsedSettings = { ...out };
  }
}

export function defaultConfigDir() {
  if (process.env.MICRO_CONFIG_HOME) return process.env.MICRO_CONFIG_HOME;
  const xdg = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  return join(xdg, "micro");
}

export function parseSetting(value) {
  if (value === "true" || value === "on") return true;
  if (value === "false" || value === "off") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function normalizeSetting(key, value) {
  if (key === "autosave" && typeof value === "boolean") return value ? 8 : 0;
  return value;
}

function validateOption(option, value) {
  if (option === "encoding") {
    const encoding = String(value || "utf-8");
    if (isMdcuiEncoding(encoding)) return;
    if (isHex3Encoding(encoding)) return;
    try { new TextDecoder(encoding); }
    catch { throw new Error(`Invalid encoding: ${value}`); }
  }
  const choices = OPTION_CHOICES[option];
  if (choices && !choices.includes(value)) {
    throw new Error(`Invalid value for ${option}: ${value}`);
  }
  if (["autosave", "colorcolumn", "detectlimit", "pageoverlap", "scrollmargin", "scrollspeed"].includes(option) && Number(value) < 0) {
    throw new Error(`${option} must be non-negative`);
  }
  if (option === "tabsize" && Number(value) <= 0) throw new Error("tabsize must be positive");
}
