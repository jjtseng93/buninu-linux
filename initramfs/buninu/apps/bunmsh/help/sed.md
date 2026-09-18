## sed

Apply supported print and substitution expressions.

### Usage

```sh
sed [-nEr] [-e SCRIPT] [-i] [SCRIPT] [FILE ...]
```

### Options and forms

- `-n`: Suppress automatic output.
- `-e SCRIPT`, `-eSCRIPT`: Add a script.
- `-E`, `-r`: Use extended regular expressions.
- `-i`: Edit files in place.
- Supported commands include numeric `p` and `s///` with `g` and `p` flags.

### Example

```sh
printf 'hello world\n' | sed 's/world/bunmsh/'
```

Output:

```text
hello bunmsh
```
