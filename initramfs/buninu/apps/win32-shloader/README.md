# Minimal Windows shell launcher

Generate Windows executables on Linux, Android, macOS or Windows using only Bun
and the checked-in JavaScript files. No compiler, downloaded executable, native
binding, or hardlink is needed to generate them.

From the buninu repository:

```sh
bun apps/win32-shloader/index.js
```

This writes `apps/win32-shloader/build/x64/shloader.exe` and
`apps/win32-shloader/build/arm64/shloader.exe`. The x64 launcher is 2,560 bytes; ARM64 is 3,072 bytes. To generate one
launcher with a particular name:

```sh
bun apps/win32-shloader/index.js --arch=x64 --out=apps/win32-shloader/build/example/bin/jmi.exe
```

The executable uses its own location and name to launch:

```text
bin/jmi.exe
  -> bin/bun-wx.exe (x64) or bin/bun-wa.exe (ARM64)
  -> apps/bunmsh/index.js bin/jmi.sh [original arguments]
```

All three paths passed to Windows/Bun are absolute. The required layout is:

```text
bundle/
  bin/bun-wx.exe   # x64 loader
  bin/bun-wa.exe   # ARM64 loader
  bin/jmi.exe
  bin/jmi.sh
  apps/bunmsh/index.js
```

Copy or generate the same launcher as another command's `.exe` to run that
command's neighboring `.sh`. If that script is absent, it runs `multicall.sh`
from the same directory, matching the native `libsh-loader` fallback. If neither
script exists, it exits with 127. Windows resolves the executable first; the
launcher uses its absolute module path rather than searching PATH a second time.
Existing `.sh` dependencies must also be installed.
The launcher does not interpret shell scripts itself. It does not invoke CMD or
PowerShell, nor does it serialize arguments to a temporary file: it prefixes the
interpreter and script paths, then retains the original Windows command-line
tail verbatim for Bun to parse. Embedded NUL is not representable in Windows
command lines; the completed command line must fit the Windows UTF-16 limit.

Environment, working directory and standard streams are inherited. Valid standard
handles are duplicated as inheritable handles without changing the original
handles' flags. The parent closes these duplicates immediately after creating
the child, so they cannot keep redirected pipes open while it waits. The launcher
sets `BUNINU_SH_CALLER` to its original absolute executable path. The updated
`multicall.sh` consumes and unsets this internal variable to identify the command
without `/proc`, stripping `.exe`, and uses bunmsh for nested shell scripts.
Its existing `.sh`, `.js`, `.mjs`, `.ts`, `.mts` application dispatch order stays
the same. The conventional Android/Linux `/proc` path is retained.
The launcher
waits and returns the child's exit code. It handles console Ctrl-C/Break itself
while allowing the child to receive those console events normally. It does not
add a Job Object or guarantee descendant cleanup if the launcher is forcibly
killed. CreateProcess failures return the Windows error code and a short stderr
message; command-line overflow returns 206.

## Scope

On Windows, `bin/init.js` prepares these launchers at the native-link setup
stage, before starting either the regular child or a direct app. It copies the
currently running Bun to `bin/bun-wx.exe` (x64) or `bin/bun-wa.exe` (ARM64), and
builds the commands in `apps/cmdlist` plus `bin/bun.exe` for that Bun process's architecture.
The Bun launcher uses the same native code with a fixed direct mode: it forwards
to the adjacent runtime without invoking bunmsh, a shell script or CMD.
This requires `process.platform === "win32"`; `WINDIR` alone never enables it.
Copies are ordinary files, never hardlinks. A small `bin/.win32-runtime.json`
metadata file avoids copying an unchanged runtime on every startup. Missing
files are repaired; unrelated existing command executables are rejected.
Direct app options use the generated EXE, bypassing CMD argument parsing.
Information-only options do not provision files.

When using the generator independently, provision the matching Bun beforehand: unlike `bun.bat`, this minimal launcher performs no archive extraction,
update check, or PATH fallback. Do not overwrite either Bun executable with a launcher. The generator chooses
the Bun filename from `--arch`, not the host running the generator.

## Verification

```sh
bun test apps/win32-shloader/test
```

On non-Windows hosts this checks both PE architectures and assembly source
hashes, and skips the native execution tests. On Windows it also checks literal
argument forwarding (including empty strings, quotes, backslashes, Unicode,
shell metacharacters, CR/LF, and a 12,000-character argument), 150 randomized
argument arrays, streams, cwd/environment inheritance, child exit status,
buffer limits, missing Bun, companion priority and multicall fallback.

To additionally execute the real `multicall.sh` on Windows, set
`BUNINU_TEST_BUNMSH` to the installed bunmsh `index.js` before running the tests.
This covers all five application suffixes with literal argument forwarding.

Windows x64 / Bun 1.4.2: the loader tests and real multicall integration passed
on 2026-11-24. A separate smoke test
using the actual buninu bunmsh and unmodified `jmi.sh` produced the same Markdown
outline as `jmi.bat`; the actual bunmsh also preserved the special argument set.
ARM64 output has passed static checks only, not native Windows ARM64 execution.

For the same small Markdown outline, 2 warmup rounds followed by 20 interleaved
measurements per route gave these medians on that Windows machine:

| Route | Median |
| --- | ---: |
| Existing `jmi.bat` | 160.4 ms |
| Direct Bun + bunmsh + `jmi.sh` | 124.4 ms |
| New EXE + bunmsh + `jmi.sh` | 141.2 ms |

The EXE fixture used a normal copy of the same Bun executable and small import
wrappers pointing at the existing application sources. These are warm-cache
end-to-end measurements, not an isolated measurement of native loader overhead
or a cold-start guarantee.

## Maintaining the instruction templates

`x64.S` and `arm64.S` are the small native implementations. `code.js` contains
their instruction bytes, relocation descriptions and source hashes. The JS PE
writer supplies imports, constant strings and zero-initialized buffers.

After editing assembly, maintainers can regenerate `code.js` using a Clang build
with x86-64 and AArch64 assembler support:

```sh
bun apps/win32-shloader/refresh-code.js
```

That maintainer step requires Clang; normal executable generation does not.

Generate the direct Bun launcher independently with `--mode=bun`; the default
`shell` mode remains the tool launcher. PATH order is unchanged: existing PATH
entries still take priority over Buninu bin. Within bin, EXEs take priority over
the retained BAT launchers with the standard Windows PATHEXT ordering.
