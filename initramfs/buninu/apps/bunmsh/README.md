# bunmsh

- `bunmsh` is a dependency-free, mksh-inspired cross-platform command shell for Bun JavaScript
  * Bun Modern Shell
- Early releases focus on a small, usable command interpreter rather than full mksh compatibility.

## Usage

### Install Bun first

- bunmsh requires [Bun](https://bun.com)
- On Android, install it in Termux:

```sh
npm install -g bun
```

On other platforms, follow the
[official Bun installation guide](https://bun.com/docs/installation).

No project dependencies need to be installed with `npm install` or `bun install`.

#### Prompt note for frequent SSH users

- By default bunmsh prompts don't show user@host
- Show them by a custom `PS1`:

```sh
PS1=$(printf "$(id -un)@$(hostname):\\w\n%s" '$ ') npx bunmsh
```

### Option 1: Run with npx

```sh
# Interactive shell
npx bunmsh
```

```sh
npx bunmsh -c 'print $PATH'

# Call cmd; this can call bunmsh builtins too
npx bunmsh -cc echo 'hello world' '*.txt' '$HOME'

npx bunmsh script.sh argv1 argv2
```

`-cc` means **call cmd**. Every argument after it is forwarded as an
already-quoted word, without another round of bunmsh parsing or expansion. The
example calls the `echo` builtin and prints `hello world *.txt $HOME` literally.

`npx` installs and launches the package, but the `bunmsh` executable itself
uses Bun. Bun must therefore already be available on `PATH`.

### Option 2: Run with git clone

- Interactive shell

```sh
git clone https://github.com/jjtseng93/bunmsh.git
cd bunmsh

bun ./bunmsh
```

- Running commands or scripts

```sh
bun ./bunmsh -c 'print $PATH'

# Call cmd; this can call bunmsh builtins too
bun ./bunmsh -cc echo 'hello world' '*.txt' '$HOME'

bun ./bunmsh script.sh argv1 argv2
```

`-cc` means **call cmd**. Every argument after it is forwarded as an
already-quoted word, without another round of bunmsh parsing or expansion. The
example calls the `echo` builtin and prints `hello world *.txt $HOME` literally.

### Useful CLI options

| Option | Effect |
| --- | --- |
| `-c SCRIPT_TEXT [argv...]` | Treat command text as a shell script, then parse and execute it |
| `-cc COMMAND [argv...]` | Call a command with argv as-is; no shell parsing or shell expansions |
| `-i` | Enter interactive mode, including after running a script |
| `--mouse` | Start with terminal mouse tracking enabled |
| `--builtin-only` | Skip direct command-name lookup through `PATH` |

`-c` treats its command text as a shell script and performs the normal parse
and execute flow. Arguments after the script text become its argv array:

```sh
bunmsh -c 'echo "$0" "$1"' Hello world
# Hello world
```

`-cc` means **Call Command**. It can call an alias, builtin, or command from
`PATH`. Every following argument is passed as-is, without shell parsing or
shell expansions:

```sh
bunmsh -cc echo '$HOME' '*.js'
# $HOME *.js

bunmsh -cc lsfancy -lh
# List cwd with emojis
```

In other words, the argv following `-cc` is already quoted. Metacharacters,
variables, and glob patterns remain literal instead of being interpreted by
bunmsh.

Mouse tracking can alternatively be enabled with `BUNMSH_MOUSE=1`; `true`,
`on`, and `yes` are also accepted case-insensitively. It is opt-in because
application mouse tracking prevents normal scrollback gestures in terminals
such as Termux and xterm.

In `--builtin-only` mode, regular and fallback builtins, aliases, and functions
remain available. An explicit executable path containing `/` can still run.
The `which` builtin always searches the current `PATH`, so `"$(which COMMAND)"`
can explicitly select a PATH executable while this mode is active. Use
`tab path` interactively to toggle this setting; `tab path on`/`true` enables
direct PATH lookup and `tab path off`/`false` disables it.

### Highest-priority JavaScript mode

```console
# Read a Bun value; non-undefined results are printed automatically
📁 ~/bunmsh
$ Bun.version

# Promises are awaited automatically
📁 ~/bunmsh
$ Bun.file("package.json").text()
📁 ~/bunmsh
$ Bun.sleep(500).then(() => "finished")

# Run arbitrary JavaScript statements or an expression
📁 ~/bunmsh
$ Bun.e; const numbers = [1, 2, 3]; numbers.reduce((a, b) => a + b, 0)
6
📁 ~/bunmsh
$ Bun.e, ({ cwd: process.cwd(), pid: process.pid })

# Share a value across later commands and cwd tabs in this bunmsh process
📁 ~/bunmsh
$ Bun.sha.var_name = { value: 123 }
{ value: 123 }
📁 ~/bunmsh
$ Bun.sha.var_name.value
123

# JavaScript inside ordinary shell command substitution
📁 ~/bunmsh
$ echo "Bun version: $(Bun.version)"

# Feed a JavaScript result into ordinary shell flow control
📁 ~/bunmsh
$ if [ $(Bun.e, Math.PI<3 ) = true ] ; then echo right ; else echo wrong ; fi
wrong
📁 ~/bunmsh
$ if [ $(Bun.e, Math.PI>3 ) = true ] ; then echo right ; else echo wrong ; fi
right
```

bunmsh can evaluate Bun JavaScript directly. Before tokenising, quoting, or
performing any shell expansion, it removes leading whitespace and checks the
first four characters of the original input. If they are exactly `Bun.`, the
entire input is passed directly to JavaScript `eval` instead of the shell
parser. Everything else continues through the normal shell parser.

A non-`undefined` result is printed automatically. Promises are awaited, so
asynchronous Bun APIs do not need explicit top-level `await`. Errors are
printed to standard error with a stack trace and set the shell status to `1`;
successful evaluation sets it to `0`, and an `undefined` result prints nothing.

#### Use `Bun.e;` or `Bun.e,` to run arbitrary JavaScript

The `Bun.` prefix is only the switch that selects JavaScript mode; the code
does not otherwise have to call a Bun API. `Bun.e` is a convenient no-op prefix
that permits arbitrary JavaScript while keeping the required first four
characters. The `e` property does not need to exist because reading a missing
JavaScript property simply produces `undefined`.

Technically, any property name works because only the leading `Bun.` is
checked; for example, `Bun.x;` and `Bun.anything,` also enter JavaScript mode.
This README uses `e` conventionally because it stands for **eval** (or
**evaluate**), is short, and makes the intent recognisable. Use `Bun.e;` before
one or more statements and `Bun.e,` before a single expression.

`Bun.e;` discards the `Bun.e` value and starts a new statement. `Bun.e,`
discards it through JavaScript's comma operator and returns the expression on
the right. Neither form invokes Bun Shell by itself; their purpose here is
only to enter the highest-priority evaluator and then execute unrestricted
JavaScript.

#### Use `$` to read and write shell variables

Inside JavaScript mode, `$` is the shell's own variable table — the live
object, not a copy — so the two languages share one set of variables instead of
passing strings between them:

```sh
Bun.e, $.HOME                      # read
Bun.e, $.PATH.split(":").length    # read, as a JavaScript value
Bun.e; void ($.TAG = "v" + Date.now())
echo "$TAG"                        # the shell sees what JavaScript wrote
```

A shell variable is visible to JavaScript whether or not it was exported, and a
name JavaScript writes behaves like any other shell variable from that point
on, including being inherited by external child processes. `delete $.NAME`
unsets one, and `Object.keys($)` enumerates them.

An assignment is an expression, so its value is printed like any other result.
Wrap it in `void (...)` — as above — when the assignment is the point and the
echo is not.

**Everything the shell put there is a string.** A shell has no other type, so
`+` concatenates where you may have meant arithmetic — convert first:

```sh
X=3
Bun.e, $.X + 1            # "31"
Bun.e, Number($.X) + 1    # 4
```

The reverse direction does not convert for you either: `$.N = 42` stores the
number 42 in the table. The shell and any child process still read `42`,
because they stringify at their own boundary, but JavaScript now sees a number
under that name and a string under every name the shell set — so the same
expression means two different things depending on who last wrote the variable:

```sh
X=3
Bun.e; void ($.N = 42)
Bun.e, [$.X + 1, $.N + 1]   # [ "31", 43 ]
```

Assign strings (`$.N = String(count)`) to keep one rule for every name.

Two things to know:

- `$` is bound only inside JavaScript mode, and only shadows the bare name.
  `Bun.$`, Bun Shell's own API, is reached through the `Bun` object and is
  unaffected.
- Writing through `$` mutates the table directly, so it bypasses `readonly`.
  `readonly R=locked` still refuses `R=other` from the shell, but
  `$.R = "other"` goes through. That makes it an escape hatch, and a way to
  break an invariant the shell was asked to hold.

#### One line at a time

JavaScript mode runs the line it was given. It does not continue across lines
the way a shell command does, because the shell's continuation marker is not
JavaScript: a bare `\` at the end of a line is a syntax error there, not a
request for another line, so the prompt does not ask for one.

The exception is the place where JavaScript has a line continuation of its
own — inside a string or template literal — and there it works, because the
prompt keeps collecting lines while the quote is open and JavaScript joins them
itself:

```sh
Bun.e, "abc\
def"
```

```text
abcdef
```

An unbalanced bracket does not continue: the shell's parser is looking for
shell syntax, not JavaScript's, so `Bun.e; function f() {` runs as typed and
reports its own syntax error. For code that spans lines, put it in a file and
`import` it, or keep the statements on one line separated by `;`.

#### Use `Bun.sha` as a shared area (hack)

`Bun.sha` is normally Bun's SHA hashing function. JavaScript functions are
objects, and the function is extensible in current Bun versions, so properties
such as `Bun.sha.var_name` can serve as a lightweight process-wide shared area.

These lines already begin with `Bun.`, so they enter the highest-priority
JavaScript evaluator directly. Values remain available to later commands,
tabs and command substitutions running in the same bunmsh process. They do
not survive a bunmsh restart and are not inherited as JavaScript objects by
external child processes.

This is deliberately a hack, not an official Bun storage API. Use fresh
property names. A function already has reserved or behaviour-sensitive names
such as `name`, `length`, `call`, `apply`, `bind`, `caller`, `arguments`,
`constructor` and `toString`. In the tested Bun version, `name` and `length`
are read-only and assignment throws a `TypeError`; shadowing other Function
properties can break normal function behaviour. Before choosing a direct
property name, check it with `Bun.e, Object.hasOwn(Bun.sha, "var_name")`.

#### JavaScript inside shell command substitution

This mode also composes with shell command substitution. The outer command is
parsed as shell, while the contents of `$(...)` are evaluated again and can
trigger JavaScript mode independently.

#### Flow control with JavaScript values

JavaScript command substitution can feed ordinary shell tests and flow
control. The outer `if`, `[`, `then`, `else`, and `fi` remain shell syntax;
only the contents of each `$(...)` enter the JavaScript evaluator.

> **Security:** this is unrestricted JavaScript execution with the same file,
> process, environment and network permissions as bunmsh. Never pass untrusted
> input to this mode or expose it as a remote command interface.

### History

Interactive bunmsh loads its own saved history and imports both Bash and Fish
history once at startup. Imported commands immediately participate in
history-based ghost completion, but the Bash and Fish source files are
read-only and are never modified by bunmsh:

```text
~/.bash_history
~/.local/share/fish/fish_history
```

Fish history uses Fish's documented YAML-style records; it is not treated as
standards-compliant YAML. Empty entries, Bash timestamp records and duplicate
commands are removed while keeping the most recent occurrence.
`BUNMSH_IMPORT_HISTORY` controls only the Bash and Fish imports; saved bunmsh
history is still loaded. Set it to disable external startup imports:

```sh
BUNMSH_IMPORT_HISTORY=0 bunmsh
```

`false`, `off` and `no` are also accepted, case-insensitively.

bunmsh saves its own history to a file, loaded again by every newly opened
bunmsh for both Up/Down arrow recall and ghost completion.

- **When it saves.** Automatically: every 60 seconds, once more when the
  shell exits, and once more if it receives SIGTERM or SIGHUP (for example
  from `kill`, or a terminal emulator closing its window) — while a
  foreground command owns the terminal, a caught SIGTERM/SIGHUP flushes
  history immediately but does not stop that command, since bunmsh has no
  job-control layer yet that could do so safely; the shell exits once the
  command finishes on its own. `tab s`/`tab save` trigger the same save on
  demand, e.g. right before closing the terminal some other way.
- **File format.** [JSON Lines](https://jsonlines.org/) — one JSON-encoded
  command per line. A history file saved in bunmsh's older single-JSON-array
  format is still read correctly and is silently upgraded to JSON Lines the
  next time anything is saved.
- **How concurrent sessions are handled.** Every save above only *appends*
  the lines this session hasn't saved yet — it never rewrites the file. That
  makes it safe to run several bunmsh sessions at once: each one only adds
  its own new lines to the end and never touches (or needs to know about)
  what another session has written, so two sessions saving around the same
  time can't overwrite each other's history the way rewriting the whole file
  each time would risk.
- **Deduplication.** Because saving only appends, duplicate commands are
  *not* removed automatically. Run `tab s d` (or `tab save dedupe`) to
  rewrite the file keeping only each command's most recent occurrence.
  Unlike the routine append, that rewrites the whole file, so it is an
  explicit, occasional choice that carries a small chance of losing another
  session's write if it happens mid-rewrite — the command's own output says
  so if it looks like that happened, so it's obvious when it's worth
  rerunning.
- **File location.** `$XDG_DATA_HOME/bunmsh/history`, falling back to
  `~/.local/share/bunmsh/history`. Windows uses
  `%LOCALAPPDATA%/bunmsh/history`.

### Tab system

| Command | Effect |
| --- | --- |
| `tab` | Create a second tab when only one exists; otherwise cycle right |
| `tab n` | Create and activate a new tab at the current cwd |
| `tab NUMBER` | Activate a tab by its 1-based number |
| `tab l` | Cycle left |
| `tab r` | Cycle right |
| `tab x`, `tab c` | Close the active tab |

bunmsh includes lightweight cwd tabs and starts with one tab. A tab stores only
its working directory; variables, environment, aliases, readonly names,
positional arguments, command status, and other shell state remain shared.
Switching tabs changes `cwd` and updates `PWD` without changing `OLDPWD`.

When more than one tab exists, the prompt displays every remembered path:

```text
📁 ~/project  📂 ~/project/src
[2]$
```

`📂` marks the active tab and `📁` marks inactive tabs. The complete active
entry is highlighted in cyan-blue. The default prompt includes the active
tab's 1-based number only when multiple tabs exist.

Left and right movement wrap at the ends. Closing a tab selects the tab that
moves into the same position, or the previous tab when closing the rightmost
one. The final remaining tab cannot be closed.

A typical workflow is:

```sh
cd ~/project
tab n
cd src
tab l      # back to ~/project
tab r      # back to ~/project/src
```

## Special Interactions

### Completion and ghost suggestions

Tab completes the word being typed, and a dim **ghost** shows the first match
inline ahead of the cursor; the Right arrow accepts it. What is offered depends
on where the cursor is:

| Where | Offered |
| --- | --- |
| A command name | Builtins, aliases, and executables on `PATH` |
| Inside `$(` | Command names again — a substitution starts a new command |
| A `$` being typed | Shell variable names |
| A JavaScript line | `$.` completes a variable name, a string literal a path |
| Anywhere else | Files and directories, and history for the ghost |

**Variables.** `$HO` suggests `$HOME`, and `${HO` suggests `${HOME}` — the
brace it opened is closed for it. `${#HO` works the same way. Names come from
the shell's own variable table, so unexported names and anything JavaScript
mode wrote through `$` are offered alongside the environment.

The suggestion follows the shell's own rules about when a `$` expands:

- It works wherever an expansion would: mid-word, on the right of an
  assignment (`X=$HO`), inside double quotes, and where a command name would
  go (`$ED`).
- Single quotes suppress it, because nothing expands inside them.
- Nothing is offered for the other things a `$` can start, since none of them
  is a name in progress: `$(` (a command substitution), `$?`, `$1`, `$$`
  (already complete), and `\$` (a literal dollar sign — the backslashes are
  counted, so `\\$HO` does suggest).
- A bare `$` has no name to match on, so it ghosts nothing. Tab still lists
  every variable, the way Tab on an empty word lists every file.

Where both could apply, history wins the ghost: it completes the whole line,
which reaches further than a single variable name.

**On a JavaScript line** — one starting with `Bun.`, the same test the
evaluator dispatches on — the line is read as JavaScript instead, because shell
word-splitting says nothing useful about it. Two things complete there:

```sh
Bun.e, $.HO              # -> $.HOME
Bun.e, Bun.file("/tm     # -> a path, completed inside the string
```

- After `$.`, shell variable names. A bare `$` completes nothing here: in
  JavaScript it is the variable table itself, and a name only begins after the
  dot.
- Inside an unclosed string literal — `"`, `'`, or a template — the text back
  to the opening quote is completed as a path. No trailing space is needed to
  make the completer see it, and nothing has to be trimmed back off afterwards.
- A template's `${...}` is code again, so `$.` completes inside it and the
  path resumes after the closing brace.
- Where neither applies, only the history ghost is offered; shell completion
  would just produce noise on a JavaScript line.

### Keyboard shortcuts

- `Ctrl-C`: Interrupts the current input or foreground operation and returns to
  a fresh prompt without exiting bunmsh.

- `Ctrl-D`: On an empty input line, sends EOF and exits the interactive shell.

- `Ctrl-T`: Calls `builtin tab` without adding a command to history. It creates
  a tab when only one exists, or switches to the next tab otherwise. Any
  command text currently being edited is preserved.

- `Alt-T`: Calls `builtin tab l` without adding a command to history, switching
  to the tab on the left while preserving the command currently being edited.

- `Alt-L`: Calls `builtin lsfancy` without adding a command to history. It
  immediately rereads and lists the active tab's cwd while preserving the
  command currently being edited.

- `Alt-U` / `Alt-P`: Calls `builtin lsfancy ..` to list the Parent (upper)
  folder without changing cwd, adding a command to history, or discarding the
  command currently being edited.

- `Alt-C`: Calls `builtin tab x` to close the active tab without adding a
  command to history. `tab c` is an equivalent command form.

### Mouse interactions

- Mouse tab click: With mouse tracking enabled, left-clicking a tab's icon or
  path activates it. Spaces between tabs are not clickable. Wrapped tab paths
  remain clickable.

- Mouse tracking control: `tab mouse` toggles tracking. `tab mouse on`/`true`
  explicitly enables it, while `tab mouse off`/`false` disables it.

- Mouse tab double-click: Double-clicking the same tab within 400 ms activates
  it and calls `builtin lsfancy`, immediately rereading the directory without
  using the completion cache.

- Mouse prompt-number click: When multiple tabs exist, clicking the number at
  the start of the `$` prompt calls `builtin tab n` to create and activate a
  new tab.

- Mouse click-to-position: Clicking anywhere in the line currently being
  typed moves the cursor there instead of leaving it at the end, the same as
  clicking inside a text field. Clicking past the end of the typed text moves
  the cursor to the end of the line rather than doing nothing.

- Mouse foreground behavior: Mouse reporting is disabled while a foreground
  command owns the terminal, so full-screen editors and other TUI programs
  receive their own mouse input. bunmsh restores it when the command returns.

### Terminal behavior

- `↩️`: When a command finishes without a trailing newline, bunmsh prints this
  marker and then inserts a newline before drawing the next prompt. The marker
  makes it clear where the program's exact output ended; it is not part of the
  command's output. Commands that end their own output with a newline do not
  show the marker.

### Very short aliases

- `?`: When the entire command is exactly this single character, prints the
  previous exit status. It is equivalent to `echo $?` and prints `0` after a
  successful command. After a command fails, only the `$` in the next prompt
  is shown in red. For Fish users, the corresponding expression is
  `echo $status` because Fish uses `$status` where POSIX-style shells use `$?`.

- `..`: As a standalone command, changes to the parent directory. Equivalent
  to `cd ..`.

- `//`: As a standalone command, returns to the most recently visited child
  directory below the current cwd. Equivalent to `cd //`.

- `~`: As a standalone command, changes to `$HOME`. Equivalent to `cd`.

- `-`: As a standalone command, changes to `$OLDPWD` and prints the selected
  path. Equivalent to `cd -`.

## Built-in commands and supported flags

This section documents the options implemented by bunmsh itself. It is not a
claim of complete POSIX, mksh or GNU compatibility. Shell builtins are resolved
before `PATH`. Fallback builtins are used only when no executable with the same
name is found in `PATH`; use `builtin NAME ...` to select either kind explicitly.

Run `builtin` with no arguments to print the registered names at runtime.

### Shell builtins (before PATH)

| Command | Supported flags/forms |
| --- | --- |
| `:`, `true`, `false` | No flags |
| `command` | `-p`, `-v`, `-V`, `--` |
| `builtin`, `__builtin` | `--`; no operand lists all builtins (`builtin` only) |
| `whence` | `-p`, `-v`, `--` |
| `which` | `--` |
| `type` | Names only |
| `alias` | `alias`, `alias NAME`, `alias NAME=VALUE` |
| `unalias` | `-a`, `--` |
| `test`, `[` | `!`, `-n`, `-z`, `-e`, `-f`, `-d`, `-b`, `-c`, `-p`, `-S`, `-L`, `-h`, `-s`, `-r`, `-w`, `-x`; string `=`, `==`, `!=`; integer `-eq`, `-ne`, `-gt`, `-ge`, `-lt`, `-le`; file `-nt`, `-ot`, `-ef`; `-a`, `-o` |
| `echo` | `-n` |
| `print` | `-r`, `-R`, `-n`, `-l`, `-N`, `-u1`, `-u2`, `--` |
| `printf` | `%s`, `%d`, `%i`, `%%`, numeric field width and zero padding; basic backslash escapes |
| `read` | `-r`, `--`; defaults to `REPLY` when no name is given |
| `pwd` | No flags |
| `cd`, `chdir` | `cd`, `cd DIR`, `cd -`, `cd //` |
| `tab` | `n`, `x`, `c`, `l`, `r`, `s`, `save`, `mouse [on\|off\|true\|false]`, `path [on\|off\|true\|false]`, or a 1-based tab number |
| `-`, `~`, `..`, `//` | Directory-navigation shortcuts |
| `export` | `NAME`, `NAME=VALUE` |
| `unset` | `-v`, `--` |
| `readonly` | `-p`, `--`, `NAME`, `NAME=VALUE` |
| `env` | `-i`, `--ignore-environment`, `-u NAME`, `--unset NAME`, `--unset=NAME`, `--` |
| `exec` | Command and arguments; no command is a no-op |
| `exit` | Optional numeric status |
| `shift` | Optional non-negative count |
| `getopts` | `getopts OPTSTRING NAME [ARG ...]` |
| `eval` | Arguments are joined and evaluated as shell source |
| `.`, `source` | `FILE [ARG ...]` |
| `realpath` | One or more paths |
| `umask` | No operand to display, or an octal mask |
| `kill` | `-l`, `-SIGNAL`, `-NUMBER`; on Windows, where the runtime can only `TerminateProcess` a subset of signals and never reaches the children, a terminating signal is sent as `taskkill /PID PID /T /F` instead, while `-0` still probes through the runtime |
| `set` | No operand to list variables; `-- ARG ...` sets positional arguments |
| `time` | Command and arguments; reports `real` elapsed time in milliseconds, with each decimal magnitude group shown in a different color |
| `yes` | Optional output words; no flags |

### The `serve` command

`serve [--auto-open] [--minapk-webview] [--random-url] [directory]` starts a minimal HTTP file server; it is a PATH-fallback
builtin, so a `serve` executable found in `PATH` wins unless it is invoked as
`builtin serve ...`.

- Serves the current working directory, or the directory given as the only
  argument. More than one argument is a usage error.
- `PORT` selects the port; it defaults to `3000`, and only that default falls
  back to a free port chosen by the OS when it is taken — an explicit `PORT`
  that is already in use is an error. The URL it settled on is printed on
  startup.
- `--auto-open` opens the printed URL after startup: `xdg-open` on PATH wins
  on any platform, otherwise `open` on macOS or `cmd /c start` on Windows.
  `--auto-open=/path` opens that path relative to the served URL instead of
  the root (resolved after any `--random-url` prefix, so the secret prefix
  stays intact); the `o` stdin control opens the same target.
- `--minapk-webview` adds `MINAPK_WEBVIEW=1` to the opener's child process,
  matching the npm `buninu` package's WebView-aware `xdg-open` behavior
  (`--minapk-webview=N` passes a different digit string).
- `--random-url` places the server behind a URL-safe random prefix generated
  from four Bun UUIDv7 values — at least 248 bits of guaranteed-random
  entropy (each UUIDv7's 62-bit `rand_b` field; the 48-bit timestamp isn't
  secret, and Bun's `rand_a` is a monotonic counter within the same
  millisecond rather than independently random, so neither counts toward the
  floor); a request without it gets `404`.
- All three default to off/not-passed, and `SERVE_AUTO_OPEN`,
  `SERVE_MINAPK_WEBVIEW`, and `SERVE_RANDOM_URL` set their defaults instead
  (`SERVE_AUTO_OPEN` can also be set to a `/`-led path, same as
  `--auto-open=/path`). A CLI flag always overrides its environment default:
  the bare flag forces it on, and `=off`/`=no`/`=false`/`=` (empty) forces it
  off, even if the environment turned it on inline.
- While it runs it holds the foreground. On a TTY it also takes single-word
  controls on stdin: `q`, `quit` or `exit` stops it, and `o` opens the URL the
  same way `--auto-open` would. `Ctrl-C` and `SIGTERM` stop it too, exiting
  `130` and `143` respectively; every other way out exits `0`.
- Directory pages list the entries by name, each with an emoji for its kind,
  and hide dotfiles. Previewable files get a `🔍` link next to them: it renders
  Markdown, and pretty-prints JSON, JSON5, JSONC, JSONL, YAML and TOML, plus
  XML when the running Bun provides `Bun.XML.parse`.
- Files are served through a whole, unsliced `Bun.file()` response, so Bun's
  own `Range` handling applies — `206` and `416` included. Files inside a
  compiled binary are the exception: Bun answers those with the whole body and
  a `200`, whatever `Range` asked for.
- Paths that would escape the served directory are rejected with `400`, and a
  failing request cannot take the server down; it answers `500` and stays up.
- It does not have to be started from inside an interactive bunmsh. Any of the
  non-interactive entry points reaches it, which is what makes it usable as a
  one-liner from another shell, a script, or a service unit:

  ```sh
  ./bmsh -cc builtin serve ./public      # argv as-is, no shell parsing
  ./bmsh -c 'builtin serve ./public'             # shell text, expansions apply
  bun ./src/main.js -cc builtin serve .  # from a source checkout
  npx bunmsh -cc builtin serve .         # without installing anything
  ```

  `-cc` forwards everything after it as argv, so the calling shell does the
  quoting and bunmsh performs no expansion of its own. `builtin` is what pins
  the choice to this implementation; drop it and a `serve` executable found in
  `PATH` would win. The `q`/`o` controls still work whenever stdin is a TTY,
  and `Ctrl-C` stops it either way.

#### Serving a folder packed into the executable

Want `--auto-open`, `--minapk-webview`, or `--random-url` baked into the
binary? See the next section.

- What this is for is handing a folder of files to someone, not hosting a site.
- That is why `serve` never answers a directory with its `index.html`:
- `/` is always the listing, so the folder stays browsable 
- and every file — the index page included — is one click away. 

- Two other tools do the site case properly
  * `npx serve <dir>` sends `index.html` for any directory that has one and falls
back to a listing for any directory that does not. 
  * Bun 1.4's directory routes do it in-process, streaming with `sendfile` and handling `Content-Type`, `ETag`, `Last-Modified`, `304` and `Range`; a directory holding an `index.html` gets it, one without gets `404`:

```js
Bun.serve({ routes: { "/static/*": { dir: "./public" } } });
```

A compiled `bmsh` can serve a directory that lives *inside* the binary, so a
whole folder ships as one file and is browsed over HTTP wherever it lands.
Nothing needs to be checked out or configured — two commands do it:

```sh
npx bunmsh --build-exe --asset /absolute/path/to/mysite
./bmsh -cc builtin serve 'B:/~BUN/mysite'
```

On Windows the build appends `.exe` to the output name, so the same two lines
read:

```powershell
npx bunmsh --build-exe --asset C:\path\to\mysite
./bmsh.exe -cc builtin serve 'B:/~BUN/mysite'
```

PowerShell's single quotes are literal, exactly like the POSIX shell's, so the
argument itself is written the same way on both. `cmd.exe` has no single
quotes — it would hand them to the program as part of the path — so there the
line is `.\bmsh.exe -cc builtin serve "B:/~BUN/mysite"`.

- Everything after `--build-exe` is forwarded to `bun build`, which is how
  `--asset` reaches the compile step. `--build-for <target>` takes the same
  trailing flags, so a cross-compiled binary can carry the folder too.
- **The path has to be absolute.** The compile runs from the installed
  package's own directory, wherever npm put it, so a relative path resolves
  somewhere else entirely and the build fails. A trailing slash is harmless.
- `--asset` keeps only the **basename** of the folder, and that name becomes a
  root inside the binary: `/absolute/path/to/mysite` is served as
  `B:/~BUN/mysite`, or equivalently `/$bunfs/root/mysite`. `serve` accepts
  either spelling on either platform and treats the `/root` part as optional,
  so one argument works on Linux, macOS and Windows alike. Quote it: both the
  POSIX shells and PowerShell would otherwise expand `$bunfs` to nothing.
- The folder is copied in whole, recursively, and `./bmsh` is written to the
  current directory, along with the `bmsh.meta.json` and `bmsh.meta.md` build
  reports. Only the executable is needed to run it; the two reports can be
  deleted.
- Serving `'B:/~BUN'` instead browses the binary's whole virtual root, which
  also holds the executable itself and bunmsh's own embedded assets.
- Only a compiled executable has that virtual filesystem. From a source
  checkout the same folder is just a folder: `serve ./mysite`.

`--asset` hands the files to Bun directly and bypasses bunmsh's asset packing
system. That system is the other way to do this — the folder is declared in
`package.json` under `assets` and the build runs with `ASSETS_BUNFS=1` — and
what it buys is source-level access: `readAssetText` and `readAssetBytes`
answer the same key whether the file is embedded or still on disk, so the same
JavaScript runs from a checkout and from the binary. `--asset` alone gives no
such reader; the files exist only as paths inside the binary. See
[`single-exe/README.md`](single-exe/README.md) for that route and for the
trade-offs between its two back ends.

#### Baking in `--auto-open`, `--minapk-webview`, `--random-url`

`serve`'s three env vars (`SERVE_AUTO_OPEN`, `SERVE_MINAPK_WEBVIEW`,
`SERVE_RANDOM_URL`) are each read as a literal `process.env.NAME` expression,
so `bun build`'s `--define` can bake a default straight into the compiled
binary — combine it with `--asset` to ship a self-opening server for a
folder. `--define` normally needs a bare string quoted as JSON; this
limitation doesn't apply here, because this project does extra handling to
quote it for you (see below):

```sh
bun ./src/main.js --build-exe --asset /absolute/path/to/mysite \
  --define process.env.SERVE_RANDOM_URL=on \
  --define process.env.SERVE_AUTO_OPEN=/index.html \
  --define process.env.SERVE_MINAPK_WEBVIEW=1
./bmsh -cc builtin serve 'B:/~BUN/mysite'
```

```text
Serving B:/~BUN/mysite
  http://localhost:3000/AaBIdviNcACxwZF2x3VW0QAaBIdviNcAGsAviNI5B59A.../index.html
```

That starts `xdg-open` (or the platform fallback) on `/index.html` behind the
random prefix, with `MINAPK_WEBVIEW=1` on its environment — no flags needed
on the command line, and a plain `SERVE_AUTO_OPEN=/index.html` set at
*runtime* no longer does anything, since `--define` replaced the
`process.env.SERVE_AUTO_OPEN` expression in the compiled code with a literal
before it ever runs. The CLI flags (`--auto-open`, `--random-url`,
`--minapk-webview`, with their `=off`/`=no`/`=false` forms) still work
normally and override whatever was baked in.

The resulting `bmsh` is also directly packageable with
`npx @drxiaozhi/minapk` ([minapk](https://www.npmjs.com/package/@drxiaozhi/minapk))
as the `libmain.so` the APK runs on launch:

```sh
npx @drxiaozhi/minapk ./bmsh -c "libmain.so -cc builtin serve 'B:/~BUN/mysite'"
```

`-c` replaces minapk's default startup command outright — that default is
what auto-runs a packaged `libmain.so`, so once `-c` is used it has to call
`libmain.so` itself, exactly as above, or the packaged binary never starts.
The app itself holds two WebViews from launch: `0` is the console the shell
above runs in, `1` is a second one that starts blank. `--minapk-webview` (or
baked-in `SERVE_MINAPK_WEBVIEW`) is what tells the packaged `xdg-open` to
load the served page into WebView `1` and switch to it — that switch, not
anything automatic about the APK itself, is what turns "the app opened" into
"the app is now showing this folder's content." Combine it with
`--auto-open`/`SERVE_AUTO_OPEN` (baked in as shown above, or passed on the
`serve` command line) so that switch happens on its own, no browser tab, no
separate server to start.

**`--define` values originally need to be JSON, so a bare string has to
arrive already quoted** — `--define process.env.SERVE_AUTO_OPEN=/index.html`
would fail if directly passed to `bun build`, which tries to parse
`/index.html` as a JS expression. `src/main.js` calls
`stringifyNonPrimitiveDefineValues` (from
`single-exe/compiled.js`, the same helper the npm package `jsmdcui` uses for
its own `--define`-backed settings) once per `SERVE_*` name before
`buildEarlyExit` runs, so it quotes any string-shaped value for you and
leaves an already valid bare literal (a number, boolean, `null`, or
`undefined` — e.g. `=1`) untouched. `off`, `on`, and a `/`-led path are all
string-shaped, so they get quoted automatically; that's what makes the
unquoted `=on` / `=/index.html` / `=1` forms above work directly from a
shell, no manual `--define 'process.env.SERVE_AUTO_OPEN="/index.html"'`
quoting required.

### The `curl` command

`curl [options] URL...` transfers a URL over HTTP or HTTPS on top of Bun's own
`fetch`, so a device with no `curl` binary can still run the download and API
scripts that expect one. It is a PATH-fallback builtin: a real `curl` in
`PATH` wins unless it is invoked as `builtin curl ...`.

- A URL with no scheme gets one — `http://` normally, `https://` when the port
  is `443`, or whatever `--proto-default` names — so `curl localhost:8080` and
  `curl example.com/page` work as they do with the real curl.
- Downloads: `-o`, `-O`, `-J`, `--output-dir`, `--create-dirs`, `-a`, and
  `-C -` resume through a `Range` request, appending on `206`, rewriting on a
  `200` that ignored the range, and stopping cleanly on `416`.
- Requests: `-X`, `-H`, `-d`/`--data-raw`/`--data-binary`/`--data-ascii`,
  `--data-urlencode`, `--json`, `-G`, `-F`/`--form-string`, `-T`, `-u`,
  `--oauth2-bearer`, `-A`, `-e`, `-b`, `-r`, `--compressed`, and `-x`.
  `@file` and `@-` read a body from a file or stdin.
- Responses: `-i`, `-I`, `-D`, `-w` with the usual `%{variable}` set, `-L`
  with `--max-redirs` and the `301`/`302`/`303` POST-to-GET rule, `-f`,
  `--fail-with-body`, `-k`, `-m`, `--connect-timeout`, and `--retry`.
- Reporting: `-s`, `-S`, `-v`, `-#`, and a curl-shaped progress meter, shown
  only when the body is not being painted on the terminal.
- curl's exit codes are reproduced: `22` for `-f` on an HTTP error, `6` for an
  unresolved host, `7` for a refused connection, `28` for a timeout, `47` for
  too many redirects, `60` for a certificate problem, `2` for bad usage.
- Bodies are streamed, so `curl -N` on a server-sent-events endpoint prints
  each chunk as it arrives, and a large download never buffers in memory.

Enough to drive a JSON API:

```sh
curl -sS https://api.openai.com/v1/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"hi"}]}'
```

Response headers come from `fetch`, which lower-cases them and hides the
negotiated HTTP version, so `-i`/`-I`/`-v` rebuild the conventional casing and
write `HTTP/1.1` status lines; Bun also adds a `Connection: keep-alive`
request header of its own. `builtin curl --help` documents the rest.

### PATH-fallback builtins

Fallback builtins normally let an executable in `PATH` win. To use the fancy
implementations by default even when the system provides `cat` and `ls`, make
aliases that explicitly select the builtin commands:

```sh
alias cat='builtin catfancy'
alias ls='builtin lsfancy'
alias ps='builtin pspac'
```

After that, `cat README.md` renders Markdown with ANSI styling and terminal
hyperlinks, while `ls` uses the emoji and terminal-width-aware listing. Use
`unalias cat ls` to restore normal PATH-first lookup for the current shell.

| Command | Supported flags/forms |
| --- | --- |
| `basename` | `--`, optional suffix |
| `dirname` | `--` |
| `cat` | `--exclude PATTERN`, `--exclude=PATTERN` using `Bun.Glob`, `--`; files and `-` for stdin |
| `tac` | `--`; files and `-` for stdin; reverses newline-delimited records in each operand; no other options |
| `catfancy` | `--exclude PATTERN`, `--exclude=PATTERN` using `Bun.Glob`, `--`; files and `-` for stdin; JSON, JSON5, JSONC, JSONL/NDJSON, YAML, TOML, and XML are parsed, pretty-printed as JSON, and colored with `Bun.color`; Markdown uses `Bun.markdown.ansi` with terminal hyperlinks; `.js`/`.mjs`/`.cjs`/`.jsx` and `.ts`/`.mts`/`.cts`/`.tsx` are wrapped in a fenced ` ```javascript `/` ```typescript ` block and rendered the same way, for the same syntax coloring; other formats are emitted unchanged |
| `head` | `-n N`, `-N`, `-c N`, `-cN` |
| `tail` | `-n N`, `-N`; `-n +N` and `-n+N` output starting at line N |
| `wc` | `-l`, `-w`, `-c`, combinable |
| `tr` | `-d`; simple ranges such as `a-z` |
| `tee` | `-a` |
| `sleep` | Durations with `ms`, `s`, `m`, `h` suffixes; seconds by default |
| `clear` | No flags |
| `rmdir` | `-p`, `--parents` |
| `mktemp` | `-d`; template must end in `XXXXXX` |
| `sort` | `-r`, `-n`, `-u`, combinable |
| `date` | `+FORMAT`; `%Y`, `%m`, `%d`, `%H`, `%M`, `%S`, `%s`, `%F`, `%T`, `%%` |
| `md5sum`, `sha256sum` | Files or stdin; no flags |
| `grep` | `-E`, `-F`, `-i`, `-q`, `-v`, `-n`, `-o`, `-r`, `-x`, combinable; `--color[=always\|auto\|never]` (`--colour` also accepted) |
| `sed` | `-n`, `-e SCRIPT`, `-eSCRIPT`, `-E`, `-r`, `-i`; numeric `p`; `s///` with `g` and `p` |
| `cut` | `-c LIST`, `-cLIST` |
| `ln` | `-s`, `-f`, `-T`, combinable (including `-sfT`) |
| `chmod` | Octal modes, `+x`, `a+x` |
| `uname` | `-a`, `-s`, `-n`, `-r`, `-v`, `-m`, `-p`, combinable (including `-mprs`); uses Node's OS APIs on Windows without `/proc` |
| `pspa` | Lists every process as a PID and its full command line, with no options; `ps -eo pid,args` passed through on POSIX, the same two columns queried from `Win32_Process` through PowerShell on Windows |
| `pspac` | The same listing, coloured: the PID as a number, and the command line highlighted as shell syntax with micro's `syntax/sh.yaml` rules and `colorschemes/monokai.micro` colours, plus a dimmed leading directory and the program's own name coloured as the command it is. Always colours, like `catfancy`; strip the colour and the output is `pspa`'s |
| `find` | Paths plus `-name`, `-iname`, `-path`, `-ipath`, `-type f/d/l`, `-mindepth`, `-maxdepth`, `-print`, `-print0`, `!`/`-not`, `-exec COMMAND {} \;`, `-exec COMMAND {} +`; regular builtin on Windows, PATH fallback elsewhere |
| `bunmsh` | Forwards all following arguments to this bunmsh entry point |
| `bun` | Forwards all following arguments to the active Bun runtime |
| `serve` | Auto-open, minapk WebView, and high-entropy random-URL flags; see [The `serve` command](#the-serve-command) above |
| `curl` | HTTP/HTTPS transfers on Bun's `fetch`, with automatic scheme guessing; `-o`, `-O`, `-J`, `--output-dir`, `--create-dirs`, `-a`, `-C`, `-D`, `-i`, `-I`, `-w`, `-X`, `-H`, `-d`, `--data-raw`, `--data-binary`, `--data-ascii`, `--data-urlencode`, `--json`, `-G`, `-F`, `--form-string`, `-T`, `-u`, `--oauth2-bearer`, `-A`, `-e`, `-b`, `-r`, `--compressed`, `-x`, `-L`, `--location-trusted`, `--max-redirs`, `-f`, `--fail-with-body`, `-k`, `-m`, `--connect-timeout`, `--retry` and friends, `-s`, `-S`, `-v`, `-#`, `--no-progress-meter`, `-V`, `--url`, `--proto-default`, combinable short clusters (`-kLO`, `-fsSL`, `-kfsS`, `-#k`); TLS-material and connection-tuning options are parsed and ignored; see [The `curl` command](#the-curl-command) above |
| `ls`, `lsfancy` | The `ls` fallback is `lsfancy`: emoji and terminal-width-aware directory listing; `-a`, `-A`, `-d`, `-l`, `-h`, `-t`, `-r`, `-R`, `-S`, `-1`, `-F`, combinable (including `-lh`, `-ltr`, and `-lSF`); `-l` shows a symlink's target (`link -> target`, including a broken one), and a symlink whose target can't be resolved (missing, or a cycle) gets a 🚫 icon instead of 🔗; `-F` appends a classify suffix (`/` directory, `@` symlink, `*` executable, `=` socket, `\|` FIFO); always reads the directory without using the completion cache |
| `lsbun` | Bun Shell's own `ls`, kept reachable under this name now that the `ls` fallback is `lsfancy`; currently implements `-a`, `-A`, `-d`, `-l`, `-R` |
| `mv` | Bun Shell currently accepts `-f`, `-h`, `-i`, `-n`, `-v`, but they do not change its behaviour; notably, `-i` and `-n` do not prevent overwriting |
| `rm` | Bun Shell currently implements `-f`, `-r`, `-R`, `-v`, `-d`, `-i`, `-I`, `--recursive`, `--verbose`, `--dir`, and `--interactive=never|once|always`; `--preserve-root` and `--no-preserve-root` are accepted but currently have no effect |
| `mkdir` | Bun Shell currently implements `-p`, `-v`, `--parents`, and `--vebose` (Bun's currently accepted spelling) |
| `seq` | Bun Shell currently accepts `-s`/`--separator`, `-t`/`--terminator`, and `-w`/`--fixed-width`; its formatting differs from GNU `seq` (`-w` does not currently pad, and a custom separator may also be emitted after the final item) |
| `touch` | Bun Shell fallback currently supports no flags |
| `cp` | `-r`, `-R`, `-v`; bunmsh converts `-r` to Bun Shell's `-R`. Bun Shell also accepts `-n`, but it currently has no effect |

Fallback commands preserve the system-command-first rule. For example, if
`/bin/grep` exists it runs instead of the fallback; `builtin grep ...` forces
the implementation described above.

The Bun Shell rows above describe the currently tested Bun implementation, not
a permanent compatibility guarantee. Their supported flags and exact behaviour
may change with later Bun releases; see [bunshell.md](bunshell.md) for the
detailed compatibility snapshot.

## What's implemented

- Interactive use, stdin and script files, `-c` shell text, and direct `-cc`
  argv forwarding.
- Highest-priority `Bun.*` JavaScript evaluation, including awaited promises,
  command substitution, and the `Bun.e;`/`Bun.e,` arbitrary-JavaScript forms.
- Concurrent streaming pipelines and streamed redirects built on `Bun.spawn`,
  including large output and early-closing consumers.
- Shell lists, pipelines, negation, functions, subshells, and `if`, `case`,
  `while`, `until`, and `for` compound commands.
- Quotes, parameter/command/arithmetic expansion, IFS field splitting, tilde,
  brace, and pathname expansion.
- Environment assignments, aliases, readonly names, positional parameters,
  shell functions, common redirections, `2>&1` descriptor duplication,
  here-documents (`<<`/`<<-`, with quoted/escaped delimiters suppressing
  expansion), and mksh-style here-strings (`<<<`).
- Regular builtins, system-command-first fallback builtins, Bun Shell fallbacks,
  and explicit lookup through `command`, `builtin`, `whence`, `type`, and
  `which`.
- Interactive history import/save/recall, command, file, and shell-variable
  completion, ghost
  suggestions, cwd tabs, keyboard shortcuts, optional mouse interactions,
  fancy directory listings, and a `PS2` continuation prompt while a
  here-document, an open quote/substitution, or an unfinished compound
  command is still being typed.
- A `curl` fallback built on `fetch`, covering downloads with resume, JSON and
  form request bodies, redirects, timeouts, retries, `--write-out` reporting,
  and curl's exit codes.
- A `pspa` process listing that works the same way on POSIX and Windows, and a
  `pspac` that colours it as shell syntax.
- Linux, Android/Termux, macOS, and Windows-aware paths, plus standalone builds
  and dynamic-linker re-execution support.

See [PORTING.md](PORTING.md) for detailed semantics, implementation boundaries,
platform notes, and the remaining mksh/POSIX compatibility work.

## Test

```sh
bun test
```

## Built-in documentation

Show the README or changelog in the terminal with ANSI formatting:

```sh
bunmsh --readme
bunmsh --changelog
```

Both commands read their embedded copy first when running a standalone
executable, then fall back to `README.md` or `CHANGELOG.md` in the repository
during development.

Every builtin's `--help` page lives in `help/`, and `help/README.md` is the
concatenation of all of them. Regenerate it with the shell's own `cat` after
adding or editing a page:

```sh
bun run genallhelp
```

which runs `builtin cat --exclude help/README.md help/*.md` and writes the
result back over `help/README.md`.

## Standalone executable

Build a single-file executable for the current platform:

```sh
bun ./src/main.js --build-exe
./bmsh --version
```

Cross-compile for a Bun-supported target:

```sh
bun ./src/main.js --build-for bun-linux-x64
```

The build writes `./bmsh` and leaves the repository's `./bunmsh` launcher
unchanged. The executable includes the runtime assets declared in
`package.json`, currently including its README and changelog. See
[`single-exe/README.md`](single-exe/README.md) for asset-management options.

## License

The original bunmsh JavaScript implementation is released under the
[MIT License](LICENSE), Copyright (c) 2026 Dr. John (醫者小智).

mksh is a separate upstream project and is **not** relicensed under MIT. Its
complete licence terms remain in [LICENSE-MKSH](LICENSE-MKSH).

### Syntax highlighting

The shell-syntax colouring `pspac` applies to the COMMAND column follows
`runtime/syntax/sh.yaml` from [micro](https://github.com/zyedidia/micro), the
Go terminal editor. Nothing is bundled: its rules — the keyword,
command-name, flag, variable, string, and comment patterns, the word lists
behind them, and the order they resolve in — were transcribed into
`src/shell.js`. Micro's syntax files are MIT ("Expat"), Copyright (c) 2020:
Zachary Yedidia, et al.; micro's own `syntax/README.md` records that they
originate from Nano's [`nanorc`](https://github.com/scopatz/nanorc)
collection.

The colours those classes are painted in are the colour-links of micro's
`runtime/colorschemes/monokai.micro` — micro itself is MIT, Copyright (c)
2016-2020: Zachary Yedidia, et al. — which renders the Monokai palette created
by Wimer Hazenberg. `catfancy` takes five of the same colour-links for its
JSON keys, strings, numbers, escapes, and constants, so both commands read as
one scheme rather than two.

Micro's terms are in [LICENSE-MICRO](LICENSE-MICRO); upstream they are
`runtime/syntax/LICENSE` and `LICENSE` in
[zyedidia/micro](https://github.com/zyedidia/micro), which is where to trace
either of them from.

### Licences in a compiled executable

`LICENSE`, `LICENSE-MKSH`, and `LICENSE-MICRO` are packaged assets, so a
standalone build carries them inside the binary rather than leaving the notices
behind in the repository. Reading them back depends on which asset back end the
build used:

```sh
./bmsh --assets-extract               # tar back end (the default)
./bmsh -cc builtin serve 'B:/~BUN'    # ASSETS_BUNFS=1 build
```

[`--assets-extract`](#standalone-executable) writes every asset beside the
executable, licences included, under `assets/bunmsh@<version>/`. For a bunfs
build, [serving `B:/~BUN`](#serving-a-folder-packed-into-the-executable)
browses the binary's own virtual root, where the same files sit under
`/assets/bunmsh@<version>/`.
