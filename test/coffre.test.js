'use strict';

/**
 * Le coffre : les montants illisibles hors de l'application.
 *
 * Le cloisonnement par les ecrans ne protege que ceux qui passent par eux. Ce
 * fichier verifie l'autre moitie, la seule qui rende le mur reel : qu'une
 * lecture DIRECTE du fichier `pointage.db` — celle que fait n'importe qui
 * disposant d'une sauvegarde, d'un instantane de machine ou d'un acces au
 * serveur — ne rende plus aucun taux, aucune prime, aucun parametre de paie.
 *
 * Le test central est `aucun montant ne subsiste en clair` : il ne passe par
 * aucune route, il ouvre la base comme le ferait un curieux.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-coffre-'));

const { db } = require('../server/db');
const { hacherPin } = require('../server/auth');
const COFFRE = require('../server/coffre');
const app = require('../server/index');

const PHRASE = 'les fiches de pointage de 2026';
let base;
let serveur;
let idSalarie;
let secours;

test.before(async () => {
  db.prepare('INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES (?, ?, ?, ?)')
    .run('DIRECTION', 'dir', 'directeur', hacherPin('9999'));
  db.prepare('INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES (?, ?, ?, ?)')
    .run('ADMIN', 'admin', 'admin', hacherPin('7777'));

  idSalarie = db
    .prepare('INSERT INTO salaries (matricule, nom, prenom, taux_horaire) VALUES (?, ?, ?, ?)')
    .run('A1', 'ANDRE', 'Alain', 17.42).lastInsertRowid;
  db.prepare('INSERT INTO salaries (matricule, nom, prenom, productif, taux_horaire) VALUES (?, ?, ?, 0, ?)')
    .run('N1', 'ZENDJEBIL', 'Veronique', 16.25);
  db.prepare(
    'INSERT INTO primes_non_productifs (salarie_id, annee, mois, libelle, montant) VALUES (?, 2026, 8, ?, ?)'
  ).run(idSalarie, 'Prime exceptionnelle', 250);

  await new Promise((resolve) => { serveur = app.listen(0, resolve); });
  base = `http://127.0.0.1:${serveur.address().port}`;
});

test.after(() => {
  serveur.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

async function connexion(identifiant, pin) {
  const r = await fetch(`${base}/api/connexion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifiant, pin }),
  });
  assert.equal(r.status, 200, `connexion ${identifiant} refusee`);
  const cookie = r.headers.getSetCookie()[0].split(';')[0];
  return async (methode, chemin, corps, seance) => {
    const entetes = { Cookie: cookie };
    if (corps) entetes['Content-Type'] = 'application/json';
    if (seance) entetes['X-Seance-Paie'] = seance;
    const rep = await fetch(`${base}${chemin}`, {
      method: methode, headers: entetes, body: corps ? JSON.stringify(corps) : undefined,
    });
    let donnees = null;
    try { donnees = await rep.json(); } catch { /* corps vide */ }
    return { statut: rep.status, donnees };
  };
}

/** Ce que verrait quelqu'un qui ouvre le fichier, sans passer par l'application. */
function lireLeFichier(sql) {
  const brut = new Database(path.join(process.env.DATA_DIR, 'pointage.db'), { readonly: true });
  try { return brut.prepare(sql).all(); } finally { brut.close(); }
}

/* --------------------------- Avant le coffre ------------------------------ */

test('sans coffre, le fichier livre tout — c est le point de depart', () => {
  const lignes = lireLeFichier('SELECT nom, taux_horaire FROM salaries WHERE taux_horaire > 0');
  assert.ok(lignes.length >= 2, 'les taux doivent etre lisibles avant la bascule');
  assert.ok(lignes.some((l) => l.taux_horaire === 17.42));
});

/* ---------------------------- La creation --------------------------------- */

test('creer le coffre chiffre l existant et rend une cle de secours', async () => {
  const directeur = await connexion('dir', '9999');

  const avant = await directeur('GET', '/api/coffre');
  assert.equal(avant.donnees.existe, false);
  assert.ok(avant.donnees.montantsEnClair > 0, 'il doit rester du clair avant la bascule');

  const courte = await directeur('POST', '/api/coffre', { phrase: 'trop court' });
  assert.equal(courte.statut, 400, 'une phrase trop courte est refusee');

  const cree = await directeur('POST', '/api/coffre', { phrase: PHRASE });
  assert.equal(cree.statut, 200);
  secours = cree.donnees.secours;
  assert.match(secours, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/, `cle de secours mal formee : ${secours}`);
  assert.ok(cree.donnees.bascule.taux >= 2, 'les taux existants doivent avoir ete chiffres');
  assert.ok(cree.donnees.bascule.primes >= 1, 'les primes aussi');
  assert.equal(cree.donnees.montantsEnClair, 0, 'plus rien ne doit rester en clair');

  const deux = await directeur('POST', '/api/coffre', { phrase: PHRASE });
  assert.equal(deux.statut, 409, 'le coffre ne se recree pas par-dessus');
});

