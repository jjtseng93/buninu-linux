## touch

Create files or update timestamps.

### Usage

```sh
touch FILE ...
```

### Options and forms

- No options are currently supported.

### Example

```sh
touch created.txt
builtin test -f created.txt; echo $?
```

Output:

```text
0
```
