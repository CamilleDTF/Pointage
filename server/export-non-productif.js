'use strict';

/*
 * Classeur de paie du personnel non productif.
 *
 * Rien a voir avec celui des chantiers, et c'est voulu : la ou le classeur
 * mensuel reproduit fidelement le tableau existant du directeur — six semaines,
 * une feuille par salarie, des formules INDIRECT — celui-ci n'a rien a
 * reproduire. Personne n'a de fiche hebdomadaire ici. Une seule feuille, une
 * ligne par personne, le detail des absences et des primes en note : c'est tout
 * ce que le mois contient.
 *
 * Il porte des salaires, donc il ne se telecharge que contre le code du
 * directeur — l'ecran des heures, lui, reste consultable sans montants.
 */

const ExcelJS = require('exceljs');
const D = require('./domaine');

const POLICE = 'Calibri';
const GRIS = 'FFD9D9D9';
const BLEU_PALE = 'FFDCE6F1';
const ORANGE = 'FFF8CBAD'; // le taux horaire manquant : il bloque tout le calcul

const BORDURE = {
  top: { style: 'thin', color: { argb: 'FF999999' } },
  left: { style: 'thin', color: { argb: 'FF999999' } },
  bottom: { style: 'thin', color: { argb: 'FF999999' } },
  right: { style: 'thin', color: { argb: 'FF999999' } },
};

const remplir = (cellule, couleur) => {
  cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: couleur } };
};

/** Les colonnes de la feuille, dans l'ordre. `euros` = ce qui vaut de l'argent. */
const COLONNES = [
  { entete: 'Matricule', largeur: 11, lire: (s) => s.matricule || '' },
  { entete: 'Nom', largeur: 18, lire: (s) => s.nom },
  { entete: 'Prénom', largeur: 14, lire: (s) => s.prenom },
  { entete: 'Jours travaillés', largeur: 9, lire: (s) => s.joursTravailles, format: '0' },
  { entete: 'Heures', largeur: 9, lire: (s) => s.minutes / 60, format: '#,##0.00' },
  { entete: 'Absences', largeur: 9, lire: (s) => s.joursAbsence, format: '0' },
  { entete: 'Détail', largeur: 16, lire: detailAbsences },
  { entete: 'H. sup 25 %', largeur: 10, lire: (s) => s.minutes25 / 60, format: '#,##0.00' },
  { entete: 'H. sup 50 %', largeur: 10, lire: (s) => s.minutes50 / 60, format: '#,##0.00' },
  { entete: 'GD 72', largeur: 8, lire: (s) => s.joursGD72, format: '0' },
  { entete: 'GD 80', largeur: 8, lire: (s) => s.joursGD80, format: '0' },
  { entete: 'Taux', largeur: 9, euros: true, lire: (s) => s.tauxHoraire, format: '#,##0.00 €' },
  { entete: 'Salaire brut', largeur: 12, euros: true, lire: (s) => s.salaireBrut, format: '#,##0.00 €' },
  { entete: 'H. sup brut', largeur: 12, euros: true, lire: (s) => s.heuresSupBrut, format: '#,##0.00 €' },
  { entete: 'Primes', largeur: 11, euros: true, lire: (s) => s.primes, format: '#,##0.00 €' },
  { entete: 'GD €', largeur: 11, euros: true, lire: (s) => s.grandDeplacement, format: '#,##0.00 €' },
  { entete: 'EDENRED', largeur: 11, euros: true, lire: (s) => s.edenred, format: '#,##0.00 €' },
  { entete: 'Total brut', largeur: 12, euros: true, lire: (s) => s.totalBrut, format: '#,##0.00 €' },
  { entete: 'Net estimé', largeur: 12, euros: true, lire: (s) => s.totalNet, format: '#,##0.00 €' },
];

function detailAbsences(salarie) {
  return Object.entries(salarie.absences || {})
    .map(([code, n]) => `${code} ×${n}`)
    .join(', ');
}

