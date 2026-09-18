## printf

Format and write arguments.

### Usage

```sh
printf FORMAT [ARG ...]
```

### Options and forms

- Supported conversions are `%s`, `%d`, `%i`, `%%`, and optional numeric field widths; backslash escapes are also interpreted.

### Example

```sh
printf '%s=%d\n' answer 42
```

Output:

```text
answer=42
```
