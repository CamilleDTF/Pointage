'use strict';

/*
 * Se connecter, se deconnaitre, changer son code.
 *
 * Extrait de server/index.js, qui les portait toutes : une modification du
 * calendrier n'a plus a faire ouvrir un fichier de treize cents lignes. Les
 * routes n'ont pas change — ni leur ordre, ni leur contenu.
 */

const express = require('express');

const { db, journaliser } = require('../db');
const A = require('../auth');

const routes = express.Router();

/* ---------------------------- Authentification ---------------------------- */

routes.post('/api/connexion', (req, res) => {
  const identifiant = String(req.body.identifiant || '').trim().toLowerCase();
  const pin = String(req.body.pin || '');
  const cle = `${req.ip}|${identifiant}`;

  if (A.tropDeTentatives(cle)) {
    return res.status(429).json({ erreur: 'Trop de tentatives. Reessayez dans 15 minutes.' });
  }

  const utilisateur = db
    .prepare('SELECT * FROM utilisateurs WHERE lower(identifiant) = ? AND actif = 1')
    .get(identifiant);

  if (!utilisateur || !A.verifierPin(pin, utilisateur.pin_hash)) {
    A.enregistrerEchec(cle);
    return res.status(401).json({ erreur: 'Identifiant ou code incorrect.' });
  }

  A.reinitialiserTentatives(cle);
  A.ouvrirSession(req, res, utilisateur);
  res.json({
    utilisateur: {
      id: utilisateur.id,
      nom: utilisateur.nom,
      role: utilisateur.role,
      // L'ecran doit conduire au changement, pas seulement le permettre : c'est
      // le serveur qui refuse tout le reste, mais un refus sans explication est
      // une impasse.
      codeProvisoire: Boolean(utilisateur.code_provisoire),
    },
  });
});

routes.post('/api/deconnexion', (req, res) => {
  A.fermerSession(res);
  res.json({ ok: true });
});

routes.get('/api/moi', (req, res) => {
  if (!req.utilisateur) return res.status(401).json({ erreur: 'Non connecte.', sessionExpiree: true });
  res.json({ utilisateur: { ...req.utilisateur, codeProvisoire: Boolean(req.utilisateur.code_provisoire) } });
});

routes.post('/api/mon-code', A.exigerConnexion, (req, res) => {
  const actuel = String(req.body.actuel || '');
  const nouveau = String(req.body.nouveau || '');
  if (!/^\d{4,8}$/.test(nouveau)) {
    return res.status(400).json({ erreur: 'Le nouveau code doit comporter 4 a 8 chiffres.' });
  }
  const u = db.prepare('SELECT pin_hash FROM utilisateurs WHERE id = ?').get(req.utilisateur.id);
  if (!A.verifierPin(actuel, u.pin_hash)) return res.status(401).json({ erreur: 'Code actuel incorrect.' });
  db.prepare('UPDATE utilisateurs SET pin_hash = ?, code_provisoire = 0 WHERE id = ?')
    .run(A.hacherPin(nouveau), req.utilisateur.id);

  /*
   * Changer son code ferme les sessions ouvertes avec l'ancien — c'est tout
   * l'interet du geste quand on le fait parce qu'on craint qu'il ait ete vu.
   * Sauf celle-ci : on rend immediatement une session valable au navigateur qui
   * vient de faire la demarche, sinon il se retrouverait deconnecte par sa
   * propre precaution.
   */
  const generation = A.revoquerSessions(req.utilisateur.id);
  A.ouvrirSession(req, res, { ...req.utilisateur, session_generation: generation });

  journaliser(null, req.utilisateur.id, 'code_change', 'sessions precedentes fermees');
  res.json({ ok: true, sessionsFermees: true });
});

/* ------------------------- La question de reprise ------------------------- */

/*
 * Pourquoi cette porte existe.
 *
 * Depuis qu'un administrateur technique tient l'application, plus personne n'y
 * peut remettre le code d'un directeur : c'est precisement ce qui empeche cet
 * administrateur de prendre l'identite de la direction et d'ouvrir les salaires.
 * Mais fermer cette porte sans en ouvrir une autre reviendrait a dire a la
 * direction « si vous oubliez votre code, l'application est perdue ».
 *
 * D'ou la question de reprise, choisie par la direction elle-meme. Y repondre
 * ne redonne pas l'ancien code — il est hache, il n'existe nulle part en clair —
 * mais ouvre le droit d'en poser un nouveau.
 *
 * Elle n'est proposee qu'aux comptes de direction. Un chef ou un conducteur qui
 * perd son code se le fait remettre par l'administration en trente secondes :
 * lui ouvrir en plus une porte de secours, c'est ajouter une serrure a forcer
 * sans rien resoudre.
 */

const REPRISE_RESERVEE = ['directeur'];

/** Le compte joignable par une reprise, ou rien. Ne dit jamais pourquoi. */
function compteReprise(identifiant) {
  const compte = db
    .prepare('SELECT * FROM utilisateurs WHERE lower(identifiant) = ? AND actif = 1')
    .get(String(identifiant || '').trim().toLowerCase());
  if (!compte || !REPRISE_RESERVEE.includes(compte.role)) return null;
  if (!compte.question_reprise || !compte.reponse_reprise_hash) return null;
  return compte;
}

