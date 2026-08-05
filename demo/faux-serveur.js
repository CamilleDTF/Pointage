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
      // Le chef d equipe travaille lui aussi sur le chantier : il a sa fiche
      // salarie, rattachee a lui-meme, et ouvre sa propre equipe.
      const { nom, prenom } = R.separerNomPrenom(chef.nom);
      salaries.push({
        id: salaries.length + 1,
        matricule: `M${String(900 + index).padStart(4, '0')}`,
        nom,
        prenom,
        chef_id: chef.id,
        actif: 1,
      });

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

  const VEHICULES = [
    ['GR-686-YM', 'Renault', 'Trafic'], ['GR-714-YM', 'Renault', 'Trafic'],
    ['GR-719-YM', 'Renault', 'Trafic'], ['GR-707-YM', 'Renault', 'Trafic'],
    ['GV-710-TF', 'Renault', 'Trafic'], ['GV-674-TF', 'Renault', 'Trafic'],
    ['FT-156-HW', 'Iveco', 'Hayon'], ['HB-065-XP', 'Renault', 'Trafic'],
    ['HB-256-YJ', 'Renault', 'Trafic'], ['HE-968-WJ', 'Renault', 'Trafic'],
    ['HA-409-XC', 'Renault', 'Master'], ['DM-320-AY', 'Peugeot', '308'],
    ['FC-291-KA', 'Citroen', 'C4'], ['EB-308-KY', 'Citroen', 'C4 Cactus'],
  ].map(([immatriculation, marque, modele], i) => ({
    id: i + 1, immatriculation, marque, modele, motorisation: 'Diesel', actif: 1,
  }));

  // Un taux sur deux seulement : la demonstration montre aussi ce que donne un
  // taux horaire manquant, puisque c'est ce qui bloque le calcul de la paie.
  salaries.forEach((s, i) => { s.taux_horaire = i % 2 ? 0 : 13.5 + (i % 5); });

  const fiches = [];
  let prochainId = 1;
  let session = null;
  const CONDUCTEURS = [
    { id: 1, nom: 'MOREAU Paul', courriel: 'paul.moreau@exemple.fr', actif: 1 },
    { id: 2, nom: 'RENAUD Sophie', courriel: 'sophie.renaud@exemple.fr', actif: 1 },
  ];
  // Un chef sur deux depend d'un conducteur : la demonstration montre les deux
  // circuits, avec et sans etape de visa.
  utilisateurs.filter((u) => u.role === 'chef').forEach((u, i) => {
    u.conducteur_id = i % 2 === 0 ? CONDUCTEURS[(i / 2) % 2 | 0].id : null;
  });

  let billetPaie = null; // billet a usage unique, comme sur l'application

  const maintenant = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  const copie = (v) => JSON.parse(JSON.stringify(v));

  /** Le chef d equipe d abord, puis ses operateurs : l ordre de sa fiche. */
  function equipeDuChef(chefId) {
    const chef = utilisateurs.find((u) => u.id === chefId);
    const membres = salaries.filter((s) => s.chef_id === chefId && s.actif);
    const lui = membres.find((s) => R.memePersonne(`${s.nom} ${s.prenom}`, chef ? chef.nom : ''));
    return lui ? [lui, ...membres.filter((s) => s.id !== lui.id)] : membres;
  }

  function nouvelleFiche(chefId, annee, semaine) {
    const equipe = equipeDuChef(chefId);
    const fiche = {
      id: prochainId++,
      chef_id: chefId,
      annee,
      semaine,
      chantier: '',
      ville: '',
      zone_deplacement: '',
      conducteur_id: null,
      visa_statut: '',
      visa_courriel: '',
      visa_le: null,
      visa_commentaire: '',
      visa_envoye_le: null,
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
          jours: Array.from({ length: 7 }, (_, j) => ({ jour: j, minutes: 0, code_absence: '', saisi: 0 })),
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
      zone_deplacement: 'AUTRE',
      conducteur_id: 1,
      conducteur_vehicule: 'BENALI Karim',
      type_vehicule: 'Renault Master',
      immatriculation: 'HA-409-XC',
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
      zone_deplacement: 'AUTRE',
      conducteur_vehicule: 'DUARTE Manuel',
      type_vehicule: 'Renault Trafic',
      immatriculation: 'GR-707-YM',
      statut: 'soumise',
      soumise_le: maintenant(),
      conducteur_id: 1,
      visa_statut: 'attente',
      visa_courriel: 'paul.moreau@exemple.fr',
      visa_envoye_le: maintenant(),
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
      ville: 'Nice',
      zone_deplacement: 'NICE',
      conducteur_vehicule: 'FONTAINE Julien',
      type_vehicule: 'Citroen C4',
      immatriculation: 'FC-291-KA',
      statut: 'validee',
      soumise_le: maintenant(),
      validee_le: maintenant(),
      conducteur_id: 1,
      visa_statut: 'vise',
      visa_le: maintenant(),
      visa_commentaire: 'Conforme à ce que j’ai constaté sur place.',
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
      zone_deplacement: 'AUTRE',
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
      visa_statut: fiche.visa_statut || '',
      visa_le: fiche.visa_le || null,
      visa_courriel: fiche.visa_courriel || '',
      visa_commentaire: fiche.visa_commentaire || '',
      visa_envoye_le: fiche.visa_envoye_le || null,
      chef_nom: complet.chef_nom,
      nb_salaries: complet.lignes.filter((l) => l.nom_affiche.trim()).length,
      total_minutes: complet.total_minutes,
    };
  }

  /* -------------------------------- Routage -------------------------------- */

  const erreur = (code, texte, extras = {}) => {
    const e = new Error(texte);
    e.statut = code;
    Object.assign(e, extras);
    throw e;
  };

  /*
   * Le tableau mensuel de la demonstration. Il reprend les fiches validees, les
   * agrege comme le serveur, et valorise si l'acces aux montants est ouvert.
   */
  function moisDemonstration(annee, mois, version, montantPanier) {
    const semaines = R.semainesDuMois(annee, mois);
    const cles = new Set(semaines.map((s) => `${s.annee}-${s.semaine}`));
    const parSalarie = new Map();

    for (const fiche of fiches.filter((f) => f.statut === 'validee' && cles.has(`${f.annee}-${f.semaine}`))) {
      const index = semaines.findIndex((s) => s.annee === fiche.annee && s.semaine === fiche.semaine);
      for (const ligne of fiche.lignes.filter((l) => l.nom_affiche.trim())) {
        const cle = ligne.nom_affiche.trim();
        if (!parSalarie.has(cle)) {
          const { nom, prenom } = R.separerNomPrenom(cle);
          const salarie = salaries.find((x) => R.memePersonne(`${x.nom} ${x.prenom}`, cle));
          parSalarie.set(cle, {
            nom, prenom, matricule: salarie ? salarie.matricule : '',
            tauxHoraire: salarie ? salarie.taux_horaire : 0,
            semaines: semaines.map(() => 0),
            minutesMois: 0, minutes25: 0, minutes50: 0, minutesRoute: 0, minutesTrajet: 0,
            joursAmiante1: 0, joursAmiante2: 0, joursPanier: 0, joursGD72: 0, joursGD80: 0, joursFeries: 0,
          });
        }
        const cible = parSalarie.get(cle);
        const minutes = R.totalMinutesLigne(ligne);
        cible.semaines[index] += minutes;
        cible.minutesMois += minutes;
        const sup = R.heuresSupplementaires(minutes);
        cible.minutes25 += sup.minutes25;
        cible.minutes50 += sup.minutes50;
        cible.minutesRoute += ligne.minutes_route;
        cible.minutesTrajet += ligne.minutes_trajet;
        if (ligne.type_masque === 'VA') cible.joursAmiante1 += ligne.jours_zone;
        if (ligne.type_masque === 'AA') cible.joursAmiante2 += ligne.jours_zone;
        cible.joursPanier += ligne.nb_deplacement;
        if (R.estGrandDeplacement80(fiche.ville, fiche.zone_deplacement)) cible.joursGD80 += ligne.nb_deplacement;
        else cible.joursGD72 += ligne.nb_deplacement;
        cible.joursFeries += ligne.jours.filter((j) => j.code_absence === 'F').length;
      }
    }

    const liste = [...parSalarie.values()].sort((a, b) => `${a.nom}`.localeCompare(b.nom, 'fr'));
    return {
      annee, mois, version, montantPanier,
      semaines: semaines.map((s) => ({ annee: s.annee, semaine: s.semaine, debut: s.dates[0] })),
      salaries: liste.map((s) => (version === 'direction' ? { ...s, ...valoriser(s, montantPanier) } : s)),
    };
  }

  /** Les memes formules que server/mensuel.js, rejouees dans le navigateur. */
  function valoriser(s, montantPanier) {
    const taux = Number(s.tauxHoraire) || 0;
    const h = (min) => (Number(min) || 0) / 60;
    if (!taux) return { tauxManquant: true };

    const salaireBrut = 151.67 * taux;
    const heuresSupBrut = taux * 1.25 * h(s.minutes25) + taux * 1.5 * h(s.minutes50);
    const primeAmiante = (s.joursAmiante1 * 5 + s.joursAmiante2 * 10) * 0.8;
    const paniers = s.joursPanier * montantPanier;
    const grandDeplacement = s.joursGD72 * 72 + s.joursGD80 * 80;
    const trajet = taux * (h(s.minutesTrajet) / 2) + taux * h(s.minutesRoute);
    return {
      tauxManquant: false, tauxHoraire: taux, salaireBrut, salaireNet: salaireBrut * 0.77,
      heuresSupBrut, heuresSupNet: heuresSupBrut * 0.77,
      primeAmiante, paniers, grandDeplacement, trajet,
      totalBrut: salaireBrut + heuresSupBrut + primeAmiante + paniers + grandDeplacement + trajet,
      totalNet: salaireBrut * 0.77 + heuresSupBrut * 0.77 + primeAmiante + paniers + grandDeplacement + trajet,
    };
  }

  function exigerConnexion() {
    if (!session) erreur(401, 'Session expirée, reconnectez-vous.');
    return session;
  }

  /* Le choix fait sur la fiche prime ; le rattachement du chef sert de repli. */
  function conducteurDeLaFiche(fiche) {
    if (fiche && fiche.conducteur_id) {
      const choisi = CONDUCTEURS.find((c) => c.id === fiche.conducteur_id && c.actif);
      if (choisi) return choisi;
    }
    const chef = utilisateurs.find((u) => u.id === (fiche ? fiche.chef_id : null));
    return chef && chef.conducteur_id ? CONDUCTEURS.find((c) => c.id === chef.conducteur_id && c.actif) : null;
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
        version: 'démonstration',
        chefs: u.role === 'directeur'
          ? utilisateurs.filter((x) => x.role === 'chef').map((x) => ({ id: x.id, nom: x.nom }))
          : [],
        equipe: u.role === 'chef' ? equipeDuChef(u.id) : salaries.filter((s) => s.actif),
        effectif: salaries.filter((s) => s.actif),
        vehicules: VEHICULES.filter((v) => v.actif),
        zonesDeplacement: R.ZONES_DEPLACEMENT,
        conducteurs: CONDUCTEURS.filter((c) => c.actif).map((c) => ({ id: c.id, nom: c.nom })),
        conducteurParDefaut: u.conducteur_id || null,
      };
    }],

    ['GET', /^\/api\/calendrier$/, (m, corps, params) => {
      const u = exigerConnexion();
      const courante = R.semaineISO(new Date());
      const annee = Number(params.get('annee')) || courante.annee;
      const chefId = u.role === 'chef' ? u.id : Number(params.get('chef'));
      const parSemaine = new Map(
        fiches.filter((f) => f.chef_id === chefId && f.annee === annee).map((f) => [f.semaine, resumer(f)])
      );

      const semaines = [];
      for (let s = 1; s <= R.nombreSemainesISO(annee); s += 1) {
        const fiche = parSemaine.get(s) || null;
        const dates = R.datesDeLaSemaine(annee, s);
        const future = annee > courante.annee || (annee === courante.annee && s > courante.semaine);
        const avantService = R.semaineAvantService(dates[6], R.DEBUT_SERVICE_PAR_DEFAUT);
        semaines.push({
          semaine: s,
          debut: dates[0],
          fin: dates[6],
          mois: Number(dates[3].slice(5, 7)),
          courante: annee === courante.annee && s === courante.semaine,
          etat: fiche ? fiche.statut : avantService ? 'horsPerimetre' : future ? 'avenir' : 'manquante',
          fiche,
        });
      }

      const compter = (etat) => semaines.filter((x) => x.etat === etat).length;
      return {
        annee,
        semaineCourante: courante,
        debutService: R.DEBUT_SERVICE_PAR_DEFAUT,
        semaines,
        totaux: {
          manquante: compter('manquante'),
          brouillon: compter('brouillon'),
          soumise: compter('soumise'),
          rejetee: compter('rejetee'),
          validee: compter('validee'),
        },
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
      fiche.anomalies = R.controlerFiche(fiche, fiche.lignes, {
        conducteursDisponibles: CONDUCTEURS.filter((c) => c.actif).length,
      });
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
        'zone_deplacement', 'observations_pointage', 'commentaire_responsable',
        'nom_responsable', 'visa_conducteur']) {
        if (corps[champ] !== undefined) fiche[champ] = String(corps[champ] || '');
      }
      if (corps.conducteur_id !== undefined) {
        fiche.conducteur_id = Number(corps.conducteur_id) || null;
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
            const minutes = Number(source.minutes) || 0;
            return {
              jour: j,
              minutes,
              code_absence: String(source.code_absence || '').toUpperCase(),
              saisi: source.saisi || minutes > 0 ? 1 : 0,
            };
          }),
        }));
      }

      const complet = enrichir(fiche);
      return {
        fiche: complet,
        anomalies: R.controlerFiche(complet, complet.lignes, {
          conducteursDisponibles: CONDUCTEURS.filter((c) => c.actif).length,
        }),
      };
    }],

    ['POST', /^\/api\/fiches\/(\d+)\/soumettre$/, (m) => {
      const u = exigerConnexion();
      const fiche = ficheAccessible(m[1], u);
      const complet = enrichir(fiche);
      const anomalies = R.controlerFiche(complet, complet.lignes, {
        conducteursDisponibles: CONDUCTEURS.filter((c) => c.actif).length,
      });
      if (anomalies.some((a) => a.niveau === 'bloquant')) {
        const e = new Error('La fiche est incomplète.');
        e.statut = 422;
        e.anomalies = anomalies;
        throw e;
      }
      fiche.statut = 'soumise';
      fiche.soumise_le = maintenant();
      fiche.motif_rejet = '';

      // Le conducteur de travaux vise avant le directeur, quand le chef en a un.
      const conducteur = conducteurDeLaFiche(fiche);
      fiche.visa_statut = conducteur ? 'attente' : '';
      fiche.visa_courriel = conducteur ? conducteur.courriel : '';
      fiche.visa_envoye_le = conducteur ? maintenant() : null;

      return {
        fiche: enrichir(fiche),
        anomalies,
        visa: conducteur
          ? { demande: true, conducteur: conducteur.nom, courriel: conducteur.courriel, envoye: false }
          : { demande: false },
      };
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

    ['GET', /^\/api\/admin\/vehicules$/, () => {
      exigerDirecteur();
      return { vehicules: VEHICULES };
    }],

    ['PUT', /^\/api\/admin\/vehicules\/(\d+)$/, (m, corps) => {
      exigerDirecteur();
      const v = VEHICULES.find((x) => x.id === Number(m[1]));
      if (v) Object.assign(v, corps);
      return { ok: true };
    }],

    ['POST', /^\/api\/admin\/vehicules$/, () => {
      exigerDirecteur();
      erreur(400, 'Ajout de véhicule désactivé dans la démonstration.');
    }],

    ['GET', /^\/api\/admin\/conducteurs$/, () => {
      exigerDirecteur();
      return {
        conducteurs: CONDUCTEURS,
        chefs: utilisateurs
          .filter((u) => u.role === 'chef')
          .map((u) => ({
            id: u.id, nom: u.nom, conducteur_id: u.conducteur_id || null,
            conducteur_nom: (CONDUCTEURS.find((c) => c.id === u.conducteur_id) || {}).nom || '',
          })),
        envoiConfigure: false,
      };
    }],

    ['PUT', /^\/api\/admin\/conducteurs\/(\d+)$/, (m, corps) => {
      exigerDirecteur();
      const c = CONDUCTEURS.find((x) => x.id === Number(m[1]));
      if (c) Object.assign(c, corps);
      return { ok: true };
    }],

    ['POST', /^\/api\/admin\/conducteurs$/, () => {
      exigerDirecteur();
      erreur(400, 'Ajout de conducteur désactivé dans la démonstration.');
    }],

    ['PUT', /^\/api\/admin\/chefs\/(\d+)\/conducteur$/, (m, corps) => {
      exigerDirecteur();
      const u = utilisateurs.find((x) => x.id === Number(m[1]));
      if (u) u.conducteur_id = corps.conducteur_id ? Number(corps.conducteur_id) : null;
      return { ok: true };
    }],

    ['POST', /^\/api\/fiches\/(\d+)\/relancer-visa$/, (m) => {
      exigerDirecteur();
      const fiche = fiches.find((f) => f.id === Number(m[1]));
      if (!fiche) erreur(404, 'Fiche introuvable.');
      const conducteur = conducteurDeLaFiche(fiche);
      if (!conducteur) return { visa: { demande: false } };
      return {
        visa: { demande: true, conducteur: conducteur.nom, courriel: conducteur.courriel, envoye: false,
                lien: 'https://votre-adresse/visa.html?jeton=…(démonstration)' },
        fiche: enrichir(fiche),
      };
    }],

    ['GET', /^\/api\/admin\/indicateurs$/, () => {
      exigerDirecteur();
      // Chiffres figes : la demonstration n'a pas d'historique a mesurer.
      const exemples = [
        [100, 12, 12, 1, 2, 0, 0], [92, 12, 11, 2, 5, 1, 1], [83, 12, 10, 3, 6, 2, 2],
        [100, 12, 12, 1, 1, 0, 0], [75, 12, 9, 4, 8, 3, 1], [100, 12, 12, 2, 3, 0, 0],
        [92, 12, 11, 1, 2, 0, 1], [58, 12, 7, 5, 9, 4, 2],
      ];
      return {
        debutService: R.DEBUT_SERVICE_PAR_DEFAUT,
        chefs: utilisateurs
          .filter((u) => u.role === 'chef')
          .map((u, i) => {
            const [assiduite, attendues, transmises, moyen, max, horsDelai, renvoyees] = exemples[i];
            return {
              chef_id: u.id, nom: u.nom,
              semainesAttendues: attendues, fichesTransmises: transmises,
              fichesValidees: transmises, enRetard: attendues - transmises,
              assiduite, retardMoyen: moyen, retardMax: max, horsDelai,
              fichesRenvoyees: renvoyees,
              tauxRejet: Math.round((renvoyees / transmises) * 100),
            };
          }),
      };
    }],

    ['POST', /^\/api\/paie\/billet$/, (m, corps) => {
      const u = exigerDirecteur();
      if (String(corps.pin || '') !== u.pin) erreur(401, 'Code incorrect.');
      billetPaie = `billet-${Date.now()}`;
      return { billet: billetPaie };
    }],

    ['GET', /^\/api\/mois$/, (m, corps, params) => {
      exigerDirecteur();
      const demandee = params.get('version') === 'direction' ? 'direction' : 'public';
      if (demandee === 'direction') {
        // Usage unique : consulter puis telecharger redemande le code.
        if (!billetPaie || params.get('billet') !== billetPaie) {
          erreur(403, 'Les montants demandent votre code directeur.', { codeDemande: true });
        }
        billetPaie = null;
      }
      return moisDemonstration(
        Number(params.get('annee')), Number(params.get('mois')),
        demandee, Number(params.get('panier')) || 0
      );
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
