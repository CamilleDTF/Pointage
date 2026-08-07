'use strict';

const { db, journaliser } = require('./db');
const D = require('./domaine');

/**
 * Contexte des controles : le nombre de conducteurs de travaux proposables. Le
 * choix d'un conducteur n'est exige que s'il y en a — une organisation ou
 * personne n'est encore enregistre ne doit pas se retrouver bloquee.
 */
function optionsControle() {
  return {
    conducteursDisponibles: db
      .prepare("SELECT COUNT(*) AS n FROM utilisateurs WHERE role = 'conducteur' AND actif = 1")
      .get().n,
  };
}

const NB_LIGNES_FICHE = 11; // la fiche papier comporte 11 lignes de salaries (lignes 11 a 21).

function normaliserLigne(brut, ordre) {
  const jours = [];
  for (let j = 0; j < 7; j += 1) {
    const source = (brut.jours || []).find((x) => Number(x.jour) === j) || {};
    const minutes = Math.max(0, Math.round(Number(source.minutes) || 0));
    jours.push({
      jour: j,
      minutes,
      code_absence: String(source.code_absence || '').trim().toUpperCase().slice(0, 4),
      // Des heures saisies valent declaration, meme si le client n a pas envoye
      // le drapeau : seul le zero explicite a besoin d etre marque.
      saisi: source.saisi || minutes > 0 ? 1 : 0,
    });
  }
  const gd72 = Math.max(0, Math.round(Number(brut.nb_gd72) || 0));
  const gd80 = Math.max(0, Math.round(Number(brut.nb_gd80) || 0));

  return {
    salarie_id: brut.salarie_id ? Number(brut.salarie_id) : null,
    nom_affiche: String(brut.nom_affiche || '').trim().slice(0, 120),
    ordre,
    minutes_route: Math.max(0, Math.round(Number(brut.minutes_route) || 0)),
    minutes_trajet: Math.max(0, Math.round(Number(brut.minutes_trajet) || 0)),
    jours_zone: Math.max(0, Number(brut.jours_zone) || 0),
    type_masque: D.TYPES_MASQUE.includes(String(brut.type_masque || '').toUpperCase())
      ? String(brut.type_masque || '').toUpperCase()
      : '',
    // Jours de grand deplacement, comptes par le chef : c'est lui qui sait sous
    // quel taux chaque journee est tombee.
    nb_gd72: gd72,
    nb_gd80: gd80,
    /*
     * « Nb depl. » de la fiche papier : ce n'est plus une saisie, c'est la somme
     * des deux colonnes de GD. Le chef comptait le meme nombre deux fois, et
     * l'exemplaire papier a toujours besoin de sa colonne.
     */
    nb_deplacement: gd72 + gd80 || Math.max(0, Math.round(Number(brut.nb_deplacement) || 0)),
    observation: String(brut.observation || '').trim().slice(0, 500),
    signature: typeof brut.signature === 'string' && brut.signature.startsWith('data:image/')
      ? brut.signature.slice(0, 200000)
      : brut.signature === null
        ? null
        : undefined,
    jours,
  };
}

function obtenirFiche(id) {
  const fiche = db
    .prepare(
      `SELECT f.*, u.nom AS chef_nom
         FROM fiches f
         JOIN utilisateurs u ON u.id = f.chef_id
        WHERE f.id = ?`
    )
    .get(id);
  if (!fiche) return null;

  const lignes = db
    .prepare('SELECT * FROM fiche_lignes WHERE fiche_id = ? ORDER BY ordre, id')
    .all(id);
  const jours = db
    .prepare(
      `SELECT j.* FROM fiche_jours j
         JOIN fiche_lignes l ON l.id = j.ligne_id
        WHERE l.fiche_id = ?`
    )
    .all(id);

  for (const ligne of lignes) {
    ligne.jours = jours
      .filter((j) => j.ligne_id === ligne.id)
      .sort((a, b) => a.jour - b.jour)
      .map((j) => ({ jour: j.jour, minutes: j.minutes, code_absence: j.code_absence, saisi: j.saisi ? 1 : 0 }));
    for (let j = 0; j < 7; j += 1) {
      if (!ligne.jours.some((x) => x.jour === j)) {
        ligne.jours.splice(j, 0, { jour: j, minutes: 0, code_absence: '', saisi: 0 });
      }
    }
    ligne.total_minutes = D.totalMinutesLigne(ligne);
  }

  fiche.lignes = lignes;
  fiche.dates = D.datesDeLaSemaine(fiche.annee, fiche.semaine);
  fiche.total_minutes = lignes.reduce((s, l) => s + l.total_minutes, 0);
  return fiche;
}

