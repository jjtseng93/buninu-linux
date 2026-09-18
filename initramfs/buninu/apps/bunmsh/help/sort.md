## sort

Sort, reverse, compare numerically, or deduplicate lines.

### Usage

```sh
sort [-rnu] [FILE ...]
```

### Options and forms

- `-r`: Reverse the result.
- `-n`: Compare numerically.
- `-u`: Remove duplicate lines. These short flags may be combined.

### Example

```sh
printf 'c\na\nb\n' | sort
```

Output:

```text
a
b
c
```
