'use strict';

/*
 * Ce que les routes partagent, et rien de plus.
 *
 * Trois fonctions de trois lignes, mais elles decident de la forme des reponses
 * de toute l'API : les recopier dans chaque module aurait suffi a ce qu'elles
 * divergent, et une erreur renvoyee differemment selon la route est exactement
 * ce qu'on ne veut pas debusquer un jour de mise en service.
 */

const D = require('../domaine');

const VERSION = require('../../package.json').version;

/*
 * Avant cette date le pointage se faisait sur papier : ni le calendrier ni les
 * indicateurs ne reclament ces semaines-la. Se regle par DEBUT_SERVICE=AAAA-MM-JJ
 * si la mise en service glisse.
 *
 * Partage entre le calendrier et les indicateurs : deux dates de mise en service
 * qui ne seraient pas la meme rendraient les deux ecrans incoherents.
 */
const DEBUT_SERVICE = process.env.DEBUT_SERVICE || D.DEBUT_SERVICE_PAR_DEFAUT;

/**
 * Rend la reponse d'une fonction metier : `{ erreur, code }` devient un statut
 * HTTP, tout le reste part tel quel. Les fonctions metier ne connaissent ainsi
 * ni `res` ni les codes HTTP — elles disent ce qui s'est passe, pas comment le
 * transmettre.
 */
function repondre(res, resultat) {
  if (resultat.erreur) {
    return res.status(resultat.code || 400).json({ erreur: resultat.erreur, anomalies: resultat.anomalies });
  }
  return res.json(resultat);
}

/**
 * Une route asynchrone dont le rejet part au gestionnaire d'erreurs. Sans cela,
 * une promesse rejetee dans une route Express 4 ne remonte nulle part : la
 * requete reste ouverte jusqu'a expiration, et rien n'est journalise.
 */
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Un nom de fichier telechargeable, sans rien qui puisse surprendre un systeme. */
function nomFichier(base) {
  return base.replace(/[^A-Za-z0-9_.-]/g, '_');
}

module.exports = { repondre, asyncRoute, nomFichier, VERSION, DEBUT_SERVICE };
