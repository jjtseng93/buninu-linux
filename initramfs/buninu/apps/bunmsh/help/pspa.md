## pspa

List every process as a PID and its full command line.

### Usage

```sh
pspa
```

It is a PATH-fallback builtin, so an executable named `pspa` found in `PATH`
wins; `builtin pspa` selects this implementation. It takes no options — pipe
it into `grep` to narrow the listing, and into `kill` to act on what you find.

[`pspac`](#pspac) prints the same listing with the PID and the command line
coloured.

On POSIX systems this is `ps -eo pid,args`, and its output is passed through
untouched. Reading `ps` over a pipe is also what keeps the command lines
whole: procps truncates them at the terminal width when it is writing straight
to a terminal.

Windows has no `ps`, so the same two columns are queried from
`Win32_Process` through PowerShell and laid out the same way, with the image
name standing in for a system process that reports no command line.

### Example

```sh
pspa | grep bun
```

Output:

```text
 1004 bun ./src/main.js
 1220 bun run dev
```
