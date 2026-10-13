const KITTY_CHUNK_SIZE = 4096;
const KITTY_TRANSPORT_KEYS = new Set(["m", "o", "O", "S", "t", "U", "mime"]);

function kittyPacket(control, payload = "") {
  const entries = Object.entries(control)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => value === true ? key : `${key}=${value}`);
  return `\u001b_G${entries.join(",")};${payload}\u001b\\`;
}

/** Convert the server's browser-neutral Kitty message back to native APCs. */
export function encodeKittyGraphics(message) {
  if (!message || typeof message !== "object") return "";
  if (message.kind === "delete") {
    const deletion = message.delete || {};
    return kittyPacket({
      a: "d",
      d: deletion.scope || "a",
      i: deletion.imageId || undefined,
      p: deletion.placementId || undefined,
    });
  }
  if (message.kind !== "placement" || !message.image?.data) return "";

  const original = { ...(message.control || {}) };
  const action = original.a || "t";
  const placementOnly = action === "p";
  const transfer = {};
  for (const [key, value] of Object.entries(original)) {
    if (!KITTY_TRANSPORT_KEYS.has(key)) transfer[key] = value;
  }
  transfer.a = placementOnly ? "t" : action;
  transfer.t = "d";
  transfer.f = message.image.format || transfer.f || 32;
  if (message.image.width > 0) transfer.s = message.image.width;
  if (message.image.height > 0) transfer.v = message.image.height;
  if (!transfer.i && /^\d+$/.test(String(message.image.id || ""))) transfer.i = message.image.id;

  const payload = String(message.image.data);
  let output = "";
  for (let offset = 0; offset < payload.length; offset += KITTY_CHUNK_SIZE) {
    const more = offset + KITTY_CHUNK_SIZE < payload.length;
    const control = offset === 0 ? { ...transfer, m: more ? 1 : 0 } : { m: more ? 1 : 0 };
    output += kittyPacket(control, payload.slice(offset, offset + KITTY_CHUNK_SIZE));
  }
  if (placementOnly) output += kittyPacket(original);
  return output;
}

/** Cursor motion the server adds for browser overlays; native Kitty does it itself. */
export function syntheticKittyCursorMotion(message) {
  if (message?.kind !== "placement") return "";
  const control = message.control || {};
  if (control.C === "1") return "";
  const cols = Math.max(0, Number.parseInt(control.c || "0", 10) || 0);
  const rows = Math.max(0, Number.parseInt(control.r || "0", 10) || 0);
  const cursorCol = Math.max(1, Number.parseInt(message.cursor?.col || "1", 10) || 1);
  const targetCol = Math.max(1, cursorCol + cols);
  if (rows > 0) return "\r\n".repeat(rows) + `\u001b[${targetCol}G`;
  return cols > 0 ? `\u001b[${targetCol}G` : "";
}
