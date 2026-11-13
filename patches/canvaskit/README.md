# CanvasKit loader patch

`initramfs/lib/canvaskit/canvaskit.js` differs from `canvaskit-wasm@0.41.1`'s
`package/bin/canvaskit.js`; the change dates from the original graphics bring-up (commit `a74ac0a`).
`wasm-binary.patch` records it: honor an explicitly supplied `wasmBinary`
before fetch and bypass streaming instantiation when those bytes are supplied.
This lets Bun load the separately distributed WASM without relying on browser
fetch behavior. Patch paths are relative to `initramfs/lib/canvaskit`. The patch is
documentation only; users do not apply patches or build anything.

SHA-256:

- Official JS: `1336e9130e2b7644cb1b36562e720efdf61fbca4dc048e040aaf2de0872fb999`
- Distributed JS: `d8ed15482165988891938e2ecada05fad51ac1a79a4ae302cb3a8f3bff87f4e1`
- Official and distributed WASM: `bd669c88bd033eaf62d673103a42231a737c6d12e4cc99f8548b2784b5772430`

Verify: apply the patch to the official JS and compare with the distributed file.

```sh
curl -sL https://registry.npmjs.org/canvaskit-wasm/-/canvaskit-wasm-0.41.1.tgz | tar xz package/bin/canvaskit.js
patch -s package/bin/canvaskit.js < patches/canvaskit/wasm-binary.patch
cmp package/bin/canvaskit.js initramfs/lib/canvaskit/canvaskit.js
```
