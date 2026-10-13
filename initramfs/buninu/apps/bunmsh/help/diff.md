## diff

Compare two files. Return 0 when identical, 1 when different, or 2 on error.

### Usage

```sh
diff [-q] [--] FILE1 FILE2
```

Print normal-format changes, or use `-q`/`--brief` for a difference notice.
Binary differences produce a notice. Text differences use Myers line alignment, preserving unchanged lines
between separate additions, deletions, and replacements. Missing final
newlines are reported explicitly. Directory comparison and unified/context formats are not supported.
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
