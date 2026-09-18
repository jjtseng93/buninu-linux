#!/bin/sh

sd=$(dirname "$(realpath "$0")")

for arg do
  case "$arg" in
    *.[mM][dD]|--demo*|--cdp-maze) exec bun "$sd"/src/index.js --mdcui "$@" ;;
  esac
done

exec bun "$sd"/src/index.js "$@"
