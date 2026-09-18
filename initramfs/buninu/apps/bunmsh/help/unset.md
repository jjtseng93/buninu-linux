## unset

Remove shell variables.

### Usage

```sh
unset [-v] [--] NAME ...
```

### Options and forms

- `-v`: Explicitly select variables (the only supported unset kind).
- `--`: Stop option parsing.

### Example

```sh
NAME=value
unset NAME
echo "${NAME:-missing}"
```

Output:

```text
missing
```
