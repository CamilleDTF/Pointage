'use strict';

/*
 * Agregation d'un mois de paie, au format du tableau mensuel du directeur.
 *
 * Le tableau raisonne par salarie et par semaine : les heures supplementaires
 * se calculent sur la semaine (les 8 premieres majorees a 25 %, les suivantes a
 * 50 %), jamais sur le mois.
 *
 * Le classeur reserve six emplacements de semaine, a partir de celle qui
 * contient le 1er. Une semaine a cheval sur deux mois figure dans les deux
 * tableaux, mais chacun ne retient que ses propres jours — c'est la convention
 * du classeur d'origine, ou le 29 et le 30 juin restent vides sur la feuille de
 * juillet. Les primes de la semaine suivent la meme repartition, au prorata des
 * jours pointes.
 *
 * Un meme salarie peut apparaitre sur plusieurs fiches dans la semaine (deux
 * chantiers, deux chefs d'equipe) : tout est cumule sur sa ligne.
 */

const { db } = require('./db');
const D = require('./domaine');

const arrondiQuart = (valeur) => Math.round(valeur * 4) / 4;

/**
 * Part d'une ligne de fiche revenant au mois traite : rapport entre les jours
 * pointes qui tombent dans le mois et l'ensemble des jours pointes de la
 * semaine. Vaut 1 pour une semaine entierement contenue dans le mois.
 */
function proportionDuMois(ligne, joursPointes, joursDuMois) {
  const actifs = joursPointes.filter((j) => j.minutes > 0 || j.code_absence);
  if (!actifs.length) return 0;
  const dansLeMois = actifs.filter((j) => joursDuMois[j.jour]);
  return dansLeMois.length / actifs.length;
}

/** Cle de regroupement : le matricule quand il existe, sinon le nom saisi. */
function cleSalarie(ligne) {
  return ligne.salarie_id ? `id:${ligne.salarie_id}` : `nom:${D.sansAccents(ligne.nom_affiche).trim()}`;
}

