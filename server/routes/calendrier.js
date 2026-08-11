'use strict';

/*
 * Les presences vues au mois, et le registre des conges.
 *
 * Extrait de server/index.js, qui les portait toutes : une modification du
 * calendrier n'a plus a faire ouvrir un fichier de treize cents lignes. Les
 * routes n'ont pas change — ni leur ordre, ni leur contenu.
 */

const express = require('express');

const { journaliser } = require('../db');
const D = require('../domaine');
const F = require('../fiches');
const A = require('../auth');
const I = require('../indicateurs');
const CAL = require('../calendrier');
const { repondre, DEBUT_SERVICE } = require('./commun');

const routes = express.Router();

/* -------------------------- Calendrier d'un chef --------------------------- */

/**
 * Toutes les semaines de l'annee avec l'etat de la fiche correspondante, pour
 * que le chef d'equipe voie d'un coup ce qui lui reste a faire. Les semaines
 * sans fiche ressortent "manquante" — ou "avenir" si elles ne sont pas encore
 * arrivees, une semaine future n'etant pas un retard, ou "horsPerimetre" si
 * elles precedent la mise en service.
 */
routes.get('/api/calendrier', A.exigerConnexion, (req, res) => {
  const courante = D.semaineISO(new Date());
  const annee = Number(req.query.annee) || courante.annee;
  if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
    return res.status(400).json({ erreur: 'Annee invalide.' });
  }

  const chefId = req.utilisateur.role === 'chef' ? req.utilisateur.id : Number(req.query.chef);
  if (!chefId) return res.status(400).json({ erreur: "Precisez le chef d equipe concerne." });

  const fiches = F.listerFiches({ annee, chefId });
  const parSemaine = new Map(fiches.map((f) => [f.semaine, f]));

  const semaines = [];
  for (let s = 1; s <= D.nombreSemainesISO(annee); s += 1) {
    const fiche = parSemaine.get(s) || null;
    const dates = D.datesDeLaSemaine(annee, s);
    const future = annee > courante.annee || (annee === courante.annee && s > courante.semaine);
    const avantService = D.semaineAvantService(dates[6], DEBUT_SERVICE);
    semaines.push({
      semaine: s,
      debut: dates[0],
      fin: dates[6],
      // Rattachee au mois de son jeudi, comme la norme ISO : la semaine 1 se
      // range ainsi en janvier meme quand son lundi tombe en decembre.
      mois: Number(dates[3].slice(5, 7)),
      courante: annee === courante.annee && s === courante.semaine,
      // Une fiche existante prime : si quelqu un a saisi une semaine anterieure
      // a la mise en service, son travail reste visible.
      etat: fiche ? fiche.statut : avantService ? 'horsPerimetre' : future ? 'avenir' : 'manquante',
      fiche,
    });
  }

  const compter = (etat) => semaines.filter((s) => s.etat === etat).length;
  res.json({
    annee,
    semaineCourante: courante,
    debutService: DEBUT_SERVICE,
    delaiJours: I.DELAI_ATTENDU_JOURS,
    semaines,
    totaux: {
      manquante: compter('manquante'),
      brouillon: compter('brouillon'),
      soumise: compter('soumise'),
      rejetee: compter('rejetee'),
      validee: compter('validee'),
    },
  });
});

/* --------------------- Calendrier mensuel de la direction ------------------ */

/**
 * Le mois, personne par personne et jour par jour.
 *
 * Reserve a la direction : chaque ligne dit ou etait chaque salarie, ce qu'aucun
 * chef d'equipe n'a a savoir de l'equipe d'un autre.
 */
routes.get('/api/calendrier-mensuel', A.exigerDirecteurOuConducteur, (req, res) => {
  const annee = Number(req.query.annee);
  const mois = Number(req.query.mois);
  if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
    return res.status(400).json({ erreur: 'Annee invalide.' });
  }
  if (!Number.isInteger(mois) || mois < 1 || mois > 12) {
    return res.status(400).json({ erreur: 'Mois invalide (1 a 12).' });
  }
  res.json({
    ...CAL.moisComplet(annee, mois, { debutService: DEBUT_SERVICE }),
    codesAbsence: D.CODES_ABSENCE,
    motifsConge: CAL.MOTIFS_CONGE,
  });
});

routes.get('/api/conges', A.exigerDirecteurOuConducteur, (req, res) => {
  res.json({ conges: CAL.listerConges({ depuis: req.query.depuis || null }), motifs: CAL.MOTIFS_CONGE });
});

routes.post('/api/conges', A.exigerDirecteur, (req, res) => {
  const resultat = CAL.enregistrerConge(req.body || {});
  if (!resultat.erreur) {
    journaliser(null, req.utilisateur.id, 'conge_ajoute', `${req.body.salarie_id} ${req.body.debut}->${req.body.fin}`);
  }
  repondre(res, resultat);
});

routes.delete('/api/conges/:id', A.exigerDirecteur, (req, res) => {
  repondre(res, CAL.supprimerConge(req.params.id));
});

module.exports = routes;
