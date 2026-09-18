## grep

Search text with basic, extended, fixed, recursive, and color modes.

### Usage

```sh
grep [OPTIONS] PATTERN [FILE ...]
```

### Options and forms

- `-E`: Extended regular expressions.
- `-F`: Fixed-string matching.
- `-i`: Ignore case.
- `-q`: Quiet; return status only.
- `-v`: Invert matches.
- `-n`: Prefix line numbers.
- `-o`: Print only matched text.
- `-r`: Recurse into directories.
- `-x`: Match whole lines.
- `--color=always|auto|never`: Control match color; `--colour` is also accepted.

### Example

```sh
printf 'alpha\nbeta\n' | grep beta
```

Output:

```text
beta
```
