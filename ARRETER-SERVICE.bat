@echo off
rem ---------------------------------------------------------------------------
rem  Retire le service Pointage de ce serveur.
rem
rem  Vos donnees ne sont pas touchees : elles vivent dans le dossier data\, que
rem  ce fichier n'efface jamais. Relancer INSTALLER-SERVICE.bat les retrouve
rem  telles quelles.
rem ---------------------------------------------------------------------------

setlocal
cd /d "%~dp0"
title Pointage - retrait du service

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

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\service-windows.ps1" -Action desinstaller %*
