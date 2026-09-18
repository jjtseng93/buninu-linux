const assert = require("node:assert/strict");
const test = require("node:test");
const { CursorStateTracker, KittyGraphicsParser } = require("../gotty.js");

test("Kitty parsing preserves ANSI/APC order and captures the cursor at the APC", () => {
  const parser = new KittyGraphicsParser();
  const tracker = new CursorStateTracker();
  const raw = Buffer.from(
    "\x1b[5;4H" +
    "\x1b_Ga=T,f=100,i=7,p=7,q=2,C=1,x=10,y=20,w=30,h=40,c=5,r=6,m=0;AA==\x1b\\" +
    "\x1b[9;2H",
  );

  const { events } = parser.consume(raw);
  assert.deepEqual(events.map((event) => event.kind), ["plain", "kitty", "plain"]);

  tracker.consume(events[0].data);
  const graphic = parser.parsePacket(events[1].packet, tracker.snapshot());
  assert.equal(graphic.kind, "placement");
  assert.deepEqual(graphic.cursor, { row: 5, col: 4 });
  assert.deepEqual(
    Object.fromEntries(["x", "y", "w", "h", "c", "r"].map((key) => [key, graphic.control[key]])),
    { x: "10", y: "20", w: "30", h: "40", c: "5", r: "6" },
  );

  tracker.consume(events[2].data);
  assert.deepEqual(tracker.snapshot(), { row: 9, col: 2 });
});

test("an APC split across PTY chunks stays ordered after preceding output", () => {
  const parser = new KittyGraphicsParser();
  const first = parser.consume(Buffer.from("\x1b[3;6H\x1b_Ga=d,d=i"));
  assert.deepEqual(first.events.map((event) => event.kind), ["plain"]);

  const second = parser.consume(Buffer.from(",i=9;\x1b\\tail"));
  assert.deepEqual(second.events.map((event) => event.kind), ["kitty", "plain"]);
});

test("placement-only packets reuse the server-side cached image", () => {
  const parser = new KittyGraphicsParser();
  const parse = (packet) => {
    const event = parser.consume(Buffer.from(packet)).events.find((item) => item.kind === "kitty");
    return event ? parser.parsePacket(event.packet, { row: 1, col: 1 }) : null;
  };

  const transfer = parse("\x1b_Ga=T,f=100,i=7,p=7,U=image/png,m=0;AA==\x1b\\");
  assert.equal(transfer.image.data, "AA==");
  assert.equal(transfer.image.mime, "image/png");

  const placement = parse("\x1b_Ga=p,i=7,p=7,c=5,r=2,C=1;\x1b\\");
  assert.equal(placement.image.id, "7");
  assert.equal(placement.image.data, "AA==");

  parse("\x1b_Ga=d,d=i,i=7;\x1b\\");
  assert.ok(parse("\x1b_Ga=p,i=7,p=7;\x1b\\"));
  parse("\x1b_Ga=d,d=I,i=7;\x1b\\");
  assert.equal(parse("\x1b_Ga=p,i=7,p=7;\x1b\\"), null);
});
