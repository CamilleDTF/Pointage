'use strict';

/*
 * Le personnel non productif : administratif, encadrement, atelier.
 *
 * Il ne figure sur aucune fiche de chantier — ni chef d'equipe, ni pointage
 * hebdomadaire — mais sa paie se prepare de la meme facon, et le directeur en a
 * besoin. D'ou ce second calendrier, qui repose sur une regle plus simple : ils
 * sont a 7 h par jour ouvre.
 *
 * Ce sont donc les EXCEPTIONS qui se saisissent, pas les journees. Une absence,
 * un grand deplacement : voila ce qui merite d'etre note. Une journee ordinaire
 * ne laisse aucune trace en base, et un mois sans histoire ne coute rien —
 * personne n'a a cliquer vingt fois pour dire que rien ne s'est passe.
 */

const { db, journaliser } = require('./db');
const D = require('./domaine');
const T = require('./taux');
const COFFRE = require('./coffre');

/** Les jours du mois, avec ce qui distingue un jour ouvre d'un week-end. */
function joursDuMois(annee, mois) {
  const dernier = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  const jours = [];
  for (let q = 1; q <= dernier; q += 1) {
    const date = `${annee}-${String(mois).padStart(2, '0')}-${String(q).padStart(2, '0')}`;
    const jourSemaine = new Date(`${date}T00:00:00Z`).getUTCDay();
    jours.push({ date, quantieme: q, jourSemaine, ouvre: jourSemaine >= 1 && jourSemaine <= 5 });
  }
  return jours;
}

/**
 * Le mois complet : une ligne par personne, une colonne par jour.
 *
 * L'etat d'une case se lit dans l'ordre du plus precis au plus general : ce que
 * le directeur a declare l'emporte sur la regle, et la regle sur le calendrier.
 */
function moisComplet(annee, mois, cleCoffre = null) {
  const jours = joursDuMois(annee, mois);
  const premier = jours[0].date;
  const dernier = jours[jours.length - 1].date;

  const personnes = db
    .prepare(
      `SELECT id, matricule, nom, prenom, taux_horaire, taux_horaire_scelle
         FROM salaries WHERE actif = 1 AND productif = 0 ORDER BY nom, prenom`
    )
    .all()
    /*
     * Le taux est resolu ici, une fois, et les colonnes brutes disparaissent.
     * Ainsi rien en aval n'a besoin de savoir si le coffre existe : la suite du
     * calcul lit un nombre, comme avant, et le scelle ne part dans aucune
     * reponse d'API.
     */
    .map(({ taux_horaire, taux_horaire_scelle, ...reste }) => ({
      ...reste,
      tauxHoraire:
        COFFRE.montantDe(cleCoffre, { taux_horaire, taux_horaire_scelle }, 'taux_horaire', 'taux_horaire_scelle')
        || 0,
    }));

  const declares = db
    .prepare(
      `SELECT salarie_id, date, code_absence, minutes, gd
         FROM jours_non_productifs WHERE date BETWEEN ? AND ?`
    )
    .all(premier, dernier);
  const parPersonne = new Map();
  for (const d of declares) {
    if (!parPersonne.has(d.salarie_id)) parPersonne.set(d.salarie_id, new Map());
    parPersonne.get(d.salarie_id).set(d.date, d);
  }

  // Les conges du registre valent pour tout le monde : ils expliquent une
  // absence sans qu'on ait a la ressaisir ici.
  const conges = db
    .prepare(
      `SELECT salarie_id, debut, fin, motif FROM conges
        WHERE fin >= ? AND debut <= ?`
    )
    .all(premier, dernier);

  const lignes = personnes.map((personne) => {
    const siens = parPersonne.get(personne.id) || new Map();
    const sesConges = conges.filter((c) => c.salarie_id === personne.id);

    const cases = jours.map((jour) => {
      const declare = siens.get(jour.date);
      const conge = sesConges.find((c) => jour.date >= c.debut && jour.date <= c.fin);

      if (declare && declare.code_absence) {
        return { ...jour, etat: 'absence', code: declare.code_absence, minutes: declare.minutes, gd: declare.gd };
      }
      if (declare && declare.gd) {
        return { ...jour, etat: 'gd', gd: declare.gd, minutes: declare.minutes || minutesParDefaut(jour) };
      }
      if (declare && declare.minutes !== null && declare.minutes !== undefined && declare.minutes !== minutesParDefaut(jour)) {
        return { ...jour, etat: jour.ouvre ? 'partiel' : 'travaille', minutes: declare.minutes, gd: '' };
      }
      if (conge) return { ...jour, etat: 'conge', code: conge.motif, minutes: 0, gd: '' };
      if (!jour.ouvre) return { ...jour, etat: 'weekend', minutes: 0, gd: '' };
      return { ...jour, etat: 'travaille', minutes: D.DUREE_JOURNEE_REFERENCE_MINUTES, gd: '' };
    });

    return { ...personne, jours: cases, ...totaux(cases) };
  });

  const primes = db
    .prepare(
      `SELECT id, salarie_id, libelle, montant, montant_scelle FROM primes_non_productifs
        WHERE annee = ? AND mois = ? ORDER BY id`
    )
    .all(annee, mois)
    // Le scelle ne sort pas d'ici : ni ouvert sans cle, ni tel quel.
    .map(({ montant, montant_scelle, ...reste }) => ({
      ...reste,
      montant: COFFRE.montantDe(cleCoffre, { montant, montant_scelle }, 'montant', 'montant_scelle'),
    }));
  for (const ligne of lignes) {
    ligne.primes = primes.filter((p) => p.salarie_id === ligne.id);
    ligne.montantPrimes = ligne.primes.reduce((t, p) => t + (Number(p.montant) || 0), 0);
  }

  return {
    annee,
    mois,
    jours,
    joursOuvres: jours.filter((j) => j.ouvre).length,
    heuresReference: D.heuresReferenceMois(annee, mois),
    lignes,
  };
}

