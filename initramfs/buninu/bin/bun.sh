#!/bin/sh

sd=$(dirname "$(realpath "$0")")

bunBinTgz=$sd/../apps/bun/bunBin.tgz

annl=androidNativeLibs

if [ -f /system/bin/linker64 ] ; then
  if [ -f "$sd"/$annl/libbun.so ] ; then
    exec "$sd"/$annl/libbun.so "$@"
  elif uname -m | grep -q aarch64 ; then
    bunBin="$sd"/bun-la
  else
    bunBin="$sd"/bun-lx
  fi
elif [ -d "$WINDIR" ] ; then
  bunBin="$sd"/bun-wx.exe
elif uname -m | grep -q aarch64 ; then
  bunBin="$sd"/bun-la
else
  bunBin="$sd"/bun-lx
fi


if [ -f "$bunBinTgz" ] &&
   [ "$bunBinTgz" -nt "$bunBin" ] ; then
  tar -xzvf "$bunBinTgz" -C "$sd"
fi

 
if [ -f "$bunBin" ] ; then
  exec "$bunBin" "$@"
fi

# The package bin directory can contain a `bun` symlink back to this script.
# Search PATH manually so that a system/user-installed Bun outside this
# directory can be used without recursively executing bun.sh again.
oldIFS=$IFS
IFS=:
for pathDir in ${PATH:-} ; do
  [ -n "$pathDir" ] || pathDir=.
  if [ "$(realpath "$pathDir" 2>/dev/null)" = "$sd" ] ; then
    continue
  fi

  for externalBun in "$pathDir/bun" "$pathDir/bun.exe" ; do
    if [ -f "$externalBun" ] && [ -x "$externalBun" ] ; then
      IFS=$oldIFS
      exec "$externalBun" "$@"
    fi
  done
done
IFS=$oldIFS

echo "Bun Binary not found: $bunBin (and no external Bun found in PATH)" >&2
exit 127
