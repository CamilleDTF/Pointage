'use strict';

/*
 * Le fichier configuration.txt est rempli au bloc-notes par quelqu'un qui n'est
 * pas informaticien : espaces autour du signe egal, guillemets recopies d'une
 * documentation, lignes d'explication laissees en place. Rien de tout cela ne
 * doit empecher un reglage d'etre lu, et une variable deja posee par le
 * systeme doit rester prioritaire.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { charger, lireLigne } = require('../server/configuration');

test('une ligne de reglage se lit malgre les espaces et les guillemets', () => {
  assert.deepEqual(lireLigne('SMTP_HOTE=smtp.office365.com'), ['SMTP_HOTE', 'smtp.office365.com']);
  assert.deepEqual(lireLigne('  SMTP_PORT = 465  '), ['SMTP_PORT', '465']);
  assert.deepEqual(lireLigne('SMTP_MOT_DE_PASSE="abcd efgh ijkl mnop"'), ['SMTP_MOT_DE_PASSE', 'abcd efgh ijkl mnop']);

  // Les explications du fichier d'exemple ne sont pas des reglages.
  assert.equal(lireLigne('rem  Microsoft 365   SMTP_HOTE=smtp.office365.com'), null);
  assert.equal(lireLigne('# une note'), null);
  assert.equal(lireLigne(''), null);
  assert.equal(lireLigne('une phrase sans signe egal'), null);
});

test('les reglages du fichier arrivent dans l environnement, sans ecraser l existant', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-conf-'));
  const fichier = path.join(dossier, 'configuration.txt');
  fs.writeFileSync(
    fichier,
    ['rem essai', 'SMTP_HOTE=smtp.exemple.fr', 'SMTP_PORT=', 'PORT=4242', ''].join('\n')
  );

  process.env.PORT = '3000'; // deja pose par le systeme : il doit gagner
  delete process.env.SMTP_HOTE;
  delete process.env.SMTP_PORT;

  const resultat = charger(fichier);

  assert.equal(resultat.trouve, true);
  assert.equal(process.env.SMTP_HOTE, 'smtp.exemple.fr');
  assert.equal(process.env.PORT, '3000');
  // Une case laissee vide n'est pas un reglage : elle ne doit rien definir.
  assert.equal(process.env.SMTP_PORT, undefined);
  assert.deepEqual(resultat.cles, ['SMTP_HOTE']);

  delete process.env.SMTP_HOTE;
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('l absence de fichier de configuration n est pas une erreur', () => {
  const resultat = charger(path.join(os.tmpdir(), 'fichier-qui-n-existe-pas-pointage.txt'));
  assert.equal(resultat.trouve, false);
  assert.deepEqual(resultat.cles, []);
});

test('le fichier d exemple ne definit aucun reglage tant qu il n est pas rempli', () => {
  // Toutes ses cles sont laissees vides : le copier tel quel sous le nom
  // configuration.txt ne doit rien changer au comportement par defaut.
  const exemple = path.join(__dirname, '..', 'configuration-exemple.txt');
  const lignes = fs.readFileSync(exemple, 'utf8').split(/\r?\n/).map(lireLigne).filter(Boolean);
  assert.ok(lignes.length > 0, 'le fichier d exemple doit contenir des lignes de reglage');
  assert.deepEqual(lignes.filter(([, valeur]) => valeur !== '' && valeur !== '587'), []);
});
