## mv

Move files with Bun Shell's fallback.

### Usage

```sh
mv [OPTIONS] SOURCE ... DESTINATION
```

### Options and forms

- `-f`, `-h`, `-i`, `-n`, `-v`: Currently accepted by Bun Shell but do not change behaviour; `-i` and `-n` do not prevent overwriting.

### Example

```sh
mv old.txt new.txt
basename new.txt
```

Output:

```text
new.txt
```
