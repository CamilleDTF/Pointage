'use strict';

const ExcelJS = require('exceljs');
const D = require('./domaine');

const POLICE = 'Arial';
const GRIS = 'FFD9D9D9';
const GRIS_CLAIR = 'FFF2F2F2';
const JAUNE = 'FFFFF2CC';

const BORDURE = {
  top: { style: 'thin', color: { argb: 'FF808080' } },
  left: { style: 'thin', color: { argb: 'FF808080' } },
  bottom: { style: 'thin', color: { argb: 'FF808080' } },
  right: { style: 'thin', color: { argb: 'FF808080' } },
};

function nouveauClasseur() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pointage DTF';
  wb.created = new Date();
  return wb;
}

function remplir(cellule, couleur) {
  cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: couleur } };
}

function styleEntete(ws, plage, couleur = GRIS) {
  ws.getCell(plage.split(':')[0]).font = { name: POLICE, size: 9, bold: true };
  for (const cellule of cellulesDePlage(ws, plage)) {
    remplir(cellule, couleur);
    cellule.border = BORDURE;
    cellule.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }
}

function* cellulesDePlage(ws, plage) {
  const [debut, fin = debut] = plage.split(':');
  const dec = (ref) => {
    const m = ref.match(/^([A-Z]+)(\d+)$/);
    let col = 0;
    for (const c of m[1]) col = col * 26 + (c.charCodeAt(0) - 64);
    return { col, row: Number(m[2]) };
  };
  const a = dec(debut);
  const b = dec(fin);
  for (let r = a.row; r <= b.row; r += 1) {
    for (let c = a.col; c <= b.col; c += 1) yield ws.getCell(r, c);
  }
}

/* ------------------------------------------------------------------ */
/* 1. Replique de la fiche papier (archivage, controle, impression A4) */
/* ------------------------------------------------------------------ */

const LARGEURS = {
  A: 29.3, B: 7.1, C: 7.1, D: 7.1, E: 7.1, F: 7.1, G: 7.1, H: 7.1,
  I: 10.1, J: 10.1, K: 8.9, L: 10.4, M: 11.4, N: 11.7,
  O: 6.1, P: 4.6, Q: 12.9, R: 3.7, S: 10.4, T: 4.7, U: 3.6,
};

const HAUTEURS = {
  1: 51, 2: 29.45, 3: 24.75, 4: 10.5, 5: 20.25, 6: 14.25, 7: 12.75, 8: 15.75,
  9: 12.75, 10: 30, 11: 25.5, 12: 24.75, 13: 24.75, 14: 27, 15: 25.5, 16: 24.75,
  17: 25.5, 18: 28.35, 19: 28.35, 20: 28.35, 21: 28.35, 22: 18, 23: 17.25, 24: 18,
  25: 18.75, 26: 18.75, 27: 19.5, 28: 20.25, 29: 21, 30: 23.25, 31: 16.5, 32: 28.5,
};

const FUSIONS = [
  'A1:P1', 'A2:U2', 'A3:A4', 'B3:K4', 'L3:N5', 'O3:R5', 'S3:U5', 'B5:K5',
  'A6:A9', 'B6:K6', 'L6:N6', 'O6:U6',
  'B7:B8', 'C7:C8', 'D7:D8', 'E7:E8', 'F7:F8', 'G7:G8', 'H7:H8',
  'I7:I10', 'J7:J10', 'K7:K10', 'L7:L10', 'M7:M10', 'N7:N10', 'O7:R10', 'S7:U10',
  'A22:U22', 'E23:U28', 'E29:O31', 'P29:U31', 'A32:D32', 'E32:O32', 'P32:U32',
];

