## continue

Continue the Nth enclosing loop (default 1). N must be positive.

### Usage

```sh
continue [N]
```

### Example

```sh
for x in a b; do echo "$x"; continue; echo skipped; done
```

Output:

```text
a
b
```
