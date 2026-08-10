'use strict';

// En premier, avant tout module qui lit process.env : configuration.txt pose
// les reglages du poste (dossier de donnees, serveur d'envoi des courriels).
require('./configuration');

const path = require('path');
const crypto = require('node:crypto');
const express = require('express');

const { db, journaliser } = require('./db');
const D = require('./domaine');
const F = require('./fiches');
const A = require('./auth');
const X = require('./export');
const XM = require('./export-mensuel');
const XNP = require('./export-non-productif');
const M = require('./mensuel');
const I = require('./indicateurs');
const V = require('./visa');
const CAL = require('./calendrier');
const NP = require('./non-productif');
const AL = require('./alerte');
const C = require('./courriel');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

/*
 * Affichee dans le bandeau de chaque ecran. Quand quelque chose ne se comporte
 * pas comme attendu, la premiere question est toujours « quelle version tourne
 * reellement ? » : elle se lit desormais a l'ecran, sans avoir a fouiller.
 */
const VERSION = require('../package.json').version;

app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' })); // les signatures manuscrites sont transmises en PNG base64.
app.use(A.session);
app.use(A.espaceConducteurFerme);

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function repondre(res, resultat) {
  if (resultat.erreur) {
    return res.status(resultat.code || 400).json({ erreur: resultat.erreur, anomalies: resultat.anomalies });
  }
  return res.json(resultat);
}

/* ---------------------------- Authentification ---------------------------- */

app.post('/api/connexion', (req, res) => {
  const identifiant = String(req.body.identifiant || '').trim().toLowerCase();
  const pin = String(req.body.pin || '');
  const cle = `${req.ip}|${identifiant}`;

  if (A.tropDeTentatives(cle)) {
    return res.status(429).json({ erreur: 'Trop de tentatives. Reessayez dans 15 minutes.' });
  }

  const utilisateur = db
    .prepare('SELECT * FROM utilisateurs WHERE lower(identifiant) = ? AND actif = 1')
    .get(identifiant);

  if (!utilisateur || !A.verifierPin(pin, utilisateur.pin_hash)) {
    A.enregistrerEchec(cle);
    return res.status(401).json({ erreur: 'Identifiant ou code incorrect.' });
  }

  A.reinitialiserTentatives(cle);
  A.ouvrirSession(req, res, utilisateur);
  res.json({ utilisateur: { id: utilisateur.id, nom: utilisateur.nom, role: utilisateur.role } });
});

app.post('/api/deconnexion', (req, res) => {
  A.fermerSession(res);
  res.json({ ok: true });
});

app.get('/api/moi', (req, res) => {
  if (!req.utilisateur) return res.status(401).json({ erreur: 'Non connecte.', sessionExpiree: true });
  res.json({ utilisateur: req.utilisateur });
});

app.post('/api/mon-code', A.exigerConnexion, (req, res) => {
  const actuel = String(req.body.actuel || '');
  const nouveau = String(req.body.nouveau || '');
  if (!/^\d{4,8}$/.test(nouveau)) {
    return res.status(400).json({ erreur: 'Le nouveau code doit comporter 4 a 8 chiffres.' });
  }
  const u = db.prepare('SELECT pin_hash FROM utilisateurs WHERE id = ?').get(req.utilisateur.id);
  if (!A.verifierPin(actuel, u.pin_hash)) return res.status(401).json({ erreur: 'Code actuel incorrect.' });
  db.prepare('UPDATE utilisateurs SET pin_hash = ? WHERE id = ?').run(A.hacherPin(nouveau), req.utilisateur.id);

  /*
   * Changer son code ferme les sessions ouvertes avec l'ancien — c'est tout
   * l'interet du geste quand on le fait parce qu'on craint qu'il ait ete vu.
   * Sauf celle-ci : on rend immediatement une session valable au navigateur qui
   * vient de faire la demarche, sinon il se retrouverait deconnecte par sa
   * propre precaution.
   */
  const generation = A.revoquerSessions(req.utilisateur.id);
  A.ouvrirSession(req, res, { ...req.utilisateur, session_generation: generation });

  journaliser(null, req.utilisateur.id, 'code_change', 'sessions precedentes fermees');
  res.json({ ok: true, sessionsFermees: true });
});

/* ------------------------------- References ------------------------------- */

app.get('/api/reference', A.exigerConnexion, (req, res) => {
  const maintenant = new Date();
  const { annee, semaine } = D.semaineISO(maintenant);
  res.json({
    jours: D.JOURS,
    joursCourts: D.JOURS_COURTS,
    codesAbsence: D.CODES_ABSENCE,
    typesMasque: D.TYPES_MASQUE,
    semaineCourante: { annee, semaine },
    nbLignes: F.NB_LIGNES_FICHE,
    version: VERSION,
    // Un chef d equipe n a pas a connaitre la liste de ses collegues chefs.
    chefs:
      req.utilisateur.role === 'directeur'
        ? db.prepare("SELECT id, nom FROM utilisateurs WHERE role = 'chef' AND actif = 1 ORDER BY nom").all()
        : [],
    // L equipe rattachee, chef compris : c'est elle qui pre-remplit la fiche.
    equipe:
      req.utilisateur.role === 'chef'
        ? F.equipeDuChef(req.utilisateur.id)
        : db
            .prepare('SELECT id, nom, prenom, matricule, chef_id FROM salaries WHERE actif = 1 AND productif = 1 ORDER BY nom')
            .all(),
    // Tout l effectif : un chantier reunit souvent des operateurs venus d autres
    // equipes, et le chef doit pouvoir les pointer sans passer par le directeur.
    effectif: db
      .prepare('SELECT id, nom, prenom, matricule FROM salaries WHERE actif = 1 AND productif = 1 ORDER BY nom, prenom')
      .all(),
    // Le parc : le chef choisit une immatriculation, le reste se remplit seul.
    vehicules: db
      .prepare('SELECT id, immatriculation, marque, modele, motorisation FROM vehicules WHERE actif = 1 ORDER BY immatriculation')
      .all(),
    zonesDeplacement: D.ZONES_DEPLACEMENT,
    // Le chef choisit lui-meme qui doit viser sa fiche : il lui faut la liste.
    conducteurs: db
      .prepare("SELECT id, nom FROM utilisateurs WHERE role = 'conducteur' AND actif = 1 ORDER BY nom")
      .all(),
    conducteurParDefaut: req.utilisateur.conducteur_id || null,
  });
});

/*
 * Ce qui appelle l'attention du chef d'equipe, sur son ecran d'accueil.
 *
 * Une fiche renvoyee, il le voyait deja en l'ouvrant. Une fiche corrigee par le
 * conducteur, non : elle poursuivait sa route vers la direction sans qu'il sache
 * qu'on avait touche a son pointage. Or ce sont ses operateurs qui ont signe, et
 * c'est lui qu'on interrogera si un montant surprend.
 */
