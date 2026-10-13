## sed

Apply editing commands to pattern and hold spaces.

### Usage

```sh
sed [-nEr] [-e SCRIPT | -f FILE] [-i] [SCRIPT] [FILE ...]
```

### Options and forms

- `-n`: Suppress automatic output.
- `-e SCRIPT`, `-eSCRIPT`: Add a script.
- `-f FILE`, `-fFILE`: Read a script from a file.
- `-E`, `-r`: Use extended regular expressions.
- `-i`: Edit files in place.
- Numeric, last-line (`$`), and regular-expression addresses; ranges, inversion, and `{ ... }` groups.
- `s///` with `g`, `p`, and occurrence-number flags; `y///` translation.
- `p`, `P`, `d`, `D`, `q`, `=`, `n`, `N`; hold-space commands `h`, `H`, `g`, `G`, `x`.
- Labels (`:`), unconditional branches (`b`), and substitution-test branches (`t`, `T`).
- `a`, `i`, `c` text commands; `r FILE` appends file contents after the current cycle. Missing/unreadable files are skipped. This remains a subset: `w` is not implemented.

### Example

```sh
printf 'hello world\n' | sed 's/world/bunmsh/'
```

Output:

```text
hello bunmsh
```
