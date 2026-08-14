'use strict';

/**
 * Le compte administrateur tient l'application ; il ne touche pas aux salaires.
 *
 * Deux personnes se cachaient dans le compte directeur : celle qui dirige, et
 * celle qui cree les comptes et repare ce qui coince. Les separer n'a de sens
 * que si la seconde ne peut pas redevenir la premiere — ce que ce fichier
 * verifie, en essayant precisement les chemins par lesquels elle le pourrait.
 *
 * Le plus important est le dernier bloc : un administrateur qui remettrait le
 * code du directeur se connecterait sous son identite, resaisirait ce code
 * quand les montants le demandent, et tout le cloisonnement tomberait par cette
 * seule route.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-admin-'));

const { db } = require('../server/db');
const { hacherPin } = require('../server/auth');
const app = require('../server/index');

let base;
let serveur;
let idDirecteur;
let idChef;
let idAdmin;

function creerUtilisateur(nom, identifiant, pin, role) {
  return db
    .prepare('INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES (?, ?, ?, ?)')
    .run(nom, identifiant, role, hacherPin(pin)).lastInsertRowid;
}

test.before(async () => {
  idChef = creerUtilisateur('CHEF A', 'chefa', '1111', 'chef');
  idDirecteur = creerUtilisateur('DIRECTION', 'dir', '9999', 'directeur');
  idAdmin = creerUtilisateur('ADMIN Technique', 'admin', '7777', 'admin');

  db.prepare('INSERT INTO salaries (matricule, nom, prenom, chef_id, taux_horaire) VALUES (?, ?, ?, ?, ?)')
    .run('A1', 'ANDRE', 'Alain', idChef, 15.5);
  db.prepare('INSERT INTO salaries (matricule, nom, prenom, chef_id, productif, taux_horaire) VALUES (?, ?, ?, ?, 0, ?)')
    .run('N1', 'ZENDJEBIL', 'Veronique', null, 16.25);

  await new Promise((resolve) => { serveur = app.listen(0, resolve); });
  base = `http://127.0.0.1:${serveur.address().port}`;
});

test.after(() => {
  serveur.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

async function connexion(identifiant, pin) {
  const reponse = await fetch(`${base}/api/connexion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifiant, pin }),
  });
  assert.equal(reponse.status, 200, `connexion ${identifiant} refusee`);
  const cookie = reponse.headers.getSetCookie()[0].split(';')[0];
  return async (methode, chemin, corps) => {
    const r = await fetch(`${base}${chemin}`, {
      method: methode,
      headers: corps ? { Cookie: cookie, 'Content-Type': 'application/json' } : { Cookie: cookie },
      body: corps ? JSON.stringify(corps) : undefined,
    });
    let donnees = null;
    try { donnees = await r.json(); } catch { /* 204, ou un corps vide */ }
    return { statut: r.status, donnees };
  };
}

const sansCookie = async (methode, chemin, corps) => {
  const r = await fetch(`${base}${chemin}`, {
    method: methode,
    headers: corps ? { 'Content-Type': 'application/json' } : {},
    body: corps ? JSON.stringify(corps) : undefined,
  });
  return { statut: r.status, donnees: await r.json().catch(() => null) };
};

/* ------------------------- Ce que l'administrateur tient ------------------- */

test("l'administrateur gere les comptes et l'effectif", async () => {
  const admin = await connexion('admin', '7777');

  const liste = await admin('GET', '/api/admin/utilisateurs');
  assert.equal(liste.statut, 200);
  assert.ok(liste.donnees.utilisateurs.length >= 3, 'il doit voir les comptes');

  const cree = await admin('POST', '/api/admin/utilisateurs', {
    nom: 'NOUVEAU', prenom: 'Chef', identifiant: 'chefn', pin: '4321', role: 'chef',
  });
  assert.equal(cree.statut, 200, 'il doit pouvoir creer un chef');

  const code = await admin('POST', `/api/admin/utilisateurs/${idChef}/code`, { pin: '5555' });
  assert.equal(code.statut, 200, 'il doit pouvoir remettre le code d un chef');
});

