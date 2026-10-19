# chvt — switch Linux virtual terminals

```sh
chvt 1             # switch to /dev/tty1 (normally the init REPL)
chvt 2             # switch to /dev/tty2
chvt -h            # also --help
```

Accepts one VT number, 1–63. Requires access to a real Linux virtual console
and permission to switch it (normally root). A PTY alone, including a remote
terminal or Android terminal, is not a Linux VT.

With bunterm, for example:

```sh
bunterm 2          # start bunterm on tty2
chvt 1             # from its shell, return to tty1 without stopping bunterm
```

Run `chvt 2` from a shell to return, or use Alt+F2 / Ctrl+Alt+F2 as appropriate.
At the init JavaScript REPL, run a command with
`Bun.spawnSync(["/bin/chvt", "2"], {stdio: ["inherit", "inherit", "inherit"]})`.
The command switches the existing VT; it does not start a shell or bunterm on an
empty VT. bunterm retains ownership of its VT, pauses drawing when switched away,
and redraws when switched back. chvt does not change keyboard or graphics modes.

Like the traditional command, chvt waits for the target VT to become active,
then exits. If its current owner refuses to release the VT, the wait can persist. No daemon is created.

中文：`chvt 1` 切至 tty1，`chvt 2` 切回 tty2 的 bunterm；不會結束 bunterm，
也不會替空白 VT 啟動 shell。切出／切回使用 bunterm 原有的釋放與重繪機制。

Uses Linux VT_ACTIVATE and VT_WAITACTIVE:
https://man7.org/linux/man-pages/man2/ioctl_vt.2.html
