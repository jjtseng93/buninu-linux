## export

Set or list environment variables.

### Usage

```sh
export [NAME[=VALUE] ...]
```

### Example

```sh
export NAME=value
env | grep '^NAME='
```

Output:

```text
NAME=value
```