app.get('/api/mes-notifications', A.exigerConnexion, (req, res) => {
  if (req.utilisateur.role !== 'chef') return res.json({ corrections: [], renvoyees: [] });

  const corrections = db
    .prepare(
      `SELECT j.detail, j.horodatage, u.nom AS auteur,
              f.id AS fiche_id, f.annee, f.semaine, f.chantier
         FROM journal j
         JOIN fiches f ON f.id = j.fiche_id
         LEFT JOIN utilisateurs u ON u.id = j.user_id
        WHERE j.action = 'correction_conducteur' AND f.chef_id = ?
          AND j.horodatage >= datetime('now', '-45 days')
        ORDER BY j.id DESC LIMIT 20`
    )
    .all(req.utilisateur.id);

  const renvoyees = db
    .prepare(
      `SELECT id, annee, semaine, chantier, motif_rejet
         FROM fiches WHERE chef_id = ? AND statut = 'rejetee'
        ORDER BY annee DESC, semaine DESC LIMIT 20`
    )
    .all(req.utilisateur.id);

  res.json({ corrections, renvoyees });
});

/* ------------------- Calendrier du personnel non productif ----------------- */

/*
 * Ils sont a 7 h par jour ouvre : ce sont les ecarts qui se saisissent, pas les
 * journees. Une absence, un grand deplacement, une prime — le reste se deduit.
 */
app.get('/api/non-productif', A.exigerDirecteur, (req, res) => {
  const maintenant = new Date();
  const annee = Number(req.query.annee) || maintenant.getFullYear();
  const mois = Number(req.query.mois) || maintenant.getMonth() + 1;
  if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
    return res.status(400).json({ erreur: 'Annee invalide.' });
  }
  if (!Number.isInteger(mois) || mois < 1 || mois > 12) {
    return res.status(400).json({ erreur: 'Mois invalide (1 a 12).' });
  }
  res.json({ ...NP.moisComplet(annee, mois), codesAbsence: D.CODES_ABSENCE, motifsConge: CAL.MOTIFS_CONGE });
});

app.put('/api/non-productif/jour', A.exigerDirecteur, (req, res) => {
  repondre(
    res,
    NP.declarerJour(
      {
        salarieId: req.body.salarie_id,
        date: req.body.date,
        code: req.body.code,
        gd: req.body.gd,
        minutes: req.body.minutes,
      },
      req.utilisateur
    )
  );
});

app.post('/api/non-productif/primes', A.exigerDirecteur, (req, res) => {
  repondre(
    res,
    NP.ajouterPrime(
      {
        salarieId: req.body.salarie_id,
        annee: req.body.annee,
        mois: req.body.mois,
        libelle: req.body.libelle,
        montant: req.body.montant,
      },
      req.utilisateur
    )
  );
});

app.delete('/api/non-productif/primes/:id', A.exigerDirecteur, (req, res) => {
  repondre(res, NP.supprimerPrime(req.params.id));
});

/*
 * Le tableau mensuel de paie du personnel non productif.
 *
 * Meme protection que celui des chantiers : les montants ne s'ouvrent jamais sur
 * la seule foi d'une session. Le code du directeur s'echange contre un billet a
 * usage unique, consomme des la premiere requete.
 */
app.get('/api/non-productif/paie', A.exigerDirecteur, (req, res) => {
  const annee = Number(req.query.annee);
  const mois = Number(req.query.mois);
  if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
    return res.status(400).json({ erreur: 'Annee invalide.' });
  }
  if (!Number.isInteger(mois) || mois < 1 || mois > 12) {
    return res.status(400).json({ erreur: 'Mois invalide (1 a 12).' });
  }
  if (!A.consommerBilletPaie(req, req.query.billet)) {
    return res.status(403).json({ erreur: 'Les montants demandent votre code directeur.', codeDemande: true });
  }

  res.json(NP.paieDuMois(annee, mois));
});

