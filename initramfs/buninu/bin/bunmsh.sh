#!/bin/sh

sd=$(dirname "$(realpath "$0")")

exec bun "$sd"/../apps/bunmsh/bunmsh "$@"
