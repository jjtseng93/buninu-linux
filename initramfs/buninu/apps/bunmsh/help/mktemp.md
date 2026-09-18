## mktemp

Create a temporary file or directory; TEMPLATE ends in XXXXXX.

### Usage

```sh
mktemp [-d] TEMPLATE
```

### Options and forms

- `-d`: Create a directory instead of a file.
- The template must end in exactly six `X` characters.

### Example

```sh
mktemp sample.XXXXXX
```

Output:

```text
sample.a1B2c3
```
