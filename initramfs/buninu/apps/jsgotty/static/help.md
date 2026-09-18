# Static Frontend Notes

## Script Load Order

- `kitty.js` and `windows_bridge.js` install page-local helpers that inspect the terminal runtime.
- `xterm-addon-unicode11.js` must load before `gotty.js` so the terminal constructor can register Unicode 11 width tables when the addon is available.

## Internal Page Hooks

`gotty.js` exposes internal handles on `window` for this page's helper scripts.

## `window.__gottyTerminal`

High-level terminal wrapper used by the page.

Useful methods:

- `info()` -> `{ columns, rows }`
- `output(bytes)` -> feed remote output into the terminal/ZMODEM pipeline
- `getMessage()` -> overlay DOM node
- `showMessage(text, timeout)`
- `showReconnectMessage()`
- `removeMessage()`
- `setWindowTitle(title)`
- `setPreferences({ "font-size", "font-family", "EnableWebGL" })`
- `sendInput(data)`
- `onInput(callback)`
- `onResize(callback)`
- `deactivate()`
- `reset()`
- `close()`
- `disableStdin()`
- `enableStdin()`
- `focus()`

## `window.__gottyWebTTY`

Protocol/controller layer that owns the websocket session.

Useful methods:

- `open()` -> opens the session and returns a cleanup function
- `initializeConnection(arguments, authToken)`
- `sendInput(data)`
- `sendPing()`
- `sendResizeTerminal(columns, rows)`
- `sendSetEncoding(encoding)`

Properties commonly read by helpers:

- `reconnectToken`
- `reconnect`
- `bufSize`
- `disconnected`

## `window.__gottyConnection`

Lowest-level websocket wrapper for the active connection.

Useful methods:

- `send(data)`
- `close()`
- `isOpen()`
- `onOpen(callback)`
- `onReceive(callback)`
- `onClose(callback)`

## `window.__gottyXterm`

The raw xterm.js `Terminal` instance.

Useful methods/properties:

- `write(data)`
- `clear()`
- `reset()`
- `resize(columns, rows)`
- `focus()`
- `blur()`
- `loadAddon(addon)`
- `dispose()`
- `onData(callback)`
- `onResize(callback)`
- `options`
- `unicode.activeVersion`

## Other Globals

- `window.getTerminalText`: helper exposed by `GoTTYXterm` for debugging/copying the full visible buffer as plain text.
- `window.Zmodem`: ZMODEM helper namespace exposed by `zmodem.js`. Useful methods are used by the file-transfer addon, especially `Browser.send_files(...)` and `Browser.save_to_disk(...)`.
- `window.gotty_kitty_trace`: boolean trace flag consumed by `kitty.js`. It is enabled by starting jsgotty with `JSGOTTY_KITTY_DEBUG=1`.
- `window.touchScrollThreshold`: mobile touch-scroll threshold in pixels used by `kitty.js` to convert finger movement into synthetic wheel ticks. Default: 24 px. Lower means faster scrolling.
- `alert_advanced(text, asHtml, closeOnClick)`: page-local modal helper used by custom UI scripts.
- `noWinOpenUseFetch()`: intentional monkey patch for link handling.

## `noWinOpenUseFetch()`

When enabled, the page stores:

- `realConfirm` -> original `confirm()`
- `realWinOpen` -> original `window.open()`
- `fetchText(url)` -> `fetch(url).text()` helper

It then replaces `window.open()` with a fetch-and-alert flow for terminal links.

## Server-Injected Globals

These exist before `gotty.js` runs:

- `gotty_auth_token`
- `gotty_ws_query_args`
- `gotty_themes`
- `gotty_enable_webgl`

## Frontend-Only Query Args

- `font-family`: overrides the terminal font family before xterm is created. If omitted, GoTTY uses the built-in monospace stack from `gotty.js`. Default: `DejaVu Sans Mono, Everson Mono, FreeMono, Menlo, Terminal, monospace, Apple Symbols`.
- `font-size`: overrides the terminal font size in pixels. Only positive numbers are accepted. If omitted, GoTTY uses the built-in default size. Default: `15`.
- `webgl`: overrides whether the terminal should enable the xterm WebGL addon. Accepted values: `on`, `true`, `1`, `off`, `false`, `0`. If omitted, GoTTY uses the server-side `gotty_enable_webgl` value, which is `false` unless the server starts with `--webgl`. Default: server value.
- `touch-scroll-threshold`: overrides the touch gesture distance, in pixels, that kitty.js uses before converting finger movement into scroll ticks. Only positive numbers are accepted. If omitted, kitty.js uses its built-in default. Default: `24`.

These are consumed by `gotty.js` for terminal setup and are stripped from the args forwarded to the backend session.

These hooks are internal, not a stable public API.
