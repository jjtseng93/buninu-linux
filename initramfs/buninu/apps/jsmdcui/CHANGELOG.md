# Changelog

All notable user-visible changes to jsmdcui are documented here.

## [0.19.0] - 2026-08-24

### Fixed

- `--assets-external` now works in a compiled binary. Every embedded asset
  was affected: `--demo-<name>` reported `demos/<name>.md was not found`,
  `--demo-list` listed only `testapp.md`, `--readme` and `--changelog` failed
  with `ENOENT`, and the runtime registry (colorschemes, syntax, help,
  jsplugins) looked in the wrong directory. Two causes, both in the
  bootstrap:
  * `assetsHelper`'s `--asset` branch stayed live in tar builds, rooted at
    the binary's own `/$bunfs/root`. With the embedded store switched off it
    enumerated the executable and its own archive as if they were assets, so
    `hasInternalAssets()` answered `true` and listings came back empty. A
    store of `null` (the loader ran and was told to stay external) is now
    told apart from `undefined` (no loader in the graph, the `--asset` back
    end).
  * The disk fallback looked for `<exe dir>/<key>`, but `--assets-extract`
    writes the archive exactly as packed, namespace included:
    `<exe dir>/assets/<name>@<version>/<key>`.

### Added

- `assetsHelper` exports `getAssetKey(path)` and `assetDiskPath(path)` — the
  key an asset is stored under, and the file its disk fallback reads. A
  program that writes its own fallback needs the same two answers.
- `assetsHelper` exports `readAssetTextSync(path)` and
  `readAssetBytesSync(path)`, sync twins of `readAssetText` /
  `readAssetBytes` for callers that cannot await, such as argument parsing.

### Changed

- jsmdcui reads its own assets through `readAssetText` / `assetDiskPath`
  instead of joining `REPO_ROOT` by hand, so every read follows the
  extracted tree as well as the embedded one.

## [0.18.2] - 2026-08-23

- Added ASSETS_BUNFS=1 for the build system
  * Use --asset to pack assets
  * See single-exe/README.md
- Changed the tar build-exe to gzip compressed by default

## [0.18.1] - 2026-08-19

### Fixed

- Fix `switchBackend`'s unix-socket endpoint losing a leading NUL byte, which
  broke reaching a Linux abstract-namespace socket (a name starting with
  `"\0"`, as opposed to a filesystem path). `new URL()` percent-encodes a NUL
  byte in the path to `%00`; `rpc.mjs` now runs the extracted path through
  `decodeURIComponent()` before handing it to Bun's `unix` fetch option, so
  the exact original byte reaches Bun rather than the three literal
  characters `%00`. Filesystem-path endpoints are unaffected, since they have
  nothing that needs decoding.

## [0.18.0] - 2026-08-19

### Added

- Add `switchBackend(endpoint)` to `rpc.mjs`, repointing every `rpc.*` call
  (including `_discover`) at a different endpoint instead of the default
  `"rpc"`. Returns the previous endpoint so a caller can restore it.
- Accept a Bun unix socket as that endpoint: pass `"unix:/path/to/sock"` (or
  `"UNIX:/path/to/sock"`) to `switchBackend`, and every `rpc.*` fetch is
  issued over that socket via Bun's `unix` fetch option instead of as an
  http path. Dispatch is unaffected, since routing is by function name in
  the request body rather than by HTTP path. Only meaningful when `rpc.mjs`
  runs under Bun (the `unix` fetch option has no effect in a browser).

## [0.17.3] - 2026-08-12

### Fixed

- Request a redraw from every `$()` selector method that changes what is on
  screen, not only `.data()` and `.val()`. `.show()`, `.hide()`, `.toggle()`,
  `.push()`, `.pop()`, `.shift()`, `.unshift()`, `.splice()`, and
  `.cell(row, col).text(value)` / `.cell(row, col).val(checked)` previously
  updated the buffer without asking the TUI to repaint, so a call made
  outside a keypress-driven handler (a `setInterval` tick, an awaited RPC
  callback, a resolved promise) would sit invisible on screen until an
  unrelated keypress or click happened to trigger the next redraw.

## [0.17.2] - 2026-08-12

### Fixed

- Keep `_mdcuiAnsiText` in sync while typing directly into an mdcui `text` or
  `textarea` control. Plain character insertion, backspace, and forward
  delete previously updated only the buffer's plain lines, so any later
  action that rebuilds the document from the cached ANSI snapshot (for
  example, refreshing Kitty images after a reactive `.data()` update) could
  silently revert unsaved keystrokes back to their pre-edit value. These
  edits now update the corresponding ANSI line the same way table-cell edits
  already did, so the cached snapshot never falls behind what is on screen.

## [0.17.0] - 2026-08-11

This release makes images first-class reactive Markdown data in both terminal
and browser applications. It adds a portable heading image selector, refreshes
Kitty graphics when template images change, accepts image data URLs, and
provides embedded-first asset readers with an external-file fallback. A new
bilingual image-switching demo and expanded documentation show both bundled
image sources and RPC-loaded data URLs.

### Added

- Add cross-interface `$(heading).img(index = 0).src`. In the WUI it returns
  the indexed real `<img>` element's resolved `src`; in the TUI it returns the
  indexed image address from rendered OSC 8 metadata below the heading and
  before the next heading. Missing or invalid indexes return an empty string.
- Add `readAssetText(path)` and `readAssetBytes(path)` to the single-executable
  asset helpers. Both prefer `internalAssets` and automatically fall back to
  the same path under `REPO_ROOT`; the bytes API consistently resolves to a
  `Uint8Array`.
- Accept `data:image/...` URLs in Kitty rendering. Preserve them across Bun's
  Markdown-to-ANSI conversion, decode their payload to image bytes, and feed
  them through the existing size detection, compatibility conversion, stable
  image ID, and Kitty transmission flow.
- Add `demos/img-change.md` and its two compact JPEG assets. The bilingual demo
  loads the images through its back-end RPC as data URLs, initializes a
  reactive image during `onMdcuiLoad()`, and alternates the sources with
  heading-scoped `.data()` updates.
- Document reactive images, resolved bundled image sources, hidden source
  headings, RPC-created data URLs, and the new selector API in the main README
  and bundled help. Expand the single-executable guide with the shared text and
  byte fallback readers.

### Changed

- Queue reactive Kitty image preparation only when a changed template contains
  an image. Coalesce repeated requests, rebuild image metadata safely from the
  current ANSI document, and redraw the app after preparation completes.
- Reuse the new `readAssetText()` helper when generating WUI RPC and server
  modules instead of maintaining a separate embedded-first fallback function.

