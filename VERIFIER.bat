@echo off
rem ---------------------------------------------------------------------------
rem  Affiche ce que contient reellement la base : comptes et salaries.
rem  Le resultat est aussi enregistre dans effectif.txt, a transmettre tel quel.
rem ---------------------------------------------------------------------------

setlocal
cd /d "%~dp0"
set RAPPORT=effectif.txt
title Verification de l effectif

call node scripts\lister-effectif.js > "%RAPPORT%" 2>&1
type "%RAPPORT%"

echo.
echo   ============================================================
echo     Ce releve vient d etre enregistre dans "effectif.txt".
echo     Envoyez ce fichier si quelque chose manque.
echo   ============================================================
echo.
start "" notepad "%RAPPORT%"
pause
