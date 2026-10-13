import { expect, test } from "bun:test";
import { encodeKittyGraphics, syntheticKittyCursorMotion } from "../client-kitty.mjs";

test("CLI converts a server Kitty placement to native direct-transfer APC", () => {
  const encoded = encodeKittyGraphics({
    kind: "placement",
    control: { a: "T", t: "f", f: "100", i: "7", p: "9", c: "4", r: "2", o: "z" },
    image: { id: "7", format: 100, width: 30, height: 20, data: "AA==" },
  });
  expect(encoded).toBe("\x1b_Ga=T,f=100,i=7,p=9,c=4,r=2,t=d,s=30,v=20,m=0;AA==\x1b\\");
});

test("CLI retransmits cached data before a placement-only Kitty command", () => {
  const data = "A".repeat(4100);
  const encoded = encodeKittyGraphics({
    kind: "placement",
    control: { a: "p", i: "8", p: "2", C: "1" },
    image: { id: "8", format: 100, width: 1, height: 1, data },
  });
  expect(encoded).toContain("\x1b_Ga=t,i=8,p=2,C=1,t=d,f=100,s=1,v=1,m=1;");
  expect(encoded).toContain("\x1b_Gm=0;AAAA\x1b\\");
  expect(encoded.endsWith("\x1b_Ga=p,i=8,p=2,C=1;\x1b\\")).toBe(true);
});

test("CLI converts Kitty deletion messages", () => {
  expect(encodeKittyGraphics({
    kind: "delete",
    delete: { scope: "I", imageId: "7", placementId: "3" },
  })).toBe("\x1b_Ga=d,d=I,i=7,p=3;\x1b\\");
});

test("CLI identifies browser-only cursor motion after native Kitty placement", () => {
  expect(syntheticKittyCursorMotion({
    kind: "placement",
    cursor: { row: 3, col: 4 },
    control: { c: "6", r: "2" },
  })).toBe("\r\n\r\n\x1b[10G");
  expect(syntheticKittyCursorMotion({
    kind: "placement",
    cursor: { row: 3, col: 4 },
    control: { c: "6", r: "2", C: "1" },
  })).toBe("");
});
