## cp

Copy files and directories.

### Usage

```sh
cp [-rRv] SOURCE ... DESTINATION
cp -p [-v] [--] FILE ... DESTINATION
```

### Options and forms

- `-r`, `-R`: Copy directories recursively (`-r` is translated to Bun Shell's `-R`).
- `-v`: Request verbose output.
- `-p`: Preserve regular-file ownership, permissions and access/modification
  times. Multiple sources require a directory destination; recursive `-p`
  combinations are not yet supported and report an error.
- `-n`: Accepted by Bun Shell but currently does not prevent overwriting.

### Example

```sh
cp source.txt copy.txt
cat copy.txt
```

Output:

```text
hello
```
