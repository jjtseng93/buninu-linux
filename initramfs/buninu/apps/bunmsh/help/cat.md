## cat

Concatenate files or stdin.

### Usage

```sh
cat [--exclude PATTERN]... [--] [FILE ...]
```

### Options and forms

- `--`: Stop option parsing.
- `--exclude PATTERN`/`--exclude=PATTERN`: Omit matching file operands using
  `Bun.Glob` patterns. Repeat the option to exclude more patterns; quote a
  pattern to prevent the shell from expanding it first.
- `-`: Read from stdin at that operand position. No other options are supported.

### Example

```sh
printf 'alpha\n' > alpha.txt
printf 'beta\n' > beta.txt
builtin cat --exclude 'alpha.*' *.txt
```

Output:

```text
beta
```
