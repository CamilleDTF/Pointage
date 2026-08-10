'use strict';

/*
 * Qui est qui, et qui decide.
 *
 * Une ligne de pointage porte deux choses : un nom, qu'on lit a l'ecran, et un
 * numero de salarie, qui part en paie. `agregerMois` va chercher sur ce numero
 * le matricule et le taux horaire. Le serveur croyait le navigateur sur parole
 * pour les deux — un couple incoherent affichait donc quelqu'un et en payait un
 * autre, sans que rien nulle part ne le signale.
 *
 * La regle : le REGISTRE tranche, jamais l'ecran. Le nom affiche est relu depuis
 * la fiche du salarie, et un numero qu'on ne peut pas honorer n'est pas suivi.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-ident-'));

const { db } = require('../server/db');
const F = require('../server/fiches');
const M = require('../server/mensuel');

test.after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

const chef = db
  .prepare("INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES ('CHEF', 'chef', 'chef', 'x')")
  .run().lastInsertRowid;
const utilisateur = { id: chef, role: 'chef' };

const inserer = db.prepare(
  'INSERT INTO salaries (matricule, nom, prenom, chef_id, productif, taux_horaire) VALUES (?, ?, ?, ?, ?, ?)'
);
const paul = inserer.run('A1', 'MARTIN', 'Paul', chef, 1, 15).lastInsertRowid;
const pierre = inserer.run('A2', 'DURAND', 'Pierre', chef, 1, 20).lastInsertRowid;
const partie = inserer.run('A3', 'NOEL', 'Sophie', chef, 1, 18).lastInsertRowid;
const administrative = inserer.run('B1', 'ROUX', 'Claire', null, 0, 21).lastInsertRowid;
db.prepare('UPDATE salaries SET actif = 0 WHERE id = ?').run(partie);

let semaine = 20;
function ficheNeuve() {
  semaine += 1;
  return F.obtenirOuCreerFicheSemaine(chef, 2026, semaine);
}

function ligneDe({ salarieId, nom, minutes = 420 }) {
  return {
    salarie_id: salarieId,
    nom_affiche: nom,
    minutes_route: 0,
    minutes_trajet: 0,
    jours_zone: 0,
    type_masque: '',
    nb_gd72: 0,
    nb_gd80: 0,
    observation: '',
    jours: [0, 1, 2, 3, 4, 5, 6].map((j) => ({ jour: j, minutes: j <= 4 ? minutes : 0, code_absence: '', saisi: 1 })),
  };
}

const enregistrer = (id, lignes) => F.enregistrerFiche(id, { lignes }, utilisateur).fiche;
const journalDe = (ficheId) =>
  db.prepare("SELECT detail FROM journal WHERE fiche_id = ? AND action = 'identite_corrigee'").get(ficheId);

/* ------------------------------------------------------------------------- */

test('un couple nom + numero coherent passe sans etre touche', () => {
  const fiche = ficheNeuve();
  const apres = enregistrer(fiche.id, [ligneDe({ salarieId: paul, nom: 'MARTIN Paul' })]);

  assert.equal(apres.lignes[0].salarie_id, paul);
  assert.equal(apres.lignes[0].nom_affiche, 'MARTIN Paul');
  assert.equal(journalDe(fiche.id), undefined, 'rien a signaler');
});

/*
 * Le scenario de l'audit : on affiche Pierre, on envoie le numero de Paul. La
 * fiche montrait Pierre et la paie prenait le matricule et le taux de Paul.
 */
test('un nom qui ne correspond pas au numero est retabli depuis le registre', () => {
  const fiche = ficheNeuve();
  const apres = enregistrer(fiche.id, [ligneDe({ salarieId: paul, nom: 'DURAND Pierre' })]);

  assert.equal(apres.lignes[0].salarie_id, paul);
  assert.equal(apres.lignes[0].nom_affiche, 'MARTIN Paul', 'le registre tranche, pas l ecran');

  const trace = journalDe(fiche.id);
  assert.ok(trace, 'l ecart se lit au journal');
  assert.match(trace.detail, /DURAND Pierre/);
  assert.match(trace.detail, /MARTIN Paul/);
});

/*
 * Le point qui compte vraiment : ce que la paie recoit. Ecran et paie doivent
 * designer la meme personne, sans quoi l'erreur reste invisible jusqu'au
 * bulletin.
 */
