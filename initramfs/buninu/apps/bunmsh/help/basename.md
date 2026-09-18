## basename

Remove directory components and an optional suffix.

### Usage

```sh
basename [--] STRING [SUFFIX]
```

### Options and forms

- `--`: Stop option parsing, allowing a string beginning with `-`.
- `SUFFIX`: Remove this exact suffix when it is present and is not the whole basename.

### Example

```sh
basename /usr/local/bin/bun
```

Output:

```text
bun
```

Suffix example:

```sh
basename archive.tar.gz .gz
```

Output:

```text
archive.tar
```
