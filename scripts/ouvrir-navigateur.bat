@echo off
rem  Ouvre le navigateur une fois le serveur pret.
rem
rem  Ce fichier existe pour lui-meme : imbriquer une temporisation et un "start"
rem  dans une seule ligne de DEMARRER.bat demande des guillemets echappes que
rem  l'interpreteur de commandes Windows analyse mal. Un fichier separe evite
rem  toute imbrication.

ping -n 6 127.0.0.1 >nul
start http://localhost:3000
