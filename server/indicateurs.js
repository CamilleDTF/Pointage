'use strict';

/*
 * Indicateurs de suivi des chefs d'equipe.
 *
 * Ils repondent a trois questions que le directeur se pose chaque mois : qui
 * rend ses fiches, qui les rend a temps, et qui les rend justes. Rien n'est
 * calcule sur les semaines anterieures a la mise en service : elles etaient
 * pointees sur papier, les compter comme des oublis serait mensonger.
 *
 * Une precision sur la lecture : ces chiffres decrivent un circuit
 * administratif, pas des personnes. Un chef sur un chantier isole rendra
 * naturellement plus tard qu'un autre. Ils servent a savoir qui relancer, pas a
 * classer.
 */

const { db } = require('./db');
const D = require('./domaine');

/*
 * Delai attendu, en jours apres le dimanche de la semaine pointee.
 *
 * 1 = le lundi qui suit, la regle de la maison. Une fiche transmise le lundi est
 * donc a l'heure ; a partir du mardi, elle est hors delai. Se regle par
 * DELAI_TRANSMISSION_JOURS si la consigne change.
 */
const DELAI_ATTENDU_JOURS = Number(process.env.DELAI_TRANSMISSION_JOURS) || 1;

/** Nombre de semaines attendues d'un chef entre la mise en service et aujourd'hui. */
function semainesAttendues(debutService, maintenant = new Date()) {
  const debut = new Date(`${debutService}T00:00:00Z`);
  if (Number.isNaN(debut.getTime())) return [];

  const courante = D.semaineISO(maintenant);
  const attendues = [];
  const curseur = new Date(debut);

  // On s'arrete a la semaine precedente : celle en cours n'est pas en retard.
  for (let garde = 0; garde < 520; garde += 1) {
    const { annee, semaine } = D.semaineISO(
      new Date(curseur.getUTCFullYear(), curseur.getUTCMonth(), curseur.getUTCDate())
    );
    const passee = annee < courante.annee || (annee === courante.annee && semaine < courante.semaine);
    if (!passee) break;
    // Une semaine a cheval sur la mise en service compte des lors que son
    // dimanche tombe apres la bascule.
    const dates = D.datesDeLaSemaine(annee, semaine);
    if (!D.semaineAvantService(dates[6], debutService)) attendues.push({ annee, semaine, fin: dates[6] });
    curseur.setUTCDate(curseur.getUTCDate() + 7);
  }
  return attendues;
}

/** Ecart en jours entre la fin de la semaine pointee et la transmission. */
function retardEnJours(finSemaine, soumiseLe) {
  if (!soumiseLe) return null;
  const fin = new Date(`${finSemaine}T00:00:00Z`);
  const envoi = new Date(`${String(soumiseLe).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(fin.getTime()) || Number.isNaN(envoi.getTime())) return null;
  return Math.round((envoi - fin) / 86400000);
}

const moyenne = (valeurs) =>
  valeurs.length ? Math.round((valeurs.reduce((s, v) => s + v, 0) / valeurs.length) * 10) / 10 : null;

/**
 * Un enregistrement par chef d'equipe actif. `assiduite` est la part des
 * semaines attendues effectivement transmises ; `retardMoyen` compte les jours
 * ecoules entre le dimanche de la semaine et l'envoi ; `tauxRejet` la part des
 * fiches renvoyees pour correction.
 */
function indicateursChefs(debutService, maintenant = new Date()) {
  const attendues = semainesAttendues(debutService, maintenant);
  const cles = new Set(attendues.map((s) => `${s.annee}-${s.semaine}`));
  const finParCle = new Map(attendues.map((s) => [`${s.annee}-${s.semaine}`, s.fin]));

  const chefs = db
    .prepare("SELECT id, nom FROM utilisateurs WHERE role = 'chef' AND actif = 1 ORDER BY nom")
    .all();

  const fiches = db
    .prepare(
      `SELECT f.chef_id, f.annee, f.semaine, f.statut, f.soumise_le,
              (SELECT COUNT(*) FROM journal j
                WHERE j.fiche_id = f.id AND j.action = 'rejet') AS nb_rejets
         FROM fiches f`
    )
    .all();

  return chefs.map((chef) => {
    const siennes = fiches.filter((f) => f.chef_id === chef.id && cles.has(`${f.annee}-${f.semaine}`));
    const transmises = siennes.filter((f) => f.statut !== 'brouillon');

    const retards = transmises
      .map((f) => retardEnJours(finParCle.get(`${f.annee}-${f.semaine}`), f.soumise_le))
      .filter((v) => v !== null);

    const rejetees = siennes.filter((f) => f.nb_rejets > 0).length;

    return {
      chef_id: chef.id,
      nom: chef.nom,
      semainesAttendues: attendues.length,
      fichesTransmises: transmises.length,
      fichesValidees: siennes.filter((f) => f.statut === 'validee').length,
      enRetard: attendues.length - transmises.length,
      assiduite: attendues.length ? Math.round((transmises.length / attendues.length) * 100) : null,
      retardMoyen: moyenne(retards),
      retardMax: retards.length ? Math.max(...retards) : null,
      // Hors delai : transmise apres le lundi qui suit la semaine pointee.
      horsDelai: retards.filter((r) => r > DELAI_ATTENDU_JOURS).length,
      // Part des fiches rendues a temps. Plus parlante qu'un decompte brut :
      // trois retards sur trois fiches ne se lisent pas comme trois sur vingt.
      ponctualite: retards.length
        ? Math.round((retards.filter((r) => r <= DELAI_ATTENDU_JOURS).length / retards.length) * 100)
        : null,
      fichesRenvoyees: rejetees,
      tauxRejet: transmises.length ? Math.round((rejetees / transmises.length) * 100) : null,
    };
  });
}

module.exports = { indicateursChefs, semainesAttendues, retardEnJours, DELAI_ATTENDU_JOURS };
