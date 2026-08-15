'use strict';

/*
 * Le classeur mensuel, ouvert et relu.
 *
 * Les tests s'arretaient a « le fichier part » : on verifiait un code 200 et
 * un en-tete, jamais le contenu. C'est ainsi qu'un `bareme is not defined` a
 * pu vivre dans le bloc de paie — la fonction lisait une variable qu'on ne lui
 * passait pas — et n'apparaitre que chez l'utilisateur, sous la forme d'une
 * erreur 500 sans explication.
 *
 * Ces tests ouvrent le classeur produit et lisent ses cellules. Un export qui
 * ne contient pas ses formules n'est pas un export.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-classeur-'));

const ExcelJS = require('exceljs');
const M = require('../server/mensuel');
const EX = require('../server/export-mensuel');
const T = require('../server/taux');

/*
 * Un mois construit par la vraie fabrique.
 *
 * Une imitation ecrite a la main s'ecarte du modele au premier changement, et
 * un test qui passe sur une forme perimee ne protege rien. On pose donc de
 * vraies fiches validees, et on demande a `agregerMois` de les agreger.
 */
const { db } = require('../server/db');
const D = require('../server/domaine');

// Un taux a zero est la facon dont la base dit « pas de taux » : la colonne
// est NOT NULL, et `tauxManquant` se deduit de cette valeur.
function poserUnMoisReel({ taux = 14.5 } = {}) {
  const annee = 2026;
  const mois = 8;
  const { semaine } = D.semaineISO(new Date(Date.UTC(annee, mois - 1, 10)));

  const chef = db
    .prepare("INSERT INTO utilisateurs (nom, identifiant, pin_hash, role, actif) VALUES (?, ?, '', 'chef', 1)")
    .run('ESSAI Chef', `essai-chef-${Date.now()}`).lastInsertRowid;
  const salarie = db
    .prepare('INSERT INTO salaries (matricule, nom, prenom, chef_id, actif, productif, taux_horaire) VALUES (?, ?, ?, ?, 1, 1, ?)')
    .run('A1', 'ZENDJEBIL', 'Veronique', chef, taux).lastInsertRowid;

  const fiche = db
    .prepare(
      `INSERT INTO fiches (chef_id, annee, semaine, chantier, ville, statut, validee_le)
       VALUES (?, ?, ?, 'Chantier essai', 'Toulouse', 'validee', datetime('now'))`
    )
    .run(chef, annee, semaine).lastInsertRowid;
  const ligne = db
    .prepare(
      `INSERT INTO fiche_lignes (fiche_id, salarie_id, nom_affiche, ordre, minutes_route,
                                 minutes_trajet, jours_zone, type_masque, nb_deplacement, observation)
       VALUES (?, ?, 'ZENDJEBIL Veronique', 0, 150, 90, 4, 'VA', 5, '')`
    )
    .run(fiche, salarie).lastInsertRowid;
  for (let j = 0; j < 5; j += 1) {
    db.prepare("INSERT INTO fiche_jours (ligne_id, jour, minutes, code_absence, saisi) VALUES (?, ?, 420, '', 1)")
      .run(ligne, j);
  }

  return M.agregerMois(annee, mois, { statut: 'validee' });
}

async function classeurDe(mois, options) {
  const tampon = await EX.exporterMois(mois, options);
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.load(tampon);
  return classeur;
}

test('la version direction ecrit le bloc de paie, formules comprises', async () => {
  const classeur = await classeurDe(poserUnMoisReel(), { version: 'direction', taux: T.DEFAUTS });

  const feuille = classeur.worksheets.find((f) => /ZENDJEBIL/i.test(f.name));
  assert.ok(feuille, `feuille du salarie introuvable (${classeur.worksheets.map((f) => f.name).join(', ')})`);

  // Le salaire brut : la formule doit exister et pointer le taux du total.
  const brut = feuille.getCell('AD25');
  assert.ok(brut.formula, 'AD25 doit porter une formule de salaire brut');
  assert.match(brut.formula, /Total!\$AA\$\d+/, 'le taux vient de la feuille Total');

  // Les primes de zone, qui consomment le bareme : c'est la que ca cassait.
  const zone = feuille.getCell('AH25');
  assert.ok(zone.formula, 'AH25 doit porter la formule des primes de zone');
  assert.match(
    zone.formula,
    new RegExp(String(T.DEFAUTS.prime_zone_va).replace('.', '\\.')),
    'la prime de zone VA du bareme doit apparaitre dans la formule'
  );

  // Le panier repas, et les grands deplacements.
  assert.match(feuille.getCell('AJ25').formula, new RegExp(String(T.DEFAUTS.panier_repas).replace('.', '\\.')));
  assert.match(feuille.getCell('AL25').formula, new RegExp(String(T.DEFAUTS.gd_72).replace('.', '\\.')));
});

