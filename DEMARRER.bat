@echo off
rem ---------------------------------------------------------------------------
rem  Demarrage de l'application sur un poste Windows.
rem
rem  Double-cliquez simplement sur ce fichier.
rem
rem  Ecrit volontairement sans accents : l'invite de commandes Windows les
rem  affiche mal avec sa page de codes par defaut.
rem
rem  Deux precautions valent d'etre signalees :
rem   - "call" devant npm et node : sans lui, l'appel d'un script .cmd depuis un
rem     .bat rend la main a l'appelant et interrompt la suite du fichier ;
rem   - l'ouverture du navigateur est deleguee a scripts\ouvrir-navigateur.bat,
rem     pour n'imbriquer aucun guillemet.
rem ---------------------------------------------------------------------------

setlocal
cd /d "%~dp0"
title Pointage hebdomadaire

echo.
echo   Demarrage de l'application de pointage...
echo.

echo "%CD%" | findstr /C:"(" >nul
if not errorlevel 1 (
  echo   ATTENTION : le dossier contient une parenthese dans son chemin :
  echo   %CD%
  echo.
  echo   Certains outils Windows s y cassent les dents. Si le demarrage
  echo   echoue, deplacez le dossier vers C:\Pointage et reessayez.
  echo.
)

where node >nul 2>nul
if errorlevel 1 (
  echo   Node.js est introuvable sur ce poste.
  echo.
  echo   Installez-le depuis https://nodejs.org - le gros bouton "LTS" -
  echo   puis relancez ce fichier.
  echo.
  pause
  exit /b 1
)

call node --version
echo.

if not exist node_modules (
  echo   Installation des composants.
  echo   Comptez une a deux minutes, une connexion Internet est necessaire.
  echo   N INTERROMPEZ PAS cette etape.
  echo.
  call npm install --no-audit --no-fund
  echo.
)

if not exist node_modules (
  echo   L'installation des composants a echoue.
  echo   Lancez DIAGNOSTIC.bat et transmettez le fichier diagnostic.txt produit.
  echo.
  pause
  exit /b 1
)

if not exist data\pointage.db (
  echo   Creation du compte directeur...
  call node scripts\creer-compte.js --nom "Direction" --identifiant directeur --code 246810 --role directeur
  echo.
)

echo   ============================================================
echo     Adresse      http://localhost:3000
echo     Identifiant  directeur
echo     Code         246810
echo.
echo     Le navigateur s'ouvre dans quelques secondes.
echo     NE FERMEZ PAS cette fenetre : elle fait tourner
echo     l'application. La fermer arrete tout.
echo   ============================================================
echo.

start "" /b "%~dp0scripts\ouvrir-navigateur.bat"

call node server\index.js

echo.
echo   L'application s'est arretee.
echo   Si un message d'erreur apparait ci-dessus, transmettez-le.
echo.
pause
