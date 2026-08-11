'use strict';

/*
 * Ce qui a ete valide reste lisible, tel quel.
 *
 * Une fiche validee part en paie : elle justifie des heures et porte les
 * signatures des operateurs. Le directeur pouvait la reecrire en place, et le
 * journal n'en gardait qu'un « Fiche corrigee par le directeur » qui ne disait
 * pas quoi. On ne pouvait donc plus repondre a la seule question qui compte
 * devant un desaccord : qu'est-ce qui a ete valide, exactement ?
 *
 * Desormais une validation depose une copie figee, et corriger passe par un
 * rectificatif — une version de plus, a cote de la precedente, jamais a sa
 * place.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-versions-'));

const { db } = require('../server/db');
const F = require('../server/fiches');

test.after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

const chef = db
  .prepare("INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES ('CHEF', 'chef', 'chef', 'x')")
  .run().lastInsertRowid;
const directeur = db
  .prepare("INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES ('DIRECTION', 'dir', 'directeur', 'x')")
  .run().lastInsertRowid;

const LE_CHEF = { id: chef, role: 'chef' };
const LE_DIRECTEUR = { id: directeur, role: 'directeur' };

const paul = db
  .prepare('INSERT INTO salaries (matricule, nom, prenom, chef_id) VALUES (?, ?, ?, ?)')
  .run('A1', 'MARTIN', 'Paul', chef).lastInsertRowid;

const SIGNATURE = 'data:image/png;base64,UGF1bA==';

let semaine = 30;

function ligne({ minutes = 420, signature, zone = 0, masque = '' } = {}) {
  return {
    salarie_id: paul,
    nom_affiche: 'MARTIN Paul',
    minutes_route: 0,
    minutes_trajet: 0,
    jours_zone: zone,
    type_masque: masque,
    nb_gd72: 0,
    nb_gd80: 0,
    observation: '',
    signature,
    jours: [0, 1, 2, 3, 4, 5, 6].map((j) => ({ jour: j, minutes: j <= 4 ? minutes : 0, code_absence: '', saisi: 1 })),
  };
}

/** Une fiche complete, saisie et transmise par le chef, prete a etre validee. */
function ficheTransmise({ minutes = 420 } = {}) {
  semaine += 1;
  const fiche = F.obtenirOuCreerFicheSemaine(chef, 2026, semaine);
  F.enregistrerFiche(
    fiche.id,
    {
      chantier: 'Lycee Jean Moulin',
      ville: 'Toulouse',
      zone_deplacement: 'AUTRE',
      lignes: [ligne({ minutes, signature: SIGNATURE })],
    },
    LE_CHEF
  );
  F.soumettre(fiche.id, LE_CHEF);
  return fiche.id;
}

const journalDe = (ficheId, action) =>
  db.prepare('SELECT detail FROM journal WHERE fiche_id = ? AND action = ? ORDER BY id DESC').all(ficheId, action);

/* ------------------------------------------------------------------------- */

test('valider depose une copie figee de la fiche', () => {
  const id = ficheTransmise();
  F.statuer(id, LE_DIRECTEUR, 'valider');

  const versions = F.versionsDeLaFiche(id);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].version, 1);
  assert.equal(versions[0].validee_par, 'DIRECTION');

  const archivee = F.versionArchivee(id, 1);
  assert.equal(archivee.chantier, 'Lycee Jean Moulin');
  assert.equal(archivee.lignes[0].nom_affiche, 'MARTIN Paul');
  assert.equal(archivee.lignes[0].jours[0].minutes, 420);
  assert.equal(archivee.lignes[0].signature, SIGNATURE, 'la signature fait partie de la piece');
});

/*
 * Le point de l'audit : plus personne ne reecrit une fiche validee. Le
 * directeur non plus — c'est pourtant lui qui l'a validee.
 */
