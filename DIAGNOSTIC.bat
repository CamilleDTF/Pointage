@echo off
rem ---------------------------------------------------------------------------
rem  Recueille tout ce qu'il faut pour comprendre pourquoi l'application ne
rem  demarre pas, et l'ecrit dans diagnostic.txt a cote de ce fichier.
rem
rem  Double-cliquez, attendez la fin, puis envoyez diagnostic.txt.
rem ---------------------------------------------------------------------------

setlocal
cd /d "%~dp0"
set RAPPORT=diagnostic.txt
title Diagnostic Pointage

echo Diagnostic en cours, patientez...
echo.

> "%RAPPORT%" echo === DIAGNOSTIC POINTAGE ===
>>"%RAPPORT%" echo Date : %DATE% %TIME%
>>"%RAPPORT%" echo Dossier : %CD%
>>"%RAPPORT%" echo.

>>"%RAPPORT%" echo --- 1. Node.js ---
where node >>"%RAPPORT%" 2>&1
if errorlevel 1 (
  >>"%RAPPORT%" echo RESULTAT : Node.js INTROUVABLE. C'est la cause.
  goto :fin
)
node --version >>"%RAPPORT%" 2>&1
npm --version >>"%RAPPORT%" 2>&1
>>"%RAPPORT%" echo Architecture :
node -e "console.log(process.platform, process.arch)" >>"%RAPPORT%" 2>&1

>>"%RAPPORT%" echo.
>>"%RAPPORT%" echo --- 2. Composants installes ---
if exist node_modules (
  >>"%RAPPORT%" echo Dossier node_modules : present
) else (
  >>"%RAPPORT%" echo Dossier node_modules : ABSENT - l'installation n'a pas eu lieu
)

>>"%RAPPORT%" echo.
>>"%RAPPORT%" echo --- 3. Base de donnees ^(module natif, cause frequente sous Windows^) ---
node -e "require('better-sqlite3'); console.log('better-sqlite3 : OK')" >>"%RAPPORT%" 2>&1
if errorlevel 1 >>"%RAPPORT%" echo RESULTAT : le module natif ne se charge pas. C'est probablement la cause.

>>"%RAPPORT%" echo.
>>"%RAPPORT%" echo --- 4. Le port 3000 est-il deja occupe ? ---
netstat -ano ^| findstr :3000 >>"%RAPPORT%" 2>&1
if errorlevel 1 (
  >>"%RAPPORT%" echo Port 3000 : libre
) else (
  >>"%RAPPORT%" echo RESULTAT : le port 3000 est deja utilise par un autre programme.
)

>>"%RAPPORT%" echo.
>>"%RAPPORT%" echo --- 5. Demarrage reel de l'application ^(10 secondes^) ---
start "serveur-test" /b cmd /c "node server\index.js > sortie-serveur.txt 2>&1"
ping -n 11 127.0.0.1 >nul

>>"%RAPPORT%" echo Ce que le serveur a ecrit :
if exist sortie-serveur.txt (
  type sortie-serveur.txt >>"%RAPPORT%" 2>&1
) else (
  >>"%RAPPORT%" echo ^(aucune sortie^)
)

>>"%RAPPORT%" echo.
>>"%RAPPORT%" echo L'application repond-elle ?
node -e "fetch('http://127.0.0.1:3000/').then(r=>console.log('REPONSE HTTP', r.status)).catch(e=>console.log('AUCUNE REPONSE :', e.message))" >>"%RAPPORT%" 2>&1

taskkill /f /im node.exe >nul 2>&1
del /q sortie-serveur.txt >nul 2>&1

:fin
>>"%RAPPORT%" echo.
>>"%RAPPORT%" echo === FIN ===

echo.
echo   ============================================================
echo     Diagnostic termine.
echo.
echo     Un fichier "diagnostic.txt" a ete cree dans ce dossier.
echo     Envoyez-le tel quel, il contient tout ce qu'il faut.
echo   ============================================================
echo.
start "" notepad "%RAPPORT%"
pause
