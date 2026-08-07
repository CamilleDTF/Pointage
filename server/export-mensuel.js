'use strict';

/*
 * Genere le classeur mensuel du directeur, au format de son tableau existant :
 * une feuille "Total" qui recapitule tout le monde, puis une feuille par
 * salarie contenant ses six semaines, ses totaux et son bloc de calcul de paie.
 *
 * Les formules du classeur d'origine sont reprises telles quelles — la feuille
 * Total va chercher ses valeurs dans les feuilles individuelles par INDIRECT, et
 * les feuilles individuelles remontent le taux horaire depuis Total. Ce qui est
 * calculable depuis les fiches de pointage est rempli ; ce qui releve d'une
 * decision du directeur (nuit, ferie, 100 %, perfo, Eden Red, taux horaire)
 * reste vide, en jaune, pret a etre saisi.
 */

const ExcelJS = require('exceljs');
const D = require('./domaine');

const POLICE = 'Calibri';
const JAUNE = 'FFFFF2CC';   // case a completer par le directeur, une fois remplie
const ORANGE = 'FFF8CBAD';  // la meme, tant qu'elle est vide : elle reclame une saisie
const ROUGE = 'FF9C0006';
const GRIS = 'FFD9D9D9';
const BLEU_PALE = 'FFDCE6F1';
const VERT_PALE = 'FFE2EFDA'; // valeur calculee depuis les fiches, rien a faire

const BORDURE = {
  top: { style: 'thin', color: { argb: 'FF999999' } },
  left: { style: 'thin', color: { argb: 'FF999999' } },
  bottom: { style: 'thin', color: { argb: 'FF999999' } },
  right: { style: 'thin', color: { argb: 'FF999999' } },
};

// Disposition de la feuille individuelle, reprise du classeur d'origine.
const BLOCS_SEMAINE = [
  { dates: 4, valeurs: 5 },
  { dates: 7, valeurs: 8 },
  { dates: 10, valeurs: 11 },
  { dates: 13, valeurs: 14 },
  { dates: 16, valeurs: 17 },
  { dates: 19, valeurs: 20 },
];
const LIGNE_TOTAUX = 22;

const COLONNES = {
  headers: [
    ['J', 'TOTAL SEMAINE'], ['K', 'NUIT'], ['L', 'DIMANCHE'], ['M', 'FERIES'],
    ['Q', 'TRAJET 50%'], ['R', 'TRAJET 100%'], ['S', 'AMIANTE 1'], ['T', 'AMIANTE 2'],
    ['U', 'PERFO'], ['V', 'PANIER'], ['W', 'EDEN RED'], ['X', 'GD 72'], ['Y', 'GD 80'],
    ['Z', 'GD AUTRES'], ['AA', 'Contrôle'], ['AB', 'Observations'],
  ],
  // Colonnes cumulees en ligne 22 puis remontees dans la feuille Total.
  cumulees: ['J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'],
  // Colonnes laissees a la main du directeur, signalees tant qu'elles sont vides.
  directeur: ['K', 'L', 'P', 'U', 'W', 'Z'],
};

const LARGEURS_SALARIE = {
  A: 2.4, B: 3, C: 6.6, D: 7, E: 6.6, F: 6.7, G: 6.6, H: 6.6, I: 6.9, J: 9.7,
  K: 5.7, L: 9.1, M: 8.6, N: 7.1, O: 7, P: 5.7, Q: 7.6, R: 8, S: 9, T: 9.7,
  U: 8, V: 9.3, W: 8.9, X: 7.1, Y: 6.7, Z: 7.6, AA: 7.7, AB: 13.1, AC: 1.3,
  AD: 14.4, AE: 1.4, AF: 15.4, AG: 1.4, AH: 11.4, AI: 1.6, AJ: 11.4, AK: 1.4,
  AL: 11.4, AM: 2.1, AN: 11.4,
};

const LARGEURS_TOTAL = {
  A: 7.4, B: 41.7, C: 11.6, D: 11, E: 11.1, F: 11.3, G: 10.6, H: 16.9, I: 13.4,
  J: 10.6, K: 6.9, L: 12, M: 7.6, N: 9.3, O: 11.7, P: 9, Q: 9.1, R: 11.6,
  S: 10.1, T: 11, U: 7.6, V: 8.9, W: 9.7, X: 11, Y: 9.9, Z: 9.9, AA: 15.6,
};

function remplir(cellule, couleur) {
  cellule.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: couleur } };
}