/** Ecrit la fiche telle qu'elle existe sur papier, dans une feuille donnee. */
function ecrireFicheSurFeuille(ws, fiche) {
  ws.pageSetup = {
    orientation: 'landscape',
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0.2, footer: 0.2 },
  };
  for (const [col, largeur] of Object.entries(LARGEURS)) ws.getColumn(col).width = largeur;
  for (const [ligne, hauteur] of Object.entries(HAUTEURS)) ws.getRow(Number(ligne)).height = hauteur;

  for (const plage of FUSIONS) ws.mergeCells(plage);
  for (let r = 11; r <= 21; r += 1) {
    ws.mergeCells(`O${r}:R${r}`);
    ws.mergeCells(`S${r}:U${r}`);
  }
  for (let r = 23; r <= 31; r += 1) {
    ws.mergeCells(`A${r}:B${r}`);
    ws.mergeCells(`C${r}:D${r}`);
  }

  ws.getCell('A1').value = 'POINTAGE DES HEURES HEBDOMADAIRES PAR CHANTIER';
  ws.getCell('A1').font = { name: POLICE, size: 16, bold: true };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };

  ws.getCell('A2').value =
    "A remettre au Conducteur de travaux le LUNDI de la semaine suivante - accompagnée  obligatoirement des fiches d'expositions journalières.  Les temps sont à remplir en heures et minutes.";
  ws.getCell('A2').font = { name: POLICE, size: 9, italic: true };
  ws.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  const champs = [
    ['A3', `Année ${fiche.annee}`, null],
    ['A5', `Semaine N° ${fiche.semaine}`, null],
    ['B3', 'Nom du Chantier :', fiche.chantier],
    ['B5', 'Ville :', fiche.ville],
    ['L3', 'Nom conducteur du véhicule :', fiche.conducteur_vehicule],
    ['O3', 'Type Véhicule utilisé :', fiche.type_vehicule],
    ['S3', 'N° Immatriculation :', fiche.immatriculation],
  ];
  for (const [ref, libelle, valeur] of champs) {
    const cellule = ws.getCell(ref);
    cellule.value = valeur ? `${libelle} ${valeur}` : libelle;
    cellule.font = { name: POLICE, size: 10, bold: true };
    cellule.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
    cellule.border = BORDURE;
  }
  remplir(ws.getCell('B3'), GRIS_CLAIR);

  ws.getCell('A6').value = 'NOMS - Prénoms';
  ws.getCell('B6').value = "NOMBRE D'HEURES DE TRAVAIL (hors temps de repas et de trajet)";
  ws.getCell('L6').value = 'PRIMES PENIBILITES ET/OU DEPLACEMENT';
  ws.getCell('O6').value = 'OBSERVATIONS ET SIGNATURES';
  for (const ref of ['A6', 'B6', 'L6', 'O6']) styleEntete(ws, `${ref}:${ref}`, GRIS);
  for (const plage of ['A6:A9', 'B6:K6', 'L6:N6', 'O6:U6']) styleEntete(ws, plage, GRIS);

  for (const col of ['B', 'C', 'D', 'E', 'F', 'G', 'H']) {
    ws.getCell(`${col}7`).value = 'NBRE HRES';
    styleEntete(ws, `${col}7:${col}8`, GRIS_CLAIR);
  }
  const colonnesTotaux = [
    ['I', 'TOTAL HEURES SEMAINE'],
    ['J', 'TOTAL HEURES ROUTES 100%'],
    ['K', 'TOTAL HEURES TRAJETS  50%'],
    ['L', 'TOTAL JOURS EN ZONE'],
    ['M', 'TYPE DE MASQUE \n(VA OU AA)'],
    ['N', 'NBRE DEPLACEMENT'],
  ];
  for (const [col, libelle] of colonnesTotaux) {
    ws.getCell(`${col}7`).value = libelle;
    styleEntete(ws, `${col}7:${col}10`, GRIS_CLAIR);
  }
  ws.getCell('O7').value = 'Observations éventuelles sur le pointage :';
  styleEntete(ws, 'O7:R10', GRIS_CLAIR);
  ws.getCell('S7').value = 'Signature du salarié obligatoire';
  styleEntete(ws, 'S7:U10', GRIS_CLAIR);

  D.JOURS_COURTS.forEach((jour, i) => {
    const col = String.fromCharCode(66 + i); // B..H
    const cellule = ws.getCell(`${col}9`);
    cellule.value = jour;
    cellule.font = { name: POLICE, size: 10, bold: true };
    cellule.alignment = { horizontal: 'center', vertical: 'middle' };
    cellule.border = BORDURE;
    remplir(cellule, i >= 5 ? GRIS : GRIS_CLAIR);
  });

  ws.getCell('A10').value = 'Dates (J/M)';
  ws.getCell('A10').font = { name: POLICE, size: 9, bold: true };
  ws.getCell('A10').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getCell('A10').border = BORDURE;
  remplir(ws.getCell('A10'), GRIS_CLAIR);

  const dates = fiche.dates || D.datesDeLaSemaine(fiche.annee, fiche.semaine);
  dates.forEach((iso, i) => {
    const col = String.fromCharCode(66 + i);
    const cellule = ws.getCell(`${col}10`);
    cellule.value = D.jourMois(iso);
    cellule.font = { name: POLICE, size: 9 };
    cellule.alignment = { horizontal: 'center', vertical: 'middle' };
    cellule.border = BORDURE;
    remplir(cellule, GRIS_CLAIR);
  });

  // Lignes de salaries : 11 lignes, exactement comme la fiche papier.
  for (let i = 0; i < 11; i += 1) {
    const r = 11 + i;
    const ligne = (fiche.lignes || [])[i] || {};
    const jours = ligne.jours || [];

    const nom = ws.getCell(`A${r}`);
    nom.value = ligne.nom_affiche || '';
    nom.font = { name: POLICE, size: 10 };
    nom.alignment = { horizontal: 'left', vertical: 'middle' };

    for (let j = 0; j < 7; j += 1) {
      const col = String.fromCharCode(66 + j);
      const jour = jours.find((x) => x.jour === j) || { minutes: 0, code_absence: '' };
      const cellule = ws.getCell(`${col}${r}`);
      cellule.value = jour.code_absence || (jour.minutes ? D.versTexte(jour.minutes) : '');
      cellule.font = { name: POLICE, size: 10, bold: Boolean(jour.code_absence) };
      cellule.alignment = { horizontal: 'center', vertical: 'middle' };
      if (jour.code_absence) remplir(cellule, JAUNE);
      else if (j >= 5) remplir(cellule, GRIS_CLAIR);
    }

    const valeurs = {
      I: ligne.nom_affiche ? D.versTexte(ligne.total_minutes || 0) : '',
      J: ligne.minutes_route ? D.versTexte(ligne.minutes_route) : '',
      K: ligne.minutes_trajet ? D.versTexte(ligne.minutes_trajet) : '',
      L: ligne.jours_zone || '',
      M: ligne.type_masque || '',
      N: ligne.nb_deplacement || '',
      O: ligne.observation || '',
      S: ligne.signature ? 'Signée (voir PDF)' : '',
    };
    for (const [col, valeur] of Object.entries(valeurs)) {
      const cellule = ws.getCell(`${col}${r}`);
      cellule.value = valeur;
      cellule.font = { name: POLICE, size: 10, bold: col === 'I' };
      cellule.alignment = {
        horizontal: col === 'O' ? 'left' : 'center',
        vertical: 'middle',
        wrapText: col === 'O',
      };
    }

    for (const cellule of cellulesDePlage(ws, `A${r}:U${r}`)) cellule.border = BORDURE;
  }

  ws.getCell('A22').value =
    'Nota  : la coupure repas est obligatoire     -      En cas d\'absence totale ou partielle = un libellé "code absence" ci-dessous est obligatoire ';
  ws.getCell('A22').font = { name: POLICE, size: 9, bold: true };
  ws.getCell('A22').alignment = { horizontal: 'left', vertical: 'middle' };

  D.CODES_ABSENCE.forEach((entree, i) => {
    const r = 23 + i;
    ws.getCell(`A${r}`).value = entree.libelle;
    ws.getCell(`A${r}`).font = { name: POLICE, size: 9 };
    ws.getCell(`A${r}`).alignment = { horizontal: 'left', vertical: 'middle' };
    ws.getCell(`C${r}`).value = entree.code;
    ws.getCell(`C${r}`).font = { name: POLICE, size: 9, bold: true };
    ws.getCell(`C${r}`).alignment = { horizontal: 'center', vertical: 'middle' };
    for (const cellule of cellulesDePlage(ws, `A${r}:D${r}`)) cellule.border = BORDURE;
  });

  const blocs = [
    ['E23', 'Commentaires du Responsable de Chantier :', fiche.commentaire_responsable, 'E23:U28'],
    ['E29', 'Nom et signature du Responsable de Chantier :', fiche.nom_responsable, 'E29:O31'],
    ['P29', 'Visa Conducteur trav,et/ou Responsable Affaire :', fiche.visa_conducteur, 'P29:U31'],
  ];
  for (const [ref, libelle, valeur, plage] of blocs) {
    const cellule = ws.getCell(ref);
    cellule.value = valeur ? `${libelle}\n${valeur}` : libelle;
    cellule.font = { name: POLICE, size: 9, bold: true };
    cellule.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
    for (const c of cellulesDePlage(ws, plage)) c.border = BORDURE;
  }

  ws.getCell('A32').value = fiche.statut === 'validee'
    ? `Validée le ${(fiche.validee_le || '').slice(0, 10)}`
    : `Statut : ${fiche.statut}`;
  ws.getCell('A32').font = { name: POLICE, size: 9, italic: true };
  ws.getCell('E32').value = `Date : ${(fiche.date_responsable || fiche.soumise_le || '').slice(0, 10)}`;
  ws.getCell('P32').value = `Date : ${(fiche.validee_le || '').slice(0, 10)}`;
  for (const ref of ['E32', 'P32']) {
    ws.getCell(ref).font = { name: POLICE, size: 9, bold: true };
    ws.getCell(ref).alignment = { horizontal: 'left', vertical: 'middle' };
  }
  for (const plage of ['A32:D32', 'E32:O32', 'P32:U32']) {
    for (const cellule of cellulesDePlage(ws, plage)) cellule.border = BORDURE;
  }
}

