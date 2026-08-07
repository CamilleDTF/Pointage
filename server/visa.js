'use strict';

/*
 * Visa du conducteur de travaux.
 *
 * Le conducteur n'a pas de compte : il recoit un courriel avec un lien signe,
 * qui ouvre la fiche en lecture et propose deux gestes — viser, ou renvoyer au
 * chef avec un commentaire. C'est un choix delibere : un compte de plus par
 * conducteur, ce serait un code de plus a distribuer, a retenir et a
 * reinitialiser, pour deux clics par semaine.
 *
 * Ce que le lien autorise est volontairement etroit :
 *  - une seule fiche, celle dont l'identifiant est dans le jeton ;
 *  - deux actions, viser ou renvoyer, rien d'autre ;
 *  - tant que la fiche attend ce visa. Une fiche modifiee puis retransmise
 *    reçoit un nouveau secret, ce qui condamne les liens precedents.
 *
 * Et rien n'est decide sur un GET : les liens du courriel ouvrent une page, la
 * decision passe par un POST. Sans cela, l'antivirus de messagerie qui visite
 * les liens d'un message viserait les fiches a la place du conducteur.
 */

const crypto = require('crypto');
const { db, journaliser } = require('./db');
const F = require('./fiches');
const C = require('./courriel');

const DUREE_JETON_MS = 60 * 24 * 3600 * 1000; // 60 jours : large, le secret change a chaque envoi

function secret() {
  // Le meme secret que les sessions : il vit deja dans DATA_DIR/session.key.
  return require('./auth').SECRET_JETONS;
}

function signer(donnees) {
  const charge = Buffer.from(JSON.stringify(donnees)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(charge).digest('base64url');
  return `${charge}.${sig}`;
}

function verifier(jeton) {
  if (typeof jeton !== 'string' || !jeton.includes('.')) return null;
  const [charge, sig] = jeton.split('.');
  const attendu = crypto.createHmac('sha256', secret()).update(charge).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(attendu);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const donnees = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'));
    if (!donnees.exp || donnees.exp < Date.now()) return null;
    return donnees;
  } catch {
    return null;
  }
}

/** Le conducteur de travaux dont depend habituellement un chef d'equipe. */
function conducteurDuChef(chefId) {
  return db
    .prepare(
      `SELECT c.* FROM utilisateurs c
         JOIN utilisateurs u ON u.conducteur_id = c.id
        WHERE u.id = ? AND c.role = 'conducteur' AND c.actif = 1`
    )
    .get(chefId);
}

/**
 * Le conducteur qui doit viser une fiche donnee.
 *
 * Le choix fait par le chef au moment de transmettre l'emporte : c'est lui qui
 * sait sous quelle conduite s'est deroule le chantier de la semaine. Son
 * rattachement habituel ne sert que de proposition, et de repli pour les fiches
 * transmises avant que ce choix existe.
 */
function conducteurDeLaFiche(fiche) {
  if (fiche && fiche.conducteur_id) {
    const choisi = db
      .prepare("SELECT * FROM utilisateurs WHERE id = ? AND role = 'conducteur' AND actif = 1")
      .get(fiche.conducteur_id);
    if (choisi) return choisi;
  }
  return conducteurDuChef(fiche ? fiche.chef_id : null);
}

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

  const nonce = crypto.randomBytes(12).toString('base64url');
  db.prepare(
    `UPDATE fiches SET visa_statut = 'attente', visa_jeton = ?, visa_le = NULL,
            visa_courriel = ?, visa_commentaire = '', visa_envoye_le = datetime('now')
      WHERE id = ?`
  ).run(nonce, conducteur.courriel, ficheId);

  const jeton = signer({ f: ficheId, n: nonce, exp: Date.now() + DUREE_JETON_MS });
  const lien = `${adressePublique()}/visa.html?jeton=${encodeURIComponent(jeton)}`;

  journaliser(ficheId, null, relance ? 'relance_visa' : 'demande_visa', `${conducteur.nom} <${conducteur.courriel}>`);
  return { conducteur, jeton, lien, fiche };
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

/** La fiche visee par un jeton, si celui-ci est encore valable. */
function ficheDuJeton(jeton) {
  const donnees = verifier(jeton);
  if (!donnees) return { erreur: 'Ce lien n est plus valable.', code: 403 };

  const fiche = F.obtenirFiche(donnees.f);
  if (!fiche) return { erreur: 'Fiche introuvable.', code: 404 };
  // Le secret change a chaque transmission : un lien d'une version anterieure
  // de la fiche ne doit plus rien pouvoir viser.
  if (!fiche.visa_jeton || fiche.visa_jeton !== donnees.n) {
    return { erreur: 'Ce lien a ete remplace : le chef d equipe a retransmis sa fiche.', code: 403 };
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
    zone_deplacement: fiche.zone_deplacement,
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
    lignes: fiche.lignes
      .filter((l) => String(l.nom_affiche || '').trim())
      .map((l) => ({
        nom_affiche: l.nom_affiche,
        jours: l.jours.map((j) => ({ jour: j.jour, minutes: j.minutes, code_absence: j.code_absence, saisi: j.saisi })),
        total_minutes: l.total_minutes,
        minutes_route: l.minutes_route,
        minutes_trajet: l.minutes_trajet,
        jours_zone: l.jours_zone,
        type_masque: l.type_masque,
        nb_deplacement: l.nb_deplacement,
        observation: l.observation,
        signature: l.signature ? true : false, // presence seulement : pas l'image
      })),
  };
}

