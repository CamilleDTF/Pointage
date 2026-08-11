@echo off
rem ---------------------------------------------------------------------------
rem  Installe l'application en service Windows, sur un serveur.
rem
rem  Double-cliquez : les droits administrateur sont demandes tout seuls.
rem
rem  Difference avec DEMARRER.bat : DEMARRER.bat est fait pour un poste ou
rem  quelqu'un est assis. Il tient l'application dans sa fenetre — la fermer,
rem  ou se deconnecter du serveur, arrete tout. Ce fichier-ci installe
rem  l'application en service : elle demarre avec la machine, tourne sans
rem  session ouverte, et repart seule apres un plantage.
rem
rem  Ecrit volontairement sans accents : l'invite de commandes Windows les
rem  affiche mal avec sa page de codes par defaut.
rem ---------------------------------------------------------------------------

setlocal
cd /d "%~dp0"
title Pointage - installation du service

rem  "net session" echoue pour un utilisateur ordinaire : c'est le test
rem  d'elevation le plus court qui ne depende d'aucun outil supplementaire.
rem  "net session" echoue pour un utilisateur ordinaire : c'est le test
rem  d'elevation le plus court qui ne depende d'aucun outil supplementaire.
rem  Les eventuels arguments sont repasses a la fenetre elevee — sans quoi un
rem  "-Port 8080" serait perdu en silence, et le service ecouterait ailleurs
rem  que la ou on le croit.
net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Demande des droits administrateur...
  echo.
  if "%~1"=="" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  ) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs -ArgumentList '%*'"
  )
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\service-windows.ps1" -Action installer %*
