# The Buninu Linux graphics stack

Buninu Linux draws on the screen without X11, Wayland, a GPU or any native
graphics library: the Linux framebuffer is mapped into Bun, Skia (compiled to
WebAssembly as CanvasKit) rasterizes into it, and `bunterm` puts an
xterm-compatible terminal on top. Everything is JavaScript or WebAssembly
except the kernel's `/dev/fb0`, reached through a few `ioctl`s and one `mmap`
via Bun FFI.

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │ programs on a PTY:  bunmsh, jsmdcui, bun scripts, kitten icat …      │
 └───────────────▲───────────────────────────────┬──────────────────────┘
        keyboard │ (raw console bytes)            │ output bytes + kitty APC
 ┌───────────────┴───────────────────────────────▼──────────────────────┐
 │ /bin/bunterm  →  /lib/bunterm/terminal.js                             │
 │   BunPtyBackend (jsgotty) ─ Bun.spawn({ terminal })    ← Bun's PTY    │
 │   KittyGraphicsParser (jsgotty) ─ splits ESC _ G … ESC \ packets      │
 │   @xterm/headless Terminal ─ VT parser, screen buffer, attributes     │
 │   images.js ─ kitty placements as Skia images anchored to lines       │
 │   input.js ─ /dev/ttyN raw mode, console→xterm key sequences          │
 │   mouse.js ─ /dev/input/event* pointer, unless --no-mouse             │
 │   renderer.js ─ cells → glyphs (fonts) or vectors (glyphs.js)         │
 └───────────────────────────────────────────────┬──────────────────────┘
                                                 │ Skia draw calls
 ┌───────────────────────────────────────────────▼──────────────────────┐
 │ /lib/canvas.js  ─ CanvasKit 0.41.1 (Skia in wasm, /lib/canvaskit/)    │
 │   openCanvas(): MakeRasterDirectSurface in the framebuffer's own      │
 │   pixel format (BGRA_8888 / RGBA_8888 / RGB_565) inside the wasm heap │
 │   loadFontSet(): /usr/share/fonts/fonts.json → Typefaces + FontMgr    │
 └───────────────────────────────────────────────┬──────────────────────┘
                                                 │ one memcpy per frame
 ┌───────────────────────────────────────────────▼──────────────────────┐
 │ /lib/fbdev.js  ─ Framebuffer: FBIOGET_*SCREENINFO, mmap, KDSETMODE    │
 │   runGraphics(): graphics mode + restore on exit/signal               │
 │   JS drawing (drawLine, fillPolygon …) and blitImageData() fallback   │
 └───────────────────────────────────────────────┬──────────────────────┘
                                                 │ ioctl / mmap (bun:ffi, /lib/dlopen.js)
 ┌───────────────────────────────────────────────▼──────────────────────┐
 │ Linux: /dev/fb0 (efifb / simpledrm from the UEFI GOP), /dev/ttyN      │
 └──────────────────────────────────────────────────────────────────────┘
