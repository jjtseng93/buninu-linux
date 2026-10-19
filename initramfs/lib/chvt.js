// Use the same VT_ACTIVATE/VT_WAITACTIVE path as bunterm. Never take VT ownership.
export function parseChvt(args) {
  if (args.length === 1 && ["-h", "--help"].includes(args[0])) return { help: true };
  if (args.length !== 1 || !/^[0-9]+$/.test(args[0]) || Number(args[0]) < 1 || Number(args[0]) > 63)
    throw new Error("usage: chvt N (1–63); see chvt -h or --help");
  return { number: Number(args[0]) };
}

export async function switchVt(number, backend) {
  if (!Number.isInteger(number) || number < 1 || number > 63) throw new Error("VT number must be 1–63");
  const { openConsole, activeConsole, activateConsole } = backend ?? await import("./fbdev.js");
  const failures = [];
  let consoleDevice;
  // /dev/tty in bunterm is a PTY, and /dev/console may be a serial console.
  // Probe VT_GETSTATE before accepting an open fd.
  for (const path of ["/dev/tty0", "/dev/tty", "/dev/console"]) {
    let candidate;
    try {
      candidate = openConsole([path]);
      activeConsole(candidate);
      consoleDevice = candidate;
      break;
    } catch (error) {
      candidate?.close();
      failures.push(`${path}: ${error.message}`);
    }
  }
  if (!consoleDevice) throw new Error(`no accessible Linux VT (${failures.join("; ")})`);
  try { activateConsole(consoleDevice, number); }
  finally { consoleDevice.close(); }
}
