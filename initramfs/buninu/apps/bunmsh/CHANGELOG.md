# Changelog

All notable user-visible changes to bunmsh are documented here.

## [0.3.6] - 2026-09-15

### Added

- Accept a leading `&` as a PowerShell-compatible call operator on Windows,
  or on any platform when `BUNMSH_LEADING_AND` is set before bunmsh starts.
  This lets commands sent by VS Code's Play action run inside an already-open
  bunmsh session, such as `& 'C:\Python313\python.exe' script.py`.

## [0.3.5] - 2026-09-09

Version 0.3.4 was intentionally skipped because the number four is considered
unlucky in Chinese culture, so this release advances directly from 0.3.3 to
0.3.5.

### Fixed

- Point the npm `bunmsh` bin at a new package-root `index.js` trampoline,
  which immediately loads the real `src/main.js` entry point. On affected Bun
  versions, validating a bin target below the package root goes through
  `openat2`; Android can reject that syscall with `SIGSYS`, leaving an
  otherwise successful install without its bin link. Keeping the declared bin
  target at the package root avoids that path while preserving `src/main.js`
  as the implementation entry point.

- Make the test suite portable between native Android and PRoot. Redirect
  tests now create isolated directories below `os.tmpdir()` instead of
  assuming `/tmp` is writable or empty, terminal assertions compare visible
  text after `Bun.stripANSI()` instead of requiring one exact repaint
  sequence, and true terminal behaviour is exercised through `Bun.Terminal`.
  Negative-DNS curl checks run in parallel and have explicit timeouts because
  PRoot resolution takes about five seconds while native Android returns
  immediately.

### Changed

- Split the former `shell.test.js` into `shell1.test.js`, `shell2.test.js`, and
  `shell3.test.js`, and run test files with `bun test --parallel=4`. This keeps
  the suite isolated and stable while reducing the measured run from roughly
  37 to 17 seconds under PRoot and from roughly 23 to 9 seconds on native
  Android. Test-case-level `--concurrent` is deliberately not used because
  cwd-changing and PTY tests share process-global state.

## [0.3.3] - 2026-09-03

### Fixed

- Pass `--color` rather than `--color=auto` in the default `diff` alias.
  Toybox's `diff` — the one Android answers `/system/bin/diff` with — spells
  the option without a `=WHEN` argument and rejects the longer form outright
  (`diff: Unknown option 'color=auto'`, status 2), so an unqualified `diff`
  produced an error instead of a comparison. GNU diffutils accepts either
  spelling, so nothing changes where that is the `diff` on `PATH`. The `ls` and
  `grep` aliases keep `--color=auto`, which both of those do accept.

  BusyBox `diff` has no colour option under either spelling and answers
  `diff: unrecognized option: color`. Override the alias with `alias diff=diff`
  where `diff` is BusyBox, as it is on Alpine.

## [0.3.2] - 2026-09-01

### Added

- Bind `$` to the shell's variable table inside the highest-priority
  JavaScript mode, so the two languages share one set of variables rather than
  passing strings across a boundary. `Bun.e, $.HOME` reads one — exported or
  not — `$.TAG = "v1"` writes one that later shell commands and external child
  processes both see, `delete $.NAME` unsets one, and `Object.keys($)`
  enumerates them. It is the live table rather than a copy, which is what makes
  a write visible immediately; it also means a write bypasses `readonly`, so
  `$` is an escape hatch as much as a convenience. Bun Shell's own `Bun.$` is
  reached through the `Bun` object and is unaffected by the binding. Values
  are shell values, so they are strings: `$.X + 1` concatenates unless
  converted, and assigning a non-string stores it as-is, leaving JavaScript
  with a number under that name while every name the shell set stays a string.
  The README says so with examples.

- Complete shell variable names. Typing `$HO` now ghosts `$HOME` and Tab
  offers every matching name; `${HO` completes to `${HOME}`, closing the brace
  it opened, and `${#HO` does the same. Names come from the shell's own
  variable table, so unexported names — and anything JavaScript mode wrote
  through `$` — are offered alongside the environment. It applies wherever an
  expansion would happen (mid-word, after `X=`, inside double quotes, and in
  command position), stays quiet inside single quotes, and is not offered for
  the other things a `$` can start: `$(`, `$?`, `$1`, `$$`, and a
  backslash-escaped `\$` (the backslashes are counted, so `\\$HO` still
  suggests). A bare `$` ghosts nothing but still lists everything on Tab, the
  way an empty word lists every file. Where both apply, the history ghost still
  wins, since it completes the whole line.