```

## Layers

### 1. Framebuffer — `/lib/fbdev.js`

`Framebuffer` opens `/dev/fb0`, reads the variable and fixed screen info
(size, stride, bits per pixel, the red/green/blue bit offsets) and `mmap`s
the device. Drawing goes to a JavaScript back buffer laid out exactly like
the device; `flush()` copies it row by row into the mapping. Nothing draws
straight into the mapping: on efifb the memory is write-combining, reads are
very slow, and drawing there would tear.

`runGraphics(draw)` wraps a graphical program: it switches the virtual
console to `KD_GRAPHICS` (otherwise the kernel's text console keeps
overwriting the screen), runs `draw`, and restores `KD_TEXT` whether the
call returns, throws, exits, or is killed by a catchable signal. Given a
specific `/dev/ttyN`, it `VT_ACTIVATE`s that console first and switches
back to the previous one at the end; while drawing it takes `VT_PROCESS`
mode, so Ctrl-Alt-Fn still switches consoles and `onAcquire` lets the
program repaint when its console returns.

Manual: `fbdev --help` / `initramfs/usr/share/doc/buninu-linux/fbdev.md`.

### 2. Skia — `/lib/canvas.js` and `/lib/canvaskit/`

CanvasKit is Google's Skia compiled to WebAssembly (the same npm package the
browser uses). WebAssembly can only write its own linear memory, so Skia
cannot draw into the `mmap` directly. Instead `openCanvas()` allocates a
buffer in the wasm heap and creates a `MakeRasterDirectSurface` on it in the
framebuffer's native pixel layout (`pickColorType()` maps the kernel's
bitfields to `BGRA_8888` for the usual XRGB8888, or `RGBA_8888` /
`RGB_565`). The `Framebuffer`'s `pixels` view is pointed at that buffer, so
`flush()` is the same single `memcpy` as before and the JavaScript drawing
functions keep working on the same frame. A 24-bit or paletted device falls
back to CanvasKit's HTML-canvas emulation plus `blitImageData()`, which
converts per pixel.

Skia is CPU-only here (no GPU, no WebGL); the whole 1080p frame is a few
milliseconds to copy and cells are cached by Skia's glyph cache. The wasm
heap starts at 128 MiB and grows as fonts are loaded into it, which is why
QEMU is now started with `-m 1G`.

`loadFontSet()` reads `/usr/share/fonts/fonts.json` and builds the typefaces
and a `FontMgr` for a named set (`terminal`, `ui`). Noto Sans CJK is a
collection; the manager registers all five faces and the set's preferred
face (`Noto Sans CJK TC`) is the one handed out, so Taiwanese glyph forms
are used without relying on `locl`.

Manual: `initramfs/usr/share/doc/buninu-linux/canvas.md`.

### 3. Fonts — `/usr/share/fonts/`

| File | Role | License |
|---|---|---|
| `DejaVuSansMono.ttf`, `-Bold.ttf` | terminal grid font: 0.6 em wide, 1.16 em tall, box drawing, arrows, `☐☒✓`, Braille-free but everything jsmdcui draws | Bitstream Vera |
| `NotoSansCJK-Regular.ttc` | 32 MiB variable collection: JP/KR/SC/TC/HK faces, ~21 000 unified ideographs, ext. A, part of ext. B, kana, bopomofo, hangul, full-width forms | OFL 1.1 |
| `NotoColorEmoji.ttf`, `NotoColorEmojiFlags.ttf` | CBDT bitmap colour emoji; Skia's FreeType port renders them in colour | OFL 1.1 |
| `NotoSansSymbols-Regular-Subsetted.ttf`, `-Subsetted2.ttf` | arrows, math, geometric shapes, dingbats, Braille, musical symbols, cards | OFL 1.1 |
| `Roboto-Regular.ttf` | variable Latin/Greek/Cyrillic for non-terminal UI (`ui` set) | Apache 2.0 |

The Noto and Roboto files are the ones Android ships; DejaVu comes from
Debian. Each license text sits next to the fonts and in `LICENSES/`.

### 4. Terminal — `/bin/bunterm` and `/lib/bunterm/`

`bunterm` reuses three finished components instead of writing a terminal
from scratch:

- **PTY**: jsgotty's `BunPtyBackend`, which is `Bun.spawn(cmd, { terminal:
  { cols, rows, data, exit } })` — Bun's built-in pseudo-terminal, no
  node-pty, no FFI. jsgotty now exports the class for this.
- **Emulation**: `@xterm/headless`, the xterm.js core (VT parser, screen
  and scrollback buffers, SGR attributes, terminal replies, markers) with
  its DOM renderer removed. `@xterm/addon-unicode-graphemes` makes 🇹🇼,
  ZWJ sequences and combining marks occupy one cell.
- **Images**: jsgotty's `KittyGraphicsParser`, which splits the kitty
  graphics APC packets out of the byte stream, reassembles chunked
  transfers, inflates `o=z`, and produces placement / delete / query events
  and the replies to send back. (Two small changes to the vendored jsgotty:
  the export, and later chunks of a transfer whose first chunk named `i=`
  now continue that transfer, as the protocol allows — to be carried back
  to the jsgotty repository.)

Around those, `/lib/bunterm/` adds:

| File | Does |
|---|---|
| `renderer.js` | Paints `term.buffer` cell by cell. Cell size comes from DejaVu Sans Mono; every glyph is looked up in the regular font, then the fallbacks (colour emoji first for emoji-presentation code points, monochrome symbols first otherwise) and centred in its one or two cells; oversized fallback glyphs are scaled to fit. Multi-code-point graphemes are shaped by Skia's `Paragraph` and cached. Only rows whose content hash changed since the last frame, the cursor rows, and rows under moved images are repainted. 16/256/24-bit colour, bold (with bright base colours), italic, dim, underline, strikethrough, inverse, invisible. |
| `glyphs.js` | Box drawing (U+2500–257F incl. double, dashed, rounded, mixed-weight), block elements and shades (U+2580–259F), Powerline (U+E0A0–E0BF) and legacy computing (U+1FB70–1FB97) drawn as Skia paths, so they meet seamlessly at any size. The shape tables are xterm.js's `CustomGlyphs.ts` (MIT); coordinates snap to pixel centres for crisp 1-px lines. |
| `images.js` | Kitty placements: decodes PNG (`f=100`) with Skia or raw RGB/RGBA (`f=24/32`), with `Bun.Image` as a transcoder for other encodings; anchors each placement to an xterm marker so it scrolls with its line and disappears with it (on the alternate screen, where xterm.js issues no markers, to a fixed row that is dropped when that screen ends); sizes in cells (`c,r`) or from pixel size; crops (`x,y,w,h`), cell offsets (`X,Y`), `p=` placement ids, `a=d` deletion scopes, and the cursor move after a placement. |
| `input.js` | Raw mode on the console (`TCGETS`/`TCSETS` through the shared libc binding) and translation of the kernel's "linux" key sequences to xterm's, honouring DECCKM. |
| `mouse.js` | `/dev/input/event*` through the input layer: finds pointing devices by their sysfs capability bitmaps, decodes the 24-byte `input_event` records (relative deltas, absolute axes read with `EVIOCGABS`, buttons, wheel) and reports a pointer position per `EV_SYN`. Not loaded under `--no-mouse`; otherwise the session draws an arrow and hands each report to xterm.js's `CoreMouseService`, which decides what the program enabled and encodes it. A wheel notch the program is not asking for scrolls the viewport instead — `scrollLines()` on the normal screen, arrow keys on the alternate one. |
| `terminal.js` | `createSession()` wires PTY → parser → emulator → renderer with a coalesced ~60 Hz frame timer and a serialized output queue, so a kitty packet always sees the cursor position left by the text before it. `runTerminal()` adds `runGraphics()` and the keyboard. |

Manual: `bunterm --help` / `initramfs/usr/share/doc/buninu-linux/bunterm.md`.

## Data flow of one frame

1. The program writes to the PTY; Bun delivers the bytes to `BunPtyBackend`'s
   `data` callback.
2. `KittyGraphicsParser.consume()` returns plain-text runs and kitty packets
   in order. Plain runs go to `term.write()` (awaited, so the buffer is
   current); each packet is parsed with the cursor position at that point,
   handed to `ImageStore`, and acknowledged back to the PTY if the client
   asked.
3. A frame is requested. Sixteen milliseconds later `Renderer.render()`
   hashes each visible row, repaints the changed ones (background rect,
   glyph or vector, underline), draws the cursor block, and re-draws the
   parts of image placements that intersect the repainted rows.
4. `screen.flush()` finishes Skia's work and copies the wasm-heap frame into
   the `/dev/fb0` mapping.

Keyboard bytes travel the other way: console → `input.js` → PTY, and with
the mouse on, pointer reports go `/dev/input/event*` → `mouse.js` → the arrow on
screen and xterm.js's `CoreMouseService` → PTY. Terminal
replies (cursor position, device attributes, kitty acks) go from the
emulator straight to the PTY.

## Sizes

| Component | Raw | In the gzip initramfs |
|---|---|---|
| CanvasKit wasm + js | 7.3 MB | ~2.7 MB |
| xterm headless + graphemes addon | 0.2 MB | ~0.05 MB |
| Fonts | 39.9 MB | ~24 MB |
| Total added | ~47 MB | ~27 MB |

The initramfs grew from 44.7 MB to 71.8 MB compressed; the UKI is 84.5 MB and
the 127 MB EFI system partition keeps 46 MB free. The initramfs is unpacked
into RAM, and CanvasKit copies the fonts it uses into its heap, so the guest
needs about 1 GB.

## Trying it

The framebuffer needs a kernel that provides one. Both `linux-lts` kernels
set `CONFIG_SYSFB_SIMPLEFB`, so the UEFI GOP becomes a `simple-framebuffer`
device, which only `simpledrm` drives (`efifb` never sees it). The x86_64
`linux-lts` builds `simpledrm` in. The aarch64 one has it as a module:
`fetch-alpine.sh` ships it and its DRM dependencies for lts builds, and
`init.js` loads it at boot. The default `linux-virt` builds the framebuffer
drivers as modules, and the image ships only the network, storage, USB and
HID modules, so there `/dev/fb0` never appears. Build with
`./index.js -b --linux-lts` (or `--real` on x86_64). Under QEMU, the x86_64
lts kernel gets a 1280×800 `simpledrm` framebuffer from the UEFI GOP even
with `-display none`, and the monitor's `screendump` shows it. QEMU's aarch64
`virt` machine has no display until you add `-device ramfb`; EDK2 then
provides an 800×600 GOP, and `virtio-keyboard-pci` gives the VTs a keyboard
(see the README's
[What differs on aarch64](README.md#what-differs-on-aarch64)). From a virtual
console in the guest:

```sh
bunterm                                  # /bin/sh on this console
bunterm /dev/tty1 --font-size 20         # from a serial console, use VT 1
bunterm -e bun /buninu/apps/jsmdcui/src/index.js --demo
bun /lib/fbdev.js                        # the plain-framebuffer triangle
```

To render off-screen on the build host (no framebuffer), give `openCanvas()`
a plain object with `width`, `height`, `stride`, `bitsPerPixel`, `fields` and
a `pixels` `Uint8Array`, replace `screen.flush`, and snapshot the surface —
that is how the renderer and the kitty pipeline were tested during
development (`BUNINU_LIBC=/lib/aarch64-linux-gnu/libc.so.6` lets `dlopen.js`
load the host libc).

Verified in QEMU (lts kernel, `-vga std`, 1 GB): the attribute/CJK/emoji
sample, a kitty PNG placement, an interactive bunmsh with keys sent through
the console, and the jsmdcui editor demo all render as on the host;
`bunterm /dev/tty2` from the serial REPL switches the display to tty2 and
back to tty1 on exit, and Ctrl-Alt-F2 / Ctrl-Alt-F1 during a session
switch away and repaint on return. On the
host, `jsmdcui --tui` on a Markdown file with a JPEG (bunterm sets
`JSMDCUI_KITTY_MODE=extended` for the program it runs) places the image
through its transmit / `a=p` / `a=d` sequence exactly as in the browser.

Verified on aarch64 (lts kernel, Hypervisor.framework, `-device ramfb
-device virtio-keyboard-pci -device virtio-mouse-pci`, `-display none`):
`/proc/fb` lists `simpledrmdrmfb`; `bunterm 2` from the serial shell returns
at once and draws on VT 2; and keys sent with the monitor's `sendkey` reach
it: `showimg /buninu/icon.png` places the kitty image, and the prompt's
colour emoji and the pointer render, all checked with `screendump`.

## Not done yet

- Selection and scrollback viewing in `bunterm` (the pointer itself works,
  and `--no-mouse` turns it off).
- Kitty `z < 0` (images behind text), animation frames, Unicode
  placeholders, and shared-memory transmission.
- Text run shaping with ligatures for single-code-point cells (each cell is
  one glyph; Paragraph shaping is only used for grapheme clusters).
- Non-terminal UI on `canvas.js` (the `ui` font set and Roboto are there for
  it).
