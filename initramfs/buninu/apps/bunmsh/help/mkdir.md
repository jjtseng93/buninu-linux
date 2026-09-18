## mkdir

Create directories with Bun Shell's fallback.

### Usage

```sh
mkdir [-pv] [--parents] DIRECTORY ...
```

### Options and forms

- `-p`, `--parents`: Create missing parent directories and accept existing directories.
- `-v`, `--vebose`: Request verbose output (`--vebose` is Bun Shell's currently accepted spelling).

### Example

```sh
mkdir -p build/output
builtin test -d build/output; echo $?
```

Output:

```text
0
```
