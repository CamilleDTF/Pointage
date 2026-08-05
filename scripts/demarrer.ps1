# Demarrage sur un poste Windows, pour essayer l'application.
#
#   Clic droit sur ce fichier > "Exécuter avec PowerShell"
#   ou, dans PowerShell :  .\scripts\demarrer.ps1
#
# Relançable sans risque : les donnees deja saisies sont conservees.

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js est introuvable." -ForegroundColor Red
    Write-Host "Installez-le depuis https://nodejs.org (version 22 ou plus), puis relancez ce script."
    Read-Host "Appuyez sur Entrée pour fermer"
    exit 1
}

$version = [int](node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')
if ($version -lt 22) {
    Write-Host "Node.js $version détecté, version 22 ou plus requise." -ForegroundColor Red
    Write-Host "Mettez à jour depuis https://nodejs.org, puis relancez ce script."
    Read-Host "Appuyez sur Entrée pour fermer"
    exit 1
}

# On compare l'installé à ce que package.json demande : la seule présence du
# dossier node_modules ne dit pas si une mise à jour a ajouté un composant.
node scripts/verifier-composants.js *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Installation des dépendances (comptez une minute)…"
    npm install --no-audit --no-fund
}

node scripts/verifier-composants.js
if ($LASTEXITCODE -ne 0) {
    Write-Host "L'installation des dépendances a échoué. Lancez REINSTALLER.bat."
    Read-Host "Appuyez sur Entrée pour fermer"
    exit 1
}

if (-not (Test-Path data\pointage.db)) {
    Write-Host ""
    Write-Host "Première utilisation : création du compte directeur."
    node scripts/creer-compte.js --nom "Direction" --identifiant directeur --code 246810 --role directeur
    Write-Host ""
    Write-Host "Pour charger votre effectif réel :"
    Write-Host "   node scripts/importer-effectif.js <votre-fichier.xlsx> --appliquer"
    Write-Host ""
}

Write-Host "Démarrage en cours sur http://localhost:3000" -ForegroundColor Green
Write-Host "Identifiant « directeur », code 246810.  Ctrl+C pour arrêter."
Write-Host ""

# Le navigateur est ouvert en différé : lancé tout de suite, il arriverait avant
# que le serveur n'écoute et afficherait « localhost inaccessible ».
Start-Job { Start-Sleep -Seconds 4; Start-Process "http://localhost:3000" } | Out-Null

node server/index.js
