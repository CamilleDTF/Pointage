'use strict';

/*
 * Ce qui porte des montants : exports, tableau mensuel, billets.
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
const X = require('../export');
const XM = require('../export-mensuel');
const M = require('../mensuel');
const T = require('../taux');
const { asyncRoute } = require('./commun');

const routes = express.Router();

/* -------------------------------- Exports --------------------------------- */

function nomFichier(base) {
  return base.replace(/[^A-Za-z0-9_.-]/g, '_');
}

routes.get(
  '/api/export/fiche/:id.xlsx',
  A.exigerConnexion,
  asyncRoute(async (req, res) => {
    const fiche = F.obtenirFiche(Number(req.params.id));
    if (!fiche) return res.status(404).json({ erreur: 'Fiche introuvable.' });
    if (req.utilisateur.role === 'chef' && fiche.chef_id !== req.utilisateur.id) {
      return res.status(403).json({ erreur: 'Acces refuse.' });
    }
    const buffer = await X.exporterFiche(fiche);
    const nom = nomFichier(`S${String(fiche.semaine).padStart(2, '0')}_${fiche.chantier || 'chantier'}_${fiche.annee}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
    res.send(Buffer.from(buffer));
  })
);

routes.get(
  '/api/export/periode.xlsx',
  A.exigerDirecteur,
  asyncRoute(async (req, res) => {
    const filtres = {
      annee: req.query.annee,
      semaine: req.query.semaine,
      statut: req.query.statut || 'validee',
    };
    const lignes = F.lignesPourExport(filtres);
    const avecFiches = req.query.fiches !== '0';
    const fiches = avecFiches
      ? F.listerFiches(filtres).map((f) => F.obtenirFiche(f.id))
      : [];
    const buffer = await X.exporterPeriode(lignes, fiches);
    const suffixe = filtres.semaine ? `S${String(filtres.semaine).padStart(2, '0')}` : 'toutes-semaines';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${nomFichier(`pointage_${filtres.annee || ''}_${suffixe}.xlsx`)}"`
    );
    res.send(Buffer.from(buffer));
  })
);

routes.get(
  '/api/export/mois.xlsx',
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

    // La version direction porte les salaires : chaque telechargement consomme
    // son propre billet, donc redemande le code.
    const version = req.query.version === 'direction' ? 'direction' : 'public';
    if (version === 'direction' && !A.consommerBilletPaie(req, req.query.billet)) {
      return res.status(403).json({ erreur: 'Les montants demandent votre code directeur.', codeDemande: true });
    }

    const donnees = M.agregerMois(annee, mois, { statut: req.query.statut || 'validee' });
    const buffer = await XM.exporterMois(donnees, { version, taux: T.tauxDuMois(annee, mois) });
    const nom = nomFichier(
      `pointage_mensuel_${annee}_${String(mois).padStart(2, '0')}_${version}.xlsx`
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
    res.send(Buffer.from(buffer));
  })
);

/* ------------------------- Tableau mensuel a l'ecran ----------------------- */

/*
 * Le meme tableau que le classeur, mais consultable directement. Deux versions :
 *
 *  - "public"    : heures, majorations, jours de zone, paniers, grands
 *                  deplacements. Aucun montant, aucun taux horaire.
 *  - "direction" : la meme chose plus la valorisation. Elle exige que le
 *                  directeur ait ressaisi son code, meme si sa session est
 *                  ouverte : une session dure trente jours, un salaire affiche
 *                  sur un ecran partage n'attend pas si longtemps.
 */
routes.post('/api/paie/billet', A.exigerDirecteur, (req, res) => {
  const cle = `${req.ip}|paie|${req.utilisateur.id}`;
  if (A.tropDeTentatives(cle)) {
    return res.status(429).json({ erreur: 'Trop de tentatives. Reessayez dans 15 minutes.' });
  }
  const u = db.prepare('SELECT pin_hash FROM utilisateurs WHERE id = ?').get(req.utilisateur.id);
  if (!A.verifierPin(String(req.body.pin || ''), u.pin_hash)) {
    A.enregistrerEchec(cle);
    return res.status(401).json({ erreur: 'Code incorrect.' });
  }
  A.reinitialiserTentatives(cle);
  // Un seul usage : consulter puis telecharger redemande le code.
  res.json({ billet: A.delivrerBilletPaie(req.utilisateur) });
});

