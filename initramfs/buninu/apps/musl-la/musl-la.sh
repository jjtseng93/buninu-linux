#!/bin/sh

sd=$(dirname "$(realpath "$0")")

muslbin=$sd/../../bin/androidNativeLibs/libld-musl.so

if [ ! -f "$muslbin" ] ; then
  muslbin=$sd/ld-musl-aarch64.so.1
fi

use_env=
if [ "$1" = -e ] ; then
  shift
  use_env=1
fi

elfdir=
for arg do
  if [ -f "$arg" ] ; then
    elf_magic=$(od -A n -t x1 -N 4 "$arg" 2>/dev/null | tr -d '[:space:]')
    if [ "$elf_magic" = 7f454c46 ] ; then
      elfdir=$(dirname "$(realpath "$arg")")
      break
    fi
  fi
done

library_path=$sd${elfdir:+:$elfdir}${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}

if [ "$use_env" = 1 ] ; then
  LD_LIBRARY_PATH=$library_path
  export LD_LIBRARY_PATH
  exec "$muslbin" "$@"
fi

exec "$muslbin" --library-path "$library_path" "$@"