test("l'administrateur lit le pointage sans le decider", async () => {
  const admin = await connexion('admin', '7777');

  const tableau = await admin('GET', '/api/tableau?annee=2026&semaine=33');
  assert.equal(tableau.statut, 200, 'le tableau de bord lui est ouvert');

  const fiches = await admin('GET', '/api/fiches?annee=2026&semaine=33');
  assert.equal(fiches.statut, 200, 'la liste des fiches lui est ouverte');

  // Mais aucune ecriture sur le pointage.
  const semaine = await admin('POST', '/api/fiches/semaine', { annee: 2026, semaine: 33, chefId: idChef });
  assert.equal(semaine.statut, 403, 'il ne cree pas de fiche');

  const decision = await admin('POST', '/api/fiches/1/decision', { decision: 'valider' });
  assert.equal(decision.statut, 403, 'il ne valide pas');

  const conge = await admin('POST', '/api/conges', { salarieId: 1, debut: '2026-08-10', fin: '2026-08-11', motif: 'CP' });
  assert.equal(conge.statut, 403, 'il n enregistre pas de conge');
});

/* --------------------------- Le mur des salaires -------------------------- */

test("l'administrateur n'obtient aucun montant", async () => {
  const admin = await connexion('admin', '7777');

  for (const chemin of [
    '/api/admin/taux',
    '/api/mois?annee=2026&mois=8',
    '/api/export/mois-apercu?annee=2026&mois=8',
    '/api/non-productif?annee=2026&mois=8',
    '/api/non-productif/paie?annee=2026&mois=8',
    `/api/admin/salaries/${1}/dossier`,
  ]) {
    const r = await admin('GET', chemin);
    assert.equal(r.statut, 403, `${chemin} doit lui etre ferme`);
  }

  // Le billet de paie est la mecanique qui ouvre les montants : meme muni de
  // son propre code, un administrateur n'en obtient pas.
  const billet = await admin('POST', '/api/paie/billet', { pin: '7777' });
  assert.equal(billet.statut, 403, 'aucun billet de paie pour un administrateur');
});

test('le taux horaire ne part jamais vers un administrateur', async () => {
  const admin = await connexion('admin', '7777');
  const directeur = await connexion('dir', '9999');

  const vuAdmin = await admin('GET', '/api/admin/utilisateurs');
  for (const s of vuAdmin.donnees.salaries) {
    assert.equal('taux_horaire' in s, false, `${s.nom} ne doit pas porter son taux`);
  }

  const npAdmin = await admin('GET', '/api/admin/non-productifs');
  for (const s of npAdmin.donnees.salaries) {
    assert.equal('taux_horaire' in s, false, `${s.nom} ne doit pas porter son taux`);
  }

  // La direction, elle, en a besoin : la colonne ne disparait pas pour tous.
  const vuDirecteur = await directeur('GET', '/api/admin/utilisateurs');
  assert.ok(
    vuDirecteur.donnees.salaries.some((s) => 'taux_horaire' in s),
    'le directeur doit continuer de voir les taux'
  );

  // Et il ne peut pas non plus en poser un.
  await admin('PUT', '/api/admin/salaries/1', { matricule: 'A1-bis', taux_horaire: 99 });
  const apres = db.prepare('SELECT matricule, taux_horaire FROM salaries WHERE id = 1').get();
  assert.equal(apres.matricule, 'A1-bis', 'le reste de la correction doit passer');
  assert.equal(apres.taux_horaire, 15.5, 'le taux doit etre reste inchange');
});

/* ------------- La porte par laquelle tout le mur s'effondrerait ----------- */