/**
 * La fiche salarie du chef d'equipe. Le chef travaille sur le chantier comme
 * ses operateurs : il doit figurer sur sa propre fiche, sans quoi ses heures
 * n'arrivent jamais dans le tableau mensuel.
 *
 * Son compte de connexion vit dans `utilisateurs`, sa paie dans `salaries` :
 * on rapproche les deux par le nom, et on cree la fiche salarie si elle manque.
 * L'appel est idempotent — il ne cree jamais de doublon.
 */
function salarieDuChef(chefId) {
  const chef = db.prepare("SELECT id, nom FROM utilisateurs WHERE id = ? AND role = 'chef'").get(chefId);
  if (!chef) return null;

  const existant = db
    .prepare('SELECT id, nom, prenom, chef_id FROM salaries')
    .all()
    .find((s) => D.memePersonne(`${s.nom} ${s.prenom}`, chef.nom));

  if (existant) {
    // Un chef d equipe se rattache a lui-meme : c'est ce qui le fait
    // apparaitre dans sa propre equipe. On ne le retire pas d'une equipe ou le
    // directeur l'aurait volontairement place.
    if (existant.chef_id === null) {
      db.prepare('UPDATE salaries SET chef_id = ?, actif = 1 WHERE id = ?').run(chefId, existant.id);
    }
    return existant.id;
  }

  const { nom, prenom } = D.separerNomPrenom(chef.nom);
  return db
    .prepare('INSERT INTO salaries (nom, prenom, chef_id) VALUES (?, ?, ?)')
    .run(nom, prenom, chefId).lastInsertRowid;
}

/**
 * L'equipe telle qu'elle se presente sur la fiche : le chef d'equipe d'abord,
 * puis ses operateurs par ordre alphabetique.
 */
function equipeDuChef(chefId) {
  const idChef = salarieDuChef(chefId);
  const operateurs = db
    .prepare('SELECT id, nom, prenom, matricule FROM salaries WHERE chef_id = ? AND actif = 1 ORDER BY nom, prenom')
    .all(chefId);

  const lui = idChef
    ? operateurs.find((s) => s.id === idChef)
      || db.prepare('SELECT id, nom, prenom, matricule FROM salaries WHERE id = ? AND actif = 1').get(idChef)
    : null;

  return lui ? [lui, ...operateurs.filter((s) => s.id !== lui.id)] : operateurs;
}

/** Recupere le brouillon de la semaine pour ce chef, ou le cree pre-rempli avec son equipe. */
function obtenirOuCreerFicheSemaine(chefId, annee, semaine) {
  const existante = db
    .prepare(
      `SELECT id FROM fiches
        WHERE chef_id = ? AND annee = ? AND semaine = ?
        ORDER BY CASE statut WHEN 'brouillon' THEN 0 WHEN 'rejetee' THEN 1 ELSE 2 END, id DESC
        LIMIT 1`
    )
    .get(chefId, annee, semaine);
  if (existante) return obtenirFiche(existante.id);

  const equipe = equipeDuChef(chefId);

  const creer = db.transaction(() => {
    const res = db
      .prepare('INSERT INTO fiches (chef_id, annee, semaine) VALUES (?, ?, ?)')
      .run(chefId, annee, semaine);
    const ficheId = res.lastInsertRowid;
    const insLigne = db.prepare(
      'INSERT INTO fiche_lignes (fiche_id, salarie_id, nom_affiche, ordre) VALUES (?, ?, ?, ?)'
    );
    const insJour = db.prepare('INSERT INTO fiche_jours (ligne_id, jour) VALUES (?, ?)');
    for (let i = 0; i < NB_LIGNES_FICHE; i += 1) {
      const membre = equipe[i];
      const r = insLigne.run(
        ficheId,
        membre ? membre.id : null,
        membre ? `${membre.nom.toUpperCase()} ${membre.prenom}` : '',
        i
      );
      for (let j = 0; j < 7; j += 1) insJour.run(r.lastInsertRowid, j);
    }
    journaliser(ficheId, chefId, 'creation', `Semaine ${semaine}/${annee}`);
    return ficheId;
  });

  return obtenirFiche(creer());
}

