# Buninu

**BUNinu Is Not Unix** 🐮

**幫你牛** 🐂 ・ **Bunに入魂** 🔥

![icon](https://raw.githubusercontent.com/jjtseng93/buninu/main/icon.png)

Buninu is a portable, self-bootstrapping Unix-like userspace built on Bun. One
command gives you a working shell — in a browser tab, or straight in the
terminal you are already in — on Android, Linux, Windows, and macOS, with
nothing to compile and nothing installed system-wide.

```sh
npx buninu
```

> **Status:** Buninu is still under active development. The browser
> terminal, the install-and-update flow, and the bundled commands are the
> settled parts — Android and Linux first, with Windows working the same way
> and macOS support newer. Still moving: `package.json` settings and
> command-line flags can change between releases, and the local shell
> (`--local`, bunmsh) has no job control yet, so use the browser terminal when
> you need to background a job.

- Source: [github.com/jjtseng93/buninu](https://github.com/jjtseng93/buninu)

- Core components:
  * [jsgotty](https://github.com/jjtseng93/js-gotty): Remote shell from a Browser or Terminal
  * [jsmdcui](https://github.com/jjtseng93/jsmdcui): Both a text editor and
    Markdown execution runtime (not static rendering), based on
    [bunmicro](https://github.com/jjtseng93/bunmicro)
  * [bunmsh](https://github.com/jjtseng93/bunmsh): Bun Modern Shell — a
    dependency-free, mksh-inspired command shell with a JavaScript mode, and
    builtins that answer the same way on Windows as on POSIX systems

- [Why Buninu exists](#why)
- [Table of contents](#contents)
- [ARCHITECTURE.md](ARCHITECTURE.md): the complete architecture, portability
  model, and self-bootstrapping design
- [Commands inside the shell](#commands-inside-the-shell): the reference for a
  session you are already in

## Install Bun

Buninu requires [Bun](https://bun.com). On Android, install Bun in Termux:

```sh
npm install -g bun
```

- On Linux, Windows, and macOS, follow the
[official Bun installation guide](https://bun.com/docs/installation).
  * macOS support is currently experimental

## Start

### Start a remote shell in a Browser

To try it, run the npm package. This runs Buninu from the `npx` cache, which
is a fine place to look around in and a bad place to keep anything:

```sh
npx buninu
```

To keep it, install it somewhere of your own first, and start it from there
from then on. That directory becomes `BUNINU_HOME`: the installation's own
root, yours to edit and to carry to another machine. See
[Install and update](#install-and-update):

```sh
# Creates ~/somewhere/buninu, which is now BUNINU_HOME
npx buninu --install ~/somewhere

# Start it from there from now on
bun ~/somewhere/buninu/bin/init.js
```

Or run it from a source checkout:

```sh
bun ./bin/init.js
```

The launcher automatically chooses a free TCP port and detects an available
shell for the current platform. Other arguments are forwarded to jsgotty:

```sh
# Serve on port 9000 instead of picking a free one
npx buninu --port 9000

# Ask for a username and password before handing over the terminal
npx buninu --credential user:pass

# Accept connections from other machines, not just this one. By default the
# terminal is reachable only from the computer it runs on; this opens it to
# anything that can reach this machine over the network, and the terminal is
# a working shell, so give it a password at the same time.
npx buninu -a 0.0.0.0 --credential user:pass
```

Read [Security](#security) before using that last one.

Buninu's own options are listed under
[Command-line usage](#command-line-usage).

### Start a local shell in a Terminal (experimental)

Drops you straight into [bunmsh](apps/bunmsh/README.md) (Bun Modern Shell), a
dependency-free, mksh-inspired command shell that runs on Bun, without going
through the browser/jsgotty flow.

It is marked experimental for one reason above the rest: bunmsh has no job
control yet. There is no `jobs`, `bg` or `fg`, and no suspending a command
that is already running — a foreground command holds the terminal until it
finishes on its own. Everything else a session needs is there: pipelines and
redirection, functions and compound commands, history, completion with ghost
suggestions, and a JavaScript mode. Reach for the browser terminal when you
need to park a job and come back to it.

To try it:

```sh
npx buninu --local
```

To keep it, install it the same way as above and pass `--local` to the
installed copy from then on. See [Install and update](#install-and-update):

```sh
# Creates ~/somewhere/buninu, which is now BUNINU_HOME
npx buninu --install ~/somewhere

# Start bunmsh from there from now on
bun ~/somewhere/buninu/bin/init.js --local
```

Command history is kept in your own home directory either way, so it survives
`npx`. What does not is anything you add to the installation itself — commands
of your own under `apps/`, edits to its `.bashrc` — since that lives in the
package, and under `npx` the package is a cache directory.
See [Data & Persistence](#data--persistence).

Or run it from a source checkout:

```sh
bun ./bin/init.js --local
```

Buninu's own tools (`glow`, `jmi`, `xclip`, `tts`, `xdg-open`, etc.) stay
available inside this shell too, same as in the browser session.

Unlike the shells the browser terminal starts, **bunmsh does not read
`.bashrc`**. It does not claim complete POSIX behavior yet, so a startup file
written for a full shell can fail part way through — and a startup file that
fails is a shell you cannot get into. Nothing is read automatically until that
is no longer a risk. Source it yourself when you want it:

```sh
. ./.bashrc
```

The shell starts in `BUNINU_HOME`, so that path works as written at first;
after moving elsewhere, use `. "$BUNINU_HOME/.bashrc"`.

There is no setting that does this for you yet, and
[`buninu.command`](#startup-command-optional) is not it:
`--local` does not run it at all, and the browser terminal, which does, runs it
in a subshell before starting a fresh shell — so aliases and functions a
startup command defines are gone by the time you reach a prompt either way.
Until bunmsh reads a startup file of its own, sourcing it by hand is the way.

## Security

**Buninu (when starting a remote shell) binds its terminal server to `127.0.0.1`**, so out of the box it
only accepts connections from the machine it runs on. It is not reachable from
other devices on the network unless you explicitly opt in.

Within that machine, the terminal is writable (`-w`) and unauthenticated by
default: only the loopback binding and jsgotty's random URL path (`-r`) stand
between a local process and a shell with Buninu's permissions.

To listen on another interface, pass `--address <value>` (see
[Start](#start)). Arguments you give on the command line override the defaults
the package ships in its `scripts.start` entry, the loopback binding included,
so **pass `--credential user:pass` at the same time** — a random port and URL
path are not a substitute for authentication once the server is reachable from
outside the machine.

## Command-line usage

These are flags to `bin/init.js` itself, resolved before Buninu starts.
Everything else on the command line is forwarded to jsgotty.

```text
Init options:
  --local
    Start Buninu in this terminal
      instead of a Remote Shell
      reached from a browser
      (via jsgotty, the default)

  -h, --help
    Show this help and exit
  -V, --version
    Show version & runtime info, then exit

  --readme
    Render README.md in the terminal and exit
  --changelog
    Render CHANGELOG.md in the terminal and exit

  --readme-tui
    Open README.md as a Terminal UI
  --readme-wui
    Serve README.md as a Web UI

  --export [output.tgz]
    Export this Buninu installation
    (default: ./buninu.tgz)

  --export-config [output.json]
    Export Buninu's package.json
    (default: ./buninu.json)

Install options:
  -i, --install [dir]
    Install this package into <dir>/buninu
    (default: .)

  -si, --strip-install [dir]
    Install into <dir> directly
    Without a top-level directory of its own

  (--install --help for full options)

Remote Shell options:
  --shell <path|name>
    Override buninu.shell for this run
  --command <command>
    Override buninu.command for this run
```

`--local` is the one flag here that changes what Buninu starts rather than
what it reports; [Start a local shell in a
Terminal](#start-a-local-shell-in-a-terminal-experimental) covers what that
session can and cannot do, and [Start](#start) covers the browser route it
replaces.

`--readme-tui` and `--readme-wui` hand README.md to jsmdcui, so its headings
and its table of contents become links you can follow rather than text you
scroll past — the first in this terminal, the second at a URL it prints for a
browser. Opening a Markdown file that way makes jsmdcui write five generated
files beside it, so Buninu copies README.md into a directory under `TMPDIR`
first and runs it there: an installation stays yours, and nothing generated
ends up in an `--export` or outliving an update.

`--export` and `--export-config` are described under [Export](#export), which
also covers what an archive made through `npx` contains and what one made from
your own installation does instead.

`--install --help` lists the install options in full, including `--force` and
`--yes`; see [Install and update](#install-and-update) for what an update does
with files you changed.

`--shell` and `--command` override for one run what
[Shell selection](#shell-selection-optional) and
[Startup command](#startup-command-optional) set in `package.json`.

### Launching a bundled app directly

As the **first** argument, `--jsgotty`, `--jsmdcui`, `--bunmsh`, or `--musl-la`
bypasses the shell and startup-command flow entirely: it spawns that app with
every remaining argument forwarded to it, and exits with its exit code.

```text
  --jsgotty [args...]
    Spawn jsgotty directly,
      forwarding remaining arguments,
      and exit with its exit code
  (--jsgotty --help = jsgotty options)

  --jsmdcui [args...]
    Spawn jsmdcui directly,
      same forwarding behavior

  --bunmsh [args...]
    Spawn bunmsh directly,
      same forwarding behavior

  --musl-la [args...]
    Spawn musl-la directly,
      same forwarding behavior
```

Use it to reach an app's own options, which Buninu would otherwise interpret
as its own — `npx buninu --jsgotty --help` shows jsgotty's flag reference
rather than this one.

## Commands inside the shell

Once you are inside a running Buninu shell, these are available (the
validated source list is `apps/cmdlist`; see [Add a command](#add-a-command)
for how it works):

---

- **Bun Modern Shell & its builtins**
  * `bunmsh` — Bun Modern Shell supports multi-tabs cwd
  * `catfancy` — Pretty print a file with JSON, YAML, TOML, Markdown and JS/TS colored
  * `lsfancy` — List a directory with emoji, aware of the terminal width
  * `serve` — Serve a directory over HTTP
  * `curl` — Fetch an HTTP URL or download it to a file, built on Bun's `fetch`
  * `pspa` / `pspac` — List processes, plain or colored as shell syntax
  * `kill` — Signal a process, on Windows as well as POSIX

  Everything below `bunmsh` is one of its builtins, so they are there once you
  are inside a bunmsh session, and every one of them documents itself with
  `--help`. From any other shell, reach them with
  `bunmsh -cc builtin <name> argv1 argv2 ...`.

---

- **Markdown applications**
  * `jsmdcui` — Run interactive Markdown applications in both TUI & WebUI
  * `jsmdcui --demo-reader` — Text-to-speech ebook reader
  * `jsmdcui --demo-imgtool` — Image processor with table-based UI based on `Bun.Image`
  * `jsmdcui --demo-imgtool-zh` — The same processor in Traditional Chinese
  * `jsmdcui --demo-maze` — Maze game
  * `jsmdcui --cdp-maze` — The same maze game, started with a local Chrome DevTools
    Protocol server and solved by the bundled solver three seconds later

---

- **Editing and viewing**
  * `jmi` — Edit files in the js micro editor
  * `glow` — View file contents with syntax highlighting

---

- **Terminal and file transfer**
  * `jsgotty` — Run a browser-accessible terminal
  * `showimg` — Show an image in the terminal
  * `rz` — Upload a file over ZMODEM
  * `sz` — Download a file over ZMODEM

  These three work in the browser route, a minapk WebView included, but not
  necessarily under `--local`: they speak the Kitty graphics protocol and
  ZMODEM, which a plain terminal emulator need not support. They are
  equivalent to `jsgotty --viu`, `--rz` and `--sz`.

---

- **System integration**
  * `xclip` — X11-style clipboard tool; `-selection clipboard`/`-clip` bridges
    to the system clipboard
  * `tts` — Speak text and wait for it to finish (`-a` to not wait)
  * `xdg-open` — Open a file or URL with the platform's default handler
  * `native-bridge` — Call the Android host app (toast, clipboard, speak,
    WebViews) over `PKG_BRIDGE_SOCK`

---

- **Running programs**
  * `bun` — Run the bundled Bun, falling back to one already on `PATH`
  * `bunx` — Globally install a package with bun, then exec its matching binary
  * `musl-la` — Launch AArch64 ELF programs with the bundled musl loader

---

- **Help**
  * `buninu-help` — Render README.md with glow, then show icon.png with `showimg`

### Details for the above commands

`rz [target-dir]` (upload into `target-dir`, default: cwd) and `sz <file>
[more files...]` (download one or more files) are thin `bin/`-only wrappers
around `apps/jsgotty/rz.js`/`sz.js`, transferring files over ZMODEM through
the same terminal connection jsgotty already renders in a browser or WebView.

---

`xclip [-o] [-selection primary|clipboard] [-clip]` is a small X11-`xclip`-
compatible clipboard tool. `-selection primary` (the default) never touches
the system clipboard, matching real X11 semantics. `-selection
clipboard`/`-clip` reaches the real system clipboard on Android, macOS,
Windows, and Linux/Wayland. jsmdcui picks this up automatically once it's on
`PATH`, so its middle-click paste and copy/paste commands just work.

---

`tts <text> [-f|--flush] [-a|--async] [--timeout <ms>] [--pitch <n>]
[--speed <n>]` speaks text and, by default, blocks until it finishes — no
timeout unless you pass `--timeout`. Works on Android, macOS, Windows, and
Linux (via espeak-ng/espeak). `--pitch`/`--speed` fall back to
`$TTS_PITCH`/`$TTS_SPEED` when not given explicitly, so jsmdcui's own
pitch/speed setting is honored automatically.

---

`glow` and `jmi` are the same program under two names: both run the bundled
jsmdcui, `glow` with its `--cat` mode, which renders a file to stdout and
exits, and `jmi` with no mode of its own, which opens the editor because this
jsmdcui is configured editor-first through `MDCUI_DEFAULT_EDIT`. Neither is
the Go program called glow — `glow --help` and `jmi --help` both print
jsmdcui's own reference, and jsmdcui's options are the ones that apply.

---

`bun` is the installation's own Bun rather than whatever the machine has. On
Android it runs `androidNativeLibs/libbun.so` when an APK supplies one;
otherwise it picks the binary for the machine — `bun-la`, `bun-lx`, or
`bun-wx.exe` — and extracts it from `apps/bun/bunBin.tgz` first whenever that
archive is newer than the binary already sitting there. Only when none of
those is available does it fall back to a Bun on `PATH`, skipping its own
directory on the way so the `bun` symlink beside it cannot call itself. This
is what lets an installation carry the runtime it needs with it.

---

`bunx <package>[@version] [args...]` installs with `bun i -g` and runs the
matching binary. On Android, the underlying `bun i -g` currently needs
[oven-sh/bun#39084](https://github.com/oven-sh/bun/pull/39084) merged
upstream — without it, install is killed by SIGSYS (Android's seccomp policy
rejects a syscall bin-linking uses), so `bunx` can't install anything there yet.

---

`buninu-help` renders README.md with `jmi`'s `--cat` mode — the same rendering
`glow` gives — and then shows `icon.png` with `showimg`. It is the command the
default startup greeting points to.

Reach that mode as `jmi --cat` or as plain `glow`, not as `jsmdcui --cat`. The
`jsmdcui` launcher routes any `.md` argument into the Markdown UI, and opening
a file that way writes five generated files beside it rather than only
printing it.

---

`musl-la [-e] <program> [args...]` runs an AArch64 Linux ELF program through
the bundled musl loader, which is what lets a binary built against musl run
inside a Buninu session. It is AArch64-only, as its suffix says — see
[Platform-specific binaries](#platform-specific-binaries) — and the loader it
uses is the APK's `libld-musl.so` when one is present, or
`apps/musl-la/ld-musl-aarch64.so.1` otherwise.

The library path is assembled for you. `musl-la` scans its arguments for the
first file whose leading four bytes are the ELF magic number, and puts that
file's own directory on the search path along with `apps/musl-la/` and
anything already in `LD_LIBRARY_PATH` — so a program with its shared objects
beside it needs no setup. That path normally reaches the loader as
`--library-path`; pass `-e` as the first argument to export it as
`LD_LIBRARY_PATH` instead, which is what a program that goes on to exec
something else of its own needs.

---

`xdg-open <file-or-url>` hands a file or URL to whatever the platform treats
as its default handler: the host app through native-bridge on Android (or
`termux-open` under plain Termux), `open` on macOS, `start` on Windows, and
the real system `xdg-open` on Linux.

Inside minapk's APK, `MINAPK_WEBVIEW` redirects that: set it to a WebView id
and a URL is loaded into that WebView and brought to the front (`openWebView`
then `showWebView`) instead of being handed to the system's default handler.

```sh
# In the app WebView, on screen
MINAPK_WEBVIEW=1 xdg-open https://example.com

# ...or for the whole session
export MINAPK_WEBVIEW=1
```

`0` is the console, so it navigates the terminal page away — the back key
returns to it and jsgotty reconnects, but it is not usually what you want.
`-1` is whichever WebView is in front. Only URLs are redirected: a file path
always goes to the host's own handler, since WebView cannot read a `file://`
URL under Buninu's home (`setAllowFileAccess` is false from API 30 on) while
the host serves that same file through its content:// provider. A value that
is not a plain integer is reported on stderr and ignored rather than guessed
at, an unset or empty value keeps the default behavior, and a WebView the host
does not have falls back to the default handler after saying so.

---

`native-bridge [func] [args...]` calls into the Android host app that
[minapk](https://github.com/jjtseng93/minapk) built the running
APK with, over an abstract-namespace unix socket. A bare `native-bridge`
lists what the host implements. Every call
times out after 5 seconds instead of hanging; outside such an APK, every call
fails with a clear error instead of doing nothing silently. `import { toast,
clipboardRead, clipboardWrite, speak, ttsStatus, openWebView, evalWebView,
showWebView, currWebView, call, available } from
"apps/native-bridge/native-bridge.js"` gives the same functions as a library,
for use from a `js back` block.

`openWebView(id, url)`, `evalWebView(id, js)`, `showWebView(id)` and
`currWebView()` (short: `openwv`, `evalwv`, `showwv`, `currwv`) drive the host
app's WebViews. There are exactly two, both
alive from startup and neither ever created nor closed at runtime: id `0` is
the console — the jsgotty terminal this shell is rendered in — and id `1` is
the app WebView, which starts out blank and behind. Anywhere an id is taken,
`-1` means whichever WebView is in front right now.

`openWebView` loads a URL *without* bringing that WebView to the front, so
loading the app WebView while the user keeps looking at the terminal is one
call. `showWebView` is the only thing that changes what is on screen; the
host's on-screen key bar (Ctrl/Alt/Shift and friends), its volume-key menu and
its back key all act on whichever WebView is in front, so they follow the
switch. Back on the app WebView with no page of its own to go back to
switches to the console rather than leaving the app, unless
`buninu.backToConsole` says otherwise (see "Back key" below).
`showWebView(-1)` switches to the next WebView instead of being a no-op --
with two of them, a toggle. `evalWebView` resolves to the value the
expression produced, not a string containing it; `undefined`, a function, and
a thrown exception all arrive as `null`, since WebView itself does not
distinguish them.

All four also answer to a short `openwv`/`evalwv`/`showwv`/`currwv` spelling,
the same way `clipboardRead`/`clipboardWrite` answer to `getcb`/`setcb`: the
host accepts either and lists both in its `_discover` response, so either name
works from the CLI, from `rpcraw`, and as an `import`.

```sh
# Load it, screen unchanged
native-bridge openwv 1 https://example.com

# Now bring it to the front
native-bridge showwv 1

native-bridge evalwv 1 document.title
native-bridge currwv
```

## Differences from upstream

The versions of jsmdcui and jsgotty bundled here differ from the ones their
own projects ship.

### The bundled jsmdcui

  * Is configured editor-first by `MDCUI_DEFAULT_EDIT`
  * The command `jmi` with a Markdown file opens the normal terminal editor
    (js micro editor)
  * The command `jsmdcui` preserves its original behavior:
    `apps/jsmdcui/jsmdcui.sh`, which starts its `tui` entry point with
    `--mdcui` when running Markdown apps, and forwards all command-line
    arguments
  * Adds the Buninu-only `# syntax: markdown` marker for Markdown highlighting
    in extensionless files; upstreaming may be considered later

### The bundled jsgotty

  * No longer depends on or ships `node-pty`
  * Its PTY is provided by Bun's terminal API

## Optional external tools

`bunproot` is an optional tool downloaded by the user through `bunx` and is
licensed under GPL-2.0-or-later; `js-udocker` is licensed under Apache-2.0.
Neither is distributed with Buninu. 

- `bunproot --git clone` should be cross-platform
  * Tested on Android, Linux, and Windows
- The container example below is Android-only.

```sh
bunx bunproot
bunx bunproot --git clone https://github.com/jjtseng93/bunproot
bunx bunproot --git clone https://github.com/jjtseng93/js-udocker
cd js-udocker
export JS_UDOCKER_BUNPROOT=$(realpath ../bunproot/proot.js)
bun udocker.js run --name=ap alpine
# bun udocker.js ps
```

## Data & Persistence

Running Buninu via `npx` works like a container: `npx` fetches the package into
a cache directory and runs it from there, which is fine as a temporary working
directory but isn't guaranteed to survive between runs — version bumps,
`npx clear-npx-cache`, or normal cache eviction can all wipe it. That directory
is where the shell starts, so nothing left sitting in it is safe.

The answer is to stop running it from there: [install it](#install-and-update)
into a directory of your own, and `BUNINU_HOME` becomes somewhere you can keep
things, edit files in, and carry to another machine.

Once it is installed, files you leave in `BUNINU_HOME` are safe, updates
included — an update only adds and overwrites the package's own files and
never deletes anything else. Your own home directory is untouched and still
reachable as `~`, so work you would rather keep separate from Buninu, or that
is too large to carry around with it, can just as well live there.

Two things live outside `BUNINU_HOME` either way, because they belong to the
machine rather than to Buninu:

- `HOME` stays your own home directory. Buninu never replaces it, so a shell
  started here still finds your SSH keys, your Git configuration, and anything
  else you keep there.
- bunmsh writes its command history to `$XDG_DATA_HOME/bunmsh/history`, or
  `$HOME/.local/share/bunmsh/history` when that is unset. It persists between
  sessions, and by default it stays on the machine it was typed on rather than
  travelling with an installation.

Set [`buninu.xdgDataHome`](#data-directory-optional) to move that history, and
anything else written to the XDG data directory, into the installation so it
travels with it. Keep in mind that a history file records the commands it was
given, so one carried on removable media carries whatever was typed into it.

## Install and update

Copy this installation into a directory that is yours to keep, and run it
from there instead of from the `npx` cache:

```sh
# Creates ~/somewhere/buninu as BUNINU_HOME
npx buninu --install ~/somewhere

# Makes ~/buninu itself BUNINU_HOME, with no directory of its own
npx buninu --strip-install ~/buninu
```

Both default to the current directory. The two differ only in where
`BUNINU_HOME` — the installation's own root, see
[Environment](#environment) — ends up: below the directory you named, or at
it. `npx buninu --install --help` lists every install option in full.

An installation is started the same two ways `npx buninu` is, by running its
own `bin/init.js` instead of the package name:

```sh
# Terminal in a browser, as usual
bun $BUNINU_HOME/bin/init.js

# bunmsh in this terminal (experimental)
bun $BUNINU_HOME/bin/init.js --local
```

Every option described under [Start](#start) works the same way here, `--local`
included; nothing about an installed copy behaves differently from the one
`npx` runs.

Installing over an existing Buninu updates it in place. Files are only added
and overwritten, never deleted, so anything you added of your own is left
alone: your `apps/<name>/` commands, your `bin/*.sh` overrides, the Bun
binaries `bin/bun.sh` extracted, and any working file you left in the tree.

Three files belong to you and to the package at the same time, and are merged
rather than replaced:

| File | What is kept |
|---|---|
| `package.json` | Your `buninu` section. Every other field, `version` included, comes from the new package. |
| `apps/cmdlist` | Command names you added. They are appended below the shipped list. |
| `.bashrc` | Your version, whenever it only adds lines to the shipped one — including lines inserted in the middle. |

When `.bashrc` cannot be merged that way, because a line the package ships was
changed or removed rather than added to, your file is left exactly as it is
and the package's version is written beside it as `.bashrc.dist` for you to
reconcile by hand. Nothing is overwritten silently.

Every other file belongs to the package and is replaced. Before doing that, an
update asks the registry what the installation originally shipped with and
lists the files that no longer match, so editing one of the package's own files
is not quietly undone:

```
buninu: found buninu@0.3.1 at /home/you/buninu
buninu: comparing it against the published 0.3.1 for local changes...
buninu: 1 file(s) differ from buninu@0.3.1 and will be replaced:
  apps/xclip/xclip.js
Update anyway? (y/N)
```

An existing installation is always named, by absolute path, before anything is
written to it — `--force` included, since that one replaces it without asking.

Only `y` continues; anything else cancels and leaves the installation
untouched. The three merged files above are left out of that list, since they
are already kept. `--yes` answers for you, which is also what a script or any
other run without a terminal needs. Nothing about this is recorded inside the
installation: the published package is the reference, so the check needs the
network, and when it cannot run the update says so and goes ahead.

Three more things are worth knowing about:

- Installing from a checkout that already carries changes made since its
  version was published — that is, while working on Buninu itself — compares
  the installation against a reference its own files no longer match, so the
  list names those unreleased changes rather than anything you did. Cloning it
  and adding your own files on top does not.
- A file the package **stopped** shipping is not removed from an existing
  installation, because an update never deletes. Stale files accumulate
  across updates.
- `--force` skips both the merge and the check, and installs the shipped
  versions over yours. It is also what installs into a non-empty directory that
  is not a Buninu installation, which is otherwise refused — by absolute path,
  saying which check the directory failed.

Whether a directory counts as an installation to update is decided by the name
in its `package.json`. An installation that has lost files, `bin/init.js`
included, is a damaged one rather than somebody else's directory, so installing
over it repairs it and still merges your configuration back in.

A source checkout's own `.git` is never copied into an installation, so
installing into a directory that is itself a repository leaves that repository
alone.

## Export

Export a Buninu installation as a gzip-compressed tar archive. What gets
exported is the installation the command runs from, so run it from your own
installation to capture your configuration, added commands and edited
`.bashrc` along with it:

```sh
# Everything in this installation, as ./buninu.tgz
bun $BUNINU_HOME/bin/init.js --export

# ...to a path of your choosing
bun $BUNINU_HOME/bin/init.js --export /path/to/buninu.tgz
```

Run it through `npx` instead and you get an archive of the freshly downloaded
package, with none of that — useful for a clean copy, not for a backup:

```sh
npx buninu@latest --export
```

The default output is `./buninu.tgz`. The archive contains exactly one
top-level directory so consumers can remove one component while extracting.
Export requires `tar` in `PATH`; when replacing an existing output,
Buninu restores the previous file if archive creation or replacement fails.

Export this `package.json` on its own, instead of the whole installation. The
same distinction applies — run it from your installation to get your settings,
through `npx` to get the defaults:

```sh
# The buninu section as you have configured it, as ./buninu.json
bun $BUNINU_HOME/bin/init.js --export-config

# ...to a path of your choosing
bun $BUNINU_HOME/bin/init.js --export-config /path/to/buninu.json

# The package's own defaults instead
npx buninu@latest --export-config
```

The default output is `./buninu.json`. This is the full `package.json` (not
just the `buninu` section), so the output is ready to use as-is anywhere a
complete replacement `package.json` is expected.

A tarball made this way is also the simplest backup to take before an update
that is going to replace files you edited; see
[Install and update](#install-and-update).

## Environment

`BUNINU_HOME` is the absolute path to the installed Buninu package root.
The jsgotty process, startup command, and interactive shell start with this
directory as their working directory. Buninu also appends
`$BUNINU_HOME/bin` to `PATH` (`Path` on Windows).

Buninu preserves inherited environment variables and supplies these fallbacks:

- `HOME`: inherited value; when unset, the operating system's own home
  directory for the current user (`USERPROFILE` on Windows), falling back to
  `BUNINU_HOME` only if that is unavailable too.
- `TMPDIR`: inherited value; on Android, use the app cache directory when it
  exists or `$BUNINU_HOME/tmp` otherwise; on other platforms, use the system
  temporary directory.
- `SHELL`: inherited value, or a detected platform-appropriate shell.
- `XDG_DATA_HOME`: inherited value, unless `buninu.xdgDataHome` names one; see
  [Data directory](#data-directory-optional).
- `TERM`: `xterm-256color` when unset.
- `COLORTERM`: `truecolor` when unset.

The Buninu Android APK launcher also supplies user-aware external-storage
paths obtained from Android APIs:

- `PKG_DDIR`: `/storage/emulated/<user-id>/Android/data/<package>`.
- `PKG_MDIR`: `/storage/emulated/<user-id>/Android/media/<package>`.
- `PKG_BRIDGE_SOCK`: the `native-bridge` unix socket, when the host app
  wires one in; see `native-bridge` above.

## Add a command

On POSIX systems, Buninu exposes its commands through the multicall
`shloader`. The command names are listed one per line in `apps/cmdlist`:

```text
# syntax: markdown

# Lines beginning with # are comments
glow
jsgotty
jsmdcui
```

Blank lines and comment lines are ignored. Keep comments on their own lines;
inline comments are not supported. Command names may contain ASCII letters,
digits, `.`, `_`, and `-`, and must begin with a letter or digit.

For example, to add a command named `hello`, create
`apps/hello/hello.js`:

```js
console.log("Hello from Buninu");
```

Then add its name to `apps/cmdlist`:

```text
hello
```

Restart Buninu normally. During startup, `bin/init.js` reads the list and
rebuilds `bin/hello` as a symbolic link to `shloader`. The command is then
available from the Buninu shell:

```sh
hello
```

The multicall loader looks for an implementation in this order:

```text
bin/hello.sh
apps/hello/hello.sh
apps/hello/hello.js
apps/hello/hello.mjs
apps/hello/hello.ts
apps/hello/hello.mts
```

Running only an information option such as `--help` or `--version` does not
rebuild links; start Buninu normally at least once after changing the list.
Windows does not use these POSIX symbolic links. To expose the same command
on Windows, also provide `bin/hello.bat`, for example:

```bat
@echo off
call "%~dp0bun.bat" "%~dp0..\apps\hello\hello.js" %*
exit /b %ERRORLEVEL%
```

### Platform-specific binaries

A bundled binary that only runs on one platform and architecture carries a
two-letter suffix: the platform first, then the architecture.

| Suffix | Platform | Architecture |
|---|---|---|
| `la` | Linux | arm64 |
| `lx` | Linux | x64 |
| `aa` | Android | arm64 |
| `wx` | Windows | x64 |
| `ma` | macOS | arm64 |

So `bin/bun.sh` picks `bun-la`, `bun-lx` or `bun-wx.exe` for the machine it
finds itself on, and `musl-la` is the Linux/arm64 ELF loader — on any other
platform there is nothing for it to load. A name without a suffix is
portable: `hello.js` above runs wherever Bun does.

One binary is deliberately outside the scheme. `bin/libsh-loader.so` is
Android/arm64 and would otherwise be `-aa`, but Android extracts and executes
only files named `lib*.so` from an APK's native library directory, so that
name belongs to the platform rather than to this convention.

## Startup command (optional)

Set `buninu.command.default` or a platform-specific value (`android`, `linux`,
or `windows`) in `package.json` to run a complete shell command from
the directory containing `package.json`. The platform value takes precedence
over `default`. After the command finishes—successfully or unsuccessfully—the
terminal returns to an interactive shell.

```json
{
  "buninu": {
    "command": {
      "default": "echo Welcome to Buninu",
      "android": null
    }
  }
}
```

For compatibility, `"command": "..."` is also accepted as a shared command
for every platform.

The command runs in a subshell, and the interactive shell that follows is a
fresh one, so anything it defines rather than does — aliases, functions, shell
variables — is gone before you reach a prompt. Use it to run something, print
something, or start something; a startup file that configures the session is a
job for the shell itself, through `ENV` for the shells that honor it.

It applies to the browser terminal only. `--local` does not run it, so a
`bunmsh` session starts with nothing from this setting; see
[Start a local shell in a Terminal](#start-a-local-shell-in-a-terminal-experimental).

Override it for one run with:

```sh
bun ./bin/init.js --command "echo temporary command"
```

Set `buninu.exitAfterCmd` to `true` to exit once `buninu.command` finishes
instead of falling back to an interactive shell. It defaults to `false`,
which is the current fall-back-to-shell behavior described above.

```json
{
  "buninu": {
    "command": { "default": "echo Welcome to Buninu" },
    "exitAfterCmd": true
  }
}
```

## Shell selection (optional)

Set `buninu.shell.default` or a platform-specific value (`android`, `linux`,
or `windows`) in `package.json`. A relative shell path is resolved
from the directory containing `package.json`.

```json
{
  "buninu": {
    "shell": {
      "default": null,
      "android": "../bunmsh/bunmsh"
    }
  }
}
```

Use `--shell <path-or-name>` for a one-time override.

## Data directory (optional)

Set `buninu.xdgDataHome` in `package.json` to point `XDG_DATA_HOME` somewhere
of your choosing. `true` puts it inside the installation, at
`$BUNINU_HOME/.local/share`:

```json
{
  "buninu": {
    "xdgDataHome": true
  }
}
```

A string names a directory instead, resolved from the directory containing
`package.json` when it is relative:

```json
{
  "buninu": {
    "xdgDataHome": "/mnt/usb/shared-data"
  }
}
```

The directory is created at startup if it does not exist. Leave the setting
`null` and `XDG_DATA_HOME` is passed through from the environment untouched.

What this actually moves is where XDG-aware programs keep their data, and
**bunmsh's command history is the one that matters here**: it lives at
`$XDG_DATA_HOME/bunmsh/history`, so `true` is what makes a shell's history
travel with a copied installation instead of staying on the machine.

`HOME` is deliberately left alone by this setting. A shell started under
Buninu keeps pointing at your own home directory, so SSH keys, Git
configuration and anything else kept there still work, and bunmsh can still
import the `~/.bash_history` or fish history you already had.

## Back key (Android, optional)

Set `buninu.backToConsole` in `package.json` to decide what the Android host
app's back key does while the app WebView (id `1`, see `native-bridge` above)
is in front and has no page of its own left to go back to. It defaults to
`true`: back switches to the console WebView, leaving the app WebView loaded
and running behind it. Set it to `false` and back leaves the app instead.

```json
{
  "buninu": {
    "backToConsole": false
  }
}
```

This one is read by the host app, not by Buninu itself, so it does nothing
outside an APK built with
[minapk](https://github.com/jjtseng93/minapk) — where it can also
be set for a single build with `--no-back-to-console`. The host treats a
missing, unreadable, or non-boolean value as `true`, so nothing here can fail
in a way that leaves the back key broken.

## Process-list helpers

The bundled `.bashrc` provides `pspa` (`ps -eo pid,args`) and `pspac`, which
writes that process list to `$HOME/.pspidargs.sh` and displays it with `glow`.
Buninu preserves an existing `HOME` rather than replacing or modifying the
user's home, and points `ENV` at the bundled file. Whether that file is read
depends entirely on the shell:

| Where | Shell | The bundled `.bashrc` |
|---|---|---|
| Android, including a minapk APK | `/system/bin/sh`, which is mksh | Loaded through `ENV`; all of these aliases work |
| Linux and macOS | Bash, usually | Not loaded — an interactive Bash reads `$HOME/.bashrc` and ignores `ENV` |
| Windows | PowerShell, or `cmd.exe` | Not loaded, and these aliases would not carry over: listing processes is spelled differently there |
| `--local` | bunmsh | Not loaded, and not needed: bunmsh answers all five names itself |

So Android gets these aliases without doing anything, and everywhere else the
bundled file sits unread — which also means your own `$HOME/.bashrc` is left
entirely alone.

Under `--local` these are bunmsh's own, not aliases read from a file, so they
work with nothing sourced — and the two process helpers are not quite the same
two commands. `pspa` prints the same PID-and-command-line table, but through
bunmsh's own process query, which also answers on Windows, where
`ps -eo pid,args` has no counterpart. `pspac` colours that table inline as
shell syntax: it writes no `$HOME/.pspidargs.sh` and does not need `glow`.
Both are PATH-fallback builtins, so a real `pspa` or `pspac` on `PATH` still
wins and `builtin pspa` selects bunmsh's explicitly. Its `ls`, `grep` and
`diff` colour aliases are built in as well, which is why nothing in the bundled
file is missing from a `--local` session. See
[bunmsh's PATH-fallback builtins](apps/bunmsh/README.md#path-fallback-builtins).

On Windows the two *aliases* do not apply. Both wrap `ps -eo pid,args`, and
that invocation has no counterpart: PowerShell does have `ps`, but as an alias
for `Get-Process`, which takes its own options rather than those. List
processes with `Get-Process` in PowerShell, or `tasklist` in `cmd.exe` — or use
`--local`, where bunmsh's builtins of the same names answer by querying
`Win32_Process` through PowerShell and print the same two columns.

To get the aliases in a POSIX session that did not load them, source the file
from the prompt:

```sh
. "$BUNINU_HOME/.bashrc"
```

Source it from the prompt rather than putting that line in your own
`$HOME/.bashrc`: `BUNINU_HOME` is only set inside a Buninu session, so
elsewhere the same line reads `. "/.bashrc"` and every shell you open either
complains or, if that file happens to exist, sources something you did not
mean to.

That is for a Bash or mksh session that did not load the file — the remote
route on Linux and macOS. A `--local` session has no reason to source it, since
bunmsh defines all five names itself. Sourcing it there anyway still reports
`alias: pspac: invalid alias` and carries on: a bunmsh alias is a list of
words, and `pspac` is two commands joined by `;` with a redirection in the
first, so it cannot be one — but the builtin of that name is already there, and
an alias that fails to define leaves it reachable. See
[Start a local shell in a Terminal](#start-a-local-shell-in-a-terminal-experimental).

## Why

- The usual way to get a Unix
  environment onto a machine
  * A system package manager
  * A compiler
  * On Android or Windows,
    you install Linux first:
    WSL, or a proot distro

- Buninu's way: everything it
  needs is JavaScript on Bun
  * Nothing to build
  * Nothing installed
    system-wide
  * The bundled jsgotty
    dropped `node-pty` for
    Bun's own terminal API
  * So the same tree runs
    unchanged on a phone, a
    laptop and a server

- Not a bare runtime either
  * An editor and Markdown
    runtime
  * A clipboard tool
  * Text-to-speech
  * ZMODEM file transfer
  * An `xdg-open` that knows
    each platform's real
    handler

- An installation is one
  directory
  * Yours to edit
  * Copy it to another machine
    and your shell, the
    commands you added and
    your history go with it
  * Your own `$HOME` is never
    touched — a shell started
    here still finds your SSH
    keys and Git configuration

## Contents

- [Install Bun](#install-bun)
- [Start](#start)
  * [Start a remote shell in a Browser](#start-a-remote-shell-in-a-browser)
  * [Start a local shell in a Terminal (experimental)](#start-a-local-shell-in-a-terminal-experimental)
- [Security](#security)
- [Command-line usage](#command-line-usage)
  * [Launching a bundled app directly](#launching-a-bundled-app-directly)
- [Commands inside the shell](#commands-inside-the-shell)
- [Differences from upstream](#differences-from-upstream)
- [Optional external tools](#optional-external-tools)
- [Data & Persistence](#data--persistence)
- [Install and update](#install-and-update)
- [Export](#export)
- [Environment](#environment)
- [Add a command](#add-a-command)
  * [Platform-specific binaries](#platform-specific-binaries)
- [Startup command (optional)](#startup-command-optional)
- [Shell selection (optional)](#shell-selection-optional)
- [Data directory (optional)](#data-directory-optional)
- [Back key (Android, optional)](#back-key-android-optional)
- [Process-list helpers](#process-list-helpers)
- [Why](#why)
- [License](#license)

## License

Buninu's own code is MIT — see [LICENSE](LICENSE).

The apps bundled under `apps/` are separate projects on their own terms, and
each carries its licence with it:

| App | Licence | Files under `apps/<app>/` |
|---|---|---|
| jsgotty | MIT; its bundled front-end libraries are MIT and Apache-2.0 | `LICENSE`, `NOTICE`, `LICENSES/`, `static/js/gotty.licenses.txt` |
| jsmdcui | MIT | `LICENSE`, `runtime/syntax/LICENSE` |
| bunmsh | MIT; mksh's own terms are not relicensed under it | `LICENSE`, `LICENSE-MKSH`, `LICENSE-MICRO` |
| musl-la | MIT for musl itself, and see below | `LICENSE_musl.txt`, `NOTICE`, `LICENSES/` |

One component is worth naming here rather than leaving in a file to be found:
`apps/musl-la` ships `libgcc_s.so.1` and `libstdc++.so.6`, built from GCC
14.2.0, under **GPL-3.0 with the GCC Runtime Library Exception**. That
exception is what lets them be distributed alongside code under any licence,
so nothing here changes Buninu's own MIT terms — but if your organisation
screens for GPL, this is the component it will find. `apps/musl-la/NOTICE`
records the exact build, its Corresponding Source, and SHA-256 sums for every
binary in that directory.
