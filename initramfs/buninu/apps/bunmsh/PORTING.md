# mksh to Bun porting status

This document tracks detailed implementation boundaries. bunmsh 0.1.8 is a
clean JavaScript shell inspired by mksh's user-facing model; it is useful as a
command shell, but it is not a drop-in mksh or fully POSIX-compatible shell.
The README describes user-facing commands and flags. This file focuses on
semantic coverage, architecture, platform behaviour, and remaining work.

## Implemented core

| Area | Current status |
| --- | --- |
| CLI | Interactive mode, stdin, script files, `-c`, already-quoted `-cc`, `-i`, `--mouse`, `--builtin-only`, help, version, README display, and standalone build entry points |
| JavaScript | Raw lines beginning with `Bun.` bypass shell parsing and use awaited JavaScript `eval`; this also works inside command substitution and script files |
| Lexing and lists | Comments at word boundaries, single/double quotes, escapes, newline and `;` lists, `&&`, `||`, pipelines, and `!` negation |
| Compound grammar | One-line and multiline `if`/`elif`/`else`, `case`, `while`, `until`, `for`, shell functions, and parenthesised subshells |
| Expansion | Parameters and common POSIX operators, mksh-style replacement, command substitution, legacy backticks, arithmetic expansion, IFS field splitting, tilde expansion, brace alternatives, and standard pathname globs |
| Redirection | Streamed stdin/stdout/stderr truncate and append redirects, `<<`/`<<-` here-documents, `<<<` here-strings, redirects on pipelines and compound commands, and common descriptor duplication such as `2>&1` |
| Pipelines | Stages run concurrently with Web Streams and `Bun.spawn`; large output is not collected, early-closing consumers stop upstream producers, and pipeline status comes from the final stage |
| Commands | Aliases, functions, regular builtins, PATH lookup, system-first fallback builtins, Bun Shell fallbacks, explicit paths, and `command`/`builtin` lookup controls |
| State | cwd tabs with shared shell state, environment and assignments, positional arguments, readonly names, aliases, functions, last/exit status, and pipeline state isolation |
| Interactive | Readline editing, saved/Bash/Fish history import, automatic append-only history save (concurrent-session-safe, every 60s/on exit/on SIGTERM/SIGHUP) plus manual `tab s`/`tab save`/`tab s d` control, Up/Down recall, command/file completion, ghost suggestions, keyboard shortcuts, optional SGR mouse interaction, terminal-aware prompt layout, `PS2` continuation prompting for here-documents/open quotes/unfinished compound bodies, and interactive Ctrl-C/Ctrl-D/SIGTERM/SIGHUP handling |
| Platforms | Forward-slash shell paths with native conversion on Windows, platform PATH delimiters, Windows executable suffix handling, Linux/Android dynamic-linker re-execution, and inherited `LD_LIBRARY_PATH` |
| Packaging | Source execution and standalone Bun executables, including compiled self-spawn paths used by pipelines and reflected `bunmsh` commands |

The automated suite compares core expansion, builtins, grep/sed behaviour,
pipelines, and redirects with `/bin/sh` or system utilities where their intended
semantics overlap. Platform-specific behaviour also has focused unit and
pseudo-terminal tests.

## Current semantic boundaries

### Grammar and execution

- Background jobs (`&`), job control, coprocesses, and asynchronous command
  lists are not implemented.
- Brace command groups, `select`, arithmetic commands, and `[[ ... ]]` are
  not implemented.
- Functions and subshells cover practical cases but do not yet reproduce every
  mksh scoping, local-variable, trap, and diagnostic edge case.
- Pipelines isolate builtin/function state through subprocess copies. Changes
  made by a pipeline stage do not mutate the parent shell, matching the common
  shell model but not every mksh optimisation detail.
- There is no process-group based foreground/background job-control layer yet.
  Foreground TUI commands do receive the terminal directly while bunmsh pauses
  readline and temporarily disables its own mouse reporting.

### Expansion

