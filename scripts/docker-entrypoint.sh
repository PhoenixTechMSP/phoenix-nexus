#!/bin/sh
# Point d'entree du conteneur.
# DEMO_MODE=1 : prepare d'abord la base de demonstration (reinitialisee si DEMO_RESET_ON_START=1), puis demarre.
# Hors demo : demarre directement le serveur.
set -e
if [ "${DEMO_MODE:-0}" = "1" ]; then
  node scripts/demo-setup.js
fi
# exec : node devient le processus principal et recoit directement SIGTERM (arret propre de docker stop).
exec node server/index.js
