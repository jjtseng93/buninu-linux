## ls

Use the lsfancy emoji and terminal-width-aware listing. With `set -o posix`, fallback `ls` omits icons and automatic directory suffixes. Explicit `-F` suffixes still apply; `lsfancy` always retains its icons.

### Usage

```sh
ls [-aAdilhLRtrS1F] [PATH ...]
```

Because `-h` means human-readable sizes, use `--help` to display this page.

### Options and forms

- `-a`: Include `.` and `..` plus hidden entries.
- `-A`: Include hidden entries except `.` and `..`.
- `-d`: List directories themselves rather than their contents.
- `-l`: Use long format.
- `-i`: Print inode numbers.
- `-L`: Follow symbolic links.
- `-h`: Show human-readable sizes; use `--help` for this page.
- `-R`: Recurse into directories.
- `-t`: Sort by modification time.
- `-r`: Reverse the result order.
- `-S`: Sort by size.
- `-1`: Print one entry per line.
- `-F`: Append classify suffixes such as `/`, `@`, and `*`.

### Example

```sh
builtin ls -l README.md
```

Output:

```text
-rw-r--r--    32221 2026-08-28 17:55 📄 README.md
```
