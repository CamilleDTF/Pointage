'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const D = require('./domaine');

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
  role          TEXT    NOT NULL CHECK (role IN ('chef', 'directeur', 'conducteur')),
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

CREATE TABLE IF NOT EXISTS vehicules (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  immatriculation TEXT   NOT NULL UNIQUE,
  marque         TEXT    NOT NULL DEFAULT '',
  modele         TEXT    NOT NULL DEFAULT '',
  motorisation   TEXT    NOT NULL DEFAULT '',
  actif          INTEGER NOT NULL DEFAULT 1
);

/*
 * Registre des conges et absences longues, tenu par la direction.
 *
 * Les codes d'absence de la fiche expliquent un jour sans heures, mais ils
 * supposent qu'une fiche existe. Une semaine entiere de conges ne produit
 * aucune ligne : sur le calendrier, le salarie apparaissait simplement « non
 * pointe », comme un oubli. Ce registre repond a la question « pourquoi
 * celui-la n'est-il nulle part cette semaine ? » sans avoir a la poser.
 *
 * Les bornes sont incluses : un conge du 3 au 7 couvre les cinq jours.
 */
CREATE TABLE IF NOT EXISTS conges (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  salarie_id INTEGER NOT NULL REFERENCES salaries(id) ON DELETE CASCADE,
  debut      TEXT    NOT NULL,
  fin        TEXT    NOT NULL,
  motif      TEXT    NOT NULL DEFAULT 'CP',
  commentaire TEXT   NOT NULL DEFAULT '',
  cree_le    TEXT    NOT NULL DEFAULT (datetime('now'))
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
CREATE INDEX IF NOT EXISTS idx_conges_salarie ON conges(salarie_id, debut, fin);
`);

/*
 * Ajouts de colonnes sur une base deja en service. `ALTER TABLE ADD COLUMN`
 * n'accepte pas de "IF NOT EXISTS" : on interroge d'abord la table.
 */
function ajouterColonne(table, colonne, definition) {
  const existe = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === colonne);
  if (!existe) db.exec(`ALTER TABLE ${table} ADD COLUMN ${colonne} ${definition}`);
}

const colonneExiste = (table, colonne) =>
  db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === colonne);

const schemaDe = (nom) =>
  db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(nom);

/*
 * Reconstruit une table en ne changeant de son schema que ce qu'on lui demande.
 *
 * SQLite ne sait modifier ni une contrainte CHECK ni une cle etrangere : il faut
 * recreer la table, recopier, remplacer. Le schema neuf est obtenu en
 * transformant l'ancien plutot qu'en le reecrivant a la main — une colonne
 * ajoutee entre-temps par une migration precedente serait sinon perdue en
 * chemin, sans que rien ne le signale.
 */
function reconstruireTable(nom, transformer) {
  const ancien = schemaDe(nom);
  const index = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL")
    .all(nom);
  const colonnes = db
    .prepare(`PRAGMA table_info(${nom})`)
    .all()
    .map((c) => `"${c.name}"`)
    .join(', ');

  const neuf = transformer(ancien.sql).replace(`CREATE TABLE ${nom}`, `CREATE TABLE ${nom}_migration`);
  if (neuf === ancien.sql) throw new Error(`Reconstruction de ${nom} : le schema n'a pas change.`);

  db.exec(neuf);
  db.exec(`INSERT INTO ${nom}_migration (${colonnes}) SELECT ${colonnes} FROM ${nom}`);
  db.exec(`DROP TABLE ${nom}`);
  db.exec(`ALTER TABLE ${nom}_migration RENAME TO ${nom}`);
  // Les index disparaissent avec la table : on les repose tels quels.
  index.forEach((i) => db.exec(i.sql));
}

/** Un identifiant de connexion tire du nom, libre de tout homonyme. */
function identifiantLibre(nomComplet) {
  const { nom, prenom } = D.separerNomPrenom(nomComplet);
  const net = (t) => D.sansAccents(String(t || '')).toLowerCase().replace(/[^a-z0-9]/g, '');
  const base = `${net(prenom).slice(0, 1)}${net(nom)}` || 'conducteur';
  const pris = db.prepare('SELECT 1 FROM utilisateurs WHERE identifiant = ?');

  let candidat = base;
  let suffixe = 2;
  while (pris.get(candidat)) {
    candidat = `${base}${suffixe}`;
    suffixe += 1;
  }
  return candidat;
}

/*
 * Les conducteurs de travaux deviennent des comptes a part entiere.
 *
 * Ils vivaient dans une table separee, concue pour des liens sans compte : un
 * nom, une adresse, un secret. Puisqu'ils se connectent desormais comme les
 * chefs et le directeur, ils rejoignent le meme registre — une personne y vit a
 * un seul endroit, et s'y desactive une seule fois.
 *
 * Aucun d'eux ne recoit de code : la migration ne peut pas inventer un secret
 * que le directeur connaitrait. Elle laisse l'empreinte vide — un compte qui
 * existe mais n'ouvre rien — et c'est le directeur qui donnera un code depuis
 * Parametres. L'ecran le lui rappelle tant que ce n'est pas fait.
 */
