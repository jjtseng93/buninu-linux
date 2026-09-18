## wc

Count lines, words, and bytes.

### Usage

```sh
wc [-lwc] [FILE ...]
```

### Options and forms

- `-l`: Count lines.
- `-w`: Count words.
- `-c`: Count bytes. Short flags may be combined.

### Example

```sh
printf 'one two\n' | wc -lwc
```

Output:

```text
1 2 8
```
