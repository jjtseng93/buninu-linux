const MDCUI_ID_SOURCE = String.raw`[_\p{L}\p{N}][_\p{L}\p{M}\p{N}:-]*`;
const MDCUI_ID_RE = new RegExp(`^${MDCUI_ID_SOURCE}$`, "u");
const MDCUI_ID_SELECTOR_RE = new RegExp(`^#(${MDCUI_ID_SOURCE})$`, "u");
const MDCUI_IDENTITY_RE = new RegExp(
  `^([A-Za-z_][\\w:-]*)?(?:#(${MDCUI_ID_SOURCE}))?((?:\\.[A-Za-z_][\\w:-]*)*)$`,
  "u",
);

export function isMdcuiId(value) {
  return MDCUI_ID_RE.test(String(value ?? ""));
}

export function parseMdcuiIdSelector(value) {
  return String(value ?? "").trim().match(MDCUI_ID_SELECTOR_RE)?.[1] ?? null;
}

export function parseMdcuiIdentity(value, { selector = false } = {}) {
  const match = String(value ?? "").trim().match(MDCUI_IDENTITY_RE);
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  if (!selector && !match[1]) return null;
  return {
    tag: match[1] || null,
    id: match[2] || null,
    classes: match[3] ? match[3].slice(1).split(".") : [],
  };
}
