// Cooperative ownership for one Linux virtual console.
//
// Linux VT_SETMODE replaces an existing VT_PROCESS owner rather than failing,
// and VT_GETMODE does not expose that owner's pid.  bunterm therefore publishes
// a short per-VT task name and verifies that another such process does not also
// hold the console device open.  Both facts live under /proc/<pid> and disappear
// with the process; there is no persistent pid or lock file to become stale.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { libc, cString, check } from "../dlopen.js";

const PR_SET_NAME = 15;
const PR_GET_NAME = 16;

export const virtualConsoleNumber = (path) => {
  const match = /^\/dev\/tty([1-9][0-9]*)$/.exec(path);
  return match ? Number(match[1]) : null;
};

const taskName = (number) => `bunterm:tty${number}`;

const getTaskName = () => {
  const name = new Uint8Array(16);
  check("prctl(PR_GET_NAME)", libc.symbols.prctl(PR_GET_NAME, name, 0n, 0n, 0n));
  const zero = name.indexOf(0);
  return new TextDecoder().decode(zero === -1 ? name : name.subarray(0, zero));
};

const setTaskName = (name) => {
  const encoded = cString(name);
  if (encoded.byteLength > 16) throw new Error(`Linux task name is too long: ${name}`);
  check("prctl(PR_SET_NAME)", libc.symbols.prctl(PR_SET_NAME, encoded, 0n, 0n, 0n));
};

const processHoldsDevice = (pid, deviceId) => {
  let descriptors;
  try {
    descriptors = readdirSync(`/proc/${pid}/fd`);
  } catch {
    return false;
  }
  for (const descriptor of descriptors) {
    try {
      if (statSync(`/proc/${pid}/fd/${descriptor}`).rdev === deviceId) return true;
    } catch {
      // The process or descriptor disappeared between readdir and stat.
    }
  }
  return false;
};

export const claimVirtualConsole = (consoleDevice) => {
  const number = virtualConsoleNumber(consoleDevice.path);
  if (number === null) throw new Error(`bunterm needs a canonical virtual console, got ${consoleDevice.path}`);
  const name = taskName(number);
  const previousName = getTaskName();
  const deviceId = statSync(consoleDevice.path).rdev;

  // Publish before scanning.  Two simultaneous starters can then reject each
  // other, but they cannot both scan an unpublished peer and proceed.
  setTaskName(name);
  try {
    const pids = readdirSync("/proc")
      .filter((entry) => /^[0-9]+$/.test(entry) && Number(entry) !== process.pid);
    for (const pid of pids) {
      let otherName;
      try {
        otherName = readFileSync(`/proc/${pid}/comm`, "utf8").trim();
      } catch {
        continue;
      }
      if (otherName !== name || !processHoldsDevice(pid, deviceId)) continue;

      throw new Error(`
${consoleDevice.path} is occupied
  Controlled by bunterm pid: ${pid}
See --help or try another VT:
  bunterm ${number- -1}
Switch between TTYs by Ctrl+Alt+F1-12
  or Alt-Left / Alt-Right
`);
    }
  } catch (error) {
    try { setTaskName(previousName); } catch {}
    throw error;
  }

  return () => {
    try { setTaskName(previousName); } catch {}
  };
};
