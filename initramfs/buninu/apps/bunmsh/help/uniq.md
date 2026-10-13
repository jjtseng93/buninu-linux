## uniq

Collapse adjacent equal lines without sorting. Comparisons preserve bytes.

### Usage

```sh
uniq [-cdu] [--] [INPUT [OUTPUT]]
```

`-c` prefixes counts; `-d` selects repeated groups; `-u` selects single lines.
`-` reads standard input or writes standard output. Missing final newlines
are added. Field/character skipping and other GNU options are unsupported.

### Example

```sh
printf 'a\na\nb\na\n' | uniq
```

Output:

```text
a
b
a
```
