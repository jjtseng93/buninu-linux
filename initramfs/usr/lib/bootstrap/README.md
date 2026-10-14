# Bootstrap from Bun

- Route and recipe reference: [ZilchOS/bootstrap-from-tcc](https://github.com/ZilchOS/bootstrap-from-tcc),
  by Alexander Sosedkin. See [NOTICE.md](NOTICE.md) for full credit and component licenses.

- Requires Bun with `Bun.cc`, `Bun.Archive` and `Bun.YAML` (tested with 1.4.2).
- Supported targets: native ARM64 and x86-64 Linux with musl.
- Run stages 1 and 2 outside the new rootfs; run stages 3–12 inside it.
- The numbered filenames are the execution order.
- Inside the new rootfs, use `cd /bootstrap`; scripts, `lib/`, `README.md` and
  `downloads.md` live alongside `src`, `toolchain`, `deps`, `build` and `result`.
- Copies of scripts 1/2 are included for reference; run preparation/entry from
  the outer package, which also contains the bundled seed archives.

## 1. Prepare a new rootfs

```sh
bun /usr/lib/bootstrap/1.prepare-rootfs.js
```

- Default architecture: the running Bun's architecture.
- Default destination: `./roota` for ARM64, `./rootx` for x86-64.
- Optional arguments: `[ARCH] [ROOTFS]`.
- Architecture aliases: `a`, `arm64`, `aarch64`; `x`, `x64`, `x86_64`, `x86-64`.
- A single directory argument uses the default architecture.
- Destination must be new; its parent directory must already exist.

```sh
bun /usr/lib/bootstrap/1.prepare-rootfs.js a ./my-root
bun /usr/lib/bootstrap/1.prepare-rootfs.js x
bun /usr/lib/bootstrap/1.prepare-rootfs.js ./my-root
```

- On Buninu Linux (`ID=buninu-linux` in `/etc/os-release`), reuse the local
  Bun, musl loader, libgcc, libstdc++, DNS configuration, bunmsh and extraction tools.
- For a different target architecture, or outside Buninu Linux:
  - Fetch `buninu-linux@0.9.56` for the runtime libraries and JavaScript tools.
  - Fetch musl Bun 1.4.2 for the target architecture (x64 uses baseline).
  - Verify SHA-256 before using either download.
- Pins live in `downloads.md`; despite its extension, it is YAML with the same
  URL/hash pair format as `scripts/npm-packages.md`.
- Cache: `${XDG_CACHE_HOME:-$HOME/.cache}/buninu-bootstrap/`; cached files are
  verified again. A bad cache entry causes an error, not an unchecked fallback.
- No musl-dev APK, prebuilt CRT, installed headers or standalone compiler required.
- Bundled sources are hash-checked and extracted:
  - `sources/musl-1.2.6.tar.gz` -> `/bootstrap/src/musl`.
  - `sources/tinycc-05f0faf-upstream.tar.gz` -> `/bootstrap/src/tinycc`.
  - `sources/tinycc-local-bootstrap-files.tar.gz` -> TinyCC recipes and `/bin/cc`.
- `/bin/sh` is an executable JavaScript file with `#!/bin/bun`.
- It prepends `/bootstrap/result/bin` and `/bootstrap/toolchain/bin` to PATH,
  removes duplicates, then dynamically imports bunmsh. Missing bin directories
  are harmless; child processes inherit the environment.
- Build stages use a separate shell launcher and explicit PATH so installed
  result tools do not silently replace bootstrap tools during a rebuild.
- Scripts 1–12 and helpers are copied to `/bootstrap` in the new rootfs.
- Preparation can select another architecture; entering/building requires a
  matching CPU or a separately configured emulator. These scripts do not set up emulation.

## 2. Print the entry command

```sh
bun /usr/lib/bootstrap/2.enter-rootfs.js
```

- Accepts `[ARCH] [ROOTFS]`, with the same architecture aliases as stage 1.
- Without a destination (including an architecture-only invocation), prints
  `/path/to/your/rootfs` as a placeholder instead of assuming `roota` or `rootx`.
- Prints commands only; it does not enter, modify or read the rootfs or its
  marker file. The destination does not need to exist to print instructions.
- Reads the host's os-release only to choose chroot versus bunproot.
- Buninu Linux example (requires chroot privileges):

```sh
chroot '/absolute/path/rootx' /bin/sh
```

- Android/Termux and other hosts with bunproot:

```sh
bun x bunproot -koe -r '/absolute/path/roota'
```

## 3. Generate musl development files, inside the rootfs

```sh
cd /bootstrap
bun 3.gen-musl-dev.js
```

- Generate 217 public headers from musl's source and architecture templates.
- Build TinyCC in memory using `Bun.cc`; emit `crt1.o`, `crti.o`, `crtn.o`.
- Install headers under `/usr/include`, CRT objects under `/usr/lib`.
- Preserve the original musl sources.
- ARM64 only: use a temporary startup-header override omitting the unused
  `_DYNAMIC` argument, because TinyCC's ARM64 assembler does not support `adrp`.
- This override applies only to ordinary `crt1`; static PIE `rcrt1` and the
  dynamic loader are not built here.
- Refuse existing headers/CRT instead of overwriting them.
- If this stage fails after headers were generated, preserve the rootfs for
  diagnosis and prepare a fresh destination before repeating the full flow.

## 4. Build a standalone C compiler, inside the rootfs

```sh
bun /bootstrap/4.build-tcc.js
cc /bootstrap/src/tinycc/bun-hello-libc.c -o /tmp/hello
/tmp/hello
```

- Build TinyCC stage1 through `Bun.cc`, using the generated CRT.
- Build the x64 compiler runtime helpers when needed.
- Rebuild stage2 with stage1 and require byte-identical executables.
- Verify libc, x64 conversions/variadic calls, and CRT startup behavior.
- `/bin/cc` launches `/bootstrap/toolchain/bin/tcc` with the headers, libraries and helpers.
- Stages 3/4 are offline; no host build tools are used.
- The seed Bun, musl shared library, libgcc and libstdc++ remain prebuilt inputs.
- Source licenses remain in the archives and extracted trees:
  - musl: `/bootstrap/src/musl/COPYRIGHT`.
  - TinyCC: `/bootstrap/src/tinycc/COPYING` and individual source-file notices.

## 5–12. Build through GCC 4.7

- Run each numbered script inside the same rootfs, in order.
- Each stage fetches its source on demand and checks the SHA-256 in `downloads.md`.
- These eight large source archives are **not** included in the npm package or initramfs.
- Fixed version/commit URLs are used, never `latest` or a moving branch.
- Cache: `/root/.cache/buninu-bootstrap` by default.
- Source trees: `/bootstrap/src`; build trees and logs: `/bootstrap/build`.
- Reserve at least 3 GB of writable workspace; avoid a small RAM-only rootfs.
- Set `BOOTSTRAP_JOBS=1` to reduce build concurrency (default: 2).

| Stage | Command after `bun /bootstrap/` | Source |
| --- | --- | --- |
| 5 | `5.build-make.js` | GNU Make 4.4.1, official GNU release |
| 6 | `6.build-binutils.js` | Binutils 2.39, official GNU release |
| 7 | `7.build-gmp.js` | GMP 4.3.2, official GNU release |
| 8 | `8.build-mpfr.js` | MPFR 2.4.2, official version directory |
| 9 | `9.build-mpc.js` | MPC 0.8.1, GCC infrastructure archive |
| 10 | `10.build-m4.js` | GNU m4 1.4.18, official GNU release |
| 11 | `11.build-flex.js` | Flex 2.6.4, official GitHub release |
| 12 | `12.build-gcc.js` | GCC mirror, commit `9d2b63d100ae7c99ee8b128fb41086fd85c8f57d` |

- GNU Make first uses its shipped no-make builder, then rebuilds itself.
- Binutils supplies the assembler, linker and archive tools; stage 6 also
  builds/tests the additional TinyCC runtime helpers needed by later stages.
- GMP/MPFR/MPC are static prerequisite libraries; MPFR runs upstream arithmetic
  tests, and MPC's stage verifies all three libraries together.
- m4 and Flex are built from source and tested before GCC uses them.
- `configure` and build shell commands use bunmsh. External utility adapters
  call its JavaScript builtins in POSIX mode; no host awk/sed/coreutils enter the build.
- Logs are streamed to the terminal and retained under `/bootstrap/build/logs/`.
- Re-running a failed stage revalidates the download, reconfigures and resumes
  its existing build tree. Source compatibility patches are idempotent.
- GCC uses a vendor 4.7 branch containing both ARM64 and x64 backends. The pinned
  GitHub snapshot's 76,720 regular source files match the earlier local archive.
- Stage 12 builds the C frontend and libgcc, then tests `-O0`/`-O2`, the musl
  interpreter, architecture/type macros and 128-bit runtime arithmetic.
- Stage 12 runs GCC's `install-gcc` and `install-target-libgcc` rules with
  `--prefix=/bootstrap/result`, and includes native Binutils executables.
- GCC's private `include` and `include-fixed` directories are installed using
  JavaScript with symlinks dereferenced, avoiding the tar pipe and recursive
  `cp -p` requirements and retaining headers after source/build removal.
- The installed compiler is `/bootstrap/result/bin/gcc`; it is not an `xgcc`
  wrapper and needs no `-B` pointing into a build directory.
- The final check temporarily renames `src`, `toolchain`, `deps` and `build`
  to sibling `*.verification-hidden` directories, compiles/runs ordinary and
  shared-library checks using only result tools, then restores the directories.
- If interrupted by a forced kill, restore any `*.verification-hidden` directory
  to its original name before resuming. Ordinary errors restore them automatically.
- Successful verification writes `/bootstrap/result/verified.json` and
  `/bootstrap/result/verification.log`; stage 12's build log remains in `build/logs`.
- After stage 12 succeeds, `/bootstrap/build` can be deleted. The installed GCC
  also does not need `src`, `deps` or `toolchain`; keep these to rebuild or use
  the intermediate tools such as Make and TinyCC.
- Result still uses the rootfs's musl loader/libc, `/usr/include`, `/usr/lib`
  startup objects and seed runtime libraries. It is not a self-contained rootfs.
- The installation prefix is fixed at `/bootstrap/result`; moving it into `/usr`
  is not supported by simply copying it. A system installation should instead
  configure `--prefix=/usr` and stage the installation with `DESTDIR`.
- This is the GCC 4.7 C + libgcc stopping milestone, not a full GCC three-stage
  bootstrap or a completed Bun rebuild.
- This layout/install revision has only received static checks; validate it
  by running the numbered stages in a new rootfs.

## Directory layout

| Directory | Contents |
| --- | --- |
| `/bootstrap/src` | musl, TinyCC and downloaded package source trees |
| `/bootstrap/toolchain` | intermediate compiler, runtime helpers, Make, Binutils, m4, Flex and JS utility adapters |
| `/bootstrap/deps` | static GMP, MPFR and MPC libraries and headers |
| `/bootstrap/build` | intermediate objects, build trees and build logs |
| `/bootstrap/result` | installed GCC, libgcc, Binutils and final verification records |

```sh
# Entering through /bin/sh already sets PATH.
gcc --version
gcc hello.c -o hello
./hello
```

- The generated musl headers and CRT remain in `/usr/include` and `/usr/lib`.
- The source archive download cache remains under `/root/.cache/buninu-bootstrap`.

