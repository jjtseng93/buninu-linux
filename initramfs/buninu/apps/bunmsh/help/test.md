## test

Evaluate file, string, and integer expressions; [ requires a closing ].

### Usage

```sh
test EXPRESSION
```

### Options and forms

- Unary file tests: `-e`, `-f`, `-d`, `-b`, `-c`, `-p`, `-S`, `-L`/`-h`, `-s`, `-r`, `-w`, and `-x`.
- Unary string tests: `-n` and `-z`.
- String comparisons: `=`, `==`, and `!=`.
- Integer comparisons: `-eq`, `-ne`, `-gt`, `-ge`, `-lt`, and `-le`.
- File comparisons: `-nt`, `-ot`, and `-ef`. Logical `!`, `-a`, and `-o` are supported.

### Example

```sh
test -d /tmp
echo $?
```

Output:

```text
0
```