### Fixed

- Delete stale Kitty placements and prepare the replacement image when a
  reactive template changes its Markdown image, including switching from a
  normal path to a data URL or returning to a compiled embedded asset.
- Prevent an older asynchronous image preparation result from overwriting a
  newer reactive update by tracking image revisions through the rerender
  queue.

## [0.16.0] - 2026-08-02

This release expands jsmdcui's reactive Markdown model with synchronous
JavaScript templates, heading-scoped state updates, and a post-load lifecycle
hook. It also introduces a shared TTS API for TUI and WUI and demonstrates the
new capabilities in a practical file-and-URL reader with paging, navigation,
speech controls, and configurable text replacement.

### Added

- Add the optional async `onMdcuiLoad()` front export. It runs with the normal
  front-code scope after initial TUI layout/rendering, or after WUI
  `window.load` and installation of selectors and template component state.
- Let the built-in `tts` command accept the sentence to speak as an argument,
  including calls such as `micro.cmd.tts('Hello world')`. Calling `tts` without
  an argument retains selection-or-cursor reading behavior.
- Add the cross-interface async `$.tts(text, pitch, speed)` helper. The TUI uses
  its native speech command and updates the current process's `TTS_PITCH` and
  `TTS_SPEED`, while the WUI uses the browser Web Speech API and resolves after
  the utterance ends. WUI speech failures resolve to an error-reason string
  instead of rejecting the promise. Add `$.tts.stop()` as the shared stop API;
  its TUI implementation uses the same dedicated stop path as Escape does while
  speech is active.
- Add synchronous four-backtick `js template` components alongside
  `md template`. Their source is used directly as the render function body, so
  it can explicitly return Markdown while retaining the same heading-owned
  `data` argument, component `this`, front matter, and reactive replacement
  flow.
- Add the bilingual `demos/reader.md` reader demo. It provides reactive
  ten-item file-list pages, editable page jumps, local directory completion,
  direct file or URL selection, fixed-size document pages, keyboard paging,
  and heading-scoped help.
- Let the reader fetch a web page and build its source list from `a[href]`
  elements in document order. Link labels use anchor text while selected
  values resolve relative links to complete HTTP(S) URLs.
- Add reader navigation and speech controls for numbered previous/next
  chapters, speech speed and pitch, sequential sentence playback, automatic
  page advancement, and cancellation that also stops the background reading
  loop.
- Support optional JSON5 `replace.json` rules during reader loads. Each
  two-item rule compiles its target as a global regular expression and inserts
  its replacement literally. Local files use their own directory; URL loads
  use `process.cwd()`.

## [0.15.0] - 2026-08-01

### Added

- Add reactive Markdown components with exactly four-backtick `md template`
  fences. Each component belongs to its closest preceding heading, shares that
  heading's data object, and exposes `source`, `initialData`, `last`, `data`,
  `id`, `index`, and a `render(data = {})` function.
- Treat template source as a JavaScript template literal, allowing expressions
  such as `${data.name}`. Component render results remain Markdown and pass
  through an in-memory TUI or WUI Markdown conversion step before jsmdcui
  replaces the component region.
- Parse optional leading template front matter with `Bun.YAML`, merge it into
  the heading data before the first component render, and retain the parsed
  object as `component.initialData`.
- Rerender every component under a heading when `.data(key, value)` or
  `.data(object)` updates that heading. TUI components use invisible boundary
  markers; WUI components use scoped `.mdcui-template` wrappers.
- Add post-edit `@input` handlers for named `text` and `textarea` controls in
  both interfaces. WUI support is layered on top of the existing `onkeydown`
  and mobile `onbeforeinput` paths rather than replacing them.
- Add `demos/reactive.md`, a bilingual reactive-template example using YAML
  initial data and a 200 ms debounced text input.

### Fixed

- Make TUI `@input` handlers observe the value after character insertion and
  other successful edits instead of the preceding keydown value.
- Request a TUI redraw when an asynchronous `.data()` update replaces reactive
  component output, preventing the display from remaining one update behind
  until the next keypress.

## [0.14.0] - 2026-07-29

### Added

- Convert a leading `[ ]`, `[x]`, or `[X]` in every Markdown table cell into
  a fixed-width `☐`/green `☒` TUI control or a native WUI checkbox, while
  leaving matching text elsewhere in the cell unchanged. TUI conversion now
  happens from the Markdown source before Bun lays out narrow cells, so the
  checkbox cannot be split across rendered lines.
- Add cross-interface `$('#heading-id').cell(row, col).text()` and
  `.text(value)` for reading or replacing zero-based cells in the
  heading-associated table. TUI wrapped cell lines are joined on read; writes
  remain inside the existing rendered rectangle, preserve ANSI styles and
  OSC 8 links, and survive width rerenders. WUI writes retain the cell's
  existing elements. Cell selections expose
  `.row` and `.col`, plus bounded `.left()`, `.right()`, `.up()`, and `.down()`
  navigation that returns `null` outside the table, with `.lt()`, `.rt()`, and
  `.dn()` convenience aliases. A link event's `$(this).parent()` returns its
  containing cell in both interfaces.
- Add cross-interface `.cell(row, col).val()`. It returns the first checkbox's
  checked state as `true` or `false`, or falls back to the cell text when the
  cell has no checkbox. Passing a boolean updates the first checkbox in either
  interface.
- Make generated WUI tables directly editable while retaining embedded
  checkbox and link elements.

### Fixed

- Preserve edited TUI table cells, including their ANSI styles and OSC 8 data,
  across terminal resize, `vsplit`, and closing a split. Refit edited contents
  into the newly sized cells while leaving unchanged cells to the fresh
  Markdown layout.
- Let TUI table overwrite mode accept double-width IME input such as Chinese
  by consuming adjacent editable columns without crossing cell padding.
- Render a full-width divider between logical TUI table rows associated with
  headings (without splitting wrapped cell text), and use
  the active colorscheme's cursor-line or color-column color for the header
  and alternating body-row backgrounds.
- Edit rendered TUI table rows in fixed-width overwrite mode so Backspace,
  Delete, spaces, and printable input cannot remove cell separators or change
  the row's visual width.
- Add default table borders, cell padding, striped rows, and hover highlighting
  directly to the generated WUI HTML boilerplate.

### Changed

- Replace the special-case `--demo-imgtool` and `--demo-imgtool-zh` aliases
  with normal `demos/imgtool.md` discovery. Both commands now load compact
  table-based image processor demos and create same-named local Markdown files.

## [0.13.1] - 2026-07-29