const CHAMPS_ENTETE = [
  'chantier',
  'ville',
  'zone_deplacement',
  'conducteur_vehicule',
  'type_vehicule',
  'immatriculation',
  'observations_pointage',
  'commentaire_responsable',
  'nom_responsable',
  'visa_conducteur',
];

/** Ecrit l'entete et remplace integralement les lignes. Renvoie la fiche a jour. */
function enregistrerFiche(ficheId, corps, utilisateur) {
  const fiche = db.prepare('SELECT * FROM fiches WHERE id = ?').get(ficheId);
  if (!fiche) return { erreur: 'Fiche introuvable.', code: 404 };

  const estDirecteur = utilisateur.role === 'directeur';
  if (!estDirecteur && fiche.chef_id !== utilisateur.id) {
    return { erreur: 'Cette fiche appartient a un autre chef d equipe.', code: 403 };
  }
  if (!estDirecteur && !['brouillon', 'rejetee'].includes(fiche.statut)) {
    return {
      erreur: 'Fiche deja transmise au directeur : elle n est plus modifiable. Demandez sa reouverture.',
      code: 409,
    };
  }

  // Une mise a jour qui ne porte que sur l entete ne touche pas aux lignes :
  // sans ce garde-fou, un PUT partiel effacerait toute la saisie de la semaine.
  const remplacerLignes = Array.isArray(corps.lignes);
  const lignes = remplacerLignes ? corps.lignes.slice(0, NB_LIGNES_FICHE).map(normaliserLigne) : [];

  const ecrire = db.transaction(() => {
    const maj = {};
    for (const champ of CHAMPS_ENTETE) {
      if (corps[champ] !== undefined) maj[champ] = String(corps[champ] || '').slice(0, 2000);
    }
    // Le conducteur est un identifiant, pas un texte : on le range comme tel,
    // ou a null quand le chef n'a rien choisi.
    if (corps.conducteur_id !== undefined) {
      const choisi = Number(corps.conducteur_id);
      db.prepare('UPDATE fiches SET conducteur_id = ? WHERE id = ?')
        .run(Number.isInteger(choisi) && choisi > 0 ? choisi : null, ficheId);
    }
    if (typeof corps.signature_responsable === 'string' && corps.signature_responsable.startsWith('data:image/')) {
      maj.signature_responsable = corps.signature_responsable.slice(0, 200000);
    }
    if (Object.keys(maj).length) {
      const set = Object.keys(maj).map((c) => `${c} = @${c}`).join(', ');
      db.prepare(`UPDATE fiches SET ${set}, maj_le = datetime('now') WHERE id = @id`).run({ ...maj, id: ficheId });
    } else {
      db.prepare("UPDATE fiches SET maj_le = datetime('now') WHERE id = ?").run(ficheId);
    }

    if (remplacerLignes) {
      const anciennes = db
        .prepare('SELECT id, signature FROM fiche_lignes WHERE fiche_id = ? ORDER BY ordre, id')
        .all(ficheId);
      db.prepare('DELETE FROM fiche_lignes WHERE fiche_id = ?').run(ficheId);

      const insLigne = db.prepare(
        `INSERT INTO fiche_lignes
           (fiche_id, salarie_id, nom_affiche, ordre, minutes_route, minutes_trajet,
            jours_zone, type_masque, nb_deplacement, nb_gd72, nb_gd80, observation, signature)
         VALUES (@fiche_id, @salarie_id, @nom_affiche, @ordre, @minutes_route, @minutes_trajet,
                 @jours_zone, @type_masque, @nb_deplacement, @nb_gd72, @nb_gd80, @observation, @signature)`
      );
      const insJour = db.prepare(
        'INSERT INTO fiche_jours (ligne_id, jour, minutes, code_absence, saisi) VALUES (?, ?, ?, ?, ?)'
      );

      lignes.forEach((ligne, i) => {
        // signature === undefined : le client ne l a pas renvoyee, on conserve l existante.
        const signature = ligne.signature === undefined ? (anciennes[i] || {}).signature ?? null : ligne.signature;
        const r = insLigne.run({ ...ligne, fiche_id: ficheId, signature });
        for (const jour of ligne.jours) {
          insJour.run(r.lastInsertRowid, jour.jour, jour.minutes, jour.code_absence, jour.saisi);
        }
      });
    }

    if (estDirecteur && fiche.chef_id !== utilisateur.id) {
      journaliser(ficheId, utilisateur.id, 'correction_directeur', 'Fiche corrigee par le directeur');
    }
  });

  ecrire();
  return { fiche: obtenirFiche(ficheId) };
}

