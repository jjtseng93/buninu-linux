## cut

Select character positions.

### Usage

```sh
cut -c LIST [FILE ...]
```

### Options and forms

- `-c LIST`, `-cLIST`: Select character positions or ranges such as `1-3,7`.

### Example

```sh
printf 'abcdef\n' | cut -c2-4
```

Output:

```text
bcd
```
