## env

Print or modify the environment and optionally run a command.

### Usage

```sh
env [-i] [-u NAME] [NAME=VALUE ...] [COMMAND [ARG ...]]
```

### Options and forms

- `-i`, `--ignore-environment`: Start with an empty environment.
- `-u NAME`, `--unset NAME`, `--unset=NAME`: Remove a variable.
- `--`: Stop option parsing.

### Example

```sh
env NAME=value sh -c 'echo "$NAME"'
```

Output:

```text
value
```