/* -------------------- Le test qui compte vraiment ------------------------- */

test('aucun montant ne subsiste en clair dans le fichier', () => {
  for (const l of lireLeFichier('SELECT nom, taux_horaire FROM salaries')) {
    assert.equal(l.taux_horaire, 0, `${l.nom} porte encore son taux en clair`);
  }
  for (const p of lireLeFichier('SELECT libelle, montant FROM primes_non_productifs')) {
    assert.equal(p.montant, 0, `la prime « ${p.libelle} » porte encore son montant`);
  }
  for (const t of lireLeFichier('SELECT cle, valeur FROM taux')) {
    assert.equal(t.valeur, 0, `le parametre ${t.cle} porte encore sa valeur`);
  }

  // Et le scelle ne laisse pas deviner le nombre qu'il cache.
  const scelles = lireLeFichier("SELECT taux_horaire_scelle FROM salaries WHERE taux_horaire_scelle != ''");
  assert.ok(scelles.length >= 2);
  for (const s of scelles) {
    assert.doesNotMatch(s.taux_horaire_scelle, /17[.,]42|16[.,]25/, 'le montant se lit dans le scelle');
  }
});

test('le journal ne rattrape pas ce que le coffre vient de ranger', async () => {
  const directeur = await connexion('dir', '9999');
  const ouverture = await directeur('POST', '/api/paie/billet', { phrase: PHRASE });
  const seance = ouverture.donnees.seance;

  await directeur('POST', '/api/admin/taux', {
    cle: 'panier_repas', valeur: 13.75, annee: 2026, mois: 9, note: 'essai',
  }, seance);

  const journal = lireLeFichier("SELECT detail FROM journal WHERE action = 'taux_modifie'");
  assert.ok(journal.length >= 1, 'le changement doit rester trace');
  for (const l of journal) {
    assert.doesNotMatch(l.detail, /13[.,]75/, 'le montant ne doit pas fuir par le journal');
  }
});

/* ------------------------------ Les seances -------------------------------- */

test('la phrase ouvre une seance, la mauvaise phrase n ouvre rien', async () => {
  const directeur = await connexion('dir', '9999');

  const faux = await directeur('POST', '/api/paie/billet', { phrase: 'une phrase qui n est pas la bonne' });
  assert.equal(faux.statut, 401);

  // L'ancien code ne vaut plus rien : ce n'est plus une autorisation qu'on
  // demande, c'est une cle.
  const parCode = await directeur('POST', '/api/paie/billet', { pin: '9999' });
  assert.equal(parCode.statut, 401, 'le code seul ne doit plus ouvrir les montants');

  const bon = await directeur('POST', '/api/paie/billet', { phrase: PHRASE });
  assert.equal(bon.statut, 200);
  assert.ok(bon.donnees.seance, 'une seance doit etre rendue');
});

test('sans seance les montants sont refuses, avec seance ils reviennent justes', async () => {
  const directeur = await connexion('dir', '9999');

  const ferme = await directeur('GET', '/api/mois?annee=2026&mois=8&version=direction');
  assert.equal(ferme.statut, 403);
  assert.equal(ferme.donnees.coffreFerme, true);

  const { donnees: { seance } } = await directeur('POST', '/api/paie/billet', { phrase: PHRASE });

  const taux = await directeur('GET', '/api/admin/taux', null, seance);
  assert.equal(taux.statut, 200);
  const panier = taux.donnees.applicables.panier_repas;
  assert.equal(typeof panier, 'number', 'le parametre doit se relire');

  // Le taux horaire revient a l'identique apres l'aller-retour par le coffre.
  const effectif = await directeur('GET', '/api/admin/utilisateurs', null, seance);
  const alain = effectif.donnees.salaries.find((s) => s.nom === 'ANDRE');
  assert.equal(alain.taux_horaire, 17.42, 'le taux doit revenir intact');
  assert.equal('taux_horaire_scelle' in alain, false, 'le scelle ne doit jamais sortir');

  // Coffre ferme, la colonne est vide — et non zero, qui se lirait comme un taux.
  const sansSeance = await directeur('GET', '/api/admin/utilisateurs');
  const memeAlain = sansSeance.donnees.salaries.find((s) => s.nom === 'ANDRE');
  assert.equal(memeAlain.taux_horaire, null, 'sans seance, le taux doit etre absent, pas nul');
});

