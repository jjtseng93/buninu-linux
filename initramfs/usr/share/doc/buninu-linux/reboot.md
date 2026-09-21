# reboot — restart Buninu Linux

`reboot` flushes pending filesystem writes with `sync(2)`, then requests
`LINUX_REBOOT_CMD_RESTART` through Linux `reboot(2)`. It shares its
implementation with `poweroff` and does not invoke a service manager.

## Usage

```sh
reboot
reboot --help
```

The caller needs the kernel's `CAP_SYS_BOOT` capability. Buninu's root shell
has it; otherwise the command reports `Operation not permitted` and exits.
