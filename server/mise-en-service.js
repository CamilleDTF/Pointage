'use strict';

/*
 * La mise en service : armer toutes les securites d'un seul geste.
 *
 * Elles se sont ajoutees une par une, chacune avec son ecran et son moment —
 * creer le coffre ici, deposer une question de reprise la, renouveler les codes
 * ailleurs. Tant qu'on essaie l'application, c'est commode de les poser au fur
 * et a mesure. Le jour de la vraie mise en service, c'est un piege : il suffit
 * d'en oublier une pour que tout le reste ne serve a rien, et rien ne dit
 * laquelle manque.
 *
 * Ce module repond a deux questions, et rien d'autre : ou en est-on, et
 * peut-on tout armer maintenant.
 *
 *
 * CE QU'UN BOUTON NE PEUT PAS FAIRE
 *
 * Trois des securites demandent une decision humaine, et aucune automatisation
 * ne la remplace : la phrase du coffre, la question de reprise et sa reponse.
 * Les inventer reviendrait a les connaitre — c'est-a-dire a refaire exactement
 * le trou qu'on vient de boucher. Elles sont donc demandees dans le formulaire,
 * pas generees.
 *
 * Une quatrieme ne depend pas de l'application du tout : le HTTPS tient au
 * deploiement. Elle est CONSTATEE et rapportee, jamais pretendue armee.
 */

const { db, journaliser } = require('./db');
const COFFRE = require('./coffre');
const REPRISE = require('./reprise');

/* ------------------------------ Le constat -------------------------------- */

/** Le coffre est-il en place, et ne reste-t-il rien en clair ? */
function etatCoffre() {
  const existe = COFFRE.existe();
  const enClair = COFFRE.resteDuClair();
  return {
    cle: 'coffre',
    intitule: 'Les montants sont chiffrés dans la base',
    arme: existe && enClair === 0,
    detail: existe
      ? enClair === 0
        ? 'Aucun taux, aucune prime, aucun paramètre ne subsiste en clair.'
        : `${enClair} montant(s) restent lisibles dans le fichier.`
      : 'Une lecture directe de pointage.db livre tous les taux horaires.',
    armable: !existe,
  };
}

/** La direction peut-elle retrouver son code sans passer par personne ? */
function etatReprise() {
  const directeurs = db
    .prepare("SELECT id, nom, question_reprise FROM utilisateurs WHERE role = 'directeur' AND actif = 1")
    .all();
  const sans = directeurs.filter((d) => !d.question_reprise);
  return {
    cle: 'reprise',
    intitule: 'La direction peut retrouver son code seule',
    arme: directeurs.length > 0 && sans.length === 0,
    detail: sans.length
      ? `${sans.length} compte(s) de direction sans question de reprise : un code oublié les enfermerait dehors.`
      : 'Question déposée : un code oublié se rattrape sans administrateur.',
    armable: sans.length > 0,
  };
}

/*
 * Les codes encore poses par quelqu'un d'autre.
 *
 * On compte les comptes marques provisoires — ceux dont le titulaire ne s'est
 * pas encore approprie le code. Les comptes anterieurs a ce marqueur ne sont
 * pas comptes : leur code a pu etre change il y a des mois, et les accuser
 * retrospectivement rendrait le constat faux.
 */
function etatCodes() {
  const provisoires = db
    .prepare('SELECT COUNT(*) AS n FROM utilisateurs WHERE actif = 1 AND code_provisoire = 1')
    .get().n;
  const total = db.prepare('SELECT COUNT(*) AS n FROM utilisateurs WHERE actif = 1').get().n;
  return {
    cle: 'codes',
    intitule: 'Chaque compte a choisi son propre code',
    arme: provisoires === 0,
    detail: provisoires
      ? `${provisoires} compte(s) sur ${total} utilisent encore un code posé par quelqu'un d'autre.`
      : 'Aucun code en attente d’appropriation.',
    // Renouveler les codes est un choix, pas un automatisme : cela oblige tout
    // le monde a en choisir un a la prochaine connexion.
    armable: true,
  };
}

