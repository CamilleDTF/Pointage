'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../server/domaine');

test('les heures se saisissent en h/min, en decimal ou avec deux points', () => {
  assert.equal(D.versMinutes('7h30'), 450);
  assert.equal(D.versMinutes('7:30'), 450);
  assert.equal(D.versMinutes('7,5'), 450);
  assert.equal(D.versMinutes('7.5'), 450);
  assert.equal(D.versMinutes('8h'), 480);
  assert.equal(D.versMinutes('8'), 480);
  assert.equal(D.versMinutes(''), 0);
  assert.equal(D.versMinutes(null), 0);
  assert.equal(D.versMinutes('abc'), 0);
  assert.equal(D.versMinutes('-3'), 0);
});

test('les minutes se reaffichent au format de la fiche papier', () => {
  assert.equal(D.versTexte(450), '7h30');
  assert.equal(D.versTexte(480), '8h00');
  assert.equal(D.versTexte(0), '0h00');
  assert.equal(D.versDecimal(450), 7.5);
  assert.equal(D.versDecimal(465), 7.75);
});

test('les dates de la semaine ISO commencent bien un lundi', () => {
  const dates = D.datesDeLaSemaine(2026, 31);
  assert.equal(dates.length, 7);
  assert.equal(dates[0], '2026-07-27');
  assert.equal(dates[6], '2026-08-02');
  assert.equal(new Date(`${dates[0]}T00:00:00Z`).getUTCDay(), 1);
});

test('la semaine 1 respecte la regle du premier jeudi', () => {
  // Le 1er janvier 2026 est un jeudi : il appartient donc a la semaine 1.
  assert.deepEqual(D.semaineISO(new Date(2026, 0, 1)), { annee: 2026, semaine: 1 });
  // Le 1er janvier 2027 est un vendredi : il reste rattache a la semaine 53 de 2026.
  assert.deepEqual(D.semaineISO(new Date(2027, 0, 1)), { annee: 2026, semaine: 53 });
});

function ficheType(modifications = {}) {
  return {
    chantier: 'Lycee Jean Moulin',
    ville: 'Toulouse',
    annee: 2026,
    semaine: 31,
    ...modifications,
  };
}

function ligneType(modifications = {}) {
  return {
    nom_affiche: 'ANDRE Alain',
    minutes_route: 150,
    minutes_trajet: 90,
    jours_zone: 4,
    type_masque: 'VA',
    nb_deplacement: 5,
    signature: 'data:image/png;base64,xxx',
    jours: Array.from({ length: 7 }, (_, j) => ({
      jour: j,
      minutes: j <= 4 ? 450 : 0,
      code_absence: '',
    })),
    ...modifications,
  };
}

test('une fiche complete ne remonte aucune anomalie', () => {
  assert.deepEqual(D.controlerFiche(ficheType(), [ligneType()]), []);
});

test('le chantier et la ville sont obligatoires', () => {
  const anomalies = D.controlerFiche(ficheType({ chantier: '', ville: '  ' }), [ligneType()]);
  const messages = anomalies.map((a) => a.message);
  assert.ok(messages.some((m) => m.includes('chantier')));
  assert.ok(messages.some((m) => m.includes('ville')));
  assert.ok(anomalies.every((a) => a.niveau === 'bloquant'));
});

test('un jour ouvre sans heures ni code absence bloque la transmission', () => {
  const ligne = ligneType();
  ligne.jours[2].minutes = 0;
  const anomalies = D.controlerFiche(ficheType(), [ligne]);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].niveau, 'bloquant');
  assert.match(anomalies[0].message, /Mercredi/);
});

test('un code absence dispense de saisir des heures', () => {
  const ligne = ligneType();
  ligne.jours[2] = { jour: 2, minutes: 0, code_absence: 'AT' };
  assert.deepEqual(D.controlerFiche(ficheType(), [ligne]), []);
});

test('un code absence inconnu est refuse', () => {
  const ligne = ligneType();
  ligne.jours[2] = { jour: 2, minutes: 0, code_absence: 'ZZ' };
  const anomalies = D.controlerFiche(ficheType(), [ligne]);
  assert.equal(anomalies[0].niveau, 'bloquant');
  assert.match(anomalies[0].message, /inconnu/);
});

test('heures et code absence le meme jour declenchent une alerte, pas un blocage', () => {
  const ligne = ligneType();
  ligne.jours[2].code_absence = 'ACH';
  const anomalies = D.controlerFiche(ficheType(), [ligne]);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].niveau, 'alerte');
});

test('les jours en zone imposent un type de masque et ne depassent pas 7', () => {
  const sansMasque = D.controlerFiche(ficheType(), [ligneType({ type_masque: '' })]);
  assert.ok(sansMasque.some((a) => a.niveau === 'bloquant' && /masque/.test(a.message)));

  const tropDeJours = D.controlerFiche(ficheType(), [ligneType({ jours_zone: 9 })]);
  assert.ok(tropDeJours.some((a) => a.niveau === 'bloquant' && /jours en zone/.test(a.message)));
});

test('un depassement du plafond de 48h est signale sans bloquer la paie', () => {
  const ligne = ligneType();
  for (const jour of ligne.jours) jour.minutes = 8 * 60; // 56h sur 7 jours
  const anomalies = D.controlerFiche(ficheType(), [ligne]);
  assert.ok(anomalies.every((a) => a.niveau === 'alerte'));
  assert.ok(anomalies.some((a) => /48h/.test(a.message)));
});

test('une signature manquante alerte le directeur sans bloquer', () => {
  const anomalies = D.controlerFiche(ficheType(), [ligneType({ signature: null })]);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].niveau, 'alerte');
  assert.match(anomalies[0].message, /signature/);
});

test('une fiche sans aucun salarie ne peut pas etre transmise', () => {
  const anomalies = D.controlerFiche(ficheType(), [ligneType({ nom_affiche: '' })]);
  assert.ok(anomalies.some((a) => a.niveau === 'bloquant' && /Aucun salarie/.test(a.message)));
});

test('semaineISO et datesDeLaSemaine sont reciproques sur toute une annee', () => {
  for (let semaine = 1; semaine <= 52; semaine += 1) {
    for (const iso of D.datesDeLaSemaine(2026, semaine)) {
      const [a, m, j] = iso.split('-').map(Number);
      assert.deepEqual(
        D.semaineISO(new Date(a, m - 1, j)),
        { annee: 2026, semaine },
        `${iso} devrait tomber en semaine ${semaine}`
      );
    }
  }
});
