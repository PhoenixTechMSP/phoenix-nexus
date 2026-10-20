#!/usr/bin/env bash
# Scenarios navigateur reels (Chromium via Playwright) contre une base TEMPORAIRE :
# rien de ce qui est dans data/ n'est touche.
#
# Usage   : scripts/e2e/run.sh [cmdb|sam|crawl|core|demo|all]      (defaut : all)
# Prerequis (une fois) : npm run build
#                        pip install playwright && playwright install chromium
# Code de retour : 0 si toutes les verifications passent, 1 sinon (utilisable en CI).
set -uo pipefail
cd "$(dirname "$0")/../.."

SUITE="${1:-all}"
if [ "$SUITE" = "all" ]; then
  FAILED=0
  for s in cmdb sam crawl core demo; do
    echo; echo "################ suite : $s ################"
    "$0" "$s" || FAILED=$((FAILED + 1))
  done
  echo; echo "================ $FAILED suite(s) en echec sur 5 ================"
  [ "$FAILED" -eq 0 ]; exit $?
fi
case "$SUITE" in cmdb|sam|crawl|core|demo) ;; *) echo "usage: $0 [cmdb|sam|crawl|core|demo|all]" >&2; exit 2 ;; esac
[ -f dist/index.html ] || { echo "dist/ absent : lance d'abord 'npm run build'" >&2; exit 2; }
python3 -c "import playwright" 2>/dev/null || { echo "playwright manquant : pip install playwright && playwright install chromium" >&2; exit 2; }

WORK="$(mktemp -d)"
export DB_PATH="$WORK/e2e.db" JWT_SECRET="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" PORT="${E2E_PORT:-8199}" NODE_ENV=test
export E2E_SHOTS="$WORK/shots"; mkdir -p "$E2E_SHOTS"
export DEMO_PASSWORD=DemoPass2026   # mot de passe de TEST d une base jetable, sans rapport avec une vraie instance

# Donnees d'abord, serveur ensuite : reproduit une instance existante qui recoit les nouveaux modules.
node scripts/first-admin.js admin@test.local 'UiTest1234!' "Admin Test" >/dev/null
node scripts/e2e/make-users.mjs
case "$SUITE" in
  cmdb|sam) node scripts/seed-dummy-data.js >/dev/null; node scripts/seed-sam-demo.js >/dev/null ;;   # jeu minimal attendu par ces scenarios
  *)        node scripts/demo-setup.js >/dev/null ;;                                                   # historique, CMDB, relations, SAM
esac
[ "$SUITE" = "demo" ] && export DEMO_MODE=1

node server/index.js > "$WORK/server.log" 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -sf "http://localhost:$PORT/api/health" >/dev/null && break; sleep 0.5; done

STATUS=0
python3 "scripts/e2e/$SUITE.py" || STATUS=$?
echo "Captures d'ecran : $E2E_SHOTS"
exit $STATUS