/** Le conducteur vise : la fiche poursuit sa route vers le directeur. */
function viser(jeton, commentaire = '') {
  const acces = ficheDuJeton(jeton);
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

  journaliser(fiche.id, null, 'visa_conducteur', conducteur ? conducteur.nom : '');
  return { fiche: vueConducteur(F.obtenirFiche(fiche.id)) };
}

/** Le conducteur renvoie : la fiche repart au chef, avec son commentaire. */
function renvoyer(jeton, commentaire) {
  const acces = ficheDuJeton(jeton);
  if (acces.erreur) return acces;
  const fiche = acces.fiche;

  const motif = String(commentaire || '').trim();
  if (!motif) return { erreur: 'Indiquez ce qui doit etre corrige.', code: 400 };
  if (fiche.statut !== 'soumise') return { erreur: 'Cette fiche n attend plus de visa.', code: 409 };

  const conducteur = conducteurDeLaFiche(fiche);
  const signature = conducteur ? `${conducteur.nom} (conducteur de travaux)` : 'Conducteur de travaux';

  db.prepare(
    `UPDATE fiches SET statut = 'rejetee', motif_rejet = ?, visa_statut = '', visa_jeton = NULL,
            visa_commentaire = ?, validee_le = NULL, validee_par = NULL, maj_le = datetime('now')
      WHERE id = ?`
  ).run(`${signature} : ${motif}`.slice(0, 1000), motif.slice(0, 1000), fiche.id);

  journaliser(fiche.id, null, 'renvoi_conducteur', motif.slice(0, 1000));
  return { renvoyee: true, fiche: vueConducteur(F.obtenirFiche(fiche.id)) };
}

/* ------------------- Lien personnel d'un conducteur ----------------------- */

/*
 * Le courriel restait le seul maillon dependant de quelque chose qu'on ne
 * maitrise pas : un serveur d'envoi, un port ouvert, une autorisation a
 * demander. Le conducteur recoit donc, une fois pour toutes, une adresse
 * personnelle a mettre en favori sur son telephone. Elle lui montre les fiches
 * qui attendent SON visa, et rien d'autre.
 *
 * Ce lien ne passe jamais par le chef d'equipe : c'est ce qui distingue un
 * controle d'une formalite. Un chef qui detiendrait le lien pourrait viser sa
 * propre fiche.
 */
function lienConducteur(conducteur) {
  if (!conducteur || !conducteur.jeton) return '';
  return `${adressePublique()}/conducteur.html?cle=${encodeURIComponent(conducteur.jeton)}`;
}

/** Regenere le secret : l'ancien lien cesse aussitot de fonctionner. */
function regenererJeton(conducteurId) {
  const jeton = crypto.randomBytes(24).toString('base64url');
  const resultat = db
    .prepare("UPDATE utilisateurs SET jeton = ? WHERE id = ? AND role = 'conducteur'")
    .run(jeton, conducteurId);
  if (!resultat.changes) return { erreur: 'Conducteur de travaux inconnu.', code: 404 };
  return { conducteur: db.prepare('SELECT * FROM utilisateurs WHERE id = ?').get(conducteurId) };
}

function conducteurDuJeton(cle) {
  if (!cle || typeof cle !== 'string') return null;
  return (
    db.prepare("SELECT * FROM utilisateurs WHERE jeton = ? AND role = 'conducteur' AND actif = 1").get(cle) ||
    null
  );
}

/**
 * Ce que voit le conducteur en ouvrant son lien : ses fiches en attente, et
 * celles qu'il a visees recemment — pour qu'il sache que son geste a porte.
 *
 * Chaque fiche en attente est accompagnee de son lien de visa du moment. Le
 * mecanisme d'ouverture d'une fiche reste donc exactement celui du courriel,
 * deja eprouve : un secret par fiche, renouvele a chaque transmission.
 */
function tableauConducteur(cle) {
  const conducteur = conducteurDuJeton(cle);
  if (!conducteur) return { erreur: 'Ce lien n’est plus valable. Demandez-en un nouveau à la direction.', code: 403 };

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
          AND COALESCE(f.conducteur_id, u.conducteur_id) = ?
        ORDER BY f.visa_le DESC LIMIT 8`
    )
    .all(conducteur.id);

  return {
    conducteur: { nom: conducteur.nom },
    enAttente: enAttente.map((f) => ({ ...f, lien: lienFiche(f.id) })),
    recentes,
  };
}

/**
 * Lien de visa d'une fiche donnee, signe a l'instant.
 *
 * Le secret vit dans la fiche et change a chaque transmission : on le lit plutot
 * que d'en poser un nouveau, sans quoi ouvrir sa liste condamnerait les liens
 * deja envoyes par courriel pour la meme fiche.
 */
function lienFiche(ficheId) {
  const ligne = db.prepare('SELECT visa_jeton FROM fiches WHERE id = ?').get(ficheId);
  if (!ligne || !ligne.visa_jeton) return '';
  const jeton = signer({ f: ficheId, n: ligne.visa_jeton, exp: Date.now() + DUREE_JETON_MS });
  return `/visa.html?jeton=${encodeURIComponent(jeton)}`;
}

module.exports = {
  envoyerDemandeVisa,
  conducteurDeLaFiche,
  ficheDuJeton,
  vueConducteur,
  viser,
  renvoyer,
  lienConducteur,
  regenererJeton,
  tableauConducteur,
};
