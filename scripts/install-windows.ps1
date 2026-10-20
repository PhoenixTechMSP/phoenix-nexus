# Phoenix-Nexus - Windows one-click installer
# Installs prerequisites (Node.js LTS + VS Build Tools), dependencies,
# builds the UI, creates the first admin and registers a Windows service.
#
# Run:  right-click INSTALL-WINDOWS.bat -> Run as administrator
#       (or: powershell -ExecutionPolicy Bypass -File scripts\install-windows.ps1)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$Root    = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$LogFile = Join-Path $Root 'install-log.txt'

function Log($msg, $color = 'Gray') {
  $line = "[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg
  Write-Host $line -ForegroundColor $color
  Add-Content -Path $LogFile -Value $line
}
function Fail($msg) { Log "ERREUR: $msg" 'Red'; Log "Log complet: $LogFile" 'Yellow'; Read-Host 'Appuyez sur Entree pour fermer'; exit 1 }

# --- 0. Admin check -----------------------------------------------------------
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host 'Elevation requise - relance en administrateur...' -ForegroundColor Yellow
  Start-Process powershell -Verb RunAs -ArgumentList @(
    '-NoProfile','-NoExit','-ExecutionPolicy','Bypass','-File',"`"$($MyInvocation.MyCommand.Path)`""
  )
  exit 0
}

Write-Host ''
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host '  Phoenix-Nexus - Installation Windows' -ForegroundColor Cyan
Write-Host '==============================================' -ForegroundColor Cyan
Write-Host ''
Log "Dossier d'installation: $Root"

# --- 1. Package manager -------------------------------------------------------
function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

$pm = $null
if (Have 'winget') { $pm = 'winget' }
elseif (Have 'choco') { $pm = 'choco' }
else {
  Log 'Ni winget ni Chocolatey trouve - installation de Chocolatey...' 'Yellow'
  try {
    Set-ExecutionPolicy Bypass -Scope Process -Force
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-Expression ((New-Object Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
    $env:Path += ';C:\ProgramData\chocolatey\bin'
    $pm = 'choco'
  } catch { Fail "Impossible d'installer Chocolatey: $($_.Exception.Message)" }
}
Log "Gestionnaire de paquets: $pm" 'Green'

function Install-Pkg($wingetId, $chocoId, $label) {
  Log "Installation de $label ..." 'Yellow'
  if ($pm -eq 'winget') {
    & winget install --id $wingetId --exact --silent --accept-source-agreements --accept-package-agreements 2>&1 | Out-File -Append $LogFile
  } else {
    & choco install $chocoId -y --no-progress 2>&1 | Out-File -Append $LogFile
  }
  # refresh PATH for the current session
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path','User')
}

# --- 2. Node.js 20+ -----------------------------------------------------------
$needNode = $true
if (Have 'node') {
  $major = ((& node -v) -replace '^v','').Split('.')[0] -as [int]
  if ($major -ge 20) { $needNode = $false; Log "Node.js deja present (v$major)" 'Green' }
  else { Log "Node.js v$major trop ancien (20+ requis)" 'Yellow' }
}
if ($needNode) {
  Install-Pkg 'OpenJS.NodeJS.LTS' 'nodejs-lts' 'Node.js 20 LTS'
  if (-not (Have 'node')) { Fail 'Node.js installe mais introuvable dans le PATH. Fermez cette fenetre, ouvrez-en une nouvelle et relancez le script.' }
  Log "Node.js $(& node -v) OK" 'Green'
}

# --- 3. Build tools (better-sqlite3) -----------------------------------------
# Prebuilt binaries cover most cases; the toolchain is only a fallback.
$vsPresent = Test-Path 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe'
if (-not $vsPresent) { Log 'Outils de compilation C++ absents (fallback si binaire precompile indisponible)' 'DarkYellow' }

# --- 4. npm install -----------------------------------------------------------
Push-Location $Root
try {
  function Npm-Install($label) {
    Log "npm install ($label)..." 'Yellow'
    & cmd /c "npm install --no-audit --no-fund --loglevel=error 2>&1" | Tee-Object -FilePath $LogFile -Append
    return ($LASTEXITCODE -eq 0)
  }

  Log 'Installation des dependances npm (peut prendre 2-5 min)...' 'Yellow'
  $ok = Npm-Install 'tentative 1'

  if (-not $ok) {
    # Cause la plus frequente : pas de binaire precompile pour la version de Node
    # installee (ex. Node 24). On repart d un node_modules propre.
    Log 'Echec - nettoyage de node_modules / package-lock puis nouvelle tentative...' 'Yellow'
    Remove-Item -Recurse -Force (Join-Path $Root 'node_modules') -ErrorAction SilentlyContinue
    Remove-Item -Force (Join-Path $Root 'package-lock.json') -ErrorAction SilentlyContinue
    $ok = Npm-Install 'tentative 2'
  }

  if (-not $ok) {
    Log 'Echec - installation des outils de compilation C++ (better-sqlite3)...' 'Yellow'
    Install-Pkg 'Microsoft.VisualStudio.2022.BuildTools' 'visualstudio2022buildtools' 'VS Build Tools'
    Install-Pkg 'Python.Python.3.12' 'python312' 'Python 3'
    $ok = Npm-Install 'tentative 3 - compilation locale'
  }

  if (-not $ok) {
    # Dernier recours : forcer Node 22 LTS (ABI supportee par tous les binaires precompiles)
    Log 'Echec - installation de Node.js 22 LTS puis nouvelle tentative...' 'Yellow'
    Install-Pkg 'OpenJS.NodeJS.LTS' 'nodejs-lts' 'Node.js 22 LTS'
    Remove-Item -Recurse -Force (Join-Path $Root 'node_modules') -ErrorAction SilentlyContinue
    $ok = Npm-Install 'tentative 4'
  }

  if (-not $ok) { Fail 'npm install a echoue. Voir install-log.txt (fin du fichier) pour la cause exacte.' }
  Log 'Dependances installees' 'Green'

  # --- 5. .env --------------------------------------------------------------
  $envFile = Join-Path $Root '.env'
  if (-not (Test-Path $envFile)) {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $secret = -join ($bytes | ForEach-Object { $_.ToString('x2') })
    @(
      'NODE_ENV=production',
      'PORT=8080',
      "DB_PATH=$(Join-Path $Root 'data\ptx.db')",
      "JWT_SECRET=$secret",
      'TZ=Europe/Brussels',
      'SSO_ENABLED=false'
    ) | Set-Content -Path $envFile -Encoding ASCII
    Log '.env cree avec un JWT_SECRET aleatoire' 'Green'
  } else { Log '.env existant conserve' 'Gray' }

  # --- 6. Build UI ----------------------------------------------------------
  Log 'Compilation de l interface...' 'Yellow'
  & cmd /c "npm run build 2>&1" | Tee-Object -FilePath $LogFile -Append
  if ($LASTEXITCODE -ne 0) { Fail 'npm run build a echoue (voir les lignes ci-dessus et install-log.txt)' }
  Log 'Interface compilee' 'Green'

  # --- 7. First admin -------------------------------------------------------
  New-Item -ItemType Directory -Force -Path (Join-Path $Root 'data') | Out-Null
  Log 'Creation du compte administrateur...' 'Yellow'
  & cmd /c "node `"$(Join-Path $Root 'scripts\first-admin.js')`" admin@company.local Admin123! `"System Admin`" 2>&1" | Tee-Object -FilePath $LogFile -Append
  Log 'Admin: admin@company.local / Admin123!  (a changer apres la 1re connexion)' 'Green'


  # --- 8. Windows service (NSSM) -------------------------------------------
  $asService = Read-Host 'Installer comme service Windows (demarrage automatique) ? [O/n]'
  if ($asService -notmatch '^[nN]') {
    if (-not (Have 'nssm')) { Install-Pkg 'NSSM.NSSM' 'nssm' 'NSSM' }

    # Localiser nssm.exe (winget/choco ne rafraichissent pas toujours le PATH)
    $nssm = $null
    if (Have 'nssm') { $nssm = (Get-Command nssm).Source }
    else {
      $candidates = @(
        'C:\ProgramData\chocolatey\bin\nssm.exe',
        'C:\Program Files\nssm\nssm.exe',
        'C:\Program Files\nssm\win64\nssm.exe'
      )
      foreach ($c in $candidates) { if (Test-Path $c) { $nssm = $c; break } }
      if (-not $nssm) {
        $found = Get-ChildItem -Path 'C:\Users\*\AppData\Local\Microsoft\WinGet\Packages' -Filter 'nssm.exe' `
                   -Recurse -ErrorAction SilentlyContinue |
                 Where-Object { $_.FullName -match 'win64' } | Select-Object -First 1
        if (-not $found) {
          $found = Get-ChildItem -Path 'C:\Users\*\AppData\Local\Microsoft\WinGet\Packages' -Filter 'nssm.exe' `
                     -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        }
        if ($found) { $nssm = $found.FullName }
      }
    }

    if ($nssm) {
      Log "NSSM: $nssm" 'Gray'

      # Toutes les commandes nssm passent par cmd /c : nssm ecrit sur stderr
      # (ex. "Impossible d ouvrir le service!") ce que PowerShell traiterait
      # comme une erreur bloquante.
      function Nssm-Run {
        param([string[]]$NssmArgs)
        $line = '"{0}" {1} >>"{2}" 2>&1' -f $nssm, ($NssmArgs -join ' '), $LogFile
        & cmd /c $line | Out-Null
        return $LASTEXITCODE
      }

      $node = (Get-Command node).Source
      New-Item -ItemType Directory -Force -Path (Join-Path $Root 'logs') | Out-Null

      # Nettoyage d une eventuelle installation precedente (erreurs ignorees)
      if (Get-Service PTXFleet -ErrorAction SilentlyContinue) {
        Nssm-Run @('stop','PTXFleet') | Out-Null
        Nssm-Run @('remove','PTXFleet','confirm') | Out-Null
        Start-Sleep -Seconds 2
      }

      $rc = Nssm-Run @('install','PTXFleet', "`"$node`"", "`"$(Join-Path $Root 'server\index.js')`"")
      if ($rc -ne 0) { Log "nssm install a retourne le code $rc (voir install-log.txt)" 'Yellow' }

      Nssm-Run @('set','PTXFleet','AppDirectory', "`"$Root`"")                                  | Out-Null
      Nssm-Run @('set','PTXFleet','AppStdout',    "`"$(Join-Path $Root 'logs\stdout.log')`"")   | Out-Null
      Nssm-Run @('set','PTXFleet','AppStderr',    "`"$(Join-Path $Root 'logs\stderr.log')`"")   | Out-Null
      Nssm-Run @('set','PTXFleet','Start','SERVICE_AUTO_START')                                 | Out-Null
      Nssm-Run @('start','PTXFleet')                                                            | Out-Null

      # Verification reelle de l etat du service
      $svc = $null
      for ($i = 0; $i -lt 15; $i++) {
        $svc = Get-Service PTXFleet -ErrorAction SilentlyContinue
        if ($svc -and $svc.Status -eq 'Running') { break }
        Start-Sleep -Seconds 1
      }
      if ($svc -and $svc.Status -eq 'Running') {
        Log 'Service PTXFleet demarre' 'Green'
      } else {
        $state = if ($svc) { $svc.Status } else { 'introuvable' }
        Log "Service PTXFleet non demarre (etat: $state) - utilisez START.bat" 'Yellow'
        Log 'Details dans logs\stderr.log et install-log.txt' 'Yellow'
      }

      # L'ancienne regle ('Site Asset Manager (CMDB) 8080') est reconnue aussi : sur une machine deja
      # installee avant le renommage, on ne cree pas de doublon.
      if (-not (Get-NetFirewallRule -DisplayName 'Phoenix-Nexus 8080' -ErrorAction SilentlyContinue) -and
          -not (Get-NetFirewallRule -DisplayName 'Site Asset Manager (CMDB) 8080' -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName 'Phoenix-Nexus 8080' -Direction Inbound `
          -Action Allow -Protocol TCP -LocalPort 8080 -Profile Domain,Private | Out-Null
        Log 'Regle pare-feu ajoutee (TCP 8080, reseau prive/domaine)' 'Green'
      }
    } else { Log 'NSSM introuvable - utilisez START.bat pour lancer l app manuellement' 'Yellow' }


  } else {
    Log 'Service non installe - utilisez START.bat pour lancer l app' 'Gray'
  }
}
finally { Pop-Location }

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
       Select-Object -First 1 -ExpandProperty IPAddress)

Write-Host ''
Write-Host '==============================================' -ForegroundColor Green
Write-Host '  Installation terminee' -ForegroundColor Green
Write-Host '==============================================' -ForegroundColor Green
Write-Host "  Local  : http://localhost:8080" -ForegroundColor Cyan
if ($ip) { Write-Host "  Reseau : http://$ip:8080" -ForegroundColor Cyan }
Write-Host "  Login  : admin@company.local / Admin123!" -ForegroundColor Cyan
Write-Host ''
Start-Process 'http://localhost:8080'
Read-Host 'Appuyez sur Entree pour fermer'
