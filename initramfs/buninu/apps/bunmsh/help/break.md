## break

Leave N enclosing loops (default 1). N must be positive. Function calls establish their own loop boundary.

### Usage

```sh
break [N]
```

### Example

```sh
for x in a b; do echo "$x"; break; done
```

Output:

```text
a
```