- Complete command names inside `$(`. A command substitution starts a new
  command, but the completer used to read `$(l` as one long word and look for
  a file by that name; it now offers commands there, and files after the
  command, the way it does at the start of a line.

- Complete on a JavaScript line too, reading it as JavaScript rather than as
  shell text. After `$.` it offers shell variable names, and inside an unclosed
  string literal it completes the text back to the opening quote as a path —
  so `Bun.file("/tm` completes without the trailing space that used to be
  needed to make the completer see a path at all, and without trimming that
  space back off afterwards. A template's `${...}` counts as code again, so
  `$.` completes inside it. A bare `$` completes nothing there, since in
  JavaScript it is the variable table itself and a name only begins after the
  dot. Where neither applies only the history ghost is offered.

### Fixed

- Stop asking a JavaScript line to continue when it cannot. A line ending in a
  bare backslash used to get the shell's PS2 prompt, but a backslash outside a
  string literal is a syntax error in JavaScript, so whatever was typed next
  was guaranteed not to parse. An unterminated string or template still
  continues, because that is JavaScript's own line continuation and the
  evaluator does accept it — `Bun.e, "abc\` and `def"` on two lines prints
  `abcdef`. The rule that decides JavaScript mode is now one exported
  function, so the prompt, the completer and the evaluator cannot disagree
  about what a line is.

## [0.3.1] - 2026-09-01

### Added

- Ship `LICENSE`, `LICENSE-MKSH`, and `LICENSE-MICRO` as packaged assets, so
  a standalone executable carries them the way it already carried the README
  and this changelog. It matters for `LICENSE-MICRO` in particular: the binary
  contains the highlighting rules transcribed from micro's
  `runtime/syntax/sh.yaml`, and an MIT notice has to travel with the code it
  covers, not only with the repository. Reading them back out of a build is
  `--assets-extract` on the tar back end, or `builtin serve 'B:/~BUN'` on an
  `ASSETS_BUNFS=1` one; both land the licences under
  `assets/bunmsh@<version>/`, and the README's licence section says so.

### Changed

- Say plainly in the README and in `LICENSE-MICRO` that `catfancy` takes five
  of micro's `monokai.micro` colour-links for its JSON, rather than only that
  its colours happen to be the same five values. The palette was taken from
  micro, so the attribution now says so.

## [0.3.0] - 2026-09-01

### Added

- Add a `curl` PATH-fallback builtin implemented on Bun's own `fetch`, so a
  device that ships no `curl` binary can still run the download and API
  scripts that expect one. A real `curl` in `PATH` still wins;
  `builtin curl ...` selects this one. A URL with no scheme gets one —
  `http://`, or `https://` when the port is `443`, or whatever
  `--proto-default` names — so `curl localhost:8080` and `curl example.com`
  behave the way they do with the real curl.
  - Downloads: `-o`, `-O`, `-J`, `--output-dir`, `--create-dirs`, `-a`, and
    `-C -`/`-C OFFSET` resume, which sizes the partial file, asks for the rest
    with a `Range` header, appends when the server answers `206`, rewrites when
    a `200` says the range was ignored, and treats `416` as "already complete".
  - Request bodies: `-X`, `-H` (including curl's `'Name;'` empty-value and
    `'Name:'` removal forms), `-d`, `--data-raw`, `--data-binary`,
    `--data-ascii`, `--data-urlencode`, `--json`, `-G`, `-F`,
    `--form-string`, `-T`, `-u`, `--oauth2-bearer`, `-A`, `-e`, `-b`, `-r`,
    `--compressed`, and `-x`, with `@file` and `@-` reading a body from a file
    or from stdin — enough to call a JSON API such as OpenAI's chat
    completions endpoint from the shell.
  - Responses and reporting: `-i`, `-I`, `-D`, `-w` with the usual
    `%{variable}` set, `-L` with `--max-redirs` and the `301`/`302`/`303`
    POST-to-GET rule, `-f`, `--fail-with-body`, `-k`, `-m`,
    `--connect-timeout`, `--retry` and friends, `-s`, `-S`, `-v`, `-#`, and a
    curl-shaped progress meter that appears only when the body is not being
    painted on the terminal. curl's exit codes are reproduced, including `22`,
    `6`, `7`, `28`, `47`, `60`, and `2`.
  - Short clusters parse the way curl's do, so the invocations packaging
    scripts use — `-kLO`, `-C - -kLO`, `-fsSL`, `-kfsS`, `-#k` — work
    unchanged. TLS-material and connection-tuning options (`--cacert`,
    `--cert`, `--interface`, `--limit-rate`, `-4`, `--http2`, and the rest)
    are parsed and then ignored so a script does not die on them.
  - Bodies stream, so `curl -N` on a server-sent-events endpoint prints each
    chunk as it arrives and a large download never buffers in memory.
  - `test/reference.test.js` compares the builtin against the system `curl`
    over a local server: bodies, exit codes, redirect handling, request bodies,
    and `--write-out` output are byte-for-byte identical, and `-i` matches once
    header order and casing — which `fetch` does not preserve — are normalised.

