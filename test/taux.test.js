'use strict';

/*
 * Les taux de la paie, et leur date d'effet.
 *
 * Ces montants vivaient en dur dans le code. Le probleme n'etait pas qu'ils
 * soient faux — ils sont justes pour DTF aujourd'hui — mais qu'un accord
 * d'entreprise demandait une nouvelle version du logiciel, et surtout que le
 * jour ou un taux changeait, TOUS LES MOIS PASSES changeaient avec lui.
 *
 * C'est ce dernier point que ce fichier verrouille : un mois se recalcule
 * toujours avec les taux qui s'appliquaient a lui.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-taux-'));

const { db } = require('../server/db');
const T = require('../server/taux');
const M = require('../server/mensuel');

test.after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

const directeur = db
  .prepare("INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES ('D', 'dir', 'directeur', 'x')")
  .run().lastInsertRowid;
const LE_DIRECTEUR = { id: directeur };

/* ------------------------------------------------------------------------- */

/*
 * Le point le plus important du lot : rendre les taux modifiables ne doit
 * changer AUCUN montant deja calcule. D'ou l'amorce a une date ancienne.
 */
test('a l ouverture, les taux sont ceux qui etaient dans le code', () => {
  const bareme = T.tauxDuMois(2026, 8);
  assert.equal(bareme.panier_repas, 12.2);
  assert.equal(bareme.gd_72, 72);
  assert.equal(bareme.gd_80, 80);
  assert.equal(bareme.prime_zone_va, 5);
  assert.equal(bareme.prime_zone_aa, 10);
  assert.equal(bareme.abattement_prime_zone, 0.8);
  assert.equal(bareme.heures_mensuelles, 151.67);
  assert.equal(bareme.majoration_hs_25, 1.25);
  assert.equal(bareme.majoration_hs_50, 1.5);
  assert.equal(bareme.part_net_estimee, 0.77);
});

test('un taux vaut a compter de son mois, et pas avant', () => {
  T.definir({ cle: 'panier_repas', valeur: '12,50', annee: 2027, mois: 1, note: 'Accord 2027' }, LE_DIRECTEUR);

  assert.equal(T.tauxDuMois(2026, 12).panier_repas, 12.2, 'decembre garde le sien');
  assert.equal(T.tauxDuMois(2027, 1).panier_repas, 12.5);
  assert.equal(T.tauxDuMois(2027, 6).panier_repas, 12.5, 'et il tient les mois suivants');
});

test('deux changements successifs se lisent dans l ordre', () => {
  T.definir({ cle: 'gd_72', valeur: 75, annee: 2027, mois: 4 }, LE_DIRECTEUR);
  T.definir({ cle: 'gd_72', valeur: 78, annee: 2027, mois: 9 }, LE_DIRECTEUR);

  assert.equal(T.tauxDuMois(2027, 3).gd_72, 72);
  assert.equal(T.tauxDuMois(2027, 4).gd_72, 75);
  assert.equal(T.tauxDuMois(2027, 8).gd_72, 75);
  assert.equal(T.tauxDuMois(2027, 9).gd_72, 78);
});

/*
 * Le tableau de paie doit suivre : c'est la que le taux se transforme en euros.
 */
test('un mois passe se valorise avec les taux de ce mois-la', () => {
  const salarie = {
    tauxHoraire: 20,
    minutes25: 0, minutes50: 0, minutesRoute: 0, minutesTrajet: 0,
    joursAmiante1: 0, joursAmiante2: 0, joursPanier: 10, joursGD72: 0, joursGD80: 0,
  };

  const avant = M.valoriser(salarie, { taux: T.tauxDuMois(2026, 12) });
  const apres = M.valoriser(salarie, { taux: T.tauxDuMois(2027, 1) });

  assert.equal(avant.paniers, 122, '10 jours a 12,20 €');
  assert.equal(apres.paniers, 125, '10 jours a 12,50 €');
  assert.equal(apres.totalBrut - avant.totalBrut, 3, 'seul le panier a bouge');
});

test('changer un taux ne touche a rien d autre', () => {
  const salarie = {
    tauxHoraire: 20,
    minutes25: 60, minutes50: 0, minutesRoute: 0, minutesTrajet: 0,
    joursAmiante1: 2, joursAmiante2: 0, joursPanier: 0, joursGD72: 0, joursGD80: 0,
  };
  const avant = M.valoriser(salarie, { taux: T.tauxDuMois(2026, 12) });
  const apres = M.valoriser(salarie, { taux: T.tauxDuMois(2027, 1) });

  assert.equal(avant.salaireBrut, apres.salaireBrut);
  assert.equal(avant.heuresSupBrut, apres.heuresSupBrut);
  assert.equal(avant.primeAmiante, apres.primeAmiante);
});

test('une cle inconnue est refusee', () => {
  const refus = T.definir({ cle: 'panier_de_crabes', valeur: 10, annee: 2027, mois: 1 }, LE_DIRECTEUR);
  assert.equal(refus.code, 400);
  assert.match(refus.erreur, /panier_de_crabes/);
});

test('un montant absurde est refuse', () => {
  for (const valeur of ['', 'abc', -5, null]) {
    const refus = T.definir({ cle: 'panier_repas', valeur, annee: 2027, mois: 2 }, LE_DIRECTEUR);
    assert.equal(refus.code, 400, `valeur ${JSON.stringify(valeur)}`);
  }
});

test('un mois hors bornes est refuse', () => {
  assert.equal(T.definir({ cle: 'gd_80', valeur: 85, annee: 2027, mois: 13 }, LE_DIRECTEUR).code, 400);
  assert.equal(T.definir({ cle: 'gd_80', valeur: 85, annee: 1990, mois: 3 }, LE_DIRECTEUR).code, 400);
});

