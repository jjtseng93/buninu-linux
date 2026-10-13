## export

Mark variables for export, or list them. In `set -o posix` mode, external programs receive only inherited/exported variables and command-prefix assignments. Shell pipelines and subshells retain all shell variables through internal state transfer. Outside POSIX mode, bunmsh preserves its default of passing all variables to external programs.

### Usage

```sh
export [-p] [NAME[=VALUE] ...]
```

### Example

```sh
export NAME=value
env | grep '^NAME='
```

Output:

```text
NAME=value
```