/* Le meme tableau, en classeur. Il porte les memes montants, donc le meme billet. */
app.get(
  '/api/export/non-productif.xlsx',
  A.exigerDirecteur,
  asyncRoute(async (req, res) => {
    const annee = Number(req.query.annee);
    const mois = Number(req.query.mois);
    if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
      return res.status(400).json({ erreur: 'Annee invalide.' });
    }
    if (!Number.isInteger(mois) || mois < 1 || mois > 12) {
      return res.status(400).json({ erreur: 'Mois invalide (1 a 12).' });
    }
    if (!A.consommerBilletPaie(req, req.query.billet)) {
      return res.status(403).json({ erreur: 'Les montants demandent votre code directeur.', codeDemande: true });
    }

    const buffer = await XNP.exporterPaieNonProductif(NP.paieDuMois(annee, mois));
    const nom = nomFichier(`paie_non_productif_${annee}_${String(mois).padStart(2, '0')}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
    res.send(Buffer.from(buffer));
  })
);

/*
 * Le personnel non productif se gere comme l'effectif de chantier, dans son
 * propre onglet : meme table, meme matricule, meme taux horaire.
 */
app.get('/api/admin/non-productifs', A.exigerDirecteur, (req, res) => {
  res.json({
    salaries: db
      .prepare('SELECT * FROM salaries WHERE productif = 0 ORDER BY nom, prenom')
      .all(),
  });
});

/* -------------------------- Calendrier d'un chef --------------------------- */

/*
 * Avant cette date le pointage se faisait sur papier : le calendrier ne reclame
 * pas ces semaines-la. Se regle par DEBUT_SERVICE=AAAA-MM-JJ si la mise en
 * service glisse.
 */
const DEBUT_SERVICE = process.env.DEBUT_SERVICE || D.DEBUT_SERVICE_PAR_DEFAUT;

/**
 * Toutes les semaines de l'annee avec l'etat de la fiche correspondante, pour
 * que le chef d'equipe voie d'un coup ce qui lui reste a faire. Les semaines
 * sans fiche ressortent "manquante" — ou "avenir" si elles ne sont pas encore
 * arrivees, une semaine future n'etant pas un retard, ou "horsPerimetre" si
 * elles precedent la mise en service.
 */
app.get('/api/calendrier', A.exigerConnexion, (req, res) => {
  const courante = D.semaineISO(new Date());
  const annee = Number(req.query.annee) || courante.annee;
  if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
    return res.status(400).json({ erreur: 'Annee invalide.' });
  }

  const chefId = req.utilisateur.role === 'chef' ? req.utilisateur.id : Number(req.query.chef);
  if (!chefId) return res.status(400).json({ erreur: "Precisez le chef d equipe concerne." });

  const fiches = F.listerFiches({ annee, chefId });
  const parSemaine = new Map(fiches.map((f) => [f.semaine, f]));

  const semaines = [];
  for (let s = 1; s <= D.nombreSemainesISO(annee); s += 1) {
    const fiche = parSemaine.get(s) || null;
    const dates = D.datesDeLaSemaine(annee, s);
    const future = annee > courante.annee || (annee === courante.annee && s > courante.semaine);
    const avantService = D.semaineAvantService(dates[6], DEBUT_SERVICE);
    semaines.push({
      semaine: s,
      debut: dates[0],
      fin: dates[6],
      // Rattachee au mois de son jeudi, comme la norme ISO : la semaine 1 se
      // range ainsi en janvier meme quand son lundi tombe en decembre.
      mois: Number(dates[3].slice(5, 7)),
      courante: annee === courante.annee && s === courante.semaine,
      // Une fiche existante prime : si quelqu un a saisi une semaine anterieure
      // a la mise en service, son travail reste visible.
      etat: fiche ? fiche.statut : avantService ? 'horsPerimetre' : future ? 'avenir' : 'manquante',
      fiche,
    });
  }

  const compter = (etat) => semaines.filter((s) => s.etat === etat).length;
  res.json({
    annee,
    semaineCourante: courante,
    debutService: DEBUT_SERVICE,
    delaiJours: I.DELAI_ATTENDU_JOURS,
    semaines,
    totaux: {
      manquante: compter('manquante'),
      brouillon: compter('brouillon'),
      soumise: compter('soumise'),
      rejetee: compter('rejetee'),
      validee: compter('validee'),
    },
  });
});

/* --------------------- Calendrier mensuel de la direction ------------------ */

/**
 * Le mois, personne par personne et jour par jour.
 *
 * Reserve a la direction : chaque ligne dit ou etait chaque salarie, ce qu'aucun
 * chef d'equipe n'a a savoir de l'equipe d'un autre.
 */
app.get('/api/calendrier-mensuel', A.exigerDirecteurOuConducteur, (req, res) => {
  const annee = Number(req.query.annee);
  const mois = Number(req.query.mois);
  if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
    return res.status(400).json({ erreur: 'Annee invalide.' });
  }
  if (!Number.isInteger(mois) || mois < 1 || mois > 12) {
    return res.status(400).json({ erreur: 'Mois invalide (1 a 12).' });
  }
  res.json({
    ...CAL.moisComplet(annee, mois, { debutService: DEBUT_SERVICE }),
    codesAbsence: D.CODES_ABSENCE,
    motifsConge: CAL.MOTIFS_CONGE,
  });
});

app.get('/api/conges', A.exigerDirecteurOuConducteur, (req, res) => {
  res.json({ conges: CAL.listerConges({ depuis: req.query.depuis || null }), motifs: CAL.MOTIFS_CONGE });
});

app.post('/api/conges', A.exigerDirecteur, (req, res) => {
  const resultat = CAL.enregistrerConge(req.body || {});
  if (!resultat.erreur) {
    journaliser(null, req.utilisateur.id, 'conge_ajoute', `${req.body.salarie_id} ${req.body.debut}->${req.body.fin}`);
  }
  repondre(res, resultat);
});

app.delete('/api/conges/:id', A.exigerDirecteur, (req, res) => {
  repondre(res, CAL.supprimerConge(req.params.id));
});

/* --------------------------------- Fiches --------------------------------- */

app.get('/api/fiches', A.exigerConnexion, (req, res) => {
  const filtres = {
    annee: req.query.annee,
    semaine: req.query.semaine,
    statut: req.query.statut,
    chefId: req.utilisateur.role === 'chef' ? req.utilisateur.id : req.query.chef,
  };
  res.json({ fiches: F.listerFiches(filtres) });
});

app.post('/api/fiches/semaine', A.exigerConnexion, (req, res) => {
  const annee = Number(req.body.annee);
  const semaine = Number(req.body.semaine);
  if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
    return res.status(400).json({ erreur: 'Annee invalide.' });
  }
  if (!Number.isInteger(semaine) || semaine < 1 || semaine > 53) {
    return res.status(400).json({ erreur: 'Numero de semaine invalide (1 a 53).' });
  }
  const chefId = req.utilisateur.role === 'directeur' && req.body.chefId
    ? Number(req.body.chefId)
    : req.utilisateur.id;
  if (req.utilisateur.role === 'directeur' && !req.body.chefId) {
    return res.status(400).json({ erreur: "Precisez le chef d equipe concerne." });
  }
  const fiche = F.obtenirOuCreerFicheSemaine(chefId, annee, semaine);
  // Les autres chantiers de la semaine, pour que le chef puisse passer de l'un
  // a l'autre : il en a une par chantier, une seule le plus souvent.
  res.json({ fiche, fichesSemaine: F.fichesDeLaSemaine(chefId, annee, semaine) });
});

/*
 * Un second chantier dans la meme semaine.
 *
 * La base l'autorisait depuis le debut — son unicite porte sur le chef, la
 * semaine ET le chantier — mais rien ne permettait de l'ouvrir. Un chef qui
 * tenait deux chantiers devait donc tout entasser sur une feuille, ce que la
 * fiche papier n'a jamais demande.
 */
app.post('/api/fiches/semaine/chantier', A.exigerConnexion, (req, res) => {
  const annee = Number(req.body.annee);
  const semaine = Number(req.body.semaine);
  if (!Number.isInteger(annee) || !Number.isInteger(semaine) || semaine < 1 || semaine > 53) {
    return res.status(400).json({ erreur: 'Semaine invalide.' });
  }
  const chefId =
    req.utilisateur.role === 'directeur' && req.body.chefId ? Number(req.body.chefId) : req.utilisateur.id;
  if (req.utilisateur.role === 'directeur' && !req.body.chefId) {
    return res.status(400).json({ erreur: "Precisez le chef d equipe concerne." });
  }

  const resultat = F.ouvrirFicheSupplementaire(chefId, annee, semaine, req.body.chantier);
  if (resultat.erreur) return repondre(res, resultat);
  res.json({ fiche: resultat.fiche, fichesSemaine: F.fichesDeLaSemaine(chefId, annee, semaine) });
});


app.get('/api/fiches/:id', A.exigerConnexion, (req, res) => {
  const fiche = F.obtenirFiche(Number(req.params.id));
  if (!fiche) return res.status(404).json({ erreur: 'Fiche introuvable.' });
  if (req.utilisateur.role === 'chef' && fiche.chef_id !== req.utilisateur.id) {
    return res.status(403).json({ erreur: 'Cette fiche appartient a un autre chef d equipe.' });
  }
  const options = F.optionsControle(fiche);
  fiche.anomalies = D.controlerFiche(fiche, fiche.lignes, options);
  /*
   * Ce qui est pointe ailleurs dans la semaine part avec la fiche : le chef
   * travaille sur chantier, souvent sans reseau, et ses controles doivent etre
   * ceux du serveur. Sans cela il verrait s'afficher des oublis pour des
   * journees deja pointees sur son autre chantier, jusqu'au prochain envoi.
   */
  fiche.ailleurs = options.ailleurs;
  fiche.journal = db
    .prepare(
      `SELECT j.action, j.detail, j.horodatage, u.nom AS auteur
         FROM journal j LEFT JOIN utilisateurs u ON u.id = j.user_id
        WHERE j.fiche_id = ? ORDER BY j.id DESC LIMIT 50`
    )
    .all(fiche.id);
  res.json({ fiche });
});

app.put('/api/fiches/:id', A.exigerConnexion, (req, res) => {
  const resultat = F.enregistrerFiche(Number(req.params.id), req.body, req.utilisateur);
  if (resultat.fiche) {
    const options = F.optionsControle(resultat.fiche);
    resultat.anomalies = D.controlerFiche(resultat.fiche, resultat.fiche.lignes, options);
    resultat.fiche.ailleurs = options.ailleurs;
  }
  repondre(res, resultat);
});

app.post(
  '/api/fiches/:id/soumettre',
  A.exigerConnexion,
  asyncRoute(async (req, res) => {
    const resultat = F.soumettre(Number(req.params.id), req.utilisateur);
    if (resultat.erreur) return repondre(res, resultat);

    // La fiche part au conducteur de travaux pour visa. L'envoi ne conditionne
    // pas la transmission : une adresse fausse ou un serveur muet ne doit pas
    // faire perdre au chef d'equipe le travail qu'il vient de rendre.
    const visa = await V.envoyerDemandeVisa(Number(req.params.id));
    res.json({
      ...resultat,
      fiche: F.obtenirFiche(Number(req.params.id)),
      visa: resumeVisa(visa),
    });
  })
);

/**
 * Ce qu'on peut dire de l'envoi.
 *
 * `alerte` accompagne toujours la reponse : c'est un message tout pret, sans
 * aucun lien, que le chef d'equipe envoie de son telephone pour prevenir le
 * conducteur — il lui rappelle d'ouvrir ses fiches, rien de plus. Il n'y a plus
 * de lien a distribuer : le conducteur se connecte.
 */
function resumeVisa(visa) {
  if (!visa || visa.erreur) return { demande: false };
  if (!visa.conducteur) return { demande: false, raison: visa.raison || 'aucun_conducteur' };

  const complete = visa.fiche ? F.obtenirFiche(visa.fiche.id) : null;
  const lignes = complete ? complete.lignes.filter((l) => String(l.nom_affiche || '').trim()) : [];

  return {
    demande: true,
    conducteur: visa.conducteur.nom,
    courriel: visa.conducteur.courriel,
    envoye: Boolean(visa.courriel && visa.courriel.envoye),
    raison: visa.courriel ? visa.courriel.raison : undefined,
    alerte: complete
      ? AL.alerteVisa({
          fiche: complete,
          conducteur: visa.conducteur,
          chefNom: complete.chef_nom,
          nbSalaries: lignes.length,
          totalMinutes: lignes.reduce((t, l) => t + (l.total_minutes || 0), 0),
        })
      : null,
  };
}

/**
 * Relance du conducteur, a la main du directeur. Le lien est renvoye avec la
 * reponse : quand aucun serveur d'envoi n'est configure, c'est ce qui permet de
 * le transmettre soi-meme plutot que de rester bloque.
 */
app.post(
  '/api/fiches/:id/relancer-visa',
  A.exigerDirecteur,
  asyncRoute(async (req, res) => {
    const visa = await V.envoyerDemandeVisa(Number(req.params.id), { relance: true });
    if (visa.erreur) return repondre(res, visa);
    res.json({ visa: resumeVisa(visa), fiche: F.obtenirFiche(Number(req.params.id)) });
  })
);

/*
 * Le chef reprend sa fiche pour la corriger, sans passer par la direction.
 * Le visa en cours est annule : voir F.reprendre.
 */
app.post('/api/fiches/:id/reprendre', A.exigerConnexion, (req, res) => {
  repondre(res, F.reprendre(Number(req.params.id), req.utilisateur));
});

app.post('/api/fiches/:id/decision', A.exigerDirecteur, (req, res) => {
  repondre(res, F.statuer(Number(req.params.id), req.utilisateur, req.body.decision, req.body.motif));
});

/* -------------------- Visa du conducteur de travaux ----------------------- */

/*
 * Les seules routes de l'application ouvertes sans session : le conducteur de
 * travaux n'a pas de compte, il arrive par le lien signe de son courriel.
 *
 * Le GET ne fait que montrer. La decision passe par un POST — un antivirus de
 * messagerie qui visite les liens d'un message viserait sinon les fiches a la
 * place du conducteur.
 */
/* --------------------- Espace du conducteur de travaux --------------------- */

/*
 * Les memes gestes, par compte plutot que par lien signe.
 *
 * Un conducteur connecte est reconnu pour ce qu'il est : il n'a plus besoin
 * qu'on lui envoie un secret par fiche. Son perimetre se lit sur la fiche —
 * celles ou le chef l'a designe — et non sur un rattachement fixe : un chef peut
 * changer de conducteur d'une semaine a l'autre, ou en avoir deux a la fois s'il
 * tient deux chantiers.
 */
function exigerConducteur(req, res, next) {
  if (!req.utilisateur) return res.status(401).json({ erreur: 'Session expiree, reconnectez-vous.', sessionExpiree: true });
  if (req.utilisateur.role !== 'conducteur') {
    return res.status(403).json({ erreur: 'Action reservee au conducteur de travaux.' });
  }
  next();
}

app.get('/api/conducteur/moi', exigerConducteur, (req, res) => {
  repondre(res, V.tableauConducteur(req.utilisateur));
});

app.get('/api/visa/fiche/:id', exigerConducteur, (req, res) => {
  const acces = V.ficheDuConducteur(req.utilisateur, req.params.id);
  if (acces.erreur) return res.status(acces.code || 403).json({ erreur: acces.erreur });
  res.json({
    fiche: {
      ...V.vueConducteur(acces.fiche),
      // Il peut corriger tant que la fiche attend son visa, et pas au-dela :
      // une fiche visee ou validee ne se retouche plus de son cote.
      modifiable: acces.fiche.statut === 'soumise' && acces.fiche.visa_statut === 'attente',
    },
    // Ce qu'il faut pour corriger : les codes d'absence, l'effectif pour ajouter
    // quelqu'un, le parc pour designer un vehicule. Aucun montant.
    reference: {
      joursCourts: D.JOURS_COURTS,
      jours: D.JOURS,
      codesAbsence: D.CODES_ABSENCE,
      typesMasque: D.TYPES_MASQUE,
      effectif: db
        .prepare('SELECT id, nom, prenom, matricule FROM salaries WHERE actif = 1 AND productif = 1 ORDER BY nom, prenom')
        .all(),
      vehicules: db
        .prepare('SELECT immatriculation, marque, modele FROM vehicules WHERE actif = 1 ORDER BY immatriculation')
        .all(),
    },
  });
});

/*
 * La correction de la fiche. Le conducteur controle le pointage : lui interdire
 * de rectifier une erreur l'obligerait a renvoyer la fiche entiere au chef pour
 * une virgule. Il la corrige comme son auteur, tant qu'elle attend son visa —
 * la validation finale, elle, reste au directeur.
 */
app.put('/api/visa/fiche/:id', exigerConducteur, (req, res) => {
  const acces = V.ficheDuConducteur(req.utilisateur, req.params.id);
  if (acces.erreur) return repondre(res, acces);

  const resultat = F.enregistrerFiche(acces.fiche.id, req.body, req.utilisateur);
  if (resultat.fiche) {
    const options = F.optionsControle(resultat.fiche);
    resultat.anomalies = D.controlerFiche(resultat.fiche, resultat.fiche.lignes, options);
    resultat.fiche = { ...V.vueConducteur(resultat.fiche), modifiable: true };
  }
  repondre(res, resultat);
});

app.post('/api/visa/fiche/:id/decision', exigerConducteur, (req, res) => {
  decider(res, V.ficheDuConducteur(req.utilisateur, req.params.id), req.body, req.utilisateur);
});

/* Viser ou renvoyer : le geste ne depend pas de la facon dont on est arrive. */
function decider(res, acces, corps, utilisateur = null) {
  const decision = corps.decision;
  if (decision === 'viser') return repondre(res, V.viser(acces, corps.commentaire, utilisateur));
  if (decision === 'renvoyer') return repondre(res, V.renvoyer(acces, corps.commentaire, utilisateur));
  res.status(400).json({ erreur: 'Decision inconnue.' });
}

/* ------------------------ Conducteurs de travaux --------------------------- */

/*
 * Les conducteurs sont des comptes comme les autres : ils se creent, se
 * renomment, se desactivent et changent de code par les routes communes
 * `/api/admin/utilisateurs`. Il ne reste ici que ce qui leur est propre — la
 * liste de leur ecran, et le lien personnel qui precede les comptes.
 */
app.get('/api/admin/conducteurs', A.exigerDirecteur, (req, res) => {
  res.json({
    // Le lien personnel est monte ici : c'est au directeur de le transmettre,
    // jamais au chef d'equipe, qui pourrait sinon viser ses propres fiches.
    conducteurs: db
      .prepare("SELECT * FROM utilisateurs WHERE role = 'conducteur' ORDER BY nom")
      .all()
      .map(({ pin_hash: empreinte, jeton, ...c }) => ({
        ...c,
        // Un compte migre porte une empreinte que personne ne peut retrouver :
        // tant que le directeur n'a pas donne de code, il ne peut pas entrer.
        codeADefinir: !A.codeUtilisable(empreinte),
      })),
    // Qui depend de qui : le rattachement se regle dans le meme ecran.
    chefs: db
      .prepare(
        `SELECT u.id, u.nom, u.conducteur_id, c.nom AS conducteur_nom
           FROM utilisateurs u
           LEFT JOIN utilisateurs c ON c.id = u.conducteur_id
          WHERE u.role = 'chef' AND u.actif = 1 ORDER BY u.nom`
      )
      .all(),
    envoiConfigure: C.ACTIF,
  });
});

app.put('/api/admin/chefs/:id/conducteur', A.exigerDirecteur, (req, res) => {
  const conducteurId = req.body.conducteur_id ? Number(req.body.conducteur_id) : null;
  db.prepare("UPDATE utilisateurs SET conducteur_id = ? WHERE id = ? AND role = 'chef'")
    .run(conducteurId, Number(req.params.id));
  res.json({ ok: true });
});

/* -------------------------------- Exports --------------------------------- */

function nomFichier(base) {
  return base.replace(/[^A-Za-z0-9_.-]/g, '_');
}

app.get(
  '/api/export/fiche/:id.xlsx',
  A.exigerConnexion,
  asyncRoute(async (req, res) => {
    const fiche = F.obtenirFiche(Number(req.params.id));
    if (!fiche) return res.status(404).json({ erreur: 'Fiche introuvable.' });
    if (req.utilisateur.role === 'chef' && fiche.chef_id !== req.utilisateur.id) {
      return res.status(403).json({ erreur: 'Acces refuse.' });
    }
    const buffer = await X.exporterFiche(fiche);
    const nom = nomFichier(`S${String(fiche.semaine).padStart(2, '0')}_${fiche.chantier || 'chantier'}_${fiche.annee}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
    res.send(Buffer.from(buffer));
  })
);

