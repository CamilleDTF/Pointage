@echo off
rem ---------------------------------------------------------------------------
rem  Envoie un courriel d'essai, pour verifier que les demandes de visa
rem  partiront bien aux conducteurs de travaux.
rem
rem  Double-cliquez, tapez votre adresse, et regardez votre boite de reception.
rem
rem  Tout ce qui s'affiche est aussi enregistre dans "essai-courriel.txt", a
rem  cote de ce fichier : une fenetre qui se ferme emporte sinon la seule
rem  explication du probleme. En cas d'echec, le fichier s'ouvre tout seul.
rem ---------------------------------------------------------------------------

setlocal
cd /d "%~dp0"
set RAPPORT=essai-courriel.txt
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

rem  Le detail du dialogue avec le serveur est enregistre systematiquement dans
rem  le rapport : c'est ce qui permet de comprendre un refus, et il ne sert a
rem  rien de faire relancer un essai pour l'obtenir.
> "%RAPPORT%" echo === ESSAI D ENVOI DE COURRIEL ===
>>"%RAPPORT%" echo Date : %DATE% %TIME%
>>"%RAPPORT%" echo Adresse d essai : %ADRESSE%
>>"%RAPPORT%" echo.

call node scripts\tester-courriel.js "%ADRESSE%" --details >>"%RAPPORT%" 2>&1
set RESULTAT=%ERRORLEVEL%

type "%RAPPORT%"

if "%RESULTAT%"=="0" goto :reussite

rem  Rien n'est configure et aucun fichier n'existe encore : on propose de le
rem  preparer avec les reglages qui viennent d'etre trouves.
if exist configuration.txt goto :echec

echo.
set REPONSE=
set /p REPONSE=  Preparer le fichier configuration.txt avec ces reglages ? (O/N) :
if /i not "%REPONSE%"=="O" goto :echec

echo.
call node scripts\tester-courriel.js "%ADRESSE%" --preparer
echo.
echo   Le fichier va s ouvrir dans le Bloc-notes.
echo   Completez ce qu il reste, enregistrez, puis relancez ce test.
if exist configuration.txt start "" notepad configuration.txt
goto :fin

:echec
echo.
echo   ============================================================
echo     L ESSAI A ECHOUE.
echo.
echo     Le detail complet vient d etre enregistre dans
echo     "essai-courriel.txt", qui s ouvre dans le Bloc-notes.
echo     Il contient le dialogue avec le serveur : c est lui qui
echo     dit ou la conversation s est arretee.
echo.
echo     Envoyez ce fichier tel quel si le message affiche ne
echo     suffit pas a comprendre.
echo   ============================================================
start "" notepad "%RAPPORT%"
goto :fin

:reussite
echo.
echo   ============================================================
echo     Message parti. Regardez votre boite de reception, et le
echo     dossier des indesirables : une premiere adresse
echo     d expedition y atterrit souvent.
echo   ============================================================

:fin
echo.
pause
