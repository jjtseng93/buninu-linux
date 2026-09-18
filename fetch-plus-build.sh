#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

./fetch-alpine.sh
./fetch-bun.sh
./build-uki.sh
./build-image.sh

echo "Buninu Linux image is ready: vda.img. Run stage: ./index.js -r (run-qemu.sh) in native Termux."
