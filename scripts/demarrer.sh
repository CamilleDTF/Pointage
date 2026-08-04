#!/bin/sh
# Demarrage sur un poste, pour essayer l'application sans rien installer d'autre
# que Node.js.  macOS et Linux — sous Windows, utiliser demarrer.ps1.
#
#   ./scripts/demarrer.sh
#
# Relançable sans risque : les donnees deja saisies sont conservees.

set -e
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js est introuvable."
  echo "Installez-le depuis https://nodejs.org (version 22 ou plus), puis relancez ce script."
  exit 1
fi

version=$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')
if [ "$version" -lt 22 ]; then
  echo "Node.js $version détecté, version 22 ou plus requise."
  echo "Mettez à jour depuis https://nodejs.org, puis relancez ce script."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installation des dépendances (une seule fois, comptez une minute)…"
  npm install --no-audit --no-fund
fi

if [ ! -f data/pointage.db ]; then
  echo
  echo "Première utilisation : création du compte directeur."
  node scripts/creer-compte.js --nom "Direction" --identifiant directeur --code 246810 --role directeur
  echo
  echo "Pour charger votre effectif réel :"
  echo "   node scripts/importer-effectif.js <votre-fichier.xlsx> --appliquer"
  echo
fi

echo "Application démarrée sur http://localhost:3000"
echo "Identifiant « directeur », code 246810.  Ctrl+C pour arrêter."
echo
exec node server/index.js
