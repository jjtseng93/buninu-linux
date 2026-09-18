# Changelog

## 0.4.9 - 2026-09-16

### Changed

- Sync bunmsh to 0.3.6
  * VS Code compatibility: accepts leading &

## 0.4.8 - 2026-09-16

### Documentation

- Add an Android-only optional-tools walkthrough for installing `bunproot`,
  cloning `js-udocker`, and starting an Alpine container. Both tools remain
  user-downloaded rather than bundled with Buninu; the README records
  `bunproot` as GPL-2.0-or-later and `js-udocker` as Apache-2.0

## 0.4.7 - 2026-09-14

### Added

- `--readme-tui` and `--readme-wui` open README.md through jsmdcui instead of
  printing it, so its headings and its table of contents become links to
  follow -- the first as a terminal UI, the second served at a URL for a
  browser. jsmdcui writes five generated files beside any Markdown it opens,
  so README.md is copied into a directory under `TMPDIR` and run from there:
  an installation stays the user's, and nothing generated reaches an
  `--export` or survives an update
- `--bunmsh` joins `--jsgotty`, `--jsmdcui` and `--musl-la` as a first
  argument that spawns that app directly, forwarding every remaining argument
  and exiting with its exit code

### Changed

- `package.json` now carries `repository`, `homepage`, `bugs`, `keywords` and
  `author`, so the npm page links back to the source and the package can be
  found by search
- `apps/musl-la/NOTICE` records where the bundled musl loader came from:
  Alpine's `musl` 1.2.5-r10 for aarch64, with the SHA-256 of the binary. That
  pkgrel is no longer on Alpine's CDN, which keeps only the current one, so
  the note points at an archived copy of the same build
- Seven licence texts in `apps/musl-la/LICENSES/` covered components this
  package does not ship -- ggml, libssh2, curl, zlib, LLVM, a bare Apache-2.0
  and LGPL-3.0 -- and have been removed. The three binaries there are covered
  by `LICENSE_musl.txt`, `GPL-3.0.txt` and `gcc_runtime_exception.txt`, which
  stay
- README.md reorganised: a shorter opening that reaches `Install Bun` and
  `Start` sooner, the command reference moved ahead of the sections about
  keeping and updating an installation, grouped command listings, and the
  naming convention for platform-specific binaries (`la`, `lx`, `aa`, `wx`,
  `ma`) written down

### Fixed

