'use strict';

/**
 * Verifie qu'un code de connexion ne donne acces qu'aux donnees de son
 * titulaire : chaque chef d'equipe ne voit que ses propres fiches et sa propre
 * equipe, seul le directeur voit l'ensemble.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-test-'));

const { db } = require('../server/db');
const { hacherPin } = require('../server/auth');
const app = require('../server/index');

let base;
let serveur;

function creerUtilisateur(nom, identifiant, pin, role) {
  return db
    .prepare('INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES (?, ?, ?, ?)')
    .run(nom, identifiant, role, hacherPin(pin)).lastInsertRowid;
}

test.before(async () => {
  const chefA = creerUtilisateur('CHEF A', 'chefa', '1111', 'chef');
  const chefB = creerUtilisateur('CHEF B', 'chefb', '2222', 'chef');
  creerUtilisateur('DIRECTION', 'dir', '9999', 'directeur');

  db.prepare('INSERT INTO salaries (matricule, nom, prenom, chef_id) VALUES (?, ?, ?, ?)')
    .run('A1', 'ANDRE', 'Alain', chefA);
  db.prepare('INSERT INTO salaries (matricule, nom, prenom, chef_id) VALUES (?, ?, ?, ?)')
    .run('B1', 'BERTIN', 'Bruno', chefB);

  await new Promise((resolve) => {
    serveur = app.listen(0, resolve);
  });
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
    const type = r.headers.get('content-type') || '';
    return { statut: r.status, corps: type.includes('json') ? await r.json() : null };
  };
}

test('un code inconnu ou errone ne donne aucun acces', async () => {
  for (const essai of [
    { identifiant: 'chefa', pin: '0000' },
    { identifiant: 'inconnu', pin: '1111' },
  ]) {
    const r = await fetch(`${base}/api/connexion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(essai),
    });
    assert.equal(r.status, 401);
  }
});

test('sans connexion, aucune donnee n est servie', async () => {
  for (const chemin of ['/api/fiches', '/api/reference', '/api/tableau', '/api/admin/utilisateurs']) {
    const r = await fetch(`${base}${chemin}`);
    assert.equal(r.status, 401, `${chemin} devrait exiger une connexion`);
  }
});

test('chaque chef ne recoit que sa propre equipe', async () => {
  const a = await connexion('chefa', '1111');
  const b = await connexion('chefb', '2222');

  const refA = await a('GET', '/api/reference');
  const refB = await b('GET', '/api/reference');

  assert.deepEqual(refA.corps.equipe.map((s) => s.nom), ['ANDRE']);
  assert.deepEqual(refB.corps.equipe.map((s) => s.nom), ['BERTIN']);
  // Un chef ne voit pas la liste de ses collegues.
  assert.deepEqual(refA.corps.chefs, []);
});

test('un chef ne voit pas la fiche d un autre chef', async () => {
  const a = await connexion('chefa', '1111');
  const b = await connexion('chefb', '2222');

  const creation = await a('POST', '/api/fiches/semaine', { annee: 2026, semaine: 10 });
  assert.equal(creation.statut, 200);
  const ficheA = creation.corps.fiche.id;

  assert.equal((await a('GET', `/api/fiches/${ficheA}`)).statut, 200);
  assert.equal((await b('GET', `/api/fiches/${ficheA}`)).statut, 403);
  assert.equal((await b('PUT', `/api/fiches/${ficheA}`, { chantier: 'detourne' })).statut, 403);
  assert.equal((await b('POST', `/api/fiches/${ficheA}/soumettre`)).statut, 403);
  assert.equal((await b('GET', `/api/export/fiche/${ficheA}.xlsx`)).statut, 403);

  // La liste des fiches est filtree sur son titulaire.
  assert.equal((await a('GET', '/api/fiches')).corps.fiches.length, 1);
  assert.equal((await b('GET', '/api/fiches')).corps.fiches.length, 0);
});

test('un chef ne peut pas creer de fiche au nom d un autre chef', async () => {
  const a = await connexion('chefa', '1111');
  const b = await connexion('chefb', '2222');

  const chefB = db.prepare("SELECT id FROM utilisateurs WHERE identifiant = 'chefb'").get().id;
  const creation = await a('POST', '/api/fiches/semaine', { annee: 2026, semaine: 11, chefId: chefB });
  assert.equal(creation.statut, 200);
  // Le chefId transmis est ignore : la fiche reste rattachee a son auteur.
  assert.notEqual(creation.corps.fiche.chef_id, chefB);
  assert.equal((await b('GET', `/api/fiches/${creation.corps.fiche.id}`)).statut, 403);
});

test('les ecrans du directeur sont fermes aux chefs d equipe', async () => {
  const a = await connexion('chefa', '1111');
  for (const [methode, chemin] of [
    ['GET', '/api/tableau'],
    ['GET', '/api/admin/utilisateurs'],
    ['POST', '/api/admin/salaries'],
    ['GET', '/api/export/periode.xlsx'],
    ['GET', '/api/export/periode.csv'],
  ]) {
    assert.equal((await a(methode, chemin, methode === 'POST' ? {} : undefined)).statut, 403, chemin);
  }
});

test('un chef ne peut ni valider ni renvoyer une fiche', async () => {
  const a = await connexion('chefa', '1111');
  const fiche = (await a('POST', '/api/fiches/semaine', { annee: 2026, semaine: 12 })).corps.fiche;
  assert.equal((await a('POST', `/api/fiches/${fiche.id}/decision`, { decision: 'valider' })).statut, 403);
});

test('le directeur voit et corrige toutes les fiches', async () => {
  const a = await connexion('chefa', '1111');
  const d = await connexion('dir', '9999');

  const fiche = (await a('POST', '/api/fiches/semaine', { annee: 2026, semaine: 13 })).corps.fiche;
  assert.equal((await d('GET', `/api/fiches/${fiche.id}`)).statut, 200);

  const correction = await d('PUT', `/api/fiches/${fiche.id}`, { chantier: 'Corrige par la direction' });
  assert.equal(correction.statut, 200);
  assert.equal(correction.corps.fiche.chantier, 'Corrige par la direction');

  const tableau = await d('GET', '/api/tableau?annee=2026&semaine=13');
  assert.equal(tableau.statut, 200);
  assert.equal(tableau.corps.suivi.length, 2); // les deux chefs sont suivis
});

test('une fiche transmise n est plus modifiable par son chef', async () => {
  const a = await connexion('chefa', '1111');
  const d = await connexion('dir', '9999');

  const fiche = (await a('POST', '/api/fiches/semaine', { annee: 2026, semaine: 14 })).corps.fiche;
  const lignes = fiche.lignes.map((ligne, i) => ({
    ...ligne,
    nom_affiche: i === 0 ? 'ANDRE Alain' : '',
    jours_zone: i === 0 ? 5 : 0,
    type_masque: i === 0 ? 'VA' : '',
    jours: ligne.jours.map((j) => ({ ...j, minutes: i === 0 && j.jour <= 4 ? 450 : 0 })),
  }));
  await a('PUT', `/api/fiches/${fiche.id}`, { chantier: 'Chantier test', ville: 'Toulouse', lignes });

  assert.equal((await a('POST', `/api/fiches/${fiche.id}/soumettre`)).statut, 200);
  assert.equal((await a('PUT', `/api/fiches/${fiche.id}`, { chantier: 'Apres coup' })).statut, 409);

  // Le directeur, lui, reste libre de corriger puis de valider.
  assert.equal((await d('PUT', `/api/fiches/${fiche.id}`, { ville: 'Blagnac' })).statut, 200);
  assert.equal((await d('POST', `/api/fiches/${fiche.id}/decision`, { decision: 'valider' })).statut, 200);
});

test('une correction partielle du directeur ne detruit pas la saisie du chef', async () => {
  const a = await connexion('chefa', '1111');
  const d = await connexion('dir', '9999');

  const fiche = (await a('POST', '/api/fiches/semaine', { annee: 2026, semaine: 15 })).corps.fiche;
  const lignes = fiche.lignes.map((ligne, i) => ({
    ...ligne,
    nom_affiche: i === 0 ? 'ANDRE Alain' : '',
    jours: ligne.jours.map((j) => ({ ...j, minutes: i === 0 && j.jour <= 4 ? 450 : 0 })),
  }));
  await a('PUT', `/api/fiches/${fiche.id}`, { chantier: 'Chantier test', ville: 'Toulouse', lignes });

  // Le directeur ne corrige que la ville : les heures doivent survivre.
  const apres = await d('PUT', `/api/fiches/${fiche.id}`, { ville: 'Blagnac' });
  assert.equal(apres.statut, 200);
  assert.equal(apres.corps.fiche.ville, 'Blagnac');
  assert.equal(apres.corps.fiche.chantier, 'Chantier test');
  assert.equal(apres.corps.fiche.lignes.length, 11);
  assert.equal(apres.corps.fiche.lignes[0].nom_affiche, 'ANDRE Alain');
  assert.equal(apres.corps.fiche.total_minutes, 2250);
});

test('le cookie de session s adapte au protocole reellement utilise', async () => {
  const connecter = (entetes) =>
    fetch(`${base}/api/connexion`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...entetes },
      body: JSON.stringify({ identifiant: 'chefa', pin: '1111' }),
    });

  // Sur le reseau local, en http:// : un cookie Secure serait rejete par le
  // navigateur, et la connexion echouerait sans le moindre message.
  const clair = await connecter({});
  assert.equal(clair.status, 200);
  assert.ok(!clair.headers.getSetCookie()[0].includes('Secure'), 'pas de Secure en HTTP simple');

  // Derriere Tailscale ou un reverse proxy, la connexion est chiffree : le
  // cookie doit alors porter Secure.
  const chiffre = await connecter({ 'X-Forwarded-Proto': 'https' });
  assert.equal(chiffre.status, 200);
  assert.ok(chiffre.headers.getSetCookie()[0].includes('Secure'), 'Secure attendu derriere un proxy HTTPS');

  // Dans les deux cas, la session obtenue reste utilisable.
  for (const reponse of [clair, chiffre]) {
    const cookie = reponse.headers.getSetCookie()[0].split(';')[0];
    const moi = await fetch(`${base}/api/moi`, { headers: { Cookie: cookie } });
    assert.equal(moi.status, 200);
  }
});

test('le calendrier ne montre que les semaines du chef connecte', async () => {
  const a = await connexion('chefa', '1111');
  const b = await connexion('chefb', '2222');

  db.exec('DELETE FROM fiches');
  const fiche = (await a('POST', '/api/fiches/semaine', { annee: 2026, semaine: 20 })).corps.fiche;
  await a('PUT', `/api/fiches/${fiche.id}`, { chantier: 'Chantier A', ville: 'Toulouse' });

  const calendrierA = await a('GET', '/api/calendrier?annee=2026');
  const calendrierB = await b('GET', '/api/calendrier?annee=2026');
  assert.equal(calendrierA.statut, 200);

  // 2026 compte 53 semaines : le calendrier les couvre toutes.
  assert.equal(calendrierA.corps.semaines.length, 53);
  assert.equal(calendrierA.corps.semaines.filter((s) => s.fiche).length, 1);
  assert.equal(calendrierB.corps.semaines.filter((s) => s.fiche).length, 0, 'le chef B ne voit rien du chef A');

  const s20 = calendrierA.corps.semaines.find((s) => s.semaine === 20);
  assert.equal(s20.etat, 'brouillon');
  assert.equal(s20.fiche.chantier, 'Chantier A');

  // Une semaine encore a venir n'est pas un retard.
  const derniere = calendrierA.corps.semaines[52];
  assert.equal(derniere.etat, 'avenir');
  assert.equal(calendrierA.corps.totaux.brouillon, 1);

  // La semaine 1 se range en janvier, bien que son lundi tombe en decembre.
  assert.equal(calendrierA.corps.semaines[0].mois, 1);
  assert.equal(calendrierA.corps.semaines[0].debut.slice(5, 7), '12');
});
