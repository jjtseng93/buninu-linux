## time

Run a command and report elapsed time.

### Usage

```sh
time [COMMAND [ARG ...]]
```

### Display

- Elapsed time is written to stderr in milliseconds with six decimal places.
- When stderr is a terminal, each three-digit magnitude group uses a different
  ANSI color, making units and fractional precision easier to distinguish.
- The decimal point is dimmed. Colors are omitted when stderr is redirected or
  captured.

### Example

```sh
time true
```

Output:

```text
real 0.000000 ms
```
