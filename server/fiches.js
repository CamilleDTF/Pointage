'use strict';

const { db, journaliser } = require('./db');
const D = require('./domaine');

/*
 * Ce que les regles ne peuvent pas savoir en regardant une seule fiche.
 *
 * Deux choses. Le nombre de conducteurs proposables, d'abord : le choix d'un
 * conducteur n'est exige que s'il y en a — une organisation ou personne n'est
 * encore enregistre ne doit pas se retrouver bloquee par une etape qui n'existe
 * pas chez elle.
 *
 * Et surtout, ce qui est deja pointe AILLEURS dans la semaine pour les memes
 * personnes. Un chef peut tenir deux chantiers a la fois, et un operateur
 * travailler sur les deux. Les controles raisonnaient alors sur des moities de
 * semaine : 30 h ici et 25 h la-bas passaient deux fois sous le plafond de 48 h,
 * et cinq jours de grand deplacement declares de chaque cote en faisaient dix.
 *
 * La regle ne change pas de nature — elle reste la meme des deux cotes du
 * reseau. Elle recoit simplement ce qu'elle ne pouvait pas deviner.
 */
function optionsControle(fiche) {
  return {
    conducteursDisponibles: db
      .prepare("SELECT COUNT(*) AS n FROM utilisateurs WHERE role = 'conducteur' AND actif = 1")
      .get().n,
    ailleurs: pointagesDeLaSemaine(fiche),
  };
}

/**
 * Les journees pointees sur les AUTRES fiches de la semaine, par personne.
 *
 * Toutes les fiches de la semaine, pas seulement celles de ce chef : le plafond
 * de 48 h porte sur la semaine d'un homme, quel que soit le nombre d'equipes
 * qu'il a traversees. En revanche on ne nomme que les chantiers de ce chef —
 * savoir qu'un operateur a travaille ailleurs suffit, connaitre le chantier d'un
 * collegue ne le regarde pas.
 */