routes.get('/api/mois', A.exigerDirecteur, (req, res) => {
  const annee = Number(req.query.annee);
  const mois = Number(req.query.mois);
  if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
    return res.status(400).json({ erreur: 'Annee invalide.' });
  }
  if (!Number.isInteger(mois) || mois < 1 || mois > 12) {
    return res.status(400).json({ erreur: 'Mois invalide (1 a 12).' });
  }

  const demandee = req.query.version === 'direction' ? 'direction' : 'public';
  if (demandee === 'direction' && !A.consommerBilletPaie(req, req.query.billet)) {
    return res.status(403).json({ erreur: 'Les montants demandent votre code directeur.', codeDemande: true });
  }

  const donnees = M.agregerMois(annee, mois, { statut: req.query.statut || 'validee' });
  // Les taux du MOIS demande, pas ceux d'aujourd'hui : rejouer un mois passe
  // doit redonner ce qui avait ete paye.
  const bareme = T.tauxDuMois(annee, mois);

  const salaries = donnees.salaries.map((s) => {
    const commun = {
      nom: s.nom,
      prenom: s.prenom,
      matricule: s.matricule,
      chantiers: s.chantiers,
      semaines: s.semaines.map((x) => x.minutesTotal),
      minutesMois: s.minutesMois,
      minutes25: s.minutes25,
      minutes50: s.minutes50,
      minutesRoute: s.minutesRoute,
      minutesTrajet: s.minutesTrajet,
      joursAmiante1: s.joursAmiante1,
      joursAmiante2: s.joursAmiante2,
      joursPanier: s.joursPanier,
      joursTravailles: s.joursTravailles,
      joursGD72: s.joursGD72,
      joursGD80: s.joursGD80,
      joursFeries: s.joursFeries,
      minutesFeries: s.minutesFeries,
    };
    return demandee === 'direction' ? { ...commun, ...M.valoriser(s, { taux: bareme }) } : commun;
  });

  res.json({
    annee,
    mois,
    version: demandee,
    montantPanier: bareme.panier_repas,
    // Horaire de reference du mois, la case "Mois" du classeur de paie.
    joursOuvres: D.joursOuvresDuMois(annee, mois),
    heuresReference: D.heuresReferenceMois(annee, mois),
    semaines: donnees.semaines.map((s) => ({ annee: s.annee, semaine: s.semaine, debut: s.dates[0] })),
    salaries,
  });
});

/** Ce que contiendra l'export mensuel, pour l'annoncer avant de le telecharger. */
routes.get('/api/export/mois-apercu', A.exigerDirecteur, (req, res) => {
  const annee = Number(req.query.annee);
  const mois = Number(req.query.mois);
  if (!Number.isInteger(annee) || !Number.isInteger(mois) || mois < 1 || mois > 12) {
    return res.status(400).json({ erreur: 'Période invalide.' });
  }
  const donnees = M.agregerMois(annee, mois, { statut: req.query.statut || 'validee' });
  res.json({
    annee,
    mois,
    semaines: donnees.semaines.map((s) => ({ annee: s.annee, semaine: s.semaine, debut: s.dates[0] })),
    nbSalaries: donnees.salaries.length,
    minutes: donnees.salaries.reduce((s, x) => s + x.minutesMois, 0),
  });
});

routes.get('/api/export/periode.csv', A.exigerDirecteur, (req, res) => {
  const lignes = F.lignesPourExport({
    annee: req.query.annee,
    semaine: req.query.semaine,
    statut: req.query.statut || 'validee',
  });
  const suffixe = req.query.semaine ? `S${String(req.query.semaine).padStart(2, '0')}` : 'toutes-semaines';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${nomFichier(`pointage_${req.query.annee || ''}_${suffixe}.csv`)}"`
  );
  res.send(X.exporterCsv(lignes));
});

module.exports = routes;
