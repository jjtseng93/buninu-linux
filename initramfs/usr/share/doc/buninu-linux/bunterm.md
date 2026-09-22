# bunterm — a graphical terminal on the Linux framebuffer

`bunterm` runs a program on a pseudo-terminal and draws its screen on
`/dev/fb0` with Skia (CanvasKit), so a real Linux console gets an
xterm-compatible terminal with anti-aliased text, CJK, colour emoji, seamless
box drawing and kitty graphics protocol images — no X11, Wayland or GPU.

```sh
bunterm                      # run /bin/sh on the console you are on
bunterm /dev/tty1            # use virtual console 1 for graphics and keys
bunterm --font-size 20
bunterm -e bun /buninu/apps/jsmdcui/src/index.js --demo
bunterm -h
```

The program's `TERM` is `xterm-256color`, `COLORTERM=truecolor`,
`TERM_PROGRAM=bunterm` and `JSMDCUI_KITTY_MODE=extended` (so `jsmdcui` shows
Markdown images without `--kitty`). When it exits, the console returns to
text mode and `bunterm` exits with its status.

## Options

| Option | Meaning |
| --- | --- |
| `/dev/ttyN` | The virtual console to use for graphics and the keyboard. If another console is on screen, the display switches to this one first and back when `bunterm` exits. Without it the process's own console and stdin are used, so run it from a VT (not a serial line or a PTY). |
| `-e command [argument...]` | The program to run; everything after `-e` belongs to it. Default `/bin/sh`. |
| `--font-size N` | Font size in pixels (default 16). The cell is 0.6 × N wide and 1.16 × N tall with DejaVu Sans Mono, so 1024×768 at 16 px gives 106 × 41 cells. |
| `--line-height F` | Multiplies the cell height (default 1). |
| `--fb /dev/fbN` | The framebuffer device (default `/dev/fb0`). |
| `--no-blink` | A steady cursor. |

## What is drawn

- **Text** comes from `/usr/share/fonts`: DejaVu Sans Mono (regular and
  bold) sets the grid; Noto Sans CJK TC, Noto Color Emoji (+ Flags) and Noto
  Sans Symbols fill in what it lacks. A glyph is centred in the one or two
  cells the terminal assigned it; wide characters take two.
- **Box drawing, block elements, shades and Powerline symbols** (U+2500–259F,
  U+E0A0–E0BF, U+1FB70–1FB97) are drawn as vectors, ported from xterm.js, so
  they join without seams at any size.
- **Attributes**: 16 / 256 / 24-bit colours, bold (brighter for the eight base
  colours), italic, dim, underline, strikethrough, inverse, invisible.
- **Grapheme clusters** such as 🇹🇼 and 👨‍👩‍👧 occupy one cell each (xterm.js's
  unicode-graphemes addon) and are shaped by Skia's paragraph engine.
- **Images**: the kitty graphics protocol (`ESC _ G … ESC \`) with direct
  transmission (`t=d`), PNG (`f=100`) or raw RGB/RGBA (`f=24`/`32`), zlib
  (`o=z`), chunking (`m=`), cropping (`x,y,w,h`), sizing in cells (`c,r`),
  cell offsets (`X,Y`), placements (`p=`), deletion (`a=d`) and queries
  (`a=q`). An image is anchored to its line and scrolls with the text; on the
  alternate screen it stays at its row and is removed when the program
  leaves that screen. Any encoding Skia decodes (PNG, JPEG, WebP, GIF) is
  accepted under `f=100`, as with jsgotty's `U=` extension.

## Keyboard

The console stays in the kernel's translated keyboard mode, so
`Ctrl-Alt-F2` and friends still switch consoles; coming back repaints the
screen. A few console-specific
sequences are rewritten to xterm's (`F1`–`F5`, `Home`, `End`), and arrow keys
follow the program's application cursor mode.

## Limits

- Needs a framebuffer: the default `linux-virt` kernel has none, so build
  the image with `--linux-lts` or `--real` (efifb/simpledrm from UEFI).
- No mouse, no selection, no scrollback viewing (the buffer keeps 1000
  lines for programs that query it).
- A program that prints a terminal reply while the tty echoes (that is, one
  not in raw mode) will see the reply echoed, as on any terminal.
- Kitty images are drawn above text; `z` ordering below text and animation
  frames are not implemented, and file transmission (`t=f`/`t=t`) works only
  for files under `/tmp`, `/dev/shm` or `$TMPDIR`.
- One framebuffer, one session. For panes and tabs run `jsmdcui` inside it.

## See also

- `/lib/bunterm/terminal.js` — `createSession()` and `runTerminal()`, the
  pieces `bunterm` is built from
- `/lib/canvas.js` — CanvasKit on the framebuffer (`canvas.md`)
- `/lib/fbdev.js` — the framebuffer itself (`fbdev.md`)
- `/buninu/apps/jsgotty/gotty.js` — the PTY backend and kitty packet parser
  that are reused