function soumettre(ficheId, utilisateur) {
  const fiche = obtenirFiche(ficheId);
  if (!fiche) return { erreur: 'Fiche introuvable.', code: 404 };
  if (utilisateur.role !== 'directeur' && fiche.chef_id !== utilisateur.id) {
    return { erreur: 'Cette fiche appartient a un autre chef d equipe.', code: 403 };
  }
  if (!['brouillon', 'rejetee'].includes(fiche.statut)) {
    return { erreur: 'Fiche deja transmise.', code: 409 };
  }

  const anomalies = D.controlerFiche(fiche, fiche.lignes, optionsControle());
  const bloquantes = anomalies.filter((a) => a.niveau === 'bloquant');
  if (bloquantes.length) return { erreur: 'La fiche est incomplete.', anomalies, code: 422 };

  // `premiere_soumission_le` ne s'ecrit qu'une fois : c'est elle qui mesure la
  // ponctualite, et une correction ne doit pas effacer le fait d'avoir rendu a
  // temps. `soumise_le` continue de suivre la derniere version.
  db.prepare(
    `UPDATE fiches SET statut = 'soumise', soumise_le = datetime('now'),
            premiere_soumission_le = COALESCE(premiere_soumission_le, datetime('now')),
            motif_rejet = '', maj_le = datetime('now') WHERE id = ?`
  ).run(ficheId);
  journaliser(ficheId, utilisateur.id, 'soumission', `Semaine ${fiche.semaine}/${fiche.annee}`);
  return { fiche: obtenirFiche(ficheId), anomalies };
}

/**
 * Le chef reprend sa fiche pour la corriger.
 *
 * Une fiche transmise n'etait plus modifiable, et il fallait demander sa
 * reouverture au directeur pour une virgule. Le chef peut desormais la
 * reprendre lui-meme — tant qu'elle n'est pas validee : apres validation, elle
 * est partie en paie, et la rouvrir devient une decision de la direction.
 *
 * Reprendre annule le visa en cours. C'est indispensable, pas un effet de bord :
 * un conducteur qui a vise une version ne doit pas se retrouver signataire d'une
 * autre. Le secret de la fiche est efface, ce qui condamne les liens deja
 * envoyes, et la fiche disparait de la liste du conducteur.
 */
function reprendre(ficheId, utilisateur) {
  const fiche = db.prepare('SELECT * FROM fiches WHERE id = ?').get(ficheId);
  if (!fiche) return { erreur: 'Fiche introuvable.', code: 404 };
  if (utilisateur.role !== 'directeur' && fiche.chef_id !== utilisateur.id) {
    return { erreur: 'Cette fiche appartient a un autre chef d equipe.', code: 403 };
  }
  if (fiche.statut === 'validee') {
    return {
      erreur: 'Cette fiche est deja validee par la direction : demandez sa reouverture.',
      code: 409,
    };
  }
  if (['brouillon', 'rejetee'].includes(fiche.statut)) {
    return { fiche: obtenirFiche(ficheId), deja: true };
  }

  const visaEnCours = fiche.visa_statut === 'attente' || fiche.visa_statut === 'vise';
  db.prepare(
    `UPDATE fiches SET statut = 'brouillon', soumise_le = NULL,
            visa_statut = '', visa_jeton = NULL, visa_le = NULL, visa_conducteur = '',
            maj_le = datetime('now')
      WHERE id = ?`
  ).run(ficheId);

  journaliser(ficheId, utilisateur.id, 'reprise_chef', visaEnCours ? 'visa en cours annule' : '');
  return { fiche: obtenirFiche(ficheId), visaAnnule: visaEnCours };
}

