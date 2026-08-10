'use strict';

/*
 * Le personnel non productif.
 *
 * Sa regle est plus simple que celle du chantier — 7 h par jour ouvre — et c'est
 * elle qui commande tout : un mois ordinaire ne demande aucune saisie, et ce
 * sont les ecarts qui se declarent. D'ou le fait qu'une journee revenue a la
 * normale n'est pas enregistree comme telle, mais effacee : l'absence de ligne
 * EST la facon de dire qu'il ne s'est rien passe, et deux facons de dire la meme
 * chose finissent toujours par diverger.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-np-'));

const { db } = require('../server/db');
const NP = require('../server/non-productif');
const D = require('../server/domaine');

test.after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

const directeur = db
  .prepare("INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES ('D', 'dir', 'directeur', 'x')")
  .run().lastInsertRowid;

const inserer = db.prepare(
  'INSERT INTO salaries (matricule, nom, prenom, chef_id, productif, taux_horaire) VALUES (?, ?, ?, ?, ?, ?)'
);
const anne = inserer.run('B1', 'PETIT', 'Anne', null, 0, 15).lastInsertRowid;
const luc = inserer.run('B2', 'GARNIER', 'Luc', null, 0, 0).lastInsertRowid;
// Un operateur de chantier : il ne doit jamais apparaitre ici.
const operateur = inserer.run('A1', 'ANDRE', 'Alain', null, 1, 14).lastInsertRowid;

/* Aout 2026 : 31 jours, 21 ouvres, le 1er tombe un samedi. */
const AOUT = { annee: 2026, mois: 8 };
const mois = () => NP.moisComplet(AOUT.annee, AOUT.mois);
const ligneDe = (id) => mois().lignes.find((l) => l.id === id);
const jourDe = (id, date) => ligneDe(id).jours.find((j) => j.date === date);

test('le mois compte les jours ouvres, et ignore l effectif de chantier', () => {
  const m = mois();
  assert.equal(m.jours.length, 31);
  assert.equal(m.joursOuvres, 21);
  assert.deepEqual(m.lignes.map((l) => l.nom), ['GARNIER', 'PETIT']);
  assert.equal(
    m.lignes.some((l) => l.id === operateur),
    false,
    'un operateur de chantier n a rien a faire dans ce calendrier'
  );
});

/*
 * Le point qui fait tenir l'ecran : sans aucune saisie, le mois est deja juste.
 * Si le directeur devait cliquer vingt-et-une fois pour dire « rien a signaler »,
 * personne ne tiendrait ce calendrier plus d'un mois.
 */
test('sans rien declarer, chacun est a 7 h par jour ouvre', () => {
  const anne2 = ligneDe(anne);
  assert.equal(anne2.joursTravailles, 21);
  assert.equal(anne2.minutes, 21 * D.DUREE_JOURNEE_REFERENCE_MINUTES);
  assert.equal(D.versTexte(anne2.minutes), '147h00');
  assert.equal(anne2.joursAbsence, 0);

  // Un samedi reste un samedi.
  assert.equal(jourDe(anne, '2026-08-01').etat, 'weekend');
  assert.equal(jourDe(anne, '2026-08-01').minutes, 0);
  assert.equal(jourDe(anne, '2026-08-03').etat, 'travaille');

  // Et rien n'a ete ecrit en base : le mois ordinaire ne coute aucune ligne.
  assert.equal(db.prepare('SELECT COUNT(*) n FROM jours_non_productifs').get().n, 0);
});

test('une absence retire sa journee, et se compte par code', () => {
  assert.deepEqual(NP.declarerJour({ salarieId: anne, date: '2026-08-04', code: 'VM' }, { id: directeur }), { ok: true });

  const jour = jourDe(anne, '2026-08-04');
  assert.equal(jour.etat, 'absence');
  assert.equal(jour.code, 'VM');
  assert.equal(jour.minutes, 0);

  const ligne = ligneDe(anne);
  assert.equal(ligne.joursTravailles, 20);
  assert.equal(D.versTexte(ligne.minutes), '140h00');
  assert.equal(ligne.joursAbsence, 1);
  assert.deepEqual(ligne.absences, { VM: 1 });
});

test('un code absence inconnu est refuse', () => {
  const refus = NP.declarerJour({ salarieId: anne, date: '2026-08-05', code: 'XYZ' }, { id: directeur });
  assert.equal(refus.code, 400);
  assert.match(refus.erreur, /XYZ/);
  assert.equal(jourDe(anne, '2026-08-05').etat, 'travaille', 'la journee reste ordinaire');
});

/*
 * Un grand deplacement se travaille : contrairement a une absence, la journee
 * garde ses heures.
 */