/** 7 h un jour ouvre, rien le week-end : la regle par defaut. */
const minutesParDefaut = (jour) => (jour.ouvre ? D.DUREE_JOURNEE_REFERENCE_MINUTES : 0);

function totaux(cases) {
  const compte = (predicat) => cases.filter(predicat).length;
  const absences = {};
  for (const c of cases) {
    if (c.etat === 'absence' || c.etat === 'conge') {
      absences[c.code] = (absences[c.code] || 0) + 1;
    }
  }

  return {
    joursTravailles: compte((c) => c.minutes > 0),
    minutes: cases.reduce((t, c) => t + (Number(c.minutes) || 0), 0),
    joursAbsence: compte((c) => c.etat === 'absence' || c.etat === 'conge'),
    absences,
    joursGD72: compte((c) => c.gd === '72'),
    joursGD80: compte((c) => c.gd === '80'),
  };
}

/**
 * Declare — ou efface — ce qui s'ecarte de l'ordinaire pour une journee.
 *
 * Revenir a la normale supprime la ligne plutot que d'ecrire un etat « rien » :
 * l'absence de ligne est deja la facon dont on dit qu'il ne s'est rien passe, et
 * deux facons de dire la meme chose finissent toujours par diverger.
 */
function declarerJour({ salarieId, date, code, gd, minutes }, utilisateur) {
  const personne = db
    .prepare('SELECT id, nom, prenom FROM salaries WHERE id = ? AND productif = 0')
    .get(Number(salarieId));
  if (!personne) return { erreur: 'Personne introuvable dans le personnel non productif.', code: 404 };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return { erreur: 'Date invalide.', code: 400 };

  const codeAbsence = String(code || '').trim().toUpperCase().slice(0, 4);
  if (codeAbsence && !D.CODES_ABSENCE.some((c) => c.code === codeAbsence)) {
    return { erreur: `Code absence « ${codeAbsence} » inconnu.`, code: 400 };
  }
  const taux = ['72', '80'].includes(String(gd || '')) ? String(gd) : '';
  const heures = minutes === undefined || minutes === null ? null : Math.max(0, Math.round(Number(minutes) || 0));

  if (!codeAbsence && !taux && heures === null) {
    db.prepare('DELETE FROM jours_non_productifs WHERE salarie_id = ? AND date = ?').run(personne.id, date);
    return { efface: true };
  }

  db.prepare(
    `INSERT INTO jours_non_productifs (salarie_id, date, code_absence, minutes, gd)
     VALUES (@salarie_id, @date, @code, @minutes, @gd)
     ON CONFLICT (salarie_id, date)
       DO UPDATE SET code_absence = @code, minutes = @minutes, gd = @gd`
  ).run({
    salarie_id: personne.id,
    date,
    code: codeAbsence,
    // Une absence ne se travaille pas ; un grand deplacement, si.
    minutes: heures !== null ? heures : codeAbsence ? 0 : D.DUREE_JOURNEE_REFERENCE_MINUTES,
    gd: taux,
  });

  journaliser(
    null,
    utilisateur ? utilisateur.id : null,
    'jour_non_productif',
    `${personne.nom} ${personne.prenom} ${date} : ${codeAbsence || (taux ? `GD ${taux}` : 'heures')}`
  );
  return { ok: true };
}

