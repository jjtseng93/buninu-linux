## tail

Write the last lines, or start output at a selected line.

### Usage

```sh
tail [-n N | -N | -n +N | -n+N] [FILE ...]
```

### Options and forms

- `-n N`, `-N`: Write the last N lines.
- `-n +N`, `-n+N`: Start output at line N.

### Example

```sh
printf 'one\ntwo\nthree\n' | tail -n 2
```

Output:

```text
two
three
```
