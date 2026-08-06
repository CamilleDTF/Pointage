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
let portMuet;

test.before(async () => {
  muet = net.createServer(() => {}); // aucune banniere, aucune reponse
  await new Promise((resoudre) => muet.listen(0, '127.0.0.1', resoudre));
  port = muet.address().port;
  portMuet = port;

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

/*
 * Le detail du dialogue avec le serveur est enregistre dans essai-courriel.txt,
 * et ce fichier est fait pour etre envoye a qui aide au depannage. Le mot de
 * passe de la messagerie ne doit donc y apparaitre sous aucune forme — ni en
 * clair, ni dans la ligne d'authentification, qui est encodee mais pas
 * chiffree. La bibliotheque le remplace aujourd'hui par une marque ; ce test
 * est la pour que sa prochaine version ne change pas cela dans notre dos.
 */
test('le detail du dialogue ne contient jamais le mot de passe', async () => {
  const MOT_DE_PASSE = 'MotDePasseQuiNeDoitPasFuir42';

  // Un serveur qui annonce l'authentification, l'accepte, puis prend le message.
  const serveur = net.createServer((flux) => {
    let dansLeMessage = false;
    flux.write('220 essai\r\n');
    flux.on('data', (donnees) => {
      const texte = donnees.toString();
      if (dansLeMessage) {
        if (texte.includes('\r\n.\r\n')) { dansLeMessage = false; flux.write('250 OK\r\n'); }
        return;
      }
      for (const ligne of texte.split('\r\n').filter(Boolean)) {
        if (/^EHLO|^HELO/i.test(ligne)) flux.write('250-essai\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^AUTH/i.test(ligne)) flux.write('235 accepte\r\n');
        else if (/^DATA/i.test(ligne)) { dansLeMessage = true; flux.write('354 allez-y\r\n'); }
        else if (/^QUIT/i.test(ligne)) { flux.write('221 au revoir\r\n'); flux.end(); }
        else flux.write('250 OK\r\n');
      }
    });
  });
  await new Promise((resoudre) => serveur.listen(0, '127.0.0.1', resoudre));

  const journal = [];
  const ecrire = console.log;
  console.log = (...morceaux) => journal.push(morceaux.join(' '));

  try {
    // Le module lit sa configuration au chargement : on le recharge avec la
    // trace allumee, comme le fait l'option --details.
    delete require.cache[require.resolve('../server/courriel')];
    process.env.SMTP_TRACE = '1';
    process.env.SMTP_PORT = String(serveur.address().port);
    process.env.SMTP_UTILISATEUR = 'camille@exemple.fr';
    process.env.SMTP_MOT_DE_PASSE = MOT_DE_PASSE;
    delete process.env.SMTP_DELAI_MS;

    const C = require('../server/courriel');
    const resultat = await C.envoyer({
      destinataire: 'conducteur@exemple.fr', sujet: 'Essai', html: '<p>x</p>', texte: 'x',
    });
    assert.equal(resultat.envoye, true, 'le serveur d essai devait accepter le message');
    C.fermer();
  } finally {
    console.log = ecrire;
    serveur.close();
    delete process.env.SMTP_TRACE;
    delete process.env.SMTP_MOT_DE_PASSE;
  }

  const trace = journal.join('\n');
  assert.ok(trace.includes('AUTH'), "la trace doit bien contenir le dialogue d'authentification");
  assert.ok(!trace.includes(MOT_DE_PASSE), 'le mot de passe apparait en clair dans la trace');

  // Et pas davantage dans les suites encodees, qui se lisent en une seconde.
  for (const morceau of trace.match(/[A-Za-z0-9+/=]{16,}/g) || []) {
    let decode = '';
    try { decode = Buffer.from(morceau, 'base64').toString('utf8'); } catch { continue; }
    assert.ok(!decode.includes(MOT_DE_PASSE), `le mot de passe apparait encode : ${morceau}`);
  }
});

/*
 * Coupe-circuit : un port bloque par le pare-feu ne se debloque pas entre deux
 * fiches. Sans lui, chaque transmission ferait attendre son chef d'equipe le
 * plafond entier, pour un echec connu d'avance.
 */
test('apres trois echecs de connexion, on cesse de faire attendre les chefs', async () => {
  delete require.cache[require.resolve('../server/courriel')];
  process.env.SMTP_PORT = String(portMuet);
  process.env.SMTP_DELAI_MS = '400';
  process.env.SMTP_COUPURE_MS = '60000';
  delete process.env.SMTP_UTILISATEUR;
  delete process.env.SMTP_TRACE;

  const C = require('../server/courriel');
  const message = { destinataire: 'conducteur@exemple.fr', sujet: 'x', html: '<p>x</p>', texte: 'x' };

  for (let i = 1; i <= 3; i += 1) {
    const essai = await C.envoyer(message);
    assert.equal(essai.envoye, false, `l essai ${i} devait echouer`);
    assert.match(essai.raison, /n'a pas repondu/);
  }

  // Le quatrieme n'attend plus : il repond aussitot, et depose le message.
  const debut = Date.now();
  const apres = await C.envoyer(message);
  const duree = Date.now() - debut;

  assert.equal(apres.envoye, false);
  assert.match(apres.raison, /injoignable/);
  assert.ok(duree < 200, `la reponse doit etre immediate, ici ${duree} ms`);
  assert.ok(apres.fichier && fs.existsSync(apres.fichier), 'le message reste conserve sur disque');

  C.fermer();
});
