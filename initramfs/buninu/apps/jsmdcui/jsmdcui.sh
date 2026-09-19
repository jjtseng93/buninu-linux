#!/bin/sh

sd=$(dirname "$(realpath "$0")")

for arg; do
  if [ "${arg%.md}" != "$arg" ] ||
    [ "${arg%.mD}" != "$arg" ] ||
    [ "${arg%.Md}" != "$arg" ] ||
    [ "${arg%.MD}" != "$arg" ] ||
    [ "${arg#--demo}" != "$arg" ] ||
    [ "$arg" = --cdp-maze ]; then
    exec bun "$sd"/src/index.js --mdcui "$@"
  fi
done

exec bun "$sd"/src/index.js "$@"
