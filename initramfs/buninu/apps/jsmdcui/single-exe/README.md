# Single-file executable bootstrap

Bundles a project's runtime assets into one `bun build --compile` binary, so
the executable carries its own `demos/`, `runtime/`, templates and so on.

Assets are declared once, in `package.json`:

```json
{
  "assets": ["demos", "runtime", "README.md", "src/cui/server.mjs"]
}
```

Paths are relative to the project root. Folders are packed recursively; only
regular files are stored, so symlinks and empty folders leave no trace.

## The two back ends

The default packs everything into a gzipped `assets.tar` that is embedded as a
single file and unpacked into memory at startup. Setting `ASSETS_BUNFS=1` at
build time switches to `bun build --compile --asset`, which stores the files
individually inside the binary's virtual filesystem instead.

Reading code never sees the difference — `assetsHelper` answers the same keys
either way. The trade is binary size against startup cost:

| | tar (default) | `ASSETS_BUNFS=1` |
| --- | --- | --- |
| Stored as | one gzipped archive | individual files, uncompressed |
| Size, for jsgotty's 3.45 MB of assets | **0.70 MB** | 3.45 MB |
| Work before `main` runs | decode the archive, copy every file into memory | **none** |
| Startup cost, same assets | ~16 ms | **0 ms** |
| Resident memory | whole payload, always | only what is read |
| Maturity | in use | experimental |

Text compresses well, so the tar usually wins on size by a wide margin — the
numbers above are mostly one 1.6 MB bundle and its source map. What it costs is
paid on every run, whether or not the program touches a single asset. Reach for
`ASSETS_BUNFS=1` when that startup work, or holding the whole payload in memory,
matters more than the extra megabytes on disk.

## Adopting it in another project

Copy `single-exe/` to the project root. Nothing inside it hard-codes its own
name or depth, so it can be renamed or moved — but the importing code has to
follow, so staying at the root is the easy path. Three edits point it at the
project around it.

1. **`assetsPacker.js`, the first two lines.** They are the only place the
   asset root is written down, and a static import specifier cannot be
   computed, so both must be literal:

   ```js
   import pkg from "../package.json" with { type: "json" };
   export const ASSETS_ROOT = "..";
   ```