async function exporterFiche(fiche) {
  const wb = nouveauClasseur();
  const ws = wb.addWorksheet('feuille pointage DTF', { views: [{ showGridLines: false }] });
  ecrireFicheSurFeuille(ws, fiche);
  return wb.xlsx.writeBuffer();
}

/* ------------------------------------------------------- */
/* 2 & 3. Exports pour le tableau interne du directeur      */
/* ------------------------------------------------------- */

function styleLigneEntete(ws) {
  const entete = ws.getRow(1);
  entete.font = { name: POLICE, size: 10, bold: true };
  entete.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  entete.height = 34;
  entete.eachCell((cellule) => {
    remplir(cellule, GRIS);
    cellule.border = BORDURE;
  });
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

/** Un enregistrement par salarie et par semaine : format d'import paie. */
function feuilleHebdomadaire(wb, lignes) {
  const ws = wb.addWorksheet('Recap hebdo');
  ws.columns = [
    { header: 'Année', key: 'annee', width: 8 },
    { header: 'Semaine', key: 'semaine', width: 9 },
    { header: 'Du', key: 'du', width: 11 },
    { header: 'Au', key: 'au', width: 11 },
    { header: 'Matricule', key: 'matricule', width: 12 },
    { header: 'Nom - Prénom', key: 'nom', width: 28 },
    { header: "Chef d'équipe", key: 'chef', width: 20 },
    { header: 'Chantier', key: 'chantier', width: 24 },
    { header: 'Ville', key: 'ville', width: 16 },
    { header: 'Total heures semaine', key: 'total_h', width: 12 },
    { header: 'Heures route 100%', key: 'route_h', width: 12 },
    { header: 'Heures trajet 50%', key: 'trajet_h', width: 12 },
    { header: 'Jours en zone', key: 'zone', width: 10 },
    { header: 'Type masque', key: 'masque', width: 11 },
    { header: 'Nb déplacements', key: 'deplacement', width: 12 },
    { header: 'Codes absence', key: 'absences', width: 18 },
    { header: 'Statut fiche', key: 'statut', width: 12 },
    { header: 'N° fiche', key: 'fiche', width: 9 },
  ];

  for (const ligne of lignes) {
    const absences = ligne.jours
      .filter((j) => j.code_absence)
      .map((j) => `${D.JOURS_COURTS[j.jour]}:${j.code_absence}`)
      .join(' ');
    ws.addRow({
      annee: ligne.annee,
      semaine: ligne.semaine,
      du: ligne.dates[0],
      au: ligne.dates[6],
      matricule: ligne.matricule || '',
      nom: ligne.nom_affiche,
      chef: ligne.chef_nom,
      chantier: ligne.chantier,
      ville: ligne.ville,
      total_h: D.versDecimal(ligne.total_minutes),
      route_h: D.versDecimal(ligne.minutes_route),
      trajet_h: D.versDecimal(ligne.minutes_trajet),
      zone: ligne.jours_zone,
      masque: ligne.type_masque,
      deplacement: ligne.nb_deplacement,
      absences,
      statut: ligne.statut,
      fiche: ligne.fiche_id,
    });
  }

  ws.eachRow((row, i) => {
    if (i === 1) return;
    row.font = { name: POLICE, size: 10 };
    row.eachCell((cellule) => { cellule.border = BORDURE; });
    for (const key of ['total_h', 'route_h', 'trajet_h', 'zone']) {
      ws.getCell(i, ws.getColumn(key).number).numFmt = '0.00';
    }
  });
  styleLigneEntete(ws);
  ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columnCount } };
  return ws;
}