/** L'etat de ma propre question, pour l'ecran qui la propose. */
routes.get('/api/ma-reprise', A.exigerConnexion, (req, res) => {
  const compte = db
    .prepare('SELECT question_reprise, reprise_le, role FROM utilisateurs WHERE id = ?')
    .get(req.utilisateur.id);
  res.json({
    definie: Boolean(compte.question_reprise),
    question: compte.question_reprise || '',
    poseeLe: compte.reprise_le || null,
    // La direction est la seule a en avoir besoin ; l'ecran s'en sert pour
    // insister aupres d'elle, et se taire aupres des autres.
    recommandee: REPRISE_RESERVEE.includes(compte.role),
  });
});

/*
 * Deposer ou remplacer sa question. Le code actuel est redemande : sans lui, une
 * session restee ouverte sur un poste partage suffirait a se substituer la porte
 * de secours du compte, et a revenir quand on veut.
 */
routes.post('/api/ma-reprise', A.exigerConnexion, (req, res) => {
  const question = String(req.body.question || '').trim();
  const reponse = String(req.body.reponse || '');
  const actuel = String(req.body.actuel || '');

  if (question.length < 8 || question.length > 200) {
    return res.status(400).json({ erreur: 'La question doit comporter 8 a 200 caracteres.' });
  }
  if (A.normaliserReponse(reponse).length < 3) {
    return res.status(400).json({ erreur: 'La reponse doit comporter au moins 3 caracteres.' });
  }

  const compte = db.prepare('SELECT pin_hash FROM utilisateurs WHERE id = ?').get(req.utilisateur.id);
  if (!A.verifierPin(actuel, compte.pin_hash)) {
    return res.status(401).json({ erreur: 'Code actuel incorrect.' });
  }

  db.prepare(
    `UPDATE utilisateurs SET question_reprise = ?, reponse_reprise_hash = ?, reprise_le = datetime('now')
      WHERE id = ?`
  ).run(question, A.hacherReponse(reponse), req.utilisateur.id);

  // La question part au journal, jamais la reponse.
  journaliser(null, req.utilisateur.id, 'reprise_definie', question);
  res.json({ ok: true });
});

/*
 * Premiere etape, depuis l'ecran de connexion : quelle est ma question ?
 *
 * La reponse est volontairement la meme pour un identifiant inconnu, un compte
 * qui n'est pas de la direction, et un directeur sans question — sinon cette
 * route deviendrait un annuaire ou l'on teste des identifiants un par un.
 */
routes.post('/api/reprise/question', (req, res) => {
  const identifiant = String(req.body.identifiant || '').trim().toLowerCase();
  const cle = `reprise|${req.ip}|${identifiant}`;
  if (A.tropDeTentatives(cle)) {
    return res.status(429).json({ erreur: 'Trop de tentatives. Reessayez dans 15 minutes.' });
  }

  const compte = compteReprise(identifiant);
  if (!compte) {
    A.enregistrerEchec(cle);
    return res.json({
      definie: false,
      message: "Aucune question de reprise n'est enregistree pour cet identifiant.",
    });
  }
  res.json({ definie: true, question: compte.question_reprise });
});

/*
 * Seconde etape : la bonne reponse ouvre le droit de poser un nouveau code.
 *
 * Le compteur d'essais est le meme que celui de la connexion — huit tentatives
 * par quart d'heure. Sans lui, une question de reprise serait une seconde
 * serrure, plus faible que la premiere, qu'on pourrait forcer a loisir.
 */
routes.post('/api/reprise/code', (req, res) => {
  const identifiant = String(req.body.identifiant || '').trim().toLowerCase();
  const nouveau = String(req.body.nouveau || '');
  const cle = `reprise|${req.ip}|${identifiant}`;

  if (A.tropDeTentatives(cle)) {
    return res.status(429).json({ erreur: 'Trop de tentatives. Reessayez dans 15 minutes.' });
  }
  if (!/^\d{4,8}$/.test(nouveau)) {
    return res.status(400).json({ erreur: 'Le nouveau code doit comporter 4 a 8 chiffres.' });
  }

  const compte = compteReprise(identifiant);
  if (!compte || !A.verifierReponse(req.body.reponse, compte.reponse_reprise_hash)) {
    A.enregistrerEchec(cle);
    // Le refus ne distingue pas l'identifiant inconnu de la mauvaise reponse.
    if (compte) journaliser(null, compte.id, 'reprise_echouee', 'reponse incorrecte');
    return res.status(401).json({ erreur: 'Reponse incorrecte.' });
  }

  db.prepare('UPDATE utilisateurs SET pin_hash = ?, code_provisoire = 0 WHERE id = ?')
    .run(A.hacherPin(nouveau), compte.id);
  /*
   * Toutes les sessions tombent, y compris celle d'ou partirait un intrus : on
   * passe par ici justement parce qu'on soupconne d'avoir perdu la main sur le
   * compte. Aucune session n'est rendue — la direction se reconnecte avec son
   * nouveau code, ce qui prouve au passage qu'elle l'a bien note.
   */
  A.revoquerSessions(compte.id);
  A.reinitialiserTentatives(cle);
  journaliser(null, compte.id, 'reprise_reussie', 'code repose par question de reprise');
  res.json({ ok: true });
});

module.exports = routes;
