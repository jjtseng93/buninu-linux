## rm

Remove files and directories with Bun Shell's fallback.

### Usage

```sh
rm [OPTIONS] FILE ...
```

### Options and forms

- `-f`: Ignore missing operands.
- `-r`, `-R`, `--recursive`: Remove directories recursively.
- `-v`, `--verbose`: Request verbose output.
- `-d`, `--dir`: Remove empty directories.
- `-i`, `--interactive=always`: Prompt for each removal.
- `-I`, `--interactive=once`: Prompt once.
- `--interactive=never`: Never prompt.
- `--preserve-root`, `--no-preserve-root`: Accepted but currently have no effect.

### Example

```sh
rm unwanted.txt
builtin test -e unwanted.txt; echo $?
```

Output:

```text
1
```
