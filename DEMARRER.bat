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

rem  Un telechargement interrompu laisse un dossier node_modules vide, et une
rem  mise a jour peut ajouter un composant : la seule presence du dossier ne
rem  prouve rien. On compare donc l installe a ce que package.json demande.
call node scripts\verifier-composants.js >nul 2>&1
if errorlevel 1 (
  echo   Installation des composants.
  echo   Comptez une a deux minutes, une connexion Internet est necessaire.
  echo   N INTERROMPEZ PAS cette etape.
  echo.
  call npm install --no-audit --no-fund
  echo.
)

rem  Toujours incomplet : l installation precedente est peut-etre abimee.
rem  On repart alors de zero, ce qui est plus long mais plus sur.
call node scripts\verifier-composants.js >nul 2>&1
if errorlevel 1 (
  echo   Reprise de l installation depuis zero...
  echo.
  if exist node_modules rmdir /s /q node_modules
  call npm install --no-audit --no-fund
  echo.
)

call node scripts\verifier-composants.js
if errorlevel 1 (
  echo.
  echo   ============================================================
  echo     L installation des composants a echoue.
  echo.
  echo     Lancez REINSTALLER.bat : il repart de zero et enregistre
  echo     la reponse exacte de npm dans installation.txt
  echo   ============================================================
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
