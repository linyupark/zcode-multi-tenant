#!/usr/bin/env bash
# update-kernel.sh — zcode portal kernel updater (wrapper)
#
# Thin wrapper around scripts/update-kernel.mjs, where all real logic lives
# (CDN manifest probe + sha256 verify + atomic swap + backups).
#
# Usage:
#   bash update-kernel.sh check        # show current / latest available version
#   bash update-kernel.sh update       # upgrade from official CDN
#   bash update-kernel.sh desktop      # copy from local ZCode desktop install
#   bash update-kernel.sh manual       # stage kernel/.staging as candidate
#   bash update-kernel.sh rollback     # restore the previous kernel backup
#   bash update-kernel.sh <mjs flags>  # passed verbatim, e.g.
#                                      #   --source manual --commit
#                                      #   --desktop "C:/Program Files/ZCode/resources/glm"
set -eu
cd "$(dirname "$0")"

MJS=scripts/update-kernel.mjs

command -v node >/dev/null 2>&1 || {
  echo "[update-kernel] ERROR: node not found in PATH (Node >= 22 recommended)" >&2
  exit 1
}

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "[update-kernel] WARN: Node >= 18 required (22 recommended), found major=$NODE_MAJOR" >&2
fi

usage() {
  echo "usage: bash update-kernel.sh check|update|desktop|manual|rollback|<mjs flags>"
}

if [ $# -eq 0 ]; then
  usage
  exit 0
fi

case "$1" in
  check)      shift; exec node "$MJS" --check "$@" ;;
  update|cdn) shift; exec node "$MJS" --source cdn "$@" ;;
  desktop)    shift; exec node "$MJS" --source desktop "$@" ;;
  manual)     shift; exec node "$MJS" --source manual "$@" ;;
  rollback)   shift; exec node "$MJS" --rollback "$@" ;;
  -*)         exec node "$MJS" "$@" ;;
  *)          echo "[update-kernel] unknown command: $1" >&2; usage; exit 1 ;;
esac
