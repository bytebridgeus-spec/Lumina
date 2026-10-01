#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Static quality gate — thin wrapper.
#
#   ./tools/audit.sh          # human-readable report
#   ./tools/audit.sh --quiet  # exit code only
#
# The checks themselves live in tools/audit.mjs. They moved out of bash because
# grep over raw source cannot tell an <img> in markup from the word <img> in a
# comment explaining why there is no image primitive, and cannot see that a
# label= prop sits five lines below its <IconButton. The bash version reported
# 60 false positives on a clean tree; a gate that cries wolf is worse than none.
# ---------------------------------------------------------------------------
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
exec node tools/audit.mjs "$@"
