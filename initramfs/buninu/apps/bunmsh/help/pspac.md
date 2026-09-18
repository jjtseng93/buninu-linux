## pspac

The `pspa` process listing, coloured.

### Usage

```sh
pspac
```

It is a PATH-fallback builtin taking no options, and it lists exactly what
[`pspa`](#pspa) lists — same processes, same two columns, same order. Strip
the colour off its output and you have `pspa`'s byte for byte.

Like `catfancy`, it always colours rather than sniffing for a terminal, so the
plain listing is always one command away: use `pspa` when the output is going
somewhere that wants plain text.

### What gets coloured

The PID is painted as the number it is. The COMMAND column is a shell command
line, so it is highlighted as one, using micro's `syntax/sh.yaml` rules and
its `colorschemes/monokai.micro` colours — the same palette `catfancy` uses,
so a command line reads the same here as in a previewed script:

- Command names, shell keywords, flags, numbers, variables, quoted strings,
  and comments each take their own colour.
- Quoted strings and comments are regions, so a `#` inside an argument does
  not turn the rest of the line into a comment.
- Later rules win, exactly as in the editor: `--cat` is a flag, not the
  coreutils `cat`.

Two things a process listing needs that a script does not:

- The directory in front of the program is dimmed. It is the part an absolute
  path buries the answer in, and `ps` prints a lot of it.
- The program's own name is coloured as a command whether or not sh.yaml's
  word lists have heard of it — the file has to guess a command from a list,
  while here the first token is known to be one.

A kernel thread such as `[kworker/0:1]` has no program, path, or arguments to
take apart, so it recedes as a whole.

### Example

```sh
pspac
```

Output:

```text
  PID COMMAND
    1 /init
 8824 /data/data/com.termux/files/usr/bin/bash -l
 8955 bun run dev
```
