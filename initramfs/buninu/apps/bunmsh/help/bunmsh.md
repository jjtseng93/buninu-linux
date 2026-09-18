## bunmsh

Invoke the active bunmsh entry point.

### Usage

```sh
bunmsh [ARG ...]
```

### Options and forms

- `SCRIPT [ARG ...]`: Execute a shell script file.
- `-c SOURCE [ARG ...]`: Parse and execute shell source text.
- `-cc COMMAND [ARG ...]`: Execute argv directly without shell parsing or expansion.
- `-i`: Enter interactive mode after any requested command or script.
- `--mouse`: Enable terminal mouse events.
- `--builtin-only`: Disable PATH lookup while retaining builtins.
- `-V`, `--version`: Print the bunmsh version.
- `--readme`: Render the bundled README.
- `--changelog`: Render the bundled changelog.
- `--build-exe`: Build `./bmsh` for the current platform.
- `--build-for TARGET`: Cross-compile `./bmsh` for a target.
- `--`: Stop option parsing before a script path.

### Tar-backend asset controls

These options currently work only with the tar asset backend. They are not
available to builds that embed the asset directory directly with Bun's
`--asset` backend. See [single-exe/README.md](../single-exe/README.md) for the
backend comparison, build setup, and extraction layout.

- `--assets-list`: List embedded asset paths and exit.
- `--assets-extract`: Extract embedded assets beside the executable and exit.
- `--assets-external`: Ignore embedded assets and read the extracted files.

### Example

```sh
bunmsh -c 'echo hello'
```

Output:

```text
hello
```
