#!/usr/bin/env bash
# Reinitialise les donnees de la demo : DEMO_RESET_ON_START=1 efface et re-remplit la base a chaque demarrage.
# A planifier chaque nuit (voir deploy/DEPLOY.md).
set -euo pipefail
cd "$(dirname "$0")"
docker compose -f docker-compose.demo.yml restart nexus
echo "$(date -Is) demo reinitialisee"
