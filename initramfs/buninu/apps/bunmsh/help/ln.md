## ln

Create hard or symbolic links.

### Usage

```sh
ln [-sf] TARGET LINK
ln [-sf] TARGET ... DIRECTORY
```

### Options and forms

- `-s`: Create a symbolic link.
- `-f`: Replace an existing destination.
- `-T`: Treat the destination as a normal path, not a directory.
- Multiple targets may be linked into an existing directory.

### Example

```sh
ln -s target.txt link.txt
readlink link.txt
```

Output:

```text
target.txt
```