/**
 * Signale en orange toute case attendue du directeur qui n'a pas encore ete
 * saisie. Le signalement disparait de lui-meme des qu'une valeur est tapee :
 * c'est une mise en forme conditionnelle, pas une couleur figee.
 */
function signalerSiVide(ws, plages) {
  for (const plage of plages) {
    const premiere = plage.split(':')[0];
    ws.addConditionalFormatting({
      ref: plage,
      rules: [
        {
          type: 'expression',
          formulae: [`ISBLANK(${premiere})`],
          priority: 1,
          style: {
            fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: ORANGE } },
            font: { color: { argb: ROUGE }, bold: true },
          },
        },
      ],
    });
  }
}

/** Rappel du code couleur, pour qu'il se lise sans explication exterieure. */
function ecrireLegende(ws, ligne) {
  const entrees = [
    ['C', 'à compléter', ORANGE],
    ['H', 'complété', JAUNE],
    ['M', 'calculé depuis les fiches de pointage', null],
    ['R', 'calculé depuis le calendrier', VERT_PALE],
  ];
  for (const [col, texte, couleur] of entrees) {
    const cellule = ws.getCell(`${col}${ligne}`);
    cellule.value = texte;
    cellule.font = { name: POLICE, size: 9, italic: true };
    cellule.alignment = { horizontal: 'left', vertical: 'middle' };
    if (couleur) remplir(cellule, couleur);
    cellule.border = BORDURE;
  }
  ws.getRow(ligne).height = 14;
}

/* ---------------------------- Feuille d'un salarie ------------------------- */

