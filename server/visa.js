'use strict';

/*
 * Visa du conducteur de travaux.
 *
 * Le conducteur vise avant la direction, depuis son compte. Il voit les fiches
 * ou un chef l'a designe, les relit, corrige les heures s'il le faut, puis vise
 * ou renvoie au chef avec un commentaire.
 *
 * Tout cela passait auparavant par des liens signes envoyes par courriel : le
 * conducteur n'avait pas de compte, et un secret par fiche lui tenait lieu
 * d'identite. Ce detour a disparu avec les comptes, et c'est un soulagement —
 * un secret qui circule est un secret qui s'egare, et un jeton prouve un droit
 * sans jamais dire qui l'exerce. Le journal peut desormais nommer qui a vise.
 */

const { db, journaliser } = require('./db');
const D = require('./domaine');
const F = require('./fiches');
const C = require('./courriel');

const { conducteurDeLaFiche } = F;

/**
 * Ouvre une demande de visa : nouveau secret, courriel au conducteur.
 *
 * Sans conducteur rattache, la fiche part directement au directeur — l'etape ne
 * doit pas bloquer un chef d'equipe dont l'organisation n'est pas encore
 * parametree.
 */
function demanderVisa(ficheId, { relance = false } = {}) {
  const fiche = db.prepare('SELECT * FROM fiches WHERE id = ?').get(ficheId);
  if (!fiche) return { erreur: 'Fiche introuvable.', code: 404 };

  const conducteur = conducteurDeLaFiche(fiche);
  if (!conducteur) {
    db.prepare("UPDATE fiches SET visa_statut = '' WHERE id = ?").run(ficheId);
    return { visa: null, raison: 'aucun_conducteur' };
  }

  db.prepare(
    `UPDATE fiches SET visa_statut = 'attente', visa_le = NULL,
            visa_courriel = ?, visa_commentaire = '', visa_envoye_le = datetime('now')
      WHERE id = ?`
  ).run(conducteur.courriel, ficheId);

  journaliser(ficheId, null, relance ? 'relance_visa' : 'demande_visa', `${conducteur.nom} <${conducteur.courriel}>`);
  return { conducteur, fiche };
}

