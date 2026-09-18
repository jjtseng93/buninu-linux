## print

Write arguments with mksh-style print semantics.

### Usage

```sh
print [-rRnNl] [-uFD] [--] [ARG ...]
```

### Options and forms

- `-r`, `-R`: Do not interpret backslash escapes.
- `-n`: Omit the terminator.
- `-l`: Separate arguments with newlines.
- `-N`: Separate and terminate arguments with NUL bytes.
- `-uFD`: Write to file descriptor 1 or 2; other descriptors are not implemented.
- `--`: Stop option parsing.

### Example

```sh
print hello world
```

Output:

```text
hello world
```
