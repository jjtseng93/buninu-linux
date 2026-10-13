## chmod

Change file modes using octal values or symbolic permission changes.

### Usage

```sh
chmod MODE FILE ...
```

### Options and forms

- Octal modes such as `755` set all permission bits.
- `+x` retains its existing shorthand for adding executable bits for everyone.
- Explicit classes `u`, `g`, `o`, or `a` support `+`, `-`, and `=` with `rwxX`.
- `X` adds execution only for directories or files already executable.
- Comma-separated clauses and multiple operations are applied in order.
- Examples: `a-w`, `u+rw`, `go=rx`, `u=rw,g=r,o=`.
- Recursive mode, permission copying, `s`/`t`, and omitted classes other than
  the existing `+x` shorthand are not implemented.

### Example

```sh
chmod +x script.sh
builtin test -x script.sh; echo $?
```

Output:

```text
0
```
