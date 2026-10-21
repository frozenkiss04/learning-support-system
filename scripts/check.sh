#!/usr/bin/env bash
# check.sh — QA / integration baseline for learning-support-system.
#
# Hard checks (fail the script):
#   1. Backend Python sources compile:  python3 -m compileall backend/app
#   2. frontend/package.json is valid JSON (only when the file exists)
#
# Soft checks (warn only — other workers may still be writing these files):
#   3. Expected files exist; missing ones are listed, not treated as errors.
#
# Usage:  bash scripts/check.sh        (from anywhere; paths are repo-relative)

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

FAIL=0
WARN=0

echo "== Repo: $ROOT"
echo

echo "-- [1/3] Backend compile: python3 -m compileall backend/app"
if python3 -m compileall -q backend/app backend/wsgi.py; then
  echo "   PASS: backend compiles"
else
  echo "   FAIL: backend compile errors (see output above)"
  FAIL=$((FAIL + 1))
fi
echo

echo "-- [2/3] frontend/package.json validity"
if [ -f frontend/package.json ]; then
  if node -e "JSON.parse(require('fs').readFileSync('frontend/package.json','utf8')); console.log('   PASS: package.json is valid JSON')"; then
    :
  else
    echo "   FAIL: frontend/package.json is not valid JSON"
    FAIL=$((FAIL + 1))
  fi
else
  echo "   WARN: frontend/package.json not present yet (frontend worker in progress)"
  WARN=$((WARN + 1))
fi
echo

echo "-- [3/3] Expected files"
EXPECTED=(
  "backend/wsgi.py"
  "backend/requirements.txt"
  "backend/Dockerfile"
  "backend/.env.example"
  "backend/app/__init__.py"
  "backend/app/config.py"
  "backend/app/extensions.py"
  "backend/app/blueprints/auth.py"
  "backend/app/blueprints/courses.py"
  "backend/app/blueprints/progress.py"
  "backend/app/blueprints/admin.py"
  "backend/app/blueprints/ai_chat.py"
  "backend/app/blueprints/health.py"
  "backend/app/models/user.py"
  "backend/app/models/course.py"
  "backend/app/models/learning.py"
  "backend/app/models/chat.py"
  "backend/app/services/ai_service.py"
  "backend/app/services/progress_service.py"
  "frontend/package.json"
  "frontend/index.html"
  "frontend/vite.config.js"
  "frontend/tailwind.config.js"
  "frontend/postcss.config.js"
  "frontend/vercel.json"
  "frontend/.env.example"
  "frontend/src/main.jsx"
  "frontend/src/App.jsx"
  "frontend/src/index.css"
  "frontend/src/lib/api.js"
)
for f in "${EXPECTED[@]}"; do
  if [ -f "$f" ]; then
    echo "   OK      $f"
  else
    echo "   MISSING $f"
    WARN=$((WARN + 1))
  fi
done
echo

echo "== Summary: FAIL=$FAIL WARN=$WARN"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
echo "Baseline OK (warnings above are pending work from other workers, not failures)."
exit 0
