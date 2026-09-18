## chmod

Change modes using octal values, +x, or a+x.

### Usage

```sh
chmod MODE FILE ...
```

### Options and forms

- Octal modes such as `755` set all permission bits.
- `+x` and `a+x` add executable bits.

### Example

```sh
chmod +x script.sh
builtin test -x script.sh; echo $?
```

Output:

```text
0
```