### Fixed

- Rerender MDCUI buffers at their new pane width immediately after `vsplit`
  and after a split pane closes.
- Show a TUI message when checkbox state restoration is skipped because a
  width rerender changed the number of checkboxes.
- Restore every rendered `☐` and `☒`, including its exact ANSI style, by
  full-text order across ordinary text, tables, and fenced blocks when their
  total count remains unchanged.

## [0.13.0] - 2026-07-28

### Added

- Add cross-interface heading selection APIs for stable `.id` values,
  `.text()`, `.show()`, `.hide()`, `.toggle()`, `.data()`, and
  `.removeData()`.
- Reserve the first visible grapheme of an identified heading as its section
  toggle. It can be activated with a mouse click, `Enter`, or `Space`, while
  the heading itself remains visible.
- Give local `javascript:` links and fenced keyboard handlers matching `this`,
  `event.target`, and `event.currentTarget` values in both interfaces,
  including keyboard modifiers and cancellation state.
- Add the `--demo-event` example for link and keyboard events, nested
  selections, heading data, and heading visibility.
- Preserve heading-list mutations, checkbox states, fenced-control contents,
  and collapsed headings when a terminal-width change rerenders a TUI
  document.
- Accept Unicode letters, numbers, and combining marks in MDCUI IDs across
  fenced declarations and selectors. Markdown headings whose usual generated
  ID is empty receive a normalized Unicode ID or a stable `mdcui-h-...`
  fallback.
- Give TUI link targets source-rendered inline label HTML through `innerHTML`,
  with a visible-text fallback when source metadata is unavailable.
- Add `--outline FILE.md` to print every selectable heading ID as an indented
  `-` item and every named fenced-block ID as a top-level `+` item.
- Let TUI `#heading-id` links move the cursor to the matching Markdown heading
  and center it vertically, matching same-document WUI navigation.

### Changed

- Canonicalize a `$()` object argument with a legal MDCUI ID immediately to
  the corresponding `#id` selection. Other object fields are discarded,
  wrapping may be nested to any depth, and objects without a legal ID retain
  generic object-target behavior.
- Wrap WUI heading ranges in nested `<section>` elements so their visibility
  boundaries match the TUI.
- Keep per-ID user data stable while headings are hidden, restored, or
  replaced in the WUI DOM. `.removeData()` removes only user-owned data.
- Return semantic heading HTML without exposing the internal first-grapheme
  toggle wrapper.
- Bound heading visibility and direct task-list lookup to the heading's
  Markdown container, such as its enclosing blockquote or list item.

### Fixed

- Prevent a heading concealed by an ancestor from resolving to an unrelated
  visible heading or mutating that heading's task list.
- Make `.show()`, `.hide()`, and `.toggle()` update nested headings correctly
  while one or more ancestors remain collapsed.
- Replay task-list mutations made through nested ID selections after a TUI
  rerender.
- Prevent content, collapsed sections, or runtime list mutations from the
  previous source from reappearing after a document is reopened, while
  retaining user data.
- Let an earlier WUI click handler cancel a `javascript:` link and expose the
  correct initial `event.defaultPrevented` state to the evaluated handler.
- Resolve legal pure IDs reliably in the WUI when their characters have CSS
  selector meaning.
- Preserve quoted `>` characters in heading inline-HTML attributes when
  adding the toggle target.
- Keep standalone `<code>` elements opaque to WUI heading-section generation,
  so heading-like content inside them cannot create broken sections.
- Treat the first visible heading character as one complete grapheme cluster,
  avoiding splits in combining-character and ZWJ emoji sequences.
- Discover selectable and event-enabled fenced blocks correctly inside
  blockquotes and list items, and make `--check` report ATX, Setext, and fenced
  declarations at their actual source lines.
- Keep wrapped TUI links active on every displayed row and retain the correct
  complete label across repeated URLs, images, hidden sections, and rerenders.
- Preserve an emptied task list's insertion position and keep later heading
  rows, `.line()`, and first-character toggles aligned when text controls
  change height or the TUI rerenders.
- Resize prefixed text frames at their visible corners without pairing them
  with an adjacent or differently nested frame.
- Coalesce overlapping TUI width rerenders and preserve terminal-input order,
  including split `Alt` key sequences.
- Prevent the key used to dismiss an alert, prompt, or shell pause from being
  replayed into the editor afterward.
- Apply one shared timeout budget to remote Kitty images in a TUI render,
  abort stalled downloads, and retain the linked `📷` fallback.
- Preserve valid raw `%` expressions in WUI `javascript:` links and report
  synchronous or asynchronous handler failures to the browser console.

## [0.12.0] - 2026-07-27

This release makes Markdown images embedded by Bun's HTML bundler available to
the compiled terminal UI, adds environment-controlled Kitty rendering, and
consolidates the reusable single-executable asset helpers.

### Added

- Add `JSMDCUI_KITTY_MODE=off|compat|extended` as an environment-controlled
  alternative to the Kitty command-line flags. Explicit `--kitty` and
  `--kitty-compat` arguments continue to take precedence.
- Preserve each generated WUI image source in `data-mdcui-src`. Bun can rewrite
  the normal `src` to its content-hashed public asset path while the original
  Markdown reference remains available for TUI lookup.
- Add reusable HTML bundle helpers to `single-exe/assetsHelper.js`. They match
  compiled public image paths to `homepage.files`, canonicalize HTML entities
  and percent-encoded image references, and build a Markdown-reference-to-bunfs
  image map from `homepage.index`.
- Export the bundled `homepage` from generated Markdown server modules so a
  compiled TUI can inspect the same HTML asset manifest without starting the
  WUI server.

### Changed

- Reuse images already embedded by Bun's HTML bundler instead of copying a
  second image archive into the executable. The compiled TUI builds the image
  path map once on first Kitty use, caches it, and reads image bytes lazily from
  Bun's compiled virtual filesystem (`/$bunfs/root/...` on POSIX systems or
  `B:/~BUN/...` on Windows).
- Load the bundled homepage only when running a compiled executable with
  `global.MDCUI_MAIN` configured. Source-tree launches retain the existing
  filesystem and authorized HTTP image fallbacks without importing a generated
  server module.
- Consolidate runtime asset access on `single-exe/assetsHelper.js` and remove
  the duplicate `src/runtime/assets.js` implementation.

### Fixed

- Match compiled Markdown images independently of Bun's build-entry-relative
  `homepage.files[].input` paths. This fixes images whose Markdown-relative
  path and bundle-entry-relative path have different spellings.
