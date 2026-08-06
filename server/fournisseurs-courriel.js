'use strict';

/*
 * Deviner le serveur d'envoi d'un domaine professionnel.
 *
 * La question « que mettre dans SMTP_HOTE ? » n'a pas de reponse evidente quand
 * on ne l'a jamais posee, et attendre le service informatique coute des jours
 * pour un renseignement de trente secondes. Or le domaine le dit deja : les
 * enregistrements MX d'une adresse professionnelle designent l'hebergeur de la
 * messagerie, et l'hebergeur determine le serveur d'envoi.
 *
 * On ne fait que proposer. Une entreprise peut parfaitement recevoir chez un
 * hebergeur et envoyer par un relais interne : la proposition se verifie d'un
 * essai, et le service informatique tranche si elle ne marche pas.
 */

const dns = require('dns').promises;

/*
 * Un motif par hebergeur, cherche dans les noms MX. Les valeurs sont celles que
 * l'hebergeur publie dans sa documentation ; le port 587 est la regle, le 465
 * l'exception.
 */
const FOURNISSEURS = [
  {
    motif: /\.protection\.outlook\.com$|\.outlook\.com$/,
    nom: 'Microsoft 365 (Exchange Online)',
    hote: 'smtp.office365.com',
    port: 587,
    note:
      "Microsoft refuse le mot de passe habituel du compte. Selon le reglage de votre " +
      "organisation, il faut soit un mot de passe d'application, soit que le service " +
      "informatique autorise l'authentification SMTP sur la boite utilisee.",
  },
  {
    motif: /aspmx.*\.google\.com$|googlemail\.com$/,
    nom: 'Google Workspace',
    hote: 'smtp.gmail.com',
    port: 587,
    note:
      "Google refuse le mot de passe habituel : creez un mot de passe d'application " +
      'dans les reglages de securite du compte.',
  },
  {
    motif: /\.ovh\.net$|\.ovh\.com$/,
    nom: 'OVHcloud',
    hote: 'ssl0.ovh.net',
    port: 587,
    note: "Le mot de passe est celui de la boite. Le port 465 fonctionne aussi.",
  },
  {
    motif: /\.ionos\.|\.1and1\.|\.1und1\./,
    nom: 'IONOS (1&1)',
    hote: 'smtp.ionos.fr',
    port: 587,
    note: 'Le mot de passe est celui de la boite.',
  },
  {
    motif: /\.gandi\.net$/,
    nom: 'Gandi',
    hote: 'mail.gandi.net',
    port: 587,
    note: 'Le mot de passe est celui de la boite.',
  },
  {
    motif: /\.infomaniak\.com$|\.infomaniak\.ch$/,
    nom: 'Infomaniak',
    hote: 'mail.infomaniak.com',
    port: 587,
    note: 'Le mot de passe est celui de la boite.',
  },
  {
    motif: /\.orange\.fr$|\.wanadoo\.fr$/,
    nom: 'Orange Pro',
    hote: 'smtp.orange.fr',
    port: 587,
    note: 'Le mot de passe est celui de la boite.',
  },
  {
    motif: /\.zoho\.|zohomail/,
    nom: 'Zoho Mail',
    hote: 'smtp.zoho.eu',
    port: 587,
    note: "Zoho demande un mot de passe d'application quand la double authentification est active.",
  },
  {
    motif: /\.mailprotect\.be$|\.combell\./,
    nom: 'Combell',
    hote: 'smtp.combell.com',
    port: 587,
    note: 'Le mot de passe est celui de la boite.',
  },
];

/** "camille@mon-entreprise.fr" -> "mon-entreprise.fr" */
function domaineDe(adresse) {
  const arobase = String(adresse || '').lastIndexOf('@');
  return arobase === -1 ? '' : String(adresse).slice(arobase + 1).trim().toLowerCase();
}

/**
 * Interroge les MX du domaine et rapproche le resultat d'un hebergeur connu.
 *
 * Ne leve jamais : un domaine inconnu, un reseau coupe ou un DNS filtre rendent
 * `{ trouve: false }` avec ce qu'on a pu lire. Le but est d'aider, pas d'ajouter
 * une panne a une panne.
 */
async function detecter(adresse) {
  const domaine = domaineDe(adresse);
  if (!domaine) return { trouve: false, domaine: '', mx: [], raison: 'adresse illisible' };

  let mx = [];
  try {
    mx = (await dns.resolveMx(domaine))
      .sort((a, b) => a.priority - b.priority)
      .map((e) => e.exchange.toLowerCase());
  } catch (erreur) {
    return { trouve: false, domaine, mx: [], raison: erreur.code || erreur.message };
  }

  if (!mx.length) return { trouve: false, domaine, mx, raison: 'aucun enregistrement MX' };

  for (const fournisseur of FOURNISSEURS) {
    if (mx.some((nom) => fournisseur.motif.test(nom))) {
      return { trouve: true, domaine, mx, fournisseur };
    }
  }

  /*
   * Hebergeur non reconnu — souvent un serveur interne a l'entreprise. Le nom du
   * MX lui-meme est alors la meilleure piste : beaucoup de PME recoivent et
   * envoient par la meme machine.
   */
  return { trouve: false, domaine, mx, suggestion: mx[0] };
}

module.exports = { detecter, domaineDe, FOURNISSEURS };
