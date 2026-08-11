@echo off
rem ---------------------------------------------------------------------------
rem  Dit si le service tourne, et montre les dernieres lignes de son journal.
rem
rem  C'est le fichier a lancer quand « l'application ne repond plus » : il
rem  distingue les deux cas qu'on confond toujours — le service arrete, et le
rem  service demarre dont l'application est tombee.
rem ---------------------------------------------------------------------------

setlocal
cd /d "%~dp0"
title Pointage - etat du service

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

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\service-windows.ps1" -Action etat %*
