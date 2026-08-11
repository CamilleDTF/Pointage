'use strict';

/*
 * L'espace du conducteur de travaux, et son rattachement.
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
const C = require('../courriel');
const { repondre } = require('./commun');

const routes = express.Router();

/* -------------------- Visa du conducteur de travaux ----------------------- */

/*
 * Les seules routes de l'application ouvertes sans session : le conducteur de
 * travaux n'a pas de compte, il arrive par le lien signe de son courriel.
 *
 * Le GET ne fait que montrer. La decision passe par un POST — un antivirus de
 * messagerie qui visite les liens d'un message viserait sinon les fiches a la
 * place du conducteur.
 */
/* --------------------- Espace du conducteur de travaux --------------------- */

/*
 * Les memes gestes, par compte plutot que par lien signe.
 *
 * Un conducteur connecte est reconnu pour ce qu'il est : il n'a plus besoin
 * qu'on lui envoie un secret par fiche. Son perimetre se lit sur la fiche —
 * celles ou le chef l'a designe — et non sur un rattachement fixe : un chef peut
 * changer de conducteur d'une semaine a l'autre, ou en avoir deux a la fois s'il
 * tient deux chantiers.
 */
function exigerConducteur(req, res, next) {
  if (!req.utilisateur) return res.status(401).json({ erreur: 'Session expiree, reconnectez-vous.', sessionExpiree: true });
  if (req.utilisateur.role !== 'conducteur') {
    return res.status(403).json({ erreur: 'Action reservee au conducteur de travaux.' });
  }
  next();
}

routes.get('/api/conducteur/moi', exigerConducteur, (req, res) => {
  repondre(res, V.tableauConducteur(req.utilisateur));
});

routes.get('/api/visa/fiche/:id', exigerConducteur, (req, res) => {
  const acces = V.ficheDuConducteur(req.utilisateur, req.params.id);
  if (acces.erreur) return res.status(acces.code || 403).json({ erreur: acces.erreur });
  res.json({
    fiche: {
      ...V.vueConducteur(acces.fiche),
      // Il peut corriger tant que la fiche attend son visa, et pas au-dela :
      // une fiche visee ou validee ne se retouche plus de son cote.
      modifiable: acces.fiche.statut === 'soumise' && acces.fiche.visa_statut === 'attente',
    },
    // Ce qu'il faut pour corriger : les codes d'absence, l'effectif pour ajouter
    // quelqu'un, le parc pour designer un vehicule. Aucun montant.
    reference: {
      joursCourts: D.JOURS_COURTS,
      jours: D.JOURS,
      codesAbsence: D.CODES_ABSENCE,
      typesMasque: D.TYPES_MASQUE,
      effectif: db
        .prepare('SELECT id, nom, prenom, matricule FROM salaries WHERE actif = 1 AND productif = 1 ORDER BY nom, prenom')
        .all(),
      vehicules: db
        .prepare('SELECT immatriculation, marque, modele FROM vehicules WHERE actif = 1 ORDER BY immatriculation')
        .all(),
    },
  });
});

/*
 * La correction de la fiche. Le conducteur controle le pointage : lui interdire
 * de rectifier une erreur l'obligerait a renvoyer la fiche entiere au chef pour
 * une virgule. Il la corrige comme son auteur, tant qu'elle attend son visa —
 * la validation finale, elle, reste au directeur.
 */
routes.put('/api/visa/fiche/:id', exigerConducteur, (req, res) => {
  const acces = V.ficheDuConducteur(req.utilisateur, req.params.id);
  if (acces.erreur) return repondre(res, acces);

  const resultat = F.enregistrerFiche(acces.fiche.id, req.body, req.utilisateur);
  if (resultat.fiche) {
    const options = F.optionsControle(resultat.fiche);
    resultat.anomalies = D.controlerFiche(resultat.fiche, resultat.fiche.lignes, options);
    resultat.fiche = { ...V.vueConducteur(resultat.fiche), modifiable: true };
  }
  repondre(res, resultat);
});

routes.post('/api/visa/fiche/:id/decision', exigerConducteur, (req, res) => {
  decider(res, V.ficheDuConducteur(req.utilisateur, req.params.id), req.body, req.utilisateur);
});

/* Viser ou renvoyer : le geste ne depend pas de la facon dont on est arrive. */
function decider(res, acces, corps, utilisateur = null) {
  const decision = corps.decision;
  if (decision === 'viser') return repondre(res, V.viser(acces, corps.commentaire, utilisateur));
  if (decision === 'renvoyer') return repondre(res, V.renvoyer(acces, corps.commentaire, utilisateur));
  res.status(400).json({ erreur: 'Decision inconnue.' });
}

/* ------------------------ Conducteurs de travaux --------------------------- */

/*
 * Les conducteurs sont des comptes comme les autres : ils se creent, se
 * renomment, se desactivent et changent de code par les routes communes
 * `/api/admin/utilisateurs`. Il ne reste ici que ce qui leur est propre — la
 * liste de leur ecran, et le lien personnel qui precede les comptes.
 */
routes.get('/api/admin/conducteurs', A.exigerDirecteur, (req, res) => {
  res.json({
    // Le lien personnel est monte ici : c'est au directeur de le transmettre,
    // jamais au chef d'equipe, qui pourrait sinon viser ses propres fiches.
    conducteurs: db
      .prepare("SELECT * FROM utilisateurs WHERE role = 'conducteur' ORDER BY nom")
      .all()
      .map(({ pin_hash: empreinte, jeton, ...c }) => ({
        ...c,
        // Un compte migre porte une empreinte que personne ne peut retrouver :
        // tant que le directeur n'a pas donne de code, il ne peut pas entrer.
        codeADefinir: !A.codeUtilisable(empreinte),
      })),
    // Qui depend de qui : le rattachement se regle dans le meme ecran.
    chefs: db
      .prepare(
        `SELECT u.id, u.nom, u.conducteur_id, c.nom AS conducteur_nom
           FROM utilisateurs u
           LEFT JOIN utilisateurs c ON c.id = u.conducteur_id
          WHERE u.role = 'chef' AND u.actif = 1 ORDER BY u.nom`
      )
      .all(),
    envoiConfigure: C.ACTIF,
  });
});

routes.put('/api/admin/chefs/:id/conducteur', A.exigerDirecteur, (req, res) => {
  const conducteurId = req.body.conducteur_id ? Number(req.body.conducteur_id) : null;
  db.prepare("UPDATE utilisateurs SET conducteur_id = ? WHERE id = ? AND role = 'chef'")
    .run(conducteurId, Number(req.params.id));
  res.json({ ok: true });
});

module.exports = routes;
