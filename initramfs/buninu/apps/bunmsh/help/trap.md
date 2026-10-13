## trap

Register shell code for EXIT (0) or a catchable signal. No operands lists handlers; ACTION - resets and an empty ACTION ignores the signal in this shell. Signal handlers are deferred to command boundaries. Background process ownership is unchanged.

### Usage

```sh
trap [ACTION SIGNAL ...]
```

### Example

```sh
trap 'echo done' 0
exit 0
```

Output:

```text
done
```