test('la paie et la fiche ne peuvent plus designer deux personnes differentes', () => {
  const fiche = ficheNeuve();
  enregistrer(fiche.id, [ligneDe({ salarieId: paul, nom: 'DURAND Pierre', minutes: 480 })]);
  db.prepare("UPDATE fiches SET statut = 'validee' WHERE id = ?").run(fiche.id);

  const mois = M.agregerMois(2026, 5);
  const ligne = mois.salaries.find((s) => s.matricule === 'A1');
  assert.ok(ligne, 'les heures partent bien sous le matricule du numero envoye');
  assert.equal(ligne.nom, 'MARTIN');
  assert.equal(ligne.tauxHoraire, 15, 'et a son taux');
  assert.ok(
    !mois.salaries.some((s) => s.nom_affiche === 'DURAND Pierre'),
    'plus personne ne s appelle Pierre dans ce tableau'
  );
});

test('un numero inconnu n est pas suivi : la ligne redevient un nom libre', () => {
  const fiche = ficheNeuve();
  const apres = enregistrer(fiche.id, [ligneDe({ salarieId: 999999, nom: 'INCONNU Jean' })]);

  assert.equal(apres.lignes[0].salarie_id, null);
  assert.equal(apres.lignes[0].nom_affiche, 'INCONNU Jean', 'ses heures ne disparaissent pas pour autant');
  assert.match(journalDe(fiche.id).detail, /inconnu/);
});

test('un salarie sorti de l effectif ne se rattache plus', () => {
  const fiche = ficheNeuve();
  const apres = enregistrer(fiche.id, [ligneDe({ salarieId: partie, nom: 'NOEL Sophie' })]);
  assert.equal(apres.lignes[0].salarie_id, null);
});

/*
 * Le personnel non productif a son propre calendrier et son propre tableau de
 * paie. Le laisser se rattacher a une fiche de chantier le ferait compter deux
 * fois.
 */
test('un salarie du personnel non productif n a rien a faire sur une fiche de chantier', () => {
  const fiche = ficheNeuve();
  const apres = enregistrer(fiche.id, [ligneDe({ salarieId: administrative, nom: 'ROUX Claire' })]);
  assert.equal(apres.lignes[0].salarie_id, null, 'pas de rattachement possible');
});

/*
 * Un renfort saisi a la main n'a pas de numero, et c'est legitime : le chef
 * pointe quelqu'un qui n'est pas encore au registre. Le controle ne doit pas
 * lui interdire de travailler.
 */
test('un nom libre, sans numero, reste un nom libre', () => {
  const fiche = ficheNeuve();
  const apres = enregistrer(fiche.id, [ligneDe({ salarieId: null, nom: 'RENFORT Untel' })]);

  assert.equal(apres.lignes[0].salarie_id, null);
  assert.equal(apres.lignes[0].nom_affiche, 'RENFORT Untel');
  assert.equal(journalDe(fiche.id), undefined, 'ce n est pas un ecart');
});

/*
 * Corriger l'orthographe d'un nom au registre doit se propager, et ne surtout
 * pas passer pour un changement de personne : c'est le meme homme.
 */
test('le nom corrige au registre se retablit sur la fiche, sans changer de personne', () => {
  const fiche = ficheNeuve();
  enregistrer(fiche.id, [ligneDe({ salarieId: pierre, nom: 'DURAND Pierre' })]);
  db.prepare("UPDATE salaries SET nom = 'DURANT' WHERE id = ?").run(pierre);

  const apres = enregistrer(fiche.id, [ligneDe({ salarieId: pierre, nom: 'DURAND Pierre' })]);
  assert.equal(apres.lignes[0].nom_affiche, 'DURANT Pierre');
  assert.equal(apres.lignes[0].salarie_id, pierre);

  db.prepare("UPDATE salaries SET nom = 'DURAND' WHERE id = ?").run(pierre);
});

/*
 * Et le garde-fou deja en place, qu'on verifie encore : une ligne videe ne
 * garde pas le numero de celui qui l'occupait. Sans lui, le suivant qu'on y
 * inscrirait heriterait de son identite.
 */
test('vider un nom detache le numero de salarie', () => {
  const fiche = ficheNeuve();
  enregistrer(fiche.id, [ligneDe({ salarieId: paul, nom: 'MARTIN Paul' })]);
  const apres = enregistrer(fiche.id, [ligneDe({ salarieId: paul, nom: '' })]);
  assert.equal(apres.lignes[0].salarie_id, null);
});
