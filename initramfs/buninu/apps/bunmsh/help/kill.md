## kill

Send a signal to processes.

### Usage

```sh
kill [-SIGNAL] PID ...
```

### Options and forms

- `-SIGNAL`: Select a signal by name or number; the default is SIGTERM.
- `-0`: Check whether a process can be signalled without sending a signal.
- `-l`: List the signal names this runtime knows.

### Windows

Windows has no signals to deliver. The runtime turns SIGTERM, SIGINT, and
SIGKILL into an unconditional `TerminateProcess`, refuses every other name,
and in no case touches the target's children. So on Windows every terminating
signal is sent as `taskkill /PID PID /T /F` instead: `/T` reaches the children
the runtime would leave running, and `/F` is what makes it work on a console
process that has no message loop to close.

The consequence is that the signal name is accepted but not honoured there —
`kill -HUP PID` terminates the process rather than failing, and nothing gets
the chance to shut down gracefully. `-0` is the exception: it asks whether the
PID exists without touching it, which `taskkill` cannot express, so it still
goes through the runtime.

### Example

```sh
kill -0 $$
echo $?
```

Output:

```text
0
```