/** Un enregistrement par salarie et par jour : permet tous les recalculs et controles. */
function feuilleJournaliere(wb, lignes) {
  const ws = wb.addWorksheet('Détail journalier');
  ws.columns = [
    { header: 'Date', key: 'date', width: 12 },
    { header: 'Jour', key: 'jour', width: 10 },
    { header: 'Année', key: 'annee', width: 8 },
    { header: 'Semaine', key: 'semaine', width: 9 },
    { header: 'Matricule', key: 'matricule', width: 12 },
    { header: 'Nom - Prénom', key: 'nom', width: 28 },
    { header: "Chef d'équipe", key: 'chef', width: 20 },
    { header: 'Chantier', key: 'chantier', width: 24 },
    { header: 'Ville', key: 'ville', width: 16 },
    { header: 'Heures', key: 'heures', width: 9 },
    { header: 'Code absence', key: 'code', width: 12 },
    { header: 'Libellé absence', key: 'libelle', width: 28 },
    { header: 'Statut fiche', key: 'statut', width: 12 },
    { header: 'N° fiche', key: 'fiche', width: 9 },
  ];

  const libelle = Object.fromEntries(D.CODES_ABSENCE.map((c) => [c.code, c.libelle]));
  for (const ligne of lignes) {
    for (const jour of ligne.jours) {
      if (!jour.minutes && !jour.code_absence) continue;
      ws.addRow({
        date: ligne.dates[jour.jour],
        jour: D.JOURS[jour.jour],
        annee: ligne.annee,
        semaine: ligne.semaine,
        matricule: ligne.matricule || '',
        nom: ligne.nom_affiche,
        chef: ligne.chef_nom,
        chantier: ligne.chantier,
        ville: ligne.ville,
        heures: D.versDecimal(jour.minutes),
        code: jour.code_absence,
        libelle: libelle[jour.code_absence] || '',
        statut: ligne.statut,
        fiche: ligne.fiche_id,
      });
    }
  }

  ws.eachRow((row, i) => {
    if (i === 1) return;
    row.font = { name: POLICE, size: 10 };
    row.eachCell((cellule) => { cellule.border = BORDURE; });
    ws.getCell(i, ws.getColumn('heures').number).numFmt = '0.00';
  });
  styleLigneEntete(ws);
  ws.autoFilter = { from: 'A1', to: { row: 1, column: ws.columnCount } };
  return ws;
}

