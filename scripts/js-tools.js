// Opt out explicitly; unset, empty and other values keep the JS tools enabled.
export const jsToolsEnabled = (value = process.env.BUNINU_JS_TOOLS) =>
  !["0", "off", "false"].includes(String(value ?? "").trim().toLowerCase());
