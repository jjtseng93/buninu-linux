## builtin

Run a registered builtin explicitly; with no command, list builtin names.

### Usage

```sh
builtin [--] [COMMAND [ARG ...]]
```

### Options and forms

- `--`: Stop builtin's own option parsing before the command name.

### Example

```sh
builtin echo hello
```

Output:

```text
hello
```
