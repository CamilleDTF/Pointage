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

test('chaque chef recoit son equipe, lui-meme en tete', async () => {
  const a = await connexion('chefa', '1111');
  const b = await connexion('chefb', '2222');

  const refA = await a('GET', '/api/reference');
  const refB = await b('GET', '/api/reference');

  // Le chef d equipe travaille sur le chantier : il ouvre sa propre equipe,
  // donc sa propre fiche.
  assert.deepEqual(refA.corps.equipe.map((s) => s.nom), ['CHEF', 'ANDRE']);
  assert.deepEqual(refB.corps.equipe.map((s) => s.nom), ['CHEF', 'BERTIN']);
  assert.equal(refA.corps.equipe[0].prenom, 'A');

  // Un chef ne voit toujours pas la liste de ses collegues chefs.
  assert.deepEqual(refA.corps.chefs, []);
});

test('tout l effectif est proposable a la saisie, pas seulement son equipe', async () => {
  // Un chantier reunit des operateurs venus d autres equipes : le chef doit
  // pouvoir les pointer sans reaffectation prealable.
  const a = await connexion('chefa', '1111');
  const noms = (await a('GET', '/api/reference')).corps.effectif.map((s) => s.nom);
  assert.ok(noms.includes('ANDRE'), 'son operateur');
  assert.ok(noms.includes('BERTIN'), "l operateur d un autre chef");
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
  await a('PUT', `/api/fiches/${fiche.id}`, { chantier: 'Chantier test', ville: 'Toulouse', zone_deplacement: 'AUTRE', lignes });

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
  await a('PUT', `/api/fiches/${fiche.id}`, { chantier: 'Chantier test', ville: 'Toulouse', zone_deplacement: 'AUTRE', lignes });

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

test('les semaines anterieures a la mise en service ne sont pas reclamees', async () => {
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');

  const calendrier = (await a('GET', '/api/calendrier?annee=2026')).corps;
  assert.equal(calendrier.debutService, '2026-09-01');

  // Fevrier : pointe sur papier, la semaine ne doit rien reclamer.
  const fevrier = calendrier.semaines.find((s) => s.semaine === 7);
  assert.equal(fevrier.etat, 'horsPerimetre');

  // La semaine du 1er septembre (lundi 31 aout) est deja du ressort de l outil.
  const bascule = calendrier.semaines.find((s) => s.debut === '2026-08-31');
  assert.notEqual(bascule.etat, 'horsPerimetre');

  // Et rien de tout cela ne compte comme du retard.
  const horsPerimetre = calendrier.semaines.filter((s) => s.etat === 'horsPerimetre');
  assert.ok(horsPerimetre.length > 30, 'les 8 premiers mois de 2026 sortent du perimetre');
  assert.equal(calendrier.totaux.manquante + calendrier.totaux.brouillon, 0);
});

test('une journee mise a zero par le chef est conservee comme telle', async () => {
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');

  const fiche = (await a('POST', '/api/fiches/semaine', { annee: 2026, semaine: 37 })).corps.fiche;
  // Un seul salarie, un seul jour travaille, les autres declares a zero : le
  // cas que le client signalait comme refuse a tort.
  const lignes = fiche.lignes.map((ligne, i) => ({
    ...ligne,
    nom_affiche: i === 0 ? 'ANDRE Alain' : '',
    signature: i === 0 ? 'data:image/png;base64,xxx' : null,
    jours: ligne.jours.map((j) => ({
      ...j,
      minutes: i === 0 && j.jour === 0 ? 450 : 0,
      saisi: i === 0 && j.jour <= 4 ? 1 : 0,
    })),
  }));
  const enregistree = await a('PUT', `/api/fiches/${fiche.id}`, {
    chantier: 'Chantier test', ville: 'Toulouse', zone_deplacement: 'AUTRE', lignes,
  });
  assert.equal(enregistree.statut, 200);

  const jours = enregistree.corps.fiche.lignes[0].jours;
  assert.equal(jours[0].minutes, 450);
  assert.deepEqual(jours.map((j) => j.saisi), [1, 1, 1, 1, 1, 0, 0]);
  assert.deepEqual(enregistree.corps.anomalies, []);

  // Et la fiche part sans blocage.
  assert.equal((await a('POST', `/api/fiches/${fiche.id}/soumettre`)).statut, 200);
});

test('une journee laissee vide bloque toujours la transmission', async () => {
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');

  const fiche = (await a('POST', '/api/fiches/semaine', { annee: 2026, semaine: 38 })).corps.fiche;
  const lignes = fiche.lignes.map((ligne, i) => ({
    ...ligne,
    nom_affiche: i === 0 ? 'ANDRE Alain' : '',
    jours: ligne.jours.map((j) => ({ ...j, minutes: 0, saisi: i === 0 && j.jour <= 3 ? 1 : 0 })),
  }));
  await a('PUT', `/api/fiches/${fiche.id}`, { chantier: 'Chantier test', ville: 'Toulouse', zone_deplacement: 'AUTRE', lignes });

  const refus = await a('POST', `/api/fiches/${fiche.id}/soumettre`);
  assert.equal(refus.statut, 422);
  const bloquantes = refus.corps.anomalies.filter((x) => x.niveau === 'bloquant');
  assert.equal(bloquantes.length, 1); // le seul vendredi non renseigne
  assert.deepEqual(bloquantes[0].cible, { ligne: 0, jour: 4 });
});

test('un operateur d une autre equipe se pointe et se rattache correctement', async () => {
  // Un chantier reunit souvent des renforts venus d'ailleurs : la ligne doit
  // pointer sur le vrai salarie, sinon la paie ne le reconnait pas.
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');

  const bertin = db.prepare("SELECT id FROM salaries WHERE nom = 'BERTIN' ORDER BY id LIMIT 1").get();
  const fiche = (await a('POST', '/api/fiches/semaine', { annee: 2026, semaine: 39 })).corps.fiche;
  const lignes = fiche.lignes.map((ligne, i) => ({
    ...ligne,
    nom_affiche: i === 0 ? 'BERTIN Bruno' : '',
    salarie_id: i === 0 ? bertin.id : null,
    jours: ligne.jours.map((j) => ({ ...j, minutes: i === 0 && j.jour <= 4 ? 450 : 0 })),
  }));
  const reponse = await a('PUT', `/api/fiches/${fiche.id}`, {
    chantier: 'Chantier partage', ville: 'Toulouse', zone_deplacement: 'AUTRE', lignes,
  });

  assert.equal(reponse.statut, 200);
  assert.equal(reponse.corps.fiche.lignes[0].salarie_id, bertin.id);
  assert.equal(reponse.corps.fiche.total_minutes, 2250);
});

test('la fiche s ouvre pre-remplie avec le chef d equipe en premiere ligne', async () => {
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');

  const fiche = (await a('POST', '/api/fiches/semaine', { annee: 2026, semaine: 41 })).corps.fiche;
  assert.deepEqual(fiche.lignes.slice(0, 2).map((l) => l.nom_affiche), ['CHEF A', 'ANDRE Alain']);

  // La ligne du chef designe bien un salarie : ses heures rejoindront la paie.
  assert.ok(fiche.lignes[0].salarie_id, 'le chef doit etre rattache a une fiche salarie');

  // Et ouvrir une deuxieme semaine ne cree pas un second enregistrement pour lui.
  await a('POST', '/api/fiches/semaine', { annee: 2026, semaine: 42 });
  const doublons = db.prepare("SELECT COUNT(*) AS n FROM salaries WHERE nom = 'CHEF' AND prenom = 'A'").get().n;
  assert.equal(doublons, 1);
});

test('les montants de la paie exigent le code, meme pour un directeur connecte', async () => {
  const d = await connexion('dir', '9999');

  // La version publique s'ouvre sans rien redemander.
  const publique = await d('GET', '/api/mois?annee=2026&mois=9&version=public');
  assert.equal(publique.statut, 200);
  assert.equal(publique.corps.version, 'public');
  // Et elle ne laisse filtrer aucun montant.
  for (const s of publique.corps.salaries) {
    for (const champ of ['tauxHoraire', 'salaireBrut', 'salaireNet', 'totalNet']) {
      assert.equal(s[champ], undefined, `${champ} ne doit pas figurer dans la version publique`);
    }
  }

  // La version direction est refusee tant que le code n'a pas ete ressaisi.
  const refus = await d('GET', '/api/mois?annee=2026&mois=9&version=direction');
  assert.equal(refus.statut, 403);
  assert.equal(refus.corps.codeDemande, true);
  assert.equal((await d('GET', '/api/export/mois.xlsx?annee=2026&mois=9&version=direction')).statut, 403);

  // Un mauvais code ne delivre aucun billet.
  assert.equal((await d('POST', '/api/paie/billet', { pin: '0000' })).statut, 401);

  // Le bon code delivre un billet a usage unique : il ouvre une consultation,
  // et une seule. Le telechargement qui suivrait redemande le code.
  const billet = (await d('POST', '/api/paie/billet', { pin: '9999' })).corps.billet;
  assert.ok(billet, 'un billet est delivre');
  assert.equal((await d('GET', `/api/mois?annee=2026&mois=9&version=direction&billet=${billet}`)).statut, 200);
  assert.equal((await d('GET', `/api/mois?annee=2026&mois=9&version=direction&billet=${billet}`)).statut, 403);
  assert.equal(
    (await d('GET', `/api/export/mois.xlsx?annee=2026&mois=9&version=direction&billet=${billet}`)).statut,
    403,
    'le meme billet ne sert pas deux fois'
  );
});

/*
 * Le tableau du personnel non productif porte les memes salaires : il se protege
 * de la meme facon, et par le meme billet. Les heures, elles, restent lisibles
 * sans code sur le calendrier — c'est l'argent qui se ferme, pas le temps.
 */
test('la paie du personnel non productif exige le code, elle aussi', async () => {
  const d = await connexion('dir', '9999');

  // Le calendrier s'ouvre sans rien redemander : il ne porte aucun montant.
  const calendrier = await d('GET', '/api/non-productif?annee=2026&mois=9');
  assert.equal(calendrier.statut, 200);
  for (const ligne of calendrier.corps.lignes) {
    for (const champ of ['salaireBrut', 'totalNet', 'totalBrut']) {
      assert.equal(ligne[champ], undefined, `${champ} n a rien a faire dans le calendrier`);
    }
  }

  assert.equal((await d('GET', '/api/non-productif/paie?annee=2026&mois=9')).statut, 403);
  assert.equal((await d('GET', '/api/export/non-productif.xlsx?annee=2026&mois=9')).statut, 403);

  const billet = (await d('POST', '/api/paie/billet', { pin: '9999' })).corps.billet;
  assert.equal((await d('GET', `/api/non-productif/paie?annee=2026&mois=9&billet=${billet}`)).statut, 200);
  assert.equal(
    (await d('GET', `/api/non-productif/paie?annee=2026&mois=9&billet=${billet}`)).statut,
    403,
    'le meme billet ne sert pas deux fois'
  );

  // Et un billet du tableau des chantiers ne vaut pas pour celui-ci : chaque
  // ouverture redemande le code, quelle que soit la porte.
  const autre = (await d('POST', '/api/paie/billet', { pin: '9999' })).corps.billet;
  assert.equal((await d('GET', `/api/mois?annee=2026&mois=9&version=direction&billet=${autre}`)).statut, 200);
  assert.equal((await d('GET', `/api/non-productif/paie?annee=2026&mois=9&billet=${autre}`)).statut, 403);
});

/*
 * Un code mal tape n'est pas une session finie.
 *
 * Les deux repondaient 401 sans se distinguer, et l'interface renvoyait a
 * l'ecran de connexion dans les deux cas : se tromper en ressaisissant son code
 * ejectait le directeur du tableau qu'il consultait, sans explication. Seule
 * l'expiration porte desormais le drapeau qui declenche ce retour.
 */
test('un code refuse ne se confond pas avec une session expiree', async () => {
  const d = await connexion('dir', '9999');

  const mauvaisCode = await d('POST', '/api/paie/billet', { pin: '0000' });
  assert.equal(mauvaisCode.statut, 401);
  assert.ok(!mauvaisCode.corps.sessionExpiree, 'un code refuse ne doit pas passer pour une session finie');

  const changement = await d('POST', '/api/mon-code', { actuel: '0000', nouveau: '4321' });
  assert.equal(changement.statut, 401);
  assert.ok(!changement.corps.sessionExpiree);

  // Sans cookie, en revanche, c'est bien la session qui manque.
  const sansSession = await fetch(`${base}/api/moi`);
  assert.equal(sansSession.status, 401);
  assert.equal((await sansSession.json()).sessionExpiree, true);

  const protegee = await fetch(`${base}/api/mois?annee=2026&mois=9`);
  assert.equal(protegee.status, 401);
  assert.equal((await protegee.json()).sessionExpiree, true);
});

test('les ecrans de parametrage et les montants restent fermes aux chefs', async () => {
  const a = await connexion('chefa', '1111');
  for (const [methode, chemin] of [
    ['GET', '/api/mois?annee=2026&mois=9'],
    ['GET', '/api/non-productif?annee=2026&mois=9'],
    ['GET', '/api/non-productif/paie?annee=2026&mois=9'],
    ['GET', '/api/export/non-productif.xlsx?annee=2026&mois=9'],
    ['GET', '/api/admin/vehicules'],
    ['GET', '/api/admin/indicateurs'],
    ['POST', '/api/paie/billet'],
  ]) {
    assert.equal((await a(methode, chemin, methode === 'POST' ? { pin: '1111' } : undefined)).statut, 403, chemin);
  }
});

test('le parc de vehicules est propose a la saisie et modifiable par le directeur', async () => {
  const a = await connexion('chefa', '1111');
  const d = await connexion('dir', '9999');

  const parc = (await a('GET', '/api/reference')).corps.vehicules;
  assert.ok(parc.length >= 14, 'le parc initial est charge');
  const trafic = parc.find((v) => v.immatriculation === 'GR-707-YM');
  assert.equal(`${trafic.marque} ${trafic.modele}`, 'Renault Trafic');

  // Retire du parc, il disparait des propositions faites aux chefs.
  assert.equal((await d('PUT', `/api/admin/vehicules/${trafic.id}`, { actif: 0 })).statut, 200);
  const apres = (await a('GET', '/api/reference')).corps.vehicules;
  assert.ok(!apres.some((v) => v.id === trafic.id));
  await d('PUT', `/api/admin/vehicules/${trafic.id}`, { actif: 1 });
});

test('le taux horaire se renseigne et n apparait jamais en version publique', async () => {
  const d = await connexion('dir', '9999');
  const andre = db.prepare("SELECT id FROM salaries WHERE nom = 'ANDRE'").get();

  assert.equal((await d('PUT', `/api/admin/salaries/${andre.id}`, { taux_horaire: 14.5 })).statut, 200);
  const { salaries } = (await d('GET', '/api/admin/utilisateurs')).corps;
  assert.equal(salaries.find((s) => s.id === andre.id).taux_horaire, 14.5);
});

test('les indicateurs ne reclament rien avant la mise en service', async () => {
  const d = await connexion('dir', '9999');
  const r = await d('GET', '/api/admin/indicateurs');
  assert.equal(r.statut, 200);
  assert.equal(r.corps.debutService, '2026-09-01');
  for (const chef of r.corps.chefs) {
    // Aujourd hui precede la mise en service dans le jeu de test : aucune
    // semaine n est attendue, donc personne n est en retard.
    assert.ok(chef.enRetard <= chef.semainesAttendues);
    assert.ok(chef.retardMoyen === null || chef.retardMoyen >= 0);
  }
});

test('la page Parametres est servie, mais ses donnees restent reservees au directeur', async () => {
  // La page elle-meme est un fichier statique : c'est l'API qu'elle appelle qui
  // decide, pas l'adresse. Un chef qui l'ouvrirait n'en tirerait rien.
  const page = await fetch(`${base}/parametres.html`);
  assert.equal(page.status, 200);

  const a = await connexion('chefa', '1111');
  for (const chemin of ['/api/admin/utilisateurs', '/api/admin/vehicules', '/api/admin/indicateurs']) {
    assert.equal((await a('GET', chemin)).statut, 403, chemin);
  }
});

/* ------------------ Visa du conducteur de travaux ------------------------- */

/*
 * Un conducteur de travaux est desormais un compte : il se cree par la route
 * commune des comptes, avec un identifiant et un code comme les autres.
 */
let numeroConducteur = 0;
async function creerConducteur(directeur, champs) {
  numeroConducteur += 1;
  const reponse = await directeur('POST', '/api/admin/utilisateurs', {
    role: 'conducteur',
    identifiant: `conduc${numeroConducteur}`,
    pin: '4321',
    ...champs,
  });
  assert.equal(reponse.statut, 200, (reponse.corps || {}).erreur);
  return reponse.corps;
}

async function ficheTransmise(chef, semaine, conducteurId) {
  const fiche = (await chef('POST', '/api/fiches/semaine', { annee: 2026, semaine })).corps.fiche;
  // Comme l'ecran du chef : l'identifiant du salarie suit le nom saisi, sinon
  // les heures se poseraient sur quelqu'un d'autre que celui qu'on nomme.
  const andre = db.prepare("SELECT id FROM salaries WHERE nom = 'ANDRE' ORDER BY id LIMIT 1").get();
  const lignes = fiche.lignes.map((ligne, i) => ({
    ...ligne,
    salarie_id: i === 0 ? andre.id : ligne.salarie_id,
    nom_affiche: i === 0 ? 'ANDRE Alain' : '',
    signature: i === 0 ? 'data:image/png;base64,xxx' : null,
    jours: ligne.jours.map((j) => ({ ...j, minutes: i === 0 && j.jour <= 4 ? 450 : 0, saisi: i === 0 && j.jour <= 4 ? 1 : 0 })),
  }));
  // Le chef designe lui-meme qui doit viser, comme sur son ecran.
  const conducteur =
    conducteurId !== undefined
      ? conducteurId
      : (db.prepare("SELECT id FROM utilisateurs WHERE role = 'conducteur' AND actif = 1 ORDER BY id LIMIT 1").get() || {}).id || null;
  await chef('PUT', `/api/fiches/${fiche.id}`, {
    chantier: 'Chantier visa', ville: 'Toulouse', zone_deplacement: 'AUTRE',
    conducteur_id: conducteur, lignes,
  });
  const envoi = await chef('POST', `/api/fiches/${fiche.id}/soumettre`);
  assert.equal(envoi.statut, 200);
  return { id: fiche.id, visa: envoi.corps.visa };
}

test('sans conducteur rattache, la fiche part directement a la direction', async () => {
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');

  const { id, visa } = await ficheTransmise(a, 20);
  assert.equal(visa.demande, false);
  assert.equal(db.prepare('SELECT visa_statut FROM fiches WHERE id = ?').get(id).visa_statut, '');
});

test('un conducteur choisi met la fiche en attente de son visa', async () => {
  const d = await connexion('dir', '9999');
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');

  const conducteur = await creerConducteur(d, {
    nom: 'MOREAU Paul', courriel: 'paul.moreau@exemple.fr',
  });
  const chefA = db.prepare("SELECT id FROM utilisateurs WHERE identifiant = 'chefa'").get().id;
  assert.equal((await d('PUT', `/api/admin/chefs/${chefA}/conducteur`, { conducteur_id: conducteur.id })).statut, 200);

  const { id, visa } = await ficheTransmise(a, 21, conducteur.id);
  assert.equal(visa.demande, true);
  assert.equal(visa.conducteur, 'MOREAU Paul');

  const enBase = db.prepare('SELECT statut, visa_statut FROM fiches WHERE id = ?').get(id);
  assert.equal(enBase.statut, 'soumise');
  assert.equal(enBase.visa_statut, 'attente');
});






test('le directeur peut valider sans attendre le visa', async () => {
  const d = await connexion('dir', '9999');
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');

  const { id } = await ficheTransmise(a, 23);
  assert.equal(db.prepare('SELECT visa_statut FROM fiches WHERE id = ?').get(id).visa_statut, 'attente');

  // Le conducteur n'est pas joignable : la validation reste possible.
  assert.equal((await d('POST', `/api/fiches/${id}/decision`, { decision: 'valider' })).statut, 200);
  assert.equal(db.prepare('SELECT statut FROM fiches WHERE id = ?').get(id).statut, 'validee');
});

test('un chef d equipe corrige le nom d un operateur pour tout l effectif', async () => {
  const a = await connexion('chefa', '1111');
  const andre = db.prepare("SELECT id FROM salaries WHERE nom = 'ANDRE'").get();

  assert.equal((await a('PUT', `/api/salaries/${andre.id}/nom`, { nom: 'ANDRÉ', prenom: 'Alain' })).statut, 200);
  const apres = db.prepare('SELECT nom, prenom FROM salaries WHERE id = ?').get(andre.id);
  assert.deepEqual(apres, { nom: 'ANDRÉ', prenom: 'Alain' });

  // La correction est tracee : on doit toujours savoir qui a ecrit quoi.
  const trace = db.prepare("SELECT detail FROM journal WHERE action = 'correction_nom' ORDER BY id DESC LIMIT 1").get();
  assert.match(trace.detail, /ANDRE Alain/);

  // Un nom vide est refuse.
  assert.equal((await a('PUT', `/api/salaries/${andre.id}/nom`, { nom: '  ' })).statut, 400);
  db.prepare('UPDATE salaries SET nom = ? WHERE id = ?').run('ANDRE', andre.id);
});

test('le chef choisit lui-meme le conducteur, et son choix l emporte', async () => {
  const d = await connexion('dir', '9999');
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');
  db.exec("DELETE FROM utilisateurs WHERE role = 'conducteur'");

  const habituel = await creerConducteur(d, {
    nom: 'MOREAU Paul', courriel: 'paul@exemple.fr',
  });
  const autre = await creerConducteur(d, {
    nom: 'RENAUD Sophie', courriel: 'sophie@exemple.fr',
  });

  const chefA = db.prepare("SELECT id FROM utilisateurs WHERE identifiant = 'chefa'").get().id;
  await d('PUT', `/api/admin/chefs/${chefA}/conducteur`, { conducteur_id: habituel.id });

  // Le chef voit la liste, et son rattachement habituel comme proposition.
  const reference = (await a('GET', '/api/reference')).corps;
  assert.deepEqual(reference.conducteurs.map((c) => c.nom), ['MOREAU Paul', 'RENAUD Sophie']);
  assert.equal(reference.conducteurParDefaut, habituel.id);

  const fiche = (await a('POST', '/api/fiches/semaine', { annee: 2026, semaine: 24 })).corps.fiche;
  const lignes = fiche.lignes.map((ligne, i) => ({
    ...ligne,
    nom_affiche: i === 0 ? 'ANDRE Alain' : '',
    signature: i === 0 ? 'data:image/png;base64,xxx' : null,
    jours: ligne.jours.map((j) => ({ ...j, minutes: i === 0 && j.jour <= 4 ? 450 : 0, saisi: i === 0 && j.jour <= 4 ? 1 : 0 })),
  }));
  await a('PUT', `/api/fiches/${fiche.id}`, {
    chantier: 'Chantier choix', ville: 'Toulouse', zone_deplacement: 'AUTRE', lignes,
  });

  // Sans choix, la transmission est refusee.
  const refus = await a('POST', `/api/fiches/${fiche.id}/soumettre`);
  assert.equal(refus.statut, 422);
  assert.ok(refus.corps.anomalies.some((x) => /conducteur de travaux/.test(x.message)));

  // Le chef designe quelqu un d autre que son rattachement : c'est lui qui recoit.
  await a('PUT', `/api/fiches/${fiche.id}`, { conducteur_id: autre.id });
  const envoi = await a('POST', `/api/fiches/${fiche.id}/soumettre`);
  assert.equal(envoi.statut, 200);
  assert.equal(envoi.corps.visa.conducteur, 'RENAUD Sophie');
  assert.equal(db.prepare('SELECT visa_courriel FROM fiches WHERE id = ?').get(fiche.id).visa_courriel,
    'sophie@exemple.fr');
});

/*
 * Calendrier mensuel de la direction : une ligne par personne, une colonne par
 * jour. Il repond a une question que le tableau de bord ne pose jamais —
 * pourquoi Untel n'apparait nulle part cette semaine — et il ne s'ouvre qu'a la
 * direction, qui seule a vocation a voir tout l'effectif.
 */
test('le calendrier du mois montre tout l effectif, jour par jour', async () => {
  const d = await connexion('dir', '9999');
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');
  db.exec('DELETE FROM conges');
  db.exec("DELETE FROM utilisateurs WHERE role = 'conducteur'");

  // Semaine 27 de 2026 : du lundi 29 juin au dimanche 5 juillet.
  await ficheTransmise(a, 27);

  const vue = (await d('GET', '/api/calendrier-mensuel?annee=2026&mois=7')).corps;
  assert.equal(vue.jours.length, 31);
  assert.equal(vue.jours[0].date, '2026-07-01');
  assert.ok(vue.lignes.length >= 2, "les deux equipes doivent apparaitre");

  // On vise la personne que la fiche pointe reellement : des tests anterieurs
  // ont pu laisser un homonyme dans l'effectif, et « le premier ANDRE Alain
  // venu » n'est pas une designation.
  const pointe = db
    .prepare("SELECT salarie_id FROM fiche_lignes WHERE nom_affiche = 'ANDRE Alain' LIMIT 1")
    .get().salarie_id;
  const andre = vue.lignes.find((l) => l.salarie_id === pointe);
  assert.ok(andre, "l operateur pointe doit avoir sa ligne");
  assert.equal(andre.nom, 'ANDRE Alain');

  // Mercredi 1er juillet : pointe a 7h30 sur la fiche de la semaine 27.
  const mercredi = andre.cases[0];
  assert.equal(mercredi.etat, 'travaille');
  assert.equal(mercredi.minutes, 450);

  // Samedi 4 juillet : un week-end n'est pas un oubli.
  assert.equal(andre.cases[3].etat, 'weekend');

  /*
   * Lundi 6 juillet : rien de pointe. Juillet 2026 precede la mise en service —
   * ces semaines-la se pointaient sur papier — donc « hors service » et non
   * « oubli ». Un jour reellement inexplique se verifie plus bas, sur un mois
   * posterieur.
   */
  assert.equal(andre.cases[5].etat, 'horsService');

  // Un conge enregistre explique les jours sans fiche.
  const bertin = db.prepare("SELECT id FROM salaries WHERE nom = 'BERTIN' ORDER BY id LIMIT 1").get();
  assert.equal(
    (await d('POST', '/api/conges', {
      salarie_id: bertin.id, debut: '2026-07-06', fin: '2026-07-10', motif: 'CP',
    })).statut,
    200
  );

  const apres = (await d('GET', '/api/calendrier-mensuel?annee=2026&mois=7')).corps;
  const bruno = apres.lignes.find((l) => l.salarie_id === bertin.id);
  assert.equal(bruno.cases[5].etat, 'conge');
  assert.equal(bruno.cases[5].code, 'CP');
  assert.equal(bruno.totaux.conge, 5, 'les bornes sont incluses : cinq jours du 6 au 10');

  // Des dates a l envers, ou un salarie inconnu, sont refuses.
  assert.equal((await d('POST', '/api/conges', {
    salarie_id: bertin.id, debut: '2026-07-10', fin: '2026-07-06',
  })).statut, 400);
  assert.equal((await d('POST', '/api/conges', {
    salarie_id: 99999, debut: '2026-07-06', fin: '2026-07-10',
  })).statut, 400);

  // Rien de tout cela n'est accessible a un chef d'equipe.
  assert.equal((await a('GET', '/api/calendrier-mensuel?annee=2026&mois=7')).statut, 403);
  assert.equal((await a('GET', '/api/conges')).statut, 403);
  assert.equal((await a('POST', '/api/conges', {
    salarie_id: bertin.id, debut: '2026-07-06', fin: '2026-07-10',
  })).statut, 403);

  assert.equal((await d('GET', '/api/calendrier-mensuel?annee=2026&mois=13')).statut, 400);

  /*
   * Apres la mise en service, un jour de semaine sans pointage ni justification
   * devient un trou — c'est exactement ce que cette page sert a reperer.
   */
  const septembre = (await d('GET', '/api/calendrier-mensuel?annee=2026&mois=9')).corps;
  const enSeptembre = septembre.lignes.find((l) => l.salarie_id === pointe);
  assert.equal(enSeptembre.cases[0].etat, 'nonPointe', 'mardi 1er septembre, rien de pointe');
  assert.ok(enSeptembre.totaux.nonPointe > 15, 'un mois entier sans fiche se voit');
});

/*
 * Le chef reprend sa fiche pour la corriger.
 *
 * Il fallait auparavant demander une reouverture au directeur pour une virgule.
 * La reprise annule le visa en cours : un conducteur qui a vise une version ne
 * doit pas se retrouver signataire d'une autre.
 */
test('un chef reprend sa fiche transmise, et le visa en cours tombe', async () => {
  const d = await connexion('dir', '9999');
  const a = await connexion('chefa', '1111');
  const b = await connexion('chefb', '2222');
  db.exec('DELETE FROM fiches');
  db.exec("DELETE FROM utilisateurs WHERE role = 'conducteur'");

  const paul = await creerConducteur(d, {
    nom: 'MOREAU Paul', courriel: 'paul@exemple.fr',
  });
  const { id } = await ficheTransmise(a, 45, paul.id);

  const avant = db.prepare('SELECT statut, visa_statut FROM fiches WHERE id = ?').get(id);
  assert.equal(avant.statut, 'soumise');
  assert.equal(avant.visa_statut, 'attente');

  const reprise = await a('POST', `/api/fiches/${id}/reprendre`);
  assert.equal(reprise.statut, 200);
  assert.equal(reprise.corps.visaAnnule, true);

  const apres = db.prepare('SELECT statut, visa_statut FROM fiches WHERE id = ?').get(id);
  assert.equal(apres.statut, 'brouillon');
  assert.equal(apres.visa_statut, '');

  // Elle a quitte la liste du conducteur : il n'a plus rien a viser.
  await d('POST', `/api/admin/utilisateurs/${paul.id}/code`, { pin: '5555' });
  const identifiant = db.prepare('SELECT identifiant FROM utilisateurs WHERE id = ?').get(paul.id).identifiant;
  const sien = await connexion(identifiant, '5555');
  const vue = (await sien('GET', '/api/conducteur/moi')).corps;
  assert.equal(vue.enAttente.length, 0);

  // Et le chef peut de nouveau la modifier.
  assert.equal((await a('PUT', `/api/fiches/${id}`, { chantier: 'Chantier corrige' })).statut, 200);

  // Un autre chef ne reprend pas la fiche d'un collegue.
  assert.equal((await b('POST', `/api/fiches/${id}/reprendre`)).statut, 403);

  // Une fois validee, la reprise n'est plus a la main du chef.
  await a('POST', `/api/fiches/${id}/soumettre`);
  await d('POST', `/api/fiches/${id}/decision`, { decision: 'valider' });
  const refus = await a('POST', `/api/fiches/${id}/reprendre`);
  assert.equal(refus.statut, 409);
  assert.match(refus.corps.erreur, /reouverture/i);
});

/*
 * Un nom mal orthographie a l'import, un identifiant choisi trop vite : il
 * fallait desactiver le compte et en creer un autre, ce qui detachait ses fiches
 * de leur auteur.
 */
test('le directeur corrige le nom et l identifiant d un compte', async () => {
  const d = await connexion('dir', '9999');
  const chefB = db.prepare("SELECT id FROM utilisateurs WHERE identifiant = 'chefb'").get().id;

  // Le compte ne porte qu'un champ « NOM Prenom » : les deux cases de l'ecran
  // s'y recomposent, et l'une se corrige sans effacer l'autre.
  assert.equal((await d('PUT', `/api/admin/utilisateurs/${chefB}`, { nom: 'BERNARD' })).statut, 200);
  assert.equal(db.prepare('SELECT nom FROM utilisateurs WHERE id = ?').get(chefB).nom, 'BERNARD B');
  assert.equal((await d('PUT', `/api/admin/utilisateurs/${chefB}`, { prenom: 'Bruno' })).statut, 200);
  assert.equal(db.prepare('SELECT nom FROM utilisateurs WHERE id = ?').get(chefB).nom, 'BERNARD Bruno');

  // L'identifiant se corrige aussi, et c'est avec le nouveau qu'on se connecte.
  assert.equal((await d('PUT', `/api/admin/utilisateurs/${chefB}`, { identifiant: 'chefbis' })).statut, 200);
  const nouvelle = await fetch(`${base}/api/connexion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifiant: 'chefbis', pin: '2222' }),
  });
  assert.equal(nouvelle.status, 200);

  // Un identifiant deja pris est refuse, et rien n'est ecrit.
  const collision = await d('PUT', `/api/admin/utilisateurs/${chefB}`, { identifiant: 'chefa' });
  assert.equal(collision.statut, 409);
  assert.equal(db.prepare('SELECT identifiant FROM utilisateurs WHERE id = ?').get(chefB).identifiant, 'chefbis');

  // Un nom vide, ou un identifiant impossible, sont refuses.
  assert.equal((await d('PUT', `/api/admin/utilisateurs/${chefB}`, { nom: '  ' })).statut, 400);
  assert.equal((await d('PUT', `/api/admin/utilisateurs/${chefB}`, { identifiant: 'a b' })).statut, 400);

  // Et un chef ne se renomme pas lui-meme.
  const a = await connexion('chefa', '1111');
  assert.equal((await a('PUT', `/api/admin/utilisateurs/${chefB}`, { nom: 'X' })).statut, 403);

  db.prepare("UPDATE utilisateurs SET identifiant = 'chefb', nom = 'CHEF B' WHERE id = ?").run(chefB);
});

/*
 * Le chef travaille aussi sur le chantier : il a une fiche de salarie, rattachee
 * a lui par son nom. Corriger l'un sans l'autre les separerait — il cesserait
 * d'apparaitre en tete de sa propre fiche.
 */
test('renommer un chef renomme aussi sa fiche de salarie', async () => {
  const d = await connexion('dir', '9999');
  const chefA = db.prepare("SELECT id, nom FROM utilisateurs WHERE identifiant = 'chefa'").get();

  // Des tests anterieurs ont pu laisser un homonyme : on part d'un etat net,
  // sans quoi « sa » fiche de salarie ne designerait rien de precis.
  db.prepare("DELETE FROM salaries WHERE chef_id = ? AND nom = 'CHEF'").run(chefA.id);

  // On lui donne sa fiche de salarie, comme l'import le fait.
  const sien = db
    .prepare('INSERT INTO salaries (matricule, nom, prenom, chef_id) VALUES (?, ?, ?, ?)')
    .run('CA', 'CHEF', 'A', chefA.id).lastInsertRowid;

  assert.equal((await d('PUT', `/api/admin/utilisateurs/${chefA.id}`, { nom: 'CHEFFE' })).statut, 200);

  const apres = db.prepare('SELECT nom, prenom FROM salaries WHERE id = ?').get(sien);
  assert.equal(apres.nom, 'CHEFFE', 'sa fiche de salarie doit suivre');
  assert.equal(apres.prenom, 'A');
  assert.equal(db.prepare('SELECT nom FROM utilisateurs WHERE id = ?').get(chefA.id).nom, 'CHEFFE A');

  // Les autres salaries de son equipe ne bougent pas.
  const andre = db.prepare("SELECT nom FROM salaries WHERE nom = 'ANDRE' LIMIT 1").get();
  assert.ok(andre, "les coequipiers gardent leur nom");

  db.prepare('DELETE FROM salaries WHERE id = ?').run(sien);
  db.prepare("UPDATE utilisateurs SET nom = 'CHEF A' WHERE id = ?").run(chefA.id);
});

/*
 * Prevenir le conducteur sans courriel.
 *
 * Le chef d'equipe recoit un message tout pret a envoyer de son telephone. Ce
 * message ne doit contenir aucun lien : le chef pourrait sinon viser sa propre
 * fiche, et le controle ne serait plus qu'une formalite.
 */
test('le chef recoit de quoi prevenir le conducteur, jamais de quoi viser', async () => {
  const d = await connexion('dir', '9999');
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');
  db.exec("DELETE FROM utilisateurs WHERE role = 'conducteur'");

  const paul = await creerConducteur(d, {
    nom: 'MOREAU Paul', courriel: 'paul@exemple.fr', telephone: '06 12 34 56 78',
  });

  const { visa } = await ficheTransmise(a, 46, paul.id);
  assert.equal(visa.demande, true);
  assert.equal(visa.envoye, false, 'aucun serveur d envoi dans les tests');

  // Ce que le chef recoit : un message pret, et deux facons de l'envoyer.
  assert.ok(visa.alerte, 'le chef doit repartir avec de quoi prevenir');
  assert.equal(visa.alerte.telephone, '06 12 34 56 78');
  assert.match(visa.alerte.texte, /Bonjour Paul/);
  assert.match(visa.alerte.texte, /Semaine 46/);
  assert.ok(visa.alerte.sms.startsWith('sms:+33612345678'));
  assert.ok(visa.alerte.whatsapp.startsWith('https://wa.me/33612345678'));

  /*
   * Et surtout : rien qui permette de viser. Il n'existe plus de lien de visa a
   * distribuer — le conducteur se connecte — mais la verification reste : si un
   * jour quelque chose de tel reapparaissait dans cette reponse, ce test
   * tomberait, et c'est bien ce qu'on lui demande.
   */
  const recu = JSON.stringify(visa);
  assert.equal(visa.lien, undefined, 'aucun lien de visa ne sort vers un chef');
  assert.ok(!/visa\.html|conducteur\.html|cle=|jeton=/i.test(recu), 'aucun secret vers le chef');

  // La relance du directeur ne distribue pas davantage de secret.
  const relance = (await d('POST', `/api/fiches/${(await ficheTransmise(a, 47, paul.id)).id}/relancer-visa`)).corps;
  assert.equal(relance.visa.lien, undefined);
  assert.ok(relance.visa.alerte.texte.length > 50);
  assert.ok(!/jeton|cle=/i.test(JSON.stringify(relance)), 'la relance non plus ne porte aucun secret');
});

/*
 * Etape 1 des comptes de conducteurs : le role existe, son espace n'est pas
 * encore ouvert.
 *
 * C'est la promesse de cette etape — creer les comptes ne peut ouvrir aucune
 * porte par megarde. Le test compte donc pour rien les routes reservees au
 * directeur, qui refuseraient de toute facon : il vise celles qui acceptent
 * n'importe quel compte connecte, et qui se branchent sur « chef » ou
 * « directeur ». Un role de plus y tomberait dans la branche du directeur.
 */
test('un conducteur connecte n obtient encore rien', async () => {
  const d = await connexion('dir', '9999');
  db.exec("DELETE FROM utilisateurs WHERE role = 'conducteur'");
  const paul = await creerConducteur(d, { nom: 'MOREAU Paul', courriel: 'paul@exemple.fr' });
  await d('POST', `/api/admin/utilisateurs/${paul.id}/code`, { pin: '5555' });

  const identifiant = db.prepare('SELECT identifiant FROM utilisateurs WHERE id = ?').get(paul.id).identifiant;
  const c = await connexion(identifiant, '5555');

  // Les routes ouvertes a tout compte connecte : ce sont elles qui laisseraient
  // passer un role inattendu.
  const fermees = [
    ['GET', '/api/fiches'],
    ['GET', '/api/fiches?annee=2026&semaine=20'],
    ['POST', '/api/fiches/semaine', { annee: 2026, semaine: 20 }],
    ['GET', '/api/fiches/1'],
    ['PUT', '/api/fiches/1', { chantier: 'Detourne' }],
    ['POST', '/api/fiches/1/reprendre'],
    ['POST', '/api/fiches/1/soumettre'],
    ['GET', '/api/reference'],
    ['GET', '/api/calendrier?annee=2026&mois=8'],
    ['PUT', '/api/salaries/1/nom', { nom: 'DETOURNE' }],
    ['GET', '/api/admin/utilisateurs'],
    ['GET', '/api/mois?annee=2026&mois=8'],
  ];
  for (const [methode, chemin, corps] of fermees) {
    const r = await c(methode, chemin, corps);
    assert.equal(r.statut, 403, `${methode} ${chemin} devrait etre ferme`);
  }

  // Et surtout : rien n'a ete cree a son nom au passage.
  const siennes = db.prepare('SELECT COUNT(*) n FROM fiches WHERE chef_id = ?').get(paul.id).n;
  assert.equal(siennes, 0, 'aucune fiche ne doit naitre d une tentative');

  // Ce qui le concerne lui reste joignable : sinon il ne pourrait pas se
  // deconnecter, ni changer le code qu'on vient de lui donner.
  assert.equal((await c('GET', '/api/moi')).statut, 200);
  assert.equal((await c('POST', '/api/mon-code', { actuel: '5555', nouveau: '6666' })).statut, 200);
});

/*
 * Deux chantiers dans la meme semaine.
 *
 * La base l'autorisait depuis toujours — son unicite porte sur le chef, la
 * semaine et le chantier — mais aucune porte ne permettait d'ouvrir la seconde
 * fiche. Ce test verifie la porte, et surtout que les controles cessent de
 * raisonner sur des moities de semaine.
 */
test('un chef ouvre une seconde fiche pour un autre chantier de la semaine', async () => {
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');

  const premiere = (await a('POST', '/api/fiches/semaine', { annee: 2026, semaine: 15 })).corps;
  assert.equal(premiere.fichesSemaine.length, 1);
  await a('PUT', `/api/fiches/${premiere.fiche.id}`, { chantier: 'Lycee Jean Moulin', ville: 'Toulouse' });

  // Sans nom, les deux fiches ne se distingueraient pas — jusque dans la base.
  const sansNom = await a('POST', '/api/fiches/semaine/chantier', { annee: 2026, semaine: 15, chantier: '  ' });
  assert.equal(sansNom.statut, 400);
  assert.match(sansNom.corps.erreur, /nom du second chantier/);

  const seconde = await a('POST', '/api/fiches/semaine/chantier', {
    annee: 2026, semaine: 15, chantier: 'Gymnase Sud',
  });
  assert.equal(seconde.statut, 200);
  assert.equal(seconde.corps.fiche.chantier, 'Gymnase Sud');
  assert.equal(seconde.corps.fichesSemaine.length, 2);

  // Deux fois le meme chantier n'aurait aucun sens, et la base le refuserait.
  const doublon = await a('POST', '/api/fiches/semaine/chantier', {
    annee: 2026, semaine: 15, chantier: 'gymnase sud',
  });
  assert.equal(doublon.statut, 409);

  // La fiche de la semaine reste la premiere ouverte : on ne perd pas sa place.
  const rouvert = (await a('POST', '/api/fiches/semaine', { annee: 2026, semaine: 15 })).corps;
  assert.equal(rouvert.fiche.id, premiere.fiche.id);
  assert.equal(rouvert.fichesSemaine.length, 2);

  // Un autre chef ne voit rien de tout cela.
  const b = await connexion('chefb', '2222');
  const sienne = (await b('POST', '/api/fiches/semaine', { annee: 2026, semaine: 15 })).corps;
  assert.equal(sienne.fichesSemaine.length, 1);
  assert.notEqual(sienne.fiche.id, premiere.fiche.id);
  assert.equal((await b('GET', `/api/fiches/${seconde.corps.fiche.id}`)).statut, 403);
});

/*
 * Le controle qui protege la paie, joue en vrai : le meme operateur sur les deux
 * fiches, avec cinq jours de grand deplacement declares de chaque cote.
 */
test('les GD declares sur deux fiches se comptent ensemble', async () => {
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');

  const salarie = db.prepare("SELECT id FROM salaries WHERE nom = 'ANDRE'").get().id;
  const semaineComplete = (gd) => ({
    salarie_id: salarie,
    nom_affiche: 'ANDRE Alain',
    nb_gd72: gd,
    signature: 'data:image/png;base64,xxx',
    jours: Array.from({ length: 7 }, (_, j) => ({ jour: j, minutes: j <= 4 ? 450 : 0, saisi: 1 })),
  });

  const une = (await a('POST', '/api/fiches/semaine', { annee: 2026, semaine: 16 })).corps.fiche;
  await a('PUT', `/api/fiches/${une.id}`, {
    chantier: 'Lycee Jean Moulin', ville: 'Toulouse', lignes: [semaineComplete(5)],
  });

  const deux = (await a('POST', '/api/fiches/semaine/chantier', {
    annee: 2026, semaine: 16, chantier: 'Gymnase Sud',
  })).corps.fiche;
  const apres = await a('PUT', `/api/fiches/${deux.id}`, {
    chantier: 'Gymnase Sud', ville: 'Toulouse', lignes: [semaineComplete(5)],
  });

  const gd = apres.corps.anomalies.find((x) => /grand deplacement/.test(x.message));
  assert.ok(gd, `le cumul doit etre vu : ${JSON.stringify(apres.corps.anomalies)}`);
  assert.equal(gd.niveau, 'bloquant');
  assert.match(gd.message, /10 jours de grand deplacement/);
  assert.match(gd.message, /« Lycee Jean Moulin »/);

  // Et le plafond de 48 h, qu'aucune des deux fiches ne depassait seule.
  const plafond = apres.corps.anomalies.find((x) => /plafond/.test(x.message));
  assert.ok(plafond, 'deux fois 37h30 font 75h sur la semaine');
  assert.match(plafond.message, /75h00/);
});

/* ------------------ Espace du conducteur de travaux ------------------------ */

/** Un conducteur avec un code, prêt à se connecter. */
async function conducteurConnecte(directeur, champs) {
  const compte = await creerConducteur(directeur, champs);
  await directeur('POST', `/api/admin/utilisateurs/${compte.id}/code`, { pin: '5555' });
  const identifiant = db.prepare('SELECT identifiant FROM utilisateurs WHERE id = ?').get(compte.id).identifiant;
  return { ...compte, appeler: await connexion(identifiant, '5555') };
}

/*
 * Le perimetre du conducteur se lit sur la fiche, pas sur un rattachement fixe.
 *
 * C'est ce qui permet a un chef de changer de conducteur d'une semaine a
 * l'autre, ou d'en avoir deux a la fois quand il tient deux chantiers : une case
 * de rattachement ne contient qu'un nom, une fiche porte le sien.
 */
test('un conducteur ne voit que les fiches ou le chef l a designe', async () => {
  const d = await connexion('dir', '9999');
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');
  db.exec("DELETE FROM utilisateurs WHERE role = 'conducteur'");

  const paul = await conducteurConnecte(d, { nom: 'MOREAU Paul', courriel: 'paul@exemple.fr' });
  const sophie = await conducteurConnecte(d, { nom: 'RENAUD Sophie', courriel: 'sophie@exemple.fr' });

  const sienne = await ficheTransmise(a, 10, paul.id);
  const autre = await ficheTransmise(a, 11, sophie.id);

  const tableau = (await paul.appeler('GET', '/api/conducteur/moi')).corps;
  assert.equal(tableau.conducteur.nom, 'MOREAU Paul');
  assert.deepEqual(tableau.enAttente.map((f) => f.id), [sienne.id]);
  // Le lien ne porte plus de secret : c'est la session qui prouve qui vise.
  assert.equal(tableau.enAttente[0].lien, `/visa.html?fiche=${sienne.id}`);

  const vue = await paul.appeler('GET', `/api/visa/fiche/${sienne.id}`);
  assert.equal(vue.statut, 200);

  /*
   * Ce qu'il voit d'une fiche : les heures, et rien de la paie. Ni taux horaire,
   * ni montant, ni meme l'image des signatures — leur seule presence suffit a
   * verifier que le pointage a bien ete signe.
   */
  const recu = JSON.stringify(vue.corps.fiche);
  assert.equal(/taux|salaire|montant|brut/i.test(recu), false, `aucun montant : ${recu.slice(0, 200)}`);
  assert.equal(vue.corps.fiche.lignes[0].signature, true, 'la presence, pas l image');

  const refus = await paul.appeler('GET', `/api/visa/fiche/${autre.id}`);
  assert.equal(refus.statut, 403);
  assert.match(refus.corps.erreur, /ne releve pas de vous/);

  // Et rien de la paie ne s'ouvre au passage.
  for (const chemin of ['/api/mois?annee=2026&mois=8', '/api/tableau?annee=2026&mois=8', '/api/admin/salaries']) {
    assert.equal((await paul.appeler('GET', chemin)).statut, 403, chemin);
  }
});

test('le conducteur vise depuis son compte, et la fiche poursuit sa route', async () => {
  const d = await connexion('dir', '9999');
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');
  db.exec("DELETE FROM utilisateurs WHERE role = 'conducteur'");

  const paul = await conducteurConnecte(d, { nom: 'MOREAU Paul', courriel: 'paul@exemple.fr' });
  const { id } = await ficheTransmise(a, 12, paul.id);

  assert.equal((await paul.appeler('POST', `/api/visa/fiche/${id}/decision`, { decision: 'viser' })).statut, 200);
  const apres = db.prepare('SELECT visa_statut, visa_conducteur FROM fiches WHERE id = ?').get(id);
  assert.equal(apres.visa_statut, 'vise');
  assert.equal(apres.visa_conducteur, 'MOREAU Paul');

  // Le journal nomme l'auteur : par compte, on sait qui a vise.
  const trace = db
    .prepare("SELECT user_id FROM journal WHERE fiche_id = ? AND action = 'visa_conducteur'")
    .get(id);
  assert.equal(trace.user_id, paul.id, 'le visa doit porter un nom, pas un anonyme');

  // Une fiche deja visee ne se corrige plus de son cote.
  const tardif = await paul.appeler('PUT', `/api/visa/fiche/${id}`, { chantier: 'Trop tard' });
  assert.equal(tardif.statut, 409);
  assert.equal(db.prepare('SELECT chantier FROM fiches WHERE id = ?').get(id).chantier, 'Chantier visa');
});

/*
 * Le conducteur corrige la fiche comme son auteur.
 *
 * Il controle le pointage : lui laisser les seules heures l'obligerait a
 * renvoyer la fiche entiere au chef pour un masque oublie ou un operateur
 * manquant. Ce qui reste hors de sa portee est ailleurs — la validation finale,
 * et les montants.
 */
test('le conducteur corrige toute la fiche, tant qu elle attend son visa', async () => {
  const d = await connexion('dir', '9999');
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');
  db.exec("DELETE FROM utilisateurs WHERE role = 'conducteur'");

  const paul = await conducteurConnecte(d, { nom: 'MOREAU Paul', courriel: 'paul@exemple.fr' });
  const { id } = await ficheTransmise(a, 13, paul.id);

  const avant = (await paul.appeler('GET', `/api/visa/fiche/${id}`)).corps.fiche;
  assert.equal(avant.modifiable, true);
  assert.ok(avant.lignes.length > 1, 'les lignes libres sont fournies : il peut ajouter quelqu un');

  const pointee = avant.lignes.find((l) => String(l.nom_affiche || '').trim());
  const libre = avant.lignes.find((l) => !String(l.nom_affiche || '').trim());
  assert.equal(pointee.jours[0].minutes, 450);

  const correction = await paul.appeler('PUT', `/api/visa/fiche/${id}`, {
    chantier: 'Chantier visa corrige',
    ville: 'Blagnac',
    immatriculation: 'AA-123-BB',
    conducteur_vehicule: 'MOREAU Paul',
    lignes: avant.lignes.map((l) => {
      if (l.id === pointee.id) {
        return {
          ...l,
          minutes_route: 30,
          jours_zone: 3,
          type_masque: 'VA',
          nb_gd72: 2,
          observation: 'Corrigé après contrôle',
          jours: l.jours.map((j) => (j.jour === 0 ? { ...j, minutes: 480 } : j.jour === 3 ? { ...j, minutes: 0, code_absence: 'VM' } : j)),
        };
      }
      if (l.id === libre.id) {
        // Un renfort saisi a la main : il n'a pas de numero de salarie.
        return {
          ...l,
          salarie_id: null,
          nom_affiche: 'BERTIN Bruno',
          jours: l.jours.map((j) => ({ ...j, minutes: j.jour <= 4 ? 420 : 0, saisi: 1 })),
        };
      }
      return l;
    }),
  });
  assert.equal(correction.statut, 200, JSON.stringify(correction.corps).slice(0, 200));

  const apres = db.prepare('SELECT chantier, ville, immatriculation FROM fiches WHERE id = ?').get(id);
  assert.equal(apres.chantier, 'Chantier visa corrige');
  assert.equal(apres.ville, 'Blagnac');
  assert.equal(apres.immatriculation, 'AA-123-BB');

  const relue = (await paul.appeler('GET', `/api/visa/fiche/${id}`)).corps.fiche;
  const corrigee = relue.lignes.find((l) => l.nom_affiche === pointee.nom_affiche);
  assert.equal(corrigee.jours[0].minutes, 480);
  assert.equal(corrigee.jours[3].code_absence, 'VM');
  assert.equal(corrigee.jours_zone, 3);
  assert.equal(corrigee.type_masque, 'VA');
  assert.equal(corrigee.nb_gd72, 2);
  assert.equal(corrigee.observation, 'Corrigé après contrôle');
  assert.ok(relue.lignes.some((l) => l.nom_affiche === 'BERTIN Bruno'), 'la personne ajoutee doit rester');

  /*
   * Le releve de ce qui a bouge : c'est lui que le directeur lira avant de
   * valider, et le chef pour comprendre ce qu'on a corrige chez lui.
   */
  const trace = db
    .prepare("SELECT user_id, detail FROM journal WHERE fiche_id = ? AND action = 'correction_conducteur'")
    .get(id);
  assert.equal(trace.user_id, paul.id, 'la correction porte un nom');
  assert.match(trace.detail, /chantier : « Chantier visa » → « Chantier visa corrige »/);
  assert.match(trace.detail, /Lundi : 7h30 → 8h00/);
  assert.match(trace.detail, /Jeudi : absence/);
  assert.match(trace.detail, /jours en zone : 0 → 3/);
  assert.match(trace.detail, /jours GD 72 : 0 → 2/);
  assert.match(trace.detail, /BERTIN Bruno : ajouté à la fiche/);

  // Ce qui lui reste ferme : valider, et les montants.
  assert.equal((await paul.appeler('POST', `/api/fiches/${id}/decision`, { decision: 'valider' })).statut, 403);
  assert.equal((await paul.appeler('PUT', `/api/fiches/${id}`, { chantier: 'Par la mauvaise porte' })).statut, 403);
  assert.equal(db.prepare('SELECT chantier FROM fiches WHERE id = ?').get(id).chantier, 'Chantier visa corrige');
});

test('le conducteur renvoie la fiche au chef, avec son commentaire', async () => {
  const d = await connexion('dir', '9999');
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');
  db.exec("DELETE FROM utilisateurs WHERE role = 'conducteur'");

  const paul = await conducteurConnecte(d, { nom: 'MOREAU Paul', courriel: 'paul@exemple.fr' });
  const { id } = await ficheTransmise(a, 14, paul.id);

  const sansMotif = await paul.appeler('POST', `/api/visa/fiche/${id}/decision`, { decision: 'renvoyer' });
  assert.equal(sansMotif.statut, 400, 'un renvoi sans motif n aide pas le chef');

  assert.equal(
    (await paul.appeler('POST', `/api/visa/fiche/${id}/decision`, {
      decision: 'renvoyer', commentaire: 'Mardi manquant pour BERTIN.',
    })).statut,
    200
  );
  const apres = db.prepare('SELECT statut, motif_rejet FROM fiches WHERE id = ?').get(id);
  assert.equal(apres.statut, 'rejetee');
  assert.match(apres.motif_rejet, /MOREAU Paul \(conducteur de travaux\) : Mardi manquant/);
});

test('le calendrier des presences s ouvre au conducteur, la paie non', async () => {
  const d = await connexion('dir', '9999');
  // Les fiches d'abord : le journal garde le nom de qui a vise, et retient donc
  // le compte correspondant. C'est bien ce qu'on lui demande.
  db.exec('DELETE FROM fiches');
  db.exec("DELETE FROM utilisateurs WHERE role = 'conducteur'");
  const paul = await conducteurConnecte(d, { nom: 'MOREAU Paul', courriel: 'paul@exemple.fr' });

  assert.equal((await paul.appeler('GET', '/api/calendrier-mensuel?annee=2026&mois=8')).statut, 200);
  assert.equal((await paul.appeler('GET', '/api/conges')).statut, 200);
  // Il consulte, il n'administre pas.
  assert.equal((await paul.appeler('POST', '/api/conges', { salarie_id: 1, debut: '2026-08-03', fin: '2026-08-07' })).statut, 403);
  assert.equal((await paul.appeler('GET', '/api/admin/conducteurs')).statut, 403);
  assert.equal((await paul.appeler('GET', '/api/admin/indicateurs')).statut, 403);
});

/*
 * Ce que le conducteur a corrigé ne doit pas rester entre lui et la fiche.
 *
 * Les opérateurs ont signé une version du pointage, le directeur en valide une
 * autre, et c'est le chef d'équipe qu'on interrogera si un montant surprend :
 * les deux doivent pouvoir lire ce qui a bougé sans comparer deux écrans.
 */
/*
 * Le scenario de l'audit, par la vraie route du conducteur.
 *
 * L'operateur a signe 7h30 ; le conducteur corrige a 8h00. La signature ne peut
 * pas suivre : elle attestait d'autre chose. Et remplacer la personne d'une
 * ligne ne doit surtout pas lui transmettre la signature du precedent.
 */
test('corriger un pointage signe fait tomber la signature, elle ne migre jamais', async () => {
  const d = await connexion('dir', '9999');
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');
  db.exec("DELETE FROM utilisateurs WHERE role = 'conducteur'");

  const paul = await conducteurConnecte(d, { nom: 'MOREAU Paul', courriel: 'p@exemple.fr' });
  const { id } = await ficheTransmise(a, 27, paul.id);

  const avant = (await paul.appeler('GET', `/api/visa/fiche/${id}`)).corps.fiche;
  const signee = avant.lignes.find((l) => l.nom_affiche === 'ANDRE Alain');
  assert.ok(signee.signature, 'le depart : la ligne est bien signee');

  // Le conducteur corrige les heures. Son ecran ne renvoie pas les signatures.
  await paul.appeler('PUT', `/api/visa/fiche/${id}`, {
    lignes: avant.lignes.map((l) =>
      l.id === signee.id
        ? { ...l, signature: undefined, jours: l.jours.map((j) => (j.jour === 0 ? { ...j, minutes: 480 } : j)) }
        : { ...l, signature: undefined }
    ),
  });

  const apres = (await paul.appeler('GET', `/api/visa/fiche/${id}`)).corps.fiche;
  const corrigee = apres.lignes.find((l) => l.nom_affiche === 'ANDRE Alain');
  assert.equal(corrigee.jours[0].minutes, 480);
  // Le conducteur ne recoit jamais l'image, seulement sa presence.
  assert.equal(corrigee.signature, false, 'ce n est plus ce que l operateur a signe');

  // Le journal nomme celui qui doit re-signer.
  const trace = db
    .prepare("SELECT detail FROM journal WHERE fiche_id = ? AND action = 'signature_invalidee'")
    .get(id);
  assert.ok(trace, 'la perte est tracee');
  assert.match(trace.detail, /ANDRE Alain/);

  /*
   * Et le cas qui donnait son nom au defaut : la ligne change de personne. La
   * signature d'ANDRE ne doit pas se retrouver sous le nom de BERTIN.
   */
  const { id: second } = await ficheTransmise(a, 28, paul.id);
  const fiche2 = (await paul.appeler('GET', `/api/visa/fiche/${second}`)).corps.fiche;
  const premiere = fiche2.lignes.find((l) => l.nom_affiche === 'ANDRE Alain');
  const bertin = db.prepare("SELECT id FROM salaries WHERE nom = 'BERTIN'").get();

  await paul.appeler('PUT', `/api/visa/fiche/${second}`, {
    lignes: fiche2.lignes.map((l) =>
      l.id === premiere.id
        ? { ...l, salarie_id: bertin.id, nom_affiche: 'BERTIN Bruno', signature: undefined }
        : { ...l, signature: undefined }
    ),
  });

  const remplacee = (await paul.appeler('GET', `/api/visa/fiche/${second}`)).corps.fiche.lignes[0];
  assert.equal(remplacee.nom_affiche, 'BERTIN Bruno');
  assert.equal(remplacee.signature, false, 'la signature d ANDRE ne devient pas celle de BERTIN');

  // Et dans la base, la ou est la verite : plus aucune image sur cette ligne.
  assert.equal(
    db.prepare('SELECT signature FROM fiche_lignes WHERE fiche_id = ? ORDER BY ordre LIMIT 1').get(second).signature,
    null
  );
});

test('le chef et le directeur voient ce que le conducteur a corrige', async () => {
  const d = await connexion('dir', '9999');
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');
  db.exec("DELETE FROM utilisateurs WHERE role = 'conducteur'");

  const paul = await conducteurConnecte(d, { nom: 'MOREAU Paul', courriel: 'paul@exemple.fr' });
  const { id } = await ficheTransmise(a, 20, paul.id);

  const vue = (await paul.appeler('GET', `/api/visa/fiche/${id}`)).corps.fiche;
  const pointee = vue.lignes.find((l) => String(l.nom_affiche || '').trim());
  await paul.appeler('PUT', `/api/visa/fiche/${id}`, {
    lignes: vue.lignes.map((l) =>
      l.id === pointee.id
        ? { ...l, jours: l.jours.map((j) => (j.jour === 1 ? { ...j, minutes: 300 } : j)) }
        : l
    ),
  });

  // Le chef le voit sur son ecran d'accueil, sans avoir a ouvrir la fiche.
  const sien = (await a('GET', '/api/mes-notifications')).corps;
  assert.equal(sien.corrections.length, 1);
  assert.equal(sien.corrections[0].auteur, 'MOREAU Paul');
  assert.equal(sien.corrections[0].fiche_id, id);
  assert.match(sien.corrections[0].detail, /Mardi : 7h30 → 5h00/);

  // Le directeur le lit sur la fiche, au moment de valider.
  const releve = (await d('GET', `/api/fiches/${id}`)).corps.fiche.journal
    .find((e) => e.action === 'correction_conducteur');
  assert.ok(releve, 'le releve doit accompagner la fiche');
  assert.equal(releve.auteur, 'MOREAU Paul');
  assert.match(releve.detail, /Mardi : 7h30 → 5h00/);

  // Un autre chef ne voit rien de tout cela.
  const b = await connexion('chefb', '2222');
  assert.deepEqual((await b('GET', '/api/mes-notifications')).corps.corrections, []);
});
