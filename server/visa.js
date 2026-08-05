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

/** Le conducteur de travaux dont depend un chef d'equipe. */
function conducteurDuChef(chefId) {
  return db
    .prepare(
      `SELECT c.* FROM conducteurs c
         JOIN utilisateurs u ON u.conducteur_id = c.id
        WHERE u.id = ? AND c.actif = 1`
    )
    .get(chefId);
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

  const conducteur = conducteurDuChef(fiche.chef_id);
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
  return String(process.env.URL_PUBLIQUE || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, '');
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
  const conducteur = conducteurDuChef(fiche.chef_id);
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

  const conducteur = conducteurDuChef(fiche.chef_id);
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

  const conducteur = conducteurDuChef(fiche.chef_id);
  const signature = conducteur ? `${conducteur.nom} (conducteur de travaux)` : 'Conducteur de travaux';

  db.prepare(
    `UPDATE fiches SET statut = 'rejetee', motif_rejet = ?, visa_statut = '', visa_jeton = NULL,
            visa_commentaire = ?, validee_le = NULL, validee_par = NULL, maj_le = datetime('now')
      WHERE id = ?`
  ).run(`${signature} : ${motif}`.slice(0, 1000), motif.slice(0, 1000), fiche.id);

  journaliser(fiche.id, null, 'renvoi_conducteur', motif.slice(0, 1000));
  return { renvoyee: true, fiche: vueConducteur(F.obtenirFiche(fiche.id)) };
}

module.exports = {
  demanderVisa,
  envoyerDemandeVisa,
  conducteurDuChef,
  ficheDuJeton,
  vueConducteur,
  viser,
  renvoyer,
  adressePublique,
};