function nomFeuille(salarie) {
  const brut = salarie.prenom ? `${salarie.nom}_${salarie.prenom}` : salarie.nom;
  return D.sansAccents(brut) === '' ? 'SANS_NOM' : brut.replace(/\s+/g, '_').replace(/[\\/*?:[\]]/g, '');
}

function semaineVide(semaine) {
  return {
    annee: semaine.annee,
    semaine: semaine.semaine,
    dates: semaine.dates,
    joursDuMois: semaine.joursDuMois,
    jours: Array.from({ length: 7 }, () => ({ minutes: 0, codes: [] })),
    minutesTotal: 0,
    minutesRoute: 0,
    minutesTrajet: 0,
    joursAmiante1: 0, // masque VA
    joursAmiante2: 0, // masque AA
    joursPanier: 0,
    joursTravailles: 0,
    joursGD72: 0,
    joursGD80: 0,
    joursFeries: 0,
    minutesFeries: 0,
    chantiers: [],
  };
}

/**
 * Construit le mois : la liste des salaries, chacun avec ses six semaines.
 * `statut` filtre les fiches prises en compte (par defaut, seules les fiches
 * validees alimentent la paie).
 */
function agregerMois(annee, mois, { statut = 'validee' } = {}) {
  const semaines = D.semainesDuMois(annee, mois);

  const conditions = semaines.map((_, i) => `(f.annee = @a${i} AND f.semaine = @s${i})`).join(' OR ');
  const params = {};
  semaines.forEach((s, i) => { params[`a${i}`] = s.annee; params[`s${i}`] = s.semaine; });
  if (statut) params.statut = statut;

  const lignes = db
    .prepare(
      `SELECT l.*, f.annee, f.semaine, f.chantier, f.ville, f.zone_deplacement, f.statut,
              s.matricule, s.nom AS salarie_nom, s.prenom AS salarie_prenom,
              s.taux_horaire
         FROM fiche_lignes l
         JOIN fiches f ON f.id = l.fiche_id
         LEFT JOIN salaries s ON s.id = l.salarie_id
        WHERE (${conditions})
          ${statut ? 'AND f.statut = @statut' : ''}
          AND TRIM(l.nom_affiche) <> ''
        ORDER BY l.nom_affiche`
    )
    .all(params);

  const jours = db.prepare('SELECT * FROM fiche_jours WHERE ligne_id = ? ORDER BY jour');
  const parSalarie = new Map();

  for (const ligne of lignes) {
    const cle = cleSalarie(ligne);
    if (!parSalarie.has(cle)) {
      const [nom, ...reste] = ligne.nom_affiche.trim().split(/\s+/);
      parSalarie.set(cle, {
        cle,
        salarie_id: ligne.salarie_id || null,
        matricule: ligne.matricule || '',
        nom: ligne.salarie_nom || nom,
        prenom: ligne.salarie_prenom || reste.join(' '),
        nom_affiche: ligne.nom_affiche.trim(),
        tauxHoraire: Number(ligne.taux_horaire) || 0,
        semaines: semaines.map(semaineVide),
      });
    }
    const salarie = parSalarie.get(cle);

    const index = semaines.findIndex((s) => s.annee === ligne.annee && s.semaine === ligne.semaine);
    if (index === -1) continue;
    const cible = salarie.semaines[index];

    // Une semaine a cheval sur deux mois n'apporte que ses jours du mois traite :
    // les autres sont pris en compte par le tableau du mois voisin.
    for (const jour of jours.all(ligne.id)) {
      if (!cible.joursDuMois[jour.jour]) continue;
      cible.jours[jour.jour].minutes += jour.minutes;
      if (jour.code_absence) cible.jours[jour.jour].codes.push(jour.code_absence);
      cible.minutesTotal += jour.minutes;
    }

    // Les primes sont declarees pour la semaine entiere. Sur une semaine a
    // cheval, on les rattache au prorata des jours effectivement travailles dans
    // le mois, pour qu'aucun jour de zone ni de panier ne soit compte deux fois.
    const part = proportionDuMois(ligne, jours.all(ligne.id), cible.joursDuMois);
    cible.minutesRoute += Math.round(ligne.minutes_route * part);
    cible.minutesTrajet += Math.round(ligne.minutes_trajet * part);
    if (ligne.type_masque === 'VA') cible.joursAmiante1 += arrondiQuart(ligne.jours_zone * part);
    if (ligne.type_masque === 'AA') cible.joursAmiante2 += arrondiQuart(ligne.jours_zone * part);

    /*
     * Grands deplacements : le chef d'equipe compte lui-meme ses jours sous
     * chacun des deux taux. C'est plus juste que de les deduire de la ville du
     * chantier, comme on le faisait — un meme chantier peut relever des deux
     * selon les jours.
     *
     * Les fiches anterieures a ces deux colonnes n'en portent pas : elles
     * gardent l'ancienne repartition, sans quoi les mois deja pointes
     * changeraient de montant apres coup.
     */
    const deplacements = arrondiQuart(ligne.nb_deplacement * part);
    const declares = (Number(ligne.nb_gd72) || 0) + (Number(ligne.nb_gd80) || 0);
    if (declares > 0) {
      cible.joursGD72 += arrondiQuart((Number(ligne.nb_gd72) || 0) * part);
      cible.joursGD80 += arrondiQuart((Number(ligne.nb_gd80) || 0) * part);
    } else if (deplacements > 0) {
      if (D.estGrandDeplacement80(ligne.ville, ligne.zone_deplacement)) cible.joursGD80 += deplacements;
      else cible.joursGD72 += deplacements;
    }

    if (ligne.chantier && !cible.chantiers.includes(ligne.chantier)) cible.chantiers.push(ligne.chantier);
  }

  const salaries = [...parSalarie.values()].sort((a, b) =>
    `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, 'fr')
  );

  // Noms de feuille uniques : le classeur y fait reference par INDIRECT.
  const pris = new Set();
  for (const salarie of salaries) {
    let base = nomFeuille(salarie).slice(0, 31);
    let nom = base;
    let suffixe = 2;
    while (pris.has(nom)) {
      nom = `${base.slice(0, 29)}_${suffixe}`;
      suffixe += 1;
    }
    pris.add(nom);
    salarie.feuille = nom;

    for (const semaine of salarie.semaines) {
      const sup = D.heuresSupplementaires(semaine.minutesTotal);
      semaine.minutes25 = sup.minutes25;
      semaine.minutes50 = sup.minutes50;

      /*
       * Panier repas : rien a saisir, la regle se lit dans le pointage. Tout
       * jour travaille y donne droit, sauf s'il est couvert par un grand
       * deplacement — l'indemnite de deplacement comprend deja le repas.
       *
       * Les jours travailles se comptent ici, apres coup : un salarie present
       * sur deux chantiers le meme jour n'a qu'un repas, et il faut d'abord
       * avoir fusionne ses lignes pour le savoir.
       */
      const joursTravailles = semaine.jours.filter((j) => j.minutes > 0).length;
      semaine.joursTravailles = joursTravailles;
      semaine.joursPanier = D.joursPanierRepas(joursTravailles, semaine.joursGD72 + semaine.joursGD80);

      // Les jours feries se deduisent du code "F" de la fiche. La fiche ne porte
      // qu'un code, pas d'heures : on les valorise a la journee de reference.
      semaine.joursFeries = semaine.jours.filter((j) => j.codes.includes('F')).length;
      semaine.minutesFeries = semaine.joursFeries * D.DUREE_JOURNEE_REFERENCE_MINUTES;
    }
    salarie.minutesMois = salarie.semaines.reduce((s, x) => s + x.minutesTotal, 0);
    Object.assign(salarie, cumulerMois(salarie));
  }

  return { annee, mois, semaines, salaries };
}

/**
 * Les colonnes du tableau mensuel, cumulees sur les six semaines. Les heures
 * supplementaires restent calculees semaine par semaine — c'est la regle de
 * paie — puis seulement additionnees ici.
 */
function cumulerMois(salarie) {
  const somme = (champ) => salarie.semaines.reduce((s, x) => s + (x[champ] || 0), 0);
  return {
    minutes25: somme('minutes25'),
    minutes50: somme('minutes50'),
    minutesRoute: somme('minutesRoute'),
    minutesTrajet: somme('minutesTrajet'),
    joursAmiante1: somme('joursAmiante1'),
    joursAmiante2: somme('joursAmiante2'),
    joursPanier: somme('joursPanier'),
    joursTravailles: somme('joursTravailles'),
    joursGD72: somme('joursGD72'),
    joursGD80: somme('joursGD80'),
    joursFeries: somme('joursFeries'),
    minutesFeries: somme('minutesFeries'),
    chantiers: [...new Set(salarie.semaines.flatMap((s) => s.chantiers))],
  };
}

/*
 * Valorisation d'un mois, aux formules du classeur de la direction.
 *
 * Sans taux horaire renseigne, rien n'est calcule : un salaire faux serait pire
 * qu'une case vide. C'est `tauxManquant` qui le signale a l'ecran.
 */
const HEURES_MENSUELLES_BASE = 151.67; // duree legale mensualisee
const PART_NET = 0.77;                 // du brut au net, taux du classeur
const PRIME_AMIANTE_1 = 5;             // par jour en masque VA
const PRIME_AMIANTE_2 = 10;            // par jour en masque AA
const ABATTEMENT_PRIME_AMIANTE = 0.8;
const MONTANT_GD_72 = 72;
const MONTANT_GD_80 = 80;

function valoriser(salarie, { montantPanier = D.MONTANT_PANIER_REPAS } = {}) {
  const taux = Number(salarie.tauxHoraire) || 0;
  const h = (minutes) => (Number(minutes) || 0) / 60;

  if (!taux) {
    return { tauxManquant: true, tauxHoraire: 0, salaireBrut: 0, salaireNet: 0, heuresSupBrut: 0,
      heuresSupNet: 0, primeAmiante: 0, paniers: 0, grandDeplacement: 0, trajet: 0, totalBrut: 0, totalNet: 0 };
  }

  const salaireBrut = HEURES_MENSUELLES_BASE * taux;
  const heuresSupBrut = taux * 1.25 * h(salarie.minutes25) + taux * 1.5 * h(salarie.minutes50);
  const primeAmiante =
    (salarie.joursAmiante1 * PRIME_AMIANTE_1 + salarie.joursAmiante2 * PRIME_AMIANTE_2) * ABATTEMENT_PRIME_AMIANTE;
  const paniers = salarie.joursPanier * montantPanier;
  const grandDeplacement = salarie.joursGD72 * MONTANT_GD_72 + salarie.joursGD80 * MONTANT_GD_80;
  // Trajet paye a 50 %, route a 100 % : la convention des deux colonnes de la fiche.
  const trajet = taux * (h(salarie.minutesTrajet) / 2) + taux * h(salarie.minutesRoute);

  const totalBrut = salaireBrut + heuresSupBrut + primeAmiante + paniers + grandDeplacement + trajet;
  return {
    tauxManquant: false,
    tauxHoraire: taux,
    salaireBrut,
    salaireNet: salaireBrut * PART_NET,
    heuresSupBrut,
    heuresSupNet: heuresSupBrut * PART_NET,
    primeAmiante,
    paniers,
    grandDeplacement,
    trajet,
    totalBrut,
    totalNet: salaireBrut * PART_NET + heuresSupBrut * PART_NET + primeAmiante + paniers + grandDeplacement + trajet,
  };
}

module.exports = {
  agregerMois,
  valoriser,
  // Partagees avec la paie du personnel non productif : les memes taux, ecrits
  // une seule fois. Deux copies de 151,67 finiraient par ne plus se ressembler.
  HEURES_MENSUELLES_BASE,
  PART_NET,
  MONTANT_GD_72,
  MONTANT_GD_80,
};
