'use strict';

/*
 * Le cycle de vie d'une fiche : ouvrir, saisir, transmettre, corriger, valider.
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
const V = require('../visa');
const AL = require('../alerte');
const C = require('../courriel');
const { asyncRoute, repondre } = require('./commun');

const routes = express.Router();

/* --------------------------------- Fiches --------------------------------- */

routes.get('/api/fiches', A.exigerConnexion, (req, res) => {
  const filtres = {
    annee: req.query.annee,
    semaine: req.query.semaine,
    statut: req.query.statut,
    chefId: req.utilisateur.role === 'chef' ? req.utilisateur.id : req.query.chef,
  };
  res.json({ fiches: F.listerFiches(filtres) });
});

routes.post('/api/fiches/semaine', A.exigerConnexion, (req, res) => {
  const annee = Number(req.body.annee);
  const semaine = Number(req.body.semaine);
  if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
    return res.status(400).json({ erreur: 'Annee invalide.' });
  }
  if (!Number.isInteger(semaine) || semaine < 1 || semaine > 53) {
    return res.status(400).json({ erreur: 'Numero de semaine invalide (1 a 53).' });
  }
  const chefId = req.utilisateur.role === 'directeur' && req.body.chefId
    ? Number(req.body.chefId)
    : req.utilisateur.id;
  if (req.utilisateur.role === 'directeur' && !req.body.chefId) {
    return res.status(400).json({ erreur: "Precisez le chef d equipe concerne." });
  }
  const fiche = F.obtenirOuCreerFicheSemaine(chefId, annee, semaine);
  // Les autres chantiers de la semaine, pour que le chef puisse passer de l'un
  // a l'autre : il en a une par chantier, une seule le plus souvent.
  res.json({ fiche, fichesSemaine: F.fichesDeLaSemaine(chefId, annee, semaine) });
});

/*
 * Un second chantier dans la meme semaine.
 *
 * La base l'autorisait depuis le debut — son unicite porte sur le chef, la
 * semaine ET le chantier — mais rien ne permettait de l'ouvrir. Un chef qui
 * tenait deux chantiers devait donc tout entasser sur une feuille, ce que la
 * fiche papier n'a jamais demande.
 */
routes.post('/api/fiches/semaine/chantier', A.exigerConnexion, (req, res) => {
  const annee = Number(req.body.annee);
  const semaine = Number(req.body.semaine);
  if (!Number.isInteger(annee) || !Number.isInteger(semaine) || semaine < 1 || semaine > 53) {
    return res.status(400).json({ erreur: 'Semaine invalide.' });
  }
  const chefId =
    req.utilisateur.role === 'directeur' && req.body.chefId ? Number(req.body.chefId) : req.utilisateur.id;
  if (req.utilisateur.role === 'directeur' && !req.body.chefId) {
    return res.status(400).json({ erreur: "Precisez le chef d equipe concerne." });
  }

  const resultat = F.ouvrirFicheSupplementaire(chefId, annee, semaine, req.body.chantier);
  if (resultat.erreur) return repondre(res, resultat);
  res.json({ fiche: resultat.fiche, fichesSemaine: F.fichesDeLaSemaine(chefId, annee, semaine) });
});


routes.get('/api/fiches/:id', A.exigerConnexion, (req, res) => {
  const fiche = F.obtenirFiche(Number(req.params.id));
  if (!fiche) return res.status(404).json({ erreur: 'Fiche introuvable.' });
  if (req.utilisateur.role === 'chef' && fiche.chef_id !== req.utilisateur.id) {
    return res.status(403).json({ erreur: 'Cette fiche appartient a un autre chef d equipe.' });
  }
  const options = F.optionsControle(fiche);
  fiche.anomalies = D.controlerFiche(fiche, fiche.lignes, options);
  /*
   * Ce qui est pointe ailleurs dans la semaine part avec la fiche : le chef
   * travaille sur chantier, souvent sans reseau, et ses controles doivent etre
   * ceux du serveur. Sans cela il verrait s'afficher des oublis pour des
   * journees deja pointees sur son autre chantier, jusqu'au prochain envoi.
   */
  fiche.ailleurs = options.ailleurs;
  fiche.journal = db
    .prepare(
      `SELECT j.action, j.detail, j.horodatage, u.nom AS auteur
         FROM journal j LEFT JOIN utilisateurs u ON u.id = j.user_id
        WHERE j.fiche_id = ? ORDER BY j.id DESC LIMIT 50`
    )
    .all(fiche.id);
  res.json({ fiche });
});

routes.put('/api/fiches/:id', A.exigerConnexion, (req, res) => {
  const resultat = F.enregistrerFiche(Number(req.params.id), req.body, req.utilisateur);
  if (resultat.fiche) {
    const options = F.optionsControle(resultat.fiche);
    resultat.anomalies = D.controlerFiche(resultat.fiche, resultat.fiche.lignes, options);
    resultat.fiche.ailleurs = options.ailleurs;
  }
  repondre(res, resultat);
});