app.get(
  '/api/export/periode.xlsx',
  A.exigerDirecteur,
  asyncRoute(async (req, res) => {
    const filtres = {
      annee: req.query.annee,
      semaine: req.query.semaine,
      statut: req.query.statut || 'validee',
    };
    const lignes = F.lignesPourExport(filtres);
    const avecFiches = req.query.fiches !== '0';
    const fiches = avecFiches
      ? F.listerFiches(filtres).map((f) => F.obtenirFiche(f.id))
      : [];
    const buffer = await X.exporterPeriode(lignes, fiches);
    const suffixe = filtres.semaine ? `S${String(filtres.semaine).padStart(2, '0')}` : 'toutes-semaines';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${nomFichier(`pointage_${filtres.annee || ''}_${suffixe}.xlsx`)}"`
    );
    res.send(Buffer.from(buffer));
  })
);

app.get(
  '/api/export/mois.xlsx',
  A.exigerDirecteur,
  asyncRoute(async (req, res) => {
    const annee = Number(req.query.annee);
    const mois = Number(req.query.mois);
    if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
      return res.status(400).json({ erreur: 'Annee invalide.' });
    }
    if (!Number.isInteger(mois) || mois < 1 || mois > 12) {
      return res.status(400).json({ erreur: 'Mois invalide (1 a 12).' });
    }

    // La version direction porte les salaires : chaque telechargement consomme
    // son propre billet, donc redemande le code.
    const version = req.query.version === 'direction' ? 'direction' : 'public';
    if (version === 'direction' && !A.consommerBilletPaie(req, req.query.billet)) {
      return res.status(403).json({ erreur: 'Les montants demandent votre code directeur.', codeDemande: true });
    }

    const donnees = M.agregerMois(annee, mois, { statut: req.query.statut || 'validee' });
    const buffer = await XM.exporterMois(donnees, { version });
    const nom = nomFichier(
      `pointage_mensuel_${annee}_${String(mois).padStart(2, '0')}_${version}.xlsx`
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
    res.send(Buffer.from(buffer));
  })
);

