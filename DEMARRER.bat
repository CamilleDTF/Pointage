@echo off
rem ---------------------------------------------------------------------------
rem  Demarrage de l'application sur un poste Windows.
rem
rem  Double-cliquez simplement sur ce fichier.
rem
rem  Un fichier .bat n'est pas soumis a la politique d'execution qui bloque les
rem  scripts PowerShell : c'est la voie la plus sure sur un poste d'entreprise.
rem  Les messages sont volontairement sans accents, l'invite de commandes
rem  Windows les affichant mal par defaut.
rem ---------------------------------------------------------------------------

setlocal
cd /d "%~dp0"
title Pointage hebdomadaire

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js est introuvable sur ce poste.
  echo.
  echo   Installez-le depuis https://nodejs.org - le gros bouton "LTS" -
  echo   puis relancez ce fichier.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo   Installation des composants, comptez une minute...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo   L'installation a echoue. Copiez le message ci-dessus et transmettez-le.
    echo.
    pause
    exit /b 1
  )
)

if not exist data\pointage.db (
  echo.
  echo   Premiere utilisation : creation du compte directeur.
  echo.
  call node scripts\creer-compte.js --nom "Direction" --identifiant directeur --code 246810 --role directeur
)

echo.
echo   ============================================================
echo     Application demarree
echo.
echo     Adresse      http://localhost:3000
echo     Identifiant  directeur
echo     Code         246810
echo.
echo     Fermez cette fenetre pour arreter l'application.
echo   ============================================================
echo.

start "" http://localhost:3000
node server\index.js

echo.
echo   L'application s'est arretee.
pause
