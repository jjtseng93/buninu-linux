## tr

Translate or delete characters.

### Usage

```sh
tr [-d] SET1 [SET2]
```

### Options and forms

- `-d`: Delete characters in SET1 instead of translating them.
- Simple ranges such as `a-z` are supported.

### Example

```sh
printf 'hello\n' | tr a-z A-Z
```

Output:

```text
HELLO
```

`-s SET` squeezes repeated characters in SET. With two sets, translation happens
before squeezing SET2. `-ds SET1 SET2` deletes SET1 then squeezes SET2.
`--` ends option parsing; unsupported options report an error.