test('un bareme different se retrouve dans le classeur', async () => {
  // Un mois passe se rejoue avec SES taux : le classeur doit dire la meme
  // chose que l'ecran, et non les valeurs d'aujourd'hui.
  const bareme = { ...T.DEFAUTS, panier_repas: 99.5, prime_zone_va: 77.25 };
  const classeur = await classeurDe(poserUnMoisReel(), { version: 'direction', taux: bareme });
  const feuille = classeur.worksheets.find((f) => /ZENDJEBIL/i.test(f.name));

  assert.match(feuille.getCell('AJ25').formula, /99\.5/, 'le panier du bareme doit primer');
  assert.match(feuille.getCell('AH25').formula, /77\.25/, 'la prime de zone du bareme aussi');
});

test('la version publique n ecrit aucun montant', async () => {
  const mois = { ...poserUnMoisReel(), version: 'public' };
  const classeur = await classeurDe(mois, { version: 'public' });
  const feuille = classeur.worksheets.find((f) => /ZENDJEBIL/i.test(f.name));

  assert.ok(!feuille.getCell('AD25').formula, 'aucune formule de salaire brut en version publique');
  assert.ok(!feuille.getCell('AH25').formula, 'ni de prime de zone');
});

test('un salarie sans taux horaire n empeche pas le classeur de sortir', async () => {
  // Une case vide vaut mieux qu'un salaire faux : l'export doit aboutir.
  const classeur = await classeurDe(poserUnMoisReel({ taux: 0 }), {
    version: 'direction',
    taux: T.DEFAUTS,
  });
  assert.ok(classeur.worksheets.length > 0, 'le classeur doit exister malgre le taux manquant');
});

/* -------------------- La periode du personnel non productif ---------------- */

/*
 * Un accident du travail dure trois semaines : il se declare « du 5 au 23 »,
 * pas case par case. Les samedis et dimanches restent dehors — poser une
 * absence dessus ferait apparaitre des journees d'arret la ou personne n'etait
 * attendu.
 */
const NP = require('../server/non-productif');

