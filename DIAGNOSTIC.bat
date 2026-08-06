@echo off
rem ---------------------------------------------------------------------------
rem  Recueille ce qu'il faut pour comprendre pourquoi l'application ne demarre
rem  pas, et l'ecrit dans diagnostic.txt a cote de ce fichier.
rem
rem  Double-cliquez, attendez la fin, puis envoyez diagnostic.txt.
rem
rem  Ecrit sans parentheses ni caracteres a echapper, et avec "call" devant
rem  chaque appel de npm : sans lui, l'appel d'un script .cmd depuis un .bat
rem  rend la main a l'appelant et interrompt tout le reste du fichier.
rem ---------------------------------------------------------------------------

setlocal
cd /d "%~dp0"
set RAPPORT=diagnostic.txt
title Diagnostic Pointage

echo.
echo   Diagnostic en cours, comptez une vingtaine de secondes...
echo.

> "%RAPPORT%" echo === DIAGNOSTIC POINTAGE ===
>>"%RAPPORT%" echo Date : %DATE% %TIME%
>>"%RAPPORT%" echo Dossier : %CD%
echo "%CD%" | findstr /C:"(" >nul
if not errorlevel 1 >>"%RAPPORT%" echo ATTENTION : le chemin contient une parenthese, source de pannes sous Windows
echo "%CD%" | findstr /C:" " >nul
if not errorlevel 1 >>"%RAPPORT%" echo Note : le chemin contient un espace
>>"%RAPPORT%" echo.

>>"%RAPPORT%" echo --- 1. Node.js ---
where node >>"%RAPPORT%" 2>&1
if errorlevel 1 goto :absent

call node --version >>"%RAPPORT%" 2>&1
>>"%RAPPORT%" echo Plateforme :
call node -p "process.platform + ' ' + process.arch" >>"%RAPPORT%" 2>&1
>>"%RAPPORT%" echo Version de npm :
call npm --version >>"%RAPPORT%" 2>&1

>>"%RAPPORT%" echo.
>>"%RAPPORT%" echo --- 2. Composants installes ---
call node scripts\verifier-composants.js >>"%RAPPORT%" 2>&1
call node scripts\verifier-composants.js >nul 2>&1
if errorlevel 1 (
  >>"%RAPPORT%" echo Tentative d installation ci-dessous
  call npm install --no-audit --no-fund >>"%RAPPORT%" 2>&1
  call node scripts\verifier-composants.js >>"%RAPPORT%" 2>&1
)
if exist package.json >>"%RAPPORT%" echo Version de base attendue :
if exist package.json call node -p "require('./package.json').dependencies['better-sqlite3']" >>"%RAPPORT%" 2>&1

>>"%RAPPORT%" echo.
>>"%RAPPORT%" echo --- 3. Base de donnees, composant compile ---
>>"%RAPPORT%" echo Version reellement installee :
call node -p "require('better-sqlite3/package.json').version" >>"%RAPPORT%" 2>&1
>>"%RAPPORT%" echo Chargement :
call node -e "require('better-sqlite3'); console.log('OK')" >>"%RAPPORT%" 2>&1

>>"%RAPPORT%" echo.
>>"%RAPPORT%" echo --- 4. Port 3000 ---
netstat -ano | findstr :3000 >>"%RAPPORT%" 2>&1
if errorlevel 1 >>"%RAPPORT%" echo Port 3000 libre
if not errorlevel 1 >>"%RAPPORT%" echo Port 3000 DEJA UTILISE par le processus ci-dessus

>>"%RAPPORT%" echo.
>>"%RAPPORT%" echo --- 5. Demarrage reel ---
if exist sortie-serveur.txt del /q sortie-serveur.txt
start "serveur-test" /b cmd /c "node server\index.js > sortie-serveur.txt 2>&1"
ping -n 11 127.0.0.1 >nul

>>"%RAPPORT%" echo Ce que le serveur a ecrit :
if exist sortie-serveur.txt type sortie-serveur.txt >>"%RAPPORT%" 2>&1
if not exist sortie-serveur.txt >>"%RAPPORT%" echo aucune sortie produite

>>"%RAPPORT%" echo.
>>"%RAPPORT%" echo Reponse de l application :
call node -e "fetch('http://127.0.0.1:3000/').then(function(r){console.log('HTTP', r.status)}).catch(function(e){console.log('AUCUNE REPONSE :', e.message)})" >>"%RAPPORT%" 2>&1

taskkill /f /im node.exe >nul 2>&1
if exist sortie-serveur.txt del /q sortie-serveur.txt

>>"%RAPPORT%" echo.
>>"%RAPPORT%" echo --- 6. Envoi des courriels ---
if exist configuration.txt >>"%RAPPORT%" echo Fichier configuration.txt present
if not exist configuration.txt >>"%RAPPORT%" echo Aucun fichier configuration.txt : copiez configuration-exemple.txt sous ce nom
>>"%RAPPORT%" echo Reglages lus, sans les mots de passe :
call node -e "require('./server/configuration'); var c=['SMTP_HOTE','SMTP_PORT','SMTP_UTILISATEUR','COURRIEL_EXPEDITEUR','ADRESSE_PUBLIQUE']; c.forEach(function(k){console.log('  '+k+' = '+(process.env[k]||'non renseigne'))}); console.log('  SMTP_MOT_DE_PASSE = '+(process.env.SMTP_MOT_DE_PASSE?'renseigne':'non renseigne'))" >>"%RAPPORT%" 2>&1

goto :fin

:absent
>>"%RAPPORT%" echo RESULTAT : Node.js est introuvable. C est la cause.

:fin
>>"%RAPPORT%" echo.
>>"%RAPPORT%" echo === FIN DU DIAGNOSTIC ===

echo   ============================================================
echo     Termine.
echo.
echo     Le fichier "diagnostic.txt" vient d etre cree dans ce
echo     dossier, et s ouvre dans le Bloc-notes.
echo     Envoyez-le tel quel, en entier.
echo   ============================================================
echo.
start "" notepad "%RAPPORT%"
pause
