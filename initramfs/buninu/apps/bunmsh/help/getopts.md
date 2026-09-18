## getopts

Parse positional options.

### Usage

```sh
getopts OPTSTRING NAME [ARG ...]
```

### Options and forms

- A leading `:` in OPTSTRING selects silent error reporting.
- A letter followed by `:` requires an argument. Results use the named variable plus `OPTARG` and `OPTIND`.

### Example

```sh
set -- -a value
getopts a: option
echo "$option=$OPTARG"
```

Output:

```text
a=value
```
