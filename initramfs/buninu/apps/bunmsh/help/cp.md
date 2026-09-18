## cp

Copy files and directories.

### Usage

```sh
cp [-rRv] SOURCE ... DESTINATION
```

### Options and forms

- `-r`, `-R`: Copy directories recursively (`-r` is translated to Bun Shell's `-R`).
- `-v`: Request verbose output.
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
