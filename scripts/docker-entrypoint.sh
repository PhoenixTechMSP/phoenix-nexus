#!/bin/sh
# Point d'entree du conteneur : demarre sans aucune configuration obligatoire.
#   - JWT_SECRET absent : un secret fort est genere une fois et conserve dans le volume de donnees (/data/.jwt_secret).
#   - Premier demarrage, base vide : cree le compte admin (voir scripts/bootstrap.js).
#   - SEED_SAMPLE=1 : charge des donnees d'exemple fictives (sans comptes publics, sans mode demo).
#   - DEMO_MODE=1 : instance de demonstration publique (voir scripts/demo-setup.js).
set -e

DATA_DIR="$(dirname "${DB_PATH:-/data/ptx.db}")"
mkdir -p "$DATA_DIR"

if [ -z "${JWT_SECRET:-}" ]; then
  SECRET_FILE="$DATA_DIR/.jwt_secret"
  if [ ! -s "$SECRET_FILE" ]; then
    ( umask 077; node scripts/gen-secret.js > "$SECRET_FILE" )
    echo "[init] JWT_SECRET genere et conserve dans $SECRET_FILE"
  fi
  JWT_SECRET="$(cat "$SECRET_FILE")"
  export JWT_SECRET
fi

if [ "${DEMO_MODE:-0}" = "1" ]; then
  node scripts/demo-setup.js
else
  node scripts/bootstrap.js
  if [ "${SEED_SAMPLE:-0}" = "1" ]; then
    SAMPLE_ONLY=1 node scripts/demo-setup.js
  fi
fi

# exec : node devient le processus principal et recoit directement SIGTERM (arret propre de docker stop).
exec node server/index.js