/**
 * Classeur remis au directeur : recap hebdo + detail journalier + une copie
 * conforme de chaque fiche, dans un seul fichier.
 */
async function exporterPeriode(lignes, fiches) {
  const wb = nouveauClasseur();
  feuilleHebdomadaire(wb, lignes);
  feuilleJournaliere(wb, lignes);
  for (const fiche of fiches) {
    const nom = `S${String(fiche.semaine).padStart(2, '0')} ${fiche.chef_nom} ${fiche.chantier || ''}`
      .replace(/[\\/*?:[\]]/g, ' ')
      .trim()
      .slice(0, 31);
    const ws = wb.addWorksheet(nom || `Fiche ${fiche.id}`, { views: [{ showGridLines: false }] });
    ecrireFicheSurFeuille(ws, fiche);
  }
  return wb.xlsx.writeBuffer();
}

/** Export CSV brut, pour les logiciels de paie qui n'avalent pas le xlsx. */
function exporterCsv(lignes) {
  const entetes = [
    'annee', 'semaine', 'du', 'au', 'matricule', 'nom', 'chef', 'chantier', 'ville',
    'total_heures', 'heures_route_100', 'heures_trajet_50', 'jours_zone',
    'type_masque', 'nb_deplacement', 'codes_absence', 'statut',
  ];
  const echapper = (v) => {
    const s = String(v ?? '');
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rangs = lignes.map((ligne) =>
    [
      ligne.annee, ligne.semaine, ligne.dates[0], ligne.dates[6], ligne.matricule || '',
      ligne.nom_affiche, ligne.chef_nom, ligne.chantier, ligne.ville,
      D.versDecimal(ligne.total_minutes), D.versDecimal(ligne.minutes_route),
      D.versDecimal(ligne.minutes_trajet), ligne.jours_zone, ligne.type_masque,
      ligne.nb_deplacement,
      ligne.jours.filter((j) => j.code_absence).map((j) => `${D.JOURS_COURTS[j.jour]}:${j.code_absence}`).join(' '),
      ligne.statut,
    ].map(echapper).join(';')
  );
  return `﻿${[entetes.join(';'), ...rangs].join('\r\n')}\r\n`;
}

module.exports = { exporterFiche, exporterPeriode, exporterCsv };