function ecrireFeuilleSalarie(ws, salarie, ligneDansTotal, ligneTotalGenerale, financier = true) {
  for (const [col, largeur] of Object.entries(LARGEURS_SALARIE)) ws.getColumn(col).width = largeur;

  ws.mergeCells('A1:AA1');
  ws.getCell('A1').value = salarie.feuille;
  ws.getCell('A1').font = { name: POLICE, size: 11, bold: true };

  ecrireLegende(ws, 2);

  // En-tetes
  D.JOURS_COURTS.forEach((jour, i) => {
    const cellule = ws.getCell(3, 3 + i);
    cellule.value = jour;
    cellule.font = { name: POLICE, size: 11, bold: true };
    cellule.alignment = { horizontal: 'center' };
  });
  ws.getCell('N3').value = 0.25;
  ws.getCell('O3').value = 0.5;
  ws.getCell('P3').value = 1;
  for (const ref of ['N3', 'O3', 'P3']) {
    ws.getCell(ref).numFmt = '0.00%';
    ws.getCell(ref).font = { name: POLICE, size: 11, bold: true };
    ws.getCell(ref).alignment = { horizontal: 'center' };
  }
  for (const [col, libelle] of COLONNES.headers) {
    const cellule = ws.getCell(`${col}3`);
    cellule.value = libelle;
    cellule.font = { name: POLICE, size: 11, bold: true };
    cellule.alignment = { horizontal: 'center', wrapText: true };
  }
  for (let c = 3; c <= 28; c += 1) {
    remplir(ws.getCell(3, c), GRIS);
    ws.getCell(3, c).border = BORDURE;
  }

  // Six blocs de semaine
  salarie.semaines.forEach((semaine, index) => {
    const { dates: rd, valeurs: rv } = BLOCS_SEMAINE[index];

    ws.mergeCells(`A${rd}:A${rd + 2}`);
    ws.mergeCells(`B${rd}:B${rd + 2}`);
    ws.mergeCells(`AB${rd}:AB${rd + 2}`);
    ws.getCell(`A${rd}`).value = 'S';
    ws.getCell(`B${rd}`).value = semaine.semaine;
    for (const ref of [`A${rd}`, `B${rd}`]) {
      ws.getCell(ref).font = { name: POLICE, size: 11, bold: true };
      ws.getCell(ref).alignment = { horizontal: 'center', vertical: 'middle' };
    }

    semaine.dates.forEach((iso, j) => {
      const cellule = ws.getCell(rd, 3 + j);
      cellule.value = new Date(`${iso}T00:00:00Z`);
      cellule.numFmt = 'd/m;@';
      cellule.font = { name: POLICE, size: 11 };
      cellule.alignment = { horizontal: 'center' };
      cellule.border = BORDURE;
    });

    // Heures du jour, ou code absence si la journee n'a pas ete travaillee.
    semaine.jours.forEach((jour, j) => {
      const cellule = ws.getCell(rv, 3 + j);
      if (jour.minutes > 0) {
        cellule.value = D.versDecimal(jour.minutes);
        cellule.numFmt = '#,##0.00';
      } else if (jour.codes.length) {
        cellule.value = [...new Set(jour.codes)].join('/');
        cellule.font = { name: POLICE, size: 11, bold: true };
      }
      cellule.alignment = { horizontal: 'center' };
      cellule.border = BORDURE;
    });

    const valeurs = {
      J: { formule: `SUM(C${rv}:I${rv})` },
      N: { valeur: D.versDecimal(semaine.minutes25) },
      O: { valeur: D.versDecimal(semaine.minutes50) },
      Q: { valeur: D.versDecimal(semaine.minutesTrajet) },
      R: { valeur: D.versDecimal(semaine.minutesRoute) },
      M: { valeur: D.versDecimal(semaine.minutesFeries) },
      S: { valeur: semaine.joursAmiante1 },
      T: { valeur: semaine.joursAmiante2 },
      V: { valeur: semaine.joursPanier },
      X: { valeur: semaine.joursGD72 },
      Y: { valeur: semaine.joursGD80 },
      // Reste a redistribuer : total de la semaine moins les majorations et les 35 h.
      AA: { formule: `J${rv}-N${rv}-O${rv}-P${rv}-35` },
    };

    for (const [col, contenu] of Object.entries(valeurs)) {
      const cellule = ws.getCell(`${col}${rv}`);
      if (contenu.formule) cellule.value = { formula: contenu.formule };
      else if (contenu.valeur) cellule.value = contenu.valeur;
      cellule.numFmt = '#,##0.00';
      cellule.alignment = { horizontal: 'center' };
    }
    for (const col of COLONNES.directeur) remplir(ws.getCell(`${col}${rv}`), JAUNE);
    for (let c = 10; c <= 27; c += 1) ws.getCell(rv, c).border = BORDURE;

    if (semaine.chantiers.length) ws.getCell(`AB${rd}`).value = semaine.chantiers.join(' / ');
    ws.getCell(`AB${rd}`).font = { name: POLICE, size: 9 };
    ws.getCell(`AB${rd}`).alignment = { vertical: 'middle', wrapText: true };
  });

  // L'alerte ne porte que sur les semaines effectivement pointees : un
  // emplacement de semaine reste vide ne reclame aucune saisie.
  const semainesPointees = salarie.semaines
    .map((semaine, i) => (semaine.minutesTotal > 0 ? BLOCS_SEMAINE[i].valeurs : null))
    .filter(Boolean);
  if (semainesPointees.length) {
    signalerSiVide(
      ws,
      COLONNES.directeur.flatMap((col) => semainesPointees.map((r) => `${col}${r}`))
    );
  }
  if (financier) signalerSiVide(ws, ['J27']);

  // Ligne des totaux du mois
  const lignesValeurs = BLOCS_SEMAINE.map((b) => b.valeurs);
  ws.getCell(`A${LIGNE_TOTAUX}`).value = 'T';
  ws.getCell(`A${LIGNE_TOTAUX}`).font = { name: POLICE, size: 11, bold: true };
  for (const col of COLONNES.cumulees) {
    const cellule = ws.getCell(`${col}${LIGNE_TOTAUX}`);
    cellule.value = { formula: lignesValeurs.map((r) => `${col}${r}`).join('+') };
    cellule.numFmt = '#,##0.00';
    cellule.font = { name: POLICE, size: 11, bold: true };
    cellule.alignment = { horizontal: 'center' };
    remplir(cellule, BLEU_PALE);
    cellule.border = BORDURE;
  }
  const controle = ws.getCell(`AA${LIGNE_TOTAUX}`);
  controle.value = { formula: `SUM(AA4:AA20)` };
  controle.numFmt = '#,##0.00';
  controle.font = { name: POLICE, size: 11, bold: true };
  controle.alignment = { horizontal: 'center' };
  remplir(controle, BLEU_PALE);
  controle.border = BORDURE;

  // Version publique : la grille des heures et des primes s'arrete ici. Le bloc
  // de paie, seul endroit ou apparaissent des montants, n'est pas ecrit.
  if (financier) ecrireBlocPaie(ws, ligneDansTotal, ligneTotalGenerale);
}