test("l'administrateur ne peut pas se donner l'identite de la direction", async () => {
  const admin = await connexion('admin', '7777');

  const remise = await admin('POST', `/api/admin/utilisateurs/${idDirecteur}/code`, { pin: '0000' });
  assert.equal(remise.statut, 403, 'remettre le code du directeur doit etre refuse');

  const creation = await admin('POST', '/api/admin/utilisateurs', {
    nom: 'FAUX', prenom: 'Directeur', identifiant: 'faux', pin: '1234', role: 'directeur',
  });
  assert.equal(creation.statut, 403, 'creer un compte de direction doit etre refuse');

  const modif = await admin('PUT', `/api/admin/utilisateurs/${idDirecteur}`, { identifiant: 'dir2' });
  assert.equal(modif.statut, 403, 'modifier un compte de direction doit etre refuse');

  const desactive = await admin('POST', `/api/admin/utilisateurs/${idDirecteur}/actif`, { actif: 0 });
  assert.equal(desactive.statut, 403, 'desactiver la direction doit etre refuse');

  // Le code du directeur doit etre reste le sien : la preuve par la connexion.
  await connexion('dir', '9999');
  const compte = db.prepare('SELECT actif FROM utilisateurs WHERE id = ?').get(idDirecteur);
  assert.equal(compte.actif, 1, 'le compte de direction doit etre reste actif');
});

/* ------------------------- La question de reprise ------------------------- */

test('la direction depose sa question, et le code actuel est exige', async () => {
  const directeur = await connexion('dir', '9999');

  const avant = await directeur('GET', '/api/ma-reprise');
  assert.equal(avant.donnees.definie, false);
  assert.equal(avant.donnees.recommandee, true, 'la direction doit y etre invitee');

  const sansCode = await directeur('POST', '/api/ma-reprise', {
    question: 'Le prenom de mon premier chef de chantier ?', reponse: 'Gerard', actuel: '0000',
  });
  assert.equal(sansCode.statut, 401, 'sans le code actuel, la question ne se change pas');

  const trop = await directeur('POST', '/api/ma-reprise', {
    question: 'Court ?', reponse: 'Gerard', actuel: '9999',
  });
  assert.equal(trop.statut, 400, 'une question trop courte est refusee');

  const pose = await directeur('POST', '/api/ma-reprise', {
    question: 'Le prenom de mon premier chef de chantier ?', reponse: '  Gérard ', actuel: '9999',
  });
  assert.equal(pose.statut, 200);

  const apres = await directeur('GET', '/api/ma-reprise');
  assert.equal(apres.donnees.definie, true);
  assert.match(apres.donnees.question, /premier chef de chantier/);
});

test('la reponse est hachee, jamais lisible en base', () => {
  const compte = db
    .prepare('SELECT reponse_reprise_hash FROM utilisateurs WHERE id = ?')
    .get(idDirecteur);
  assert.ok(compte.reponse_reprise_hash.startsWith('$2'), 'ce doit etre un condensat bcrypt');
  assert.doesNotMatch(compte.reponse_reprise_hash, /erard/i, 'la reponse ne doit pas s y lire');
});

