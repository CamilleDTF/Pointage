'use strict';

/*
 * Le personnel qui ne figure sur aucune fiche de chantier : calendrier, primes, paie.
 *
 * Extrait de server/index.js, qui les portait toutes : une modification du
 * calendrier n'a plus a faire ouvrir un fichier de treize cents lignes. Les
 * routes n'ont pas change — ni leur ordre, ni leur contenu.
 */

const express = require('express');

const { db } = require('../db');
const D = require('../domaine');
const A = require('../auth');
const XNP = require('../export-non-productif');
const CAL = require('../calendrier');
const NP = require('../non-productif');
const { asyncRoute, nomFichier, repondre } = require('./commun');

const routes = express.Router();

/* ------------------- Calendrier du personnel non productif ----------------- */

/*
 * Ils sont a 7 h par jour ouvre : ce sont les ecarts qui se saisissent, pas les
 * journees. Une absence, un grand deplacement, une prime — le reste se deduit.
 */
routes.get('/api/non-productif', A.exigerDirecteur, (req, res) => {
  const maintenant = new Date();
  const annee = Number(req.query.annee) || maintenant.getFullYear();
  const mois = Number(req.query.mois) || maintenant.getMonth() + 1;
  if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
    return res.status(400).json({ erreur: 'Annee invalide.' });
  }
  if (!Number.isInteger(mois) || mois < 1 || mois > 12) {
    return res.status(400).json({ erreur: 'Mois invalide (1 a 12).' });
  }
  res.json({ ...NP.moisComplet(annee, mois), codesAbsence: D.CODES_ABSENCE, motifsConge: CAL.MOTIFS_CONGE });
});

routes.put('/api/non-productif/jour', A.exigerDirecteur, (req, res) => {
  repondre(
    res,
    NP.declarerJour(
      {
        salarieId: req.body.salarie_id,
        date: req.body.date,
        code: req.body.code,
        gd: req.body.gd,
        minutes: req.body.minutes,
      },
      req.utilisateur
    )
  );
});

routes.post('/api/non-productif/primes', A.exigerDirecteur, (req, res) => {
  repondre(
    res,
    NP.ajouterPrime(
      {
        salarieId: req.body.salarie_id,
        annee: req.body.annee,
        mois: req.body.mois,
        libelle: req.body.libelle,
        montant: req.body.montant,
      },
      req.utilisateur
    )
  );
});

routes.delete('/api/non-productif/primes/:id', A.exigerDirecteur, (req, res) => {
  repondre(res, NP.supprimerPrime(req.params.id));
});

/*
 * Le tableau mensuel de paie du personnel non productif.
 *
 * Meme protection que celui des chantiers : les montants ne s'ouvrent jamais sur
 * la seule foi d'une session. Le code du directeur s'echange contre un billet a
 * usage unique, consomme des la premiere requete.
 */
routes.get('/api/non-productif/paie', A.exigerDirecteur, (req, res) => {
  const annee = Number(req.query.annee);
  const mois = Number(req.query.mois);
  if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
    return res.status(400).json({ erreur: 'Annee invalide.' });
  }
  if (!Number.isInteger(mois) || mois < 1 || mois > 12) {
    return res.status(400).json({ erreur: 'Mois invalide (1 a 12).' });
  }
  if (!A.consommerBilletPaie(req, req.query.billet)) {
    return res.status(403).json({ erreur: 'Les montants demandent votre code directeur.', codeDemande: true });
  }

  res.json(NP.paieDuMois(annee, mois));
});

/* Le meme tableau, en classeur. Il porte les memes montants, donc le meme billet. */
routes.get(
  '/api/export/non-productif.xlsx',
  A.exigerDirecteur,
  asyncRoute(async (req, res) => {
    const annee = Number(req.query.annee);
    const mois = Number(req.query.mois);
    if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
      return res.status(400).json({ erreur: 'Annee invalide.' });
    }
    if (!Number.isInteger(mois) || mois < 1 || mois > 12) {
      return res.status(400).json({ erreur: 'Mois invalide (1 a 12).' });
    }
    if (!A.consommerBilletPaie(req, req.query.billet)) {
      return res.status(403).json({ erreur: 'Les montants demandent votre code directeur.', codeDemande: true });
    }

    const buffer = await XNP.exporterPaieNonProductif(NP.paieDuMois(annee, mois));
    const nom = nomFichier(`paie_non_productif_${annee}_${String(mois).padStart(2, '0')}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
    res.send(Buffer.from(buffer));
  })
);

/*
 * Le personnel non productif se gere comme l'effectif de chantier, dans son
 * propre onglet : meme table, meme matricule, meme taux horaire.
 *
 * Tenir ce registre — inscrire quelqu'un, corriger un matricule — releve de
 * l'administration. Lire son taux horaire releve du salaire : c'est la meme
 * requete, ce ne sont pas les memes yeux, et la colonne tombe avant de partir.
 */
routes.get('/api/admin/non-productifs', A.exigerAdministration, (req, res) => {
  const salaries = db
    .prepare('SELECT * FROM salaries WHERE productif = 0 ORDER BY nom, prenom')
    .all();
  res.json({
    salaries: A.estAdmin(req)
      ? salaries.map(({ taux_horaire, ...reste }) => reste)
      : salaries,
  });
});

module.exports = routes;
