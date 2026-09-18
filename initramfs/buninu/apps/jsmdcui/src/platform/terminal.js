import process from "node:process";

export function controllingTerminalInputPath(platform = process.platform) {
  return platform === "win32" ? "CONIN$" : "/dev/tty";
}
