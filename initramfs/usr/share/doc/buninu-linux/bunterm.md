# bunterm — a graphical terminal on the Linux framebuffer

`bunterm` runs a program on a pseudo-terminal and draws its screen on
`/dev/fb0` with Skia (CanvasKit), so a real Linux console gets an
xterm-compatible terminal with anti-aliased text, CJK, colour emoji, seamless
box drawing and kitty graphics protocol images — no X11, Wayland or GPU.

```sh
bunterm 2                    # start a detached bunterm on /dev/tty2
bunterm /dev/tty2            # the full virtual-console spelling also works
bunterm                      # open a new VT after the last session; first is tty2
bunterm -s 20                # short for --font-size 20
bunterm -e bun /buninu/apps/jsmdcui/src/index.js --demo
bunterm --no-mouse          # keyboard only
bunterm --no-clipboard      # ignore OSC 52 copy and paste
bunterm -h
```

Use `chvt 1` inside bunterm to return to tty1 without stopping it, and
`chvt 2` from a shell to return to a bunterm started on tty2. See `chvt --help`
for use from the init REPL.

The program's `TERM` is `xterm-256color`, `COLORTERM=truecolor`,
`TERM_PROGRAM=bunterm` and `JSMDCUI_KITTY_MODE=extended` (so `jsmdcui` shows
Markdown images without `--kitty`). When it exits, the console returns to
text mode and `bunterm` exits with its status.

Every live session has a canonical `/bin/bunterm /dev/ttyN ...` command line.
When no console is named, a new VT after the last known session is selected,
starting at tty2 and keeping tty1 for hardware setup.
Using a VT other than the active one starts bunterm as a detached session and returns
immediately to the calling shell. Only one bunterm may control a given VT;
ownership is
identified from the process task name and its open console descriptor under
`/proc`, so it disappears automatically when the process exits.

## Options

| Option | Meaning |
| --- | --- |
| `N`, `/dev/ttyN` | The virtual console to use for graphics and the keyboard; for example, `2` means `/dev/tty2`. Naming a VT other than the active one starts a detached bunterm there, switches the display to it, and immediately returns control to the calling shell. Without this argument, bunterm selects the next VT after the last known session (tty2 initially). |
| `-e command [argument...]` | The program to run; everything after `-e` belongs to it. Default `/bin/sh`. |
| `-s N`, `--font-size N` | Font size in pixels (default 13). The cell is 0.6 × N wide and 1.16 × N tall with DejaVu Sans Mono, so 1024×768 at 16 px gives 106 × 41 cells. |
| `--line-height F` | Multiplies the cell height (default 1). |
| `--fb /dev/fbN` | The framebuffer device (default `/dev/fb0`). |
| `--no-blink` | A steady cursor. |
| `--no-mouse` | Do not attach a pointing device; nothing then reads `/dev/input`. |
| `--no-clipboard` | Disable both OSC 52 and menu copy/paste; `xclip` is never run. |

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

Without Kitty keyboard negotiation, the console stays in the kernel's translated keyboard mode, so
`Ctrl-Alt-F2` and friends still switch consoles; coming back repaints the
screen. While its VT is inactive, bunterm continues consuming PTY output and
updating its scrollback and kitty images, but neither writes the framebuffer
nor forwards global `/dev/input` mouse events. This allows separate bunterm
processes on `/dev/tty1`, `/dev/tty2`, and so on to hand the display back and
forth through the normal Linux VT switch. A few console-specific
sequences are rewritten to xterm's (`F1`–`F5`, `Home`, `End`), and arrow keys
follow the program's application cursor mode.

### Kitty keyboard

The Kitty keyboard protocol uses the same encoder as jsgotty 1.2.0:
flags **1** (disambiguation), **2** (press/repeat/release), and **8** (all keys).
Applications enable it with `CSI > flags u`, query with `CSI ? u`, and restore
with `CSI < u`; normal and alternate buffers have separate stacks. Flags 4
(alternate keys) and 16 (associated text) are not advertised.

Only while an application enables Kitty, the active console uses Linux
`K_MEDIUMRAW` to distinguish Ctrl, Alt, Shift, Super, keypad and key releases.
Bunterm restores the original mode on pop/reset or exit. Ctrl+Alt+F1–F12 and
Alt+Left/Right remain reserved for VT switching. The kernel keymap supplies
printable characters, including Shift/Caps Lock/AltGr. Kernel dead-key/Compose
sequences are not implemented in this Kitty path; the ordinary translated
console path retains its existing behavior. No global evdev keyboard grab is
needed. A mode transition discards pending console typeahead so raw keycodes
cannot leak into the child as text.

