'use strict';

/*
 * L'export CSV, et le piege du tableur.
 *
 * Deux dangers vivent dans une cellule CSV, et ils ne se traitent pas pareil. Le
 * point-virgule, le guillemet et le retour a la ligne cassent le FORMAT : on
 * entoure de guillemets. Mais une cellule qui commence par =, +, - ou @ est
 * autre chose : Excel et LibreOffice la lisent comme une FORMULE a l'ouverture.
 * Un nom de chantier saisi « =1+1 » suffit a le montrer, et d'autres formules
 * savent lire des cellules ou appeler l'exterieur.
 *
 * Le fichier part chez le comptable : ce qu'on y ecrit doit rester du texte.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const X = require('../server/export');

/** Une ligne d'export telle que `lignesPourExport` la produit. */
function ligne(champs) {
  return {
    annee: 2026,
    semaine: 33,
    dates: ['2026-08-10', '', '', '', '', '', '2026-08-16'],
    matricule: 'A1',
    nom_affiche: 'MARTIN Paul',
    chef_nom: 'BENALI Karim',
    chantier: 'Lycée Jean Moulin',
    ville: 'Toulouse',
    total_minutes: 2250,
    minutes_route: 0,
    minutes_trajet: 0,
    jours_zone: 3,
    type_masque: 'VA',
    nb_deplacement: 0,
    statut: 'validee',
    jours: [],
    ...champs,
  };
}

const cellules = (csv, rang = 1) => csv.trim().split('\r\n')[rang].split(';');

/** Le contenu reel d'une cellule, une fois l'echappement CSV retire. */
const contenu = (cellule) =>
  cellule.startsWith('"') ? cellule.slice(1, -1).replace(/""/g, '"') : cellule;

test('un export ordinaire reste lisible tel quel', () => {
  const csv = X.exporterCsv([ligne({})]);
  const entetes = csv.trim().split('\r\n')[0].split(';');
  assert.equal(entetes[0].replace('﻿', ''), 'annee');
  assert.deepEqual(cellules(csv).slice(4, 9), ['A1', 'MARTIN Paul', 'BENALI Karim', 'Lycée Jean Moulin', 'Toulouse']);
});

/*
 * Le coeur du sujet : ces quatre caracteres en tete de cellule declenchent une
 * formule. On les fait preceder d'une apostrophe, que le tableur consomme pour
 * dire « ceci est du texte » et qui ne s'affiche pas dans la cellule.
 */
test('une cellule qui commence par un signe de formule est neutralisee', () => {
  for (const dangereux of ['=1+1', '+SOMME(A1:A9)', '-2+3', '@SUM(A1)', '=HYPERLINK("http://ailleurs","clic")']) {
    const csv = X.exporterCsv([ligne({ chantier: dangereux })]);
    // Une valeur contenant un guillemet est aussi entouree : on regarde le
    // contenu, pas la forme.
    const cellule = contenu(cellules(csv)[7]);
    assert.equal(cellule, `'${dangereux}`, `non neutralisé : ${dangereux}`);
  }
});

test('la neutralisation vaut pour toutes les colonnes de texte, pas seulement le chantier', () => {
  const csv = X.exporterCsv([
    ligne({ nom_affiche: '=cmd', ville: '@ville', chef_nom: '-chef', type_masque: '+VA' }),
  ]);
  const c = cellules(csv);
  assert.equal(c[5], "'=cmd");
  assert.equal(c[6], "'-chef");
  assert.equal(c[8], "'@ville");
  assert.equal(c[13], "'+VA");
});

/*
 * Le garde-fou du garde-fou : un nombre negatif commence aussi par « - ». Le
 * neutraliser en ferait du texte, et la colonne cesserait de s'additionner chez
 * le comptable — on aurait remplace un risque par une erreur de calcul.
 */
test('un nombre negatif reste un nombre', () => {
  const csv = X.exporterCsv([ligne({ jours_zone: -1, nb_deplacement: -2.5 })]);
  const c = cellules(csv);
  assert.equal(c[12], '-1');
  assert.equal(c[14], '-2.5');
});

/* L'echappement d'origine ne doit pas avoir ete perdu en route. */
test('les separateurs et les guillemets restent echappes', () => {
  const csv = X.exporterCsv([ligne({ chantier: 'Rue du ; 8 mai', ville: 'dit "la Cite"' })]);
  const rang = csv.trim().split('\r\n')[1];
  assert.ok(rang.includes('"Rue du ; 8 mai"'));
  assert.ok(rang.includes('"dit ""la Cite"""'));
});

test('les deux protections se combinent sur une meme cellule', () => {
  const csv = X.exporterCsv([ligne({ chantier: '=1;2' })]);
  assert.ok(csv.includes('"\'=1;2"'), "l'apostrophe est posee, puis l'ensemble est entoure");
});
