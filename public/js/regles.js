/*
 * Regles metier de la fiche de pointage.
 *
 * Ce fichier est le seul endroit ou elles sont ecrites : il est charge tel quel
 * par le navigateur et importe par le serveur (server/domaine.js). Les controles
 * affiches au chef d'equipe sur chantier, hors reseau, sont donc exactement ceux
 * qui seront appliques a la reception de la fiche.
 */

(function (racine) {
  'use strict';

  const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  const JOURS_COURTS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

  // Codes absence repris a l'identique du bas de la fiche papier.
  const CODES_ABSENCE = [
    { code: 'ACH', libelle: 'Autre chantier' },
    { code: 'F', libelle: 'Jour ferie' },
    { code: 'NJ', libelle: 'Absence NON justifiee' },
    { code: 'VM', libelle: 'Visite medicale' },
    { code: 'AT', libelle: 'Accident du travail' },
    { code: 'EV', libelle: 'Absence evenements familiaux' },
    { code: 'FOR', libelle: 'Conge formation' },
    { code: 'CSS', libelle: 'Conge sans solde autorise' },
    { code: 'AA', libelle: 'Autre absence non prevue (maladie)' },
  ];

  const CODES_VALIDES = CODES_ABSENCE.map((c) => c.code);
  const TYPES_MASQUE = ['', 'VA', 'AA'];
  const NB_LIGNES_FICHE = 11; // la fiche papier comporte 11 lignes de salaries

  /** "7h30", "7:30", "7.5", "7,5", "7" -> minutes entieres. */
  function versMinutes(saisie) {
    if (saisie === null || saisie === undefined) return 0;
    const t = String(saisie).trim().toLowerCase().replace(',', '.');
    if (t === '') return 0;
    const hm = t.match(/^(\d{1,2})\s*[h:]\s*(\d{1,2})?$/);
    if (hm) return Number(hm[1]) * 60 + Number(hm[2] || 0);
    const dec = Number(t);
    if (!Number.isFinite(dec) || dec < 0) return 0;
    return Math.round(dec * 60);
  }

  /** 450 -> "7h30". Toujours renseigne, y compris pour zero. */
  function versTexte(minutes) {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
  }

  /** Comme versTexte, mais laisse la case vide a zero : pour les champs de saisie. */
  function versSaisie(minutes) {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    return m ? versTexte(m) : '';
  }

  /** 450 -> 7.5 (colonnes numeriques des exports Excel) */
  function versDecimal(minutes) {
    return Math.round(((Number(minutes) || 0) / 60) * 100) / 100;
  }

  /** Lundi de la semaine ISO demandee. */
  function lundiDeLaSemaine(annee, semaine) {
    const jeudiSemaine1 = new Date(Date.UTC(annee, 0, 4));
    const decalage = (jeudiSemaine1.getUTCDay() + 6) % 7;
    const lundiSemaine1 = new Date(jeudiSemaine1);
    lundiSemaine1.setUTCDate(jeudiSemaine1.getUTCDate() - decalage);
    const lundi = new Date(lundiSemaine1);
    lundi.setUTCDate(lundiSemaine1.getUTCDate() + (semaine - 1) * 7);
    return lundi;
  }

  /** Les 7 dates ISO (AAAA-MM-JJ) de la semaine. */
  function datesDeLaSemaine(annee, semaine) {
    const lundi = lundiDeLaSemaine(annee, semaine);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(lundi);
      d.setUTCDate(lundi.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });
  }

  /** "2026-03-09" -> "09/03" */
  function jourMois(iso) {
    if (!iso) return '';
    const [, m, j] = iso.split('-');
    return `${j}/${m}`;
  }

  /**
   * Numero de semaine ISO d'une date. C'est le jeudi de la semaine qui porte
   * l'annee ISO : une semaine a cheval sur deux annees civiles appartient a
   * l'annee de son jeudi.
   */
  function semaineISO(date) {
    const jeudiDeLaSemaine = (d) => {
      const copie = new Date(d);
      copie.setUTCDate(copie.getUTCDate() + 3 - ((copie.getUTCDay() + 6) % 7));
      return copie;
    };

    const jeudi = jeudiDeLaSemaine(new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())));
    const annee = jeudi.getUTCFullYear();
    const premierJeudi = jeudiDeLaSemaine(new Date(Date.UTC(annee, 0, 4)));
    return { annee, semaine: 1 + Math.round((jeudi - premierJeudi) / (7 * 86400000)) };
  }

  function totalMinutesLigne(ligne) {
    return (ligne.jours || []).reduce((s, j) => s + (Number(j.minutes) || 0), 0);
  }

  /**
   * Controles de coherence appliques avant transmission, puis rappeles au
   * directeur. Une anomalie "bloquant" empeche la transmission ; une "alerte"
   * est signalee mais laisse la main.
   */
  function controlerFiche(fiche, lignes) {
    const anomalies = [];
    const bloquant = (m) => anomalies.push({ niveau: 'bloquant', message: m });
    const alerte = (m) => anomalies.push({ niveau: 'alerte', message: m });

    if (!String(fiche.chantier || '').trim()) bloquant('Le nom du chantier est obligatoire.');
    if (!String(fiche.ville || '').trim()) bloquant('La ville est obligatoire.');

    const lignesRemplies = lignes.filter((l) => String(l.nom_affiche || '').trim());
    if (lignesRemplies.length === 0) bloquant('Aucun salarie renseigne sur la fiche.');

    for (const ligne of lignesRemplies) {
      const nom = ligne.nom_affiche.trim();
      let totalSemaine = 0;

      for (let j = 0; j < 7; j += 1) {
        const jour = (ligne.jours || []).find((x) => x.jour === j) || { minutes: 0, code_absence: '' };
        const minutes = Number(jour.minutes) || 0;
        const code = String(jour.code_absence || '').trim().toUpperCase();
        totalSemaine += minutes;

        if (code && !CODES_VALIDES.includes(code)) {
          bloquant(`${nom} - ${JOURS[j]} : code absence "${code}" inconnu.`);
        }
        if (minutes === 0 && !code && j <= 4) {
          bloquant(`${nom} - ${JOURS[j]} : ni heures ni code absence (obligatoire du lundi au vendredi).`);
        }
        if (minutes > 0 && code) {
          alerte(`${nom} - ${JOURS[j]} : heures ET code absence "${code}" saisis simultanement.`);
        }
        if (minutes > 12 * 60) {
          alerte(`${nom} - ${JOURS[j]} : ${versTexte(minutes)} sur la journee, a confirmer.`);
        }
      }

      if (totalSemaine > 48 * 60) {
        alerte(`${nom} : ${versTexte(totalSemaine)} sur la semaine, au-dela du plafond de 48h.`);
      }
      if (ligne.jours_zone > 7) {
        bloquant(`${nom} : ${ligne.jours_zone} jours en zone declares pour une semaine de 7 jours.`);
      }
      if (ligne.jours_zone > 0 && !ligne.type_masque) {
        bloquant(`${nom} : jours en zone declares sans type de masque (VA ou AA).`);
      }
      if (ligne.type_masque && !TYPES_MASQUE.includes(ligne.type_masque)) {
        bloquant(`${nom} : type de masque "${ligne.type_masque}" invalide (VA ou AA).`);
      }
      if (!ligne.signature) {
        alerte(`${nom} : signature du salarie manquante.`);
      }
    }

    return anomalies;
  }

  const Regles = {
    JOURS,
    JOURS_COURTS,
    CODES_ABSENCE,
    CODES_VALIDES,
    TYPES_MASQUE,
    NB_LIGNES_FICHE,
    versMinutes,
    versTexte,
    versSaisie,
    versDecimal,
    lundiDeLaSemaine,
    datesDeLaSemaine,
    jourMois,
    semaineISO,
    controlerFiche,
    totalMinutesLigne,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Regles;
  else racine.Regles = Regles;
})(typeof globalThis !== 'undefined' ? globalThis : this);
