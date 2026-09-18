## tab

Manage directory tabs and shell session controls.

### Usage

```sh
tab [n | x | c | l | r | s | save | path | mouse | NUMBER]
```

### Options and forms

- `n` creates a tab; `x`/`c` closes it; `l` and `r` switch tabs.
- `save`/`s` saves history; `save d` deduplicates it.
- `path [on|off|true|false]` controls PATH lookup.
- `mouse [on|off|true|false]` controls terminal mouse tracking.
- A numeric operand selects that tab.

### Example

```sh
tab
```

Output:

```text
📁 ~/project  📂 ~/project
[2]$
```
