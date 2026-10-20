#!/usr/bin/env bash
# Execute SUR LE SERVEUR par le pipeline (ou a la main) :
#   bash remote-deploy.sh ghcr.io/org/phoenix-nexus:sha-0123456789ab   deploie cette image
#   bash remote-deploy.sh rollback                                      revient a l'image precedente
# Si le conteneur ne devient pas "healthy" : retour automatique a l'image precedente.
set -euo pipefail
cd "$(dirname "$0")"
ARG="${1:?usage : remote-deploy.sh <image>|rollback}"
# COMPOSE_FILE : docker-compose.demo.yml (instance de demonstration publique, defaut) ou docker-compose.prod.yml.
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.demo.yml}"
[[ "$COMPOSE_FILE" =~ ^docker-compose\.(demo|prod)\.yml$ ]] || { echo "COMPOSE_FILE refuse : $COMPOSE_FILE" >&2; exit 2; }
COMPOSE=(docker compose -f "$COMPOSE_FILE")

if [ "$ARG" = "rollback" ]; then
  [ -s .previous-image ] || { echo "Aucune image precedente connue : rien a restaurer." >&2; exit 1; }
  ARG="$(cat .previous-image)"
  echo "Retour a l'image precedente : $ARG"
fi
[[ "$ARG" =~ ^ghcr\.io/[a-z0-9._/-]+:[A-Za-z0-9._-]+$ ]] || { echo "Reference d'image refusee : $ARG" >&2; exit 2; }
[ -f .env ] || { echo "deploy/.env absent sur le serveur (voir deploy/CICD.md)." >&2; exit 2; }

if [ -n "${GHCR_USER:-}" ]; then
  read -r GHCR_TOKEN
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null
  trap 'docker logout ghcr.io >/dev/null 2>&1 || true' EXIT
fi

PREV="$(cat .current-image 2>/dev/null || true)"
export NEXUS_IMAGE="$ARG"
echo "Deploiement de $NEXUS_IMAGE (precedent : ${PREV:-aucun})"
"${COMPOSE[@]}" pull nexus
if "${COMPOSE[@]}" up -d --no-build --remove-orphans --wait --wait-timeout 120; then
  if [ "$PREV" != "$ARG" ] && [ -n "$PREV" ]; then echo "$PREV" > .previous-image; fi
  echo "$ARG" > .current-image
  docker image prune -f >/dev/null
  echo "OK : $ARG est en ligne et healthy."
else
  echo "ECHEC : le conteneur n'est pas healthy. Journaux :" >&2
  "${COMPOSE[@]}" logs --tail 40 nexus >&2 || true
  if [ -n "$PREV" ] && [ "$PREV" != "$ARG" ]; then
    echo "Retour automatique a $PREV" >&2
    NEXUS_IMAGE="$PREV" "${COMPOSE[@]}" up -d --no-build --remove-orphans --wait --wait-timeout 120 || true
  fi
  exit 1
fi
