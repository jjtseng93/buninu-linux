## command

Run or inspect a command while bypassing aliases.

### Usage

```sh
command [-pVv] COMMAND [ARG ...]
```

### Options and forms

- `-p`: Use bunmsh's default command PATH.
- `-v`: Print a concise lookup result.
- `-V`: Print a verbose lookup description.

### Example

```sh
command -V echo
```

Output:

```text
echo is a shell builtin
```
