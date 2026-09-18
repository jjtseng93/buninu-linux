## ln

Create hard or symbolic links.

### Usage

```sh
ln [-sfT] TARGET LINK
```

### Options and forms

- `-s`: Create a symbolic link.
- `-f`: Replace an existing destination.
- `-T`: Treat the destination as a normal path, not a directory.

### Example

```sh
ln -s target.txt link.txt
readlink link.txt
```

Output:

```text
target.txt
```