- Common parameter defaults, alternatives, lengths, trimming, and replacement
  are supported, but arrays, associative arrays, namerefs, mksh transforms,
  and `${| ...; }` are not.
- Standard `*`, `?`, and bracket pathname patterns are supported. Extended glob
  operators and process substitution are not.
- Brace alternatives are supported; the implementation is not a complete
  reproduction of every mksh brace-range and nested edge case.
- Arithmetic expansion supports shell variables and common integer operators,
  not the complete mksh arithmetic language.

### Redirection and processes

- `<`, `>`, `>>`, `2>`, `2>>`, `<<`/`<<-` here-documents, `<<<` here-strings,
  and common output descriptor duplication are implemented with streaming I/O.
  An unquoted and unescaped heredoc delimiter expands parameters, command, and
  arithmetic substitution in the body like a double-quoted string; a quoted or
  backslash-escaped delimiter leaves the body literal. Like dash and bash, a
  script that ends before a heredoc's terminator line appears uses whatever
  was read as the body instead of raising a syntax error.
- `<<<word` expands `word` as mksh's `DOHERESTR | DOSCALAR` do: parameter,
  command, and arithmetic substitution run, but there is no field splitting,
  pathname expansion, or tilde expansion, and a trailing newline is appended.
  It follows the same dash/`/bin/sh` comparison harness as everything else in
  this codebase, except `<<<` itself, since dash does not implement it.
- Arbitrary descriptor allocation/manipulation, descriptor variables,
  heredocs targeting a descriptor other than stdin, and every ordering edge
  case remain incomplete.
- External processes use `Bun.spawn`; regular and fallback builtins may execute
  in-process or in a self-spawned bunmsh pipeline child depending on streaming
  and state-isolation requirements.
- The reflected `bunmsh` launcher preserves dynamic-linker invocation on Linux
  and Android for `ld-linux`, `ld-musl`, `linker`, and `linker64` forms, and
  preserves `LD_LIBRARY_PATH`. Unusual launch wrappers may still require
  additional platform handling.

### Signals and job control

- Interactive bunmsh catches SIGINT instead of allowing Ctrl-C to terminate
  the shell. At the prompt it abandons the current edit and starts a fresh
  prompt with status 130. A foreground `serve` handles the same signal by
  stopping its server, returning status 130, and handing control back to the
  interactive loop.
- Ctrl-D on an empty readline input sends EOF and exits the interactive shell.
  This is deliberately distinct from Ctrl-C, following the same high-level
  editor/main-loop separation used by mksh.
- The current implementation handles SIGINT through readline while editing and
  through a process signal listener while a foreground operation owns the
  terminal. It does not yet have mksh's general pending-signal table and safe
  trap checkpoints.
- There is no `trap` builtin or support for user handlers for signals, `EXIT`,
  or `ERR`. Signal handlers therefore cannot yet execute shell source, be
  listed, ignored, reset, or inherited with POSIX/mksh semantics.
- Status 130 is defined for an interrupted `serve`, and its SIGTERM path uses
  143. Signal-derived statuses are not yet normalised consistently for every
  external command, builtin, pipeline stage, and command substitution.
- Interactive mode catches SIGTERM and SIGHUP while waiting at the prompt: it
  flushes history (see the history-saving row in the Implemented core table)
  and exits with the conventional 128+signal status. While a foreground
  command owns the terminal, receiving either only flushes history
  immediately — it does not stop that command, since there is no
  process-group job-control layer yet to do that safely (see below); the
  shell actually exits once the command finishes on its own. Neither has
  mksh's complete interactive policies otherwise; SIGQUIT does not have a
  handler at all; SIGCHLD does not maintain a job table; and SIGWINCH is not
  integrated into a general signal subsystem.
- Terminal control characters are currently mediated by Bun readline. bunmsh
  does not read termios `VINTR`, `VQUIT`, or `VEOF`, so remapping those keys
  with `stty` is not guaranteed to match mksh.
- Long-running JavaScript builtins need command-specific cancellation today.
  `serve` implements it, while there is not yet a common abort context that can
  interrupt every asynchronous builtin safely.