/** Bloc de calcul de la paie, sous la grille : formules du classeur d'origine. */
function ecrireBlocPaie(ws, ligneDansTotal, ligneTotalGenerale) {
  const taux = `Total!$AA$${ligneDansTotal}`;

  const libelles = [
    ['B24', 'HEURES DU MOIS'], ['B25', 'BASE'], ['B26', 'HEURES SUP'], ['B27', 'HEURES Abscences'],
  ];
  for (const [ref, texte] of libelles) {
    ws.mergeCells(`${ref}:I${ref.slice(1)}`);
    ws.getCell(ref).value = texte;
    ws.getCell(ref).font = { name: POLICE, size: 11, bold: true };
  }
  ws.getCell('J24').value = { formula: `Total!$J$${ligneTotalGenerale}` };
  ws.getCell('J25').value = 151.67;
  ws.getCell('J26').value = { formula: 'J22-J24' };
  remplir(ws.getCell('J27'), JAUNE); // heures d'absence, saisies par le directeur
  for (const ref of ['J24', 'J25', 'J26', 'J27']) ws.getCell(ref).numFmt = '#,##0.00';

  ['NON JUSTIFIE', 'MALADIE', 'AT', 'CP', 'SANS SOLDE', 'PATERNITE/MATERNITE',
    'INTEMPERIE', 'FERIE', 'PARTIEL'].forEach((libelle, i) => {
    ws.getCell(`D${29 + i}`).value = libelle;
    ws.getCell(`D${29 + i}`).font = { name: POLICE, size: 10 };
    remplir(ws.getCell(`F${29 + i}`), JAUNE);
  });

  ws.getCell('V24').value = 'EDENRED : 11€70 / jours';
  ws.getCell('V26').value = 'PART PATRONALE : 60%';
  for (const ref of ['V24', 'V26']) ws.getCell(ref).font = { name: POLICE, size: 10, italic: true };

  const paie = [
    ['AD24', 'S.Brut'], ['AF24', 'S.Net'], ['AH24', 'Primes A'],
    ['AJ24', 'Paniers'], ['AL24', 'GD'], ['AN24', 'Trajet'],
    ['AD27', 'H.Sup Brut'], ['AF27', 'H.Sup Net'],
    ['AD30', 'H. Absences Brut'], ['AF30', 'H.Absences Net'],
  ];
  for (const [ref, texte] of paie) {
    ws.getCell(ref).value = texte;
    ws.getCell(ref).font = { name: POLICE, size: 11, bold: true };
  }

  const formules = {
    AD25: `J25*${taux}`,
    AF25: 'AD25*0.77',
    AH25: '((S22*5)+(T22*10))*0.8',
    // Panier repas : un montant fixe par jour ouvrant droit. La colonne V porte
    // deja les jours calcules — travailles moins ceux de grand deplacement.
    AJ25: `V22*${D.MONTANT_PANIER_REPAS}`,
    AL25: '(X22*72)+(Y22*80)',
    AN25: `(${taux}*Q22/2)+(${taux}*R22)`,
    AD28: `(${taux}*1.25*N22)+(${taux}*1.5*O22)+(${taux}*2*P22)+(${taux}*M22*2)+(${taux}*L22*2)`,
    AF28: 'AD28*0.77',
    AD31: `((J25*${taux})/J24)*J27`,
    AF31: 'AD31*0.77',
    AD34: 'AD25+AH25+AJ25+AL25+AD28+AD31+AN25',
    AJ34: '(AD25*1.5)+(AD28*1.5)+(AD31*1.5)+AH25+AJ25+AL25+AN25',
    AD37: 'AF25+AH25+AJ25+AF28+AL25+AF31+AN25',
    AF44: 'AD37+AF40+AF42',
  };
  for (const [ref, formule] of Object.entries(formules)) {
    ws.getCell(ref).value = { formula: formule };
    ws.getCell(ref).numFmt = '#,##0.00 €';
  }
  // Le panier ne se saisit plus : son montant est celui de la maison, et ses
  // jours se comptent depuis le pointage. La case est calculee, pas attendue.
  remplir(ws.getCell('AJ25'), VERT_PALE);

  const titres = [
    ['AD33', 'Salaire Brut'], ['AJ33', 'Salaire Brut + ch Patronale'],
    ['AD36', 'Salaire Net'], ['AA40', 'Delta du mois dernier'],
    ['AA42', 'Primes '], ['AA44', 'Total à percevoir'],
  ];
  for (const [ref, texte] of titres) {
    ws.getCell(ref).value = texte;
    ws.getCell(ref).font = { name: POLICE, size: 11, bold: true };
  }
  for (const ref of ['AF40', 'AF42']) {
    remplir(ws.getCell(ref), JAUNE);
    ws.getCell(ref).numFmt = '#,##0.00 €';
  }
}

