'use strict';

/*
 * Les conducteurs de travaux entrent dans le registre des comptes.
 *
 * C'est l'operation la plus delicate faite sur cette base : deux tables
 * reconstruites, et des references reecrites d'une table a l'autre. Le test
 * fabrique donc une base a l'ANCIEN schema — celui d'avant les comptes — la
 * peuple, puis laisse la migration s'executer et verifie qu'aucune fiche n'a
 * perdu son conducteur en chemin.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const DOSSIER = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-migration-'));
process.env.DATA_DIR = DOSSIER;

test.after(() => fs.rmSync(DOSSIER, { recursive: true, force: true }));

/* L'ancien schema, reduit a ce que la migration touche. */
function baseAncienne() {
  const db = new Database(path.join(DOSSIER, 'pointage.db'));
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE utilisateurs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      nom           TEXT    NOT NULL,
      identifiant   TEXT    NOT NULL UNIQUE,
      role          TEXT    NOT NULL CHECK (role IN ('chef', 'directeur')),
      pin_hash      TEXT    NOT NULL,
      actif         INTEGER NOT NULL DEFAULT 1,
      cree_le       TEXT    NOT NULL DEFAULT (datetime('now'))
    , conducteur_id INTEGER REFERENCES conducteurs(id) ON DELETE SET NULL);

    CREATE TABLE conducteurs (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      nom      TEXT    NOT NULL,
      courriel TEXT    NOT NULL,
      actif    INTEGER NOT NULL DEFAULT 1
    , jeton TEXT, telephone TEXT NOT NULL DEFAULT '');

    CREATE TABLE fiches (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      chef_id  INTEGER NOT NULL REFERENCES utilisateurs(id),
      annee    INTEGER NOT NULL,
      semaine  INTEGER NOT NULL,
      chantier TEXT    NOT NULL DEFAULT '',
      statut   TEXT    NOT NULL DEFAULT 'brouillon'
                 CHECK (statut IN ('brouillon','soumise','validee','rejetee')),
      soumise_le TEXT,
      validee_par INTEGER REFERENCES utilisateurs(id)
    , conducteur_id INTEGER REFERENCES conducteurs(id) ON DELETE SET NULL,
      UNIQUE (chef_id, annee, semaine, chantier)
    );
    CREATE INDEX idx_fiches_periode ON fiches(annee, semaine);
  `);

  /*
   * Deux comptes seulement, mais quatre conducteurs : les comptes crees
   * porteront donc les numeros 3 a 6, qui recoupent les numeros 3 et 4 des
   * anciens conducteurs. C'est le piege de la reecriture — une fiche deplacee
   * de 1 vers 3 serait reprise par l'etape « 3 devient 5 » et finirait chez
   * quelqu'un d'autre. La collision doit exister pour que le test ait du mordant.
   */
  const conducteur = db.prepare(
    'INSERT INTO conducteurs (id, nom, courriel, telephone, jeton, actif) VALUES (?,?,?,?,?,?)'
  );
  conducteur.run(1, 'MOREAU Paul', 'paul@exemple.fr', '0612345678', 'jeton-paul', 1);
  conducteur.run(2, 'RENAUD Sophie', 'sophie@exemple.fr', '', 'jeton-sophie', 1);
  conducteur.run(3, 'GARNIER Luc', 'luc@exemple.fr', '', null, 0);
  conducteur.run(4, 'PETIT Anne', 'anne@exemple.fr', '0798765432', 'jeton-anne', 1);

  const utilisateur = db.prepare(
    'INSERT INTO utilisateurs (nom, identifiant, role, pin_hash, conducteur_id) VALUES (?,?,?,?,?)'
  );
  utilisateur.run('Direction travaux', 'directeur', 'directeur', 'x', null);
  utilisateur.run('BENALI Karim', 'kbenali', 'chef', 'x', 3);

  const fiche = db.prepare(
    'INSERT INTO fiches (chef_id, annee, semaine, chantier, statut, conducteur_id) VALUES (?,?,?,?,?,?)'
  );
  fiche.run(2, 2026, 30, 'Lycee Jean Moulin', 'validee', 1);
  fiche.run(2, 2026, 31, 'College Voltaire', 'soumise', 2);
  fiche.run(2, 2026, 32, 'Gymnase Sud', 'soumise', 3);
  fiche.run(2, 2026, 33, 'Halle Ouest', 'soumise', 4);
  fiche.run(2, 2026, 34, 'Ecole Nord', 'brouillon', null);
  db.close();
}

baseAncienne();
const { db } = require('../server/db'); // la migration s'execute a ce moment

const compte = (nom) => db.prepare('SELECT * FROM utilisateurs WHERE nom = ?').get(nom);

test('chaque conducteur devient un compte, avec ses coordonnees', () => {
  const paul = compte('MOREAU Paul');
  assert.equal(paul.role, 'conducteur');
  assert.equal(paul.courriel, 'paul@exemple.fr');
  assert.equal(paul.telephone, '0612345678');
  assert.equal(paul.actif, 1);
  // Le lien personnel ne survit pas : il precedait les comptes, et un secret
  // mort qui reste en base finit par repartir dans une reponse d'API.
  assert.equal('jeton' in paul, false, 'aucun secret d acces ne subsiste');

  // Un conducteur desactive le reste : la migration transporte, elle ne decide pas.
  assert.equal(compte('GARNIER Luc').actif, 0);
  assert.equal(compte('PETIT Anne').telephone, '0798765432');
});

test('les identifiants sont derives du nom, et uniques', () => {
  assert.equal(compte('MOREAU Paul').identifiant, 'pmoreau');
  assert.equal(compte('RENAUD Sophie').identifiant, 'srenaud');
  assert.equal(compte('GARNIER Luc').identifiant, 'lgarnier');
  assert.equal(compte('PETIT Anne').identifiant, 'apetit');
});

test('aucun conducteur ne recoit de code, et aucun code ne les ouvre', () => {
  const A = require('../server/auth');
  for (const nom of ['MOREAU Paul', 'RENAUD Sophie', 'GARNIER Luc', 'PETIT Anne']) {
    const u = compte(nom);
    assert.equal(u.pin_hash, '', 'le compte existe, mais n ouvre rien');
    assert.equal(A.codeUtilisable(u.pin_hash), false);
    // Aucune saisie ne doit passer, pas meme la chaine vide.
    for (const essai of ['', '0000', '1234', 'x']) assert.equal(A.verifierPin(essai, u.pin_hash), false);
  }
});

/*
 * Le test qui compte. Les anciens numeros de conducteur (1, 2, 3) recoupent
 * ceux des comptes existants : si la reecriture se faisait par UPDATE
 * successifs, une fiche pourrait etre deplacee deux fois et finir sur la
 * mauvaise personne.
 */
test('les fiches designent le bon conducteur apres la reecriture', () => {
  const lire = (chantier) =>
    db
      .prepare(
        `SELECT c.nom AS conducteur FROM fiches f
           LEFT JOIN utilisateurs c ON c.id = f.conducteur_id
          WHERE f.chantier = ?`
      )
      .get(chantier).conducteur;

  assert.equal(lire('Lycee Jean Moulin'), 'MOREAU Paul');
  assert.equal(lire('College Voltaire'), 'RENAUD Sophie');
  assert.equal(lire('Gymnase Sud'), 'GARNIER Luc');
  assert.equal(lire('Halle Ouest'), 'PETIT Anne');
  assert.equal(lire('Ecole Nord'), null, 'une fiche sans conducteur le reste');
});

test('le rattachement des chefs suit le meme chemin', () => {
  const rattache = (identifiant) =>
    db
      .prepare(
        `SELECT c.nom AS conducteur FROM utilisateurs u
           LEFT JOIN utilisateurs c ON c.id = u.conducteur_id
          WHERE u.identifiant = ?`
      )
      .get(identifiant).conducteur;

  assert.equal(rattache('kbenali'), 'GARNIER Luc');
});

test('la base reste coherente, et l ancienne table a disparu', () => {
  assert.equal(db.pragma('foreign_key_check').length, 0, 'aucune reference rompue');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1, 'les cles etrangeres sont reactivees');

  const table = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conducteurs'")
    .get();
  assert.equal(table, undefined, 'la table separee n a plus de raison d etre');

  // Les index de la table reconstruite reviennent : sans eux, chaque lecture
  // d'une semaine balaierait toutes les fiches.
  const index = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'fiches'")
    .all()
    .map((i) => i.name);
  assert.ok(index.includes('idx_fiches_periode'), 'index de periode repose');

  // Les chefs et le directeur n ont pas bouge.
  assert.equal(db.prepare("SELECT COUNT(*) n FROM utilisateurs WHERE role = 'chef'").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM utilisateurs WHERE role = 'directeur'").get().n, 1);
});

test('le nouveau role est accepte, et lui seul', () => {
  const inserer = (role) =>
    db
      .prepare("INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES ('X', 'x-" + role + "', ?, 'x')")
      .run(role);

  assert.doesNotThrow(() => inserer('conducteur'));
  assert.throws(() => inserer('comptable'), /CHECK/, 'un role inconnu reste refuse');
});

test('relancer l application ne refait pas la migration', () => {
  const avant = db.prepare("SELECT COUNT(*) n FROM utilisateurs WHERE role = 'conducteur'").get().n;
  delete require.cache[require.resolve('../server/db')];
  const { db: db2 } = require('../server/db');
  assert.equal(db2.prepare("SELECT COUNT(*) n FROM utilisateurs WHERE role = 'conducteur'").get().n, avant);
});
