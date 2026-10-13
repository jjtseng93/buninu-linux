## egrep

Search using extended regular expressions, equivalent to `grep -E`.

### Usage

```sh
egrep [OPTIONS] PATTERN [FILE ...]
```

### Options and forms

Accepts the same supported options as builtin `grep`.

### Example

```sh
printf 'red\nblue\ngreen\n' | builtin egrep 'red|blue'
```

Output:

```text
red
blue
```
