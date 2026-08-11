'use strict';

/*
 * Ce que chaque ecran charge au demarrage, et ce qui appelle l'attention du chef.
 *
 * Extrait de server/index.js, qui les portait toutes : une modification du
 * calendrier n'a plus a faire ouvrir un fichier de treize cents lignes. Les
 * routes n'ont pas change — ni leur ordre, ni leur contenu.
 */

const express = require('express');

const { db } = require('../db');
const D = require('../domaine');
const F = require('../fiches');
const A = require('../auth');
const { VERSION } = require('./commun');

const routes = express.Router();

/* ------------------------------- References ------------------------------- */

routes.get('/api/reference', A.exigerConnexion, (req, res) => {
  const maintenant = new Date();
  const { annee, semaine } = D.semaineISO(maintenant);
  res.json({
    jours: D.JOURS,
    joursCourts: D.JOURS_COURTS,
    codesAbsence: D.CODES_ABSENCE,
    typesMasque: D.TYPES_MASQUE,
    semaineCourante: { annee, semaine },
    nbLignes: F.NB_LIGNES_FICHE,
    version: VERSION,
    // Un chef d equipe n a pas a connaitre la liste de ses collegues chefs.
    chefs:
      req.utilisateur.role === 'directeur'
        ? db.prepare("SELECT id, nom FROM utilisateurs WHERE role = 'chef' AND actif = 1 ORDER BY nom").all()
        : [],
    // L equipe rattachee, chef compris : c'est elle qui pre-remplit la fiche.
    equipe:
      req.utilisateur.role === 'chef'
        ? F.equipeDuChef(req.utilisateur.id)
        : db
            .prepare('SELECT id, nom, prenom, matricule, chef_id FROM salaries WHERE actif = 1 AND productif = 1 ORDER BY nom')
            .all(),
    // Tout l effectif : un chantier reunit souvent des operateurs venus d autres
    // equipes, et le chef doit pouvoir les pointer sans passer par le directeur.
    effectif: db
      .prepare('SELECT id, nom, prenom, matricule FROM salaries WHERE actif = 1 AND productif = 1 ORDER BY nom, prenom')
      .all(),
    // Le parc : le chef choisit une immatriculation, le reste se remplit seul.
    vehicules: db
      .prepare('SELECT id, immatriculation, marque, modele, motorisation FROM vehicules WHERE actif = 1 ORDER BY immatriculation')
      .all(),
    zonesDeplacement: D.ZONES_DEPLACEMENT,
    // Le chef choisit lui-meme qui doit viser sa fiche : il lui faut la liste.
    conducteurs: db
      .prepare("SELECT id, nom FROM utilisateurs WHERE role = 'conducteur' AND actif = 1 ORDER BY nom")
      .all(),
    conducteurParDefaut: req.utilisateur.conducteur_id || null,
  });
});

/*
 * Ce qui appelle l'attention du chef d'equipe, sur son ecran d'accueil.
 *
 * Une fiche renvoyee, il le voyait deja en l'ouvrant. Une fiche corrigee par le
 * conducteur, non : elle poursuivait sa route vers la direction sans qu'il sache
 * qu'on avait touche a son pointage. Or ce sont ses operateurs qui ont signe, et
 * c'est lui qu'on interrogera si un montant surprend.
 */
routes.get('/api/mes-notifications', A.exigerConnexion, (req, res) => {
  if (req.utilisateur.role !== 'chef') return res.json({ corrections: [], renvoyees: [] });

  const corrections = db
    .prepare(
      `SELECT j.detail, j.horodatage, u.nom AS auteur,
              f.id AS fiche_id, f.annee, f.semaine, f.chantier
         FROM journal j
         JOIN fiches f ON f.id = j.fiche_id
         LEFT JOIN utilisateurs u ON u.id = j.user_id
        WHERE j.action = 'correction_conducteur' AND f.chef_id = ?
          AND j.horodatage >= datetime('now', '-45 days')
        ORDER BY j.id DESC LIMIT 20`
    )
    .all(req.utilisateur.id);

  const renvoyees = db
    .prepare(
      `SELECT id, annee, semaine, chantier, motif_rejet
         FROM fiches WHERE chef_id = ? AND statut = 'rejetee'
        ORDER BY annee DESC, semaine DESC LIMIT 20`
    )
    .all(req.utilisateur.id);

  res.json({ corrections, renvoyees });
});

module.exports = routes;
