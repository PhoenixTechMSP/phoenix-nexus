#!/usr/bin/env bash
# Met a jour l'instance de demo : recupere le code, reconstruit, redemarre. Lance depuis le serveur.
set -euo pipefail
cd "$(dirname "$0")"
if [ -d ../.git ]; then
  git -C .. pull --ff-only
else
  echo "Pas de depot git ici (dossier copie par rsync) : pas de 'git pull', reconstruction du code present."
fi
docker compose -f docker-compose.demo.yml up -d --build
docker compose -f docker-compose.demo.yml ps
DOMAIN="$(grep -E '^DOMAIN=' .env | cut -d= -f2-)"
echo
echo "Deploiement lance. Verifiez-le depuis VOTRE poste (pas depuis le serveur) :"
echo "  node scripts/smoke.mjs https://${DOMAIN}"
