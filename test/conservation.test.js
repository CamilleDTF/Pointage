'use strict';

/*
 * Combien de temps on garde, et ce qu'il reste apres.
 *
 * Une fiche de pointage justifie des heures : elle ne se garde pas
 * indefiniment, mais elle ne s'efface pas non plus d'un trait — c'est une
 * preuve, et elle sert aux deux parties. D'ou l'anonymisation plutot que la
 * suppression : ce qui identifie la personne disparait, ce qui prouve les
 * heures reste.
 *
 * Ce fichier verrouille les deux moities de cette phrase. La premiere est
 * facile a oublier — le nom a voyage dans quatre endroits — et la seconde est
 * facile a casser, puisqu'il suffirait de supprimer pour « bien faire ».
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-cons-'));

const { db } = require('../server/db');
const F = require('../server/fiches');
const C = require('../server/conservation');

test.after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

const chef = db
  .prepare("INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES ('CHEF', 'chef', 'chef', 'x')")
  .run().lastInsertRowid;
const directeur = db
  .prepare("INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES ('DIRECTION', 'dir', 'directeur', 'x')")
  .run().lastInsertRowid;
const LE_CHEF = { id: chef, role: 'chef' };
const LE_DIRECTEUR = { id: directeur, role: 'directeur' };

/*
 * Tous crees ACTIFS : on ne pointe pas quelqu'un qui a quitte l'entreprise —
 * le serveur refuse d'ailleurs de rattacher une ligne a un salarie sorti de
 * l'effectif. La sortie se fait donc apres coup, comme dans la vraie vie.
 */
const inserer = db.prepare('INSERT INTO salaries (matricule, nom, prenom, chef_id, actif) VALUES (?, ?, ?, ?, 1)');
const paul = inserer.run('A1', 'MARTIN', 'Paul', chef).lastInsertRowid;
const active = inserer.run('A2', 'DURAND', 'Pierre', chef).lastInsertRowid;

const faireSortir = (id) => db.prepare('UPDATE salaries SET actif = 0 WHERE id = ?').run(id);

const SIGNATURE = 'data:image/png;base64,UGF1bA==';

/** Une fiche validee, signee, pour Paul — la piece qu'il faudra conserver. */
function ficheValidee(semaine, annee = 2018) {
  const fiche = F.obtenirOuCreerFicheSemaine(chef, annee, semaine);
  F.enregistrerFiche(
    fiche.id,
    {
      chantier: 'Lycee Jean Moulin',
      ville: 'Toulouse',
      zone_deplacement: 'AUTRE',
      lignes: [
        {
          salarie_id: paul,
          nom_affiche: 'MARTIN Paul',
          minutes_route: 0, minutes_trajet: 0, jours_zone: 0, type_masque: '',
          nb_gd72: 0, nb_gd80: 0, observation: '',
          signature: SIGNATURE,
          jours: [0, 1, 2, 3, 4, 5, 6].map((j) => ({ jour: j, minutes: j <= 4 ? 450 : 0, code_absence: '', saisi: 1 })),
        },
      ],
    },
    LE_CHEF
  );
  F.soumettre(fiche.id, LE_CHEF);
  F.statuer(fiche.id, LE_DIRECTEUR, 'valider');
  return fiche.id;
}

/* ------------------------------------------------------------------------- */

test('un salarie encore en poste n est jamais candidat', () => {
  assert.equal(C.candidats().some((s) => s.id === active), false);
});

test('un salarie sorti depuis plus de cinq ans est propose', () => {
  ficheValidee(10);
  faireSortir(paul);
  const liste = C.candidats();
  const trouve = liste.find((s) => s.id === paul);
  assert.ok(trouve, 'MARTIN Paul, sorti de l effectif, pointe pour la derniere fois en 2018');
  assert.equal(trouve.nom, 'MARTIN');
});

/*
 * Un sorti recent figure dans la liste — on doit pouvoir verifier que sa sortie
 * a bien ete enregistree — mais il n'est pas encore effacable. La liste ne
 * montrait que les effacables : quelqu'un parti le mois dernier n'apparaissait
 * nulle part, et rien ne disait quand son tour viendrait.
 */
test('un salarie parti recemment figure dans la liste sans etre effacable', () => {
  const recent = inserer.run('A3', 'NOEL', 'Sophie', chef).lastInsertRowid;
  const fiche = F.obtenirOuCreerFicheSemaine(chef, new Date().getFullYear(), 20);
  F.enregistrerFiche(
    fiche.id,
    { lignes: [{ salarie_id: recent, nom_affiche: 'NOEL Sophie', jours: [{ jour: 0, minutes: 420, saisi: 1 }] }] },
    LE_CHEF
  );
  faireSortir(recent);

  const entree = C.candidats().find((s) => s.id === recent);
  assert.ok(entree, 'un sorti recent doit rester visible');
  assert.equal(entree.effacable, false, 'ses heures sont trop fraiches');
  assert.ok(entree.effacableLe, 'son echeance doit etre annoncee');
});

/*
 * Le coeur du sujet, premiere moitie : le nom disparait PARTOUT. Il a voyage —
 * la ligne de fiche le porte en clair, la version archivee en garde une copie
 * JSON, le journal l'a ecrit dans ses releves.
 */
