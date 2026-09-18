## set

Print variables or replace positional parameters.

### Usage

```sh
set [-- [ARG ...]]
```

### Options and forms

- `--`: Replace positional parameters with the remaining arguments. With no arguments, print variables.

### Example

```sh
set -- alpha beta
echo "$1/$2"
```

Output:

```text
alpha/beta
```
