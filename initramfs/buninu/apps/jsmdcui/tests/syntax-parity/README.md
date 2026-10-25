# micro syntax parity fixtures

This directory contains one lexical sample for each of **158 syntax definitions**.
The current report uses upstream micro YAML for both engines, including
JavaScript, Python and Markdown. For the first run those three local files were
backed up, temporarily replaced and restored byte-for-byte after comparison.
`--upstream-syntax` reproduces that comparison without modifying any syntax files.
Without this flag, the comparator tests only byte-identical local definitions
and excludes JavaScript, Python and Markdown; included definitions then come
from each engine's own tree.

- [REPORT.md](REPORT.md): counts and first differences, with sample links.
- `comparison.html` (generated locally, not included): side-by-side colors using
  the same Monokai palette; hover over a span for its exact group. No external
  assets required.
- [report.json](report.json): machine-readable per-language results.
- `samples/*.txt`: generated rule witnesses, with hand-written Dockerfile and
  MSBuild examples. They are lexical test fragments, **not generally valid
  programs**. Region boundaries, escaping, and overlapping patterns are included.

The oracle invokes the actual, unmodified upstream `pkg/highlight` Go package,
including its YAML parser and include resolution. No Go regex approximation is
used for the reference results. This is a highlighter comparison, not a terminal
screenshot comparison or a test of automatic filetype detection. The sample
filenames deliberately do not guess extensions: select the filetype shown in
the report when opening them in an editor (`set filetype dockerfile`, for example).

All samples have non-default groups in both engines. Equal results mean equal
per-character syntax groups **for these samples only**, not full language parity.
The HTML is a viewing aid, not a substitute for the group-level comparison.

## Generate the comparison HTML and reports

Install Go 1.24 or newer and Bun with scoped RegExp modifier support. Start in
this directory. Point `MICRO_SOURCE` at an existing upstream micro checkout:

```sh
export MICRO_SOURCE=/absolute/path/to/go-micro
export PARITY_BUILD_DIR="$(mktemp -d)"
cp go.mod "$PARITY_BUILD_DIR/oracle.mod"
go mod edit -modfile="$PARITY_BUILD_DIR/oracle.mod" \
  -replace="github.com/micro-editor/micro/v2=$MICRO_SOURCE"
go build -mod=mod -modfile="$PARITY_BUILD_DIR/oracle.mod" \
  -o "$PARITY_BUILD_DIR/oracle" oracle.go
bun compare.mjs "$MICRO_SOURCE" "$PARITY_BUILD_DIR/oracle" --upstream-syntax
```

The final `bun compare.mjs` command writes `comparison.html`, `REPORT.md` and
`report.json` into this directory. Open `comparison.html` in a browser and expand
a language to compare micro (left) with jmi (right). Once the oracle executable
has been built, rerun just that final command to regenerate the page. The HTML
is intentionally not checked in and has no Git ignore rule; remove it after
viewing if you do not want it included in a later commit.

Go downloads test-only dependencies to its module cache. It is not a jsmdcui
runtime dependency; the checkout's module file and upstream sources remain
unchanged. The reference commit is recorded in the report. Re-running rewrites
only the reports; it keeps the checked-in samples. `--generate` regenerates
lexical witnesses and overwrites hand-written samples, so normal comparisons
should omit it.

Differences are reported rather than hidden or automatically fixed. In
particular, a regex compiling successfully does not establish equivalence of
nested region handling, skip masking, or rule ordering.

## Scanner safety checks

Run `bun test tests/highlight-regions.test.js tests/go-regexp.test.js` from the
jsmdcui root. These cover zero-width cycles, Unicode empty matches, NUL, isolated
surrogates, cyclic definitions/state, and a 200,003-character line whose final
keyword must still be highlighted. Region transitions are iterative; there is
no input line-length cutoff. Malformed definitions are limited to 128 nested
rule levels. A repeated state at the same position advances by one Unicode
character and continues highlighting. If malformed states keep creating fresh
objects, 256 transitions without advancing reset the unfinished region for that
line instead of carrying it forward.

A manual stability run also processed Vue 3.5.13's `vue.global.prod.js`
(157,924 bytes, longest line 141,082 UTF-16 units) in about 87 ms on the test
host, without a stack overflow or truncation. This is not proof of exact Vue
syntax parity. No downloaded Vue bundle is included in the repository.

These guards prevent scanner loops and stack exhaustion. They cannot interrupt
a single pathological native JavaScript RegExp execution; arbitrary untrusted
regexes would need worker/process isolation for a hard execution-time limit.
