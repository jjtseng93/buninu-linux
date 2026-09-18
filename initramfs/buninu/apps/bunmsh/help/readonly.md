## readonly

Define variables that cannot be changed.

### Usage

```sh
readonly [-p] [--] [NAME[=VALUE] ...]
```

### Options and forms

- `-p`: Print readonly definitions.
- `--`: Stop option parsing.

### Example

```sh
readonly NAME=value
echo "$NAME"
```

Output:

```text
value
```
