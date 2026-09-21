// Shared implementation for /bin/poweroff and /bin/reboot.

import { libc, check, showDocument } from "./dlopen.js";

export const LINUX_REBOOT_CMD_RESTART = 0x01234567;
export const LINUX_REBOOT_CMD_POWER_OFF = 0x4321fedc;

export const runPowerCommand = async ({ name, command, action }) => {
  const arguments_ = process.argv.slice(2);

  if (arguments_.length === 1 && (arguments_[0] === "-h" || arguments_[0] === "--help")) {
    await showDocument(name);
    return;
  }

  if (arguments_.length !== 0) {
    console.error(`Usage: ${name} [-h | --help]`);
    process.exit(1);
  }

  console.log(`${name}: syncing filesystems`);
  libc.symbols.sync();
  console.log(`${name}: ${action}`);
  try {
    check(`reboot(${command.name})`, libc.symbols.reboot(command.value));
  } catch (error) {
    console.error(`${name}: ${error.message}`);
    process.exit(1);
  }

  // A successful reboot(2) never returns.
  console.error(`${name}: reboot returned without ${action}`);
  process.exit(1);
};
