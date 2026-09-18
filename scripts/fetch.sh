# Sourced by fetch-alpine.sh and fetch-bun.sh; not executable on its own.
#
# fetch <url> <name> <sha256>
#
# Downloads to downloads/<name>, unless a file with that exact SHA-256 is
# already sitting there. The hash is both the cache key and the integrity
# check, so there is no weaker "file exists" path: a truncated, stale or
# tampered file fails the first comparison, gets fetched again, and still has
# to pass the second one before any script extracts from it.
#
# Re-running the pinned build therefore costs no network at all, while bumping
# a version (which changes both the name and the hash) always refetches.
fetch() {
    local url=$1 name=$2 sha=$3
    local path="downloads/$name"

    if [ -f "$path" ] && printf '%s  %s\n' "$sha" "$path" | sha256sum --check --status; then
        echo "cached $name"
        return
    fi

    echo "fetch  $name"
    curl -fL "$url" -o "$path"
    # --quiet prints only failures; a mismatch exits non-zero under `set -e`.
    printf '%s  %s\n' "$sha" "$path" | sha256sum --check --quiet
}