- Pipeline shutdown handles practical early-closing consumers and stops
  upstream producers, but SIGPIPE status/disposition is not yet integrated
  with a full process-group and job-control model.
- Background execution, process groups, terminal foreground ownership, job
  tables, `jobs`, `fg`, `bg`, `wait`, and Ctrl-Z/SIGTSTP handling remain
  unimplemented. SIGTTIN and SIGTTOU policies consequently remain absent too.

### Builtins and utilities

- The README's builtin tables are the source of truth for currently supported
  command flags. Most implementations intentionally cover common usage rather
  than every POSIX, GNU, or mksh option.
- `printf`, `print`, `read`, `test`, `getopts`, `kill`, `sed`, `grep`, `find`,
  and other utilities have documented subsets and are not complete clones.
- Fallback builtins normally yield to an executable of the same name in PATH.
  `builtin NAME` forces bunmsh's implementation; builtin-only mode suppresses
  direct PATH dispatch while the explicit `which` query still searches PATH.
- Bun Shell fallback behaviour is version-dependent. See
  [bunshell.md](bunshell.md) for the tested compatibility snapshot.

### Interactive behaviour

- History is loaded at startup and saved automatically (every 60s and once
  more on exit), appending only this session's own new commands to a JSON
  Lines file — never rewriting it — so concurrent bunmsh sessions saving
  around the same time cannot overwrite each other's history. `tab s`/
  `tab save` trigger that same append immediately; `tab s d`/`tab save dedupe`
  is a separate, explicit whole-file rewrite that drops duplicates and
  reports if another session's write raced it. A pre-existing history file in
  bunmsh's older single-JSON-array format is read correctly and silently
  upgraded to JSON Lines the next time anything is saved. `fc` is not
  implemented.
- Completion uses a periodically refreshed sorted PATH index plus live cwd file
  reads. It is practical rather than a byte-for-byte mksh completion engine.
- Ghost suggestions use imported/saved history and filesystem matches after
  filtering terminal control characters.
- Full Emacs/Vi editing-mode compatibility, user-defined key bindings, and
  programmable completion are not yet implemented. `PS2` continuation
  prompting (here-documents, open quotes/substitutions, unfinished compound
  bodies) is implemented; see the Implemented core table above.
- Mouse tracking is opt-in because terminal application tracking interferes
  with normal scrollback in Termux, xterm, and similar terminals.

### Platform scope

- Linux, Android/Termux, macOS, and Windows are the intended platforms. Windows
  users see forward slashes at the shell layer; bunmsh converts executable and
  filesystem paths at native API boundaries.
- When Windows does not define `HOME`, bunmsh derives it from `USERPROFILE` or
  `HOMEDRIVE` plus `HOMEPATH`, so `cd`, `~`, and prompt home shortening use the
  same user directory conventions as history storage.
- Prompt home shortening treats Android's `/data/data/PACKAGE` and
  `/data/user/0/PACKAGE` app-sandbox paths as equivalent, while preserving the
  actual cwd spelling used for filesystem operations.
- Windows command discovery recognises common executable suffixes internally;
  full `PATHEXT` emulation is intentionally not implemented.
- OS/2, EBCDIC, MirBSD-specific, and legacy lksh modes are out of scope.

## Remaining major work

1. Background jobs, process groups, complete signal-status handling, traps,
   general builtin cancellation, and `jobs`/`fg`/`bg`/`wait`.
2. Shell options such as `errexit`, `nounset`, `pipefail`, `xtrace`, and POSIX
   mode, plus startup/login/restricted-shell files and modes.
3. Brace groups, `[[ ... ]]`, arithmetic commands,
   extended globs, process substitution, and fuller mksh expansion semantics.
4. Arrays, associative arrays, namerefs, `typeset`/scope semantics, and more
   complete special builtins.
5. Programmable completion, multiline editing, editing modes, key bindings,
   `fc`, and automatic history policy.
6. Broader POSIX conformance testing, mksh `check.t` coverage, exact diagnostics,
   and exit-status compatibility for edge cases.
