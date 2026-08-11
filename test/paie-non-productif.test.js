'use strict';

/*
 * La valorisation du personnel non productif.
 *
 * Elle emprunte ses taux au tableau des chantiers — 151,67 h, 77 % du brut,
 * 72 et 80 € de grand deplacement — mais pas ses primes de zone : ces salaries
 * n'entrent pas en zone amiante et n'ont pas de panier. Ce qui compte ici, c'est
 * que le mois ordinaire tombe juste sans qu'on ait rien saisi, et que chaque
 * ecart declare se retrouve dans le bon montant.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-paie-np-'));

const { db } = require('../server/db');
const NP = require('../server/non-productif');
// Les taux viennent du meme registre que le code : un test qui recopierait
// 151,67 finirait par ne plus verifier la meme chose que l'application.
const T = require('../server/taux');
const BAREME = T.DEFAUTS;

test.after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

const directeur = db
  .prepare("INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES ('D', 'dir', 'directeur', 'x')")
  .run().lastInsertRowid;

const inserer = db.prepare(
  'INSERT INTO salaries (matricule, nom, prenom, chef_id, productif, taux_horaire) VALUES (?, ?, ?, ?, ?, ?)'
);
const claire = inserer.run('B1', 'ROUX', 'Claire', null, 0, 20).lastInsertRowid;
const sansTaux = inserer.run('B2', 'MOREL', 'Yann', null, 0, 0).lastInsertRowid;

/*
 * Aout 2026 : 21 jours ouvres, le 1er tombe un samedi. Quatre semaines entieres
 * de 35 h, plus le lundi 31 tout seul — donc aucune heure supplementaire tant
 * qu'on ne declare rien.
 */
const AOUT = { annee: 2026, mois: 8 };
const paie = () => NP.paieDuMois(AOUT.annee, AOUT.mois);
const ligneDe = (id) => paie().salaries.find((s) => s.matricule === id);

const arrondi = (v) => Math.round(v * 100) / 100;

test('un mois sans rien declarer vaut le salaire mensualise, et rien d autre', () => {
  const c = ligneDe('B1');
  assert.equal(c.joursTravailles, 21);
  assert.equal(c.minutes, 21 * 7 * 60);

  // 151,67 h et non 147 h : le salaire est mensualise, il ne suit pas le nombre
  // de jours ouvres du mois.
  assert.equal(arrondi(c.salaireBrut), arrondi(BAREME.heures_mensuelles * 20));
  assert.equal(c.minutes25, 0, 'sept heures par jour font trente-cinq heures : rien a majorer');
  assert.equal(c.minutes50, 0);
  assert.equal(c.heuresSupBrut, 0);
  assert.equal(c.grandDeplacement, 0);
  assert.equal(c.primes, 0);
  assert.equal(arrondi(c.totalBrut), arrondi(c.salaireBrut));
  assert.equal(arrondi(c.totalNet), arrondi(c.salaireBrut * BAREME.part_net_estimee));
});

/*
 * Une absence ne retire rien au salaire : il est mensualise. Elle se compte en
 * jours, et c'est la paie qui decidera de la retenue — pas ce tableau.
 */
test('une absence se compte sans toucher au salaire de base', () => {
  NP.declarerJour({ salarieId: claire, date: '2026-08-04', code: 'VM' }, { id: directeur });

  const c = ligneDe('B1');
  assert.equal(c.joursAbsence, 1);
  assert.deepEqual(c.absences, { VM: 1 });
  assert.equal(c.joursTravailles, 20);
  assert.equal(arrondi(c.salaireBrut), arrondi(BAREME.heures_mensuelles * 20));
});

/*
 * Les heures supplementaires se calculent sur la SEMAINE, comme partout
 * ailleurs. Le 10 aout est un lundi de semaine entiere : 10 h ce jour-la portent
 * la semaine a 38 h, donc trois heures a 25 %.
 */