/** Un administrateur technique distinct de la direction existe-t-il ? */
function etatSeparation() {
  const admins = db.prepare("SELECT COUNT(*) AS n FROM utilisateurs WHERE role = 'admin' AND actif = 1").get().n;
  return {
    cle: 'separation',
    intitule: "L'administration est séparée de la direction",
    arme: admins > 0,
    detail: admins
      ? `${admins} compte(s) d'administration, sans accès aux montants.`
      : "Aucun compte d'administration : la direction fait tout, y compris la technique.",
    armable: false,
    facultatif: true,
  };
}

/*
 * Le HTTPS ne s'arme pas depuis l'application : il tient au deploiement. On le
 * constate sur la requete en cours plutot que de le declarer — c'est la seule
 * facon de ne pas mentir, et un « active » affiche a tort serait pire que rien.
 */
function etatChiffrementDuLien(req) {
  const forcee = process.env.COOKIE_SECURE === 'true';
  const transmis = String((req && req.headers['x-forwarded-proto']) || '').split(',')[0].trim();
  const chiffree = Boolean(req && (req.secure || transmis === 'https'));
  return {
    cle: 'https',
    intitule: 'Les codes ne circulent pas en clair',
    arme: chiffree || forcee,
    detail: chiffree
      ? 'Cette page est servie en HTTPS.'
      : forcee
        ? 'COOKIE_SECURE=true est posé, mais cette page arrive en HTTP simple.'
        : 'Connexion en HTTP simple : les codes traversent le réseau en clair.',
    armable: false,
    horsApplication: true,
  };
}

function constater(req) {
  const points = [
    etatCoffre(),
    etatReprise(),
    etatCodes(),
    etatSeparation(),
    etatChiffrementDuLien(req),
  ];
  return {
    points,
    tout: points.every((p) => p.arme || p.facultatif),
    restantArmable: points.filter((p) => !p.arme && p.armable).map((p) => p.cle),
  };
}

/* ------------------------------- L'action --------------------------------- */

/**
 * Arme ce qui peut l'etre, en une fois.
 *
 * Volontairement non transactionnel d'un bout a l'autre : creer le coffre
 * chiffre des milliers de valeurs et rend une cle de secours qu'on ne peut pas
 * « annuler » proprement. On execute donc dans l'ordre du plus lourd au plus
 * leger, et on rapporte ce qui a ete fait — un rapport honnete vaut mieux qu'un
 * tout-ou-rien qui laisserait croire a un retour en arriere impossible.
 */
function armer({ phrase, question, reponse, actuel, renouvelerLesCodes }, utilisateur) {
  const fait = [];
  let secours = null;
  let seance = null;

  if (!COFFRE.existe()) {
    if (!phrase) return { erreur: 'La phrase du coffre est nécessaire pour armer les montants.', code: 400 };
    const cree = COFFRE.creer(phrase);
    if (cree.erreur) return cree;
    const bascule = COFFRE.chiffrerExistant(cree.cle);
    secours = cree.secours;
    seance = COFFRE.ouvrirSeance(cree.cle, utilisateur.id);
    fait.push(
      `Coffre créé : ${bascule.taux} taux, ${bascule.primes} prime(s) et ${bascule.parametres} paramètre(s) chiffrés.`
    );
    journaliser(null, utilisateur.id, 'coffre_cree', JSON.stringify(bascule));
  }

  if (question || reponse) {
    const pose = REPRISE.poser({ question, reponse, actuel }, utilisateur);
    if (pose.erreur) return pose;
    fait.push('Question de reprise déposée.');
  }

  /*
   * Renouveler les codes en dernier, et jamais celui de qui appuie : se
   * verrouiller soi-meme au milieu de sa propre mise en service serait une
   * facon particulierement penible de decouvrir que le bouton fonctionne.
   */
  if (renouvelerLesCodes) {
    const r = db
      .prepare('UPDATE utilisateurs SET code_provisoire = 1 WHERE actif = 1 AND id != ?')
      .run(utilisateur.id);
    if (r.changes) {
      fait.push(`${r.changes} compte(s) devront choisir un nouveau code à leur prochaine connexion.`);
      journaliser(null, utilisateur.id, 'codes_renouveles', `${r.changes} comptes`);
    }
  }

  return { ok: true, fait, secours, seance, dureeMs: COFFRE.DUREE_SEANCE_MS };
}

module.exports = { constater, armer };