/* Corriger une saisie du jour meme doit rester possible. */
test('redefinir le meme mois remplace la valeur', () => {
  T.definir({ cle: 'gd_80', valeur: 85, annee: 2028, mois: 1 }, LE_DIRECTEUR);
  T.definir({ cle: 'gd_80', valeur: 86, annee: 2028, mois: 1 }, LE_DIRECTEUR);

  assert.equal(T.tauxDuMois(2028, 1).gd_80, 86);
  const entrees = T.historique().find((t) => t.cle === 'gd_80').valeurs.filter((v) => v.debut === '2028-01-01');
  assert.equal(entrees.length, 1, 'une seule ligne pour un mois');
});

/*
 * Un montant de paie qui change sans qu'on sache qui l'a change ne vaut pas
 * mieux qu'un montant en dur.
 */
test('chaque changement de taux laisse une trace nominative', () => {
  T.definir({ cle: 'prime_zone_va', valeur: 6, annee: 2029, mois: 1, note: 'Avenant du 12/12' }, LE_DIRECTEUR);

  const trace = db
    .prepare("SELECT user_id, detail FROM journal WHERE action = 'taux_modifie' ORDER BY id DESC LIMIT 1")
    .get();
  assert.equal(trace.user_id, directeur);
  assert.match(trace.detail, /Prime de zone/);
  assert.match(trace.detail, /5 → 6/);
  assert.match(trace.detail, /2029-01-01/);
});

test('la valeur d origine ne se supprime pas', () => {
  const origine = T.historique()
    .find((t) => t.cle === 'panier_repas')
    .valeurs.find((v) => v.debut === T.DEBUT_ORIGINE);

  const refus = T.supprimer(origine.id, LE_DIRECTEUR);
  assert.equal(refus.code, 409);
  assert.equal(T.tauxDuMois(2020, 1).panier_repas, 12.2, 'elle est toujours la');
});

test('supprimer une date d effet rend le mois a la valeur precedente', () => {
  T.definir({ cle: 'panier_repas', valeur: 13, annee: 2030, mois: 6 }, LE_DIRECTEUR);
  assert.equal(T.tauxDuMois(2030, 6).panier_repas, 13);

  const ajoute = T.historique()
    .find((t) => t.cle === 'panier_repas')
    .valeurs.find((v) => v.debut === '2030-06-01');
  assert.deepEqual(T.supprimer(ajoute.id, LE_DIRECTEUR), { ok: true });
  assert.equal(T.tauxDuMois(2030, 6).panier_repas, 12.5, 'on retombe sur le taux de 2027');
});

/*
 * « Net » designe ici une estimation, pas un calcul de paie. Le nom de la cle le
 * dit, et le catalogue le signale a l'ecran : c'est la seule protection contre
 * la lecture d'un chiffre pour ce qu'il n'est pas.
 */
test('la part nette est declaree comme une estimation', () => {
  const entree = T.CATALOGUE.find((t) => t.cle === 'part_net_estimee');
  assert.equal(entree.estimation, true);
  assert.match(entree.libelle, /estimée/);
});

/*
 * Un ferie travaille se paie double : ces heures figurent deja dans le salaire
 * mensualise, donc ce qui s'ajoute est le SUPPLEMENT — une fois le taux.
 */
test('les heures travaillees un jour ferie valent un supplement d une fois le taux', () => {
  const base = {
    tauxHoraire: 20,
    minutes25: 0, minutes50: 0, minutesRoute: 0, minutesTrajet: 0,
    joursAmiante1: 0, joursAmiante2: 0, joursPanier: 0, joursGD72: 0, joursGD80: 0,
  };
  const bareme = T.tauxDuMois(2026, 8);

  const chome = M.valoriser({ ...base, minutesFeries: 0 }, { taux: bareme });
  const travaille = M.valoriser({ ...base, minutesFeries: 6 * 60 }, { taux: bareme });

  assert.equal(chome.feries, 0, 'un ferie que personne n a travaille ne vaut rien de plus');
  assert.equal(travaille.feries, 6 * 20, 'six heures a une fois le taux : le double, base comprise');
  assert.equal(travaille.totalBrut - chome.totalBrut, 120);
});

test('la majoration de ferie se regle comme les autres taux', () => {
  T.definir({ cle: 'majoration_ferie', valeur: 2.5, annee: 2031, mois: 1, note: 'Accord' }, LE_DIRECTEUR);
  const salarie = {
    tauxHoraire: 20, minutesFeries: 4 * 60,
    minutes25: 0, minutes50: 0, minutesRoute: 0, minutesTrajet: 0,
    joursAmiante1: 0, joursAmiante2: 0, joursPanier: 0, joursGD72: 0, joursGD80: 0,
  };

  assert.equal(M.valoriser(salarie, { taux: T.tauxDuMois(2030, 12) }).feries, 4 * 20);
  assert.equal(M.valoriser(salarie, { taux: T.tauxDuMois(2031, 1) }).feries, 4 * 20 * 1.5);
});

/*
 * Le titre-restaurant est propre au personnel non productif : le tableau des
 * chantiers a son panier repas, et les deux ne se confondent pas.
 */
test('le titre-restaurant a sa propre valeur, et sa date d effet', () => {
  assert.equal(T.tauxDuMois(2026, 8).edenred, 11.7);

  T.definir({ cle: 'edenred', valeur: '12', annee: 2032, mois: 3 }, LE_DIRECTEUR);
  assert.equal(T.tauxDuMois(2032, 2).edenred, 11.7);
  assert.equal(T.tauxDuMois(2032, 3).edenred, 12);
});
