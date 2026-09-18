import assets from "./assets.tar" with { type: "file" };
import { getExeDirname, isCompiledBinary } from "./compiled.js";

const forceExternalAssets = process.argv.includes("--assets-external");
const debugAssetsLoader = Boolean(process.env.ASSETS_DEBUG);
if (forceExternalAssets) {
  const flagIndex = process.argv.indexOf("--assets-external");
  if (flagIndex >= 0) process.argv.splice(flagIndex, 1);
}

globalThis.internalAssets = forceExternalAssets ? null : Object.create(null);
globalThis.assetsLoaderPromise = main(process.argv).catch((error) => {
  console.error("# assets loader failed");
  console.error(error);
  return globalThis.internalAssets;
});

async function main(argv) { 

  if (forceExternalAssets &&
      !argv.includes("--assets-list") &&
      !argv.includes("--assets-extract")) {
    return null;
  }

  const startedAt = debugAssetsLoader ? Bun.nanoseconds() : 0;

  const tarball = await Bun.file(assets).bytes();
  const archive = new Bun.Archive(tarball);

  await cliEarlyExit(archive, argv);

  const files = await archive.files();
  const entries = [...files.entries()];
  const assetsByPath = Object.create(null);
  const errors = [];

  for (const [path, file] of entries) {
    try {
      assetsByPath[path] = await file.bytes();
    } catch (reason) {
      errors.push({ path, reason });
    }
  }

  if (errors.length > 0) {
    console.error(`# Failed to load ${errors.length} bundled asset(s):`);
    for (const { path, reason } of errors) {
      console.error(`- ${path}`);
      if (reason) {
        console.error(reason);
      }
    }
  }
  if (debugAssetsLoader) {
    const elapsedMs = (Bun.nanoseconds() - startedAt) / 1e6;
    console.error(`Loaded assets: ${elapsedMs.toFixed(3)} ms`);
  }

  globalThis.internalAssets = assetsByPath;
  return assetsByPath;
}

async function cliEarlyExit(archive, argv) {
  if (argv.includes("--assets-list")) {
    const files = await archive.files();
    for (const path of [...files.keys()].sort()) {
      console.log(path);
    }
    process.exit(0);
  }

  if (argv.includes("--assets-extract")) {
    if (isCompiledBinary())
    {
      const targetDir = getExeDirname();
      const extracted = await archive.extract(targetDir);
      console.log(`Extracted ${extracted} asset(s) to ${targetDir}`);
    }  //  if isCompiled
    else
      console.log("Assets extraction should only be used in a Bun compiled single-file executable");
      
    process.exit(0);
  }
}
