#!/bin/sh

sd=$(dirname "$(realpath "$0")")
root=$sd/..

bun "$root"/apps/jsmdcui/src/index.js --cat "$root"/README.md
exec bun "$root"/apps/jsgotty/gotty.js --viu "$root"/icon.png
