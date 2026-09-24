# fbdev — draw directly on the Linux framebuffer

`/lib/fbdev.js` is both an importable drawing module and a small executable
demo. It uses `/dev/fb0`, framebuffer ioctls, a shared `mmap`, and `KDSETMODE`
through Bun FFI; it does not require X11, Wayland, SDL, or a window manager.

## Demo

Run it on Buninu's physical Linux console:

```sh
bun /lib/fbdev.js
```

The demo switches the active console to graphics mode, clears the framebuffer,
draws a cyan triangle, and waits. Press any key to restore text mode and exit.
Ordinary failures, direct process exit, `SIGHUP`, `SIGINT`, `SIGQUIT`, and
`SIGTERM` also restore the prior keyboard raw state and attempt to return the
console to text mode.

Each repeatable `-p`/`--points` supplies one polygon as x,y coordinate pairs:

```sh
bun /lib/fbdev.js -p '100,50 40,250 300,250'
bun /lib/fbdev.js \
  -p '100,50 40,250 300,250' \
  -p '400,80 350,220 450,220'
```

Every occurrence draws a separate filled polygon. Comma and whitespace
separators may be mixed inside its quoted value; the clearest form uses a
comma within each `x,y` point and spaces between points. If one polygon
contains an odd number of numeric values, its final unpaired value is ignored.
A `-p` containing only one number is therefore ignored as a whole. Each
non-empty polygon needs at least three complete points; more than three points
remain one polygon rather than starting another. If no drawable `-p` remains,
the demo draws its default triangle.

## JavaScript API

```js
import {
  openFramebuffer,
  clear,
  drawPoint,
  drawLine,
  drawLines,
  fillPolygon,
  flush,
} from "/lib/fbdev.js";

const display = openFramebuffer();
try {
  clear(display);
  fillPolygon(display, [[100, 50], [40, 250], [300, 250]], {
    r: 64, g: 200, b: 255, a: 255,
  });
  drawLine(display, 0, 0, display.width - 1, display.height - 1, {
    r: 255, g: 255, b: 255,
  });
  flush(display);
} finally {
  display.close();
}
```

The API uses short drawing names because it operates on a framebuffer rather
than an X11 `Display`. Colours are `{ r, g, b, a }` objects.

### Export reference

| Export | Purpose |
| --- | --- |
| `Framebuffer`, `openFramebuffer(path?)` | Open and describe a packed-pixel framebuffer. |
| `normalizePoints(values)` | Accept flat numbers, `[x,y]` arrays, or `{x,y}` objects. An unpaired flat value is ignored. |
| `parsePoints(strings)` | Parse comma/whitespace-separated CLI-style coordinates. |
| `drawPoint(display, x, y, color?)` | Draw one clipped pixel. |
| `drawLine(display, x1, y1, x2, y2, color?)` | Draw a clipped Bresenham line. |
| `drawLines(display, points, color?, close?)` | Join a sequence of points. |
| `fillPolygon(display, points, color?)` | Fill a polygon with the even-odd scanline rule. |
| `clear(display, color?)` | Fill the in-memory frame, black by default. |
| `flush(display)` | Copy the in-memory frame to the shared `/dev/fb0` mapping and synchronize it. |
| `blitImageData(display, imageData, x?, y?)` | Copy an RGBA `ImageData` (for example from CanvasKit's HTML canvas emulation) into the frame, converting to the framebuffer's format and clipping. |
| `openConsole`, `setConsoleGraphics`, `setConsoleText` | Explicit Linux virtual-console control for callers that need it. |
| `activeConsole(console)`, `activateConsole(console, n)`, `consoleNumber(path)` | `VT_GETSTATE` / `VT_ACTIVATE` + `VT_WAITACTIVE`, and the number in a `/dev/ttyN` path. |
| `watchConsoleSwitches(console, onAcquire)` | `VT_SETMODE` with `VT_PROCESS`: answers the kernel's switch-away and switch-back signals and calls `onAcquire` when the display returns. Returns a function restoring automatic switching. |
| `runGraphics(draw, { device, console, switchConsole, prepareConsole }?)` | Open the framebuffer, optionally call `await prepareConsole(console)`, put the console in graphics mode, run `await draw(display, { console, onRestore, onRelease, onAcquire })`, and restore text mode however the call ends (return, throw, `process.exit()`, `SIGHUP`/`SIGINT`/`SIGQUIT`/`SIGTERM`). `console` lists console devices to try, such as `["/dev/tty1"]`; when the one opened is a `/dev/ttyN` other than the console on screen, the display is switched to it first and back afterwards (`switchConsole: false` disables this). Console switches with Ctrl-Alt-Fn keep working: `onRelease(callback)` runs before the switch is acknowledged so drawing can stop, `onAcquire(callback)` runs when the display comes back, and `onRestore(callback)` registers cleanup to run before text mode returns. A cleanup function returned by `prepareConsole` is registered the same way. |
| `runDemo({ polygons, device }?)` | Run the CLI demo through `runGraphics()`. Each item in `polygons` is drawn separately. |

The module supports 16-, 24-, and 32-bit packed-pixel framebuffers and uses
the kernel-reported stride, offsets, and RGB bitfields. Paletted and unusual
non-packed framebuffer formats are rejected rather than drawn incorrectly.

## Operational limits

- Run the demo from a real Linux virtual console. A PTY, serial console, SSH
  session, or terminal pane cannot accept `KDSETMODE`.
- The framebuffer device and active virtual console must be accessible to the
  process; Buninu normally runs as root.
- Imported drawing calls modify an in-memory frame until `flush()` is called.
- Importing the module does not switch console mode. Only `runDemo()` or an
  explicit `setConsoleGraphics()` call does so.
- No userspace cleanup can run after `SIGKILL`, a kernel panic, power loss, or
  a native runtime crash. If one leaves the virtual console in graphics mode,
  switch to another VT or reboot to recover it.

## See also

- Source: `/lib/fbdev.js`
- Shared native binding: `/lib/dlopen.js`
- Skia on this framebuffer: `/lib/canvas.js` (`canvas.md`); the terminal
  built on both: `bunterm`
- Linux UAPI: `linux/fb.h` and `linux/kd.h`