test('une periode pose un ecart sur tous les jours ouvres, week-ends exclus', () => {
  const personne = db
    .prepare('INSERT INTO salaries (matricule, nom, prenom, chef_id, actif, productif, taux_horaire) VALUES (?, ?, ?, NULL, 1, 0, 15)')
    .run('NP1', 'OUABBOU', 'Youssef').lastInsertRowid;

  // Du lundi 3 au vendredi 14 aout 2026 : dix jours ouvres, quatre de week-end.
  const r = NP.declarerPeriode(
    { salarieId: personne, debut: '2026-08-03', fin: '2026-08-14', code: 'AT', gd: '', minutes: 0 },
    { id: 1, identifiant: 'directeur', role: 'directeur' }
  );

  assert.ok(!r.erreur, r.erreur);
  assert.equal(r.jours, 10, 'dix jours ouvres sur la quinzaine');

  const poses = db
    .prepare("SELECT date FROM jours_non_productifs WHERE salarie_id = ? AND code_absence = 'AT' ORDER BY date")
    .all(personne)
    .map((l) => l.date);
  assert.equal(poses.length, 10);
  assert.equal(poses[0], '2026-08-03');
  assert.equal(poses[poses.length - 1], '2026-08-14');

  const weekends = poses.filter((d) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
  assert.deepEqual(weekends, [], 'aucun samedi ni dimanche');
});

test('une periode a l envers ou trop longue est refusee', () => {
  const utilisateur = { id: 1, identifiant: 'directeur', role: 'directeur' };
  const personne = db
    .prepare('INSERT INTO salaries (matricule, nom, prenom, chef_id, actif, productif, taux_horaire) VALUES (?, ?, ?, NULL, 1, 0, 15)')
    .run('NP2', 'NIAKATE', 'Ibrahim').lastInsertRowid;

  const envers = NP.declarerPeriode(
    { salarieId: personne, debut: '2026-08-20', fin: '2026-08-03', code: 'CP' },
    utilisateur
  );
  assert.match(envers.erreur, /precede/i);

  const trop = NP.declarerPeriode(
    { salarieId: personne, debut: '2026-01-01', fin: '2028-01-01', code: 'CP' },
    utilisateur
  );
  assert.match(trop.erreur, /trop longue/i);
});

/* ---------------- Supprimer une fiche en cours de redaction ---------------- */

/*
 * Un chantier qui n'a pas eu lieu, une seconde fiche ouverte par erreur : le
 * chef doit pouvoir l'effacer. Mais une fiche qui a suivi son circuit porte
 * une histoire — le motif d'un renvoi, la trace de qui a valide — et cette
 * histoire ne se supprime pas.
 */
const F = require('../server/fiches');

function unChefAvecSaFiche() {
  const chef = db
    .prepare("INSERT INTO utilisateurs (nom, identifiant, pin_hash, role, actif) VALUES (?, ?, '', 'chef', 1)")
    .run('ESSAI Suppression', `chef-suppr-${Date.now()}-${Math.random()}`).lastInsertRowid;
  const fiche = db
    .prepare(
      "INSERT INTO fiches (chef_id, annee, semaine, chantier, ville, statut) VALUES (?, 2026, 40, 'Chantier essai', 'Toulouse', 'brouillon')"
    )
    .run(chef).lastInsertRowid;
  return { chef: { id: chef, role: 'chef', identifiant: 'essai' }, fiche };
}

test('un chef supprime son brouillon, et tout part avec lui', () => {
  const { chef, fiche } = unChefAvecSaFiche();
  const ligne = db
    .prepare("INSERT INTO fiche_lignes (fiche_id, salarie_id, nom_affiche, ordre) VALUES (?, NULL, 'ESSAI Jean', 0)")
    .run(fiche).lastInsertRowid;
  db.prepare("INSERT INTO fiche_jours (ligne_id, jour, minutes, code_absence, saisi) VALUES (?, 0, 420, '', 1)").run(ligne);

  const r = F.supprimerFiche(fiche, chef);
  assert.ok(!r.erreur, r.erreur);

  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fiches WHERE id = ?').get(fiche).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fiche_lignes WHERE fiche_id = ?').get(fiche).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fiche_jours WHERE ligne_id = ?').get(ligne).n, 0);
});

