## lsbun

Invoke Bun Shell's original ls implementation.

### Usage

```sh
lsbun [OPTIONS] [PATH ...]
```

### Options and forms

- `-a`: Include all entries.
- `-A`: Include hidden entries except `.` and `..`.
- `-d`: List directories themselves.
- `-l`: Use long format.
- `-R`: Recurse into directories.

### Example

```sh
builtin lsbun README.md
```

Output:

```text
README.md
```