test('repondre juste permet de reposer un code, sans passer par personne', async () => {
  const question = await sansCookie('POST', '/api/reprise/question', { identifiant: 'dir' });
  assert.equal(question.statut, 200);
  assert.equal(question.donnees.definie, true);
  assert.match(question.donnees.question, /premier chef de chantier/);

  const faux = await sansCookie('POST', '/api/reprise/code', {
    identifiant: 'dir', reponse: 'Marcel', nouveau: '1234',
  });
  assert.equal(faux.statut, 401, 'une mauvaise reponse ne rouvre rien');

  // La casse, les accents et les espaces ne doivent pas enfermer dehors.
  const bon = await sansCookie('POST', '/api/reprise/code', {
    identifiant: 'dir', reponse: 'GERARD', nouveau: '8642',
  });
  assert.equal(bon.statut, 200, 'la bonne reponse doit ouvrir');

  await connexion('dir', '8642');
  const ancien = await fetch(`${base}/api/connexion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifiant: 'dir', pin: '9999' }),
  });
  assert.equal(ancien.status, 401, "l'ancien code ne doit plus valoir");
});

test('la reprise ne renseigne pas sur les comptes qu elle refuse', async () => {
  // Identifiant inconnu, compte qui n'est pas de la direction, directeur sans
  // question : une seule et meme reponse, sinon la route devient un annuaire.
  const inconnu = await sansCookie('POST', '/api/reprise/question', { identifiant: 'personne' });
  const chef = await sansCookie('POST', '/api/reprise/question', { identifiant: 'chefa' });
  assert.equal(inconnu.donnees.definie, false);
  assert.equal(chef.donnees.definie, false);
  assert.equal(inconnu.donnees.message, chef.donnees.message, 'le refus doit etre indistinct');

  // Et un chef ne se voit pas offrir cette porte : il a l'administration.
  const admin = await connexion('admin', '7777');
  const sienne = await admin('GET', '/api/ma-reprise');
  assert.equal(sienne.donnees.recommandee, false);
});

test('les essais de reprise sont comptes', async () => {
  const identifiant = 'dir';
  let derniere = { statut: 0 };
  // Huit essais sont tolerés par quart d'heure ; le neuvieme doit etre refuse
  // sans meme etre examine, sinon la question serait une serrure a forcer.
  for (let i = 0; i < 10; i += 1) {
    derniere = await sansCookie('POST', '/api/reprise/code', {
      identifiant, reponse: `essai-${i}`, nouveau: '1111',
    });
  }
  assert.equal(derniere.statut, 429, 'le compteur doit finir par fermer la porte');

  // Le vrai code n'a pas bouge pendant ces essais.
  await connexion('dir', '8642');
});

/* ------------- Le code initial, que l'administrateur connait -------------- */

/*
 * Le dernier endroit ou le cloisonnement reposait sur la bonne volonte.
 *
 * C'est l'administrateur qui cree les comptes : il connait donc leur code de
 * depart, forcement. Rien n'obligeait a le changer, si bien qu'il pouvait se
 * connecter sous l'identite d'un autre aussi longtemps que celui-ci ne s'en
 * souciait pas. Un compte au code provisoire ne peut desormais rien faire
 * d'autre que choisir le sien.
 */
test('un code pose par un tiers n ouvre que la porte pour en changer', async () => {
  const admin = await connexion('admin', '7777');
  const cree = await admin('POST', '/api/admin/utilisateurs', {
    nom: 'PROVISOIRE', prenom: 'Test', identifiant: 'provisoire', pin: '3333', role: 'chef',
  });
  assert.equal(cree.statut, 200);

  const neuf = await connexion('provisoire', '3333');
  assert.equal((await neuf('GET', '/api/moi')).statut, 200, 'savoir qui l on est reste permis');

  // Mais rien d'autre, pas meme une lecture.
  for (const chemin of ['/api/fiches', '/api/reference']) {
    const r = await neuf('GET', chemin);
    assert.equal(r.statut, 403, `${chemin} doit etre ferme`);
    assert.equal(r.donnees.codeProvisoire, true, "l'ecran doit savoir pourquoi");
  }

  // Choisir son code leve le blocage — et ferme les sessions ouvertes ailleurs.
  const ancienne = await connexion('provisoire', '3333');
  const adoption = await neuf('POST', '/api/mon-code', { actuel: '3333', nouveau: '4444' });
  assert.equal(adoption.statut, 200);
  assert.equal((await ancienne('GET', '/api/fiches')).statut, 401, 'les autres sessions tombent');

  const sien = await connexion('provisoire', '4444');
  assert.equal((await sien('GET', '/api/fiches')).statut, 200, 'le compte est desormais ouvert');
});

test('le compte de direction ne demarre pas ouvert a qui l a cree', () => {
  /*
   * Le compte est cree en ligne de commande par l'administrateur technique :
   * c'est le seul chemin possible, personne dans l'application ne peut creer un
   * directeur. Son code de depart est donc connu de lui, et doit etre marque.
   */
  const { execFileSync } = require('node:child_process');
  execFileSync(process.execPath, [
    'scripts/creer-compte.js',
    '--nom', 'DIRECTION Deux', '--identifiant', 'dir2', '--code', '112233', '--role', 'directeur',
  ], { env: { ...process.env, DATA_DIR: process.env.DATA_DIR }, cwd: path.join(__dirname, '..') });

  const compte = db.prepare("SELECT role, code_provisoire FROM utilisateurs WHERE identifiant = 'dir2'").get();
  assert.equal(compte.role, 'directeur');
  assert.equal(compte.code_provisoire, 1, 'un code pose en ligne de commande est provisoire');
});