routes.post(
  '/api/fiches/:id/soumettre',
  A.exigerConnexion,
  asyncRoute(async (req, res) => {
    const resultat = F.soumettre(Number(req.params.id), req.utilisateur);
    if (resultat.erreur) return repondre(res, resultat);

    // La fiche part au conducteur de travaux pour visa. L'envoi ne conditionne
    // pas la transmission : une adresse fausse ou un serveur muet ne doit pas
    // faire perdre au chef d'equipe le travail qu'il vient de rendre.
    const visa = await V.envoyerDemandeVisa(Number(req.params.id));
    res.json({
      ...resultat,
      fiche: F.obtenirFiche(Number(req.params.id)),
      visa: resumeVisa(visa),
    });
  })
);

/**
 * Ce qu'on peut dire de l'envoi.
 *
 * `alerte` accompagne toujours la reponse : c'est un message tout pret, sans
 * aucun lien, que le chef d'equipe envoie de son telephone pour prevenir le
 * conducteur — il lui rappelle d'ouvrir ses fiches, rien de plus. Il n'y a plus
 * de lien a distribuer : le conducteur se connecte.
 */
function resumeVisa(visa) {
  if (!visa || visa.erreur) return { demande: false };
  if (!visa.conducteur) return { demande: false, raison: visa.raison || 'aucun_conducteur' };

  const complete = visa.fiche ? F.obtenirFiche(visa.fiche.id) : null;
  const lignes = complete ? complete.lignes.filter((l) => String(l.nom_affiche || '').trim()) : [];

  return {
    demande: true,
    conducteur: visa.conducteur.nom,
    courriel: visa.conducteur.courriel,
    envoye: Boolean(visa.courriel && visa.courriel.envoye),
    raison: visa.courriel ? visa.courriel.raison : undefined,
    alerte: complete
      ? AL.alerteVisa({
          fiche: complete,
          conducteur: visa.conducteur,
          chefNom: complete.chef_nom,
          nbSalaries: lignes.length,
          totalMinutes: lignes.reduce((t, l) => t + (l.total_minutes || 0), 0),
        })
      : null,
  };
}

/**
 * Relance du conducteur, a la main du directeur. Le lien est renvoye avec la
 * reponse : quand aucun serveur d'envoi n'est configure, c'est ce qui permet de
 * le transmettre soi-meme plutot que de rester bloque.
 */
routes.post(
  '/api/fiches/:id/relancer-visa',
  A.exigerDirecteur,
  asyncRoute(async (req, res) => {
    const visa = await V.envoyerDemandeVisa(Number(req.params.id), { relance: true });
    if (visa.erreur) return repondre(res, visa);
    res.json({ visa: resumeVisa(visa), fiche: F.obtenirFiche(Number(req.params.id)) });
  })
);

/*
 * Le chef reprend sa fiche pour la corriger, sans passer par la direction.
 * Le visa en cours est annule : voir F.reprendre.
 */
routes.post('/api/fiches/:id/reprendre', A.exigerConnexion, (req, res) => {
  repondre(res, F.reprendre(Number(req.params.id), req.utilisateur));
});

routes.post('/api/fiches/:id/decision', A.exigerDirecteur, (req, res) => {
  repondre(res, F.statuer(Number(req.params.id), req.utilisateur, req.body.decision, req.body.motif));
});

/*
 * L'historique d'une fiche : ses versions validees, et ce que chacun y a change.
 *
 * C'est ce qu'on ouvre quand un montant est conteste. Le chef d'equipe y a droit
 * pour sa propre fiche — ce sont ses operateurs qui ont signe, et c'est lui
 * qu'on interrogera en premier.
 */
routes.get('/api/fiches/:id/historique', A.exigerConnexion, (req, res) => {
  const id = Number(req.params.id);
  const fiche = db.prepare('SELECT id, chef_id, version FROM fiches WHERE id = ?').get(id);
  if (!fiche) return res.status(404).json({ erreur: 'Fiche introuvable.' });
  if (!A.voitToutLePointage(req.utilisateur) && fiche.chef_id !== req.utilisateur.id) {
    return res.status(403).json({ erreur: 'Cette fiche appartient a un autre chef d equipe.' });
  }

  const journal = db
    .prepare(
      `SELECT j.action, j.detail, j.horodatage, u.nom AS auteur
         FROM journal j
         LEFT JOIN utilisateurs u ON u.id = j.user_id
        WHERE j.fiche_id = ? ORDER BY j.id`
    )
    .all(id);

  res.json({ version: fiche.version || 1, versions: F.versionsDeLaFiche(id), journal });
});

/*
 * Le contenu d'une version archivee : la fiche telle qu'elle a ete validee.
 *
 * Elle porte les signatures : elle ne sort donc que pour la direction et pour le
 * chef de la fiche, comme la fiche elle-meme.
 */
routes.get('/api/fiches/:id/versions/:version', A.exigerConnexion, (req, res) => {
  const id = Number(req.params.id);
  const fiche = db.prepare('SELECT id, chef_id FROM fiches WHERE id = ?').get(id);
  if (!fiche) return res.status(404).json({ erreur: 'Fiche introuvable.' });
  if (!A.voitToutLePointage(req.utilisateur) && fiche.chef_id !== req.utilisateur.id) {
    return res.status(403).json({ erreur: 'Cette fiche appartient a un autre chef d equipe.' });
  }

  const archivee = F.versionArchivee(id, req.params.version);
  if (!archivee) return res.status(404).json({ erreur: 'Version introuvable.' });
  res.json({ fiche: archivee });
});

module.exports = routes;