- Normalize bare `process.env.JSMDCUI_KITTY_MODE=compat` build definitions into
  JavaScript string literals before forwarding them to `bun build`.
- Use the global `process` binding for Kitty-mode build constants, allowing Bun
  to replace `process.env.JSMDCUI_KITTY_MODE` at build time instead of missing
  an imported and renamed `node:process` binding.

## [0.11.2] - 2026-07-26

### Added

- Add `--build-md-exe <file.md>` as a convenience alias for building a
  current-platform executable with `global.MDCUI_MAIN` set to the specified
  Markdown app.
- Add `--build-md-for <platform> <file.md>` for the equivalent
  cross-compilation workflow. Both aliases expand into the existing build
  arguments before generated application files are written.

### Fixed

- Fix the final executable existence check for Windows builds by checking the
  `.exe` output path for Windows targets, or for native Windows builds when no
  target is specified.

## [0.11.1] - 2026-07-26

### Changed

- Accept a bare `global.MDCUI_MAIN` path in forwarded build arguments by
  automatically encoding non-primitive define values as JavaScript strings.

## [0.11.0] - 2026-07-26

This release adds custom Markdown-app embedding for Bun single-file
executables, with explicit per-buffer selection between embedded and
filesystem modules in both TUI and WUI.

### Added

- Add the build-time `global.MDCUI_MAIN` string define for embedding a custom
  Markdown app together with its generated front, RPC, back, HTML, and server
  modules. Build preparation resolves and validates the source, copies it into
  the bundled demos, derives `global.MDCUI_MAIN_BASE`, and selects the app on a
  no-argument launch.
- Add a bundling mode to `extractJs()` and `createWui()`. It emits a
  browser-only `.tmpfs.js` front module and a `.tmpfi.js` installer that exposes
  the front exports on `window`, then makes the bundled HTML load that entry.
- Add embedded WUI server startup and report whether WUI is starting an
  embedded or external server before launch.
- Add `micro.CurPane().Buf.MdcuiModuleSource`, returning `embedded` or
  `external`, and show the value in the bundled `showpath` example.
- Allow Unicode letters and numbers, including Chinese, in custom demo names
  while continuing to reject whitespace and path separators.
- Show `global.MDCUI_MAIN` and the generated `global.MDCUI_MAIN_BASE` in
  `--version` distribution settings.

### Changed

- Track embedded-module selection per buffer. The configured demo uses
  embedded TUI front/RPC and WUI server modules when its local byte length
  matches the bundled Markdown. Missing or overwritten copies are written
  first and then use embedded modules; other files and changed-size demos use
  filesystem companions.
- Document presence-based `MDCUI_*` defines with `=1`, supported build-flag
  combinations, and commands for switching a TUI-default build to WUI or a
  WUI-default build to TUI.

### Fixed

- Bundle and load the configured app's front, RPC, back, server, and dependency
  graph so custom apps with companion imports can run from a single
  executable.
- Keep unrelated Markdown buffers on external modules instead of reusing the
  embedded main app's front and RPC modules.
- Use the bundled file's byte length after `MDCUI_OVERWRITE_DEMO` replaces a
  stale local demo, ensuring that the overwritten app selects embedded
  modules.
- Install WUI front exports on `window` without relying on the generated front
  module's process-dependent or self-import path.

## [0.10.1] - 2026-07-25

### Fixed

- Resolve and prepare `--demo` and `--demo-*` selections before entering WUI
  mode, so combinations such as `--wui --demo-todo` serve the selected demo
  instead of falling back to `testapp.md`.

## [0.10.0] - 2026-07-24

This update adds distribution-oriented defaults for shipping jsmdcui as a text
editor, terminal application, or browser application; makes WUI startup and
demo replacement explicit; and improves command-line control over rendering,
syntax highlighting, and single-executable builds.

### Added

- Add `--mdcui` and `--tui` as aliases for `-encoding mdcui`, allowing an
  explicit terminal Markdown UI request to override an editor-oriented
  distribution default.
- Add `--overwrite-demo` as a modifier for `--demo` and the automatically
  discovered `--demo-*` commands. It replaces an existing local demo with the
  bundled copy before opening it.
- Add `--print-ui` for WUI launches. The generated TUI preview, raw ANSI, and
  HTML are printed only when this flag is present.
- Add the `src/MDCUI_DEFAULT_EDIT` distribution marker. When present, Markdown
  files open as editable UTF-8 text by default while `--mdcui` remains
  available explicitly.
- Add presence-based single-executable build constants:
  `MDCUI_DEFAULT_EDIT`, `MDCUI_DEFAULT_DEMO`, and
  `MDCUI_DEFAULT_DEMO_WUI` select an editor, no-argument TUI demo, or
  no-argument WUI demo default. `MDCUI_OVERWRITE_DEMO` optionally makes a
  bundled demo replace its local copy.
- Add distribution documentation for shipping a customized root
  `testapp.md` as a standalone terminal or browser application.
- Add regression coverage for the `--mdcui` alias, forced CLI filetypes,
  non-overwriting and overwriting demos, and WUI demo replacement.

### Changed

- Parse `--wui` through the normal command-line argument flow, so it can appear
  before or after the Markdown filename.
- Make WUI startup quieter by default. It continues to report file generation
  and the server URL, while full generated UI output is opt-in through
  `--print-ui`.
- Make direct `runmd.mjs` launches recognize `--overwrite-demo` and
  `--print-ui`. Demo replacement is limited to the implicit `testapp.md`;
  explicitly named Markdown files are protected from replacement.
- Forward every extra argument after `--build-exe`, or after the target passed
  to `--build-for`, to the underlying `bun build` command.
- Align the `start`, `tui`, and `wui` package scripts with the repository
  launchers, and add a `clean` package script.
- Recommend choosing only one of the three `MDCUI_DEFAULT_*` distribution
  modes per build, with `MDCUI_OVERWRITE_DEMO` treated as an optional modifier.
- Show effective `MDCUI_*` distribution settings in `--version` output,
  including `MDCUI_DEFAULT_EDIT` enabled through either its build constant or
  the `src/MDCUI_DEFAULT_EDIT` marker.

### Fixed

- Make `-filetype <name>` actually override automatic syntax detection in
  editor buffers and `--cat`, including input read from stdin.

## [0.9.0] - 2026-07-21

This update expands Chrome DevTools Protocol automation for the terminal UI,
adds a complete maze-solving example, and makes the optional Bun single-file
executable bootstrap easier to reuse and more reliable across platforms.

### Added

