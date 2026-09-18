## exec

Run a command and terminate the current shell with its status.

### Usage

```sh
exec COMMAND [ARG ...]
```

### Example

```sh
exec printf 'done\n'
```

Output:

```text
done
(shell exits with status 0)
```
