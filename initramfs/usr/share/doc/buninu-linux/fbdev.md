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
| `openConsole`, `setConsoleGraphics`, `setConsoleText` | Explicit Linux virtual-console control for callers that need it. |
| `runDemo({ polygons, device }?)` | Run the same graphics-mode lifecycle used by the CLI. Each item in `polygons` is drawn separately. |

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
- Linux UAPI: `linux/fb.h` and `linux/kd.h`
