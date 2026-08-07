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

/**
 * Les trois facons d'envoyer ce message depuis un telephone. Aucune n'est
 * imposee : le chef prend celle dont il se sert deja avec ce conducteur.
 *
 * `wa.me` n'accepte pas de numero vide, et `sms:` s'en accommode : on ne
 * propose que ce qui peut fonctionner.
 */
function alerteVisa({ fiche, conducteur, chefNom, nbSalaries, totalMinutes }) {
  const texte = texteAlerte({ fiche, conducteur, chefNom, nbSalaries, totalMinutes });
  const numero = numeroInternational(conducteur.telephone);
  const encode = encodeURIComponent(texte);

  return {
    nom: conducteur.nom,
    telephone: conducteur.telephone || '',
    texte,
    // `?&body=` est la forme qui marche a la fois sur iOS et sur Android.
    sms: numero ? `sms:${numero}?&body=${encode}` : '',
    whatsapp: numero ? `https://wa.me/${numero.replace('+', '')}?text=${encode}` : '',
  };
}

module.exports = { alerteVisa, texteAlerte, numeroInternational };
