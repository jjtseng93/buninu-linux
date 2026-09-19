#!/bin/sh

if [ -f /proc/$$/cmdline ] ; then
  args=$(tr '\0' '\n' < /proc/$$/cmdline)
  caller=$(printf '%s\n' "$args" | head -n 1)

  # Buninu Linux implements /bin/sh in Bun. Its interpreter chain makes the
  # first three cmdline entries /bin/bun, /bin/sh, and the invoked launcher;
  # Android's native loader instead keeps the launcher in the first entry.
  # Match only the exact Buninu chain so the existing Android and conventional
  # Linux paths retain their current behaviour.
  second=$(printf '%s\n' "$args" | head -n 2 | tail -n 1)
  if [ "$caller" = /bin/bun ] && [ "$second" = /bin/sh ] ; then
    caller=$(printf '%s\n' "$args" | head -n 3 | tail -n 1)
  fi

  callerb=$(basename "$caller")
else
  callerb=$(basename "$0")
fi

if [ "$callerb" = sh ] ; then
  callerb=$(basename "$0")
fi

sd=$(dirname "$(realpath "$0")")

prog_base=$sd/../apps/$callerb/$callerb

# echo $prog_base

if [ -f "$sd/$callerb.sh" ] ; then
  exec /bin/sh "$sd/$callerb.sh" "$@"
elif [ -f "$prog_base".sh ] ; then
  exec /bin/sh "$prog_base".sh "$@"
elif [ -f "$prog_base".js ] ; then
  exec bun "$prog_base".js "$@"
elif [ -f "$prog_base".mjs ] ; then
  exec bun "$prog_base".mjs "$@"
elif [ -f "$prog_base".ts ] ; then
  exec bun "$prog_base".ts "$@"
elif [ -f "$prog_base".mts ] ; then
  exec bun "$prog_base".mts "$@"
fi

exit 127

realscript="$PKG_RDIR"/bin/"$callerb.sh"
realjs="$PKG_RDIR"/bin/"$callerb.js"
realmjs="$PKG_RDIR"/bin/"$callerb.mjs"
realtool="$PKG_RDIR/$callerb"

jtool_list="
javac
javap
javadoc
jcmd
jar
jarsigner
jconsole
jdb
jdeprscan
jdeps
jhsdb
jimage
jinfo
jlink
jmap
jmod
jpackage
jps
jshell
jstack
jstat
jstatd
serialver
jfr
jrunscript
keytool
rmiregistry
"
 
if [ -f "$realscript" ] ; then
  exec sh "$realscript" "$@"
elif [ -f "$realjs" ] ; then
  exec sh "$shr" node "$realjs" "$@"
elif [ -f "$realmjs" ] ; then
  exec sh "$shr" node "$realmjs" "$@"
elif [ "$callerb" = "run" ] ; then
  exec sh "$shr" "$@"
elif [ -d "$realtool" ] ; then
  exec sh "$shr" "$callerb" "$@"
elif [ -f "$PKG_RDIR"/bin/java.sh ] &&
    echo "$jtool_list" | grep -q "^$callerb$" ; then
  exec sh "$PKG_RDIR"/bin/java.sh --tool-name "$callerb" "$@"
else
  exec sh "$shr" pkg run "$callerb" "$@"
fi


export ANCI_SCRIPT_LOADER_PATH=""

exec "$PKG_RDIR"/bin/shloader
