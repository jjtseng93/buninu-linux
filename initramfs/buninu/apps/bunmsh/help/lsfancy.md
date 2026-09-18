## lsfancy

List files with icons, columns, metadata, sorting, and recursion.

### Usage

```sh
lsfancy [-aAdlhRtrS1F] [PATH ...]
```

Because `-h` means human-readable sizes, use `--help` to display this page.

### Options and forms

- `-a`: Include `.` and `..` plus hidden entries.
- `-A`: Include hidden entries except `.` and `..`.
- `-d`: List directories themselves rather than their contents.
- `-l`: Use long format, including symlink targets.
- `-h`: Show human-readable sizes; use `--help` for this page.
- `-R`: Recurse into directories.
- `-t`: Sort by modification time.
- `-r`: Reverse the result order.
- `-S`: Sort by size.
- `-1`: Print one entry per line.
- `-F`: Append `/` for directories, `@` for links, `*` for executables, `=` for sockets, or `|` for FIFOs.

### Example

```sh
builtin lsfancy -1 README.md
```

Output:

```text
📄 README.md
```
