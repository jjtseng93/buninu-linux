## return

Return from a function or sourced script. Without STATUS, preserve the previous status.

### Usage

```sh
return [STATUS]
```

### Example

```sh
f () { return 7; }
f
echo "$?"
```

Output:

```text
7
```