- Add CDP automation support for reading the rendered ANSI document, activating
  a 1-based terminal-buffer cell, and sending keyboard input through the TUI's
  normal input parser and event pipeline. Key presses support Alt, Ctrl, Meta,
  Shift, navigation keys, editing keys, text, and auto-repeat without emitting
  duplicate input for paired CDP `keyDown` and `char` events.
- Add `micro.getAllAnsiText()` and `micro.clickBufferCell(x, y)` to the JS
  plugin bridge. MDCUI cell clicks now activate the same callbacks as mouse
  input, while clicks in ordinary buffers retain the previous `goto` behavior.
- Add `cdp-maze.js` and `llm-maze.txt`, a documented Bun.WebView example that
  reads the maze from the running TUI, solves it with breadth-first search, and
  completes it by clicking controls and sending arrow-key events through CDP.
- Add `--cdp-maze` to open the bundled maze, start a local CDP server on port
  9222, and automatically import and run the maze solver after a three-second
  delay. The completed result is returned to the main program and displayed in
  the TUI status message.
- Add `--export-cdp-maze` to write or overwrite `./cdp-maze.js` from the
  bundled asset first, with a source-tree fallback, then exit. Include the
  solver in the single-executable asset archive.
- Add a dedicated CDP automation section to the README and bundled help,
  covering command-line and command-prompt startup, bind-address safety,
  connection methods, and the maze solver workflow.
- Add a reusable single-file executable guide covering asset packing, embedded
  and external resource fallbacks, build commands, cross-compilation, Node.js
  compatibility, and adapting the bootstrap to another project.

### Changed

- Move responsibility for awaiting bundled assets into the Bun-only
  `single-exe/entry.mjs` bootstrap, then dynamically import the regular main
  module. This keeps the main module free of Bun-specific asset-loader state
  and preserves its uncompiled Node.js execution path.
- Detect Bun's compiled virtual paths on both POSIX (`/$bunfs/`) and Windows
  (`B:/~BUN`) when resolving single-executable resources, and consolidate
  compiled-runtime handling in `single-exe/compiled.js`.
- When initially launched with Node.js, restart under Bun with inherited stdio
  and propagate its exit status instead of replacing the current process with
  `process.execve()`.
- Display the maze completion message inside the game instead of opening a
  blocking alert, and include reset instructions in the result.
- Export the maze solver as a reusable `runCdpMaze()` function while retaining
  direct `bun cdp-maze.js` execution. Suppress its console result while stdin
  is in terminal raw mode so TUI rendering is not corrupted.
- Replace the manual two-process maze automation instructions with the single
  `--cdp-maze` workflow in the README and bundled help.
- Update the homepage and Kitty test images to use the smaller current demo and
  maze screenshots; exclude the maze screenshot from the npm package.
- Document theme preview from the TUI command prompt and state Bun 1.3.12 as
  the minimum required version.

### Fixed

- Make CDP `view.click()` activate MDCUI links and controls at the requested
  buffer coordinate instead of only moving the cursor there.
- Allow CDP input dispatch without an explicit session ID by selecting the
  implicit target, matching other single-target CDP operations.
- Wait until the embedded asset archive is ready before starting the compiled
  application, preventing startup from racing bundled resource loading.

## [0.8.0] - 2026-07-20

This update adds portable inline keydown handling to Markdown text controls,
including mobile software-keyboard fallback behavior, and makes interactive
prompts safe across every TUI frontend action path.

### Added

- Add quoted `@keydown="..."` attributes to named `text` and `textarea`
  fences. The TUI preserves source event metadata and evaluates it before key
  handling; the WUI emits a native inline event attribute. Add `.prevent` to
  apply `event.preventDefault()` before the handler runs. Keyup is intentionally
  not exposed because traditional terminals do not report key releases
  reliably.
- In the WUI, automatically map `beforeinput.data` back through `onkeydown`
  when a mobile software keyboard reports `event.key` as `Unidentified`.
  Unidentified events are hidden from application handlers, while identified
  desktop keydowns are marked briefly to prevent duplicate calls.
- Add native multiline editing to TUI `textarea` controls. Enter splits a body
  row and expands the frame; Backspace at the start of a later row and Delete
  at the end of a row join adjacent body rows without exposing frame borders.
- Add the `bun ./edit` launcher as a short equivalent of
  `bun src/index.js --edit`, opening Markdown as ordinary editable UTF-8 source.
- Add the automatically discovered `--demo-maze` example, demonstrating
  portable `@keydown.prevent` controls with keyboard and arrow-key navigation;
  add `Ctrl-R` as a keyboard shortcut for resetting the maze.

### Changed

- Install protected `alert`, `confirm`, and `prompt` globals once for the TUI
  lifetime and share them across OSC 8 actions, fenced keyboard handlers, and
  JS plugins. Restore Bun's original globals when the TUI stops.
- Make `micro.alert()`, `micro.confirm()`, and `micro.prompt()` synchronous like
  their native counterparts, and update the bundled JS plugin examples so they
  do not `await` these calls.
- Add TUI `.val(value)` replacements to Undo/Redo history, including multiline
  layout, ANSI rendering metadata, image positions, and task-list anchors.

### Fixed

- Prevent `alert()` called from a keydown handler from competing with the TUI
  for stdin by suspending raw mode and screen rendering around native prompts.
- Restore the terminal's previous raw-mode and input-listener state after a
  protected prompt, including setup, prompt, and cleanup error paths.
- Index fenced keyboard-event regions once and use binary lookup for each key,
  instead of rescanning the rendered Markdown document on every keypress.
- Open Windows controlling-terminal input through read-only `CONIN$` when stdin
  is redirected, so piped Markdown retains keyboard and protected-prompt input.
- Preserve `ctrlKey`, `shiftKey`, `altKey`, and `metaKey` when the WUI maps an
  unidentified mobile keydown through its `beforeinput` fallback.
- Recover modified A-Z keys in the WUI from key codes 65-90 or physical
  `KeyA`-`KeyZ` codes, including Android browsers that transform Alt-S into
  `ß`; exclude AltGraph so international text composition remains intact.
- Add matching non-enumerable `event.toJSON()` methods to TUI and WUI keydown
  events, allowing `JSON.stringify(event)` to produce portable event details.
- Keep fenced-block IDs visible to collision checking when the info string also
  contains inline event attributes such as `@keydown="..."`.
- When the WUI's default port 3000 is already in use, retry with port 0 so the
  operating system selects an available port, and print that actual port in the
  generated URL. Other server startup errors continue to fail normally.

## [0.7.0] - 2026-07-20

This update adds native Kitty image rendering, turns heading task lists into
Array-style collections in both interfaces, and keeps TUI layout, interaction,
and checkbox styling consistent at every terminal width.

