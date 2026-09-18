## catfancy

Render Markdown and colorized parsed structured data; pass other formats through.

### Usage

```sh
catfancy [--exclude PATTERN]... [--] [FILE ...]
```

### Options and forms

- `--`: Stop option parsing.
- `--exclude PATTERN`/`--exclude=PATTERN`: Omit matching file operands using
  `Bun.Glob` patterns. Repeat the option to exclude more patterns; quote a
  pattern to prevent the shell from expanding it first.
- `-`: Read unformatted stdin; file previews are selected from filename extensions.
- `.js`/`.mjs`/`.cjs`/`.jsx` and `.ts`/`.mts`/`.cts`/`.tsx` files are wrapped
  in a fenced ` ```javascript `/` ```typescript ` block and rendered through
  `Bun.markdown.ansi`, for the same syntax coloring Markdown code blocks get.

### Example

```sh
builtin catfancy package.json
```

Output:

```text
{
  "name": "bunmsh",
  "version": "0.1.10"
}  # colorized
```
