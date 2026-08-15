'use strict';

/*
 * Ce qui porte des montants : exports, tableau mensuel, billets.
 *
 * Extrait de server/index.js, qui les portait toutes : une modification du
 * calendrier n'a plus a faire ouvrir un fichier de treize cents lignes. Les
 * routes n'ont pas change — ni leur ordre, ni leur contenu.
 */

const express = require('express');

const { db, journaliser } = require('../db');
const D = require('../domaine');
const F = require('../fiches');
const A = require('../auth');
const X = require('../export');
const XM = require('../export-mensuel');
const M = require('../mensuel');
const T = require('../taux');
const COFFRE = require('../coffre');
const REPRISE = require('../reprise');
const { asyncRoute, autoriserMontants } = require('./commun');

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
    let cleCoffre = null;
    if (version === 'direction') {
      const ouvert = autoriserMontants(req, res);
      if (!ouvert) return undefined;
      cleCoffre = ouvert.cle;
    }

    const donnees = M.agregerMois(annee, mois, { statut: req.query.statut || 'validee', cleCoffre });
    const buffer = await XM.exporterMois(donnees, { version, taux: T.tauxDuMois(annee, mois, cleCoffre) });
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
 * Ouvrir les montants : le code, ou la phrase du coffre.
 *
 * Tant que le coffre n'existe pas, rien ne change : le code est redemande, et
 * il donne un billet a usage unique. Une fois le coffre cree, ce n'est plus une
 * autorisation qu'on demande mais une CLE — sans elle, les montants ne sont pas
 * refuses, ils sont illisibles, y compris pour le serveur.
 *
 * Elle ouvre alors une seance de quinze minutes plutot qu'un billet unique :
 * une phrase longue retapee entre l'affichage et le telechargement du meme
 * tableau serait un peage, pas une protection. La cle vit en memoire, disparait
 * a l'echeance, et n'est jamais ecrite sur le disque.
 */
/* ------------------------------- Le coffre -------------------------------- */

/*
 * L'etat du coffre, pour l'ecran qui propose de le creer.
 *
 * `resteDuClair` n'est pas decoratif : une promesse d'etancheite se verifie. Il
 * compte ce qui traine encore en clair dans le fichier, et l'ecran l'affiche —
 * zero, ou la liste de ce qui reste a basculer.
 */
routes.get('/api/coffre', A.exigerDirecteur, (req, res) => {
  const c = COFFRE.etat();
  res.json({
    existe: Boolean(c),
    creeLe: c ? c.cree_le : null,
    montantsEnClair: COFFRE.resteDuClair(),
    seanceOuverte: Boolean(COFFRE.cleDeSeance(req.get('X-Seance-Paie'), req.utilisateur.id)),
    dureeSeanceMs: COFFRE.DUREE_SEANCE_MS,
  });
});

/*
 * Creer le coffre : le seul moment ou la cle de secours existe en clair.
 *
 * Elle est renvoyee ici, une fois, et n'est stockee nulle part — seule son
 * enveloppe l'est. La rendre a nouveau serait impossible sans la garder, et la
 * garder reviendrait a poser la cle sous le paillasson.
 *
 * Le chiffrement de l'existant suit immediatement, dans la foulee : un coffre
 * cree sur des donnees restees en clair ne protegerait rien, il donnerait juste
 * le sentiment du contraire.
 */
routes.post('/api/coffre', A.exigerDirecteur, (req, res) => {
  const resultat = COFFRE.creer(req.body.phrase);
  if (resultat.erreur) return res.status(resultat.code || 400).json({ erreur: resultat.erreur });

  const bascule = COFFRE.chiffrerExistant(resultat.cle);
  journaliser(null, req.utilisateur.id, 'coffre_cree', JSON.stringify(bascule));

  /*
   * La question de reprise part avec le coffre, quand elle est fournie.
   *
   * Cette route l'acceptait sans l'enregistrer : le coffre se creait, et
   * « Retrouver son code » repondait ensuite qu'aucune question n'existait —
   * sans que rien, au moment de la creation, n'ait laisse entendre qu'elle
   * avait ete ignoree. Le seul filet de securite du directeur tombait en
   * silence. « Mise en service » la posait deja ; ici, elle etait perdue.
   */
  const question = String(req.body.question || '').trim();
  const reponse = String(req.body.reponse || '').trim();
  let repriseRefusee = null;
  if (question && reponse) {
    const pose = REPRISE.poser(
      { question, reponse, actuel: req.body.pin || req.body.actuel },
      req.utilisateur
    );
    /*
     * Un refus ne s'avale pas.
     *
     * `poser` exige le code actuel : sans lui, la question est rejetee. Ignorer
     * ce rejet laissait le coffre se creer avec, pour le directeur, la
     * conviction d'avoir pose son filet de securite — et « Retrouver son code »
     * repondait ensuite qu'aucune question n'existait. Le coffre est cree, on
     * ne revient pas dessus ; mais on dit ce qui n'a pas suivi.
     */
    if (pose.erreur) repriseRefusee = pose.erreur;
  }

  return res.json({
    secours: resultat.secours,
    repriseRefusee,
    bascule,
    montantsEnClair: COFFRE.resteDuClair(),
    seance: COFFRE.ouvrirSeance(resultat.cle, req.utilisateur.id),
    dureeMs: COFFRE.DUREE_SEANCE_MS,
  });
});