- `--local` was missing from `--help` entirely, and now leads the option list
- `showimg` in a browser terminal
  * Bind the scroll and render listeners before decoding the image rather than
    after it. The server sends the placement ahead of the synthetic newlines
    that scroll room for the image, so that scroll could land while the decode
    was still running and the very first image of a session had no listener to
    correct it -- it came out blank while every later image was fine
  * Re-run the layout once the image element has actually loaded
  * Lay placements out against xterm's own geometry until the client's first
    resize message arrives, instead of against the 80x24 placeholder
  * Let the terminal size settle for up to 400ms before emitting an image. A
    window that was just opened, restored, resized or rotated reports a couple
    of columns for a few hundred milliseconds, and an image sized against that
    was emitted as a one-cell speck -- indistinguishable from the command
    having printed nothing -- while the next run in the same session was correct
  * Walk the prototype chain for the native `WebSocket.onmessage` descriptor.
    Safari/WebKit defines it on a parent prototype rather than on
    `WebSocket.prototype`, so the single-level lookup found nothing and image
    messages were never processed; fall back to `addEventListener` when no
    native setter is available
  * Thanks @hcyuser for the contribution! (#3)

## 0.4.6 - 2026-09-14

### Fixed

- Experimental macOS support
  * Fall back to `$0` when `/proc` is unavailable
  * Rename the shell wrapper's `status` variable to `_buninu_status`; `status`
    is read-only in zsh, so the web terminal died the moment it connected on a
    default macOS shell
  * Thanks @hcyuser for the contribution! (#1, #2)

## 0.4.5 - 2026-09-10

0.4.4 is intentionally skipped 不吉利

### Changed

- Sync bunmsh to 0.3.5
- Sync jsgotty to 1.1.11
  * Security fix CSWSH
- Sync jsmdcui to 0.19.1
  * Security fix CSWSH for CDP server

## 0.4.3 - 2026-09-05

- Don't check exit status for bunx

## 0.4.2 - 2026-09-03

### Changed

- Update the bundled bunmsh from 0.2.0 to 0.3.3, which is what a `--local`
  session runs. It gains a `curl` PATH-fallback builtin written on Bun's own
  `fetch`, so a device that ships no `curl` binary can still run the download
  and API scripts that expect one; `pspa` and `pspac`, the process listing this
  tree's `.bashrc` aliases used to be the only way to get; and a `kill` that
  works on Windows. Its JavaScript mode binds `$` to the shell's own variable
  table, so `$.HOME` reads a shell variable and `$.TAG = "v1"` writes one that
  later commands see, and completion learned shell variable names, command
  names inside `$(`, and JavaScript lines. A real `curl`, `pspa` or `pspac` in
  `PATH` still wins over any of the builtins; `builtin curl ...` selects
  bunmsh's. Its own [CHANGELOG](apps/bunmsh/CHANGELOG.md) has the rest.

### Fixed

- The process-list helpers section, left behind by the bunmsh update above,
  still described `--local` as a session with neither the bundled `.bashrc` nor
  `$HOME/.bashrc`, and sent you to source the bundled file to get the aliases
  back — where `pspac`, being two commands joined by `;`, would fail to define
  as a bunmsh alias. bunmsh now has `pspa` and `pspac` as PATH-fallback
  builtins, and colour aliases for `ls`, `grep` and `diff` of its own, so a
  `--local` session already answers all five of those names and has no reason
  to source anything. The section says so now, and says where the builtins
  differ from the aliases they stand in for: `pspac` colours the table inline
  rather than writing `$HOME/.pspidargs.sh` and paging it through `glow`, and
  `pspa` answers on Windows as well, by querying `Win32_Process` through
  PowerShell, where `ps -eo pid,args` has no counterpart — so the paragraph
  ruling Windows out is now about the aliases rather than about both. Nothing
  changed for the other routes: Android still loads the bundled file through
  `ENV` for the shell jsgotty starts, and a remote Bash or mksh session on
  Linux or macOS still sources it by hand.

## 0.4.1 - 2026-08-30

### Fixed

- A freshly installed tree no longer reports files as locally changed when
  only their file mode differs. Publishing normalises modes, so a file can come
  back from the registry with a different executable bit and byte-identical
  contents, which `bun pm diff` counts as a modification; an update was
  listing those and asking about files nobody had touched. They are now
  recognised by the mode having changed while the contents did not, and left
  out of the list, with a line saying how many were ignored so the count still
  adds up against the command below.

### Changed

- An update prints the `bun pm diff` command it is about to run, on a line of
  its own before the result. Run it by hand without `--json` to read the list
  directly, or without `--name-only` to see the changes themselves rather than
  which files hold them. It goes to stdout rather than stderr with the rest of
  the output, so `2>/dev/null` leaves just the command.

## 0.4.0 - 2026-08-30

### Added

- `--install [dir]` (`-i`) and `--strip-install [dir]` (`-si`) copy the running
  installation into a directory that outlives the `npx` cache. `--install`
  creates `<dir>/buninu` as the new `BUNINU_HOME`, `--strip-install` makes
  `<dir>` itself that root, and both default to the current directory. The
  implementation is `bin/install.js`, which runs on its own as well as being
  imported by `bin/init.js`; run directly with no arguments it installs.
  Relative symbolic links are recreated exactly as stored rather than followed,
  so `bin/androidNativeLibs -> ../..` stays a link instead of dragging the
  parent tree into the copy. `cp -a` is used when `cp` is on `PATH`, and an
  equivalent `node:fs` walk otherwise; the two were verified to agree on
  content, link targets, permissions and whole-second timestamps across every
  entry of the tree.
- Installing over an existing Buninu updates it in place. The copy only ever
  adds and overwrites, so `apps/<name>/` commands, `bin/*.sh` overrides and the
  Bun binaries `bin/bun.sh` extracted are left alone, and the three files that
  belong to the package and to the user at once are merged: the local `buninu`
  section of `package.json` is kept, command names added to `apps/cmdlist` are
  kept, and `.bashrc` is kept whenever it only adds lines to the shipped one,
  including lines inserted in the middle. A `.bashrc` that cannot be merged
  that way is left exactly as it is, with the shipped version written beside it
  as `.bashrc.dist`.
- Before replacing the package's own files, an update runs `bun pm diff`
  against the version the installation reports and lists the files that no
  longer match it, then asks before continuing. Nothing is recorded inside the
  installation to make this work — the published package is the reference — so
  the check needs the network, and when it cannot run, or does not finish
  within 60 seconds, it asks rather than assuming there was nothing to lose.
  `--yes` answers ahead of time, which a run without a terminal needs;
  `--force` replaces everything without merging or checking. An existing
  installation is always named by absolute path before anything is written.

- `buninu.xdgDataHome` points `XDG_DATA_HOME` at a directory of your choosing:
  `true` puts it inside the installation at `$BUNINU_HOME/.local/share`, and a
  string names one outright, resolved from the `package.json` directory when it
  is relative. The directory is created at startup. What this moves in practice
  is bunmsh's command history, which lives at `$XDG_DATA_HOME/bunmsh/history`,
  so `true` is what makes a shell's history travel with a copied installation
  instead of staying on the machine it was typed on. `HOME` is deliberately not
  touched by it, so SSH keys and Git configuration in the user's own home keep
  working and bunmsh can still import an existing `~/.bash_history`.

- Refusing to install into an occupied directory now says which check the
  directory failed — no readable `package.json`, or one naming a different
  package — instead of reporting every case as "is not a buninu installation".
  Whether a directory is an installation to update is decided by that name
  alone: a Buninu missing `bin/init.js` is a damaged installation rather than
  somebody else's directory, so an update repairs it, merging the local
  configuration back in, where before `--force` was the only way through and
  took that configuration with it. Every refusal names the directory by
  absolute path.

### Fixed

- `HOME` no longer falls back to the package directory when the environment
  does not set it. Windows does not set `HOME`, so a Windows session had its
  home pointed at the disposable `npx` cache, taking anything written there —
  bunmsh's command history included — with it when the cache was cleared. It
  now falls back to the operating system's own home directory for the user.

## 0.3.2 - 2026-08-29

- Added bunmsh to bin and cmdlist

## 0.3.1 - 2026-08-29

- Added bunmsh to buninu

## 0.3.0 - 2026-08-21

### Added

- Add `openWebView`, `evalWebView`, `showWebView` and `currWebView` to
  `apps/native-bridge` (short spellings `openwv`, `evalwv`, `showwv`,
  `currwv`, both accepted over the wire and listed in the host's `_discover`,
  the same arrangement `getcb`/`setcb` already had), plus the
  `WEBVIEW_CURRENT`/`WEBVIEW_CONSOLE`/`WEBVIEW_APP` constants. The host app
  has exactly two WebViews, alive from startup and never created or closed at
  runtime: `0` is the console showing the jsgotty terminal, `1` is the app
  WebView, which starts blank and behind. An id of `-1` means whichever is in
  front. `openWebView` loads without bringing its target forward, so loading
  the app WebView while the user keeps looking at the terminal is one call;
  `showWebView` is the only thing that changes what is on screen, and
  `showWebView(-1)` switches to the *next* WebView rather than being a no-op.
  `evalWebView` resolves to the value the expression produced rather than a
  string containing it, with `undefined`, functions and thrown exceptions all
  arriving as `null` because WebView itself does not distinguish them.
- `xdg-open` gained `MINAPK_WEBVIEW`, which names the WebView to open a URL
  in (and brings it to the front) instead of handing the URL to the
  platform's default handler. Read here rather than by the host app on
  purpose: it is an environment variable of this process tree, so the host
  could not see a value exported in the shell a moment ago, which is the
  whole point of having it. Only URLs are redirected -- a filesystem path
  still goes to the host, whose `content://` provider can actually serve it,
  unlike a `file://` URL in a WebView. A value that is not a plain integer is
  reported and ignored rather than guessed at, and a WebView the host does
  not have falls back to the default handler after saying so.
- Add `demo-server.js`: serves one fixed page on an OS-assigned port and
  opens it in the app WebView through `MINAPK_WEBVIEW=1 xdg-open`, as the
  smallest end-to-end exercise of the above.
- Add `buninu.backToConsole` (default `true`), read by the minapk host app,
  not by Buninu itself: it decides whether the Android back key, pressed on
  the app WebView with no page of its own to go back to, switches to the
  console WebView or takes the leave-the-app path. The host treats a missing,
  unreadable or non-boolean value as `true`, so it cannot fail in a way that
  leaves the back key broken. minapk's `--no-back-to-console` sets it for a
  single build.

## 0.2.5 - 2026-08-19

- Fixed fish shell startup breaking buninu
- Start fish after entering the shell please

## 0.2.4 - 2026-08-19

### Added

- Add the `xdg-open` command (`apps/xdg-open`), which opens a file or URL
  with whatever the platform considers its default handler: native-bridge's
  `xdgOpen` on Android (the host resolves a path under Buninu's home and
  hands it to another app through a read-only `content://` provider, since
  that directory is otherwise private to the APK), `termux-open` when
  running under plain Termux with no native bridge, `open` on macOS, `start`
  on Windows, and the real system `xdg-open` on Linux. That last one skips
  Buninu's own `bin` while searching `PATH`, since this script is itself
  registered as `xdg-open` and would otherwise find and run itself.
- Add `showimg`, a `bin/`-only shorthand for `jsgotty --viu` (no `apps/`
  subfolder, since it has no logic of its own beyond forwarding args).
- Add `rz`/`sz`, `bin/`-only companion scripts wrapping the existing
  `apps/jsgotty/rz.js`/`sz.js` -- `rz` uploads a file over ZMODEM, `sz`
  downloads one -- over the same terminal connection jsgotty renders in a
  browser or WebView.

- Add `apps/native-bridge`, a Bun module (`toast`, `clipboardRead`/`getcb`,
  `clipboardWrite`/`setcb`, and the raw `call(func, args, envp)` it and the
  CLI both sit on top of) that reaches minapk's Android native bridge over
  `PKG_BRIDGE_SOCK` -- a Bun unix socket, filesystem-path or Linux
  abstract-namespace depending on how that env var is encoded -- using
  jsmdcui's `rpc.mjs` `switchBackend`. Only meaningful inside an APK built by
  minapk with the native bridge wired in; elsewhere `available()` returns
  `false` and calls throw a clear error instead of doing nothing silently.
  Every call times out after 5s by default, so a stuck or unresponsive host
  can never hang the caller. `bun apps/native-bridge/native-bridge.js [func]
  [args...]` runs it directly; a bare invocation defaults `func` to
  `_discover` and lists what the host implements.
- Add the `xclip` command (`apps/xclip`), ported from the DroidScript-era
  `../tmpk/bin/xclip.sh` to use native-bridge instead of `dsapi.pipe`.
  `-selection primary` (the default) stays local-file-only, matching real X11
  semantics where the primary selection is never the same thing as the
  clipboard; `-selection clipboard`/`-clip` bridges to the real Android
  clipboard through native-bridge. jsmdcui's own clipboard backend detection
  already shells out to `xclip` on Linux-like platforms (`isLinuxLike()`
  counts `process.platform === "android"`), so jsmdcui's middle-click paste,
  selection auto-sync, and `PastePrimary` command all work inside an APK with
  no further wiring once `xclip` is on `PATH`.
- Add `speak`/`ttsStatus`/`tts` to native-bridge and the `tts` command
  (`apps/tts`) built on them. Android's TextToSpeech completion signal is an
  asynchronous callback with no way to push it to the far side over this
  protocol, so `speak(text, speed, pitch, flush)` never blocks -- it returns
  a handle immediately, and `ttsStatus(handle)`/`tts(handle)` (`"speaking"`,
  `"done"`, `"error"`, or `"unknown"` once a terminal state has already been
  consumed) is polled to find out when it finishes. `pitch`/`speed` both
  default to `1.0` (normal), the same convention as `termux-tts-speak`'s
  `-p`/`-r`; native-bridge passes them straight to `TextToSpeech.setPitch()`/
  `setSpeechRate()` with no unit conversion. `tts <text>` wraps the polling
  loop for the common case, blocking the calling process until speech
  finishes -- the same as any other CLI tool that waits for the thing it
  started, and, like real TTS tooling (espeak-ng has no timeout concept at
  all; Windows SAPI's `WaitUntilDone` documents `-1`/infinite as the default),
  waits as long as it takes with no wall-clock cap by default. Pass
  `--timeout <ms>` to opt into a bounded wait instead, or `-a`/`--async` to
  not wait at all. `--pitch`/`--speed` override the environment; without
  them, `tts` reads `$TTS_PITCH`/`$TTS_SPEED` itself (falling back to `1` for
  either that is unset), so jsmdcui's own `TTS_PITCH`/`TTS_SPEED` convention
  (which it sets on `Bun.env` before spawning a TTS command, inherited here
  like any other child process env var) is honored automatically -- jsmdcui's
  own `detectTtsCmd()` already falls back to a bare `Bun.which("tts")` after
  termux-tts-speak/espeak-ng/espeak, which this `tts` now satisfies, but that
  particular fallback branch passes no `-p`/`-r`-equivalent flags at all, so
  reading the env vars directly here is the only way `tts`'s pitch/speed
  actually reaches Android's TTS engine through that path.
- Give `xclip` and `tts` a real fallback on non-Android platforms too, since
  Buninu is cross-OS, not Android-only. `xclip`'s `-selection clipboard`
  register now also tries jsmdcui's own `ClipboardManager`
  (`src/platform/clipboard.js`, imported directly rather than reimplemented)
  on win32/darwin, then `wl-copy`/`wl-paste` on Linux; `tts` gains a
  `detectTtsCmd()` copied verbatim from jsmdcui's `src/index.js` (same
  pitch/speed/lang math and command construction, including the win32
  PowerShell/SAPI SSML branch, copied rather than hand-retyped since that
  quoting is easy to silently break and this had no Windows machine to
  verify it on) covering termux-tts-speak/say/PowerShell/espeak-ng/espeak.
  Both deliberately skip the one path that would reintroduce the exact
  self-reference risk they otherwise avoid: `ClipboardManager`'s Linux-like
  branch searches PATH for a binary named `xclip`, and jsmdcui's own
  `detectTtsCmd()` ends with a `Bun.which("tts")` fallback -- since these two
  commands are themselves registered as Buninu's `xclip`/`tts`, ahead of
  anything else of the same name on PATH, using either the way jsmdcui does
  from inside xclip.js/tts.js would just be each script invoking itself.
- Add `bin/*.bat` launchers for the new commands (`native-bridge`, `xclip`,
  `tts`, `showimg`, `rz`, `sz`, `xdg-open`). POSIX platforms get their
  `bin/<name>` entries as symlinks rebuilt by `bin/init.js` on startup,
  which Windows cannot use, so each command needs its own `.bat` there.

### Changed

- Update the bundled jsmdcui to 0.18.1, which adds `switchBackend()` to
  `src/cui/rpc.mjs` so an RPC caller can point at something other than the
  default `rpc` endpoint -- specifically a unix socket, which is what
  `native-bridge` dials. Also picks up 0.18.1's fix for decoding a
  percent-encoded socket path, needed because `new URL("unix:" + sock)`
  turns a leading NUL (a Linux abstract-namespace socket) into `%00`.
- `native-bridge`'s CLI now prints `_discover` one function per line instead
  of as a single line of JSON, which makes the list greppable. The value
  itself is untouched -- rpc.mjs dispatches every call against that object,
  so it stays exactly what the host returned; only the CLI's own display of
  it changed.

## 0.2.3 - 2026-08-18

### Added

- Add `buninu.exitAfterCmd` package.json setting (default `false`). When
  `true`, the shell/PTY exits with `buninu.command`'s status instead of
  falling back to an interactive shell once the command finishes; `false`
  keeps the existing fall-back-to-shell behavior.
- Add `--export-config [output.json]`, which writes this entire `package.json`
  to `buninu.json` in the current directory by default (like `--export`, the
  output path can be overridden), instead of exporting the whole installation
  like `--export` does. If the output path already exists, it now asks for
  confirmation (`[y/N]`) before overwriting.

## 0.2.2 - 2026-08-17

### Added

- Add a "Commands inside the shell" section to README.md, split out of
  Command-line information (which is only `bin/init.js`'s own flags, resolved
  before Buninu starts). Lists everything in `apps/cmdlist` and moves the
  `buninu-help`/`bunx` write-ups there, including a note that `bunx` can't
  install anything on Android until
  [oven-sh/bun#39084](https://github.com/oven-sh/bun/pull/39084) merges
  upstream (Android's seccomp policy kills `bun i -g` with SIGSYS during bin
  linking until then).

## 0.2.1 - 2026-08-17

### Added

- Add `bunx`, a POSIX and Windows multicall command that ensures a package is
  installed via `bun i -g` and then runs its matching binary, forwarding the
  remaining arguments. Reinstall timing is adapted from real bunx's own rules
  (an explicit dist-tag like `@latest` always reinstalls; otherwise a cached
  binary is reused until it's older than 24h, or stat fails, or bun's own
  `install/global/package.json` shows a different pinned version than the one
  requested — this script has one shared install location instead of bunx's
  per-version cache, so this last check substitutes for that). The global bin
  directory is resolved via `bun pm bin -g`, falling back to
  `$BUN_INSTALL`/`$HOME/.bun` on the very first install before that project
  exists (which `bun pm bin -g` requires).
  - Runs the target through `bun <target>` instead of exec'ing it directly:
    on Android the resolved binary typically sits under storage mounted
    noexec, so a direct exec is refused even though the file is readable and
    executable-bit set. Trade-off: a package whose bin is a real native
    executable rather than a JS/bun script won't run this way.
  - On Android (detected the same way as `bin/init.js`, via
    `/system/bin/linker64`), installs with `--backend=copyfile` since
    hardlinks/symlinks frequently fail across Android's storage, and sets
    `$PREFIX=/data/data/com.termux/files/usr` for the target process (not the
    install step) so CLIs that check for a Termux environment still find one,
    unless `$PREFIX` is already set.

## 0.2.0 - 2026-08-17

### Added

- Add `--jsgotty`, `--jsmdcui`, and `--musl-la` as the first argument to
  `bin/init.js` to spawn that app directly, forwarding every remaining
  argument to it and exiting with its exit code. This bypasses the shell and
  startup-command flow entirely, and lets `--jsgotty --help` (and the same for
  the other two) show the app's own option reference instead of Buninu's.
- Add `buninu-help`, a POSIX and Windows multicall command that renders
  README.md with jsmdcui's `--cat` mode and then displays `icon.png` with
  jsgotty's `--viu`. The default startup greeting now points to it instead of
  separately mentioning `glow`/`README.md`.

### Security

- Bind jsgotty to `127.0.0.1` by default instead of `0.0.0.0` in
  `scripts.start`. Previously the terminal server accepted connections from
  any device able to reach the host on its network, relying only on the
  random port and `--random-url` path segment for protection. Pass
  `--address <value>` through to `bin/init.js` (forwarded arguments override
  the flags baked into `scripts.start`) to opt back into listening on other
  interfaces.

## 0.1.9 - 2026-08-17

### Fixed

- Correct `apps/musl-la/NOTICE`: it listed 11 third-party components
  (llama.cpp, nghttp2/nghttp3, OpenSSL, libssh2, curl, zlib, libidn2,
  libunistring, brotli, c-ares, libpsl) with no corresponding files anywhere
  in the package — leftover from an unrelated bundle. The only files actually
  shipped in that directory are `ld-musl-aarch64.so.1`, `libgcc_s.so.1`, and
  `libstdc++.so.6`; the notice now covers only those, identifying the exact
  build (GCC 14.2.0, packaged as Alpine Linux 3.22's `libgcc`/`libstdc++`
  14.2.0-r6, aarch64) with matching SHA-256 hashes and a link to Alpine's
  build recipe pinned to the commit for that package revision, satisfying the
  GCC Runtime Library Exception's corresponding-source requirement.

## 0.1.8 - 2026-08-17

### Changed

- Run an optional `libmain.so` from Android's native-library PATH at startup,
  falling back to the normal Android welcome message when it is unavailable.

## 0.1.7 - 2026-08-17

### Added

- Add `buninu --export [output.tgz]` to create a gzip-compressed tar archive of
  the current Buninu installation. The archive retains exactly one top-level
  directory and defaults to `./buninu.tgz`. An existing output is backed up and
  restored if archive creation or replacement fails.
- Add `apps/cmdlist` as the validated source of POSIX multicall commands.
  Normal startup now recreates every listed command as a `shloader` symlink,
  including after npm installs that omit package symlinks.
- Add the Buninu-only `# syntax: markdown` first-line marker for Markdown
  highlighting in extensionless files such as `apps/cmdlist`.

### Changed

- Update the default and Android startup greetings to point users to
  `glow apps/cmdlist`.
- Update `musl-la` to prefer Android's native `libld-musl.so`, fall back to the
  bundled loader, add the target ELF directory and existing `LD_LIBRARY_PATH`
  to its library search path, and support `-e` for the environment-variable
  launch mode.
- Document how to add POSIX multicall commands and their separate Windows
  batch launchers.

### Fixed

- Keep the POSIX startup wrapper and Android greeting command on one line so
  process listings do not expose embedded LF (`Ctrl+J`) characters.

## 0.1.5 - 2026-08-16

### Fixed

- Enable jsmdcui's mdcui encoding for `--cdp-maze`, which selects the bundled
  Markdown maze without passing a `.md` filename or a `--demo*` argument.

### Changed

- Prefer PowerShell (`pwsh.exe`, then `powershell.exe`) as the default Windows
  shell, falling back to `%COMSPEC%` or `cmd.exe` when PowerShell is unavailable.

## 0.1.4 - 2026-08-16

### Changed

- Enable jsmdcui's mdcui encoding when any launcher argument begins with
  `--demo`, in addition to the existing `.md` file detection.
- Run jsmdcui's `src/index.js` entry point directly from the Unix and Windows
  `jsmdcui`, `jmi`, and `glow` launchers instead of going through its `tui`
  wrapper. This gives demos such as `--demo-img-change` the expected `Bun.main`
  path so their bundled image assets can be resolved correctly.

## 0.1.3 - 2026-08-16

### Fixed

- Preserve a single canonical child-process path variable: `Path` on Windows
  and `PATH` on other platforms. This ensures the Buninu `bin` directory is
  available inside the shell started by jsgotty on Windows.
- Keep the jsgotty reconnect overlay clickable in WebGL mode by placing it
  above the canvas and preventing Kitty image pointer handling from intercepting
  its mouse and touch events.

### Changed

- Enable jsmdcui's mdcui encoding from the Unix and Windows launchers only when
  at least one command-line argument is a `.md` file. Launching without a
  Markdown file now retains the editor-first behavior.