/* ------------------------------ Feuille Total ------------------------------ */

const ENTETES_TOTAL = [
  ['B', 'NOM_Prénom'], ['C', 'S1'], ['D', 'S2'], ['E', 'S3'], ['F', 'S4'], ['G', 'S5'], ['H', 'S6'],
  ['I', 'Total'], ['J', 'Mois'], ['K', 'Nuit'], ['L', 'Dimanche'], ['M', 'Fériés'],
  ['Q', 'Trajet'], ['R', 'Trajet 100%'], ['S', 'Amiante 1'], ['T', 'Amiante 2'], ['U', 'Perfo'],
  ['V', 'Panier'], ['W', 'Eden R'], ['X', 'GD 72'], ['Y', 'GD 80'], ['Z', 'Autres GD'],
  ['AA', 'Taux horaire'],
];

// Colonnes de la feuille Total remontees depuis la ligne 22 des feuilles salaries.
const REMONTEES = ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

function ecrireFeuilleTotal(ws, mois, financier = true) {
  for (const [col, largeur] of Object.entries(LARGEURS_TOTAL)) ws.getColumn(col).width = largeur;

  ecrireLegende(ws, 1);

  const entetes = financier ? ENTETES_TOTAL : ENTETES_TOTAL.filter(([col]) => col !== 'AA');
  for (const [col, libelle] of entetes) {
    const cellule = ws.getCell(`${col}3`);
    cellule.value = libelle;
    cellule.font = { name: POLICE, size: 11, bold: true };
    cellule.alignment = { horizontal: 'center', wrapText: true };
    remplir(cellule, GRIS);
    cellule.border = BORDURE;
  }
  for (const [col, valeur] of [['N', 0.25], ['O', 0.5], ['P', 1]]) {
    const cellule = ws.getCell(`${col}3`);
    cellule.value = valeur;
    cellule.numFmt = '0.00%';
    cellule.font = { name: POLICE, size: 11, bold: true };
    cellule.alignment = { horizontal: 'center' };
    remplir(cellule, GRIS);
    cellule.border = BORDURE;
  }

  const premiere = 4;
  mois.salaries.forEach((salarie, i) => {
    const r = premiere + i;
    ws.getCell(`A${r}`).value = i + 1;
    ws.getCell(`B${r}`).value = salarie.feuille;
    ws.getCell(`B${r}`).font = { name: POLICE, size: 11 };

    // Totaux hebdomadaires, puis total du mois, lus dans la feuille du salarie.
    BLOCS_SEMAINE.forEach((bloc, j) => {
      const cellule = ws.getCell(r, 3 + j);
      cellule.value = { formula: `INDIRECT(B${r}&"!J${bloc.valeurs}")` };
      cellule.numFmt = '#,##0.00';
    });
    ws.getCell(`I${r}`).value = { formula: `INDIRECT(B${r}&"!J${LIGNE_TOTAUX}")` };
    ws.getCell(`I${r}`).numFmt = '#,##0.00';
    ws.getCell(`I${r}`).font = { name: POLICE, size: 11, bold: true };

    for (const col of REMONTEES) {
      const cellule = ws.getCell(`${col}${r}`);
      cellule.value = { formula: `INDIRECT(B${r}&"!${col}${LIGNE_TOTAUX}")` };
      cellule.numFmt = '#,##0.00';
    }

    // Taux horaire : renseigne depuis l'ecran Parametres. Reste en jaune tant
    // qu'il ne l'est pas — c'est ce qui bloque tout le calcul de paie.
    if (financier) {
      if (salarie.tauxHoraire) ws.getCell(`AA${r}`).value = salarie.tauxHoraire;
      remplir(ws.getCell(`AA${r}`), JAUNE);
      ws.getCell(`AA${r}`).numFmt = '#,##0.00 €';
      ws.getCell(`AA${r}`).border = BORDURE;
    }

    for (let c = 1; c <= 26; c += 1) ws.getCell(r, c).border = BORDURE;
  });

  const derniere = premiere + Math.max(0, mois.salaries.length - 1);

  // "Mois" : horaire de reference du mois, identique pour tout le monde, d'ou la
  // fusion sur la colonne. Il vaut nombre de jours ouvres x 7 h et se calcule
  // desormais tout seul : c'est un fait du calendrier, pas une decision.
  if (mois.salaries.length) {
    ws.mergeCells(`J${premiere}:J${derniere}`);
    const cellule = ws.getCell(`J${premiere}`);
    cellule.value = D.heuresReferenceMois(mois.annee, mois.mois);
    cellule.alignment = { horizontal: 'center', vertical: 'middle' };
    remplir(cellule, VERT_PALE);
    cellule.numFmt = '#,##0.00';
    cellule.note = `${D.joursOuvresDuMois(mois.annee, mois.mois)} jours ouvrés x 7 h`;
  }

  if (mois.salaries.length && financier) {
    signalerSiVide(ws, [`AA${premiere}:AA${derniere}`]);
  }

  const rTotal = derniere + 1;
  ws.getCell(`A${rTotal}`).value = 'TOTAL';
  ws.getCell(`A${rTotal}`).font = { name: POLICE, size: 11, bold: true };
  for (const col of ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', ...REMONTEES]) {
    const cellule = ws.getCell(`${col}${rTotal}`);
    cellule.value = { formula: `SUM(${col}${premiere}:${col}${derniere})` };
    cellule.numFmt = '#,##0.00';
    cellule.font = { name: POLICE, size: 11, bold: true };
    remplir(cellule, BLEU_PALE);
    cellule.border = BORDURE;
  }

  // Recapitulatifs de masse salariale, sommes sur les feuilles individuelles.
  // Ils n'existent que dans la version direction.
  if (!financier) return rTotal;
  const feuilles = mois.salaries.map((s) => `'${s.feuille}'`);
  const somme = (cellule) =>
    feuilles.length ? { formula: feuilles.map((f) => `${f}!${cellule}`).join('+') } : 0;

  const rBrut = rTotal + 5;
  ws.getCell(`B${rBrut}`).value = 'TOTAL BRUT';
  ws.mergeCells(`H${rBrut}:J${rBrut}`);
  ws.getCell(`H${rBrut}`).value = 'TOTAL BRUT + CH. PATRONALES';
  ws.getCell(`B${rBrut + 1}`).value = somme('AD34');
  ws.mergeCells(`H${rBrut + 1}:J${rBrut + 1}`);
  ws.getCell(`H${rBrut + 1}`).value = somme('AJ34');

  const rNet = rBrut + 3;
  ws.getCell(`B${rNet}`).value = 'TOTAL NET';
  ws.getCell(`B${rNet + 1}`).value = somme('AD37');

  const rPrevoir = rNet + 6;
  ws.mergeCells(`D${rPrevoir}:G${rPrevoir}`);
  ws.getCell(`D${rPrevoir}`).value = 'TOTAL A PREVOIR + PRIMES';
  ws.mergeCells(`D${rPrevoir + 1}:G${rPrevoir + 1}`);
  ws.getCell(`D${rPrevoir + 1}`).value = somme('AF44');

  for (const ref of [`B${rBrut}`, `H${rBrut}`, `B${rNet}`, `D${rPrevoir}`]) {
    ws.getCell(ref).font = { name: POLICE, size: 11, bold: true };
  }
  for (const ref of [`B${rBrut + 1}`, `H${rBrut + 1}`, `B${rNet + 1}`, `D${rPrevoir + 1}`]) {
    ws.getCell(ref).numFmt = '#,##0.00 €';
    ws.getCell(ref).font = { name: POLICE, size: 11, bold: true };
    remplir(ws.getCell(ref), BLEU_PALE);
  }

  return rTotal;
}

/* --------------------------------- Assemblage ------------------------------ */

/**
 * `version` vaut 'direction' (le classeur complet, avec taux horaire et bloc de
 * paie) ou 'public' (les memes heures et primes, sans aucun montant). La version
 * publique se transmet a qui doit verifier des heures sans avoir a connaitre
 * les salaires.
 */
async function exporterMois(mois, { version = 'direction' } = {}) {
  const financier = version !== 'public';
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Pointage DTF';
  wb.created = new Date();

  const total = wb.addWorksheet('Total');
  const ligneTotalGenerale = ecrireFeuilleTotal(total, mois, financier);

  mois.salaries.forEach((salarie, i) => {
    const ws = wb.addWorksheet(salarie.feuille);
    ecrireFeuilleSalarie(ws, salarie, 4 + i, ligneTotalGenerale, financier);
  });

  if (!mois.salaries.length) {
    total.getCell('B5').value = 'Aucune fiche validée sur les six semaines de ce mois.';
    total.getCell('B5').font = { name: POLICE, size: 11, italic: true };
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { exporterMois };
