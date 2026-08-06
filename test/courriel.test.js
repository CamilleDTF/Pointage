'use strict';

/*
 * Le plafond de temps sur l'envoi d'un courriel.
 *
 * Ce n'est pas un detail de confort : `soumettre` attend l'envoi avant de
 * repondre au chef d'equipe. Sans plafond, un port bloque par le pare-feu — le
 * 25 l'est presque partout — laissait tourner la roue une minute ou deux apres
 * un appui sur « transmettre », pour finir sur un echec. La fiche est deja
 * enregistree a ce moment-la : il faut renoncer vite et le dire.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-courriel-'));

/*
 * Un serveur qui accepte la connexion et ne dit plus rien : le pire cas, celui
 * qui fait attendre. Un port simplement ferme, lui, refuse tout de suite.
 */
let muet;
let port;

test.before(async () => {
  muet = net.createServer(() => {}); // aucune banniere, aucune reponse
  await new Promise((resoudre) => muet.listen(0, '127.0.0.1', resoudre));
  port = muet.address().port;

  process.env.SMTP_HOTE = '127.0.0.1';
  process.env.SMTP_PORT = String(port);
  process.env.COURRIEL_EXPEDITEUR = 'pointage@exemple.fr';
  process.env.SMTP_DELAI_MS = '1500'; // le test ne va pas patienter vingt secondes
});

test.after(() => {
  muet.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

test('un serveur muet ne fait pas attendre le chef d equipe indefiniment', async () => {
  const C = require('../server/courriel');
  assert.equal(C.ACTIF, true, 'le transport doit etre actif pour ce test');

  const debut = Date.now();
  const resultat = await C.envoyer({
    destinataire: 'conducteur@exemple.fr',
    sujet: 'Essai',
    html: '<p>Essai</p>',
    texte: 'Essai',
  });
  const duree = Date.now() - debut;

  assert.equal(resultat.envoye, false);
  assert.match(resultat.raison, /n'a pas repondu/);
  assert.ok(duree < 6000, `l'envoi a mis ${duree} ms a renoncer`);

  // Et le message n'est pas perdu : il reste lisible sur le disque, comme
  // lorsque aucun serveur d'envoi n'est configure.
  assert.ok(resultat.fichier && fs.existsSync(resultat.fichier));
  assert.match(fs.readFileSync(resultat.fichier, 'utf8'), /conducteur@exemple\.fr/);

  C.fermer();
});
