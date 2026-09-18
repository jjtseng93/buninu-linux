import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { join, dirname } from "node:path";
import { hasCommand, isLinuxLike, platformId, run } from "./commands.js";

export async function extractZip(zipPath, destDir) {
  await mkdir(destDir, { recursive: true });
  const platform = platformId();

  if (platform === "darwin" || platform === "win32") {
    await run(["tar", "-xf", zipPath, "-C", destDir]);
    return;
  }

  if (isLinuxLike()) {
    if (!hasCommand("unzip")) {
      throw new Error("Installing zip plugins requires `unzip`. Please install unzip first.");
    }
    await run(["unzip", "-q", zipPath, "-d", destDir]);
    return;
  }

  if (hasCommand("unzip")) {
    await run(["unzip", "-q", zipPath, "-d", destDir]);
    return;
  }

  throw new Error(`Unsupported platform for zip extraction: ${platform}`);
}

// Extract zip to destDir, stripping a single top-level prefix directory if present
// (matches Go micro behavior: zips containing e.g. autoclose-1.0.0/ are stripped).
export async function extractAndStrip(zipPath, destDir) {
  const tmpDir = destDir + ".__install_tmp__";
  await rm(tmpDir, { recursive: true, force: true });
  await extractZip(zipPath, tmpDir);

  const entries = await readdir(tmpDir, { withFileTypes: true });
  const subdirs = entries.filter((e) => e.isDirectory());
  const files = entries.filter((e) => e.isFile());

  await rm(destDir, { recursive: true, force: true });
  await mkdir(dirname(destDir), { recursive: true });

  if (subdirs.length === 1 && files.length === 0) {
    await rename(join(tmpDir, subdirs[0].name), destDir);
    await rm(tmpDir, { recursive: true, force: true });
  } else {
    await rename(tmpDir, destDir);
  }
}
