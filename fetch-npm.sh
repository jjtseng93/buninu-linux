#!/usr/bin/env bash
set -euo pipefail
umask 022
cd "$(dirname "$0")"

# These application tarballs are architecture-independent. Do not install,
# extract, or run npm lifecycle scripts here; pack-time layout comes later.
downloads_dir="$PWD/downloads/npm"
. ./scripts/fetch.sh

# Fixed three-line YAML blocks, not shell code: never source or eval them.
header='^"((@[a-z0-9._-]+/)?[a-z0-9._-]+)@([0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?)":$'
source='^  - (https://registry\.npmjs\.org/[^[:space:]"#]+\.tgz)$'
digest='^  - sha256:([a-f0-9]{64})$'
invalid() { echo "error: invalid or duplicate npm pin: $line" >&2; exit 1; }
state=0
seen='|'
archives=() urls=() hashes=()
while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    [[ "$line" =~ ^[[:space:]]*$ || "$line" == \#* ]] && continue
    case "$state" in
        0)
            [[ "$line" =~ $header ]] || invalid
            name=${BASH_REMATCH[1]} version=${BASH_REMATCH[3]}
            archive=${name#@}
            archive=${archive/\//-}-$version.tgz
            [[ "$seen" != *"|$archive|"* ]] || invalid
            seen="$seen$archive|"
            state=1 ;;
        1)
            [[ "$line" =~ $source ]] || invalid
            url=${BASH_REMATCH[1]}
            state=2 ;;
        2)
            [[ "$line" =~ $digest ]] || invalid
            archives+=("$archive") urls+=("$url") hashes+=("${BASH_REMATCH[1]}")
            state=0 ;;
    esac
done < scripts/npm-packages.md
[[ "$state" == 0 && ${#archives[@]} -gt 0 ]] || invalid
for ((i=0; i<${#archives[@]}; i++)); do
    fetch "${urls[i]}" "${archives[i]}" "${hashes[i]}"
done
