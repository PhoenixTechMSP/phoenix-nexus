#!/usr/bin/env bash
# Cree les labels du depot. Necessite gh (GitHub CLI) authentifie. Idempotent.
set -euo pipefail
R="${1:-PhoenixTechMSP/phoenix-nexus}"
mk() { gh label create "$1" --color "$2" --description "$3" --repo "$R" --force; }
mk "good first issue" 7057ff "Bon point de depart pour un nouveau contributeur"
mk "help wanted" 008672 "Aide bienvenue"
mk "bug" d73a4a "Quelque chose ne fonctionne pas"
mk "enhancement" a2eeef "Nouvelle fonctionnalite ou amelioration"
mk "documentation" 0075ca "Documentation"
mk "security" b60205 "Lie a la securite (les failles vont par SECURITY.md)"
mk "needs-repro" fbca04 "Etapes de reproduction manquantes"
mk "windows" 5319e7 "Specifique a Windows (agent, scanner)"
echo "Labels crees sur $R"