中文：Kitty 模式與 jsgotty 支援相同的 flags 1、2、8，可區分 Super、
Ctrl/Alt/Shift 組合及按下／重複／放開。程式退出模式後恢復原有 console
輸入；Ctrl+Alt+Fn、Alt+左右保留為切換 VT。Kitty 模式尚不處理 dead key／Compose。

## Mouse

Every pointing device under `/dev/input/event*` is opened and an arrow is
drawn on the screen. Clicks, drags and wheel notches reach the program as
the xterm mouse sequences it asked for: nothing is sent unless the program
enabled reporting (`DECSET 1000`, `1002` or `1003`), and what is sent follows
the mode it chose, including SGR cell coordinates (`1006`) and SGR pixel
coordinates (`1016`). Mode 1016 also answers DECRQM queries; pixel positions
exclude the framebuffer margins and preserve movement within a cell.
CSI 14t/16t report the content and cell dimensions in those same pixel units. `jsmdcui`, `micro`, `htop`, `vim`
and anything else that speaks the protocol work with no configuration.

When the program is not reading the mouse, the wheel scrolls instead: back
through the scrollback on the normal screen, three lines per notch, and as
arrow keys on the alternate screen, which has no scrollback and is what a
pager expects. Typing returns to the live screen, and the text cursor is
hidden while it is scrolled out of view.

When mouse reporting is off, left-drag selects terminal text. Wide characters
and graphemes are selected whole; wrapped lines copy without extra newlines.
Use **Copy** in the top-left menu to send the selection to xclip. Selection is
cleared when new PTY text arrives or the font size changes, so it cannot refer
to replaced cells. Applications requesting mouse reporting receive the drag
instead; selection never overrides their mouse mode.

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
neither set nor read the clipboard through the terminal; menu copy/paste is
also disabled. The menu's **Paste** reads xclip and sends one paste to the PTY,
wrapped in `CSI 200~` / `CSI 201~` when the application enabled bracketed paste
(`DECSET 2004`). Programs that have not requested it receive plain text.
Newlines are normalized to CR; embedded ESC bytes are stripped in bracketed
mode so clipboard text cannot close the paste early.

## Limits

- Needs a framebuffer: `linux-lts` has one built in, while the default
  `linux-virt` builds it as modules the image does not ship, so build with
  `--linux-lts` or `--real` (efifb/simpledrm from UEFI).
- The aarch64 image has no framebuffer yet: `run-qemu.sh` gives QEMU's
  `virt` machine no display device, so there is no `/dev/fb0` to draw on.
- Scrollback uses the wheel; the buffer keeps 1000 lines.
  `--no-mouse` removes the pointer and local selection.
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

## Local menu and commands

Left-click the top-left **2×2 physical pixels** to open a text menu of live
bunterm VTs and the initial tty (normally tty1). Click an entry to switch, or use
Up/Down and Enter. The active VT is marked `(current)`.
The wheel scrolls the selection; Escape, right-click, or a click
outside the entries closes the menu. Menu input is consumed locally, including
when a terminal application has enabled mouse reporting. Requires mouse support.
The menu switches existing sessions; it does not create a new bunterm.

- **Font − / +** changes the current session's font size and resizes the PTY.
- **Copy / Paste** uses the same xclip clipboard as OSC 52.
- Click the light **command input field**, or press Tab, to type a local command.
  Enter executes it, Tab returns to menu navigation, Esc closes the menu.
  Backspace/Delete, Left/Right, Home/End and Ctrl+U edit the field.

Commands: `font 16`, `font +`, `font -`, `copy`, `paste`, `vt 2`, `help`.
Font commands accept integer sizes 6–96; changes last for this session.
The command registry is `/lib/bunterm/commands.js`; new commands can be added
there without changing the input widget. These are bunterm commands, not shell
commands. Clipboard failures and command errors appear in the menu footer.

中文：左鍵點擊螢幕最左上角 2×2 像素，會列出正在運行的 bunterm 和初始 tty。
目前顯示的 VT 會標示 `(current)`。
可以點選或用上下鍵、Enter 切換；Esc、右鍵或點擊選項外關閉。不會把選單操作
送進底下的 shell／應用程式，也不會關閉原本的 bunterm。
選單還有字體大小減／加、複製／貼上，以及自由輸入的命令框（點選或按 Tab）。
可輸入 `font 16`、`copy`、`paste`、`vt 2`、`help`；Enter 執行。
複製前用左鍵拖曳選字，僅在程式未開啟滑鼠回報時生效。貼上沿用 xclip，
程式啟用 bracketed paste 時會加上貼上邊界。

On GPU-provided fbdev devices, a shared framebuffer mapping may not support
`msync`. bunterm probes it once: `EINVAL`/`EOPNOTSUPP` disables further msync
calls for that mapping while pixel writes continue normally. Drivers that
support msync retain it; other errors still propagate. This is not a vsync or
GPU-acceleration mechanism.
