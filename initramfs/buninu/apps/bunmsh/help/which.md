## which

Print executable paths found through PATH.

### Usage

```sh
which NAME ...
```

### Behavior

- `which` explicitly searches the current `PATH`, even when normal PATH command
  lookup is disabled by `bunmsh --builtin-only` or `tab path off`.
- Use command substitution such as `"$(which NAME)"` to obtain an explicit path
  and run an external command in either mode.

### Example

```sh
which bun
```

Output:

```text
/data/data/com.termux/files/usr/bin/bun
```

To explicitly run a PATH command while normal PATH lookup is disabled:

```sh
tab path off
"$(which sh)" -c 'printf path-command'
```

Output:

```text
path-command
```