function migrerConducteursVersComptes() {
  const ancienneTable = Boolean(schemaDe('conducteurs'));
  const roleOuvert = /CHECK \(role IN \([^)]*'conducteur'/.test(schemaDe('utilisateurs').sql);
  if (roleOuvert && !ancienneTable) return;

  // Une base anterieure au lien personnel n'a pas ces colonnes ; on les pose
  // avant de lire, plutot que de deviner ce qu'elle contient.
  if (ancienneTable) ajouterColonne('conducteurs', 'telephone', "TEXT NOT NULL DEFAULT ''");
  const anciens = ancienneTable ? db.prepare('SELECT * FROM conducteurs ORDER BY id').all() : [];

  // Les cles etrangeres se taisent pendant l'operation : le temps de la
  // reconstruction, les references designent forcement des tables absentes.
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      if (!roleOuvert) {
        reconstruireTable('utilisateurs', (sql) =>
          sql
            .replace(
              "CHECK (role IN ('chef', 'directeur'))",
              "CHECK (role IN ('chef', 'directeur', 'conducteur'))"
            )
            .replace(/REFERENCES conducteurs\(id\)/g, 'REFERENCES utilisateurs(id)')
        );
      }

      ajouterColonne('utilisateurs', 'courriel', "TEXT NOT NULL DEFAULT ''");
      ajouterColonne('utilisateurs', 'telephone', "TEXT NOT NULL DEFAULT ''");

      const correspondance = new Map();
      const inserer = db.prepare(
        `INSERT INTO utilisateurs (nom, identifiant, role, pin_hash, actif, courriel, telephone)
         VALUES (@nom, @identifiant, 'conducteur', @pin_hash, @actif, @courriel, @telephone)`
      );
      for (const c of anciens) {
        const r = inserer.run({
          nom: c.nom,
          identifiant: identifiantLibre(c.nom),
          pin_hash: '',
          actif: c.actif,
          courriel: c.courriel || '',
          telephone: c.telephone || '',
        });
        correspondance.set(Number(c.id), Number(r.lastInsertRowid));
      }

      if (schemaDe('fiches').sql.includes('REFERENCES conducteurs(id)')) {
        reconstruireTable('fiches', (sql) =>
          sql.replace(/REFERENCES conducteurs\(id\)/g, 'REFERENCES utilisateurs(id)')
        );
      }

      /*
       * Reecriture en une seule passe, par CASE plutot que par une suite de
       * UPDATE : un ancien numero de conducteur peut valoir un nouveau numero de
       * compte, et deux mises a jour successives se rattraperaient l'une l'autre.
       */
      if (correspondance.size) {
        const cas = [...correspondance].map(([a, n]) => `WHEN ${a} THEN ${n}`).join(' ');
        const liste = [...correspondance.keys()].join(', ');
        for (const table of ['utilisateurs', 'fiches']) {
          if (!colonneExiste(table, 'conducteur_id')) continue;
          db.exec(
            `UPDATE ${table} SET conducteur_id = CASE conducteur_id ${cas} END
              WHERE conducteur_id IN (${liste})`
          );
        }
      }

      if (ancienneTable) db.exec('DROP TABLE conducteurs');

      const rompues = db.pragma('foreign_key_check');
      if (rompues.length) {
        throw new Error(`Migration des conducteurs : ${rompues.length} reference(s) rompue(s).`);
      }
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }

  if (anciens.length) {
    console.log(
      `Conducteurs de travaux : ${anciens.length} compte(s) cree(s). ` +
        'Donnez-leur un code depuis Parametres — ils ne peuvent pas encore se connecter.'
    );
  }
}

migrerConducteursVersComptes();

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
 */
ajouterColonne('fiches', 'visa_statut', "TEXT NOT NULL DEFAULT ''"); // '', 'attente', 'vise'
ajouterColonne('fiches', 'visa_le', 'TEXT');
ajouterColonne('fiches', 'visa_courriel', "TEXT NOT NULL DEFAULT ''");
ajouterColonne('fiches', 'visa_commentaire', "TEXT NOT NULL DEFAULT ''");
ajouterColonne('fiches', 'visa_envoye_le', 'TEXT');

/*
 * Le conducteur de travaux dont depend un chef d'equipe : c'est le choix
 * propose par defaut sur ses fiches.
 */
ajouterColonne('utilisateurs', 'conducteur_id', 'INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL');

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
ajouterColonne('fiches', 'conducteur_id', 'INTEGER REFERENCES utilisateurs(id) ON DELETE SET NULL');

