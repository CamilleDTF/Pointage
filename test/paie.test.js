'use strict';

/**
 * Regles de preparation de la paie, telles qu'elles alimentent le tableau
 * mensuel du directeur : majorations hebdomadaires, grand deplacement, et
 * decoupage du mois en six semaines.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../server/domaine');

const h = (heures) => Math.round(heures * 60);

test('les 8 premieres heures supplementaires sont a 25 %, les suivantes a 50 %', () => {
  const cas = [
    [35, 0, 0],
    [36, 1, 0],
    [43, 8, 0], // pile le seuil des 8 heures
    [44, 8, 1],
    [48, 8, 5],
    [35.5, 0.5, 0],
  ];
  for (const [total, attendu25, attendu50] of cas) {
    const { minutes25, minutes50 } = D.heuresSupplementaires(h(total));
    assert.equal(minutes25, h(attendu25), `${total} h -> 25 %`);
    assert.equal(minutes50, h(attendu50), `${total} h -> 50 %`);
  }
});

test('une semaine en dessous de 35 h ne genere aucune majoration', () => {
  for (const total of [0, 12, 28, 34.75]) {
    assert.deepEqual(D.heuresSupplementaires(h(total)), { minutes25: 0, minutes50: 0 });
  }
});

test('la somme des majorations vaut toujours les heures au-dela de 35 h', () => {
  for (let quart = 0; quart <= 60 * 4; quart += 1) {
    const total = quart * 15;
    const { minutes25, minutes50 } = D.heuresSupplementaires(total);
    assert.equal(minutes25 + minutes50, Math.max(0, total - 35 * 60));
    assert.ok(minutes25 <= 8 * 60, 'le palier a 25 % ne depasse jamais 8 heures');
    assert.ok(minutes50 === 0 || minutes25 === 8 * 60, 'le 50 % ne demarre qu une fois les 8 heures atteintes');
  }
});

test('la case Contrôle du classeur retombe a zero quand tout est reparti', () => {
  // Formule du classeur : total de la semaine - 25 % - 50 % - 100 % - 35.
  for (const total of [35, 39, 43, 45, 48]) {
    const { minutes25, minutes50 } = D.heuresSupplementaires(h(total));
    const reste = h(total) - minutes25 - minutes50 - h(35);
    assert.equal(reste, 0, `${total} h : rien ne doit rester a redistribuer`);
  }
});

test('Nice et Paris relevent du GD 80, toute autre ville du GD 72', () => {
  for (const ville of ['Nice', 'NICE', 'nice', 'Paris', 'Paris 15e', 'PARIS 19', 'Nice Nord']) {
    assert.equal(D.estGrandDeplacement80(ville), true, ville);
  }
  for (const ville of ['Toulouse', 'Blagnac', 'Colomiers', 'Nicexyz', 'Venice', '', null]) {
    assert.equal(D.estGrandDeplacement80(ville), false, String(ville));
  }
});

test('un mois couvre six semaines a partir de celle qui contient le 1er', () => {
  // Juillet 2026 : le 1er tombe un mercredi, en semaine 27.
  const juillet = D.semainesDuMois(2026, 7);
  assert.equal(juillet.length, 6);
  assert.deepEqual(juillet.map((s) => s.semaine), [27, 28, 29, 30, 31, 32]);
  assert.equal(juillet[0].dates[0], '2026-06-29');
  assert.equal(juillet[5].dates[6], '2026-08-09');
});

test('un mois qui demarre un lundi commence sur sa propre semaine', () => {
  // 1er juin 2026 est un lundi.
  const juin = D.semainesDuMois(2026, 6);
  assert.equal(juin[0].dates[0], '2026-06-01');
});

test('un mois de janvier reprend la semaine a cheval sur l annee precedente', () => {
  const janvier = D.semainesDuMois(2027, 1);
  assert.equal(janvier.length, 6);
  // Le 1er janvier 2027 est un vendredi : sa semaine est la 53 de 2026.
  assert.equal(janvier[0].annee, 2026);
  assert.equal(janvier[0].semaine, 53);
  assert.ok(janvier[0].dates.includes('2027-01-01'));
});

test('les six semaines d un mois se suivent sans trou ni recouvrement', () => {
  for (let mois = 1; mois <= 12; mois += 1) {
    const semaines = D.semainesDuMois(2026, mois);
    for (let i = 1; i < semaines.length; i += 1) {
      const veille = new Date(`${semaines[i - 1].dates[6]}T00:00:00Z`);
      const lendemain = new Date(`${semaines[i].dates[0]}T00:00:00Z`);
      assert.equal(
        (lendemain - veille) / 86400000,
        1,
        `mois ${mois} : la semaine ${semaines[i].semaine} doit suivre immediatement la precedente`
      );
    }
  }
});

test('chaque jour du mois est couvert par les six semaines', () => {
  for (let mois = 1; mois <= 12; mois += 1) {
    const couvertes = new Set(D.semainesDuMois(2026, mois).flatMap((s) => s.dates));
    const dernier = new Date(Date.UTC(2026, mois, 0)).getUTCDate();
    for (let jour = 1; jour <= dernier; jour += 1) {
      const iso = `2026-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
      assert.ok(couvertes.has(iso), `${iso} doit figurer dans le tableau du mois ${mois}`);
    }
  }
});

/* ------------------------ Valorisation d'un mois -------------------------- */

const M = require('../server/mensuel');

function moisType(modifications = {}) {
  return {
    tauxHoraire: 14,
    minutes25: 8 * 60,
    minutes50: 2 * 60,
    minutesRoute: 60,
    minutesTrajet: 120,
    joursAmiante1: 4,
    joursAmiante2: 2,
    joursPanier: 10,
    joursGD72: 6,
    joursGD80: 4,
    ...modifications,
  };
}

test('sans taux horaire, aucun montant n est calcule', () => {
  const v = M.valoriser(moisType({ tauxHoraire: 0 }));
  assert.equal(v.tauxManquant, true);
  assert.equal(v.salaireBrut, 0);
  assert.equal(v.totalNet, 0);
});

test('le salaire de base suit la duree legale mensualisee', () => {
  const v = M.valoriser(moisType());
  assert.equal(v.tauxManquant, false);
  assert.equal(Math.round(v.salaireBrut * 100) / 100, Math.round(151.67 * 14 * 100) / 100);
  assert.equal(Math.round(v.salaireNet * 100) / 100, Math.round(151.67 * 14 * 0.77 * 100) / 100);
});

test('les heures supplementaires sont majorees a 25 puis 50 %', () => {
  const v = M.valoriser(moisType());
  // 8 h a 125 % + 2 h a 150 %, au taux de 14 €.
  assert.equal(v.heuresSupBrut, 14 * 1.25 * 8 + 14 * 1.5 * 2);
});

test('primes amiante, paniers et grands deplacements suivent le classeur', () => {
  const v = M.valoriser(moisType(), { montantPanier: 11.7 });
  assert.equal(v.primeAmiante, (4 * 5 + 2 * 10) * 0.8);
  assert.equal(Math.round(v.paniers * 100) / 100, 117);
  assert.equal(v.grandDeplacement, 6 * 72 + 4 * 80);
  // Trajet paye a 50 %, route a 100 %.
  assert.equal(v.trajet, 14 * 1 + 14 * 1);
});

test('sans montant de panier fixe, la ligne Paniers reste a zero', () => {
  assert.equal(M.valoriser(moisType()).paniers, 0);
});
