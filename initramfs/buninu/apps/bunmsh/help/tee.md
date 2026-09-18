## tee

Copy stdin to stdout and files.

### Usage

```sh
tee [-a] [FILE ...]
```

### Options and forms

- `-a`: Append to files rather than replacing them.

### Example

```sh
printf hello | tee output.txt
```

Output:

```text
hello
```
