## source

Evaluate a file in the current shell.

### Usage

```sh
source FILE [ARG ...]
```

### Example

```sh
printf 'NAME=sourced\n' > settings.sh
source settings.sh
echo "$NAME"
```

Output:

```text
sourced
```
