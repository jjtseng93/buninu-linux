# poweroff — power off Buninu Linux

`poweroff` flushes pending filesystem writes with `sync(2)`, then requests
`LINUX_REBOOT_CMD_POWER_OFF` through Linux `reboot(2)`. It does not invoke a
service manager or another command.

## Usage

```sh
poweroff
poweroff --help
```

The caller needs the kernel's `CAP_SYS_BOOT` capability. Buninu's root shell
has it; otherwise the command reports `Operation not permitted` and exits.