/* ------------------------- Tableau mensuel a l'ecran ----------------------- */

/*
 * Le meme tableau que le classeur, mais consultable directement. Deux versions :
 *
 *  - "public"    : heures, majorations, jours de zone, paniers, grands
 *                  deplacements. Aucun montant, aucun taux horaire.
 *  - "direction" : la meme chose plus la valorisation. Elle exige que le
 *                  directeur ait ressaisi son code, meme si sa session est
 *                  ouverte : une session dure trente jours, un salaire affiche
 *                  sur un ecran partage n'attend pas si longtemps.
 */
app.post('/api/paie/billet', A.exigerDirecteur, (req, res) => {
  const cle = `${req.ip}|paie|${req.utilisateur.id}`;
  if (A.tropDeTentatives(cle)) {
    return res.status(429).json({ erreur: 'Trop de tentatives. Reessayez dans 15 minutes.' });
  }
  const u = db.prepare('SELECT pin_hash FROM utilisateurs WHERE id = ?').get(req.utilisateur.id);
  if (!A.verifierPin(String(req.body.pin || ''), u.pin_hash)) {
    A.enregistrerEchec(cle);
    return res.status(401).json({ erreur: 'Code incorrect.' });
  }
  A.reinitialiserTentatives(cle);
  // Un seul usage : consulter puis telecharger redemande le code.
  res.json({ billet: A.delivrerBilletPaie(req.utilisateur) });
});

