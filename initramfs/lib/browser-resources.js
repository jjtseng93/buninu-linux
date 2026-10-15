// Distribution-owned startup hook: npm updates may replace the browser, but
// cannot replace this helper. Existing package resources are never overwritten.
import { lstatSync, mkdirSync, statSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const lstat = (path) => {
  try { return lstatSync(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
};

export function ensureBrowserResources(browser, systemRoot = "/") {
  const resources = [
    ["usr/lib/canvaskit", "lib/canvaskit"],
    ["usr/share/fonts", "usr/share/fonts"],
  ];
  for (const [local, shared] of resources) {
    const path = join(browser, local);
    if (lstat(path)) continue; // Includes symlinks: do not overwrite user data.
    const target = resolve(systemRoot, shared);
    if (!statSync(target).isDirectory()) throw new Error(`missing browser resources: ${target}`);
    mkdirSync(dirname(path), { recursive: true });
    try { symlinkSync(relative(dirname(path), target), path); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
  }
}

// Land keeps its own loader and notices; only the identical WASM is shared.
export function ensureLandResources(land, systemRoot = "/") {
  const path = join(land, "vendor/canvaskit/canvaskit.wasm");
  if (lstat(path)) return;
  const target = resolve(systemRoot, "lib/canvaskit/canvaskit.wasm");
  if (!statSync(target).isFile()) throw new Error(`missing compositor resource: ${target}`);
  mkdirSync(dirname(path), { recursive: true });
  try { symlinkSync(relative(dirname(path), target), path); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
}
