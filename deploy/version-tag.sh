#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./deploy/version-tag.sh <version> "<description>" [--push]

Examples:
  ./deploy/version-tag.sh v0.8.45 "fix(ui): sticky menu across all tabs"
  ./deploy/version-tag.sh v0.8.45 "release: nagstamon acknowledged bridge" --push

Notes:
- Run this AFTER committing code changes.
- Creates an annotated Git tag for easy rollback.
- Optional --push will push the tag to origin.
EOF
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 2 || $# -gt 3 ]]; then
  usage
  exit 1
fi

VERSION="$1"
DESCRIPTION="$2"
PUSH_FLAG="${3:-}"

if [[ ! "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: version must follow SemVer tag format like v0.8.45"
  exit 1
fi

if [[ -n "$PUSH_FLAG" && "$PUSH_FLAG" != "--push" ]]; then
  echo "Error: unsupported option '$PUSH_FLAG'. Only --push is allowed."
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Error: this script must run inside a git repository"
  exit 1
fi

if git rev-parse "$VERSION" >/dev/null 2>&1; then
  echo "Error: tag $VERSION already exists"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working tree is not clean. Commit/stash changes before tagging."
  exit 1
fi

TAG_MESSAGE="$VERSION - $DESCRIPTION"
git tag -a "$VERSION" -m "$TAG_MESSAGE"

echo "Created annotated tag: $VERSION"

git show --no-patch --pretty=fuller "$VERSION"

if [[ "$PUSH_FLAG" == "--push" ]]; then
  git push origin "$VERSION"
  echo "Pushed tag to origin: $VERSION"
else
  echo "Tag created locally. Push when ready: git push origin $VERSION"
fi