### Added

- Display local Markdown images at their rendered TUI positions with the
  Kitty graphics protocol. Image rows are reserved according to intrinsic
  dimensions, and placements follow scrolling, resizing, and split panes.
- With `--allow-url` and Kitty mode enabled, download HTTP(S) Markdown images
  through the existing `curl`, `wget`, then Bun `fetch` fallback chain. Relative
  image URLs in downloaded Markdown resolve against the original document URL.
- Keep Bun's normal linked `📷` fallback for missing, unsupported, and
  unauthorized remote images, and scope Kitty cleanup to image IDs owned by
  jsmdcui.
- Set Kitty's `C=1` placement flag so displaying an image cannot advance the
  terminal cursor and trigger an unwanted scroll at the bottom of the screen.
- Add `.push()`, `.pop()`, `.shift()`, `.unshift()`, and `.splice()` to heading
  selectors in both the TUI and WUI. The methods follow their
  `Array.prototype` argument and return-value conventions, operate on direct
  items in the first task list belonging to the heading, and remove nested
  content together with its parent item.
- Allow inserted task items to be passed as strings for unchecked items or as
  `{ value, checked }` objects, and preserve an emptied TUI list's insertion
  point so later mutations still target the same list.
- Add read-only heading `.slice(start, end)`, returning fresh
  `{ value, checked }` snapshots that include both checked and unchecked direct
  task items.
- Add `demos/todo.md` and `demos/todo-zh.md`, runnable Todo examples that use
  text controls and the new list methods to add and remove items and display
  completed or pending tasks.
- Move secondary examples under `demos/` and add automatic
  `--demo-<filename>` discovery, so newly bundled `demos/<filename>.md` files
  need no parser changes. Keep `--demo` mapped to the root `testapp.md` and
  retain the existing image-processor aliases.
- Add `--demo-list` to list the root demo and every automatically discovered
  Markdown example from bundled assets or the source tree's `demos/` directory.
- Add `clean.sh` as a convenience helper for removing generated Markdown
  companion files from the project directory.

### Changed

- Document the Array-style heading task-list API, its return values, nested-item
  behavior, existing-list requirement, and non-persistent rendered-state
  semantics in the README and bundled help.
- Use the complete pane content width consistently for Markdown rendering,
  soft wrapping, cursor and mouse mapping, and Kitty image sizing instead of
  reserving the terminal's final column.

### Fixed

- Fix soft wrapping at affected terminal widths shifting the visual cursor by
  one row, which could activate the preceding Markdown action and leave the
  final action unresponsive.
- Update the Bun Markdown ANSI glyph and style together when toggling a task
  checkbox, so checked items become green and unchecked items no longer retain
  the checked color.

## [0.6.3] - 2026-07-18

This update enforces unique heading IDs at the Markdown source level and
clarifies the portable fenced-block identity contract shared by the TUI and
WUI.

### Changed

- Treat duplicate Markdown headings that generate the same base ID as a
  source-level collision. Later headings no longer pass `--check` merely
  because Bun would silently assign generated suffixes such as `-1` or `-2`
  that the Markdown author cannot see.
- Document that a selectable fenced-block declaration requires a tag and uses
  the `tag#id.class` identity form. The officially supported portable control
  tags are currently limited to `text` and `textarea` so the same Markdown
  behaves consistently in both the TUI and WUI.
- Clarify that selector queries may omit the tag or classes after a valid
  declaration.
- Expand checker and TUI selector regression coverage across tag/no-tag and
  class/no-class combinations, heading-to-heading, heading-to-block, and
  block-to-block ID collisions.

### Fixed

- Fix duplicate source headings incorrectly passing the checker after Bun
  automatically changed the generated ID of later headings.

## [0.6.2] - 2026-07-18

This update makes Markdown ID-collision checks match the full TUI `$()` block
selector and gives check results clearer final status banners.

### Changed

- Extend `--check FILE.md` from `text` and `textarea` controls to every
  explicitly named fenced block accepted by the TUI `$()` selector, including
  identities such as `hello#myid` and `json#config`.
- Report separate heading and fenced-block declaration counts, and describe
  arbitrary block tags and their source lines in collision details.
- Replace the previous success label with a large green `PASSED` banner and
  add a matching large red `FAILED` banner at the bottom of failed reports.
  Both true-color foregrounds are generated with
  `Bun.color(..., "ansi-16m")`, with standard ANSI fallbacks.
- Update the README and bundled help to clarify that generated heading IDs
  share the selector namespace with all explicitly named fenced blocks, not
  only editable text controls.

### Fixed

- Fix `--check` overlooking collisions between a heading and a non-text
  fenced block even though TUI `$().val()` could select both declarations.
- Add regression coverage for arbitrary fenced-block IDs and the colored
  `PASSED` and `FAILED` terminal statuses.

## [0.6.1] - 2026-07-18

This update adds Markdown UI ID-collision diagnostics and bundles a practical
Bun.Image processor demo in English and Traditional Chinese.

### Added

- Add `--check FILE.md` to inspect Markdown heading and text-control IDs
  without opening a UI or writing generated companion files. The report uses
  `Bun.markdown.ansi()` headings and nested lists, identifies every collision
  by ID, source type, line number, and original declaration, and exits with
  status `0` for unique IDs, `1` for collisions, or `2` for usage and read
  errors.
- Add `image-processor.md` and `image-processor.zh-TW.md`, runnable Bun.Image
  tools for the TUI and WUI. They support image metadata inspection, resizing,
  fit and resampling filters, enlargement prevention, EXIF auto-orientation,
  rotation, vertical and horizontal mirroring, brightness and saturation
  adjustment, and JPEG or PNG output options.
- Add detailed image-processing status fields. Successful writes show the
  output path, dimensions, byte count, and all selected option values; failed
  metadata reads and writes show the available error details and stack.
- Add `--demo-imgtool` and `--demo-imgtool-zh`. Each command preserves an
  existing local processor Markdown file or writes its bundled language
  version when missing, then opens it in the TUI.
- Bundle both image processor Markdown files in the single-executable asset
  archive and add regression coverage for ID checks and both demo languages.

### Changed

- Consolidate bundled demo Markdown loading behind one
  `bundledMarkdownSource(filename)` implementation shared by `testapp.md`,
  `select.md`, and both image processor variants.
- Document that heading selector values include the complete visible label.
  Selection parsers should use deliberate substring, prefix, or token checks
  when labels contain explanatory text instead of assuming exact identifiers.
