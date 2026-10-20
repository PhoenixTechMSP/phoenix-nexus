# Installation Windows en un clic

Pour un poste Windows 10/11 ou un Windows Server, sans connaissance technique.

## Procédure

1. Décompresser l'archive dans un dossier définitif (ex. `C:\phoenix-nexus`).
2. Clic droit sur **`INSTALL-WINDOWS.bat`** → **Exécuter en tant qu'administrateur**.
3. Répondre **O** à la question « Installer comme service Windows ? ».
4. Le navigateur s'ouvre sur <http://localhost:8080>.

Identifiants créés automatiquement :

```text
admin@company.local  /  Admin123!
```

**À changer immédiatement** après la première connexion (Admin → Users).

## Ce que le script fait automatiquement

| Étape | Détail |
|-------|--------|
| Élévation | Se relance en administrateur si nécessaire |
| Gestionnaire de paquets | Utilise `winget` (préinstallé sur Win11) sinon installe **Chocolatey** |
| Node.js | Installe Node.js 20 LTS si absent ou trop ancien |
| Dépendances | `npm install` (+ VS Build Tools et Python **uniquement en cas d'échec**) |
| Configuration | Crée `.env` avec un `JWT_SECRET` aléatoire de 32 octets |
| Interface | `npm run build` |
| Compte admin | Crée l'administrateur initial |
| Service | Installe **NSSM** et enregistre le service `PTXFleet` en démarrage automatique |
| Pare-feu | Ouvre le port TCP 8080 sur les profils Privé / Domaine (pas Public) |

Journal complet : `install-log.txt` à la racine du dossier.

## Accès depuis le réseau (LAN)

L'adresse réseau est affichée en fin d'installation, par ex. `http://10.0.0.42:8080`.

> La caméra du scan QR exige HTTPS sur toute adresse autre que `localhost`.
> Pour un usage terrain, ajouter un reverse proxy HTTPS - voir
> [INSTALL.md §4/§5](INSTALL.md#4-reverse-proxy--nginx).

## Gestion du service

```powershell
nssm status  PTXFleet
nssm restart PTXFleet
nssm stop    PTXFleet
```

Sans service : double-cliquer sur **`START.bat`** pour lancer l'app à la demande.

## Mise à jour

1. Copier le contenu de la nouvelle version dans le dossier existant, en
   conservant impérativement `data\` et `.env`.
2. Clic droit sur **`UPDATE-WINDOWS.bat`** → **Exécuter en tant
   qu'administrateur**.
3. Le dossier courant est détecté automatiquement. Le script sauvegarde les
   fichiers et la base, reconstruit l'interface et redémarre le service.

Le script fonctionne aussi depuis un dossier séparé lorsque le service
`PTXFleet` est installé : son emplacement est alors détecté automatiquement.

## Problèmes courants

| Symptôme | Solution |
|----------|----------|
| Le `.bat` se ferme aussitôt | Lancer via clic droit → *Exécuter en tant qu'administrateur*; consulter `install-log.txt` |
| « Node.js introuvable dans le PATH » | Fermer la fenêtre, en ouvrir une nouvelle, relancer le `.bat` |
| Blocage antivirus / SmartScreen | Propriétés du fichier → cocher **Débloquer** |
| `npm install` échoue sur `better-sqlite3` (`npm error code 1`) | Le script réessaie automatiquement : node_modules nettoyé, puis VS Build Tools + Python, puis Node.js 22 LTS. Node 24 n’a pas toujours de binaire précompilé. |
| Port 8080 déjà utilisé | Modifier `PORT=` dans `.env` puis `nssm restart PTXFleet` |
