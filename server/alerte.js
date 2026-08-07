'use strict';

/*
 * Prevenir un conducteur de travaux sans courriel.
 *
 * Le lien personnel lui donne l'acces a ses fiches ; il ne le previent de rien.
 * C'est le courriel qui s'en chargeait, et c'est justement lui qui manque quand
 * le pare-feu ferme le port ou que l'administrateur du locataire n'a pas encore
 * autorise l'envoi.
 *
 * Le chef d'equipe envoie donc lui-meme un message, depuis son telephone, par le
 * moyen qu'ils utilisent deja. Ce qui rend la chose possible sans rien casser :
 * **ce message ne contient aucun lien**. Le conducteur ouvre sa page, qu'il a en
 * favori. Rien de secret ne passe donc par le chef, qui pourrait sinon viser ses
 * propres fiches — c'est ce qui distingue un controle d'une formalite.
 */

const D = require('./domaine');

/**
 * Numero au format international, pour les liens `sms:` et `wa.me`.
 *
 * Les numeros sont saisis comme on les dit — « 06 12 34 56 78 » — et les liens
 * les veulent en « +33612345678 ». La conversion est faite ici plutot que
 * demandee a qui saisit.
 */
function numeroInternational(brut, indicatif = '33') {
  const chiffres = String(brut || '').replace(/[^\d+]/g, '');
  if (!chiffres) return '';
  if (chiffres.startsWith('+')) return chiffres;
  if (chiffres.startsWith('00')) return `+${chiffres.slice(2)}`;
  // Un numero national commence par 0 : on le remplace par l'indicatif.
  if (chiffres.startsWith('0')) return `+${indicatif}${chiffres.slice(1)}`;
  return `+${chiffres}`;
}

/**
 * Le texte du message. Assez precis pour que le conducteur sache de quoi il
 * s'agit sans ouvrir quoi que ce soit, et sans rien qui permette de viser.
 */
function texteAlerte({ fiche, conducteur, chefNom, nbSalaries, totalMinutes }) {
  const dates = D.datesDeLaSemaine(fiche.annee, fiche.semaine);
  const periode = `du ${D.jourMois(dates[0])} au ${D.jourMois(dates[6])}`;
  const prenom = D.separerNomPrenom(conducteur.nom).prenom || conducteur.nom;

  const details = [
    `Semaine ${fiche.semaine} (${periode})`,
    fiche.chantier ? `Chantier : ${fiche.chantier}${fiche.ville ? ` — ${fiche.ville}` : ''}` : null,
    nbSalaries ? `${nbSalaries} salarié(s), ${D.versTexte(totalMinutes || 0)}` : null,
  ].filter(Boolean);

  return [
    `Bonjour ${prenom},`,
    '',
    `${chefNom} a transmis un pointage qui attend votre visa.`,
    ...details,
    '',
    'Ouvrez votre page « Fiches à viser » (celle que la direction vous a transmise, à garder en favori).',
  ].join('\n');
}

/** L'objet du courriel. Le corps, lui, est le meme texte que partout ailleurs. */
function objetAlerte({ fiche, chefNom }) {
  return `Pointage à viser — semaine ${fiche.semaine}${chefNom ? ` (${chefNom})` : ''}`;
}

/**
 * Les facons d'envoyer ce message. Aucune n'est imposee : le chef prend celle
 * dont il se sert deja avec ce conducteur, sur l'appareil qu'il a en main.
 *
 * `courriel` n'est pas une contradiction avec ce qui precede. Ce qui est bloque,
 * c'est l'envoi *automatique par le serveur* ; la messagerie du chef, elle,
 * fonctionne — c'est celle dont il se sert toute la journee. `mailto:` la lui
 * ouvre avec le message deja ecrit, et c'est ce qui sauve le cas du PC de
 * bureau, ou `sms:` ne mene generalement nulle part.
 *
 * `wa.me` n'accepte pas de numero vide, et `mailto:` pas d'adresse vide : on ne
 * propose que ce qui peut fonctionner.
 */
function alerteVisa({ fiche, conducteur, chefNom, nbSalaries, totalMinutes }) {
  const texte = texteAlerte({ fiche, conducteur, chefNom, nbSalaries, totalMinutes });
  const objet = objetAlerte({ fiche, chefNom });
  const numero = numeroInternational(conducteur.telephone);
  const encode = encodeURIComponent(texte);

  return {
    nom: conducteur.nom,
    telephone: conducteur.telephone || '',
    texte,
    objet,
    // `?&body=` est la forme qui marche a la fois sur iOS et sur Android.
    sms: numero ? `sms:${numero}?&body=${encode}` : '',
    whatsapp: numero ? `https://wa.me/${numero.replace('+', '')}?text=${encode}` : '',
    courriel: conducteur.courriel
      ? `mailto:${encodeURIComponent(conducteur.courriel)}?subject=${encodeURIComponent(objet)}&body=${encode}`
      : '',
  };
}

module.exports = { alerteVisa, texteAlerte, objetAlerte, numeroInternational };