test('la seance d un compte ne sert pas a un autre', async () => {
  const directeur = await connexion('dir', '9999');
  const admin = await connexion('admin', '7777');
  const { donnees: { seance } } = await directeur('POST', '/api/paie/billet', { phrase: PHRASE });

  const vol = await admin('GET', '/api/admin/utilisateurs', null, seance);
  const alain = vol.donnees.salaries.find((s) => s.nom === 'ANDRE');
  assert.equal('taux_horaire' in alain, false, 'un administrateur ne lit aucun taux, meme avec un jeton vole');

  const montants = await admin('GET', '/api/mois?annee=2026&mois=8&version=direction', null, seance);
  assert.equal(montants.statut, 403, 'et aucune route de montants ne s ouvre a lui');
});

/* ---------------------------- La cle de secours ---------------------------- */

test('la cle de secours ouvre le coffre, meme mal recopiee', async () => {
  const directeur = await connexion('dir', '9999');

  const mauvaise = await directeur('POST', '/api/paie/billet', { secours: 'AAAA-BBBB-CCCC-DDDD-EEEE' });
  assert.equal(mauvaise.statut, 401);

  // Minuscules, espaces au lieu des tirets : c'est la meme cle sur le papier.
  const recopiee = secours.toLowerCase().replace(/-/g, ' ');
  const bonne = await directeur('POST', '/api/paie/billet', { secours: recopiee });
  assert.equal(bonne.statut, 200, 'la cle de secours doit tolerer une recopie humaine');
});

test('changer la phrase ne perd rien, et la cle de secours reste valable', async () => {
  const directeur = await connexion('dir', '9999');
  const { donnees: { seance } } = await directeur('POST', '/api/paie/billet', { phrase: PHRASE });

  const change = await directeur('POST', '/api/coffre/phrase', { nouvelle: 'une toute autre phrase de paie' }, seance);
  assert.equal(change.statut, 200);

  const ancienne = await directeur('POST', '/api/paie/billet', { phrase: PHRASE });
  assert.equal(ancienne.statut, 401, "l'ancienne phrase ne doit plus ouvrir");

  const nouvelle = await directeur('POST', '/api/paie/billet', { phrase: 'une toute autre phrase de paie' });
  assert.equal(nouvelle.statut, 200);

  const parSecours = await directeur('POST', '/api/paie/billet', { secours });
  assert.equal(parSecours.statut, 200, 'la cle imprimee ne doit pas etre invalidee');

  // Et les montants sont toujours la, intacts.
  const effectif = await directeur('GET', '/api/admin/utilisateurs', null, nouvelle.donnees.seance);
  const alain = effectif.donnees.salaries.find((s) => s.nom === 'ANDRE');
  assert.equal(alain.taux_horaire, 17.42);
});

/* ------------------------------- L'ecriture -------------------------------- */

test('poser un taux exige la phrase, et le range scelle', async () => {
  const directeur = await connexion('dir', '9999');

  const ferme = await directeur('PUT', `/api/admin/salaries/${idSalarie}`, { taux_horaire: 20 });
  assert.equal(ferme.statut, 423, 'sans seance, on ne pose pas un taux');

  const { donnees: { seance } } = await directeur('POST', '/api/paie/billet', { secours });
  const pose = await directeur('PUT', `/api/admin/salaries/${idSalarie}`, { taux_horaire: 20 }, seance);
  assert.equal(pose.statut, 200);

  const enBase = lireLeFichier(`SELECT taux_horaire, taux_horaire_scelle FROM salaries WHERE id = ${idSalarie}`)[0];
  assert.equal(enBase.taux_horaire, 0, 'le clair doit rester a zero');
  assert.ok(enBase.taux_horaire_scelle, 'le scelle doit avoir ete ecrit');

  const relu = await directeur('GET', '/api/admin/utilisateurs', null, seance);
  assert.equal(relu.donnees.salaries.find((s) => s.nom === 'ANDRE').taux_horaire, 20);
});

test('une valeur alteree en base ne se dechiffre pas en silence', () => {
  const cle = COFFRE.deverrouiller({ phrase: 'une toute autre phrase de paie' });
  assert.ok(cle, 'le coffre doit s ouvrir pour ce controle');

  const scelle = COFFRE.chiffrerMontant(cle, 42);
  assert.equal(COFFRE.dechiffrerMontant(cle, scelle), 42);

  // Un octet change dans le chiffre : GCM authentifie, cela doit echouer et non
  // rendre un autre nombre. Un taux bricole a la main dans le fichier ne passe
  // donc pas pour un taux valide.
  const altere = `${scelle.slice(0, -6)}${scelle.slice(-6) === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA'}`;
  assert.equal(COFFRE.dechiffrerMontant(cle, altere), null);
});
