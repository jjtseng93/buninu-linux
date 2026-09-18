import { existsSync } from "node:fs";
import { readInternalAssetBytes } from "../../single-exe/assetsHelper.js";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { REPO_ROOT } from "../../single-exe/compiled.js";

export async function createLuaEngine() {
  let wasmoon = null;
  try {
    wasmoon = await import("wasmoon");
  } catch (error) {
    if (
      error?.code !== "ERR_MODULE_NOT_FOUND" &&
      !/Cannot find package/.test(String(error?.message))
    ) {
      throw error;
    }
  }
  if (!wasmoon?.LuaFactory) {
    throw new Error("Lua support requires the WASM runtime `wasmoon`. Install it with `bun add wasmoon`.");
  }

  const wasmLocation = await resolveLuaWasmLocation();
  const factory = new wasmoon.LuaFactory(wasmLocation);
  const lua = await factory.createEngine();
  return new WasmoonEngine(lua);
}

async function resolveLuaWasmLocation() {
  const wasmAssetPath = "runtime/wasmoon_glue.wasm";
  const wasmBytes = readInternalAssetBytes(wasmAssetPath);
  if (wasmBytes) {
    const wasmPath = join(tmpdir(), "bunmicro-wasmoon-glue.wasm");
    try {
      const existing = await Bun.file(wasmPath).bytes().catch(() => null);
      if (!existing || existing.byteLength !== wasmBytes.byteLength) {
        await Bun.write(wasmPath, wasmBytes);
      }
      return wasmPath;
    } catch (error) {
      console.error("# failed to stage bundled wasmoon wasm");
      console.error(error);
    }
  }

  const fallbackPath = join(REPO_ROOT, wasmAssetPath);

  return existsSync(fallbackPath) ? fallbackPath : undefined;
}

class WasmoonEngine {
  constructor(lua) {
    this.kind = "wasmoon";
    this.lua = lua;
  }

  async doString(source, chunkName = "chunk") {
    return this.lua.doString(source, chunkName);
  }

  setGlobal(name, value) {
    this.lua.global.set(name, value);
  }

  getGlobal(name) {
    return this.lua.global.get(name);
  }
}
