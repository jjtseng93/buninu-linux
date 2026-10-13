## awk

Scan records and evaluate AWK programs using a JavaScript interpreter.

### Usage

```sh
awk [-F SEPARATOR] [-v NAME=VALUE] [-f SCRIPT_FILE] [PROGRAM] [FILE ...]
```

### Options and forms

- `-F`: Set the field separator; `-v`: assign a variable before BEGIN.
- `-f`: Read program text from a file; `-e`: append program text.
- BEGIN/END, pattern/action rules, fields, variables, associative arrays,
  functions, conditionals, loops, next/nextfile, exit and delete.
- print/printf, arithmetic, comparisons, regular expressions, concatenation,
  split, substr, index, length, match, sub/gsub and common numeric functions.
- getline from input or files; file output with `>` and `>>`; close.
- Parenthesized print/printf lists and continued arguments after commas.
- Output pipes run through bunmsh, buffering input until close or program end.
  They do not provide streaming or interactive communication. close returns
  the command status; closing and reopening starts a fresh command.
- This is a subset, not full POSIX/GNU compatibility. Input command pipes and
  system() are unsupported and report errors. Text processing uses JavaScript strings
  and regular expressions; locale and floating-point edge cases may differ.

### Example

```sh
printf 'apple 2\npear 3\n' | awk '{total += $2} END {print total}'
```

Output:

```text
5
```
