#!/bin/bash
# Round 3: query series_ticker directly to find game-level markets
# (bypasses the 2000-event pagination cap on keyword discovery).

: "${DASHBOARD_PASSWORD:?Set DASHBOARD_PASSWORD before running this script}"
BASE="http://localhost:8000/api/discover/events"

# Guesses for game-level series per sport
SERIES=(
  "KXNBAGAME"
  "KXNHLGAME"
  "KXMLBGAME"
  "KXNFLGAME"
  "KXUFCMATCH"
  "KXUFCFIGHT"
  "KXPGATOURNEY"
  "KXPGATOUR"
  "KXMLSGAME"
  "KXEPL"
  "KXUCL"
  "KXCFBGAME"
  "KXCBBGAME"
)

for st in "${SERIES[@]}"; do
  echo "=== series=$st ==="
  curl -s -H "x-dashboard-password: $DASHBOARD_PASSWORD" "${BASE}?series_ticker=${st}&limit=6" \
    | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception as e:
    print(f'  parse error: {e}')
    sys.exit(0)
print(f'  matched={d.get(\"match_count\")}')
for e in d.get('events', [])[:6]:
    et = (e.get('event_ticker') or '')[:40]
    title = (e.get('title') or '')[:60]
    sub = (e.get('sub_title') or '')[:40]
    print(f'  {et:<40} {title:<60} {sub}')
"
done
