## fgrep

Search for fixed strings, equivalent to `grep -F`.

### Usage

```sh
fgrep [OPTIONS] PATTERN [FILE ...]
```

### Options and forms

Accepts the same supported options as builtin `grep`.

### Example

```sh
printf 'a.b\naxb\n' | builtin fgrep 'a.b'
```

Output:

```text
a.b
```
