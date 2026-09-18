## tr

Translate or delete characters.

### Usage

```sh
tr [-d] SET1 [SET2]
```

### Options and forms

- `-d`: Delete characters in SET1 instead of translating them.
- Simple ranges such as `a-z` are supported.

### Example

```sh
printf 'hello\n' | tr a-z A-Z
```

Output:

```text
HELLO
```
