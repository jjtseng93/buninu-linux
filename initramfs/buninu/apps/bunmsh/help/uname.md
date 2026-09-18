## uname

Print system information.

### Usage

```sh
uname [-asnrvmp]
```

### Options and forms

- `-a`: Select all supported fields.
- `-s`: System name.
- `-n`: Host name.
- `-r`: OS release.
- `-v`: OS version.
- `-m`: Machine architecture.
- `-p`: Processor architecture. Short flags may be combined.

### Example

```sh
uname -mprs
```

Output:

```text
Linux 6.17.0-PRoot-Distro aarch64 aarch64
```
