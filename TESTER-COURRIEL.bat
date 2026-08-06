@echo off
rem ---------------------------------------------------------------------------
rem  Envoie un courriel d'essai, pour verifier que les demandes de visa
rem  partiront bien aux conducteurs de travaux.
rem
rem  Double-cliquez, tapez votre adresse, et regardez votre boite de reception.
rem
rem  Si rien n'est configure, le script dit quelles lignes remplir dans
rem  configuration.txt plutot que d'echouer sans explication.
rem ---------------------------------------------------------------------------

setlocal
cd /d "%~dp0"
title Essai d envoi de courriel

echo.
echo   ============================================================
echo     ESSAI D ENVOI DE COURRIEL
echo   ============================================================
echo.

set ADRESSE=%~1
if not "%ADRESSE%"=="" goto :lancer

set /p ADRESSE=  Adresse a laquelle envoyer l essai :
echo.

:lancer
if "%ADRESSE%"=="" (
  echo   Aucune adresse saisie, essai abandonne.
  echo.
  pause
  exit /b 1
)

call node scripts\tester-courriel.js "%ADRESSE%"

echo.
echo   ============================================================
pause
