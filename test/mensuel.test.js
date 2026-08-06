'use strict';

/**
 * Agregation d'un mois a partir des fiches de pointage, telle qu'elle remplit le
 * tableau mensuel du directeur.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-mensuel-'));

const { db } = require('../server/db');
const { hacherPin } = require('../server/auth');
const D = require('../server/domaine');
const { agregerMois } = require('../server/mensuel');

const ANNEE = 2026;
const MOIS = 7;
let SEMAINES;
// Deux semaines entierement contenues dans le mois, pour les cas generaux.
let PLEINE, PLEINE_2, IDX_PLEINE, IDX_PLEINE_2;
let chef;
let salaries;

test.before(() => {
  SEMAINES = D.semainesDuMois(ANNEE, MOIS);
  IDX_PLEINE = SEMAINES.findIndex((s) => s.joursDuMois.every(Boolean));
  IDX_PLEINE_2 = SEMAINES.findIndex((s, i) => i > IDX_PLEINE && s.joursDuMois.every(Boolean));
  PLEINE = SEMAINES[IDX_PLEINE];
  PLEINE_2 = SEMAINES[IDX_PLEINE_2];
  chef = db
    .prepare('INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES (?,?,?,?)')
    .run('CHEF', 'chef', 'chef', hacherPin('1111')).lastInsertRowid;
  salaries = [['M1', 'ANDRE', 'Alain'], ['M2', 'BERTIN', 'Bruno']].map((s) =>
    db.prepare('INSERT INTO salaries (matricule, nom, prenom, chef_id) VALUES (?,?,?,?)')
      .run(s[0], s[1], s[2], chef).lastInsertRowid
  );
});

test.after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

function poserFiche({ semaine, chantier = 'Chantier', ville = 'Toulouse', statut = 'validee', lignes }) {
  const fiche = db
    .prepare(
      `INSERT INTO fiches (chef_id, annee, semaine, chantier, ville, statut) VALUES (?,?,?,?,?,?)`
    )
    .run(chef, semaine.annee, semaine.semaine, chantier, ville, statut).lastInsertRowid;

  lignes.forEach((l, i) => {
    const ligne = db
      .prepare(
        `INSERT INTO fiche_lignes (fiche_id, salarie_id, nom_affiche, ordre, minutes_route,
           minutes_trajet, jours_zone, type_masque, nb_deplacement)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(fiche, l.salarie_id ?? null, l.nom, i, l.route ?? 0, l.trajet ?? 0,
        l.zone ?? 0, l.masque ?? '', l.depl ?? 0).lastInsertRowid;
    for (let j = 0; j < 7; j += 1) {
      db.prepare('INSERT INTO fiche_jours (ligne_id, jour, minutes, code_absence) VALUES (?,?,?,?)')
        .run(ligne, j, Math.round((l.heures?.[j] ?? 0) * 60), l.codes?.[j] ?? '');
    }
  });
  return fiche;
}

const trouver = (mois, nom) => mois.salaries.find((s) => s.feuille === nom);

test('les fiches non validees restent hors de la paie', () => {
  poserFiche({
    semaine: PLEINE,
    statut: 'soumise',
    lignes: [{ salarie_id: salaries[0], nom: 'ANDRE Alain', heures: [7, 7, 7, 7, 7] }],
  });
  assert.equal(agregerMois(ANNEE, MOIS).salaries.length, 0);
  // Le directeur peut neanmoins demander un apercu toutes fiches confondues.
  assert.equal(agregerMois(ANNEE, MOIS, { statut: null }).salaries.length, 1);
});

test('les heures supplementaires se calculent semaine par semaine', () => {
  db.exec('DELETE FROM fiches');
  poserFiche({
    semaine: PLEINE,
    lignes: [{ salarie_id: salaries[0], nom: 'ANDRE Alain', heures: [7, 7, 7, 7, 7] }],
  });
  poserFiche({
    semaine: PLEINE_2,
    lignes: [{ salarie_id: salaries[0], nom: 'ANDRE Alain', heures: [9, 9, 9, 9, 9] }],
  });

  const andre = trouver(agregerMois(ANNEE, MOIS), 'ANDRE_Alain');
  assert.equal(andre.semaines[IDX_PLEINE].minutesTotal, 35 * 60);
  assert.equal(andre.semaines[IDX_PLEINE].minutes25, 0);
  assert.equal(andre.semaines[IDX_PLEINE_2].minutesTotal, 45 * 60);
  assert.equal(andre.semaines[IDX_PLEINE_2].minutes25, 8 * 60);
  assert.equal(andre.semaines[IDX_PLEINE_2].minutes50, 2 * 60);
  assert.equal(andre.minutesMois, 80 * 60);

  // 80 h sur le mois ne donnent PAS 45 h supplementaires : le calcul est hebdomadaire.
  const cumulMensuel = D.heuresSupplementaires(andre.minutesMois);
  assert.notEqual(cumulMensuel.minutes25 + cumulMensuel.minutes50, 10 * 60);
});

test('deux chantiers dans la meme semaine se cumulent sur une seule ligne', () => {
  db.exec('DELETE FROM fiches');
  poserFiche({
    semaine: PLEINE,
    chantier: 'Chantier A',
    lignes: [{ salarie_id: salaries[0], nom: 'ANDRE Alain', heures: [7, 7, 7, 7, 7], depl: 5, zone: 5, masque: 'VA' }],
  });
  poserFiche({
    semaine: PLEINE,
    chantier: 'Chantier B',
    lignes: [{ salarie_id: salaries[0], nom: 'ANDRE Alain', heures: [0, 0, 0, 0, 0, 6], depl: 1 }],
  });

  const mois = agregerMois(ANNEE, MOIS);
  assert.equal(mois.salaries.length, 1, 'un seul salarie, pas deux lignes');
  const semaine = trouver(mois, 'ANDRE_Alain').semaines[IDX_PLEINE];
  assert.equal(semaine.minutesTotal, 41 * 60);
  assert.equal(semaine.minutes25, 6 * 60);
  assert.equal(semaine.joursPanier, 6);
  assert.deepEqual(semaine.chantiers, ['Chantier A', 'Chantier B']);
});

test('les jours en zone se ventilent entre Amiante 1 (VA) et Amiante 2 (AA)', () => {
  db.exec('DELETE FROM fiches');
  poserFiche({
    semaine: PLEINE,
    lignes: [
      { salarie_id: salaries[0], nom: 'ANDRE Alain', heures: [7, 7, 7, 7, 7], zone: 5, masque: 'VA' },
      { salarie_id: salaries[1], nom: 'BERTIN Bruno', heures: [7, 7, 7, 7, 7], zone: 3, masque: 'AA' },
    ],
  });

  const mois = agregerMois(ANNEE, MOIS);
  assert.equal(trouver(mois, 'ANDRE_Alain').semaines[IDX_PLEINE].joursAmiante1, 5);
  assert.equal(trouver(mois, 'ANDRE_Alain').semaines[IDX_PLEINE].joursAmiante2, 0);
  assert.equal(trouver(mois, 'BERTIN_Bruno').semaines[IDX_PLEINE].joursAmiante2, 3);
  assert.equal(trouver(mois, 'BERTIN_Bruno').semaines[IDX_PLEINE].joursAmiante1, 0);
});

test('la ville du chantier repartit les deplacements entre GD 72 et GD 80', () => {
  db.exec('DELETE FROM fiches');
  poserFiche({
    semaine: PLEINE,
    ville: 'Nice',
    lignes: [{ salarie_id: salaries[0], nom: 'ANDRE Alain', heures: [7, 7, 7, 7, 7], depl: 5 }],
  });
  poserFiche({
    semaine: PLEINE_2,
    ville: 'Toulouse',
    lignes: [{ salarie_id: salaries[0], nom: 'ANDRE Alain', heures: [7, 7, 7, 7, 7], depl: 4 }],
  });

  const andre = trouver(agregerMois(ANNEE, MOIS), 'ANDRE_Alain');
  assert.equal(andre.semaines[IDX_PLEINE].joursGD80, 5);
  assert.equal(andre.semaines[IDX_PLEINE].joursGD72, 0);
  assert.equal(andre.semaines[IDX_PLEINE_2].joursGD72, 4);
  assert.equal(andre.semaines[IDX_PLEINE_2].joursGD80, 0);
  // Le panier compte tous les jours de deplacement, quelle que soit la ville.
  assert.equal(andre.semaines[IDX_PLEINE].joursPanier + andre.semaines[IDX_PLEINE_2].joursPanier, 9);
});

test('les codes absence sont remontes jour par jour', () => {
  db.exec('DELETE FROM fiches');
  poserFiche({
    semaine: PLEINE,
    lignes: [{
      salarie_id: salaries[0],
      nom: 'ANDRE Alain',
      heures: [7, 7, 0, 7, 7],
      codes: ['', '', 'F', '', ''],
    }],
  });

  const semaine = trouver(agregerMois(ANNEE, MOIS), 'ANDRE_Alain').semaines[IDX_PLEINE];
  assert.deepEqual(semaine.jours[2], { minutes: 0, codes: ['F'] });
  assert.equal(semaine.minutesTotal, 28 * 60);
});

test('une semaine a cheval sur deux mois ne compte ses heures qu une fois', () => {
  db.exec('DELETE FROM fiches');
  const partagee = SEMAINES[0]; // semaine 27 : 29-30/06 en juin, 01-03/07 en juillet
  assert.ok(!partagee.joursDuMois.every(Boolean), 'cette semaine doit bien etre a cheval');

  // 7 h chaque jour du lundi au vendredi, soit 35 h sur la semaine reelle.
  poserFiche({
    semaine: partagee,
    lignes: [{ salarie_id: salaries[0], nom: 'ANDRE Alain', heures: [7, 7, 7, 7, 7], zone: 5, masque: 'VA', depl: 5 }],
  });

  const enJuillet = trouver(agregerMois(2026, 7), 'ANDRE_Alain');
  const enJuin = trouver(agregerMois(2026, 6), 'ANDRE_Alain');
  assert.ok(enJuillet && enJuin, 'la semaine partagee figure dans les deux tableaux');

  const juillet = enJuillet.semaines.find((w) => w.semaine === partagee.semaine);
  const juin = enJuin.semaines.find((w) => w.semaine === partagee.semaine);

  assert.equal(juillet.minutesTotal, 21 * 60, 'juillet ne retient que le 1er, 2 et 3');
  assert.equal(juin.minutesTotal, 14 * 60, 'juin ne retient que le 29 et le 30');
  assert.equal(juillet.minutesTotal + juin.minutesTotal, 35 * 60, 'aucune heure perdue ni doublee');

  // Les primes suivent la meme repartition, au prorata des jours pointes.
  assert.equal(juillet.joursPanier + juin.joursPanier, 5);
  assert.equal(juillet.joursAmiante1 + juin.joursAmiante1, 5);
});

test('un salarie sans fiche du mois n apparait pas dans le tableau', () => {
  db.exec('DELETE FROM fiches');
  assert.deepEqual(agregerMois(ANNEE, MOIS).salaries, []);
});

test('les jours feries sont deduits du code F et valorises en heures', () => {
  db.exec('DELETE FROM fiches');
  poserFiche({
    semaine: PLEINE,
    lignes: [{
      salarie_id: salaries[0],
      nom: 'ANDRE Alain',
      heures: [8, 0, 8, 8, 8],
      codes: ['', 'F', '', '', ''],
    }],
  });

  const semaine = trouver(agregerMois(ANNEE, MOIS), 'ANDRE_Alain').semaines[IDX_PLEINE];
  assert.equal(semaine.joursFeries, 1);
  assert.equal(semaine.minutesFeries, D.DUREE_JOURNEE_REFERENCE_MINUTES);
  // Le ferie ne gonfle pas le total travaille de la semaine.
  assert.equal(semaine.minutesTotal, 32 * 60);
  assert.equal(semaine.minutes25, 0);
});

test('seul le code F alimente les feries, pas les autres absences', () => {
  db.exec('DELETE FROM fiches');
  poserFiche({
    semaine: PLEINE,
    lignes: [{
      salarie_id: salaries[0],
      nom: 'ANDRE Alain',
      heures: [7, 0, 0, 7, 7],
      codes: ['', 'CP', 'AT', '', ''],
    }],
  });

  const semaine = trouver(agregerMois(ANNEE, MOIS), 'ANDRE_Alain').semaines[IDX_PLEINE];
  assert.equal(semaine.joursFeries, 0);
  assert.equal(semaine.minutesFeries, 0);
});

/*
 * La case « Mois » du classeur de paie : nombre de jours ouvres x 7 h. Elle
 * n'est plus saisie par le directeur, et sert de denominateur a la retenue pour
 * absence — une erreur ici fausse toutes les paies du mois.
 */
test('l horaire de reference du mois vaut les jours ouvres fois 7 heures', () => {
  // Juillet 2026 : 23 jours ouvres (le 1er tombe un mercredi, le 31 un vendredi).
  assert.equal(D.joursOuvresDuMois(2026, 7), 23);
  assert.equal(D.heuresReferenceMois(2026, 7), 161);

  // Fevrier 2026 : 20 jours ouvres, du dimanche 1er au samedi 28.
  assert.equal(D.joursOuvresDuMois(2026, 2), 20);
  assert.equal(D.heuresReferenceMois(2026, 2), 140);

  // Fevrier bissextile : le 29 fevrier 2028 est un mardi, il compte.
  assert.equal(D.joursOuvresDuMois(2028, 2), 21);

  // Les jours feries ne sont pas deduits : mai 2026 compte ses 21 jours ouvres
  // bien que le 1er et le 8 mai tombent en semaine.
  assert.equal(D.joursOuvresDuMois(2026, 5), 21);
});
