'use strict';

/*
 * Les lanceurs verifiaient une liste de composants ecrite en dur. Le jour ou une
 * dependance s'est ajoutee, une installation existante a demarre sans elle et
 * s'est arretee sur un ecran d'erreur — la verification n'avait pas suivi.
 *
 * Deux garde-fous, verifies ici : la liste se lit dans package.json, et l'envoi
 * de courriels reste facultatif.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RACINE = path.join(__dirname, '..');
const paquet = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8'));

test('la verification des composants lit package.json, sans liste ecrite en dur', () => {
  const source = fs.readFileSync(path.join(RACINE, 'scripts', 'verifier-composants.js'), 'utf8');
  assert.match(source, /package\.json/);
  for (const nom of Object.keys(paquet.dependencies)) {
    assert.equal(source.includes(`'${nom}'`), false, `${nom} ne doit pas etre cite en dur`);
  }
});

test('la verification passe sur une installation complete', () => {
  const sortie = execFileSync(process.execPath, ['scripts/verifier-composants.js'], {
    cwd: RACINE,
    encoding: 'utf8',
  });
  assert.match(sortie, /COMPLET/);
});

test('chaque lanceur appelle la verification plutot que sa propre liste', () => {
  for (const fichier of ['DEMARRER.bat', 'REINSTALLER.bat', 'DIAGNOSTIC.bat', 'scripts/demarrer.sh', 'scripts/demarrer.ps1']) {
    const source = fs.readFileSync(path.join(RACINE, fichier), 'utf8');
    assert.match(source, /verifier-composants/, `${fichier} doit utiliser la verification commune`);
  }
});

test('l envoi de courriels est facultatif : son absence n arrete pas le serveur', () => {
  // La bibliotheque d'envoi est chargee dans un try : une installation qui date
  // d'avant son ajout doit demarrer quand meme, en deposant les messages sur
  // disque comme lorsque aucun serveur d'envoi n'est configure.
  const source = fs.readFileSync(path.join(RACINE, 'server', 'courriel.js'), 'utf8');
  const chargement = source.slice(source.indexOf('let nodemailer'), source.indexOf('const DOSSIER_COURRIELS'));
  assert.match(chargement, /try\s*\{[\s\S]*require\('nodemailer'\)[\s\S]*\}\s*catch/);

  const C = require('../server/courriel');
  assert.equal(typeof C.envoyer, 'function');
});