/*
 * Deux populations dans le meme registre du personnel.
 *
 * Le personnel « non productif » — administratif, encadrement, atelier — ne
 * figure sur aucune fiche de chantier : il n'a ni chef d'equipe, ni pointage
 * hebdomadaire. Sa paie se prepare pourtant de la meme facon, et le directeur en
 * a besoin. Plutot qu'un second registre a tenir en parallele, un indicateur :
 * meme table, meme matricule, meme taux horaire, deux ecrans differents.
 *
 * Par defaut tout le monde est productif — c'est ce qu'etaient les salaries
 * existants au moment ou cette colonne apparait.
 */
ajouterColonne('salaries', 'productif', 'INTEGER NOT NULL DEFAULT 1');

/*
 * Le pointage du personnel non productif : uniquement ce qui s'ecarte de
 * l'ordinaire.
 *
 * Ils sont a 7 h par jour ouvre, et ce sont les exceptions qui se declarent —
 * une absence, un grand deplacement. Une journee ordinaire ne laisse donc
 * aucune ligne : la table ne grossit que de ce qui merite d'etre dit, et un mois
 * sans histoire ne coute rien.
 */
db.exec(`
CREATE TABLE IF NOT EXISTS jours_non_productifs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  salarie_id   INTEGER NOT NULL REFERENCES salaries(id) ON DELETE CASCADE,
  date         TEXT    NOT NULL,
  code_absence TEXT    NOT NULL DEFAULT '',
  minutes      INTEGER NOT NULL DEFAULT 0,
  gd           TEXT    NOT NULL DEFAULT '',
  UNIQUE (salarie_id, date)
);

/*
 * Primes du personnel non productif : un montant, un motif, un mois. Elles ne se
 * deduisent d'aucune regle — c'est une decision, et une decision se note.
 */
CREATE TABLE IF NOT EXISTS primes_non_productifs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  salarie_id INTEGER NOT NULL REFERENCES salaries(id) ON DELETE CASCADE,
  annee      INTEGER NOT NULL,
  mois       INTEGER NOT NULL,
  libelle    TEXT    NOT NULL DEFAULT '',
  montant    REAL    NOT NULL DEFAULT 0,
  cree_le    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_jnp_salarie ON jours_non_productifs(salarie_id, date);
CREATE INDEX IF NOT EXISTS idx_pnp_mois    ON primes_non_productifs(salarie_id, annee, mois);
`);

/*
 * Adresse et telephone d'un conducteur de travaux, sur son compte.
 *
 * Le courriel lui annonce qu'une fiche l'attend ; le telephone permet au chef
 * d'equipe de le prevenir lui-meme quand l'envoi automatique ne part pas. Ni
 * l'un ni l'autre ne donne acces a quoi que ce soit — c'est le compte qui ouvre.
 */
ajouterColonne('utilisateurs', 'courriel', "TEXT NOT NULL DEFAULT ''");
ajouterColonne('utilisateurs', 'telephone', "TEXT NOT NULL DEFAULT ''");

/*
 * Les secrets d'acces du conducteur de travaux ont disparu avec les comptes.
 *
 * `utilisateurs.jeton` etait son lien personnel, `fiches.visa_jeton` le secret
 * du lien de visa envoye par courriel. Les laisser en place ne serait pas
 * neutre : `obtenirFiche` lit la fiche entiere, et un secret mort continuerait
 * de partir dans les reponses de l'API — un test l'a d'ailleurs surpris a le
 * faire. Une colonne inutile qui transporte encore un secret n'est pas une
 * colonne inutile, c'est une fuite.
 */
function retirerColonne(table, colonne) {
  if (colonneExiste(table, colonne)) db.exec(`ALTER TABLE ${table} DROP COLUMN ${colonne}`);
}
retirerColonne('utilisateurs', 'jeton');
retirerColonne('fiches', 'visa_jeton');

/*
 * Jours de grand deplacement, saisis par le chef d'equipe, ligne par ligne.
 *
 * Le taux se deduisait de la ville du chantier : Paris et Nice au taux 80, le
 * reste au taux 72. C'etait faux dans les deux sens — un meme chantier peut
 * relever des deux selon les jours, et la ville ne dit pas tout. Le chef sait,
 * lui, combien de jours chaque salarie a passes sous l'un et sous l'autre : il
 * les compte, comme sur la fiche papier.
 *
 * Les fiches d'avant gardent leur repartition calculee depuis la ville : voir
 * server/mensuel.js, qui ne bascule sur ces colonnes que si elles sont
 * renseignees.
 */
ajouterColonne('fiche_lignes', 'nb_gd72', 'INTEGER NOT NULL DEFAULT 0');
ajouterColonne('fiche_lignes', 'nb_gd80', 'INTEGER NOT NULL DEFAULT 0');

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
