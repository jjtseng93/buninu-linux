import { describe, expect, test } from "bun:test";
import {
  isOriginAllowed,
  isSafeHostHeader,
  parseAllowedOrigins,
} from "../runtime/jsplugins/cdp/cdp-server.js";

describe("Chromium-compatible CDP request checks", () => {
  test("rejects browser origins by default but permits clients without Origin", () => {
    expect(isOriginAllowed(null)).toBe(true);
    expect(isOriginAllowed(undefined)).toBe(true);
    expect(isOriginAllowed("http://localhost:8000")).toBe(false);
    expect(isOriginAllowed("null")).toBe(false);
  });

  test("allows only explicitly configured origins or wildcard", () => {
    const exact = parseAllowedOrigins("http://localhost:8000, HTTPS://EXAMPLE.COM");
    expect(isOriginAllowed("http://localhost:8000", exact)).toBe(true);
    expect(isOriginAllowed("https://example.com", exact)).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:8000", exact)).toBe(false);
    expect(isOriginAllowed("https://evil.example", parseAllowedOrigins("*"))).toBe(true);
  });

  test("accepts IP and localhost Host headers but rejects DNS names", () => {
    expect(isSafeHostHeader("127.0.0.1:9222")).toBe(true);
    expect(isSafeHostHeader("[::1]:9222")).toBe(true);
    expect(isSafeHostHeader("localhost:9222")).toBe(true);
    expect(isSafeHostHeader("devtools.localhost:9222")).toBe(true);
    expect(isSafeHostHeader("attacker.example:9222")).toBe(false);
    expect(isSafeHostHeader("127.0.0.999:9222")).toBe(false);
  });
});
