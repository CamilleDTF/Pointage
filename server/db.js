'use strict';

const fs = require('fs');
const path = require('path');

/*
 * better-sqlite3 est un composant compile. Un binaire precompile existe pour
 * chaque version de Node, mais pas au-dela de celles connues au moment de sa
 * publication : sur une version de Node plus recente, l'installation bascule sur
 * une compilation locale, qui echoue faute d'outils de compilation. Le message
 * brut n'aide alors personne — celui-ci nomme la cause et la solution.
 */
let Database;
try {
  Database = require('better-sqlite3');
} catch (erreur) {
  const majeure = Number(process.versions.node.split('.')[0]);
  console.error('\nImpossible de charger la base de donnees (better-sqlite3).\n');
  console.error(`Node.js installe : ${process.version} (${process.platform} ${process.arch})`);
  console.error('Version requise  : Node.js 22 ou 24.\n');
  if (majeure < 22) {
    console.error('Votre version de Node.js est trop ancienne.');
  } else {
    console.error("Le composant n'a pas pu etre installe pour cette version de Node.js.");
  }
  console.error('A essayer, dans le dossier de l application :');
  console.error('  1. supprimer le dossier "node_modules"');
  console.error('  2. relancer DEMARRER.bat, qui refera l installation\n');
  console.error(`Message d origine : ${erreur.message}\n`);
  process.exit(1);
}

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

/*
 * Conducteurs de travaux. Ils visent les fiches avant le directeur, mais n'ont
 * pas de compte : tout passe par un lien signe recu par courriel. Un compte de
 * plus par personne, c'est un code de plus a retenir et a reinitialiser.
 */
