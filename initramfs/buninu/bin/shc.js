#!/usr/bin/env bun

process.exit(await Bun.spawn(process.argv.slice(2), {
  stdio: [0, 1, 2],
}).exited);
