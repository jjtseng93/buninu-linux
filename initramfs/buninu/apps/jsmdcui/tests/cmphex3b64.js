import { randomBytes } from "node:crypto";
import {
  decodeBinaryStrict,
  encodeBinary,
} from "../src/buffer/fixed3-codec.js";

const SIZES = [1024, 64 * 1024, 1024 * 1024];
const ITERATIONS = {
  1024: 20_000,
  [64 * 1024]: 2_000,
  [1024 * 1024]: 200,
};

function makeRandom(size) {
  return randomBytes(size);
}

function makeAscii(size) {
  const buf = Buffer.allocUnsafe(size);
  for (let i = 0; i < size; i++) {
    buf[i] = 0x20 + (i % 95);
  }
  return buf;
}

function mbps(bytes, ns) {
  return (bytes / (1024 * 1024)) / (Number(ns) / 1e9);
}

function bench(name, fn, iters, payloadSize) {
  const warmup = Math.min(200, Math.max(20, Math.floor(iters / 20)));
  for (let i = 0; i < warmup; i++) fn();

  const start = process.hrtime.bigint();
  let sink = 0;
  for (let i = 0; i < iters; i++) {
    sink ^= fn();
  }
  const elapsed = process.hrtime.bigint() - start;

  return {
    name,
    iters,
    ms: Number(elapsed) / 1e6,
    mbps: mbps(payloadSize * iters, elapsed),
    sink,
  };
}

function runCase(label, input) {
  const fixedEncoded = encodeBinary(input);
  const base64Encoded = input.toString("base64");

  if (!decodeBinaryStrict(fixedEncoded).equals(input)) {
    throw new Error(`hex3 roundtrip failed for ${label}`);
  }
  if (!Buffer.from(base64Encoded, "base64").equals(input)) {
    throw new Error(`base64 roundtrip failed for ${label}`);
  }

  const iters = ITERATIONS[input.length] ?? Math.max(50, Math.floor(100 * 1024 * 1024 / input.length));

  const results = [
    bench(
      "hex3 encode+decode",
      () => {
        const encoded = encodeBinary(input);
        return decodeBinaryStrict(encoded).length;
      },
      iters,
      input.length,
    ),
    bench(
      "base64 encode+decode",
      () => {
        const encoded = input.toString("base64");
        return Buffer.from(encoded, "base64").length;
      },
      iters,
      input.length,
    ),
  ];

  console.log(`\n${label} (${input.length.toLocaleString()} bytes, ${iters.toLocaleString()} iterations)`);
  for (const r of results) {
    console.log(
      `${r.name.padEnd(22)} ${r.ms.toFixed(1).padStart(10)} ms  ${r.mbps.toFixed(1).padStart(8)} MiB/s  sink=${r.sink}`,
    );
  }
}

for (const size of SIZES) {
  runCase("random", makeRandom(size));
  runCase("ascii", makeAscii(size));
}
