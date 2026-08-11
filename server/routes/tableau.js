'use strict';

/*
 * Le tableau de bord hebdomadaire du directeur.
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

const routes = express.Router();

/* ------------------------- Tableau de bord directeur ----------------------- */

routes.get('/api/tableau', A.exigerDirecteur, (req, res) => {
  const annee = Number(req.query.annee) || D.semaineISO(new Date()).annee;
  const semaine = Number(req.query.semaine) || D.semaineISO(new Date()).semaine;

  const chefs = db.prepare("SELECT id, nom FROM utilisateurs WHERE role = 'chef' AND actif = 1 ORDER BY nom").all();
  const fiches = F.listerFiches({ annee, semaine });
  const parChef = new Map(fiches.map((f) => [f.chef_id, f]));

  res.json({
    annee,
    semaine,
    dates: D.datesDeLaSemaine(annee, semaine),
    suivi: chefs.map((chef) => ({
      chef_id: chef.id,
      chef_nom: chef.nom,
      fiche: parChef.get(chef.id) || null,
      statut: (parChef.get(chef.id) || {}).statut || 'manquante',
    })),
    fiches,
    totaux: {
      salaries: fiches.reduce((s, f) => s + f.nb_salaries, 0),
      minutes: fiches.reduce((s, f) => s + f.total_minutes, 0),
      validees: fiches.filter((f) => f.statut === 'validee').length,
      attendues: chefs.length,
    },
  });
});

module.exports = routes;
