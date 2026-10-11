#!/usr/bin/env bash
# Shell pack counterpart: the Docker toolchain intentionally needs no host Bun.
set -euo pipefail
umask 022
cd "$(dirname "$0")/.."
staging=${1:?usage: stage-npm.sh STAGING_DIRECTORY}
lib="$staging/usr/lib"
[[ ! -e "$lib/package.json" && ! -e "$lib/node_modules" ]] || {
    echo 'error: npm staging destination already exists' >&2; exit 1;
}
header='^"((@[a-z0-9._-]+/)?[a-z0-9._-]+)@([0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?)":$'
source='^  - https://registry\.npmjs\.org/[^[:space:]"#]+\.tgz$'
digest='^  - sha256:([a-f0-9]{64})$'
invalid() { echo "error: invalid npm pin: $line" >&2; exit 1; }
state=0
names=() versions=() archives=() hashes=()
seen='|'
while IFS= read -r line || [[ -n "$line" ]]; do
    line=${line%$'\r'}
    [[ "$line" =~ ^[[:space:]]*$ || "$line" == \#* ]] && continue
    case "$state" in
        0)
            [[ "$line" =~ $header ]] || invalid
            name=${BASH_REMATCH[1]} version=${BASH_REMATCH[3]}
            [[ "$seen" != *"|$name|"* ]] || invalid
            seen="$seen$name|"
            archive=${name#@}; archive=${archive/\//-}-$version.tgz
            state=1 ;;
        1) [[ "$line" =~ $source ]] || invalid; state=2 ;;
        2)
            [[ "$line" =~ $digest ]] || invalid
            names+=("$name") versions+=("$version") archives+=("$archive") hashes+=("${BASH_REMATCH[1]}")
            state=0 ;;
    esac
done < scripts/npm-packages.md
[[ "$state" == 0 && ${#names[@]} -gt 0 ]] || invalid
for ((i=0; i<${#names[@]}; i++)); do
    printf '%s  %s\n' "${hashes[i]}" "downloads/npm/${archives[i]}" | sha256sum -c -
done
mkdir -p "$lib/node_modules/.bin"
for ((i=0; i<${#names[@]}; i++)); do
    name=${names[i]}
    destination="$lib/node_modules/$name"
    mkdir -p "$destination"
    extra=()
    [[ "$name" != buninu-browser ]] || extra+=(--exclude=package/usr/lib/canvaskit --exclude=package/usr/share/fonts)
    tar -xf "downloads/npm/${archives[i]}" -C "$destination" --strip-components=1 "${extra[@]}"
    # Bin entries of the four SHA-pinned packages; no package scripts execute.
    bin=${name##*/}; entry=index.js
    [[ "$name" != @drxiaozhi/jspulse ]] || entry=jspulse.js
    chmod 755 "$destination/$entry"
    ln -s "../$name/$entry" "$lib/node_modules/.bin/$bin"
done
{
    printf '{\n  "name": "buninu-system-apps",\n  "private": true,\n  "dependencies": {\n'
    for ((i=0; i<${#names[@]}; i++)); do
        comma=,
        [[ "$i" != "$((${#names[@]} - 1))" ]] || comma=''
        printf '    "%s": "%s"%s\n' "${names[i]}" "${versions[i]}" "$comma"
    done
    printf '  }\n}\n'
} > "$lib/package.json"
