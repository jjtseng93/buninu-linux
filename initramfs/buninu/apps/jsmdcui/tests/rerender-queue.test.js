import { expect, test } from "bun:test";
import {
  enqueueMdcuiRerender,
  waitForMdcuiRerenders,
} from "../src/cui/rerender-queue.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("MDCUI rerenders run single-flight and coalesce pending work to the latest request", async () => {
  const buffer = {
    hidden: true,
    width: 80,
  };
  const firstGate = deferred();
  const latestGate = deferred();
  const captures = [];

  const rerender = (name, width, gate) => enqueueMdcuiRerender(buffer, async () => {
    const hidden = buffer.hidden;
    captures.push({ name, width, hidden });
    buffer.hidden = false;
    await gate.promise;
    buffer.width = width;
    buffer.hidden = hidden;
    return name;
  });

  const first = rerender("A", 40, firstGate);
  const stale = rerender("B", 50, deferred());
  const latest = rerender("C", 60, latestGate);
  await Promise.resolve();

  expect(captures).toEqual([{ name: "A", width: 40, hidden: true }]);
  expect(buffer.hidden).toBe(false);

  firstGate.resolve();
  await first;
  await Promise.resolve();

  expect(captures).toEqual([
    { name: "A", width: 40, hidden: true },
    { name: "C", width: 60, hidden: true },
  ]);
  expect(buffer.hidden).toBe(false);

  latestGate.resolve();
  await expect(stale).resolves.toBe("C");
  await expect(latest).resolves.toBe("C");
  expect(buffer).toEqual({ hidden: true, width: 60 });
});

test("a failed MDCUI rerender does not poison the next queued request", async () => {
  const buffer = {};
  const first = enqueueMdcuiRerender(buffer, async () => {
    throw new Error("render failed");
  });
  const second = enqueueMdcuiRerender(buffer, async () => "recovered");

  await expect(first).rejects.toThrow("render failed");
  await expect(second).resolves.toBe("recovered");
  await expect(enqueueMdcuiRerender(buffer, async () => "still healthy"))
    .resolves.toBe("still healthy");
});

test("a failed coalesced request rejects every waiter without poisoning later work", async () => {
  const buffer = {};
  const firstGate = deferred();
  const first = enqueueMdcuiRerender(buffer, () => firstGate.promise);
  const stale = enqueueMdcuiRerender(buffer, async () => "stale");
  const latest = enqueueMdcuiRerender(buffer, async () => {
    throw new Error("latest failed");
  });

  firstGate.resolve("first");
  const settled = await Promise.allSettled([first, stale, latest]);
  expect(settled[0]).toEqual({ status: "fulfilled", value: "first" });
  expect(settled[1].status).toBe("rejected");
  expect(settled[1].reason?.message).toBe("latest failed");
  expect(settled[2].status).toBe("rejected");
  expect(settled[2].reason?.message).toBe("latest failed");
  await expect(enqueueMdcuiRerender(buffer, async () => "recovered"))
    .resolves.toBe("recovered");
});

test("the idle barrier waits through the latest coalesced rerender", async () => {
  const buffer = {};
  const firstGate = deferred();
  const latestGate = deferred();
  const order = [];

  const first = enqueueMdcuiRerender(buffer, async () => {
    order.push("first-start");
    await firstGate.promise;
    order.push("first-end");
  });
  const stale = enqueueMdcuiRerender(buffer, async () => {
    order.push("stale");
  });
  const latest = enqueueMdcuiRerender(buffer, async () => {
    order.push("latest-start");
    await latestGate.promise;
    order.push("latest-end");
  });
  const idle = waitForMdcuiRerenders(buffer).then(() => {
    order.push("input");
  });

  await Promise.resolve();
  expect(order).toEqual(["first-start"]);
  firstGate.resolve();
  await first;
  await Promise.resolve();
  expect(order).toEqual(["first-start", "first-end", "latest-start"]);

  latestGate.resolve();
  await Promise.all([stale, latest, idle]);
  expect(order).toEqual([
    "first-start",
    "first-end",
    "latest-start",
    "latest-end",
    "input",
  ]);
});