- Document that generated heading IDs and explicitly named controls share the
  same selector namespace and that every selectable ID should be unique.

### Fixed

- Prevent explanatory text in image processor task-list labels from breaking
  yes/no, fit, filter, and output-format selection parsing.
- Fix the English image processor status update silently targeting a heading
  after `## Write Status` generated the same `#write-status` ID as its text
  control.
- Catch image metadata and processing failures at both frontend and backend
  boundaries so errors are displayed in the appropriate status field.

## [0.6.0] - 2026-07-18

This update turns Markdown headings and task lists into cross-environment form
controls, improves the safety and consistency of the bundled demo workflow,
and adds a way to export the bundled README as a runnable Markdown app.

### Added

- Add `--export-readme` to write or overwrite `./README.md` with the bundled
  README source and exit.
- Add terminal task-checkbox activation. Activating a protected mdcui row at
  or after its `☐` or `☒` toggles that checkbox and still allows the remaining
  default cell callback to run. JavaScript links continue to take priority.
- Add hierarchical `<section>` wrappers to generated WUI HTML. Every h1-h6
  opens a section; an equal or higher-level heading closes the applicable open
  sections, while lower-level headings create nested sections. Content before
  the first heading remains outside the generated sections.
- Add heading lookup to the TUI `$` API using the IDs generated by
  `Bun.markdown.html(..., { headings: { ids: true } })`.
- Add `$('#heading-id').html()` in TUI to return a heading's inner HTML, and
  `$('#heading-id').line()` to return its current 1-based terminal row or `0`
  when it cannot be found. Line lookup follows text-block row additions,
  removals, and multiline `.val(value)` replacements.
- Add `.html()` getters to WUI `$` selections. Any successfully selected DOM
  element returns its `innerHTML`; missing or invalid selections return an
  empty string.
- Add heading-based task-list values in both interfaces. `.val()` reads the
  first task-list group directly following the selected heading, stops at the
  next heading, and ignores nested task items. IDs beginning with `select`
  return the first checked value or `null`; other IDs return all checked values
  as an array or `[]`.
- Add `select.md`, a runnable multilevel heading and task-list example with
  links that display single-select and multiple-select values through
  `alert()`.
- Bundle `select.md` in packaged assets and add `--demo-select`. The command
  preserves an existing `./select.md`, writes the bundled copy when missing,
  opens it in the TUI, and generates its five companion files.

### Changed

- Make `--demo` preserve an existing `./testapp.md`. The bundled source is now
  written only when the file is missing, then opened in the terminal UI.
- Make `--wui` without a file follow the same source-file rule: use an existing
  `./testapp.md`, or write the bundled demo there when missing, before creating
  the generated companion files.
- Wrap generated WUI task-checkbox text in `<label>` so clicking the associated
  text toggles the checkbox. Direct text and immediately following paragraph
  elements are included; unrelated tags and nested lists remain outside.
- Extend the 0.5 `$().val()` contract: text and textarea controls retain their
  string getter/setter behavior, while heading selections now return scalar,
  array, or `null` task-list values according to the heading ID.
- Add a demo screenshot and expand the README and built-in help with clearer
  TUI/WUI startup, demo preservation, and README export instructions.

### Fixed

- Ensure WUI fallback to the bundled `testapp.md` materializes the Markdown
  source in the current working directory instead of generating only its
  companion files.
- Protect comments and `script`, `style`, `pre`, `code`, `textarea`, and
  `template` regions while wrapping WUI headings, preventing heading-like HTML
  strings inside those regions from changing the section hierarchy.
- Keep TUI heading lookup independent of ANSI heading text and duplicate
  labels by mapping Bun-generated heading order and level to Bun's current
  h1-h6 ANSI signatures.

## [0.5.0] - 2026-07-16

This update adds cross-environment form-like text blocks and a small
jQuery-style selector API, while keeping the same Markdown source usable in
both the terminal and browser interfaces.

### Added

- Add a minimal global `$` API to terminal frontend evaluation, JavaScript
  plugins, generated browser frontend modules, and `javascript:` links.
- Support tag, ID, class, and combined selectors such as `$('text')`,
  `$('#answer')`, `$('.field')`, and `$('text#answer.field')`.
- Add `.val()` and `.val(value)` for reading and replacing block contents.
  Getters always return a string and use an empty string for missing elements,
  invalid selectors, or lookup errors. Setters support chaining and resize
  terminal blocks to fit multiline values.
- Recognize both raw Markdown fenced blocks and rendered Bun ANSI blocks,
  including ASCII and Unicode frame characters.
- Add editable terminal `text` blocks. Content after the protected `│ ` or
  `| ` prefix can be edited, while frame characters, line joins, inserted
  newlines, and multiline pastes remain protected.
- Add interactive terminal text-block resizing. Activating the lower-left
  frame corner adds an empty content row; activating the upper-left corner
  removes only a trailing empty row and never deletes non-empty content.
- Add the optional frontend lifecycle callback
  `onMdcuiExit({ reason, path, $ })`. The terminal awaits it before closing an
  mdcui buffer and invokes it at most once per buffer.
- Add Markdown syntax completions for fenced block language identifiers.

### Changed

- Convert `text` and `textarea` fenced blocks into native browser
  `<textarea>` elements while preserving their ID, classes, original language
  metadata, and selector compatibility.
- Prefer native `document.querySelector()` in the browser `$` implementation,
  then fall back to mdcui metadata and the original `pre > code` structure.
- Automatically wrap and resize generated browser textareas on page load,
  input, `.val(value)`, and window resize. Initial `rows` and `cols` are
  derived from the Markdown content.
- Generate complete HTML5 documents for WUI output, including `<!doctype
  html>`, UTF-8 metadata, a responsive viewport, a document title, and
  `lang="zh-TW"`.
- Enable `softwrap` by default.
- Close modified mdcui buffers without displaying a save prompt. Applications
  can use `onMdcuiExit` to collect edited field values or call backend RPC
  functions before closing.
- Update the bundled example with editable text fields, selector API examples,
  answer validation, and manual text-box resizing instructions.

### Fixed

- Keep terminal text-block frame prefixes intact during editing and prevent
  Delete at the end of a content row from merging it with the next row.
- Preserve browser textarea IDs and classes during Markdown-to-HTML
  conversion, including compatibility metadata for original `text` selectors.
- Keep README and built-in help lifecycle documentation synchronized.

## [0.4.0] - 2026-07-16

This release separates executable Markdown UI views from ordinary editable
buffers, makes encoding behavior predictable across opens, tabs, splits, and
reopens, and adds explicit demo and trusted-remote execution modes.

