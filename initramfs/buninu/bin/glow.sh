#!/bin/sh

sd=$(dirname "$(realpath "$0")")

exec bun "$sd"/../apps/jsmdcui/src/index.js --cat "$@"
