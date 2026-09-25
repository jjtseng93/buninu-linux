# bunterm — a graphical terminal on the Linux framebuffer

`bunterm` runs a program on a pseudo-terminal and draws its screen on
`/dev/fb0` with Skia (CanvasKit), so a real Linux console gets an
xterm-compatible terminal with anti-aliased text, CJK, colour emoji, seamless
box drawing and kitty graphics protocol images — no X11, Wayland or GPU.

```sh
bunterm                      # run /bin/sh on the console you are on
bunterm 2                    # start a detached bunterm on /dev/tty2
bunterm /dev/tty1            # the full virtual-console spelling also works
bunterm -s 20                # short for --font-size 20
bunterm -e bun /buninu/apps/jsmdcui/src/index.js --demo
bunterm --no-mouse          # keyboard only
bunterm --no-clipboard      # ignore OSC 52 copy and paste
bunterm -h
```

The program's `TERM` is `xterm-256color`, `COLORTERM=truecolor`,
`TERM_PROGRAM=bunterm` and `JSMDCUI_KITTY_MODE=extended` (so `jsmdcui` shows
Markdown images without `--kitty`). When it exits, the console returns to
text mode and `bunterm` exits with its status.

Every live session has a canonical `/bin/bunterm /dev/ttyN ...` command line.
When no console is named, the currently active VT is used in the foreground.
Naming a different VT starts bunterm as a detached session and returns
immediately to the calling shell. Only one bunterm may control a given VT;
ownership is
identified from the process task name and its open console descriptor under
`/proc`, so it disappears automatically when the process exits.

## Options

| Option | Meaning |
| --- | --- |
| `N`, `/dev/ttyN` | The virtual console to use for graphics and the keyboard; for example, `2` means `/dev/tty2`. Naming a VT other than the active one starts a detached bunterm there, switches the display to it, and immediately returns control to the calling shell. Without this argument, bunterm uses the active VT in the foreground. |
| `-e command [argument...]` | The program to run; everything after `-e` belongs to it. Default `/bin/sh`. |
| `-s N`, `--font-size N` | Font size in pixels (default 16). The cell is 0.6 × N wide and 1.16 × N tall with DejaVu Sans Mono, so 1024×768 at 16 px gives 106 × 41 cells. |
| `--line-height F` | Multiplies the cell height (default 1). |
| `--fb /dev/fbN` | The framebuffer device (default `/dev/fb0`). |
| `--no-blink` | A steady cursor. |
| `--no-mouse` | Do not attach a pointing device; nothing then reads `/dev/input`. |
| `--no-clipboard` | Ignore OSC 52: programs can neither copy to nor read from the clipboard, and `xclip` is never run. |

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
screen. While its VT is inactive, bunterm continues consuming PTY output and
updating its scrollback and kitty images, but neither writes the framebuffer
nor forwards global `/dev/input` mouse events. This allows separate bunterm
processes on `/dev/tty1`, `/dev/tty2`, and so on to hand the display back and
forth through the normal Linux VT switch. A few console-specific
sequences are rewritten to xterm's (`F1`–`F5`, `Home`, `End`), and arrow keys
follow the program's application cursor mode.

## Mouse

Every pointing device under `/dev/input/event*` is opened and an arrow is
drawn on the screen. Clicks, drags and wheel notches reach the program as
the xterm mouse sequences it asked for: nothing is sent unless the program
enabled reporting (`DECSET 1000`, `1002` or `1003`), and what is sent follows
the mode it chose, SGR (`1006`) included. `jsmdcui`, `micro`, `htop`, `vim`
and anything else that speaks the protocol work with no configuration.

When the program is not reading the mouse, the wheel scrolls instead: back
through the scrollback on the normal screen, three lines per notch, and as
arrow keys on the alternate screen, which has no scrollback and is what a
pager expects. Typing returns to the live screen, and the text cursor is
hidden while it is scrolled out of view.

`--no-mouse` turns all of this off: the terminal then never looks at
`/dev/input` and never loads the mouse module.

`init.js` loads `evdev` and `psmouse` at boot, so a PS/2 mouse — which is
what QEMU's q35 machine and most PCs present — has a device node ready. The
aarch64 image loads `virtio_input` in place of `psmouse`, for QEMU's
`virtio-tablet-pci` and `virtio-keyboard-pci`. A USB
mouse also needs the `usbhid` stack, which a `--real` image carries and
`cfg.all` loads. The pointer follows relative devices (a mouse) and absolute
ones (a tablet or touchscreen) alike; a device that cannot be opened is
reported and the session continues without it.

## Clipboard

Programs copy and paste through OSC 52, as `casty` and `jsmdcui` do.
bunterm keeps no clipboard of its own: `ESC ] 52 ; c ; <base64>` is passed to
`xclip -selection clipboard`, and a query (`ESC ] 52 ; c ; ?`) is answered
with the output of `xclip -selection clipboard -o`, so every bunterm session
shares the same clipboard as `xclip`. A query xclip cannot answer is replied
to with empty contents. `--no-clipboard` turns this off, so a program can
neither set nor read the clipboard through the terminal.

## Limits

- Needs a framebuffer: `linux-lts` has one built in, while the default
  `linux-virt` builds it as modules the image does not ship, so build with
  `--linux-lts` or `--real` (efifb/simpledrm from UEFI).
- The aarch64 image has no framebuffer yet: `run-qemu.sh` gives QEMU's
  `virt` machine no display device, so there is no `/dev/fb0` to draw on.
- No selection, and no keyboard way to scroll back: the wheel is it. The
  buffer keeps 1000 lines. A program that does not enable mouse reporting
  sees no clicks — the arrow still moves, so the pointer is visibly alive.
  `--no-mouse` removes the pointer entirely.
- A program that prints a terminal reply while the tty echoes (that is, one
  not in raw mode) will see the reply echoed, as on any terminal.
- Kitty images are drawn above text; `z` ordering below text and animation
  frames are not implemented, and file transmission (`t=f`/`t=t`) works only
  for files under `/tmp`, `/dev/shm` or `$TMPDIR`.
- One bunterm per virtual console may use the framebuffer; only the active VT
  draws. For panes and tabs within one VT, run `jsmdcui` inside it.

## See also

- `/lib/bunterm/terminal.js` — `createSession()` and `runTerminal()`, the
  pieces `bunterm` is built from
- `/lib/canvas.js` — CanvasKit on the framebuffer (`canvas.md`)
- `/lib/fbdev.js` — the framebuffer itself (`fbdev.md`)
- `/buninu/apps/jsgotty/gotty.js` — the PTY backend and kitty packet parser
  that are reused