app.get('/api/mois', A.exigerDirecteur, (req, res) => {
  const annee = Number(req.query.annee);
  const mois = Number(req.query.mois);
  if (!Number.isInteger(annee) || annee < 2020 || annee > 2100) {
    return res.status(400).json({ erreur: 'Annee invalide.' });
  }
  if (!Number.isInteger(mois) || mois < 1 || mois > 12) {
    return res.status(400).json({ erreur: 'Mois invalide (1 a 12).' });
  }

  const demandee = req.query.version === 'direction' ? 'direction' : 'public';
  if (demandee === 'direction' && !A.consommerBilletPaie(req, req.query.billet)) {
    return res.status(403).json({ erreur: 'Les montants demandent votre code directeur.', codeDemande: true });
  }

  const donnees = M.agregerMois(annee, mois, { statut: req.query.statut || 'validee' });

  const salaries = donnees.salaries.map((s) => {
    const commun = {
      nom: s.nom,
      prenom: s.prenom,
      matricule: s.matricule,
      chantiers: s.chantiers,
      semaines: s.semaines.map((x) => x.minutesTotal),
      minutesMois: s.minutesMois,
      minutes25: s.minutes25,
      minutes50: s.minutes50,
      minutesRoute: s.minutesRoute,
      minutesTrajet: s.minutesTrajet,
      joursAmiante1: s.joursAmiante1,
      joursAmiante2: s.joursAmiante2,
      joursPanier: s.joursPanier,
      joursTravailles: s.joursTravailles,
      joursGD72: s.joursGD72,
      joursGD80: s.joursGD80,
      joursFeries: s.joursFeries,
    };
    // Le montant du panier n'est plus un parametre : c'est une valeur de la
    // maison, portee par les regles metier (D.MONTANT_PANIER_REPAS).
    return demandee === 'direction' ? { ...commun, ...M.valoriser(s) } : commun;
  });

  res.json({
    annee,
    mois,
    version: demandee,
    montantPanier: D.MONTANT_PANIER_REPAS,
    // Horaire de reference du mois, la case "Mois" du classeur de paie.
    joursOuvres: D.joursOuvresDuMois(annee, mois),
    heuresReference: D.heuresReferenceMois(annee, mois),
    semaines: donnees.semaines.map((s) => ({ annee: s.annee, semaine: s.semaine, debut: s.dates[0] })),
    salaries,
  });
});

/** Ce que contiendra l'export mensuel, pour l'annoncer avant de le telecharger. */
app.get('/api/export/mois-apercu', A.exigerDirecteur, (req, res) => {
  const annee = Number(req.query.annee);
  const mois = Number(req.query.mois);
  if (!Number.isInteger(annee) || !Number.isInteger(mois) || mois < 1 || mois > 12) {
    return res.status(400).json({ erreur: 'Période invalide.' });
  }
  const donnees = M.agregerMois(annee, mois, { statut: req.query.statut || 'validee' });
  res.json({
    annee,
    mois,
    semaines: donnees.semaines.map((s) => ({ annee: s.annee, semaine: s.semaine, debut: s.dates[0] })),
    nbSalaries: donnees.salaries.length,
    minutes: donnees.salaries.reduce((s, x) => s + x.minutesMois, 0),
  });
});

app.get('/api/export/periode.csv', A.exigerDirecteur, (req, res) => {
  const lignes = F.lignesPourExport({
    annee: req.query.annee,
    semaine: req.query.semaine,
    statut: req.query.statut || 'validee',
  });
  const suffixe = req.query.semaine ? `S${String(req.query.semaine).padStart(2, '0')}` : 'toutes-semaines';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${nomFichier(`pointage_${req.query.annee || ''}_${suffixe}.csv`)}"`
  );
  res.send(X.exporterCsv(lignes));
});

/* ------------------------- Tableau de bord directeur ----------------------- */

app.get('/api/tableau', A.exigerDirecteur, (req, res) => {
  const annee = Number(req.query.annee) || D.semaineISO(new Date()).annee;
  const semaine = Number(req.query.semaine) || D.semaineISO(new Date()).semaine;

  const chefs = db.prepare("SELECT id, nom FROM utilisateurs WHERE role = 'chef' AND actif = 1 ORDER BY nom").all();
  const fiches = F.listerFiches({ annee, semaine });
  const parChef = new Map(fiches.map((f) => [f.chef_id, f]));

  res.json({
    annee,
    semaine,
    dates: D.datesDeLaSemaine(annee, semaine),
    suivi: chefs.map((chef) => ({
      chef_id: chef.id,
      chef_nom: chef.nom,
      fiche: parChef.get(chef.id) || null,
      statut: (parChef.get(chef.id) || {}).statut || 'manquante',
    })),
    fiches,
    totaux: {
      salaries: fiches.reduce((s, f) => s + f.nb_salaries, 0),
      minutes: fiches.reduce((s, f) => s + f.total_minutes, 0),
      validees: fiches.filter((f) => f.statut === 'validee').length,
      attendues: chefs.length,
    },
  });
});

/* ----------------------- Administration (directeur) ------------------------ */

app.get('/api/admin/utilisateurs', A.exigerDirecteur, (req, res) => {
  res.json({
    // Les conducteurs ont leur propre onglet : les melanger ici brouillerait
    // deux circuits qui n'ont pas les memes pouvoirs.
    utilisateurs: db
      .prepare(
        `SELECT id, nom, identifiant, role, actif FROM utilisateurs
          WHERE role IN ('chef', 'directeur') ORDER BY role DESC, nom`
      )
      .all(),
    // L'onglet « Personnel et equipes » ne montre que l'effectif de chantier ;
    // le personnel non productif a le sien, avec ses propres ecrans.
    salaries: db
      .prepare(
        `SELECT s.*, u.nom AS chef_nom FROM salaries s
           LEFT JOIN utilisateurs u ON u.id = s.chef_id
          WHERE s.productif = 1 ORDER BY s.nom, s.prenom`
      )
      .all(),
  });
});

const ROLES = ['chef', 'directeur', 'conducteur'];

