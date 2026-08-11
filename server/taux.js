'use strict';

/*
 * Les taux de la paie, et leur date d'effet.
 *
 * Ces montants vivaient en dur dans le code : 12,20 € le panier, 72 et 80 € le
 * grand deplacement, 5 et 10 € la prime de zone. Trois consequences, toutes
 * mauvaises. Un changement d'accord demandait une nouvelle version du logiciel.
 * Le jour ou un taux changeait, tous les mois passes changeaient avec lui — on
 * ne pouvait plus recalculer decembre avec les taux de decembre. Et personne,
 * hors du code, ne pouvait meme LIRE les taux appliques.
 *
 * Un taux est donc une valeur qui commence a une date. Celui qui vaut pour un
 * mois est le dernier dont la date d'effet est atteinte ; les precedents restent
 * en place, intacts.
 *
 * La date d'effet est un MOIS, jamais un jour. C'est le choix de la direction :
 * un taux qui change au 1er janvier s'applique a toute la paie de janvier, et un
 * meme mois ne melange jamais deux taux — sans quoi un tableau mensuel
 * deviendrait impossible a recontroler a la main.
 */

const { db, journaliser } = require('./db');

/*
 * Le catalogue. Rien ne se calcule avec un taux absent d'ici : une cle inconnue
 * est refusee a la saisie, pour qu'une faute de frappe ne cree pas un taux
 * fantome que personne ne lira jamais.
 *
 * `defaut` est la valeur d'origine, celle qui etait ecrite dans le code. Elle
 * sert d'amorce a la premiere ouverture, avec une date d'effet volontairement
 * ancienne : les mois deja calcules ne doivent pas bouger d'un centime parce
 * qu'on a rendu leurs taux modifiables.
 */
const CATALOGUE = [
  { cle: 'panier_repas', libelle: 'Panier repas', unite: '€ / jour travaillé', defaut: 12.2 },
  { cle: 'gd_72', libelle: 'Grand déplacement — taux 72', unite: '€ / jour', defaut: 72 },
  { cle: 'gd_80', libelle: 'Grand déplacement — taux 80', unite: '€ / jour', defaut: 80 },
  { cle: 'prime_zone_va', libelle: 'Prime de zone — masque VA', unite: '€ / jour', defaut: 5 },
  { cle: 'prime_zone_aa', libelle: 'Prime de zone — masque AA', unite: '€ / jour', defaut: 10 },
  { cle: 'abattement_prime_zone', libelle: 'Abattement sur la prime de zone', unite: 'coefficient', defaut: 0.8 },
  { cle: 'heures_mensuelles', libelle: 'Horaire mensualisé', unite: 'heures / mois', defaut: 151.67 },
  { cle: 'majoration_hs_25', libelle: 'Majoration des heures sup. (1er palier)', unite: 'coefficient', defaut: 1.25 },
  { cle: 'majoration_hs_50', libelle: 'Majoration des heures sup. (2e palier)', unite: 'coefficient', defaut: 1.5 },
  {
    cle: 'majoration_ferie',
    libelle: 'Heures travaillées un jour férié',
    unite: 'coefficient — 2 = payées double',
    defaut: 2,
  },
  {
    cle: 'edenred',
    libelle: 'Titre-restaurant (EDENRED)',
    unite: '€ / jour travaillé — personnel non productif',
    defaut: 11.7,
  },
  {
    cle: 'part_net_estimee',
    libelle: 'Part nette estimée du brut',
    unite: 'coefficient',
    defaut: 0.77,
    // Ce n'est pas un calcul de paie : c'est l'ordre de grandeur du classeur,
    // qui sert a se faire une idee avant que la paie tranche.
    estimation: true,
  },
];

const CLES = CATALOGUE.map((t) => t.cle);
const DEFAUTS = Object.fromEntries(CATALOGUE.map((t) => [t.cle, t.defaut]));

/*
 * L'amorce : les valeurs d'origine, a une date assez ancienne pour couvrir tout
 * ce qui a deja ete saisi. Sans elle, un mois calcule avant cette version
 * changerait de montants — exactement ce que l'historisation doit empecher.
 */
const DEBUT_ORIGINE = '2000-01-01';

function amorcer() {
  const existe = db.prepare('SELECT COUNT(*) AS n FROM taux WHERE cle = ? AND debut = ?');
  const inserer = db.prepare('INSERT INTO taux (cle, valeur, debut, note) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    for (const t of CATALOGUE) {
      if (!existe.get(t.cle, DEBUT_ORIGINE).n) {
        inserer.run(t.cle, t.defaut, DEBUT_ORIGINE, 'Valeur d’origine, reprise du code');
      }
    }
  })();
}

/** Le premier jour du mois, seule forme que prend une date d'effet. */
const premierDuMois = (annee, mois) => `${annee}-${String(mois).padStart(2, '0')}-01`;

