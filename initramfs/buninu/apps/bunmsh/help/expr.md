## expr

Evaluate integer, string, and basic regular-expression expressions.

### Usage

```sh
expr [--] EXPRESSION
```

### Options and forms

- Arithmetic: `+`, `-`, `*`, `/`, `%`, with parentheses and precedence.
- Comparisons: `=`, `!=`, `<`, `<=`, `>`, `>=`.
- `|` selects the first nonempty, nonzero operand; `&` requires both operands.
- `STRING : BRE` returns the first capture, or the matched prefix length when there is no capture.
- Status is 0 for a nonempty, nonzero result, 1 for empty or zero, and 2 for an error.
- Quote operators that the shell would otherwise interpret.

### Example

```sh
expr 2 + 3 '*' 4
```

Output:

```text
14
```
