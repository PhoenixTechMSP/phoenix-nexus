# Phoenix-Nexus - Automatic Windows update (v1.6.1)
# Copies the new application files over an existing installation, rebuilds the
# UI and restarts the Windows service. The SQLite database is never touched;
# a backup of the DB and of the previous files is taken before anything else.
# Usage (as administrator):
#   powershell -ExecutionPolicy Bypass -File scripts\update-windows.ps1 -Target "C:\PTXFleet"

param(
  [string]$Target = '',
  [string]$Service = 'PTXFleet'
)

$ErrorActionPreference = 'Stop'
$Source = Split-Path -Parent $PSScriptRoot
$Stamp  = Get-Date -Format 'yyyyMMdd-HHmmss'

function Log($m, $c = 'Gray') { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) -ForegroundColor $c }
function Fail($m) { Log $m 'Red'; Read-Host 'Appuyez sur Entree pour fermer'; exit 1 }

function Test-InstallationFolder($Path) {
  if (-not $Path -or -not (Test-Path $Path -PathType Container)) { return $false }
  return ((Test-Path (Join-Path $Path '.env') -PathType Leaf) -and
          (Test-Path (Join-Path $Path 'data') -PathType Container) -and
          (Test-Path (Join-Path $Path 'server\index.js') -PathType Leaf) -and
          (Test-Path (Join-Path $Path 'package.json') -PathType Leaf))
}

if (-not $Target) {
  # Most common workflow: the update files were copied directly over the
  # existing installation. In that case the folder containing this script is
  # already the target and no service discovery is needed.
  if (Test-InstallationFolder $Source) {
    $Target = $Source
    Log "Installation detectee dans le dossier courant : $Target" 'Green'
  } else {
    # Separate update folder: discover the installation from the service.
    $svcPath = (Get-CimInstance Win32_Service -Filter "Name='$Service'" -ErrorAction SilentlyContinue).PathName
    if ($svcPath -and $svcPath -match '([A-Za-z]:\\[^"]*?)\\server\\index\.js') { $Target = $Matches[1] }
    if ($Target) { Log "Installation detectee via le service $Service : $Target" 'Green' }
  }
}
if (-not (Test-InstallationFolder $Target)) {
  Fail "Dossier d'installation introuvable ou incomplet. Copiez la mise a jour dans le dossier existant (avec .env et data), puis relancez UPDATE-WINDOWS.bat."
}

$Source = (Resolve-Path $Source).Path
$Target = (Resolve-Path $Target).Path
$inPlace = $Target -eq $Source

Log "Mise a jour de $Target" 'Cyan'
if ($inPlace) { Log 'Mode mise a jour sur place : aucun chemin a saisir.' 'Cyan' }
else { Log "Mode copie depuis : $Source" 'Cyan' }

# 1. Backups (database + current files)
$backupRoot = Join-Path $Target ("backups\update-$Stamp")
New-Item -ItemType Directory -Force -Path $backupRoot | Out-Null
foreach ($item in @('server', 'client', 'dist', 'package.json')) {
  $p = Join-Path $Target $item
  if (Test-Path $p) { Copy-Item $p -Destination $backupRoot -Recurse -Force }
}
$dbDir = Join-Path $Target 'data'
if (Test-Path $dbDir) { Copy-Item $dbDir -Destination (Join-Path $backupRoot 'data') -Recurse -Force }
Log "Sauvegarde faite : $backupRoot" 'Green'

$svc = Get-Service $Service -ErrorAction SilentlyContinue
$wasRunning = $svc -and $svc.Status -eq 'Running'

function Restore-Backup {
  Log 'Echec - restauration de la version precedente ...' 'Yellow'
  foreach ($item in @('server', 'client', 'dist', 'package.json')) {
    $b = Join-Path $backupRoot $item
    if (Test-Path $b) {
      $dst = Join-Path $Target $item
      if (Test-Path $dst) { Remove-Item $dst -Recurse -Force }
      Copy-Item $b -Destination $dst -Recurse -Force
    }
  }
  if ($wasRunning) { Start-Service $Service -ErrorAction SilentlyContinue }
  Fail 'Mise a jour annulee, ancienne version restauree.'
}

try {
  # 2. Stop the service (few seconds of downtime)
  if ($wasRunning) { Log 'Arret du service ...'; Stop-Service $Service -Force; Start-Sleep -Seconds 2 }

  # 3. Copy code only when the update archive is in a separate folder.
  # In-place mode preserves data/, logs/, .env and backups/ and proceeds
  # directly to dependency installation and UI rebuild.
  if (-not $inPlace) {
    foreach ($item in @('server', 'client', 'package.json', 'package-lock.json', 'scripts')) {
      $src = Join-Path $Source $item
      if (Test-Path $src) {
        $dst = Join-Path $Target $item
        if ((Test-Path $dst) -and $item -notin @('package.json', 'package-lock.json')) { Remove-Item $dst -Recurse -Force }
        Copy-Item $src -Destination $dst -Recurse -Force
      }
    }
    Log 'Fichiers applicatifs mis a jour' 'Green'
  } else {
    Log 'Fichiers deja presents dans le dossier d installation' 'Green'
  }

  # 4. Dependencies + UI rebuild
  Push-Location $Target
  & cmd /c "npm install --omit=dev --no-audit --no-fund 2>&1" | Out-Host
  if ($LASTEXITCODE -ne 0) { Pop-Location; Restore-Backup }
  & cmd /c "npm install --no-audit --no-fund 2>&1" | Out-Host
  & cmd /c "npm run build 2>&1" | Out-Host
  if ($LASTEXITCODE -ne 0) { Pop-Location; Restore-Backup }
  Pop-Location
  Log 'Interface reconstruite' 'Green'
}
catch {
  Log $_.Exception.Message 'Red'
  Restore-Backup
}

# 5. Restart + health check
if ($svc) {
  Start-Service $Service
  for ($i = 0; $i -lt 20; $i++) {
    try {
      $r = Invoke-RestMethod 'http://localhost:8080/api/health' -TimeoutSec 2
      if ($r.ok) { Log 'Service redemarre et operationnel' 'Green'; break }
    } catch { Start-Sleep -Seconds 1 }
  }
} else {
  Log 'Aucun service Windows detecte - lancez START.bat' 'Yellow'
}

Log 'Mise a jour terminee. Base de donnees et utilisateurs inchanges.' 'Cyan'
Log "En cas de probleme, la version precedente est dans $backupRoot" 'Gray'
