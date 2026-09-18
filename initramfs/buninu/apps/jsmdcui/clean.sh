#!/bin/sh

sd=$(dirname "$0")

rm "$sd"/*.md.* "$sd"/*.md-* 2>/dev/null
rm "$sd"/demos/*.md.* "$sd"/demos/*.md-* 2>/dev/null
rm "$sd"/tests/*.md.* "$sd"/tests/*.md-* 2>/dev/null

echo "Removed all *.md.* *.md-* from repo root and demos/ folder"
