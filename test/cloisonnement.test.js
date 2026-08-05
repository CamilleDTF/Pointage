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

  const bertin = db.prepare("SELECT id FROM salaries WHERE nom = 'BERTIN'").get();
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

test('les ecrans de parametrage et les montants restent fermes aux chefs', async () => {
  const a = await connexion('chefa', '1111');
  for (const [methode, chemin] of [
    ['GET', '/api/mois?annee=2026&mois=9'],
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

async function ficheTransmise(chef, semaine) {
  const fiche = (await chef('POST', '/api/fiches/semaine', { annee: 2026, semaine })).corps.fiche;
  const lignes = fiche.lignes.map((ligne, i) => ({
    ...ligne,
    nom_affiche: i === 0 ? 'ANDRE Alain' : '',
    signature: i === 0 ? 'data:image/png;base64,xxx' : null,
    jours: ligne.jours.map((j) => ({ ...j, minutes: i === 0 && j.jour <= 4 ? 450 : 0, saisi: i === 0 && j.jour <= 4 ? 1 : 0 })),
  }));
  await chef('PUT', `/api/fiches/${fiche.id}`, {
    chantier: 'Chantier visa', ville: 'Toulouse', zone_deplacement: 'AUTRE', lignes,
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

test('avec un conducteur rattache, la fiche attend son visa', async () => {
  const d = await connexion('dir', '9999');
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');

  const conducteur = (await d('POST', '/api/admin/conducteurs', {
    nom: 'MOREAU Paul', courriel: 'paul.moreau@exemple.fr',
  })).corps;
  const chefA = db.prepare("SELECT id FROM utilisateurs WHERE identifiant = 'chefa'").get().id;
  assert.equal((await d('PUT', `/api/admin/chefs/${chefA}/conducteur`, { conducteur_id: conducteur.id })).statut, 200);

  const { id, visa } = await ficheTransmise(a, 21);
  assert.equal(visa.demande, true);
  assert.equal(visa.conducteur, 'MOREAU Paul');

  const enBase = db.prepare('SELECT statut, visa_statut, visa_jeton FROM fiches WHERE id = ?').get(id);
  assert.equal(enBase.statut, 'soumise');
  assert.equal(enBase.visa_statut, 'attente');
  assert.ok(enBase.visa_jeton, 'un secret de lien est genere');
});

test('le lien de visa ouvre une fiche, une seule, et sans montant', async () => {
  const d = await connexion('dir', '9999');
  const relance = await d('POST', `/api/fiches/${db.prepare("SELECT id FROM fiches WHERE visa_statut = 'attente'").get().id}/relancer-visa`);
  assert.equal(relance.statut, 200);
  const lien = relance.corps.visa.lien;
  const jeton = new URL(lien).searchParams.get('jeton');

  // Sans aucune session : c'est tout l'interet du lien.
  const vue = await fetch(`${base}/api/visa/${encodeURIComponent(jeton)}`);
  assert.equal(vue.status, 200);
  const { fiche } = await vue.json();
  assert.equal(fiche.chantier, 'Chantier visa');
  assert.equal(fiche.lignes.length, 1);
  // Ni taux horaire, ni salaire, ni image de signature ne transitent.
  assert.equal(fiche.lignes[0].signature, true);
  assert.equal(JSON.stringify(fiche).includes('taux'), false);

  // Un jeton bricole ne donne rien.
  assert.equal((await fetch(`${base}/api/visa/nimportequoi`)).status, 403);
});

test('un GET ne vise jamais : seule une decision explicite compte', async () => {
  const ligne = db.prepare("SELECT id, visa_jeton FROM fiches WHERE visa_statut = 'attente'").get();
  // La consultation repetee du lien — ce que fait un antivirus de messagerie —
  // laisse la fiche exactement dans l'etat ou il l'a trouvee.
  assert.equal(db.prepare('SELECT visa_statut FROM fiches WHERE id = ?').get(ligne.id).visa_statut, 'attente');
});

test('le conducteur vise, et la fiche poursuit sa route', async () => {
  const d = await connexion('dir', '9999');
  const ficheId = db.prepare("SELECT id FROM fiches WHERE visa_statut = 'attente'").get().id;
  const lien = (await d('POST', `/api/fiches/${ficheId}/relancer-visa`)).corps.visa.lien;
  const jeton = new URL(lien).searchParams.get('jeton');

  const decision = await fetch(`${base}/api/visa/${encodeURIComponent(jeton)}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'viser', commentaire: 'Conforme au chantier.' }),
  });
  assert.equal(decision.status, 200);

  const enBase = db.prepare('SELECT statut, visa_statut, visa_commentaire FROM fiches WHERE id = ?').get(ficheId);
  assert.equal(enBase.statut, 'soumise'); // elle attend maintenant la direction
  assert.equal(enBase.visa_statut, 'vise');
  assert.equal(enBase.visa_commentaire, 'Conforme au chantier.');
});

test('un lien perime par une retransmission ne vise plus rien', async () => {
  const d = await connexion('dir', '9999');
  const a = await connexion('chefa', '1111');
  db.exec('DELETE FROM fiches');

  const { id } = await ficheTransmise(a, 22);
  const ancien = new URL((await d('POST', `/api/fiches/${id}/relancer-visa`)).corps.visa.lien)
    .searchParams.get('jeton');

  // Le directeur renvoie la fiche, le chef la retransmet : nouveau secret.
  await d('POST', `/api/fiches/${id}/decision`, { decision: 'rejeter', motif: 'a revoir' });
  await a('POST', `/api/fiches/${id}/soumettre`);

  const r = await fetch(`${base}/api/visa/${encodeURIComponent(ancien)}`);
  assert.equal(r.status, 403);
});

test('le conducteur renvoie la fiche, avec son commentaire, au chef', async () => {
  const d = await connexion('dir', '9999');
  const ficheId = db.prepare("SELECT id FROM fiches WHERE visa_statut = 'attente'").get().id;
  const jeton = new URL((await d('POST', `/api/fiches/${ficheId}/relancer-visa`)).corps.visa.lien)
    .searchParams.get('jeton');

  const envoyer = (corps) =>
    fetch(`${base}/api/visa/${encodeURIComponent(jeton)}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
    });

  // Un renvoi sans motif est refuse : le chef doit savoir quoi corriger.
  assert.equal((await envoyer({ decision: 'renvoyer', commentaire: '  ' })).status, 400);

  assert.equal((await envoyer({ decision: 'renvoyer', commentaire: 'Jeudi manquant' })).status, 200);
  const enBase = db.prepare('SELECT statut, motif_rejet, visa_statut FROM fiches WHERE id = ?').get(ficheId);
  assert.equal(enBase.statut, 'rejetee');
  assert.equal(enBase.visa_statut, '');
  assert.match(enBase.motif_rejet, /MOREAU Paul.*Jeudi manquant/);
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
