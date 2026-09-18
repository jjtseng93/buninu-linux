const KITTY_MODES = new Set(["off", "compat", "extended"]);

export function kittyModeFromEnvironment(input) {
  const value = String(input ?? "").trim().toLowerCase();
  return KITTY_MODES.has(value) ? value : "off";
}
