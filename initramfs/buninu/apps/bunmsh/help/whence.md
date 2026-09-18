## whence

Describe command lookup.

### Usage

```sh
whence [-pv] NAME ...
```

### Options

- `-p`: Search `PATH` only, ignoring aliases, functions, and builtins.
- `-v`: Print a verbose description of how each name resolves.

### Example

```sh
whence -p bun
```

Output:

```text
/data/data/com.termux/files/usr/bin/bun
```