### Added

- Add `--demo`. It outputs and overwrites `./testapp.md`, opens it as a terminal
  Markdown UI, and writes the five generated companion files beside it.
- Add `--allow-url` for trusted remote Markdown apps. It downloads an HTTP(S)
  resource into the current directory, opens the downloaded copy through the
  normal local Markdown UI pipeline, writes the five generated companion files,
  and permits its embedded frontend and backend code to run.
- Add regression coverage for global encoding handling, mdcui backup isolation,
  the bundled demo workflow, implicit Markdown rendering, and explicit UTF-8
  editing.

### Changed

- Treat `mdcui` buffers as independent, derived, read-only views. Every mdcui
  open creates a new buffer instead of entering the same-path editable-buffer
  cache.
- Continue sharing ordinary buffers opened from the same absolute path.
  UTF-8 and other non-mdcui views share content, modification state, saves, and
  reopens.
- Re-evaluate buffer sharing after `reopen`:
  - reopening an mdcui view as a normal encoding joins an existing same-path
    editable buffer, or registers itself when no such buffer exists;
  - reopening a shared editable view as mdcui detaches only the current pane
    into a new mdcui buffer and leaves the other shared panes unchanged.
- Make interactive `open`, `tab`, `vsplit`, and `hsplit` operations perform
  fresh `.md` automatic detection for files that are not already represented
  by a normal cached buffer.
- Ignore a top-level global `encoding` value read from `settings.json`.
  Encoding is selected per invocation or buffer; command-line encoding options
  remain effective for the current run and are not persisted.
- Organize `--testapp.md` and `--demo` under a dedicated `Demo` section in
  `--help`, and document commands that overwrite source or generated files.

### Fixed

- Fix `.md` files opened from inside the editor failing to enter mdcui mode.
- Fix encoding changes leaking between independent mdcui tabs.
- Fix `reopen mdcui` mutating every pane that shared the original editable
  buffer.
- Fix mdcui-to-UTF-8 reopens remaining outside the normal same-path buffer
  cache.
- Delay applying an explicit reopen encoding until the reopen is confirmed, so
  canceling the save prompt does not alter the shared buffer.

### Security

- Exclude mdcui buffers completely from crash-recovery backups: they do not
  create, apply, prompt for, or remove backups. This prevents a derived
  read-only view from consuming or deleting a backup belonging to an editable
  view of the same Markdown source.
- Remote HTTP(S) Markdown remains non-executable and does not write companion
  files by default.
- `--allow-url` is an explicit trust boundary. It writes downloaded content and
  generated JavaScript/HTML files into the current directory, may overwrite
  files with the same names, and runs code from the remote document with the
  permissions of the jsmdcui process. Use it only with trusted URLs and in a
  directory where those writes are safe.

## [0.3.1] - 2026-07-16

### Added

- Add `--edit` to open Markdown files as editable UTF-8 source instead of
  automatically entering mdcui mode.
- Add `--cat` regression coverage for implicit mdcui rendering and explicit
  UTF-8 overrides.

### Fixed

- Prevent an explicit encoding choice from being replaced by automatic mdcui
  detection.
- Correct terminal raw-mode handling around log and prompt output.

## [0.3.0] - 2026-07-16

Initial usable release, based on the bunmicro terminal editor.

### Added

- Open local Markdown files as interactive, read-only terminal interfaces while
  retaining navigation, selection, search, copy, mouse support, and automatic
  reflow when the terminal is resized.
- Open HTTP(S) Markdown files in the terminal without generating local
  companion files or executing their `javascript:` links.
- Start a browser interface with `--wui [FILE.md]`. Browser pages support normal
  links, clickable `javascript:` actions, heading anchors, and task checkboxes
  that can be toggled for the current page session.
- Build interactive Markdown apps with `js front`, `js back`, and
  `javascript:` links. Frontend actions can use `alert`, `confirm`, `prompt`,
  and call published backend functions through `rpc`.
- Activate local terminal actions with `Enter`, `Space`, or a left click, with
  visible reporting for synchronous and asynchronous frontend errors.
- Generate five companion files beside each local Markdown source:
  `.front.js`, `.back.js`, `.html`, `-rpc.js`, and `-server.js`.
- Print terminal output with `--cat`, print the bundled example source with
  `--testapp.md`, and choose a WUI port with the `PORT` environment variable.
- Provide the `jsmdcui`, `tui`, and `wui` launchers, Bun scripts for common
  development tasks, bundled runtime assets, and experimental single-executable
  build commands.
- Retain the normal bunmicro-based editor for non-Markdown buffers, including
  file editing, syntax highlighting, search and replace, undo and redo, tabs,
  split panes, clipboard support, themes, and shell commands.
- Show this README as the built-in `Ctrl-G` help page.

### Changed

- Local `.md` files now enter read-only Markdown UI mode automatically. Starting
  jsmdcui without a file still opens the normal terminal editor.
- Opening or rendering a local Markdown file regenerates its five companion
  files in terminal, `--cat`, and `--wui` modes.
- Running `--wui` without a file uses `testapp.md` in the current directory when
  present, otherwise the bundled demo, and writes generated files in the current
  directory.
- Every WUI start prints a fresh UUID-based page URL. Requests without the
  trailing slash redirect to the canonical page URL.
- `js front` and `js back` blocks are removed from the displayed Markdown and
  written to their generated modules.

### Fixed

- Preserved Markdown ANSI colors in the terminal UI and prevented the rendered
  document background from obscuring the editor theme.
- Correctly detected links at the active terminal cell and loaded the matching
  generated frontend module.
- Restored terminal display state after `alert`, `confirm`, and `prompt`.
- Reported frontend errors instead of letting them crash or silently fail.
- Corrected generated module paths and imports, supported bundled runtime
  templates, and removed redundant file generation.
- Made JavaScript plugin commands available through command lookup and
  completion, and added `js`, `py`, and `sh` choices for `eval` completion.

### Security

- Browser RPC discovery and calls expose only exported backend functions whose
  exported names do not begin with `_`. This restriction applies to WUI RPC;
  the local TUI imports the backend module directly.
- WUI pages use a fresh UUID path on each start. This reduces accidental
  discovery but is not authentication or authorization.
- The WUI has no login or HTTPS, may be reachable through the machine's network
  interfaces, and permits cross-origin RPC responses. Anyone who can reach it
  and obtains the complete URL can call every backend function published by the
  Markdown app.
- Frontend code runs in the browser, while terminal frontend code and backend
  code can run with the permissions of the jsmdcui process. Only open or serve
  Markdown apps from trusted sources.
