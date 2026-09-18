## rmdir

Remove empty directories.

### Usage

```sh
rmdir [-p | --parents] DIRECTORY ...
```

### Options and forms

- `-p`, `--parents`: Remove empty parent directories after each operand.

### Example

```sh
mkdir empty
rmdir empty
builtin test -d empty; echo $?
```

Output:

```text
1
```