CREATE TABLE IF NOT EXISTS conducteurs (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  nom     TEXT    NOT NULL,
  courriel TEXT   NOT NULL,
  actif   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS vehicules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  immatriculation TEXT   NOT NULL UNIQUE,
  marque         TEXT    NOT NULL DEFAULT '',
  modele         TEXT    NOT NULL DEFAULT '',
  motorisation   TEXT    NOT NULL DEFAULT '',
  actif          INTEGER NOT NULL DEFAULT 1
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

/*
 * Ajouts de colonnes sur une base deja en service. `ALTER TABLE ADD COLUMN`
 * n'accepte pas de "IF NOT EXISTS" : on interroge d'abord la table.
 */
function ajouterColonne(table, colonne, definition) {
  const existe = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === colonne);
  if (!existe) db.exec(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definition}`);
}

/*
 * `saisi` distingue une journee mise a zero par le chef d'equipe — le salarie
 * n'a pas travaille ce jour-la — d'une journee qu'il n'a pas encore remplie.
 * Les deux valent zero minute, mais la premiere est complete et la seconde non.
 * Les fiches anterieures a cette colonne restent lisibles : une journee y ayant
 * des heures ou un code absence est de toute facon consideree comme renseignee.
 */
ajouterColonne('fiche_jours', 'saisi', 'INTEGER NOT NULL DEFAULT 0');

/*
 * Taux horaire brut du salarie, saisi par le directeur depuis l'ecran
 * Parametres. Zero signifie « pas encore renseigne » : les montants ne sont
 * alors pas calcules plutot que d'afficher un salaire faux.
 */
ajouterColonne('salaries', 'taux_horaire', 'REAL NOT NULL DEFAULT 0');

/*
 * Zone de deplacement du chantier : PARIS, NICE ou AUTRE. Elle decide seule du
 * taux de grand deplacement (80 pour Paris et Nice, 72 ailleurs). Avant, ce
 * taux se devinait en cherchant « paris » ou « nice » dans le nom de la ville —
 * une orthographe inattendue suffisait a le fausser. Les fiches anterieures,
 * sans zone, continuent d'etre lues a l'ancienne.
 */
ajouterColonne('fiches', 'zone_deplacement', "TEXT NOT NULL DEFAULT ''");

/*
 * Parc de vehicules : le chef choisit une immatriculation, le reste suit. La
 * liste initiale vient du parc communique par la direction ; elle se modifie
 * ensuite depuis l'ecran Parametres, sans toucher au code.
 */
/*
 * Visa du conducteur de travaux, etape intercalee entre la transmission par le
 * chef et la validation par le directeur.
 *
 * Le visa vit dans ses propres colonnes plutot que dans `statut` : une fiche
 * reste "soumise" pendant tout ce temps, et le visa est une seconde dimension —
 * ce qui evite de reecrire la contrainte de statut, et laisse le directeur
 * valider sans visa quand le conducteur est absent.
 *
 * `visa_jeton` est le secret du lien envoye par courriel. Il est regenere a
 * chaque transmission : un lien d'une version anterieure de la fiche cesse
 * aussitot de fonctionner.
 */
ajouterColonne('fiches', 'visa_statut', "TEXT NOT NULL DEFAULT ''"); // '', 'attente', 'vise'
ajouterColonne('fiches', 'visa_jeton', 'TEXT');
ajouterColonne('fiches', 'visa_le', 'TEXT');
ajouterColonne('fiches', 'visa_courriel', "TEXT NOT NULL DEFAULT ''");
ajouterColonne('fiches', 'visa_commentaire', "TEXT NOT NULL DEFAULT ''");
ajouterColonne('fiches', 'visa_envoye_le', 'TEXT');

/*
 * Le conducteur de travaux dont depend un chef d'equipe : c'est le choix
 * propose par defaut sur ses fiches.
 */
ajouterColonne('utilisateurs', 'conducteur_id', 'INTEGER REFERENCES conducteurs(id) ON DELETE SET NULL');

/*
 * Date de la PREMIERE demande de validation.
 *
 * `soumise_le` est ecrase a chaque retransmission : une fiche renvoyee puis
 * corrigee porte la date de sa correction, ce qui fait passer pour un retard un
 * chef d'equipe qui avait rendu a temps. La ponctualite se mesure sur le
 * premier envoi — le moment ou il a fait sa part — et les corrections restent
 * comptees a part, dans les fiches renvoyees.
 */
ajouterColonne('fiches', 'premiere_soumission_le', 'TEXT');

/*
 * Le conducteur choisi pour cette fiche-la. Un chef ne travaille pas toujours
 * sous le meme : le chantier de la semaine decide, et c'est lui qui sait. Son
 * rattachement habituel ne sert plus que de proposition.
 */
ajouterColonne('fiches', 'conducteur_id', 'INTEGER REFERENCES conducteurs(id) ON DELETE SET NULL');

const PARC_INITIAL = [
  ['GR-686-YM', 'Renault', 'Trafic', 'Diesel'],
  ['GR-714-YM', 'Renault', 'Trafic', 'Diesel'],
  ['GR-719-YM', 'Renault', 'Trafic', 'Diesel'],
  ['GR-707-YM', 'Renault', 'Trafic', 'Diesel'],
  ['GV-710-TF', 'Renault', 'Trafic', 'Diesel'],
  ['GV-674-TF', 'Renault', 'Trafic', 'Diesel'],
  ['FT-156-HW', 'Iveco', 'Hayon', 'Diesel'],
  ['HB-065-XP', 'Renault', 'Trafic', 'Diesel'],
  ['HB-256-YJ', 'Renault', 'Trafic', 'Diesel'],
  ['HE-968-WJ', 'Renault', 'Trafic', 'Diesel'],
  ['HA-409-XC', 'Renault', 'Master', 'Diesel'],
  ['DM-320-AY', 'Peugeot', '308', 'Diesel'],
  ['FC-291-KA', 'Citroen', 'C4', 'Diesel'],
  ['EB-308-KY', 'Citroen', 'C4 Cactus', 'Diesel'],
];

/*
 * Reprise des fiches deja transmises : leur premiere demande de validation se
 * lit dans le journal, qui la conserve depuis le debut. A defaut, on retombe
 * sur la date de transmission connue.
 */
db.prepare(
  `UPDATE fiches SET premiere_soumission_le = COALESCE(
     (SELECT MIN(j.horodatage) FROM journal j
       WHERE j.fiche_id = fiches.id AND j.action = 'soumission'),
     soumise_le)
    WHERE premiere_soumission_le IS NULL AND soumise_le IS NOT NULL`
).run();

if (db.prepare('SELECT COUNT(*) AS n FROM vehicules').get().n === 0) {
  const inserer = db.prepare(
    'INSERT INTO vehicules (immatriculation, marque, modele, motorisation) VALUES (?, ?, ?, ?)'
  );
  db.transaction(() => PARC_INITIAL.forEach((v) => inserer.run(...v)))();
}

function journaliser(ficheId, userId, action, detail = '') {
  db.prepare(
    'INSERT INTO journal (fiche_id, user_id, action, detail) VALUES (?, ?, ?, ?)'
  ).run(ficheId, userId, action, detail);
}

module.exports = { db, journaliser, DATA_DIR };