test('un chef ne supprime pas la fiche d un autre', () => {
  const { fiche } = unChefAvecSaFiche();
  const autre = { id: 999999, role: 'chef', identifiant: 'autre' };
  const r = F.supprimerFiche(fiche, autre);
  assert.equal(r.code, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fiches WHERE id = ?').get(fiche).n, 1);
});

test('une fiche deja transmise ne se supprime pas : son renvoi a une raison', () => {
  const { chef, fiche } = unChefAvecSaFiche();
  // Renvoyee par la direction : brouillon a nouveau, mais elle a une histoire.
  db.prepare("UPDATE fiches SET soumise_le = datetime('now') WHERE id = ?").run(fiche);

  const r = F.supprimerFiche(fiche, chef);
  assert.equal(r.code, 409);
  assert.match(r.erreur, /transmise/i);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fiches WHERE id = ?').get(fiche).n, 1);
});

test('une fiche validee ne se supprime pas', () => {
  const { chef, fiche } = unChefAvecSaFiche();
  db.prepare("UPDATE fiches SET statut = 'validee' WHERE id = ?").run(fiche);

  const r = F.supprimerFiche(fiche, chef);
  assert.equal(r.code, 409);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM fiches WHERE id = ?').get(fiche).n, 1);
});

test('le directeur ne passe pas par cette porte', () => {
  const { fiche } = unChefAvecSaFiche();
  const r = F.supprimerFiche(fiche, { id: 1, role: 'directeur', identifiant: 'directeur' });
  assert.equal(r.code, 403);
});

/* ------------------ La question de reprise suit le coffre ----------------- */

/*
 * Creer le coffre depuis l'ecran des parametres acceptait une question de
 * reprise sans l'enregistrer. Le coffre se creait, et « Retrouver son code »
 * repondait ensuite qu'aucune question n'existait — sans que rien, au moment
 * de la creation, n'ait laisse entendre qu'elle avait ete ignoree. Le seul
 * filet de securite du directeur tombait en silence.
 */
const REPRISE = require('../server/reprise');

test('poser une question de reprise la rend interrogeable', () => {
  const directeur = db
    .prepare("INSERT INTO utilisateurs (nom, identifiant, pin_hash, role, actif) VALUES (?, ?, '', 'directeur', 1)")
    .run('ESSAI Direction', `dir-reprise-${Date.now()}`).lastInsertRowid;
  db.prepare('UPDATE utilisateurs SET pin_hash = ? WHERE id = ?')
    .run(require('../server/auth').hacherPin('246810'), directeur);
  const compte = { id: directeur, role: 'directeur', identifiant: 'essai' };

  // `poser` exige le code actuel : c'est ce qui empeche une session laissee
  // ouverte de reecrire le filet de securite.
  const sansCode = REPRISE.poser(
    { question: 'Ma ville de naissance', reponse: 'Toulouse', actuel: null },
    compte
  );
  assert.ok(sansCode.erreur, 'sans le code actuel, la question doit etre refusee');

  const pose = REPRISE.poser(
    { question: 'Ma ville de naissance', reponse: 'Toulouse', actuel: '246810' },
    compte
  );
  assert.ok(!pose.erreur, pose.erreur);

  const enregistre = db
    .prepare('SELECT question_reprise, reponse_reprise_hash FROM utilisateurs WHERE id = ?')
    .get(directeur);
  assert.equal(enregistre.question_reprise, 'Ma ville de naissance');
  assert.ok(enregistre.reponse_reprise_hash, 'la reponse est conservee, mais hachee');
});

/*
 * La reprise elle-meme vit dans la route, et non dans le module : on
 * l'interroge donc comme le navigateur le fait. Le serveur est monte sur un
 * port ephemere, le temps de trois appels.
 */
test('la reprise rend le code, et la question suit la creation du coffre', async () => {
  const app = require('../server/index.js');
  const serveur = app.listen(0);
  await new Promise((r) => serveur.once('listening', r));
  const base = `http://127.0.0.1:${serveur.address().port}`;

  const poste = (chemin, corps, cookie) =>
    fetch(base + chemin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(corps),
    });

  try {
    // Un directeur tout neuf, avec sa question.
    const identifiant = `dir-http-${Date.now()}`;
    const compte = db
      .prepare("INSERT INTO utilisateurs (nom, identifiant, pin_hash, role, actif) VALUES (?, ?, '', 'directeur', 1)")
      .run('ESSAI HTTP', identifiant).lastInsertRowid;
    db.prepare('UPDATE utilisateurs SET pin_hash = ? WHERE id = ?')
      .run(require('../server/auth').hacherPin('246810'), compte);
    REPRISE.poser(
      { question: 'Ma ville de naissance', reponse: 'Nîmes', actuel: '246810' },
      { id: compte, role: 'directeur', identifiant }
    );

    const q = await (await poste('/api/reprise/question', { identifiant })).json();
    assert.equal(q.definie, true, 'la question doit se retrouver');
    assert.equal(q.question, 'Ma ville de naissance');

    // Les accents et les majuscules ne comptent pas : on tape vite, au telephone.
    const r = await poste('/api/reprise/code', { identifiant, reponse: 'NIMES', nouveau: '975310' });
    assert.equal(r.status, 200, `« NIMES » doit valoir « Nîmes » (${r.status})`);

    const bonne = await poste('/api/connexion', { identifiant, pin: '975310' });
    assert.equal(bonne.status, 200, 'le nouveau code doit ouvrir la session');

    // Une mauvaise reponse ne rend rien.
    const mauvaise = await poste('/api/reprise/code', { identifiant, reponse: 'Bordeaux', nouveau: '111111' });
    assert.notEqual(mauvaise.status, 200, 'une mauvaise reponse doit etre refusee');
    const refuse = await poste('/api/connexion', { identifiant, pin: '111111' });
    assert.notEqual(refuse.status, 200, 'et ne doit pas avoir change le code');
  } finally {
    serveur.close();
  }
});
