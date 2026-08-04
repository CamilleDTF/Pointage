'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'pointage.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS utilisateurs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nom           TEXT    NOT NULL,
  identifiant   TEXT    NOT NULL UNIQUE,
  role          TEXT    NOT NULL CHECK (role IN ('chef', 'directeur')),
  pin_hash      TEXT    NOT NULL,
  actif         INTEGER NOT NULL DEFAULT 1,
  cree_le       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS salaries (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  matricule     TEXT,
  nom           TEXT    NOT NULL,
  prenom        TEXT    NOT NULL,
  chef_id       INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL,
  actif         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS fiches (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  chef_id               INTEGER NOT NULL REFERENCES utilisateurs(id),
  annee                 INTEGER NOT NULL,
  semaine               INTEGER NOT NULL,
  chantier              TEXT    NOT NULL DEFAULT '',
  ville                 TEXT    NOT NULL DEFAULT '',
  conducteur_vehicule   TEXT    NOT NULL DEFAULT '',
  type_vehicule         TEXT    NOT NULL DEFAULT '',
  immatriculation       TEXT    NOT NULL DEFAULT '',
  observations_pointage TEXT    NOT NULL DEFAULT '',
  commentaire_responsable TEXT  NOT NULL DEFAULT '',
  nom_responsable       TEXT    NOT NULL DEFAULT '',
  signature_responsable TEXT,
  date_responsable      TEXT,
  visa_conducteur       TEXT    NOT NULL DEFAULT '',
  date_visa             TEXT,
  statut                TEXT    NOT NULL DEFAULT 'brouillon'
                          CHECK (statut IN ('brouillon','soumise','validee','rejetee')),
  motif_rejet           TEXT    NOT NULL DEFAULT '',
  soumise_le            TEXT,
  validee_le            TEXT,
  validee_par           INTEGER REFERENCES utilisateurs(id),
  cree_le               TEXT    NOT NULL DEFAULT (datetime('now')),
  maj_le                TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE (chef_id, annee, semaine, chantier)
);

CREATE TABLE IF NOT EXISTS fiche_lignes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  fiche_id        INTEGER NOT NULL REFERENCES fiches(id) ON DELETE CASCADE,
  salarie_id      INTEGER REFERENCES salaries(id) ON DELETE SET NULL,
  nom_affiche     TEXT    NOT NULL DEFAULT '',
  ordre           INTEGER NOT NULL DEFAULT 0,
  minutes_route   INTEGER NOT NULL DEFAULT 0,
  minutes_trajet  INTEGER NOT NULL DEFAULT 0,
  jours_zone      REAL    NOT NULL DEFAULT 0,
  type_masque     TEXT    NOT NULL DEFAULT '',
  nb_deplacement  INTEGER NOT NULL DEFAULT 0,
  observation     TEXT    NOT NULL DEFAULT '',
  signature       TEXT
);

CREATE TABLE IF NOT EXISTS fiche_jours (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ligne_id      INTEGER NOT NULL REFERENCES fiche_lignes(id) ON DELETE CASCADE,
  jour          INTEGER NOT NULL CHECK (jour BETWEEN 0 AND 6),
  minutes       INTEGER NOT NULL DEFAULT 0,
  code_absence  TEXT    NOT NULL DEFAULT '',
  UNIQUE (ligne_id, jour)
);

CREATE TABLE IF NOT EXISTS journal (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  fiche_id  INTEGER REFERENCES fiches(id) ON DELETE CASCADE,
  user_id   INTEGER REFERENCES utilisateurs(id),
  action    TEXT NOT NULL,
  detail    TEXT NOT NULL DEFAULT '',
  horodatage TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fiches_periode ON fiches(annee, semaine);
CREATE INDEX IF NOT EXISTS idx_fiches_statut  ON fiches(statut);
CREATE INDEX IF NOT EXISTS idx_lignes_fiche   ON fiche_lignes(fiche_id);
CREATE INDEX IF NOT EXISTS idx_jours_ligne    ON fiche_jours(ligne_id);
CREATE INDEX IF NOT EXISTS idx_journal_fiche  ON journal(fiche_id);
`);

function journaliser(ficheId, userId, action, detail = '') {
  db.prepare(
    'INSERT INTO journal (fiche_id, user_id, action, detail) VALUES (?, ?, ?, ?)'
  ).run(ficheId, userId, action, detail);
}

module.exports = { db, journaliser, DATA_DIR };
