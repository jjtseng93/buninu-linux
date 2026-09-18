## head

Write the first lines or bytes of input.

### Usage

```sh
head [-n N | -N | -c N | -cN] [FILE ...]
```

### Options and forms

- `-n N`, `-N`: Write the first N lines.
- `-c N`, `-cN`: Write the first N bytes.

### Example

```sh
printf 'one\ntwo\nthree\n' | head -n 2
```

Output:

```text
one
two
```
