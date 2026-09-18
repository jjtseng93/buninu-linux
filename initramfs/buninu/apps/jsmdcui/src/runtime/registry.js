import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { assetPath, hasInternalAssets, listInternalAssetPaths, readInternalAssetBytes } from "../../single-exe/assetsHelper.js";

export const RTColorscheme = 0;
export const RTSyntax = 1;
export const RTHelp = 2;
export const RTPlugin = 3;
export const RTSyntaxHeader = 4;

export class RuntimeRegistry {
  constructor({ repoRoot, configDir }) {
    this.repoRoot = repoRoot;
    this.configDir = configDir;
    this.files = [[], [], [], [], []];
    this.realFiles = [[], [], [], [], []];
    this.fallbackFiles = [[], [], [], [], []];
  }

  async init({ user = true } = {}) {
    this.files = [[], [], [], [], []];
    this.realFiles = [[], [], [], [], []];
    this.fallbackFiles = [[], [], [], [], []];
    await this.addRuntimeKind(RTColorscheme, "colorschemes", ".micro", user);
    await this.addRuntimeKind(RTSyntax, "syntax", ".yaml", user);
    await this.addRuntimeKind(RTSyntaxHeader, "syntax", ".hdr", user);
    await this.addRuntimeKind(RTHelp, "help", ".md", user);
  }

  async addRuntimeKind(kind, dir, extension, user) {
    if (user) await this.addDirectory(kind, join(this.configDir, dir), extension, true);
    const internalPrefix = assetPath("runtime", dir);
    if (hasInternalAssets() && await this.addInternalDirectory(kind, internalPrefix, extension, false)) {
      return;
    }
    await this.addDirectory(kind, join(this.repoRoot, "runtime", dir), extension, false);
  }

  async addDirectory(kind, dir, extension, real) {
    if (!existsSync(dir)) return;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() || !entry.name.endsWith(extension)) continue;
      const file = new RuntimeFile(join(dir, entry.name), real);
      if (!real && this.realFiles[kind].some((f) => f.name === file.name)) {
        this.fallbackFiles[kind].push(file);
        continue;
      }
      this.files[kind].push(file);
      if (real) this.realFiles[kind].push(file);
    }
  }

  async addInternalDirectory(kind, prefix, extension, real) {
    const entries = listInternalAssetPaths(prefix);
    if (entries.length === 0) return false;

    const base = `${assetPath(prefix)}/`;
    let added = false;
    for (const path of entries) {
      const rel = path.slice(base.length);
      if (!rel || rel.includes("/")) continue;
      if (!rel.endsWith(extension)) continue;

      const data = readInternalAssetBytes(path);
      if (!data) continue;
      const file = new MemoryRuntimeFile(path, data);
      if (!real && this.realFiles[kind].some((f) => f.name === file.name)) {
        this.fallbackFiles[kind].push(file);
        continue;
      }
      this.files[kind].push(file);
      if (real) this.realFiles[kind].push(file);
      added = true;
    }
    return added;
  }

  addMemoryFile(kind, name, data) {
    this.files[kind].push(new MemoryRuntimeFile(name, data));
  }

  list(kind) {
    return this.files[kind] ?? [];
  }

  find(kind, name) {
    return this.list(kind).find((file) => file.name === name) ?? null;
  }

  fallback(kind, name) {
    return this.fallbackFiles[kind]?.find((file) => file.name === name) ?? null;
  }
}

class RuntimeFile {
  constructor(path, real) {
    this.path = path;
    this.real = real;
    this.name = basename(path, extname(path));
  }

  async data() {
    return readFile(this.path);
  }

  async text() {
    return readFile(this.path, "utf8");
  }
}

class MemoryRuntimeFile {
  constructor(name, data) {
    this.name = basename(name, extname(name));
    this.path = name;
    this.real = false;
    this._data = data;
  }

  async data() {
    if (this._data instanceof Uint8Array) return this._data;
    if (ArrayBuffer.isView(this._data)) {
      return new Uint8Array(this._data.buffer, this._data.byteOffset, this._data.byteLength);
    }
    if (this._data instanceof ArrayBuffer) return new Uint8Array(this._data);
    return new TextEncoder().encode(String(this._data));
  }

  async text() {
    if (typeof this._data === "string") return this._data;
    return new TextDecoder().decode(await this.data());
  }
}
