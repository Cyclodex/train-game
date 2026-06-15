#!/bin/bash
# SessionStart hook: install dependencies so the eval loop (build + unit tests +
# lint) is runnable in Claude Code on the web sessions, which start from a fresh
# container with no node_modules. Sync mode: the session waits until deps are
# ready, so the agent never tries to build/test before they exist.
set -euo pipefail

# Web/remote sessions only — local sessions manage their own node_modules.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

# Idempotent: skip the install when node_modules is already populated (e.g. on
# resume), otherwise install. `.npmrc` sets ignore-scripts, so Playwright's
# browser is not fetched here — run `npx playwright install chromium` before
# `npm run test:e2e` if you need the browser.
if [ ! -d node_modules ] || [ -z "$(ls -A node_modules 2>/dev/null)" ]; then
  npm install
fi
