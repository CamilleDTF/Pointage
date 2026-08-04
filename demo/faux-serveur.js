/*
 * Faux serveur de demonstration.
 *
 * Rejoue en memoire, dans le navigateur, les routes de server/index.js. Les
 * ecrans de la demonstration sont exactement ceux de l'application (meme HTML,
 * meme CSS, meme JavaScript) : seul le transport change. Rien n'est envoye ni
 * conserve nulle part — un rechargement de la page remet tout a zero.
 */

(function (racine) {
  'use strict';

  const R = racine.Regles;

  /* ------------------------------- Donnees -------------------------------- */

  const utilisateurs = [
    { id: 1, nom: 'Direction travaux', identifiant: 'directeur', pin: '246810', role: 'directeur', actif: 1 },
    { id: 2, nom: 'BENALI Karim', identifiant: 'kbenali', pin: '1001', role: 'chef', actif: 1 },
    { id: 3, nom: 'DUARTE Manuel', identifiant: 'mduarte', pin: '1002', role: 'chef', actif: 1 },
    { id: 4, nom: 'FONTAINE Julien', identifiant: 'jfontaine', pin: '1003', role: 'chef', actif: 1 },
    { id: 5, nom: 'GRANJON Patrick', identifiant: 'pgranjon', pin: '1004', role: 'chef', actif: 1 },
    { id: 6, nom: 'LEMOINE Sebastien', identifiant: 'slemoine', pin: '1005', role: 'chef', actif: 1 },
    { id: 7, nom: 'MARCHAND Yannick', identifiant: 'ymarchand', pin: '1006', role: 'chef', actif: 1 },
    { id: 8, nom: 'NGUYEN Thierry', identifiant: 'tnguyen', pin: '1007', role: 'chef', actif: 1 },
    { id: 9, nom: 'ROSSI Fabien', identifiant: 'frossi', pin: '1008', role: 'chef', actif: 1 },
  ];

  const NOMS = ['ANDRE', 'BERTIN', 'CHEVALIER', 'DELAUNAY', 'ESTEVE', 'FAURE', 'GARNIER', 'HERVE',
    'IMBERT', 'JOLY', 'KOWALSKI', 'LAMBERT', 'MOREAU', 'NOEL', 'OLIVIER', 'PERRIN',
    'QUENTIN', 'RENAUD', 'SOARES', 'TESSIER', 'VASSEUR', 'WEBER'];
  const PRENOMS = ['Alain', 'Bruno', 'Cedric', 'David', 'Emeric', 'Franck', 'Gilles', 'Hakim'];

  const salaries = [];
  let curseur = 0;
  utilisateurs
    .filter((u) => u.role === 'chef')
    .forEach((chef, index) => {
      const taille = 3 + (index % 3);
      for (let i = 0; i < taille; i += 1) {
        salaries.push({
          id: salaries.length + 1,
          matricule: `M${String(100 + curseur).padStart(4, '0')}`,
          nom: NOMS[curseur % NOMS.length],
          prenom: PRENOMS[curseur % PRENOMS.length],
          chef_id: chef.id,
          actif: 1,
        });
        curseur += 1;
      }
    });

  const fiches = [];
  let prochainId = 1;
  let session = null;

  const maintenant = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  const copie = (v) => JSON.parse(JSON.stringify(v));

  function nouvelleFiche(chefId, annee, semaine) {
    const equipe = salaries.filter((s) => s.chef_id === chefId && s.actif);
    const fiche = {
      id: prochainId++,
      chef_id: chefId,
      annee,
      semaine,
      chantier: '',
      ville: '',
      conducteur_vehicule: '',
      type_vehicule: '',
      immatriculation: '',
      observations_pointage: '',
      commentaire_responsable: '',
      nom_responsable: '',
      signature_responsable: null,
      visa_conducteur: '',
      statut: 'brouillon',
      motif_rejet: '',
      soumise_le: null,
      validee_le: null,
      cree_le: maintenant(),
      lignes: Array.from({ length: R.NB_LIGNES_FICHE }, (_, i) => {
        const membre = equipe[i];
        return {
          id: `${prochainId}-${i}`,
          salarie_id: membre ? membre.id : null,
          nom_affiche: membre ? `${membre.nom} ${membre.prenom}` : '',
          ordre: i,
          minutes_route: 0,
          minutes_trajet: 0,
          jours_zone: 0,
          type_masque: '',
          nb_deplacement: 0,
          observation: '',
          signature: null,
          jours: Array.from({ length: 7 }, (_, j) => ({ jour: j, minutes: 0, code_absence: '' })),
        };
      }),
    };
    fiches.push(fiche);
    return fiche;
  }

  /**
   * Quatre fiches dans quatre etats differents, pour que la demonstration ait
   * de la matiere des la premiere seconde. Celle du chef propose par l'ecran
   * d'accueil (BENALI) est volontairement laissee en cours : le visiteur doit
   * pouvoir saisir, completer et transmettre.
   */
  function amorcerDemonstration() {
    const { annee, semaine } = R.semaineISO(new Date());

    // En cours — le vendredi reste a saisir, les controles le signalent.
    const brouillon = nouvelleFiche(2, annee, semaine);
    Object.assign(brouillon, {
      chantier: 'Lycée Jean Moulin - Bâtiment C',
      ville: 'Toulouse',
      conducteur_vehicule: 'BENALI Karim',
      type_vehicule: 'Master L2H2',
      immatriculation: 'GK-482-QR',
    });
    brouillon.lignes.forEach((ligne, i) => {
      if (!ligne.nom_affiche) return;
      ligne.minutes_route = 150;
      ligne.minutes_trajet = 90;
      ligne.jours_zone = 4;
      ligne.type_masque = i % 2 ? 'AA' : 'VA';
      ligne.nb_deplacement = 5;
      ligne.jours.forEach((jour) => { if (jour.jour <= 3) jour.minutes = 465; });
      if (i === 1) { ligne.jours[2].minutes = 0; ligne.jours[2].code_absence = 'AT'; }
    });

    // A vérifier par le directeur.
    const soumise = nouvelleFiche(3, annee, semaine);
    Object.assign(soumise, {
      chantier: 'Collège Marcel Pagnol - Aile B',
      ville: 'Blagnac',
      conducteur_vehicule: 'DUARTE Manuel',
      type_vehicule: 'Trafic',
      immatriculation: 'EF-201-TR',
      statut: 'soumise',
      soumise_le: maintenant(),
    });
    soumise.lignes.forEach((ligne, i) => {
      if (!ligne.nom_affiche) return;
      ligne.minutes_route = 120;
      ligne.minutes_trajet = 60;
      ligne.jours_zone = 5;
      ligne.type_masque = 'VA';
      ligne.nb_deplacement = 5;
      ligne.jours.forEach((jour) => { if (jour.jour <= 4) jour.minutes = jour.jour === 4 ? 390 : 465; });
      if (i === 2) { ligne.jours[4].minutes = 0; ligne.jours[4].code_absence = 'VM'; }
    });

    // Déjà validée, prête pour l'export.
    const validee = nouvelleFiche(4, annee, semaine);
    Object.assign(validee, {
      chantier: 'Hôpital Purpan - Pavillon 3',
      ville: 'Toulouse',
      conducteur_vehicule: 'FONTAINE Julien',
      type_vehicule: 'Boxer',
      immatriculation: 'AZ-773-KL',
      statut: 'validee',
      soumise_le: maintenant(),
      validee_le: maintenant(),
    });
    validee.lignes.forEach((ligne) => {
      if (!ligne.nom_affiche) return;
      ligne.minutes_route = 90;
      ligne.jours_zone = 5;
      ligne.type_masque = 'VA';
      ligne.nb_deplacement = 5;
      ligne.jours.forEach((jour) => { if (jour.jour <= 4) jour.minutes = 450; });
    });

    // Renvoyée au chef pour correction.
    const renvoyee = nouvelleFiche(5, annee, semaine);
    Object.assign(renvoyee, {
      chantier: 'Résidence Les Tilleuls',
      ville: 'Colomiers',
      statut: 'rejetee',
      motif_rejet: 'Jeudi manquant sur toute l’équipe, et type de masque non renseigné.',
    });
    renvoyee.lignes.forEach((ligne) => {
      if (!ligne.nom_affiche) return;
      ligne.jours_zone = 3;
      ligne.jours.forEach((jour) => { if (jour.jour <= 4 && jour.jour !== 3) jour.minutes = 435; });
    });
  }

  /* ------------------------------- Lectures -------------------------------- */

  function enrichir(fiche) {
    const sortie = copie(fiche);
    sortie.chef_nom = utilisateurs.find((u) => u.id === fiche.chef_id).nom;
    sortie.dates = R.datesDeLaSemaine(fiche.annee, fiche.semaine);
    sortie.lignes.forEach((ligne) => { ligne.total_minutes = R.totalMinutesLigne(ligne); });
    sortie.total_minutes = sortie.lignes.reduce((s, l) => s + l.total_minutes, 0);
    return sortie;
  }

  function resumer(fiche) {
    const complet = enrichir(fiche);
    return {
      id: fiche.id,
      annee: fiche.annee,
      semaine: fiche.semaine,
      chantier: fiche.chantier,
      ville: fiche.ville,
      statut: fiche.statut,
      motif_rejet: fiche.motif_rejet,
      chef_id: fiche.chef_id,
      chef_nom: complet.chef_nom,
      nb_salaries: complet.lignes.filter((l) => l.nom_affiche.trim()).length,
      total_minutes: complet.total_minutes,
    };
  }

  /* -------------------------------- Routage -------------------------------- */

  const erreur = (code, texte) => {
    const e = new Error(texte);
    e.statut = code;
    throw e;
  };

  function exigerConnexion() {
    if (!session) erreur(401, 'Session expirée, reconnectez-vous.');
    return session;
  }

  function exigerDirecteur() {
    const u = exigerConnexion();
    if (u.role !== 'directeur') erreur(403, 'Action réservée au directeur.');
    return u;
  }

  function ficheAccessible(id, utilisateur) {
    const fiche = fiches.find((f) => f.id === Number(id));
    if (!fiche) erreur(404, 'Fiche introuvable.');
    if (utilisateur.role === 'chef' && fiche.chef_id !== utilisateur.id) {
      erreur(403, "Cette fiche appartient à un autre chef d'équipe.");
    }
    return fiche;
  }

  const routes = [
    ['POST', /^\/api\/connexion$/, (m, corps) => {
      const u = utilisateurs.find(
        (x) => x.identifiant === String(corps.identifiant || '').trim().toLowerCase() && x.actif
      );
      if (!u || u.pin !== String(corps.pin || '')) erreur(401, 'Identifiant ou code incorrect.');
      session = u;
      return { utilisateur: { id: u.id, nom: u.nom, role: u.role } };
    }],

    ['POST', /^\/api\/deconnexion$/, () => { session = null; return { ok: true }; }],

    ['GET', /^\/api\/moi$/, () => {
      const u = exigerConnexion();
      return { utilisateur: { id: u.id, nom: u.nom, role: u.role } };
    }],

    ['POST', /^\/api\/mon-code$/, () => {
      exigerConnexion();
      erreur(400, 'Changement de code désactivé dans la démonstration.');
    }],

    ['GET', /^\/api\/reference$/, () => {
      const u = exigerConnexion();
      return {
        jours: R.JOURS,
        joursCourts: R.JOURS_COURTS,
        codesAbsence: R.CODES_ABSENCE,
        typesMasque: R.TYPES_MASQUE,
        semaineCourante: R.semaineISO(new Date()),
        nbLignes: R.NB_LIGNES_FICHE,
        chefs: u.role === 'directeur'
          ? utilisateurs.filter((x) => x.role === 'chef').map((x) => ({ id: x.id, nom: x.nom }))
          : [],
        equipe: u.role === 'chef'
          ? salaries.filter((s) => s.chef_id === u.id && s.actif)
          : salaries.filter((s) => s.actif),
      };
    }],

    ['GET', /^\/api\/fiches$/, (m, corps, params) => {
      const u = exigerConnexion();
      let liste = fiches;
      if (u.role === 'chef') liste = liste.filter((f) => f.chef_id === u.id);
      if (params.get('annee')) liste = liste.filter((f) => f.annee === Number(params.get('annee')));
      if (params.get('semaine')) liste = liste.filter((f) => f.semaine === Number(params.get('semaine')));
      if (params.get('statut')) liste = liste.filter((f) => f.statut === params.get('statut'));
      return { fiches: liste.map(resumer) };
    }],

    ['POST', /^\/api\/fiches\/semaine$/, (m, corps) => {
      const u = exigerConnexion();
      const annee = Number(corps.annee);
      const semaine = Number(corps.semaine);
      if (!Number.isInteger(semaine) || semaine < 1 || semaine > 53) {
        erreur(400, 'Numéro de semaine invalide (1 à 53).');
      }
      const chefId = u.role === 'directeur' ? Number(corps.chefId) : u.id;
      const existante = fiches.find((f) => f.chef_id === chefId && f.annee === annee && f.semaine === semaine);
      return { fiche: enrichir(existante || nouvelleFiche(chefId, annee, semaine)) };
    }],

    ['GET', /^\/api\/fiches\/(\d+)$/, (m) => {
      const u = exigerConnexion();
      const fiche = enrichir(ficheAccessible(m[1], u));
      fiche.anomalies = R.controlerFiche(fiche, fiche.lignes);
      fiche.journal = [];
      return { fiche };
    }],

    ['PUT', /^\/api\/fiches\/(\d+)$/, (m, corps) => {
      const u = exigerConnexion();
      const fiche = ficheAccessible(m[1], u);
      if (u.role !== 'directeur' && !['brouillon', 'rejetee'].includes(fiche.statut)) {
        erreur(409, "Fiche déjà transmise au directeur : elle n'est plus modifiable.");
      }

      for (const champ of ['chantier', 'ville', 'conducteur_vehicule', 'type_vehicule', 'immatriculation',
        'observations_pointage', 'commentaire_responsable', 'nom_responsable', 'visa_conducteur']) {
        if (corps[champ] !== undefined) fiche[champ] = String(corps[champ] || '');
      }
      if (typeof corps.signature_responsable === 'string' || corps.signature_responsable === null) {
        fiche.signature_responsable = corps.signature_responsable;
      }

      // Comme sur le serveur : les lignes ne sont remplacees que si elles sont transmises.
      if (Array.isArray(corps.lignes)) {
        fiche.lignes = corps.lignes.slice(0, R.NB_LIGNES_FICHE).map((ligne, i) => ({
          id: `${fiche.id}-${i}`,
          salarie_id: ligne.salarie_id || null,
          nom_affiche: String(ligne.nom_affiche || '').trim(),
          ordre: i,
          minutes_route: Number(ligne.minutes_route) || 0,
          minutes_trajet: Number(ligne.minutes_trajet) || 0,
          jours_zone: Number(ligne.jours_zone) || 0,
          type_masque: ligne.type_masque || '',
          nb_deplacement: Number(ligne.nb_deplacement) || 0,
          observation: String(ligne.observation || ''),
          signature: ligne.signature === undefined ? (fiche.lignes[i] || {}).signature || null : ligne.signature,
          jours: Array.from({ length: 7 }, (_, j) => {
            const source = (ligne.jours || []).find((x) => Number(x.jour) === j) || {};
            return {
              jour: j,
              minutes: Number(source.minutes) || 0,
              code_absence: String(source.code_absence || '').toUpperCase(),
            };
          }),
        }));
      }

      const complet = enrichir(fiche);
      return { fiche: complet, anomalies: R.controlerFiche(complet, complet.lignes) };
    }],

    ['POST', /^\/api\/fiches\/(\d+)\/soumettre$/, (m) => {
      const u = exigerConnexion();
      const fiche = ficheAccessible(m[1], u);
      const complet = enrichir(fiche);
      const anomalies = R.controlerFiche(complet, complet.lignes);
      if (anomalies.some((a) => a.niveau === 'bloquant')) {
        const e = new Error('La fiche est incomplète.');
        e.statut = 422;
        e.anomalies = anomalies;
        throw e;
      }
      fiche.statut = 'soumise';
      fiche.soumise_le = maintenant();
      fiche.motif_rejet = '';
      return { fiche: enrichir(fiche), anomalies };
    }],

    ['POST', /^\/api\/fiches\/(\d+)\/decision$/, (m, corps) => {
      exigerDirecteur();
      const fiche = fiches.find((f) => f.id === Number(m[1]));
      if (!fiche) erreur(404, 'Fiche introuvable.');

      if (corps.decision === 'valider') {
        const complet = enrichir(fiche);
        const bloquantes = R.controlerFiche(complet, complet.lignes).filter((a) => a.niveau === 'bloquant');
        if (bloquantes.length) {
          const e = new Error('Fiche incomplète, validation impossible.');
          e.statut = 422;
          e.anomalies = bloquantes;
          throw e;
        }
        fiche.statut = 'validee';
        fiche.validee_le = maintenant();
        fiche.motif_rejet = '';
      } else if (corps.decision === 'rejeter') {
        if (!String(corps.motif || '').trim()) erreur(400, "Indiquez le motif du renvoi au chef d'équipe.");
        fiche.statut = 'rejetee';
        fiche.motif_rejet = String(corps.motif).trim();
        fiche.validee_le = null;
      } else if (corps.decision === 'rouvrir') {
        fiche.statut = 'brouillon';
        fiche.soumise_le = null;
        fiche.validee_le = null;
      }
      return { fiche: enrichir(fiche) };
    }],

    ['GET', /^\/api\/tableau$/, (m, corps, params) => {
      exigerDirecteur();
      const courante = R.semaineISO(new Date());
      const annee = Number(params.get('annee')) || courante.annee;
      const semaine = Number(params.get('semaine')) || courante.semaine;

      const chefs = utilisateurs.filter((u) => u.role === 'chef' && u.actif);
      const liste = fiches.filter((f) => f.annee === annee && f.semaine === semaine).map(resumer);
      const parChef = new Map(liste.map((f) => [f.chef_id, f]));

      return {
        annee,
        semaine,
        dates: R.datesDeLaSemaine(annee, semaine),
        suivi: chefs.map((chef) => ({
          chef_id: chef.id,
          chef_nom: chef.nom,
          fiche: parChef.get(chef.id) || null,
          statut: (parChef.get(chef.id) || {}).statut || 'manquante',
        })),
        fiches: liste,
        totaux: {
          salaries: liste.reduce((s, f) => s + f.nb_salaries, 0),
          minutes: liste.reduce((s, f) => s + f.total_minutes, 0),
          validees: liste.filter((f) => f.statut === 'validee').length,
          attendues: chefs.length,
        },
      };
    }],

    ['GET', /^\/api\/admin\/utilisateurs$/, () => {
      exigerDirecteur();
      return {
        utilisateurs: utilisateurs.map((u) => ({
          id: u.id, nom: u.nom, identifiant: u.identifiant, role: u.role, actif: u.actif,
        })),
        salaries: salaries.map((s) => ({
          ...s, chef_nom: (utilisateurs.find((u) => u.id === s.chef_id) || {}).nom || '',
        })),
      };
    }],

    ['POST', /^\/api\/admin\/salaries$/, (m, corps) => {
      exigerDirecteur();
      if (!corps.nom || !corps.prenom) erreur(400, 'Nom et prénom obligatoires.');
      salaries.push({
        id: salaries.length + 1,
        matricule: corps.matricule || '',
        nom: String(corps.nom).toUpperCase(),
        prenom: corps.prenom,
        chef_id: corps.chef_id || null,
        actif: 1,
      });
      return { ok: true };
    }],

    ['PUT', /^\/api\/admin\/salaries\/(\d+)$/, (m, corps) => {
      exigerDirecteur();
      const s = salaries.find((x) => x.id === Number(m[1]));
      if (s) Object.assign(s, corps);
      return { ok: true };
    }],

    ['POST', /^\/api\/admin\/utilisateurs$/, () => {
      exigerDirecteur();
      erreur(400, 'Création de comptes désactivée dans la démonstration.');
    }],
  ];

  amorcerDemonstration();

  /** Meme signature que le fetch de l'application : methode, url, corps. */
  function appel(methode, url, corps) {
    const [chemin, requete] = url.split('?');
    const params = new URLSearchParams(requete || '');

    for (const [verbe, motif, traitement] of routes) {
      if (verbe !== methode) continue;
      const m = chemin.match(motif);
      if (m) return traitement(m, corps || {}, params);
    }
    erreur(404, 'Route inconnue.');
  }

  racine.FauxServeur = { appel };
})(typeof globalThis !== 'undefined' ? globalThis : this);