test('une fiche validee n est plus modifiable, par personne', () => {
  const id = ficheTransmise();
  F.statuer(id, LE_DIRECTEUR, 'valider');

  for (const [qui, utilisateur] of [['le chef', LE_CHEF], ['le directeur', LE_DIRECTEUR]]) {
    const refus = F.enregistrerFiche(id, { chantier: 'Apres coup' }, utilisateur);
    assert.equal(refus.code, 409, `${qui} devrait etre refuse`);
    assert.match(refus.erreur, /rectificatif/, `${qui} doit lire par ou passer`);
  }

  assert.equal(db.prepare('SELECT chantier FROM fiches WHERE id = ?').get(id).chantier, 'Lycee Jean Moulin');
});

test('valider deux fois ne cree pas deux versions', () => {
  const id = ficheTransmise();
  F.statuer(id, LE_DIRECTEUR, 'valider');
  const refus = F.statuer(id, LE_DIRECTEUR, 'valider');

  assert.equal(refus.code, 409);
  assert.equal(F.versionsDeLaFiche(id).length, 1);
});

/*
 * Rouvrir une fiche validee n'est pas anodin : elle est partie en paie. Le
 * motif est la premiere chose qu'on cherchera dans six mois.
 */
test('rouvrir une fiche validee exige un motif, et ouvre une version', () => {
  const id = ficheTransmise();
  F.statuer(id, LE_DIRECTEUR, 'valider');

  const sansMotif = F.statuer(id, LE_DIRECTEUR, 'rouvrir');
  assert.equal(sansMotif.code, 400);
  assert.equal(db.prepare('SELECT statut FROM fiches WHERE id = ?').get(id).statut, 'validee');

  const ouvert = F.statuer(id, LE_DIRECTEUR, 'rouvrir', 'Jour ferie oublie sur le mardi');
  assert.equal(ouvert.fiche.statut, 'brouillon');
  assert.equal(ouvert.fiche.version, 2);

  const trace = journalDe(id, 'rectificatif_ouvert');
  assert.equal(trace.length, 1);
  assert.match(trace[0].detail, /Version 2 ouverte/);
  assert.match(trace[0].detail, /Jour ferie oublie/);
});

/*
 * Une fiche jamais validee se rouvre sans ceremonie : il n'y a rien a
 * rectifier, et exiger un motif ferait de chaque correction une affaire.
 */
test('rouvrir une fiche seulement transmise ne cree pas de rectificatif', () => {
  const id = ficheTransmise();
  const ouvert = F.statuer(id, LE_DIRECTEUR, 'rouvrir');

  assert.equal(ouvert.fiche.statut, 'brouillon');
  assert.equal(ouvert.fiche.version, 1, 'rien n avait ete valide : rien a rectifier');
  assert.equal(journalDe(id, 'rectificatif_ouvert').length, 0);
  assert.equal(journalDe(id, 'reouverture').length, 1);
});

/*
 * Le coeur du sujet : la version 1 doit rester exactement ce qu'elle etait,
 * meme apres que la 2 l'a corrigee.
 */
test('un rectificatif laisse la version precedente intacte', () => {
  const id = ficheTransmise({ minutes: 420 });
  F.statuer(id, LE_DIRECTEUR, 'valider');
  F.statuer(id, LE_DIRECTEUR, 'rouvrir', 'Heures du mardi sous-estimees');

  F.enregistrerFiche(id, { lignes: [ligne({ minutes: 480 })] }, LE_DIRECTEUR);
  F.soumettre(id, LE_CHEF);
  F.statuer(id, LE_DIRECTEUR, 'valider');

  const v1 = F.versionArchivee(id, 1);
  const v2 = F.versionArchivee(id, 2);
  assert.equal(v1.lignes[0].jours[0].minutes, 420, 'la version validee d origine ne bouge pas');
  assert.equal(v2.lignes[0].jours[0].minutes, 480);
  assert.equal(F.versionsDeLaFiche(id).length, 2);
});