function pointagesDeLaSemaine(fiche) {
  if (!fiche || !fiche.annee || !fiche.semaine) return {};

  const lignes = db
    .prepare(
      `SELECT l.id, l.salarie_id, l.nom_affiche, l.jours_zone, l.nb_gd72, l.nb_gd80,
              f.chantier, f.chef_id
         FROM fiche_lignes l
         JOIN fiches f ON f.id = l.fiche_id
        WHERE f.annee = @annee AND f.semaine = @semaine AND f.id <> @id
          AND TRIM(l.nom_affiche) <> ''`
    )
    .all({ annee: fiche.annee, semaine: fiche.semaine, id: fiche.id || 0 });
  if (!lignes.length) return {};

  const jours = db.prepare('SELECT jour, minutes FROM fiche_jours WHERE ligne_id = ?');
  const parPersonne = {};

  for (const ligne of lignes) {
    const cle = D.clePointage(ligne);
    const cumul = (parPersonne[cle] = parPersonne[cle] || {
      minutes: [0, 0, 0, 0, 0, 0, 0],
      minutesTotal: 0,
      joursTravailles: 0,
      joursGD: 0,
      joursZone: 0,
      chantiers: [],
      autresEquipes: false,
    });

    for (const jour of jours.all(ligne.id)) {
      const minutes = Number(jour.minutes) || 0;
      if (!minutes) continue;
      if (!cumul.minutes[jour.jour]) cumul.joursTravailles += 1;
      cumul.minutes[jour.jour] += minutes;
      cumul.minutesTotal += minutes;
    }

    cumul.joursGD += (Number(ligne.nb_gd72) || 0) + (Number(ligne.nb_gd80) || 0);
    cumul.joursZone += Number(ligne.jours_zone) || 0;

    if (ligne.chef_id !== fiche.chef_id) {
      cumul.autresEquipes = true;
    } else {
      const nom = String(ligne.chantier || '').trim();
      if (nom && !cumul.chantiers.includes(nom)) cumul.chantiers.push(nom);
    }
  }

  return parPersonne;
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

  const nom = String(brut.nom_affiche || '').trim().slice(0, 120);

  return {
    /*
     * Une ligne sans nom n'est rattachee a personne. Sans ce garde-fou, effacer
     * un nom laisserait son numero de salarie accroche a la ligne vide : le
     * suivant qu'on y inscrirait heriterait de son identite, et ses heures
     * partiraient en paie sous le mauvais nom.
     */
    salarie_id: nom && brut.salarie_id ? Number(brut.salarie_id) : null,
    nom_affiche: nom,
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
    .prepare('SELECT id, nom, prenom, chef_id FROM salaries WHERE productif = 1')
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
    .prepare(
      'SELECT id, nom, prenom, matricule FROM salaries WHERE chef_id = ? AND actif = 1 AND productif = 1 ORDER BY nom, prenom'
    )
    .all(chefId);

  const lui = idChef
    ? operateurs.find((s) => s.id === idChef)
      || db.prepare('SELECT id, nom, prenom, matricule FROM salaries WHERE id = ? AND actif = 1 AND productif = 1').get(idChef)
    : null;

  return lui ? [lui, ...operateurs.filter((s) => s.id !== lui.id)] : operateurs;
}

/** Recupere le brouillon de la semaine pour ce chef, ou le cree pre-rempli avec son equipe. */
function obtenirOuCreerFicheSemaine(chefId, annee, semaine) {
  const existante = db
    .prepare(
      /*
       * Ce qui reste a faire d'abord, puis la plus ancienne : depuis qu'une
       * semaine peut porter deux chantiers, « id DESC » ouvrait la derniere
       * creee, et le chef ne retrouvait plus sa fiche principale en revenant.
       */
      `SELECT id FROM fiches
        WHERE chef_id = ? AND annee = ? AND semaine = ?
        ORDER BY CASE statut WHEN 'brouillon' THEN 0 WHEN 'rejetee' THEN 1 ELSE 2 END, id
        LIMIT 1`
    )
    .get(chefId, annee, semaine);
  if (existante) return obtenirFiche(existante.id);
  return creerFicheSemaine(chefId, annee, semaine);
}

/**
 * Les fiches d'un chef pour une semaine, dans l'ordre ou il les a ouvertes.
 *
 * Il y en a une par chantier. Une seule le plus souvent — mais un chef peut en
 * tenir deux a la fois, et la fiche papier a toujours ete une feuille par
 * chantier.
 */
function fichesDeLaSemaine(chefId, annee, semaine) {
  return db
    .prepare(
      `SELECT id, chantier, ville, statut, visa_statut
         FROM fiches WHERE chef_id = ? AND annee = ? AND semaine = ? ORDER BY id`
    )
    .all(chefId, annee, semaine);
}

/**
 * Ouvre une fiche de plus pour la semaine, sur un second chantier.
 *
 * Le nom du chantier est demande des l'ouverture, et ce n'est pas une formalite :
 * c'est lui qui distingue les fiches d'une meme semaine, jusque dans la
 * contrainte d'unicite de la base. Deux fiches sans nom n'en feraient qu'une.
 */
function ouvrirFicheSupplementaire(chefId, annee, semaine, chantier) {
  const nom = String(chantier || '').trim().slice(0, 200);
  if (!nom) {
    return { erreur: 'Donnez le nom du second chantier : c est lui qui distingue les deux fiches.', code: 400 };
  }

  const existantes = fichesDeLaSemaine(chefId, annee, semaine);
  if (!existantes.length) {
    return { erreur: 'Ouvrez d abord la fiche de la semaine.', code: 400 };
  }
  if (existantes.some((f) => D.sansAccents(f.chantier).trim().toLowerCase() === D.sansAccents(nom).trim().toLowerCase())) {
    return { erreur: `Une fiche existe deja cette semaine pour « ${nom} ».`, code: 409 };
  }

  return { fiche: creerFicheSemaine(chefId, annee, semaine, nom, { avecEquipe: false }) };
}

/*
 * `avecEquipe` distingue la premiere fiche de la semaine des suivantes.
 *
 * La premiere s'ouvre pre-remplie avec l'equipe : c'est la situation ordinaire,
 * tout le monde est sur le meme chantier. Une seconde fiche, elle, s'ouvre vide.
 * Y reporter l'equipe entiere serait a rebours de la raison meme de son
 * existence — le chef l'ouvre parce qu'une PARTIE de son monde est ailleurs — et
 * lui vaudrait une anomalie par personne et par jour pour des gens qui n'ont
 * jamais mis les pieds sur ce chantier.
 */
function creerFicheSemaine(chefId, annee, semaine, chantier = '', { avecEquipe = true } = {}) {
  const equipe = avecEquipe ? equipeDuChef(chefId) : [];

  const creer = db.transaction(() => {
    const res = db
      .prepare('INSERT INTO fiches (chef_id, annee, semaine, chantier) VALUES (?, ?, ?, ?)')
      .run(chefId, annee, semaine, chantier);
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
    journaliser(ficheId, chefId, 'creation', `Semaine ${semaine}/${annee}${chantier ? ` — ${chantier}` : ''}`);
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
/*
 * Ce qui a change d'une version de la fiche a l'autre, en francais.
 *
 * Un relevé, pas un journal technique : il sera lu par le directeur avant de
 * valider, et par le chef d'equipe pour comprendre ce qu'on a corrige chez lui.
 * D'ou des libelles de fiche papier — « Mardi », « jours en zone » — et des
 * heures ecrites comme elles se saisissent.
 */
const LIBELLES_ENTETE = {
  chantier: 'chantier',
  ville: 'ville',
  conducteur_vehicule: 'conducteur du véhicule',
  type_vehicule: 'type de véhicule',
  immatriculation: 'immatriculation',
  observations_pointage: 'observations',
  commentaire_responsable: 'commentaire du responsable',
  nom_responsable: 'responsable de chantier',
};

const LIBELLES_LIGNE = {
  minutes_route: ['route', D.versTexte],
  minutes_trajet: ['trajet', D.versTexte],
  jours_zone: ['jours en zone', String],
  type_masque: ['masque', (v) => v || '—'],
  nb_gd72: ['jours GD 72', String],
  nb_gd80: ['jours GD 80', String],
  observation: ['observation', (v) => v || '—'],
};

function comparerFiches(avant, apres) {
  if (!avant || !apres) return [];
  const changements = [];

  for (const [champ, libelle] of Object.entries(LIBELLES_ENTETE)) {
    if (String(avant[champ] || '') !== String(apres[champ] || '')) {
      changements.push(`${libelle} : « ${avant[champ] || '—'} » → « ${apres[champ] || '—'} »`);
    }
  }

  // Les lignes se comparent par personne : leur ordre peut changer, et une
  // ligne ajoutee ou retiree n'est pas un decalage de toutes les suivantes.
  const nommees = (fiche) => {
    const parCle = new Map();
    for (const l of fiche.lignes) {
      if (!String(l.nom_affiche || '').trim()) continue;
      /*
       * Deux lignes peuvent porter la meme cle — un salarie saisi deux fois par
       * megarde, ou un nom recopie sur une ligne libre. Sans ce suffixe, la
       * seconde ecraserait la premiere et le releve comparerait deux personnes
       * differentes l'une a l'autre : on lirait « X est passe de 7h30 a 7h00 »
       * alors que ni l'un ni l'autre n'a bouge.
       */
      let cle = D.clePointage(l);
      let occurrence = 2;
      while (parCle.has(cle)) cle = `${D.clePointage(l)}#${occurrence++}`;
      parCle.set(cle, l);
    }
    return parCle;
  };
  const lignesAvant = nommees(avant);
  const lignesApres = nommees(apres);

  for (const [cle, ligne] of lignesApres) {
    const ancienne = lignesAvant.get(cle);
    if (!ancienne) {
      changements.push(`${ligne.nom_affiche} : ajouté à la fiche`);
      continue;
    }
    for (let j = 0; j < 7; j += 1) {
      const a = ancienne.jours.find((x) => x.jour === j) || {};
      const b = ligne.jours.find((x) => x.jour === j) || {};
      if ((a.minutes || 0) !== (b.minutes || 0)) {
        changements.push(
          `${ligne.nom_affiche} ${D.JOURS[j]} : ${D.versTexte(a.minutes || 0)} → ${D.versTexte(b.minutes || 0)}`
        );
      }
      if (String(a.code_absence || '') !== String(b.code_absence || '')) {
        changements.push(
          `${ligne.nom_affiche} ${D.JOURS[j]} : absence « ${a.code_absence || '—'} » → « ${b.code_absence || '—'} »`
        );
      }
    }
    for (const [champ, [libelle, formater]] of Object.entries(LIBELLES_LIGNE)) {
      if (String(ancienne[champ] || '') !== String(ligne[champ] || '')) {
        changements.push(
          `${ligne.nom_affiche} ${libelle} : ${formater(ancienne[champ] || 0)} → ${formater(ligne[champ] || 0)}`
        );
      }
    }
  }
  for (const [cle, ligne] of lignesAvant) {
    if (!lignesApres.has(cle)) changements.push(`${ligne.nom_affiche} : retiré de la fiche`);
  }

  return changements;
}

function enregistrerFiche(ficheId, corps, utilisateur) {
  const fiche = db.prepare('SELECT * FROM fiches WHERE id = ?').get(ficheId);
  if (!fiche) return { erreur: 'Fiche introuvable.', code: 404 };

  const estDirecteur = utilisateur.role === 'directeur';
  const sien = conducteurDeLaFiche(fiche);
  const estConducteur = utilisateur.role === 'conducteur' && sien && sien.id === utilisateur.id;

  if (!estDirecteur && !estConducteur && fiche.chef_id !== utilisateur.id) {
    return { erreur: 'Cette fiche appartient a un autre chef d equipe.', code: 403 };
  }
  /*
   * Le conducteur controle le pointage : lui interdire de rectifier une erreur
   * l'obligerait a renvoyer la fiche entiere au chef pour une virgule. Il
   * corrige donc la fiche comme son auteur — mais seulement tant qu'elle attend
   * SON visa. Une fois visee ou validee, elle lui echappe comme aux autres.
   */
  if (estConducteur && !(fiche.statut === 'soumise' && fiche.visa_statut === 'attente')) {
    return { erreur: 'Cette fiche n attend plus votre visa : elle n est plus modifiable.', code: 409 };
  }
  if (!estDirecteur && !estConducteur && !['brouillon', 'rejetee'].includes(fiche.statut)) {
    return {
      erreur: 'Fiche deja transmise au directeur : elle n est plus modifiable. Demandez sa reouverture.',
      code: 409,
    };
  }

  // Ce qu'on relira apres coup pour dire ce qui a change.
  const avant = estConducteur ? obtenirFiche(ficheId) : null;

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
    if (estConducteur) {
      /*
       * Les operateurs ont signe une version du pointage. Corriger apres coup
       * est le role meme du controle, mais cela decale leur signature de ce qui
       * partira en paie : le directeur et le chef doivent pouvoir lire ce qui a
       * bouge, sans avoir a comparer deux ecrans.
       */
      const changements = comparerFiches(avant, obtenirFiche(ficheId));
      if (changements.length) {
        journaliser(ficheId, utilisateur.id, 'correction_conducteur', changements.join(' ; ').slice(0, 2000));
      }
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

  const anomalies = D.controlerFiche(fiche, fiche.lignes, optionsControle(fiche));
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
            visa_statut = '', visa_le = NULL, visa_conducteur = '',
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
    const bloquantes = D.controlerFiche(fiche, fiche.lignes, optionsControle(fiche)).filter(
      (a) => a.niveau === 'bloquant'
    );
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
  conducteurDuChef,
  conducteurDeLaFiche,
  comparerFiches,
  obtenirOuCreerFicheSemaine,
  fichesDeLaSemaine,
  ouvrirFicheSupplementaire,
  enregistrerFiche,
  soumettre,
  reprendre,
  statuer,
  listerFiches,
  lignesPourExport,
};
