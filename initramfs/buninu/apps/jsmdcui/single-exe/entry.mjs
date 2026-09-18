#!/usr/bin/env bun

// 1. Injects assets to global.internalAssets
//   as { "./path/in/tar":file.bytes() }
// 2. Sets global.assetsLoaderPromise
// 3. Starts the main program only after the assets are ready
import "./assetsLoader.mjs";

//  Keep these as `await`, not `.then()`. Besides the sequencing, they are
//  the only top-level await this program writes anywhere, and `--bytecode`
//  reads exactly that to decide the program starts asynchronously. With
//  none written, the executable is evaluated synchronously, its suspended
//  startup is dropped, and it exits 0 having run nothing — no error, at any
//  size. Awaits the bundler generates for us do not count; see the README's
//  "The await in entry.mjs is load-bearing".
await globalThis.assetsLoaderPromise;
await import("../src/index.js");
