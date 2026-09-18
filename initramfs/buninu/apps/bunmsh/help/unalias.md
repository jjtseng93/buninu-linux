## unalias

Remove aliases.

### Usage

```sh
unalias [-a] [--] NAME ...
```

### Options and forms

- `-a`: Remove every alias.
- `--`: Stop option parsing.

### Example

```sh
alias ll='ls -l'
unalias ll
type ll
```

Output:

```text
ll not found
```