/** L'adresse a laquelle les conducteurs joignent l'application. */
function adressePublique() {
  const adresse = process.env.ADRESSE_PUBLIQUE || process.env.URL_PUBLIQUE;
  return String(adresse || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
}

async function envoyerDemandeVisa(ficheId, options = {}) {
  const ouverture = demanderVisa(ficheId, options);
  if (ouverture.erreur || !ouverture.conducteur) return ouverture;

  const complete = F.obtenirFiche(ficheId);
  const lignes = complete.lignes.filter((l) => String(l.nom_affiche || '').trim());
  const message = C.messageVisa({
    fiche: complete,
    lignes,
    conducteur: ouverture.conducteur,
    chefNom: complete.chef_nom,
    lien: ouverture.lien,
  });

  const resultat = await C.envoyer({ destinataire: ouverture.conducteur.courriel, ...message });
  return { ...ouverture, courriel: resultat };
}

/* ------------------------------ Cote conducteur ---------------------------- */

/*
 * La fiche qu'un conducteur a le droit d'ouvrir.
 *
 * Son perimetre se lit sur la fiche : celles ou le chef l'a designe. C'est la
 * meme regle que `conducteurDeLaFiche` — ce qu'il voit est exactement ce qu'il
 * doit viser, ni plus ni moins. Un rattachement fixe ne saurait pas le dire :
 * un chef peut changer de conducteur d'une semaine a l'autre, ou en avoir deux
 * a la fois quand il tient deux chantiers.
 */
function ficheDuConducteur(conducteur, ficheId) {
  if (!conducteur || conducteur.role !== 'conducteur') return { erreur: 'Acces reserve.', code: 403 };

  const fiche = F.obtenirFiche(Number(ficheId));
  if (!fiche) return { erreur: 'Fiche introuvable.', code: 404 };

  const sien = conducteurDeLaFiche(fiche);
  if (!sien || sien.id !== conducteur.id) {
    return { erreur: 'Cette fiche ne releve pas de vous.', code: 403 };
  }
  return { fiche };
}

/**
 * Ce que voit le conducteur : la fiche, sans rien qui depasse son objet. Ni les
 * autres semaines, ni les autres chefs, ni le moindre montant.
 */
function vueConducteur(fiche) {
  const conducteur = conducteurDeLaFiche(fiche);
  return {
    id: fiche.id,
    annee: fiche.annee,
    semaine: fiche.semaine,
    dates: fiche.dates,
    chantier: fiche.chantier,
    ville: fiche.ville,
    conducteur_vehicule: fiche.conducteur_vehicule,
    type_vehicule: fiche.type_vehicule,
    immatriculation: fiche.immatriculation,
    observations_pointage: fiche.observations_pointage,
    commentaire_responsable: fiche.commentaire_responsable,
    nom_responsable: fiche.nom_responsable,
    chef_nom: fiche.chef_nom,
    statut: fiche.statut,
    visa_statut: fiche.visa_statut,
    visa_le: fiche.visa_le,
    visa_commentaire: fiche.visa_commentaire,
    total_minutes: fiche.total_minutes,
    conducteur_nom: conducteur ? conducteur.nom : '',
    /*
     * Toutes les lignes, y compris les vides : le conducteur peut ajouter une
     * personne oubliee par le chef, et il lui faut une ligne libre pour cela.
     */
    lignes: fiche.lignes
      .map((l) => ({
        // L'identifiant sert au conducteur a designer la ligne qu'il corrige :
        // l'ordre affiche ne fait pas foi.
        id: l.id,
        nom_affiche: l.nom_affiche,
        jours: l.jours.map((j) => ({ jour: j.jour, minutes: j.minutes, code_absence: j.code_absence, saisi: j.saisi })),
        total_minutes: l.total_minutes,
        minutes_route: l.minutes_route,
        minutes_trajet: l.minutes_trajet,
        jours_zone: l.jours_zone,
        type_masque: l.type_masque,
        nb_gd72: l.nb_gd72,
        nb_gd80: l.nb_gd80,
        nb_deplacement: l.nb_deplacement,
        observation: l.observation,
        salarie_id: l.salarie_id,
        signature: l.signature ? true : false, // presence seulement : pas l'image
      })),
  };
}

/*
 * Le conducteur vise : la fiche poursuit sa route vers le directeur.
 *
 * `acces` est deja resolu par l'appelant — par jeton signe ou par compte. Le
 * geste est le meme dans les deux cas ; seule la facon de prouver qui l'on est
 * change, et elle n'a rien a faire ici.
 */
function viser(acces, commentaire = '', utilisateur = null) {
  if (acces.erreur) return acces;
  const fiche = acces.fiche;

  if (fiche.visa_statut === 'vise') return { deja: true, fiche: vueConducteur(F.obtenirFiche(fiche.id)) };
  if (fiche.statut !== 'soumise') {
    return { erreur: 'Cette fiche n attend plus de visa.', code: 409 };
  }

  const conducteur = conducteurDeLaFiche(fiche);
  db.prepare(
    `UPDATE fiches SET visa_statut = 'vise', visa_le = datetime('now'),
            visa_conducteur = ?, visa_commentaire = ?, maj_le = datetime('now')
      WHERE id = ?`
  ).run(conducteur ? conducteur.nom : '', String(commentaire || '').trim().slice(0, 1000), fiche.id);

  journaliser(fiche.id, utilisateur ? utilisateur.id : null, 'visa_conducteur', conducteur ? conducteur.nom : '');
  return { fiche: vueConducteur(F.obtenirFiche(fiche.id)) };
}

/** Le conducteur renvoie : la fiche repart au chef, avec son commentaire. */
function renvoyer(acces, commentaire, utilisateur = null) {
  if (acces.erreur) return acces;
  const fiche = acces.fiche;

  const motif = String(commentaire || '').trim();
  if (!motif) return { erreur: 'Indiquez ce qui doit etre corrige.', code: 400 };
  if (fiche.statut !== 'soumise') return { erreur: 'Cette fiche n attend plus de visa.', code: 409 };

  const conducteur = conducteurDeLaFiche(fiche);
  const signature = conducteur ? `${conducteur.nom} (conducteur de travaux)` : 'Conducteur de travaux';

  db.prepare(
    `UPDATE fiches SET statut = 'rejetee', motif_rejet = ?, visa_statut = '',
            visa_commentaire = ?, validee_le = NULL, validee_par = NULL, maj_le = datetime('now')
      WHERE id = ?`
  ).run(`${signature} : ${motif}`.slice(0, 1000), motif.slice(0, 1000), fiche.id);

  journaliser(fiche.id, utilisateur ? utilisateur.id : null, 'renvoi_conducteur', motif.slice(0, 1000));
  return { renvoyee: true, fiche: vueConducteur(F.obtenirFiche(fiche.id)) };
}

/* ---------------------- Tableau de bord du conducteur --------------------- */

/*
 * Ses fiches : celles qui attendent son visa, puis celles qu'il a deja visees.
 */
function tableauConducteur(conducteur, { historique = 60 } = {}) {
  const enAttente = db
    .prepare(
      `SELECT f.id, f.annee, f.semaine, f.chantier, f.ville, f.visa_envoye_le, u.nom AS chef_nom,
              (SELECT COUNT(*) FROM fiche_lignes l
                WHERE l.fiche_id = f.id AND TRIM(l.nom_affiche) <> '') AS nb_salaries,
              (SELECT COALESCE(SUM(j.minutes), 0) FROM fiche_jours j
                 JOIN fiche_lignes l2 ON l2.id = j.ligne_id
                WHERE l2.fiche_id = f.id) AS total_minutes
         FROM fiches f
         JOIN utilisateurs u ON u.id = f.chef_id
        WHERE f.statut = 'soumise' AND f.visa_statut = 'attente'
          AND COALESCE(f.conducteur_id, u.conducteur_id) = ?
        ORDER BY f.annee DESC, f.semaine DESC`
    )
    .all(conducteur.id);

  const recentes = db
    .prepare(
      `SELECT f.id, f.annee, f.semaine, f.chantier, f.visa_le, f.statut, u.nom AS chef_nom
         FROM fiches f
         JOIN utilisateurs u ON u.id = f.chef_id
        WHERE f.visa_statut = 'vise'
          AND COALESCE(f.conducteur_id, u.conducteur_id) = @id
        ORDER BY f.visa_le DESC LIMIT @limite`
    )
    .all({ id: conducteur.id, limite: historique });

  /*
   * Ce qui n'est PAS arrive.
   *
   * Le conducteur ne voyait que les fiches qu'on lui avait transmises : une
   * semaine ou un chef n'envoie rien est une semaine ou son ecran reste vide,
   * et rien ne distingue « tout est vise » de « personne n'a rien fait ». Or
   * relancer un chef qui a oublie est precisement son role.
   *
   * On regarde les chefs qui lui sont rattaches — le rattachement par defaut,
   * `u.conducteur_id` — et l'on retire ceux dont la fiche de la semaine est
   * partie. Un chef qui a designe quelqu'un d'autre cette semaine-la ne le
   * regarde pas : sa fiche est chez l'autre.
   */
  const courante = D.semaineISO(new Date());
  const manquantes = db
    .prepare(
      `SELECT u.id AS chef_id, u.nom AS chef_nom,
              (SELECT statut FROM fiches f
                WHERE f.chef_id = u.id AND f.annee = @annee AND f.semaine = @semaine
                ORDER BY f.id DESC LIMIT 1) AS statut
         FROM utilisateurs u
        WHERE u.role = 'chef' AND u.actif = 1 AND u.conducteur_id = @id
        ORDER BY u.nom`
    )
    .all({ id: conducteur.id, annee: courante.annee, semaine: courante.semaine })
    .filter((c) => !c.statut || ['brouillon', 'rejetee'].includes(c.statut))
    .map((c) => ({
      ...c,
      // « Rien de saisi » et « commencee mais pas transmise » n'appellent pas
      // la meme relance : on le dit plutot que de les confondre.
      etat: c.statut === 'brouillon' ? 'commencee' : c.statut === 'rejetee' ? 'renvoyee' : 'manquante',
    }));

  return {
    conducteur: { nom: conducteur.nom },
    semaine: { annee: courante.annee, semaine: courante.semaine },
    enAttente: enAttente.map((f) => ({
      ...f,
      lien: `/visa.html?fiche=${f.id}`,
    })),
    manquantes,
    recentes: recentes.map((f) => ({ ...f, lien: `/visa.html?fiche=${f.id}` })),
  };
}

module.exports = {
  envoyerDemandeVisa,
  conducteurDeLaFiche,
  ficheDuConducteur,
  vueConducteur,
  viser,
  renvoyer,
  tableauConducteur,
};
