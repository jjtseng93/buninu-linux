## diff

Compare two files. Return 0 when identical, 1 when different, or 2 on error.

### Usage

```sh
diff [-q] [-u | -U N] [--label LABEL] [--label LABEL] [--] FILE1 FILE2
```

Print normal-format changes, or use `-q`/`--brief` for a difference notice.
Binary differences produce a notice. Text differences use Myers line alignment, preserving unchanged lines
between separate additions, deletions, and replacements. Missing final
newlines are reported explicitly. Directory comparison and copied-context (`-c`/`-C`) formats are not supported.
The default shell alias's `--color` option is accepted; output is plain text.

### Example

```sh
printf 'first\nlast\n' > before
printf 'first\nnew\nlast\n' > after
diff before after
```

Output:

```text
1a2
> new
```

### Unified format

`-u` prints unified hunks with three surrounding lines. `-U N` (also `-UN`)
selects a non-negative context count; `-U 0` prints only changed lines.
`--unified` and `--unified=N` are supported GNU-style aliases.

Headers normally include each path and its modification time. Use `--label LABEL`
(or `--label=LABEL`, `-L LABEL`, `-LLABEL`) once per input to replace that header
without a timestamp. Labels and paths are separate arguments, including spaces
and non-ASCII characters. Identical files produce no output, even with `-u`.

Flea's Compare invocation is supported unchanged:

```sh
bunmsh -cc builtin diff -u --label before.txt --label after.txt -- before.txt after.txt
```

The default normal format and `-q` behavior remain unchanged. `-u`/`-U` are
POSIX options; the long options and labels are compatibility extensions.