function statuer(ficheId, utilisateur, decision, motif = '') {
  const fiche = obtenirFiche(ficheId);
  if (!fiche) return { erreur: 'Fiche introuvable.', code: 404 };

  if (decision === 'valider') {
    const bloquantes = D.controlerFiche(fiche, fiche.lignes, optionsControle()).filter((a) => a.niveau === 'bloquant');
    if (bloquantes.length) {
      return { erreur: 'Fiche incomplete, validation impossible.', anomalies: bloquantes, code: 422 };
    }
    db.prepare(
      `UPDATE fiches SET statut = 'validee', validee_le = datetime('now'), validee_par = ?,
              motif_rejet = '', maj_le = datetime('now') WHERE id = ?`
    ).run(utilisateur.id, ficheId);
    journaliser(ficheId, utilisateur.id, 'validation', '');
  } else if (decision === 'rejeter') {
    if (!String(motif).trim()) return { erreur: 'Indiquez le motif du renvoi au chef d equipe.', code: 400 };
    db.prepare(
      `UPDATE fiches SET statut = 'rejetee', motif_rejet = ?, validee_le = NULL,
              validee_par = NULL, maj_le = datetime('now') WHERE id = ?`
    ).run(String(motif).trim().slice(0, 1000), ficheId);
    journaliser(ficheId, utilisateur.id, 'rejet', String(motif).trim().slice(0, 1000));
  } else if (decision === 'rouvrir') {
    db.prepare(
      `UPDATE fiches SET statut = 'brouillon', validee_le = NULL, validee_par = NULL,
              soumise_le = NULL, maj_le = datetime('now') WHERE id = ?`
    ).run(ficheId);
    journaliser(ficheId, utilisateur.id, 'reouverture', '');
  } else {
    return { erreur: 'Decision inconnue.', code: 400 };
  }

  return { fiche: obtenirFiche(ficheId) };
}

function listerFiches({ annee, semaine, statut, chefId } = {}) {
  const conditions = [];
  const params = {};
  if (annee) { conditions.push('f.annee = @annee'); params.annee = Number(annee); }
  if (semaine) { conditions.push('f.semaine = @semaine'); params.semaine = Number(semaine); }
  if (statut) { conditions.push('f.statut = @statut'); params.statut = statut; }
  if (chefId) { conditions.push('f.chef_id = @chefId'); params.chefId = Number(chefId); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  return db
    .prepare(
      `SELECT f.id, f.annee, f.semaine, f.chantier, f.ville, f.statut, f.soumise_le,
              f.validee_le, f.motif_rejet, f.chef_id, f.conducteur_id, f.premiere_soumission_le,
              f.visa_statut, f.visa_le,
              f.visa_courriel, f.visa_commentaire, f.visa_envoye_le, u.nom AS chef_nom,
              (SELECT COUNT(*) FROM fiche_lignes l
                WHERE l.fiche_id = f.id AND TRIM(l.nom_affiche) <> '') AS nb_salaries,
              (SELECT COALESCE(SUM(j.minutes), 0) FROM fiche_jours j
                 JOIN fiche_lignes l2 ON l2.id = j.ligne_id
                WHERE l2.fiche_id = f.id) AS total_minutes
         FROM fiches f
         JOIN utilisateurs u ON u.id = f.chef_id
         ${where}
        ORDER BY f.annee DESC, f.semaine DESC, u.nom`
    )
    .all(params);
}

/** Lignes a plat pour les exports et le tableau de bord. */
function lignesPourExport({ annee, semaine, statut }) {
  const conditions = [];
  const params = {};
  if (annee) { conditions.push('f.annee = @annee'); params.annee = Number(annee); }
  if (semaine) { conditions.push('f.semaine = @semaine'); params.semaine = Number(semaine); }
  if (statut) { conditions.push('f.statut = @statut'); params.statut = statut; }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const lignes = db
    .prepare(
      `SELECT l.*, f.annee, f.semaine, f.chantier, f.ville, f.statut, f.id AS fiche_id,
              u.nom AS chef_nom, s.matricule
         FROM fiche_lignes l
         JOIN fiches f ON f.id = l.fiche_id
         JOIN utilisateurs u ON u.id = f.chef_id
         LEFT JOIN salaries s ON s.id = l.salarie_id
         ${where} ${where ? 'AND' : 'WHERE'} TRIM(l.nom_affiche) <> ''
        ORDER BY f.annee, f.semaine, u.nom, l.ordre`
    )
    .all(params);

  const jours = db.prepare('SELECT * FROM fiche_jours WHERE ligne_id = ? ORDER BY jour');
  for (const ligne of lignes) {
    ligne.jours = jours.all(ligne.id);
    ligne.total_minutes = D.totalMinutesLigne(ligne);
    ligne.dates = D.datesDeLaSemaine(ligne.annee, ligne.semaine);
  }
  return lignes;
}

module.exports = {
  NB_LIGNES_FICHE,
  optionsControle,
  salarieDuChef,
  equipeDuChef,
  obtenirFiche,
  obtenirOuCreerFicheSemaine,
  enregistrerFiche,
  soumettre,
  reprendre,
  statuer,
  listerFiches,
  lignesPourExport,
};