test('des heures declarees majorent la semaine, pas le mois', () => {
  NP.declarerJour({ salarieId: claire, date: '2026-08-10', minutes: 600 }, { id: directeur });

  const c = ligneDe('B1');
  assert.equal(c.minutes25, 180, 'trois heures au-dela de trente-cinq');
  assert.equal(c.minutes50, 0);
  assert.equal(arrondi(c.heuresSupBrut), arrondi(20 * 1.25 * 3));

  // La semaine du 4 aout, elle, a perdu une journee : elle ne majore rien.
  assert.equal(arrondi(c.totalBrut), arrondi(c.salaireBrut + c.heuresSupBrut));
});

/*
 * Le grand deplacement est une indemnite : il s'ajoute au brut comme au net,
 * sans subir les charges. C'est la seule ligne du tableau dans ce cas.
 */
test('le grand deplacement se verse net, la prime suit le salaire', () => {
  NP.declarerJour({ salarieId: claire, date: '2026-08-11', gd: '72' }, { id: directeur });
  NP.declarerJour({ salarieId: claire, date: '2026-08-12', gd: '80' }, { id: directeur });
  NP.ajouterPrime({ salarieId: claire, annee: 2026, mois: 8, libelle: 'Astreinte', montant: 300 }, { id: directeur });

  const c = ligneDe('B1');
  assert.equal(c.joursGD72, 1);
  assert.equal(c.joursGD80, 1);
  assert.equal(c.grandDeplacement, BAREME.gd_72 + BAREME.gd_80);
  assert.equal(c.primes, 300);

  const soumis = c.salaireBrut + c.heuresSupBrut + 300;
  assert.equal(arrondi(c.totalBrut), arrondi(soumis + 152));
  assert.equal(arrondi(c.totalNet), arrondi(soumis * BAREME.part_net_estimee + 152));

  // Un jour de grand deplacement reste travaille : il garde ses heures.
  assert.equal(c.joursTravailles, 20);
});

/*
 * Sans taux horaire, aucun montant n'est invente. Une case vide se corrige ;
 * un salaire faux se paie.
 */
test('sans taux horaire, rien n est calcule et le manque se voit', () => {
  NP.ajouterPrime({ salarieId: sansTaux, annee: 2026, mois: 8, montant: 100 }, { id: directeur });

  const y = ligneDe('B2');
  assert.equal(y.tauxManquant, true);
  assert.equal(y.salaireBrut, 0);
  assert.equal(y.totalBrut, 0);
  assert.equal(y.totalNet, 0);
  // Les heures, elles, restent comptees : c'est le montant qui manque, pas le temps.
  assert.equal(y.minutes, 21 * 7 * 60);
});

test('le detail des primes accompagne le montant, pour qu il soit verifiable', () => {
  const c = ligneDe('B1');
  assert.equal(c.detailPrimes.length, 1);
  assert.equal(c.detailPrimes[0].libelle, 'Astreinte');
  assert.equal(c.detailPrimes[0].montant, 300);
});

test('le tableau porte le mois, ses jours ouvres et son horaire de reference', () => {
  const p = paie();
  assert.equal(p.annee, 2026);
  assert.equal(p.mois, 8);
  assert.equal(p.joursOuvres, 21);
  assert.equal(p.heuresReference, 147);
  assert.deepEqual(p.salaries.map((s) => s.nom), ['MOREL', 'ROUX']);
});

/*
 * Le classeur se construit depuis exactement les memes donnees que l'ecran :
 * deux tableaux qui ne diraient pas la meme chose seraient pires qu'un seul.
 */
test('le classeur se genere et porte une feuille par mois', async () => {
  const XNP = require('../server/export-non-productif');
  const buffer = await XNP.exporterPaieNonProductif(paie());
  assert.ok(buffer.byteLength > 3000, 'un classeur non vide');

  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Personnel non productif');
  assert.ok(ws, 'la feuille existe');
  assert.match(String(ws.getCell('A1').value), /aout 2026/);
  assert.equal(ws.getCell('B5').value, 'MOREL');
  assert.equal(ws.getCell('B6').value, 'ROUX');
  assert.equal(ws.getCell('A7').value, 'TOTAL');
});