- Add a `pspa` PATH-fallback builtin that lists every process as a PID and its
  full command line, so a device with no process viewer still has one. POSIX
  runs `ps -eo pid,args` and passes its output through untouched — reading it
  over a pipe is also what stops procps from cutting long command lines at the
  terminal width. Windows, which has no `ps`, queries `Win32_Process` through
  PowerShell and lays the same two columns out itself, using the image name
  for a system process that reports no command line. It takes no options; pipe
  it into `grep` to narrow the listing and into `kill` to act on it.
- Add `pspac`, the same process listing with the PID and the command line
  coloured. The COMMAND column is a shell command line, so it is highlighted
  as one, following micro's `syntax/sh.yaml` rules and its
  `colorschemes/monokai.micro` colour-links — the palette `catfancy` already
  uses — down to its region handling (a `#` inside a quoted argument does not
  open a comment) and its rule precedence (`--cat` is a flag, not the
  coreutils `cat`). Two things a listing needs that a script does not: the
  directory in front of the program is dimmed, and the program's own name is
  coloured as a command whether or not sh.yaml's word lists have heard of it.
  Like `catfancy` it always colours; strip the colour from its output and
  `pspa`'s is what remains, which is what its tests assert.
- Add `LICENSE-MICRO` and a "Syntax highlighting" section under the README's
  licence heading, covering what the colouring inherits from
  [micro](https://github.com/zyedidia/micro): `pspac` transcribes the rules of
  its `runtime/syntax/sh.yaml` (MIT "Expat", Copyright (c) 2020: Zachary
  Yedidia, et al.), and both `pspac` and `catfancy` paint with the
  colour-links of its `runtime/colorschemes/monokai.micro` (micro itself: MIT,
  Copyright (c) 2016-2020: Zachary Yedidia, et al.), which renders Wimer
  Hazenberg's Monokai palette. No micro file is bundled, but the rules are
  transcribed from one, so the licence notice ships with them.

### Fixed

- Make `kill` work on Windows. It went through the runtime's `process.kill`,
  which there turns SIGTERM, SIGINT, and SIGKILL into an unconditional
  `TerminateProcess`, refuses every other signal name outright, and in no case
  reaches the target's children. A terminating signal is now sent as
  `taskkill /PID PID /T /F` — the form bun-taskmgr verified on Windows 11 —
  so every signal name works and a process tree goes down with its root. The
  name is still not honoured as a signal, because Windows has none to deliver;
  `-0` continues to probe through the runtime, since `taskkill` has no way to
  ask whether a PID exists without killing it.

## [0.2.0] - 2026-08-29

### Added

- Add `SERVE_AUTO_OPEN`, `SERVE_MINAPK_WEBVIEW`, and `SERVE_RANDOM_URL` plus
  overriding `serve` CLI flags for opening the server (cross-platform, with
  `xdg-open` on PATH preferred), targeting the npm `buninu` package's app
  WebView, and protecting it behind a high-entropy random URL prefix.
- Add repeatable `--exclude PATTERN` and `--exclude=PATTERN` filtering backed
  by `Bun.Glob` to the `cat` and `catfancy` fallback builtins for concatenating
  expanded file sets.
- Add JS/TS syntax coloring to `catfancy`: `.js`/`.mjs`/`.cjs`/`.jsx` and
  `.ts`/`.mts`/`.cts`/`.tsx` files are wrapped in a fenced ` ```javascript `/
  ` ```typescript ` block and rendered through the same `Bun.markdown.ansi`
  path Markdown gets, reusing its code-block highlighter rather than adding
  one. The fence is widened past the longest run of backticks already in the
  source, so a file containing its own triple-backtick text can't prematurely
  close it.
- Add bracketed-paste support to the interactive prompt. A paste containing a
  newline no longer gets read back a physical line at a time (which broke any
  `\`-continued command in it, since each line ran on its own the instant its
  line-ending arrived); it now resolves as a single already-typed line, going
  through the same continuation/execute path Enter does, so a whole
  multi-command, `\`-continued tutorial block can be pasted and run as-is. A
  paste's own line-ending convention — `\n`, `\r\n`, or a bare `\r` (some
  terminals use it for pasted content, even though bunmsh's parser otherwise
  treats a standalone `\r` as whitespace) — is normalized before anything
  downstream sees it. A single-line paste is unaffected. Independent of
  `--mouse`/`BUNMSH_MOUSE`.

### Fixed

- Recognize a line ending in a bare trailing backslash as an interactive
  continuation request. Previously, typing `echo hi \` and pressing Enter ran
  it immediately as `echo`, `hi`, `\` instead of showing the PS2 prompt and
  waiting for the next line, because the interactive line-by-line `pending`
  buffer only had the lone `\` at that point — the following `\n` that the
  existing backslash-newline splice looks for hadn't been typed yet.

## [0.1.11] - 2026-08-28

### Added

- Add a `tac` PATH-fallback builtin for reversing newline-delimited records
  from files or stdin while preserving their bytes and separators.
- Add asset-backed `-h` and `--help` output for documented regular and fallback
  builtins. Help lives as Markdown under `help/`, starts at level-two headings,
  and renders through `Bun.markdown.ansi` with terminal hyperlinks enabled.
- Add the `catfancy` PATH-fallback builtin. Previewable data formats are
  parsed and emitted as colorized pretty JSON; Markdown is rendered with
  `Bun.markdown.ansi` and hyperlinks enabled, while unrecognized formats pass
  through unchanged.

### Fixed

- Normalize CRLF source to LF at every shell-language input boundary, covering
  script files, stdin, `-c`, interactive continuation, command substitutions,
  compound syntax, quoted text, and here-documents. A standalone carriage
  return remains untouched.
- Treat backslash followed by either LF or CRLF as a line continuation before
  token recognition. This supports indented multi-line command invocations
  without introducing empty arguments, including `enter_rootfs.sh`-style
  multi-line `exec` commands.
- Stream top-level compound-command output directly to the terminal. An
  interactive program launched by `exec` inside `if`, loops, or other compound
  syntax previously inherited stdin but had stdout and stderr buffered until
  it exited, making an entered rootfs appear to hang with a blank screen.

## [0.1.10] - 2026-08-27

### Added

- Add `<<`/`<<-` here-documents. An unquoted, unescaped delimiter expands
  parameters, command substitution, and arithmetic in the body like a
  double-quoted string; a quoted or backslash-escaped delimiter (`<<'EOF'`,
  `<<\EOF`) leaves it literal. `<<-` strips leading tabs from the body and the
  terminator. Here-documents work on plain command lines, in pipelines, across
  multiple heredocs on one command, and inside `if`/`while`/`for`/`case`
  bodies. Like dash and bash, a script that ends before the terminator line
  appears uses whatever was read as the body instead of raising a syntax
  error.
- Add `<<<` here-strings, matching mksh's `DOHERESTR | DOSCALAR` word
  expansion: parameter, command, and arithmetic substitution run, but there is
  no field splitting, pathname expansion, or tilde expansion, and a trailing
  newline is appended before the word becomes stdin.
- Fix an unrelated pre-existing crash surfaced while adding here-documents: any
  tokenizer syntax error (for example an unterminated quote) raised while
  probing whether a script uses compound (`if`/`while`/`for`/`case`) syntax
  used to escape as an unhandled exception instead of the usual
  `bunmsh: syntax error: ...` message.
- Show mksh's `PS2` continuation prompt (default `"> "`) in interactive mode
  while a here-document, an open quote/substitution, or an unfinished
  `if`/`while`/`for`/`case` body is still being typed, instead of running each
  line on its own as soon as Enter is pressed. Ctrl-C during a continuation
  discards it and returns to the primary prompt; Ctrl-D runs whatever was
  typed so far — the same leniency the non-interactive here-document fallback
  above already has — and then keeps the shell running (Node's `readline`
  closes itself on an empty-line Ctrl-D, so this transparently rebuilds it),
  the same as mksh, instead of exiting the whole session.
- `lsfancy -l` now shows a symlink's target (`link -> target`), including a
  broken one, matching real `ls` — this was missing from both `lsfancy` and
  the Bun Shell `ls` fallback it is compared against. Reading it works the
  same way on Windows as on POSIX platforms.
- Give a symlink whose target does not resolve (missing, or a cycle) a
  distinct 🚫 icon instead of the normal 🔗, in both the plain and `-l`
  listing forms.
- With mouse tracking enabled, clicking inside the line currently being typed
  now moves the cursor there (accounting for the active prompt's own width
  and wrapping, including multi-line/multi-tab prompts and the `PS2`
  continuation prompt), the same as clicking inside a text field, instead of
  only reacting to clicks on tabs. Clicking past the end of the typed text
  moves the cursor to the end of the line rather than doing nothing.
- Add `-S` (sort by size, largest first), `-1` (force one entry per line,
  even in a terminal), and `-F` (append a classify suffix — `/` directory,
  `@` symlink, `*` executable, `=` socket, `|` FIFO) to `lsfancy`, all
  combinable with the existing flags (`-lSF`, etc.).
- Save history automatically — every 60s, once more on exit, and once more
  on SIGTERM/SIGHUP — by appending only this session's own new commands to a
  JSON Lines history file, never rewriting it, so several bunmsh sessions
  saving around the same time can no longer overwrite each other's history.
  `tab s`/`tab save` trigger the same append immediately; the new `tab s d`/
  `tab save dedupe` is a separate, explicit whole-file rewrite that drops
  duplicate commands and reports if another session's write raced it. A
  history file saved in the previous single-JSON-array format is still read
  correctly and is silently upgraded to JSON Lines the next time anything
  is saved.
- Catch SIGTERM and SIGHUP in interactive mode instead of leaving them at
  the default disposition (which killed bunmsh immediately, before it could
  save anything). Receiving either while waiting at the prompt now flushes
  history and exits with the conventional 128+signal status; while a
  foreground command owns the terminal, it flushes history immediately and
  exits once that command finishes on its own, since there is no
  job-control layer yet to also stop the command itself.

### Changed

- `tab s`/`tab save` (with no `d`/`dedupe`) no longer removes duplicate
  commands as a side effect of saving — it now only appends, matching how
  most shells' history files work. Use the new `tab s d`/`tab save dedupe`
  to remove duplicates explicitly.
- The `ls` fallback builtin (used when no PATH `ls` is found, e.g. on
  Windows, or under `--builtin-only`) is now `lsfancy` instead of Bun Shell's
  own `ls`, since it now covers more real `ls` behavior (working `-h`/`-t`/
  `-r`, a symlink's target, alphabetical default order) than Bun Shell's
  version does. Bun Shell's `ls` is still reachable, renamed to `lsbun`.
  `lsfancy` itself is unchanged and still callable under its own name.

### Fixed

- Fix an unrelated pre-existing hang found while working on the above: a
  pipeline whose downstream stage closes early (`yes | head -n 3`) could
  leave the killed upstream stage's own output-forwarding stuck forever —
  Bun never releases the reader lock it holds on that pipeline link's read
  side once the stage reading it has exited, so a write already in flight
  into it backpressures permanently and cannot be canceled from outside.
  That write is now abandoned instead of waited on once the downstream stage
  is known to be done, and the shell forces its own exit once a script or
  `-c` command finishes rather than leaving that abandoned operation to keep
  the process running forever.
- Fix `lsfancy -l` showing every file's modification time in UTC instead of
  local time (it built the column from `Date.prototype.toISOString()`, which
  is always UTC) — a pre-existing bug, not something the symlink-target work
  above introduced.

## [0.1.9] - 2026-08-27

### Added

- Render Markdown previews in `serve` with heading anchors, passing
  `{ headings: true }` to `Bun.markdown.html`, so long documents get linkable
  section ids.
- Document `serve` in its own README section, pulled out of the fallback
  builtin table: port selection and its fallback, the `q`/`quit`/`exit` and `o`
  controls, exit codes, directory listings and previews, and the
  non-interactive forms such as `bmsh -cc builtin serve <directory>` that start
  it from another shell or a script.
- Document packing a folder into a single executable without a source
  checkout — `npx bunmsh --build-exe --asset /absolute/path/mysite`, then
  `bmsh -cc builtin serve 'B:/~BUN/mysite'` — including the absolute-path
  requirement, the PowerShell and `cmd.exe` spellings, and the trade-off
  against the `package.json` `assets` route, which is what makes the same file
  readable through `readAssetText` from a checkout and from the binary.
- Document that `serve` always answers a directory with its listing rather than
  the directory's `index.html`, and point site hosting at `npx serve` or Bun
  1.4's `{ dir }` routes, which do send it.
- Document that HTTP Range is not honoured for files inside a compiled binary:
  Bun answers those with the whole body and a `200`.

## [0.1.8] - 2026-08-27

### Added

- Add the `serve [directory]` fallback builtin and standalone `serve.js` as a
  minimal replacement for `python3 -m http.server`. It provides live directory
  listings, reflects filesystem changes, and serves whole `Bun.file` responses
  with Bun's native HTTP Range support.
- Add `🔍` preview links to `serve` directory pages. Markdown is rendered by
  `Bun.markdown.html`; JSON, JSON5, JSONC, JSONL/NDJSON, YAML, and TOML are
  parsed by their corresponding runtime parser and pretty-printed as HTML.
  XML is also previewed when the running Bun provides `Bun.XML.parse`.
- Add basic syntax colouring to structured-data previews, following the
  statement, string, escape, number, and constant groups from jsmdcui's
  `runtime/syntax/json.yaml` after parser output is pretty-printed as JSON.
- Add interactive `serve` controls: `q`, `quit`, and `exit` stop the server,
  while `o` opens its URL through `xdg-open`.
- Accept both `/$bunfs/...` and `B:/~BUN/...` serve paths on every platform,
  translating either spelling through the compiled module's
  `import.meta.dirname` to the bunfs mount accepted by the current runtime.

### Fixed

- Keep `serve` running after malformed preview data or any other uncaught
  request-handler exception; parser failures return 422 and the outer request
  boundary converts unexpected failures to an isolated HTTP 500 response.
- Prevent Termux foreground/resume terminal resize events from repainting the
  shell's cwd prompt over a running server or other foreground command.
- Keep the interactive shell alive when Ctrl-C interrupts the prompt or a
  foreground `serve`. Like mksh, SIGINT now abandons the current operation and
  returns to a fresh prompt; Ctrl-D on an empty input remains the way to send
  EOF and leave the shell.

## [0.1.5] - 2026-08-26

### Added

- Mark shell-inserted line endings with `↩️`, making the exact boundary of a
  command's output visible when the command does not emit a trailing newline.
- Document this marker under **Special Interactions → Terminal behavior**.

### Fixed

- Preserve the final line of any interactive command whose output has no
  trailing newline, including streamed external commands such as
  `printf hello`. bunmsh now queries the terminal cursor before repainting the
  prompt and only inserts a marked newline when the cursor remains mid-line.

## [0.1.4] - 2026-08-26

### Added

- Added `Alt-P` as a second shortcut for `builtin lsfancy ..`, matching
  `Alt-U` and listing the Parent (upper) folder without changing cwd or
  discarding the current edit buffer.

### Fixed

- Preserve short `Alt-L`, `Alt-U`, `Alt-P`, and tab-double-click `lsfancy`
  output when readline redraws the prompt. A two-line prompt previously moved
  upward and erased a one-line listing, which was especially visible for the
  parent of the Termux home directory.
- Derive `HOME` on Windows from `USERPROFILE`, or from `HOMEDRIVE` plus
  `HOMEPATH`, when the environment does not define it. Bare `cd`, `~`, `$HOME`,
  prompt home shortening, and child environments now share a usable home path.
- Normalise Windows HOME paths to forward slashes and compare HOME/cwd without
  case sensitivity when deciding whether a prompt path should use `~`.
- Treat Android's `/data/data/PACKAGE` and `/data/user/0/PACKAGE` app-sandbox
  paths as equivalent for prompt home shortening, so Termux HOME and its
  descendants display as `~` even when HOME and cwd use different aliases.
