const HEX3_ENCODINGS = new Set(["hex3", "hex3gz", "hex3zst"]);
const MDCUI_ENCODING = "mdcui";

export function isHex3Encoding(encoding) {
  return HEX3_ENCODINGS.has(String(encoding || "utf-8").toLowerCase());
}

export function isMdcuiEncoding(encoding) {
  return String(encoding || "utf-8").toLowerCase() === MDCUI_ENCODING;
}
