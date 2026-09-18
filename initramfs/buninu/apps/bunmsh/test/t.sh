#!/bin/sh

echo shell-before
Bun.version
Bun.e, Math.cos(1)

Bun.sha.var = { message: "shared", count: 1 }
Bun.sha.var.count += 1
Bun.sha.var
echo "from command substitution: $(Bun.sha.var.message)"

echo shell-after