test('un grand deplacement garde ses heures et se compte a part', () => {
  NP.declarerJour({ salarieId: anne, date: '2026-08-06', gd: '80' }, { id: directeur });
  NP.declarerJour({ salarieId: anne, date: '2026-08-07', gd: '72' }, { id: directeur });

  assert.equal(jourDe(anne, '2026-08-06').etat, 'gd');
  assert.equal(jourDe(anne, '2026-08-06').minutes, D.DUREE_JOURNEE_REFERENCE_MINUTES);

  const ligne = ligneDe(anne);
  assert.equal(ligne.joursGD80, 1);
  assert.equal(ligne.joursGD72, 1);
  assert.equal(ligne.joursTravailles, 20, 'un jour de GD reste un jour travaille');
});

test('des heures particulieres se declarent, et se voient', () => {
  NP.declarerJour({ salarieId: anne, date: '2026-08-10', minutes: 210 }, { id: directeur });
  assert.equal(jourDe(anne, '2026-08-10').etat, 'partiel');
  assert.equal(D.versTexte(jourDe(anne, '2026-08-10').minutes), '3h30');
  assert.equal(D.versTexte(ligneDe(anne).minutes), '136h30');
});

/*
 * Revenir a l'ordinaire efface la ligne. Un etat « rien de special » enregistre
 * serait une seconde facon de dire ce que l'absence de ligne dit deja.
 */
test('revenir a l ordinaire efface la declaration', () => {
  const avant = db.prepare('SELECT COUNT(*) n FROM jours_non_productifs WHERE salarie_id = ?').get(anne).n;
  assert.ok(avant > 0);

  const resultat = NP.declarerJour({ salarieId: anne, date: '2026-08-04', code: '', gd: '' }, { id: directeur });
  assert.deepEqual(resultat, { efface: true });

  assert.equal(jourDe(anne, '2026-08-04').etat, 'travaille');
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM jours_non_productifs WHERE salarie_id = ?').get(anne).n,
    avant - 1
  );
});

test('un conge du registre explique une absence sans la ressaisir', () => {
  db.prepare("INSERT INTO conges (salarie_id, debut, fin, motif) VALUES (?, '2026-08-17', '2026-08-21', 'CP')")
    .run(luc);

  const ligne = ligneDe(luc);
  assert.equal(jourDe(luc, '2026-08-17').etat, 'conge');
  assert.equal(jourDe(luc, '2026-08-17').code, 'CP');
  assert.equal(ligne.joursAbsence, 5);
  assert.equal(ligne.joursTravailles, 16);
  assert.deepEqual(ligne.absences, { CP: 5 });
});

/*
 * Une declaration l'emporte sur le registre : le directeur qui saisit quelque
 * chose sur une journee sait ce qu'il fait, et ne doit pas voir sa saisie
 * silencieusement recouverte.
 */
test('une declaration prime sur le conge du registre', () => {
  NP.declarerJour({ salarieId: luc, date: '2026-08-19', code: 'AT' }, { id: directeur });
  assert.equal(jourDe(luc, '2026-08-19').etat, 'absence');
  assert.equal(jourDe(luc, '2026-08-19').code, 'AT');
});

test('les primes s ajoutent, se listent et se retirent', () => {
  assert.equal(ligneDe(anne).montantPrimes, 0);

  const prime = NP.ajouterPrime(
    { salarieId: anne, annee: 2026, mois: 8, libelle: 'Prime exceptionnelle', montant: 250 },
    { id: directeur }
  );
  NP.ajouterPrime({ salarieId: anne, annee: 2026, mois: 8, libelle: 'Astreinte', montant: 80.5 }, { id: directeur });
  // Un autre mois ne doit pas remonter ici.
  NP.ajouterPrime({ salarieId: anne, annee: 2026, mois: 9, libelle: 'Septembre', montant: 999 }, { id: directeur });

  const ligne = ligneDe(anne);
  assert.equal(ligne.primes.length, 2);
  assert.equal(ligne.montantPrimes, 330.5);

  assert.deepEqual(NP.supprimerPrime(prime.id), { ok: true });
  assert.equal(ligneDe(anne).montantPrimes, 80.5);
  assert.equal(NP.supprimerPrime(prime.id).code, 404, 'supprimer deux fois ne fait rien de plus');
});

test('un montant vide ou nul est refuse', () => {
  for (const montant of [0, '', null, 'abc']) {
    const refus = NP.ajouterPrime({ salarieId: anne, annee: 2026, mois: 8, montant }, { id: directeur });
    assert.equal(refus.code, 400, `montant ${JSON.stringify(montant)}`);
  }
});

test('on ne declare rien pour quelqu un qui n est pas de ce personnel', () => {
  const refus = NP.declarerJour({ salarieId: operateur, date: '2026-08-04', code: 'VM' }, { id: directeur });
  assert.equal(refus.code, 404);
  assert.equal(NP.ajouterPrime({ salarieId: operateur, annee: 2026, mois: 8, montant: 100 }).code, 404);
});

test('une date mal formee est refusee', () => {
  assert.equal(NP.declarerJour({ salarieId: anne, date: '04/08/2026', code: 'VM' }).code, 400);
  assert.equal(NP.declarerJour({ salarieId: anne, date: '', code: 'VM' }).code, 400);
});