function ajouterPrime({ salarieId, annee, mois, libelle, montant }, utilisateur, cleCoffre = null) {
  const personne = db
    .prepare('SELECT id, nom, prenom FROM salaries WHERE id = ? AND productif = 0')
    .get(Number(salarieId));
  if (!personne) return { erreur: 'Personne introuvable dans le personnel non productif.', code: 404 };

  const somme = Number(montant);
  if (!Number.isFinite(somme) || somme === 0) return { erreur: 'Indiquez un montant.', code: 400 };

  const scelle = cleCoffre ? COFFRE.chiffrerMontant(cleCoffre, somme) : '';
  const r = db
    .prepare(
      `INSERT INTO primes_non_productifs (salarie_id, annee, mois, libelle, montant, montant_scelle)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      personne.id, Number(annee), Number(mois),
      String(libelle || '').trim().slice(0, 120),
      scelle ? 0 : somme,
      scelle
    );

  /*
   * Le journal dit qu'une prime a ete posee, et pour qui — jamais combien. Il
   * est lisible par qui tient l'application, et une somme qui s'y inscrirait
   * ferait sortir du coffre ce qu'on vient d'y ranger.
   */
  journaliser(
    null,
    utilisateur ? utilisateur.id : null,
    'prime_non_productif',
    `${personne.nom} ${personne.prenom} ${mois}/${annee} — ${libelle || 'sans motif'}`
  );
  return { id: r.lastInsertRowid };
}

function supprimerPrime(id) {
  const r = db.prepare('DELETE FROM primes_non_productifs WHERE id = ?').run(Number(id));
  return r.changes ? { ok: true } : { erreur: 'Prime introuvable.', code: 404 };
}

/*
 * Les heures supplementaires, semaine par semaine.
 *
 * Elles ne devraient pas exister — 7 h par jour font 35 h — mais le directeur
 * peut declarer des heures particulieres, et la majoration se calcule alors
 * comme partout ailleurs : sur la semaine, pas sur le mois.
 *
 * Seules comptent les journees du mois affiche. Une semaine a cheval sur deux
 * mois est donc vue par moities, chacune dans son tableau : c'est la meme
 * convention que le tableau des chantiers, et elle evite qu'un meme jour soit
 * paye deux fois.
 */
function heuresSupDuMois(cases) {
  const parSemaine = new Map();
  for (const c of cases) {
    if (!c.minutes) continue;
    const { annee, semaine } = D.semaineISO(new Date(`${c.date}T00:00:00Z`));
    const cle = `${annee}-${semaine}`;
    parSemaine.set(cle, (parSemaine.get(cle) || 0) + c.minutes);
  }

  let minutes25 = 0;
  let minutes50 = 0;
  for (const minutes of parSemaine.values()) {
    const sup = D.heuresSupplementaires(minutes);
    minutes25 += sup.minutes25;
    minutes50 += sup.minutes50;
  }
  return { minutes25, minutes50 };
}

/**
 * Valorisation d'un mois, aux memes taux que le tableau des chantiers.
 *
 * Sans taux horaire renseigne, rien n'est calcule : une case vide vaut mieux
 * qu'un salaire faux. C'est `tauxManquant` qui le signale a l'ecran.
 *
 * Les differences avec le chantier se voient : pas de prime amiante — ils ne
 * vont pas en zone — ni de panier repas, mais un TITRE-RESTAURANT (EDENRED) par
 * jour travaille, qui est propre a ce personnel. Les primes saisies sont
 * traitees comme du BRUT, soumis a charges : c'est le regime ordinaire d'une
 * prime, a la difference d'une indemnite de grand deplacement ou d'un
 * titre-restaurant, qui se versent nets.
 */
function valoriser(ligne, bareme = T.DEFAUTS) {
  const taux = Number(ligne.tauxHoraire) || 0;
  const h = (minutes) => (Number(minutes) || 0) / 60;
  const { minutes25, minutes50 } = heuresSupDuMois(ligne.jours);

  if (!taux) {
    return {
      tauxManquant: true, tauxHoraire: 0, minutes25, minutes50,
      salaireBrut: 0, salaireNet: 0, heuresSupBrut: 0, heuresSupNet: 0,
      grandDeplacement: 0, edenred: 0, primes: ligne.montantPrimes || 0, totalBrut: 0, totalNet: 0,
    };
  }

  const salaireBrut = bareme.heures_mensuelles * taux;
  const heuresSupBrut =
    taux * bareme.majoration_hs_25 * h(minutes25) + taux * bareme.majoration_hs_50 * h(minutes50);
  const grandDeplacement = ligne.joursGD72 * bareme.gd_72 + ligne.joursGD80 * bareme.gd_80;
  const primes = Number(ligne.montantPrimes) || 0;
  // Un titre-restaurant par jour travaille. Contrairement au panier du chantier,
  // il n'est pas retire les jours de grand deplacement : c'est un titre remis,
  // pas une indemnite de repas.
  const edenred = ligne.joursTravailles * bareme.edenred;

  const totalBrut = salaireBrut + heuresSupBrut + primes + grandDeplacement + edenred;
  return {
    tauxManquant: false,
    tauxHoraire: taux,
    minutes25,
    minutes50,
    salaireBrut,
    salaireNet: salaireBrut * bareme.part_net_estimee,
    heuresSupBrut,
    heuresSupNet: heuresSupBrut * bareme.part_net_estimee,
    primes,
    grandDeplacement,
    edenred,
    totalBrut,
    // Le grand deplacement et le titre-restaurant se versent nets. La prime,
    // elle, suit le salaire.
    totalNet:
      (salaireBrut + heuresSupBrut + primes) * bareme.part_net_estimee + grandDeplacement + edenred,
  };
}

/**
 * Le mois valorise, tel qu'il part a l'ecran comme au classeur.
 *
 * Une seule construction pour les deux : un tableau affiche et un tableau
 * telecharge qui ne diraient pas la meme chose seraient pires qu'un seul.
 */
function paieDuMois(annee, mois, cleCoffre = null) {
  const donnees = moisComplet(annee, mois, cleCoffre);
  // Les taux du mois demande : un mois passe se rejoue avec les siens.
  const bareme = T.tauxDuMois(annee, mois, cleCoffre);
  return {
    annee,
    mois,
    joursOuvres: donnees.joursOuvres,
    heuresReference: donnees.heuresReference,
    salaries: donnees.lignes.map((ligne) => ({
      matricule: ligne.matricule,
      nom: ligne.nom,
      prenom: ligne.prenom,
      joursTravailles: ligne.joursTravailles,
      minutes: ligne.minutes,
      joursAbsence: ligne.joursAbsence,
      absences: ligne.absences,
      joursGD72: ligne.joursGD72,
      joursGD80: ligne.joursGD80,
      detailPrimes: ligne.primes,
      ...valoriser(ligne, bareme),
    })),
  };
}

module.exports = {
  moisComplet,
  joursDuMois,
  declarerJour,
  ajouterPrime,
  supprimerPrime,
  valoriser,
  paieDuMois,
};
