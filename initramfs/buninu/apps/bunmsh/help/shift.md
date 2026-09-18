## shift

Discard leading positional parameters.

### Usage

```sh
shift [COUNT]
```

### Example

```sh
set -- one two three
shift
echo "$1 $2"
```

Output:

```text
two three
```
