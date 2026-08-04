@echo off
rem ---------------------------------------------------------------------------
rem  Charge les chefs d'equipe et les operateurs depuis le tableau d'affectation.
rem
rem  Deux facons de s'en servir :
rem    - deposer le classeur .xlsx sur ce fichier ;
rem    - ou copier le classeur dans ce dossier, puis double-cliquer ici.
rem
rem  Une simulation est toujours jouee d'abord : rien n'est ecrit sans votre
rem  accord explicite.
rem ---------------------------------------------------------------------------

setlocal
cd /d "%~dp0"
title Import de l effectif

if not "%~1"=="" (
  set FICHIER=%~1
  goto :lancer
)

rem  Aucun fichier depose : on cherche un classeur dans le dossier.
set FICHIER=
for %%f in (*.xlsx) do set FICHIER=%%f
if "%FICHIER%"=="" goto :aucun

:lancer
echo.
echo   Classeur : %FICHIER%
echo.
echo   ------------------------------------------------------------
echo     SIMULATION : rien n est enregistre a ce stade.
echo   ------------------------------------------------------------
echo.

call node scripts\importer-effectif.js "%FICHIER%"
if errorlevel 1 goto :echec

echo.
echo   ------------------------------------------------------------
echo.
choice /C ON /N /M "   Appliquer reellement ces changements ? [O]ui / [N]on : "
echo.
if errorlevel 2 goto :annule

call node scripts\importer-effectif.js "%FICHIER%" --appliquer
echo.
echo   ============================================================
echo     Termine. Lancez DEMARRER.bat pour utiliser l application.
echo   ============================================================
echo.
pause
exit /b 0

:annule
echo   Annule. Rien n a ete modifie.
echo.
pause
exit /b 0

:aucun
echo.
echo   Aucun classeur .xlsx trouve dans ce dossier.
echo.
echo   Deposez votre tableau d affectation sur ce fichier,
echo   ou copiez-le dans ce dossier puis relancez.
echo.
pause
exit /b 1

:echec
echo.
echo   La lecture du classeur a echoue. Le message ci-dessus indique pourquoi.
echo.
pause
exit /b 1
