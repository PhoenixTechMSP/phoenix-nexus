# Deploiement continu : poste -> UAT -> production

```
poste local --push--> branche develop --> tests --> image Docker (ghcr.io) --> UAT        (automatique)
                      merge develop -> main --> tests --> image --> [votre clic] --> PRODUCTION
```

- Une seule image est construite par commit (tag `sha-<12 caracteres>`), testee, puis deployee telle quelle. Ce qui a ete valide en UAT est ce qui part en production.
- Apres chaque deploiement : `scripts/smoke.mjs` sur l'URL publique. S'il echoue, retour automatique a l'image precedente.
- Si le conteneur ne devient pas `healthy` : retour automatique aussi.

## Mise en place (une fois par serveur : UAT et production)

1. Creer le serveur (Ubuntu 24.04), pointer le DNS (`uat.` ou `demo.`) vers son IP.
2. Generer une cle SSH DEDIEE au pipeline : `ssh-keygen -t ed25519 -f nexus-deploy -C pipeline -N ""`
3. Sur le serveur, en root : `bash bootstrap-vps.sh "$(cat nexus-deploy.pub)"` (copier le script avec scp).
4. Creer `/opt/nexus/deploy/.env` sur le serveur (modele : `deploy/.env.demo.example`) : DOMAIN, ACME_EMAIL, JWT_SECRET (`openssl rand -hex 32`), DEMO_PASSWORD. Ce fichier ne quitte jamais le serveur.
5. Dans GitHub : Settings > Environments > `uat` et `production`.
   - Variables : `DEPLOY_HOST` (IP ou nom), `DEPLOY_USER` (= `deploy`), `DEPLOY_URL` (ex. `https://demo.phoenix-tech.be`)
   - Secrets : `DEPLOY_SSH_KEY` (contenu de `nexus-deploy`), `DEPLOY_KNOWN_HOSTS` (sortie de `ssh-keyscan -t ed25519 <ip>`, a comparer avec l'empreinte affichee dans la console du fournisseur)
   - `production` : cocher "Required reviewers" et vous ajouter. Le deploiement attend alors votre validation.
6. Activer le deploiement : Settings > Secrets and variables > Actions > Variables > `DEPLOY_ENABLED` = `true` (tant qu'elle n'existe pas, la CI teste et construit l'image mais ne deploie rien).
7. Creer la branche `develop` : `git checkout -b develop && git push -u origin develop`

## Au quotidien

- Travailler sur `develop` (ou une branche + pull request vers `develop`). Push = tests + deploiement UAT.
- Verifier en UAT. Puis pull request `develop` -> `main`, merge, valider le deploiement dans l'onglet Actions.
- Retour arriere manuel : `ssh deploy@<serveur> "bash /opt/nexus/deploy/remote-deploy.sh rollback"`

## Securite

- Le jeton GitHub du pipeline n'est jamais stocke sur le serveur : il sert a tirer l'image puis la session Docker est fermee.
- L'hote SSH est verifie (`known_hosts` epingle) : pas de confiance au premier contact.
- La cle `deploy` donne l'acces Docker, donc equivalent root sur CE serveur : la dedier au pipeline, ne jamais la reutiliser.
- Branches `main` et `develop` : activer la protection (Settings > Branches) pour exiger la CI verte avant merge.
