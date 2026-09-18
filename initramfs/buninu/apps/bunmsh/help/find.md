## find

Walk paths with name, path, type, depth, print, and -exec expressions.

### Usage

```sh
find [PATH ...] [EXPRESSION]
```

### Options and forms

- `-name`, `-iname`: Match a basename, optionally ignoring case.
- `-path`, `-ipath`: Match a path, optionally ignoring case.
- `-type f|d|l`: Select files, directories, or links.
- `-mindepth N`, `-maxdepth N`: Limit traversal depth.
- `-print`, `-print0`: Emit newline- or NUL-delimited paths.
- `!`, `-not`: Negate the following expression.
- `-exec COMMAND {} \;`: Run once per path.
- `-exec COMMAND {} +`: Run with batches of paths.

### Example

```sh
find . -type f -name '*.md'
```

Output:

```text
./README.md
./CHANGELOG.md
```