2. **`entry.mjs`, the import of the program.** It names what to start, and
   entry.mjs is the compiled entry point in both back ends:

   ```js
   await import("../src/index.js");
   ```

   **Keep the `await`.** It reads like a formality — nothing here needs the
   module object — but together with the `await globalThis.assetsLoaderPromise`
   line above it, it is the only top-level `await` the compiled program writes
   anywhere, and `--bytecode` reads exactly that to decide the program starts
   asynchronously. Turn both into `.then(…)` and the build produces an
   executable that exits 0 without running a line.
   [Why](#the-await-in-entrymjs-is-load-bearing) explains the trap.

3. **`package.json`.** Add the `assets` array shown above.

Everything else — `compiled.js`, `assetsHelper.js`, `assetsLoader.mjs` — is
project independent, with one exception: `buildHtmlBundleImageMap` defaults its
attribute name to jsmdcui's `data-mdcui-src`, so pass your own.

Node's own entry path must not import `assetsLoader.mjs` or `entry.mjs`; those
are Bun only. `assetsHelper.js` and `compiled.js` run under Node 20.11+.

## Reading assets

Import from `assetsHelper.js`. Keys are the same package-relative paths that
appear in `package.json`.

| Function | Returns |
| --- | --- |
| `readInternalAssetText(path)` | string, or `null` when not embedded |
| `readInternalAssetBytes(path)` | `Uint8Array`, or `null` |
| `readAssetText(path)` | string, falling back to the file on disk |
| `readAssetBytes(path)` | `Uint8Array`, same fallback |
| `hasInternalAssets()` | whether this package has anything embedded |
| `listInternalAssetPaths(prefix?)` | every embedded path under `prefix` |
| `listInternalAssetDirs(prefix?)` | the immediate child names under `prefix` |
| `assetPath(...parts)` | joins parts into a key |
| `getAssetKey(path)` | the key as stored, namespace included |
| `assetDiskPath(path)` | where the disk fallback reads that key from |
| `SELF` | this package's namespace, `assets/<name>@<version>` |

The read functions are synchronous for embedded assets on both back ends.
`readAssetText` / `readAssetBytes` are async only because of the disk
fallback, which is what makes the same code work from a source checkout.

**Only the read functions fall back to disk.** The listing functions report
what is embedded and nothing else, so from a source checkout they return an
empty array. Branch on `hasInternalAssets()` and read the directory yourself:

```js
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readAssetText, hasInternalAssets, listInternalAssetDirs } from "../single-exe/assetsHelper.js";
import { REPO_ROOT } from "../single-exe/compiled.js";

//  Embedded or on disk, this one already works either way.
const page = await readAssetText("templates/page.html");

//  Listing does not, so pick the source.
const demos = hasInternalAssets()
  ? listInternalAssetDirs("demos")
  : readdirSync(join(REPO_ROOT, "demos"));
```

## Building

`compiled.js` exports the build entry points. Wire `buildEarlyExit` into the
CLI and it handles `--build-exe` and `--build-for <target>`:

```js
import { buildEarlyExit, IS_COMPILED, REPO_ROOT } from "./single-exe/compiled.js";

await buildEarlyExit(process.argv, "myapp");
```

`REPO_ROOT` is the project root in a checkout and the executable's own folder
once compiled, which is where `--assets-extract` writes. `IS_COMPILED` tells
the two apart.

### Chaining file/folder assets across dependencies

A build first bundles once to write a metafile, then treats every
`assetsPacker.js` appearing in its `inputs` as a participant. Each package
vendors its own `single-exe/`, and its `assetsHelper` imports its
`assetsPacker`, so a packer lands in that graph exactly when the package is
reachable from the entry point. There is no registration step, and anything
tree-shaken away brings nothing with it.

The packers then run one after another, each adding its files under its own
`assets/<name>@<version>/` namespace — appending into the shared `assets.tar`
by default, or copying into the shared `build/assets` tree under
`ASSETS_BUNFS=1`. Only once every packer has finished does the real compile
run, so the archive is complete and, by default, compressed by then.

That namespace is why `ASSETS_BUNFS=1` stages every package into one fixed
`build/assets`. `--asset` keeps only the **basename** of the path it is given
and preserves everything below it, so the folder's own name becomes the root
inside the binary:

```
--asset ./build/assets   with   build/assets/jsgotty@1.1.6/static/index.html
                          ->    assets/jsgotty@1.1.6/static/index.html
```

Pass `./build/assets/jsgotty@1.1.6` instead and `build/assets/` is gone: the
files land at `jsgotty@1.1.6/...` and every package gets its own root. One
folder named `assets`, everyone copying into it, is what makes the keys come
out the same as the ones the tar back end writes.

`assetsPacker.js` also runs standalone; `--help` documents its flags.

## Why the loader hands over a Promise

`entry.mjs` imports `assetsLoader.mjs`, awaits `globalThis.assetsLoaderPromise`,
and only then imports the main program. The indirection is deliberate: the
loader carries a Bun-only import,

```js
import assets from "./assets.tar" with { type: "file" };
```

and if the main program imported the loader, that dependency would land in its
module graph. Node could then no longer load the program at all — not even to
fall back to reading the assets from disk.

Keeping the loader behind `entry.mjs` means the main program never mentions it,
so Node 20.11+ runs the same file directly against on-disk assets while Bun
runs it through the bootstrap. The Promise is that boundary, not a workaround
for missing top-level await.

`ASSETS_BUNFS=1` sidesteps the question: there is no tar to load, so the build
writes `.bunfs-entry.mjs` next to `entry.mjs` — the same file with the loader
import removed — compiles that, and deletes it afterwards. A copy rather than a
stub, because entry.mjs may do more than import the program: a CommonJS main
that starts itself from `require.main === module` needs the exported starter
called instead, and that call has to survive.

## The `await` in entry.mjs is load-bearing

`--bytecode` decides whether a program starts asynchronously by looking for a
top-level `await` **written in some file's own source**. The bundler moves a
module into a lazy init function whenever something dynamically imports it, and
a module moved that way takes its top-level `await` with it — what stays behind
is an `await init_x()` the bundler wrote itself, which does not count. If no
file wrote one, the executable is evaluated on the synchronous path, its
suspended startup is dropped, and it exits 0 having run nothing. No error, at
any `--minify` setting, however small the program.

`entry.mjs` is immune because it writes two of its own:

```js
await globalThis.assetsLoaderPromise;
await import("../src/index.js");
```

One is enough, and every other `await` in the graph — all of
`assetsLoader.mjs`'s, for one — sits inside a function and cannot help. Turn
both of these into `.then(…)` and the flag is gone. It is also why bunfs builds
compile a copy of this file rather than handing the main program to `bun build`
directly: a main program that reaches top-level await only through its imports
writes none of its own.

Upstream: `src/bundler/linker_context/postProcessJSChunk.rs` skips exactly the
modules the bundler moved, still true on oven-sh/bun `main` at 8eb5b6e2b5
(2026-08-22). Until that changes, treat both `await`s as API.

## Environment variables

| Variable | When | Effect |
| --- | --- | --- |
| `ASSETS_BUNFS=1` | build | use `--asset` instead of the tar |
| `ASSETS_NO_GZIP=1` | build | leave `assets.tar` uncompressed |
| `ASSETS_DEBUG=1` | run | print how long unpacking took |

## Runtime flags

| Flag | Effect |
| --- | --- |
| `--assets-list` | print every embedded path and exit |
| `--assets-extract` | write the assets next to the executable and exit |
| `--assets-external` | ignore embedded assets and read from disk |

These are handled by `assetsLoader.mjs`, so they exist in tar builds only.

## Advanced usage

### Forwarding arguments to `bun build`

Anything after `--build-exe`, or after the target given to `--build-for`, is
passed straight through to `bun build`:

```shell
bun ./src/index.js --build-exe --sourcemap
bun ./src/index.js --build-for bun-linux-x64 --sourcemap
```

Order matters. The flags have to come after the build switch, or Bun consumes
them before the program ever starts:

```shell
# Wrong: Bun parses this define before any of your code runs
bun --define MY_APP=../app.md ./src/index.js --build-exe

# Right
bun ./src/index.js --build-exe --define MY_APP=../app.md
```

### `--define` with a string value

**Bun expects `--define` values to be JSON literals, so a string has to arrive
already quoted.** A bare path is read as an identifier and the build fails or
inlines something unintended. Quoting it through a shell is awkward, so
`compiled.js` exports a helper that does it:

```js
import { buildEarlyExit, stringifyNonPrimitiveDefineValues } from "./single-exe/compiled.js";

stringifyNonPrimitiveDefineValues(process.argv, "MY_APP");
await buildEarlyExit(process.argv, "my-bin");
```

Call it before `buildEarlyExit`, once per define name you want treated as a
string. It rewrites the value in place:

```js
["--define", "MY_APP=../app.md"]      // what the user typed
["--define", 'MY_APP="../app.md"']    // what Bun receives
```

`--define=MY_APP=../app.md` works the same way. Numbers, booleans, `null` and
`undefined` are left alone, so only genuine strings get quoted.

### Images from an imported HTML bundle

A compiled binary exposes an imported HTML entry as a `homepage` object:
`homepage.index` is the compiled HTML and `homepage.files` lists the
content-hashed assets by their path inside the binary. `assetsHelper` can map
the *original* image references back to those paths, without copying any image
bytes into memory.

Bun rewrites `src` during the build, so keep the original reference in a custom
attribute of your own choosing:

```html
<!-- source -->
<img src="./images/photo.jpg" data-original-image="./images/photo.jpg">

<!-- compiled -->
<img src="/photo-abcd1234.jpg" data-original-image="./images/photo.jpg">
```

Then build the map once, in a compiled binary only:

```js
import { buildHtmlBundleImageMap, canonicalHtmlBundleImageHref } from "../single-exe/assetsHelper.js";
import { IS_COMPILED } from "../single-exe/compiled.js";

const images = IS_COMPILED
  ? await buildHtmlBundleImageMap(homepage, "data-original-image")
  : null;

const path = images?.get(canonicalHtmlBundleImageHref(originalHref));
const bytes = path ? await Bun.file(path).bytes() : null;
```

`buildHtmlBundleImageMap` returns a `Map` from canonical original reference to
the path inside the binary; it decodes HTML entities and percent encoding so a
reference written either way still matches. Reading stays lazy — the bytes are
only touched when you use the returned path.

Lower level, if you already hold a rewritten public path such as
`/photo-abcd1234.jpg`: `findHtmlBundleAsset(homepage, publicPath, options)`
finds its `homepage.files` entry, `findHtmlBundleImageAsset()` restricts that
to `image/*`, and `htmlBundleImageAssetPath()` returns just the path.

Never hard-code `/$bunfs/root/` or `B:/~BUN/`; always use the path that
`homepage.files` reports.

## jsmdcui specifics

The rest of this file is generic. These names belong to jsmdcui itself and are
not reserved by the bootstrap — an adopting project picks its own.

Embedding a Markdown app has its own flags, and they are what you normally
want:

```shell
bun ./src/index.js --build-md-exe ./中文工具.md
bun ./src/index.js --build-md-for bun-linux-x64 ./中文工具.md
```

Each expands into the plain build switch plus the define, so the low-level form
below is only needed when you want to combine it with other defines or drive
the build yourself:

```shell
--build-md-exe ./app.md        ->  --build-exe --define global.MDCUI_MAIN=./app.md
--build-md-for <p> ./app.md    ->  --build-for <p> --define global.MDCUI_MAIN=./app.md
```

`global.MDCUI_MAIN` embeds a custom Markdown app together with its generated
front, RPC, back, HTML and server modules. It is a string define, so it goes
through `stringifyNonPrimitiveDefineValues(process.argv, "global.MDCUI_MAIN")`.
`global.MDCUI_MAIN_BASE` is derived from it during the build; never pass it by
hand.

The switch defines are presence-based — `=0` and `=false` still enable them, so
omit a switch to disable it. Choose at most one `MDCUI_DEFAULT_*` mode.

| Build define | No-argument launch | Switch UI at runtime |
| --- | --- | --- |
| `MDCUI_DEFAULT_EDIT=1` | text editor | `./mdcui --tui app.md` |
| `MDCUI_DEFAULT_DEMO=1` | `testapp.md` TUI | `./mdcui --wui --demo` |
| `MDCUI_DEFAULT_DEMO_WUI=1` | `testapp.md` WUI | `./mdcui --tui --demo` |
| `global.MDCUI_MAIN=../中文工具.md` | custom TUI | `./mdcui --wui --demo-中文工具` |
| the above plus `MDCUI_DEFAULT_DEMO_WUI=1` | custom WUI | `./mdcui --tui --demo-中文工具` |

`MDCUI_OVERWRITE_DEMO=1` is a modifier, not a mode; it does not select a demo.

```shell
# custom TUI-default executable
bun ./src/index.js --build-md-exe ../中文工具.md

# custom WUI-default executable, where the second define needs the long form
bun ./src/index.js --build-md-exe ../中文工具.md \
  --define MDCUI_DEFAULT_DEMO_WUI=1
```

Explicit runtime arguments suppress the automatic demo/WUI selection, so
switching UI has to repeat `--demo` or `--demo-中文工具`. The main basename must
end in lowercase `.md`; the demo name it derives allows Unicode letters and
numbers, dots, underscores and hyphens, but no whitespace.

The custom demo uses the embedded TUI front/RPC, or the embedded WUI server,
when the local Markdown byte length matches the embedded asset. A missing or
overwritten demo uses the embedded modules after the asset is written. A
differing byte length warns and falls back to the filesystem companions.