/* Et ce qui separe les deux versions doit se lire en francais. */
test('le rectificatif valide porte le releve de ce qui a change', () => {
  const id = ficheTransmise({ minutes: 420 });
  F.statuer(id, LE_DIRECTEUR, 'valider');
  F.statuer(id, LE_DIRECTEUR, 'rouvrir', 'Zone oubliee');

  F.enregistrerFiche(
    id,
    { chantier: 'Lycee Jean Moulin - Bat. C', lignes: [ligne({ minutes: 480, zone: 3, masque: 'VA' })] },
    LE_DIRECTEUR
  );
  F.soumettre(id, LE_CHEF);
  F.statuer(id, LE_DIRECTEUR, 'valider');

  const releve = journalDe(id, 'rectificatif_valide')[0].detail;
  assert.match(releve, /Version 2/);
  assert.match(releve, /chantier : « Lycee Jean Moulin » → « Lycee Jean Moulin - Bat. C »/);
  assert.match(releve, /MARTIN Paul Lundi : 7h00 → 8h00/);
  assert.match(releve, /jours en zone : 0 → 3/);
});

/*
 * Le directeur avait droit a un « Fiche corrigee par le directeur » qui ne
 * disait rien. Une correction sans son contenu n'est pas une trace.
 */
test('une correction du directeur dit desormais ce qu elle change', () => {
  const id = ficheTransmise({ minutes: 420 });
  F.enregistrerFiche(id, { lignes: [ligne({ minutes: 450 })] }, LE_DIRECTEUR);

  const trace = journalDe(id, 'correction_directeur');
  assert.equal(trace.length, 1);
  assert.match(trace[0].detail, /MARTIN Paul Lundi : 7h00 → 7h30/);
});

/*
 * Le brouillon du chef s'enregistre au fil de la frappe : un releve par
 * demi-seconde n'apprendrait rien a personne et noierait ce qui compte.
 */
test('le brouillon du chef ne remplit pas le journal', () => {
  semaine += 1;
  const fiche = F.obtenirOuCreerFicheSemaine(chef, 2026, semaine);
  F.enregistrerFiche(fiche.id, { chantier: 'A', lignes: [ligne({ minutes: 420 })] }, LE_CHEF);
  F.enregistrerFiche(fiche.id, { chantier: 'B', lignes: [ligne({ minutes: 430 })] }, LE_CHEF);

  assert.equal(journalDe(fiche.id, 'correction_directeur').length, 0);
  assert.equal(journalDe(fiche.id, 'correction_rectificatif').length, 0);
});

/*
 * Sur un rectificatif, en revanche, chaque geste compte — meme celui du chef.
 * On corrige quelque chose qui est deja parti en paie.
 */
test('sur un rectificatif, meme le chef laisse une trace', () => {
  const id = ficheTransmise({ minutes: 420 });
  F.statuer(id, LE_DIRECTEUR, 'valider');
  F.statuer(id, LE_DIRECTEUR, 'rouvrir', 'Le chef doit recompter');

  F.enregistrerFiche(id, { lignes: [ligne({ minutes: 450 })] }, LE_CHEF);

  const trace = journalDe(id, 'correction_rectificatif');
  assert.equal(trace.length, 1);
  assert.match(trace[0].detail, /MARTIN Paul Lundi : 7h00 → 7h30/);
});

/*
 * Les signatures suivent la meme regle que partout : le rectificatif change les
 * heures, donc la signature de la version 1 ne vaut plus pour la version 2 —
 * mais elle reste intacte dans l'archive de la version 1.
 */
test('la signature archivee survit a un rectificatif qui la fait tomber', () => {
  const id = ficheTransmise({ minutes: 420 });
  F.statuer(id, LE_DIRECTEUR, 'valider');
  F.statuer(id, LE_DIRECTEUR, 'rouvrir', 'Correction des heures');
  F.enregistrerFiche(id, { lignes: [ligne({ minutes: 480 })] }, LE_DIRECTEUR);

  assert.equal(F.obtenirFiche(id).lignes[0].signature, null, 'ce n est plus ce qu il a signe');
  assert.equal(F.versionArchivee(id, 1).lignes[0].signature, SIGNATURE, 'la piece d origine, elle, ne bouge pas');
});
