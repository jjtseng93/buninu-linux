## serve

Start the bunmsh HTTP file server.

### Usage

```sh
serve [--auto-open] [--minapk-webview] [--random-url] [DIRECTORY]
```

### Options and forms

- `--auto-open` / `--auto-open=off` / `--auto-open=/path`: Open the serving
  URL after startup, or explicitly disable it, or open a specific path under
  it instead of the root. Looks for `xdg-open` on PATH first regardless of
  platform; falls back to `open` on macOS or `cmd /c start` on Windows only
  when `xdg-open` isn't found. Bare `--auto-open` turns it on; `=off`, `=no`,
  `=false`, or `=` (empty) turns it off, overriding an environment default
  that turned it on; a value starting with `/` (e.g. `--auto-open=/index.html`)
  turns it on and opens that path relative to the served URL instead of the
  root — resolved after any `--random-url` prefix, so the secret prefix is
  still there and the URL still works. The `o` control on stdin (see below)
  opens the same target this flag configured.
- `--minapk-webview` / `--minapk-webview=N` / `--minapk-webview=off`: Pass
  `MINAPK_WEBVIEW` to the spawned opener. Bare `--minapk-webview` passes `1`;
  `=N` passes the literal digit string `N`; `=off`, `=no`, `=false`, or `=`
  (empty) means don't pass it at all. Not passed by default.
- `--random-url` / `--random-url=off`: Serve beneath a high-entropy random URL
  prefix (requests without it get `404`), or explicitly disable it. Same
  bare/`=off`/`=no`/`=false`/`=` rules as `--auto-open`.
- `SERVE_AUTO_OPEN`, `SERVE_MINAPK_WEBVIEW`, and `SERVE_RANDOM_URL` set the
  defaults before CLI flags are applied (accepting `1`, `true`, `yes`, or
  `on`; a digit string for `SERVE_MINAPK_WEBVIEW`; a `/`-led path for
  `SERVE_AUTO_OPEN`); every flag defaults to off/not-passed. A CLI flag
  always overrides its environment default, including turning off something
  the environment turned on.
- `--` stops option parsing. The optional operand selects the served directory.

### Example

```sh
serve --random-url public
```

Output:

```text
Serving /home/user/public
  http://localhost:3000/AaBIdviNcACxwZF2x3VW0QAaBIdviNcAGsAviNI5B59AAaBIdviNcAKsuNiSJkMrdQAaBIdviNcAOoVDLS5ydB9Q/
```