/**
 * Les taux applicables a un mois de paie : pour chaque cle, le dernier dont la
 * date d'effet est atteinte. Une cle sans aucune entree retombe sur sa valeur
 * d'origine — mieux vaut le montant d'hier qu'un zero silencieux.
 */
function tauxDuMois(annee, mois) {
  const limite = premierDuMois(annee, mois);
  const lignes = db
    .prepare(
      `SELECT cle, valeur FROM taux t
        WHERE debut <= ?
          AND debut = (SELECT MAX(debut) FROM taux WHERE cle = t.cle AND debut <= ?)`
    )
    .all(limite, limite);

  const resultat = { ...DEFAUTS };
  for (const ligne of lignes) resultat[ligne.cle] = Number(ligne.valeur);
  return resultat;
}

/** Le catalogue, chaque taux accompagne de son histoire. */
function historique() {
  const entrees = db
    .prepare(
      `SELECT t.id, t.cle, t.valeur, t.debut, t.note, u.nom AS auteur
         FROM taux t LEFT JOIN utilisateurs u ON u.id = t.cree_par
        ORDER BY t.cle, t.debut DESC`
    )
    .all();

  return CATALOGUE.map((t) => ({
    ...t,
    valeurs: entrees.filter((e) => e.cle === t.cle),
  }));
}

/**
 * Enregistre un taux a compter d'un mois.
 *
 * Reecrire une date d'effet deja utilisee est permis — on corrige une saisie du
 * jour meme — mais cela reste trace : un montant de paie qui change sans qu'on
 * sache qui l'a change ne vaut pas mieux qu'un montant en dur.
 */
function definir({ cle, valeur, annee, mois, note }, utilisateur) {
  if (!CLES.includes(cle)) return { erreur: `Taux inconnu : ${cle}.`, code: 400 };

  /*
   * Une valeur vide n'est pas un zero. `Number('')` et `Number(null)` valent 0 :
   * sans ce garde-fou, valider un champ laisse en blanc reglait le panier a
   * zero euro, et personne ne l'aurait vu avant la paie. Un zero explicite,
   * lui, reste permis — c'est ainsi qu'on supprime une prime.
   */
  const saisie = String(valeur ?? '').trim().replace(',', '.');
  const montant = Number(saisie);
  if (saisie === '' || !Number.isFinite(montant) || montant < 0) {
    return { erreur: 'Indiquez un montant (zéro accepté, vide non).', code: 400 };
  }

  const an = Number(annee);
  const m = Number(mois);
  if (!Number.isInteger(an) || an < 2020 || an > 2100) return { erreur: 'Annee invalide.', code: 400 };
  if (!Number.isInteger(m) || m < 1 || m > 12) return { erreur: 'Mois invalide (1 a 12).', code: 400 };

  const debut = premierDuMois(an, m);
  // Ce que ce mois valait AVANT le changement — pas seulement ce qui portait
  // deja cette date d'effet. C'est ce qu'on veut lire dans six mois : « le
  // panier est passe de 12,20 a 12,50 a compter de janvier ».
  const avant = tauxDuMois(an, m)[cle];

  db.prepare(
    `INSERT INTO taux (cle, valeur, debut, note, cree_par) VALUES (@cle, @valeur, @debut, @note, @par)
     ON CONFLICT (cle, debut) DO UPDATE SET valeur = @valeur, note = @note, cree_par = @par,
                                            cree_le = datetime('now')`
  ).run({ cle, valeur: montant, debut, note: String(note || '').trim().slice(0, 300), par: utilisateur ? utilisateur.id : null });

  const libelle = (CATALOGUE.find((t) => t.cle === cle) || {}).libelle || cle;
  journaliser(
    null,
    utilisateur ? utilisateur.id : null,
    'taux_modifie',
    `${libelle} : ${avant === montant ? '' : `${avant} → `}${montant} à compter du ${debut}`
  );
  return { ok: true, cle, valeur: montant, debut };
}

/** Retire une date d'effet. L'amorce d'origine, elle, ne se retire pas. */
function supprimer(id, utilisateur) {
  const ligne = db.prepare('SELECT cle, valeur, debut FROM taux WHERE id = ?').get(Number(id));
  if (!ligne) return { erreur: 'Taux introuvable.', code: 404 };
  if (ligne.debut === DEBUT_ORIGINE) {
    return { erreur: 'La valeur d’origine ne se supprime pas : donnez-lui plutôt une nouvelle date d’effet.', code: 409 };
  }

  db.prepare('DELETE FROM taux WHERE id = ?').run(Number(id));
  journaliser(
    null,
    utilisateur ? utilisateur.id : null,
    'taux_supprime',
    `${ligne.cle} : ${ligne.valeur} du ${ligne.debut}`
  );
  return { ok: true };
}

amorcer();

module.exports = { CATALOGUE, CLES, DEFAUTS, DEBUT_ORIGINE, tauxDuMois, historique, definir, supprimer };
