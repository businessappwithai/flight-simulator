#!/usr/bin/env bash
set -euo pipefail
python3 scripts/static-check.py
bun run typecheck
bun test
bun run audit
bun run audit:deps
echo "release checks complete"