app.post('/api/admin/utilisateurs', A.exigerDirecteur, (req, res) => {
  const nom = `${String(req.body.nom || '').trim()} ${String(req.body.prenom || '').trim()}`.trim();
  const identifiant = String(req.body.identifiant || '').trim().toLowerCase();
  const pin = String(req.body.pin || '');
  const role = ROLES.includes(req.body.role) ? req.body.role : 'chef';
  const courriel = String(req.body.courriel || '').trim();
  if (!nom || !identifiant) return res.status(400).json({ erreur: 'Nom et identifiant obligatoires.' });
  if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ erreur: 'Le code doit comporter 4 a 8 chiffres.' });
  if (courriel && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(courriel)) {
    return res.status(400).json({ erreur: 'Adresse de courriel invalide.' });
  }

  try {
    const r = db
      .prepare(
        `INSERT INTO utilisateurs (nom, identifiant, role, pin_hash, courriel, telephone)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(nom, identifiant, role, A.hacherPin(pin), courriel, String(req.body.telephone || '').trim().slice(0, 30));
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ erreur: 'Cet identifiant existe deja.' });
  }
});

/*
 * Correction du nom ou de l'identifiant d'un compte.
 *
 * Un nom mal orthographie a l'import, un identifiant choisi trop vite : sans
 * cette route, il fallait desactiver le compte et en creer un autre, ce qui
 * detachait ses fiches de leur auteur. Le nom du chef d'equipe sert aussi a le
 * rapprocher de sa fiche salarie : le corriger ici corrige donc l'affichage
 * partout.
 */
app.put('/api/admin/utilisateurs/:id', A.exigerDirecteur, (req, res) => {
  const id = Number(req.params.id);
  const compte = db.prepare('SELECT * FROM utilisateurs WHERE id = ?').get(id);
  if (!compte) return res.status(404).json({ erreur: 'Compte introuvable.' });

  /*
   * Le compte ne porte qu'un champ de nom, « NOM Prenom », comme la fiche
   * papier. L'ecran le presente en deux cases parce que c'est ainsi qu'on le
   * corrige ; on les recompose ici.
   */
  const maj = {};
  const ancien = D.separerNomPrenom(compte.nom);
  if (req.body.nom !== undefined || req.body.prenom !== undefined) {
    const nom = String(req.body.nom !== undefined ? req.body.nom : ancien.nom).trim();
    const prenom = String(req.body.prenom !== undefined ? req.body.prenom : ancien.prenom).trim();
    if (!nom) return res.status(400).json({ erreur: 'Le nom ne peut pas etre vide.' });
    maj.nom = `${nom} ${prenom}`.trim();
  }
  if (req.body.identifiant !== undefined) {
    const identifiant = String(req.body.identifiant).trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(identifiant)) {
      return res.status(400).json({
        erreur: 'Identifiant invalide : 3 a 32 caracteres, lettres, chiffres, point, tiret ou soulignement.',
      });
    }
    maj.identifiant = identifiant;
  }
  // Coordonnees : elles ne servent qu'a prevenir, jamais a ouvrir quoi que ce soit.
  if (req.body.courriel !== undefined) {
    const courriel = String(req.body.courriel).trim();
    if (courriel && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(courriel)) {
      return res.status(400).json({ erreur: 'Adresse de courriel invalide.' });
    }
    maj.courriel = courriel;
  }
  if (req.body.telephone !== undefined) maj.telephone = String(req.body.telephone).trim().slice(0, 30);
  if (!Object.keys(maj).length) return res.json({ ok: true });

  try {
    const set = Object.keys(maj).map((c) => `${c} = @${c}`).join(', ');
    db.prepare(`UPDATE utilisateurs SET ${set} WHERE id = @id`).run({ ...maj, id });
  } catch {
    return res.status(409).json({ erreur: 'Cet identifiant est deja pris par un autre compte.' });
  }

  /*
   * Le chef travaille aussi sur le chantier : il a une fiche salarie, rattachee
   * a lui par son nom. Corriger l'un sans l'autre les separerait — il cesserait
   * d'apparaitre en tete de sa propre fiche, et le calendrier ne le reconnaitrait
   * plus comme chef.
   */
  if (maj.nom && maj.nom !== compte.nom) {
    const sien = db
      .prepare('SELECT id, nom, prenom FROM salaries WHERE chef_id = ?')
      .all(id)
      .find((s) => D.memePersonne(`${s.nom} ${s.prenom}`, compte.nom));
    if (sien) {
      const { nom, prenom } = D.separerNomPrenom(maj.nom);
      db.prepare('UPDATE salaries SET nom = ?, prenom = ? WHERE id = ?').run(nom, prenom, sien.id);
    }
  }

  journaliser(null, req.utilisateur.id, 'compte_modifie', `${compte.identifiant} -> ${JSON.stringify(maj)}`);
  res.json({ ok: true, utilisateur: db.prepare('SELECT id, nom, identifiant, role, actif FROM utilisateurs WHERE id = ?').get(id) });
});

app.post('/api/admin/utilisateurs/:id/code', A.exigerDirecteur, (req, res) => {
  const pin = String(req.body.pin || '');
  if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ erreur: 'Le code doit comporter 4 a 8 chiffres.' });
  const id = Number(req.params.id);
  db.prepare('UPDATE utilisateurs SET pin_hash = ? WHERE id = ?').run(A.hacherPin(pin), id);

  // Le directeur attribue un code neuf souvent parce que l'ancien a fuite, ou
  // que le telephone a ete perdu : les sessions ouvertes avec doivent tomber.
  A.revoquerSessions(id);
  // Sauf si c'est le sien qu'il vient de changer : on lui rend sa session.
  if (id === req.utilisateur.id) {
    const compte = db.prepare('SELECT * FROM utilisateurs WHERE id = ?').get(id);
    A.ouvrirSession(req, res, compte);
  }

  journaliser(null, req.utilisateur.id, 'code_reinitialise', `compte ${id} — sessions fermees`);
  res.json({ ok: true, sessionsFermees: true });
});

app.post('/api/admin/utilisateurs/:id/actif', A.exigerDirecteur, (req, res) => {
  db.prepare('UPDATE utilisateurs SET actif = ? WHERE id = ?').run(req.body.actif ? 1 : 0, Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/admin/salaries', A.exigerDirecteur, (req, res) => {
  const nom = String(req.body.nom || '').trim();
  const prenom = String(req.body.prenom || '').trim();
  if (!nom || !prenom) return res.status(400).json({ erreur: 'Nom et prenom obligatoires.' });
  // Non productif : pas de chef d'equipe, il ne figure sur aucune fiche.
  const productif = req.body.productif === 0 || req.body.productif === false ? 0 : 1;
  const r = db
    .prepare('INSERT INTO salaries (matricule, nom, prenom, chef_id, productif) VALUES (?, ?, ?, ?, ?)')
    .run(
      String(req.body.matricule || '').trim(),
      nom,
      prenom,
      productif ? req.body.chef_id || null : null,
      productif
    );
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/admin/salaries/:id', A.exigerDirecteur, (req, res) => {
  const champs = ['matricule', 'nom', 'prenom', 'chef_id', 'actif', 'taux_horaire'];
  const maj = {};
  for (const champ of champs) if (req.body[champ] !== undefined) maj[champ] = req.body[champ];
  if (!Object.keys(maj).length) return res.json({ ok: true });
  const set = Object.keys(maj).map((c) => `${c} = @${c}`).join(', ');
  db.prepare(`UPDATE salaries SET ${set} WHERE id = @id`).run({ ...maj, id: Number(req.params.id) });
  res.json({ ok: true });
});

/* ----------------------- Correction d'un nom de salarie -------------------- */

/**
 * Un chef d'equipe corrige le nom ou le prenom d'un de ses operateurs.
 *
 * C'est lui qui a la personne devant les yeux : il voit avant tout le monde
 * qu'un prenom est mal orthographie ou qu'un nom composé a ete tronque a
 * l'import. Le faire remonter au directeur pour une lettre serait un aller-
 * retour de trop.
 *
 * Le geste reste etroit : seuls le nom et le prenom changent — ni le matricule,
 * ni l'affectation, ni le taux horaire — et chaque correction est journalisee
 * avec son auteur, pour qu'on sache toujours qui a ecrit quoi.
 */
app.put('/api/salaries/:id/nom', A.exigerConnexion, (req, res) => {
  const id = Number(req.params.id);
  const salarie = db.prepare('SELECT * FROM salaries WHERE id = ?').get(id);
  if (!salarie) return res.status(404).json({ erreur: 'Salarie introuvable.' });

  /*
   * « Un de SES operateurs » : la route ne le verifiait pas, et n'importe quel
   * chef pouvait donc renommer n'importe qui dans le fichier du personnel — y
   * compris quelqu'un qu'il n'a jamais vu. Corriger le nom d'un homme qu'on a
   * devant soi est une chose ; modifier le referentiel de toute l'entreprise en
   * est une autre.
   */
  if (req.utilisateur.role !== 'directeur' && salarie.chef_id !== req.utilisateur.id) {
    return res.status(403).json({
      erreur: "Ce salarie n'est pas de votre equipe : signalez la correction a la direction.",
    });
  }

  const nom = String(req.body.nom || '').trim();
  const prenom = String(req.body.prenom || '').trim();
  if (!nom) return res.status(400).json({ erreur: 'Le nom est obligatoire.' });

  const avant = `${salarie.nom} ${salarie.prenom}`.trim();
  const apres = `${nom} ${prenom}`.trim();
  if (avant === apres) return res.json({ ok: true, inchange: true });

  db.prepare('UPDATE salaries SET nom = ?, prenom = ? WHERE id = ?').run(nom, prenom, id);
  journaliser(null, req.utilisateur.id, 'correction_nom', `${avant} → ${apres}`);
  res.json({ ok: true, nom, prenom });
});

/* ---------------------------- Parc de vehicules ---------------------------- */

app.get('/api/admin/vehicules', A.exigerDirecteur, (req, res) => {
  res.json({ vehicules: db.prepare('SELECT * FROM vehicules ORDER BY immatriculation').all() });
});

app.post('/api/admin/vehicules', A.exigerDirecteur, (req, res) => {
  const immatriculation = String(req.body.immatriculation || '').trim().toUpperCase();
  if (!immatriculation) return res.status(400).json({ erreur: "L'immatriculation est obligatoire." });
  try {
    const r = db
      .prepare('INSERT INTO vehicules (immatriculation, marque, modele, motorisation) VALUES (?, ?, ?, ?)')
      .run(
        immatriculation,
        String(req.body.marque || '').trim(),
        String(req.body.modele || '').trim(),
        String(req.body.motorisation || '').trim()
      );
    res.json({ id: r.lastInsertRowid });
  } catch {
    res.status(409).json({ erreur: 'Cette immatriculation existe deja.' });
  }
});

app.put('/api/admin/vehicules/:id', A.exigerDirecteur, (req, res) => {
  const champs = ['immatriculation', 'marque', 'modele', 'motorisation', 'actif'];
  const maj = {};
  for (const champ of champs) if (req.body[champ] !== undefined) maj[champ] = req.body[champ];
  if (maj.immatriculation !== undefined) {
    maj.immatriculation = String(maj.immatriculation).trim().toUpperCase();
    if (!maj.immatriculation) return res.status(400).json({ erreur: "L'immatriculation est obligatoire." });
  }
  if (!Object.keys(maj).length) return res.json({ ok: true });
  const set = Object.keys(maj).map((c) => `${c} = @${c}`).join(', ');
  try {
    db.prepare(`UPDATE vehicules SET ${set} WHERE id = @id`).run({ ...maj, id: Number(req.params.id) });
  } catch {
    return res.status(409).json({ erreur: 'Cette immatriculation existe deja.' });
  }
  res.json({ ok: true });
});

/* ------------------------------- Indicateurs ------------------------------- */

app.get('/api/admin/indicateurs', A.exigerDirecteur, (req, res) => {
  res.json({
    debutService: DEBUT_SERVICE,
    delaiJours: I.DELAI_ATTENDU_JOURS,
    chefs: I.indicateursChefs(DEBUT_SERVICE),
  });
});

/* --------------------------------- Statique -------------------------------- */

/*
 * `no-cache` ne veut pas dire « ne rien garder » : le navigateur conserve les
 * fichiers, mais revalide a chaque fois et se contente d'un 304 quand rien n'a
 * bouge. C'est indispensable ici. Avec une duree de vie ferme (maxAge), une
 * page pouvait rester en cache pendant qu'un script etait recharge : la version
 * d'hier appelait alors le code d'aujourd'hui, et l'ecran restait vide. Sur une
 * poignee de postes en reseau local, la revalidation ne coute rien.
 */
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    etag: true,
    lastModified: true,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  })
);

/*
 * Une adresse inconnue renvoie a l'ecran de connexion — mais seulement s'il
 * s'agit d'une navigation. Repondre la page d'accueil a la place d'un fichier
 * .js ou .css manquant est pire que de ne rien repondre : le navigateur recoit
 * du HTML la ou il attend du code, et l'echec devient incomprehensible.
 */
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ erreur: 'Route inconnue.' });
  if (/\.[a-z0-9]+$/i.test(req.path)) return res.status(404).type('text/plain').send('Fichier introuvable.');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erreur: 'Erreur interne du serveur.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Pointage DTF : http://localhost:${PORT}`);
    // Dit des le demarrage si les courriels partiront : sans cette ligne, on ne
    // s'en apercoit qu'au premier chef d'equipe qui transmet sa fiche.
    console.log(
      C.ACTIF
        ? "Envoi des courriels : actif (les demandes de visa partent aux conducteurs de travaux)."
        : "Envoi des courriels : inactif. Les demandes de visa sont conservees dans " +
          `${C.DOSSIER_COURRIELS} et le lien s'affiche sur la fiche. ` +
          'Pour les faire partir, remplissez les lignes SMTP de configuration.txt.'
    );
  });
}

module.exports = app;