test('anonymiser efface le nom partout ou il avait ete recopie', () => {
  const ficheId = ficheValidee(11);
  // Une correction, pour que le journal porte son nom.
  F.statuer(ficheId, LE_DIRECTEUR, 'rouvrir', 'Correction des heures');
  F.enregistrerFiche(
    ficheId,
    {
      lignes: [
        {
          salarie_id: paul, nom_affiche: 'MARTIN Paul',
          jours: [0, 1, 2, 3, 4, 5, 6].map((j) => ({ jour: j, minutes: j <= 4 ? 480 : 0, saisi: 1 })),
        },
      ],
    },
    LE_DIRECTEUR
  );

  assert.match(
    db.prepare("SELECT detail FROM journal WHERE action = 'correction_directeur' ORDER BY id DESC LIMIT 1").get().detail,
    /MARTIN Paul/
  );

  assert.deepEqual(C.anonymiser(paul, LE_DIRECTEUR).ok, true);

  // 1. Le registre.
  const apres = db.prepare('SELECT * FROM salaries WHERE id = ?').get(paul);
  assert.equal(apres.nom, 'SALARIÉ');
  assert.equal(apres.prenom, `n° ${paul}`);
  assert.equal(apres.matricule, '');
  assert.ok(apres.anonymise_le);

  // 2. Les lignes de fiche, et leur signature.
  const lignes = db.prepare('SELECT nom_affiche, signature FROM fiche_lignes WHERE salarie_id = ?').all(paul);
  assert.ok(lignes.length > 0);
  for (const l of lignes) {
    assert.equal(l.nom_affiche, `SALARIÉ n° ${paul}`);
    assert.equal(l.signature, null, 'une signature manuscrite identifie autant qu un nom');
  }

  // 3. Les versions archivees.
  for (const v of db.prepare('SELECT contenu FROM fiche_versions').all()) {
    assert.ok(!v.contenu.includes('MARTIN'), 'le nom ne doit plus figurer dans une version archivee');
    assert.ok(!v.contenu.includes(SIGNATURE), 'ni sa signature');
  }

  // 4. Le journal.
  const restes = db.prepare("SELECT COUNT(*) n FROM journal WHERE detail LIKE '%MARTIN Paul%'").get().n;
  assert.equal(restes, 0, 'le releve reste, la personne n y est plus nommee');
});

/*
 * Seconde moitie, et c'est elle qu'on casserait en croyant bien faire : ce qui
 * prouve les heures doit rester. Supprimer aurait vide des fiches validees et
 * fait bouger des totaux de mois passes.
 */
test('anonymiser ne detruit ni les heures ni les fiches', () => {
  /*
   * On compte par l'etiquette, pas par le numero de salarie : une de ses deux
   * fiches a ete saisie apres sa sortie d'effectif, donc sans rattachement —
   * elle ne portait plus que son nom en clair. Elle doit avoir ete anonymisee
   * elle aussi, et gardee elle aussi.
   */
  const lignes = db
    .prepare(
      `SELECT l.id, (SELECT SUM(minutes) FROM fiche_jours WHERE ligne_id = l.id) AS minutes
         FROM fiche_lignes l WHERE l.nom_affiche = ?`
    )
    .all(`SALARIÉ n° ${paul}`);

  assert.ok(lignes.length >= 2, 'ses deux fiches sont toujours la');
  for (const l of lignes) assert.ok(l.minutes > 0, 'ses heures aussi');

  const validees = db
    .prepare("SELECT COUNT(*) n FROM fiches WHERE statut = 'validee'")
    .get().n;
  assert.ok(validees > 0, 'les fiches validees restent des pieces justificatives');
  assert.ok(db.prepare('SELECT COUNT(*) n FROM fiche_versions').get().n > 0);
});

test('un salarie deja anonymise ne se retraite pas', () => {
  const refus = C.anonymiser(paul, LE_DIRECTEUR);
  assert.equal(refus.code, 409);
  assert.equal(C.candidats().some((s) => s.id === paul), false, 'il sort de la liste');
});

test('l anonymisation laisse une trace au journal', () => {
  const trace = db
    .prepare("SELECT user_id, detail FROM journal WHERE action = 'anonymisation' ORDER BY id DESC LIMIT 1")
    .get();
  assert.equal(trace.user_id, directeur);
  assert.match(trace.detail, new RegExp(`n° ${paul}`));
});

/*
 * Le dossier d'une personne : ce qu'on lui remet si elle demande a savoir. Le
 * rassembler a la main dans six tables, le jour ou la demande arrive, serait la
 * meilleure facon d'en oublier une.
 */
test('le dossier d une personne rassemble tout ce qui la concerne', () => {
  const pierre = active;
  db.prepare("INSERT INTO conges (salarie_id, debut, fin, motif) VALUES (?, '2026-08-17', '2026-08-21', 'CP')").run(pierre);

  const fiche = F.obtenirOuCreerFicheSemaine(chef, 2026, 30);
  F.enregistrerFiche(
    fiche.id,
    {
      chantier: 'Chantier A',
      lignes: [{ salarie_id: pierre, nom_affiche: 'DURAND Pierre', jours: [{ jour: 0, minutes: 450, saisi: 1 }] }],
    },
    LE_CHEF
  );

  const dossier = C.dossierSalarie(pierre);
  assert.equal(dossier.salarie.nom, 'DURAND');
  assert.equal(dossier.salarie.matricule, 'A2');
  assert.equal(dossier.pointages.length, 1);
  assert.equal(dossier.pointages[0].chantier, 'Chantier A');
  assert.equal(dossier.pointages[0].jours[0].minutes, 450);
  assert.equal(dossier.conges.length, 1);
  assert.equal(dossier.conges[0].motif, 'CP');
  assert.deepEqual(dossier.joursNonProductifs, []);
});

test('le dossier d un inconnu est refuse, pas invente', () => {
  assert.equal(C.dossierSalarie(999999).code, 404);
});