async function exporterPaieNonProductif(mois) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pointage DTF';
  wb.created = new Date();
  const ws = wb.addWorksheet('Personnel non productif');

  ws.getCell('A1').value = `Personnel non productif — paie de ${D.MOIS[mois.mois - 1]} ${mois.annee}`;
  ws.getCell('A1').font = { name: POLICE, size: 13, bold: true };
  ws.mergeCells(1, 1, 1, COLONNES.length);

  ws.getCell('A2').value =
    `${mois.joursOuvres} jours ouvrés × 7 h = ${mois.heuresReference} h de référence. ` +
    'Chacun est à 7 h par jour ouvré ; seuls les écarts sont saisis.';
  ws.getCell('A2').font = { name: POLICE, size: 10, italic: true };
  ws.mergeCells(2, 1, 2, COLONNES.length);

  const LIGNE_ENTETE = 4;
  COLONNES.forEach((colonne, i) => {
    const cellule = ws.getCell(LIGNE_ENTETE, i + 1);
    cellule.value = colonne.entete;
    cellule.font = { name: POLICE, size: 11, bold: true };
    cellule.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cellule.border = BORDURE;
    remplir(cellule, GRIS);
    ws.getColumn(i + 1).width = colonne.largeur;
  });

  const premiere = LIGNE_ENTETE + 1;
  mois.salaries.forEach((salarie, index) => {
    const r = premiere + index;
    COLONNES.forEach((colonne, i) => {
      const cellule = ws.getCell(r, i + 1);
      // Sans taux horaire, rien n'est calcule : mieux vaut une case vide qu'un
      // salaire faux, et le manque doit se voir.
      const vide = colonne.euros && salarie.tauxManquant;
      cellule.value = vide ? '' : colonne.lire(salarie);
      if (colonne.format && !vide) cellule.numFmt = colonne.format;
      cellule.font = { name: POLICE, size: 11 };
      cellule.border = BORDURE;
      if (vide) remplir(cellule, ORANGE);
    });

    if (salarie.tauxManquant) {
      ws.getCell(r, COLONNES.length).note = 'Taux horaire à renseigner dans Paramètres.';
    }
    if (salarie.detailPrimes && salarie.detailPrimes.length) {
      const colonnePrimes = COLONNES.findIndex((c) => c.entete === 'Primes') + 1;
      ws.getCell(r, colonnePrimes).note = salarie.detailPrimes
        .map((p) => `${p.libelle || 'Prime'} : ${Number(p.montant).toFixed(2)} €`)
        .join('\n');
    }
  });

  if (!mois.salaries.length) {
    ws.getCell(premiere, 1).value = 'Aucune personne enregistrée dans le personnel non productif.';
    ws.getCell(premiere, 1).font = { name: POLICE, size: 11, italic: true };
    return wb.xlsx.writeBuffer();
  }

  const derniere = premiere + mois.salaries.length - 1;
  const rTotal = derniere + 1;
  ws.getCell(rTotal, 1).value = 'TOTAL';
  ws.getCell(rTotal, 1).font = { name: POLICE, size: 11, bold: true };
  COLONNES.forEach((colonne, i) => {
    const cellule = ws.getCell(rTotal, i + 1);
    cellule.border = BORDURE;
    remplir(cellule, BLEU_PALE);
    // Une somme de taux horaires ne veut rien dire ; une somme de salaires, si.
    if (!colonne.format || colonne.entete === 'Taux') return;
    const lettre = ws.getColumn(i + 1).letter;
    cellule.value = { formula: `SUM(${lettre}${premiere}:${lettre}${derniere})` };
    cellule.numFmt = colonne.format;
    cellule.font = { name: POLICE, size: 11, bold: true };
  });

  ws.views = [{ state: 'frozen', ySplit: LIGNE_ENTETE }];
  return wb.xlsx.writeBuffer();
}

module.exports = { exporterPaieNonProductif };
