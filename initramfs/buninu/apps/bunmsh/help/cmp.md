## cmp

Compare two files byte by byte. Return 0 for identical data, 1 for differences,
and 2 for errors. `-` reads standard input.

### Usage

```sh
cmp [-s] [--] FILE1 FILE2
```

`-s` (also `--silent` or `--quiet`) suppresses difference and file-error messages.
Without it, report the first differing byte and line, or which file ends first.
Byte offsets, `-l`, and other GNU extensions are not implemented.

### Example

```sh
printf same > first
printf same > second
cmp -s first second
echo $?
```

Output:

```text
0
```
