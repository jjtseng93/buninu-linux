## set

Print variables, replace positional parameters, or change shell options.

### Usage

```sh
set [-eufxv] [+eufxv] [-o NAME | +o NAME] [-- [ARG ...]]
```

### Options and forms

- No arguments: print variables.
- `--`: replace positional parameters, including clearing them with no following arguments.
- `-`: end options and disable verbose/xtrace; replace positional parameters only when arguments follow.
- `-e` / `+e`: enable/disable exit on untested failures. Conditions, negation and non-final AND/OR commands suppress it.
- `-u` / `+u`: enable/disable errors for unset parameters; explicit defaults still work.
- `-f` / `+f`: disable/enable pathname expansion.
- `-x` / `+x`: enable/disable execution tracing.
- `-o` / `+o` without a name: list named option states / reusable set commands.
- Names: `errexit`, `nounset`, `noglob`, `xtrace`, `verbose`, `posix`. CLI `-v` prints initial input; incremental verbose reading is not yet implemented.
- `-o posix`: enable compatibility mode. The fallback `ls` prints without icons or automatic directory suffixes; `lsfancy` remains decorative. External programs receive only inherited/exported variables and command-prefix assignments; pipelines and subshells still receive complete shell state. Use `+o posix` to restore the default, which passes all variables to external programs. This option is not a guarantee of complete POSIX semantics.

### Example

```sh
set -- alpha beta
echo "$1/$2"
```

Output:

```text
alpha/beta
```
