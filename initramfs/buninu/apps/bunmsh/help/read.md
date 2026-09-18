## read

Read a line into shell variables.

### Usage

```sh
read [-r] NAME ...
```

### Options and forms

- `-r`: Preserve backslashes instead of treating them as escapes.
- `--`: Stop option parsing. With no names, assign to `REPLY`.

### Example

```sh
printf 'one two\n' | read first second
echo "$first/$second"
```

Output:

```text
one/two
```
