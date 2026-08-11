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
  res.json({ utilisateur: { id: utilisateur.id, nom: utilisateur.nom, role: utilisateur.role } });
});

routes.post('/api/deconnexion', (req, res) => {
  A.fermerSession(res);
  res.json({ ok: true });
});

routes.get('/api/moi', (req, res) => {
  if (!req.utilisateur) return res.status(401).json({ erreur: 'Non connecte.', sessionExpiree: true });
  res.json({ utilisateur: req.utilisateur });
});

routes.post('/api/mon-code', A.exigerConnexion, (req, res) => {
  const actuel = String(req.body.actuel || '');
  const nouveau = String(req.body.nouveau || '');
  if (!/^\d{4,8}$/.test(nouveau)) {
    return res.status(400).json({ erreur: 'Le nouveau code doit comporter 4 a 8 chiffres.' });
  }
  const u = db.prepare('SELECT pin_hash FROM utilisateurs WHERE id = ?').get(req.utilisateur.id);
  if (!A.verifierPin(actuel, u.pin_hash)) return res.status(401).json({ erreur: 'Code actuel incorrect.' });
  db.prepare('UPDATE utilisateurs SET pin_hash = ? WHERE id = ?').run(A.hacherPin(nouveau), req.utilisateur.id);

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

module.exports = routes;
