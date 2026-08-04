@echo off
rem ---------------------------------------------------------------------------
rem  Reinstalle les composants a partir de zero, en journalisant tout ce que npm
rem  repond, dans installation.txt a cote de ce fichier.
rem
rem  A utiliser quand le dossier node_modules existe mais reste vide : un
rem  telechargement interrompu laisse le dossier en place, et les lanceurs le
rem  prennent alors pour une installation reussie.
rem ---------------------------------------------------------------------------

setlocal
cd /d "%~dp0"
set RAPPORT=installation.txt
title Reinstallation Pointage

echo.
echo   Reinstallation complete des composants.
echo   Tout ce que npm repond est enregistre dans installation.txt
echo.

if exist node_modules (
  echo   Suppression de l ancien dossier node_modules...
  rmdir /s /q node_modules
)
if exist package-lock.json del /q package-lock.json

echo   Telechargement en cours. Comptez une a deux minutes.
echo   Une connexion Internet est necessaire. N interrompez pas.
echo.

> "%RAPPORT%" echo === INSTALLATION ===
>>"%RAPPORT%" echo Date : %DATE% %TIME%
>>"%RAPPORT%" echo Dossier : %CD%
>>"%RAPPORT%" echo.

>>"%RAPPORT%" echo --- Configuration npm, proxy d entreprise compris ---
>>"%RAPPORT%" echo Depot :
call npm config get registry >>"%RAPPORT%" 2>&1
>>"%RAPPORT%" echo Proxy :
call npm config get proxy >>"%RAPPORT%" 2>&1
>>"%RAPPORT%" echo Proxy securise :
call npm config get https-proxy >>"%RAPPORT%" 2>&1
>>"%RAPPORT%" echo Certificat stricte :
call npm config get strict-ssl >>"%RAPPORT%" 2>&1

>>"%RAPPORT%" echo.
>>"%RAPPORT%" echo --- Acces au depot npm ---
call npm ping >>"%RAPPORT%" 2>&1

>>"%RAPPORT%" echo.
>>"%RAPPORT%" echo --- Installation ---
call npm install --no-audit --no-fund >>"%RAPPORT%" 2>&1

>>"%RAPPORT%" echo.
>>"%RAPPORT%" echo --- Resultat, module par module ---
if exist node_modules\express\package.json >>"%RAPPORT%" echo express : present
if not exist node_modules\express\package.json >>"%RAPPORT%" echo express : MANQUANT
if exist node_modules\better-sqlite3\package.json >>"%RAPPORT%" echo better-sqlite3 : present
if not exist node_modules\better-sqlite3\package.json >>"%RAPPORT%" echo better-sqlite3 : MANQUANT
if exist node_modules\exceljs\package.json >>"%RAPPORT%" echo exceljs : present
if not exist node_modules\exceljs\package.json >>"%RAPPORT%" echo exceljs : MANQUANT
if exist node_modules\bcryptjs\package.json >>"%RAPPORT%" echo bcryptjs : present
if not exist node_modules\bcryptjs\package.json >>"%RAPPORT%" echo bcryptjs : MANQUANT

>>"%RAPPORT%" echo.
>>"%RAPPORT%" echo === FIN ===

echo.
if exist node_modules\express\package.json goto :reussi

echo   ============================================================
echo     L INSTALLATION A ECHOUE.
echo.
echo     Le fichier "installation.txt" contient la reponse exacte
echo     de npm. Envoyez-le, il dira pourquoi.
echo   ============================================================
echo.
start "" notepad "%RAPPORT%"
pause
exit /b 1

:reussi
echo   ============================================================
echo     Installation reussie.
echo     Vous pouvez maintenant lancer DEMARRER.bat
echo   ============================================================
echo.
pause