/*
 * Changer la phrase. La cle de donnees ne bouge pas : on remplace une
 * enveloppe, pas des milliers de valeurs — et la cle de secours imprimee reste
 * valable, ce qui evite d'avoir a la reimprimer a chaque changement.
 */
routes.post('/api/coffre/phrase', A.exigerDirecteur, (req, res) => {
  const ouvert = autoriserMontants(req, res);
  if (!ouvert) return undefined;
  const resultat = COFFRE.changerPhrase(ouvert.cle, req.body.nouvelle);
  if (resultat.erreur) return res.status(resultat.code || 400).json({ erreur: resultat.erreur });
  journaliser(null, req.utilisateur.id, 'coffre_phrase_changee', '');
  return res.json({ ok: true });
});

routes.post('/api/paie/billet', A.exigerDirecteur, (req, res) => {
  const cle = `${req.ip}|paie|${req.utilisateur.id}`;
  if (A.tropDeTentatives(cle)) {
    return res.status(429).json({ erreur: 'Trop de tentatives. Reessayez dans 15 minutes.' });
  }

  if (COFFRE.existe()) {
    const cleCoffre = COFFRE.deverrouiller({ phrase: req.body.phrase, secours: req.body.secours });
    if (!cleCoffre) {
      A.enregistrerEchec(cle);
      return res.status(401).json({ erreur: 'Phrase incorrecte.' });
    }
    A.reinitialiserTentatives(cle);
    journaliser(null, req.utilisateur.id, 'coffre_ouvert', 'seance de paie ouverte');
    return res.json({
      seance: COFFRE.ouvrirSeance(cleCoffre, req.utilisateur.id),
      dureeMs: COFFRE.DUREE_SEANCE_MS,
    });
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
  let cleCoffre = null;
  if (demandee === 'direction') {
    const ouvert = autoriserMontants(req, res);
    if (!ouvert) return undefined;
    cleCoffre = ouvert.cle;
  }

  const donnees = M.agregerMois(annee, mois, { statut: req.query.statut || 'validee', cleCoffre });
  // Les taux du MOIS demande, pas ceux d'aujourd'hui : rejouer un mois passe
  // doit redonner ce qui avait ete paye.
  const bareme = T.tauxDuMois(annee, mois, cleCoffre);

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

  /*
   * Combien de fiches du mois ne sont PAS validees.
   *
   * L'apercu disait ce que l'export contiendrait ; il ne disait pas ce qu'il
   * laisserait dehors. Or le tableau ne compte que les fiches validees : on
   * pouvait transmettre un mois ampute de trois fiches sans rien voir. Ce
   * nombre-la est le seul qui previenne avant, plutot qu'apres.
   */
  const semaines = donnees.semaines.map((s) => `${s.annee}-${String(s.semaine).padStart(2, '0')}`);
  const nonValidees = semaines.length
    ? db
        .prepare(
          `SELECT COUNT(*) AS n FROM fiches
            WHERE statut != 'validee'
              AND (annee || '-' || substr('0' || semaine, -2)) IN (${semaines.map(() => '?').join(',')})`
        )
        .get(...semaines).n
    : 0;

  res.json({
    annee,
    mois,
    semaines: donnees.semaines.map((s) => ({ annee: s.annee, semaine: s.semaine, debut: s.dates[0] })),
    nbSalaries: donnees.salaries.length,
    minutes: donnees.salaries.reduce((s, x) => s + x.minutesMois, 0),
    nonValidees,
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
