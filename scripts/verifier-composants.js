'use strict';

/*
 * Les composants installes correspondent-ils a ceux que l'application attend ?
 *
 * Les lanceurs verifiaient une liste ecrite en dur — express, better-sqlite3,
 * exceljs. Le jour ou une dependance s'est ajoutee, une installation existante
 * a demarre sans elle et s'est arretee sur un ecran d'erreur, alors que la
 * verification devait justement eviter cela. On lit donc package.json : la
 * liste ne peut plus prendre du retard sur la realite.
 *
 * N'utilise que des modules de Node : il doit pouvoir s'executer precisement
 * quand rien n'est installe.
 *
 *   node scripts/verifier-composants.js        -> 0 si tout est la, 1 sinon
 */

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const paquet = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8'));
const attendus = Object.keys(paquet.dependencies || {});

const manquants = attendus.filter(
  (nom) => !fs.existsSync(path.join(RACINE, 'node_modules', ...nom.split('/'), 'package.json'))
);

if (manquants.length) {
  console.log(`MANQUANTS ${manquants.join(' ')}`);
  process.exit(1);
}

console.log('COMPLET');
process.exit(0);
