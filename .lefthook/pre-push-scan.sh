#!/usr/bin/env bash
# Scans each pushed commit's files and unpushed diffs, so a secret added then removed is still caught.
set -uo pipefail

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# git sends "<local ref> <local sha> <remote ref> <remote sha>" per pushed ref; none when run by hand.
shas=()
if [ ! -t 0 ]; then
  while read -r _ sha _ _; do
    [ -n "$sha" ] && [ "$sha" != "0000000000000000000000000000000000000000" ] && shas+=("$sha")
  done
fi
[ ${#shas[@]} -eq 0 ] && shas=(HEAD)

for i in "${!shas[@]}"; do
  dir="$tmp/scan/$i"
  mkdir -p "$dir"
  git archive "${shas[$i]}" | tar -x -C "$dir"
  git log -p --no-color "${shas[$i]}" --not --remotes > "$dir/unpushed-history.patch"
done

bash "$(git rev-parse --show-toplevel)/scripts/scan.sh" "$tmp/scan" "Pre-push scan"
