## tac

Reverse newline-delimited records in each input file.

### Usage

```sh
tac [--] [FILE ...]
```

### Options and forms

- `--`: Stop option parsing.
- `-`: Read from stdin at that operand position.
- Other options are not currently supported.

### Example

```sh
printf 'one\ntwo\nthree\n' | tac
```

Output:

```text
three
two
one
```
