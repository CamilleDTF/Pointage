'use strict';

/*
 * Le delai attendu : la fiche d'une semaine doit etre transmise pour le lundi
 * qui suit. Ce seuil decide de la colonne « Hors delai » et de la ponctualite —
 * il merite d'etre verrouille par un test plutot que relu dans le code.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-test-'));

const I = require('../server/indicateurs');
const { db } = require('../server/db');

test.after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

test('le delai attendu est le lundi qui suit la semaine pointee', () => {
  assert.equal(I.DELAI_ATTENDU_JOURS, 1);
});

test('le retard se compte en jours depuis le dimanche de la semaine', () => {
  // Semaine 36 de 2026 : lundi 31 aout au dimanche 6 septembre.
  const dimanche = '2026-09-06';
  assert.equal(I.retardEnJours(dimanche, '2026-09-06 18:00:00'), 0); // le dimanche meme
  assert.equal(I.retardEnJours(dimanche, '2026-09-07 08:00:00'), 1); // le lundi : a l heure
  assert.equal(I.retardEnJours(dimanche, '2026-09-08 08:00:00'), 2); // le mardi : hors delai
  assert.equal(I.retardEnJours(dimanche, '2026-09-14 08:00:00'), 8);
  assert.equal(I.retardEnJours(dimanche, null), null); // jamais transmise
});

test('les semaines attendues excluent la semaine en cours et l avant-mise en service', () => {
  // Au 21 septembre 2026 (lundi de la semaine 39), les semaines 36, 37 et 38
  // sont terminees ; la 39 est en cours, elle n'est pas encore due.
  const attendues = I.semainesAttendues('2026-09-01', new Date(2026, 8, 21));
  assert.deepEqual(attendues.map((s) => s.semaine), [36, 37, 38]);

  // La semaine 36 commence le 31 aout mais se termine apres la mise en service :
  // elle compte, son dimanche tombe le 6 septembre.
  assert.equal(attendues[0].fin, '2026-09-06');

  // Avant la mise en service, rien n'est attendu de personne.
  assert.deepEqual(I.semainesAttendues('2026-09-01', new Date(2026, 7, 5)), []);
});

/*
 * Le point qui a motive la colonne `premiere_soumission_le` : `soumise_le` est
 * reecrit a chaque retransmission. Un chef qui rend le lundi et dont la fiche
 * revient pour correction serait apparu en retard de trois jours alors qu'il
 * avait fait sa part dans les temps.
 */
test('la ponctualite se juge sur la premiere demande de validation', () => {
  const chef = db
    .prepare("INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES (?, ?, 'chef', 'x')")
    .run('CHEF PONCTUEL', 'ponctuel').lastInsertRowid;

  // Semaine 36 de 2026, terminee le dimanche 6 septembre : envoyee le lundi 7,
  // renvoyee pour correction, retransmise le jeudi 10.
  db.prepare(
    `INSERT INTO fiches (chef_id, annee, semaine, statut, premiere_soumission_le, soumise_le)
     VALUES (?, 2026, 36, 'soumise', '2026-09-07 08:00:00', '2026-09-10 17:00:00')`
  ).run(chef);

  const ligne = I.indicateursChefs('2026-09-01', new Date(2026, 8, 21)).find((c) => c.chef_id === chef);
  assert.equal(ligne.fichesTransmises, 1);
  assert.equal(ligne.retardMax, 1); // le lundi, pas le jeudi
  assert.equal(ligne.horsDelai, 0);
  assert.equal(ligne.ponctualite, 100);
});

/*
 * Les fiches d'avant la colonne n'ont que `soumise_le` : la lecture doit
 * retomber dessus plutot que de les compter comme jamais transmises.
 */
test('une fiche anterieure a la colonne reste lue sur soumise_le', () => {
  const chef = db
    .prepare("INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES (?, ?, 'chef', 'x')")
    .run('CHEF ANCIEN', 'ancien').lastInsertRowid;

  db.prepare(
    `INSERT INTO fiches (chef_id, annee, semaine, statut, soumise_le)
     VALUES (?, 2026, 36, 'soumise', '2026-09-09 17:00:00')`
  ).run(chef);

  const ligne = I.indicateursChefs('2026-09-01', new Date(2026, 8, 21)).find((c) => c.chef_id === chef);
  assert.equal(ligne.retardMax, 3);
  assert.equal(ligne.horsDelai, 1);
});
