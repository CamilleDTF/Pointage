'use strict';

/*
 * Comptes, effectif, vehicules, taux, conservation, indicateurs.
 *
 * Extrait de server/index.js, qui les portait toutes : une modification du
 * calendrier n'a plus a faire ouvrir un fichier de treize cents lignes. Les
 * routes n'ont pas change — ni leur ordre, ni leur contenu.
 */

const express = require('express');

const { db, journaliser } = require('../db');
const D = require('../domaine');
const A = require('../auth');
const I = require('../indicateurs');
const T = require('../taux');
const CONS = require('../conservation');
const C = require('../courriel');
const { DEBUT_SERVICE, repondre } = require('./commun');

const routes = express.Router();

/* ----------------------- Administration (directeur) ------------------------ */

routes.get('/api/admin/utilisateurs', A.exigerDirecteur, (req, res) => {
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

routes.post('/api/admin/utilisateurs', A.exigerDirecteur, (req, res) => {
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
routes.put('/api/admin/utilisateurs/:id', A.exigerDirecteur, (req, res) => {
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

routes.post('/api/admin/utilisateurs/:id/code', A.exigerDirecteur, (req, res) => {
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

routes.post('/api/admin/utilisateurs/:id/actif', A.exigerDirecteur, (req, res) => {
  db.prepare('UPDATE utilisateurs SET actif = ? WHERE id = ?').run(req.body.actif ? 1 : 0, Number(req.params.id));
  res.json({ ok: true });
});

routes.post('/api/admin/salaries', A.exigerDirecteur, (req, res) => {
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

routes.put('/api/admin/salaries/:id', A.exigerDirecteur, (req, res) => {
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
routes.put('/api/salaries/:id/nom', A.exigerConnexion, (req, res) => {
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

/* --------------------------- Conservation des donnees ---------------------- */

/*
 * Qui peut etre anonymise, et le dossier complet d'une personne.
 *
 * Rien ne se declenche tout seul : l'ecran dit ce qui est concerne, la direction
 * decide. Un effacement automatique, un jour de mauvais reglage, effacerait ce
 * que personne n'a decide d'effacer.
 */
routes.get('/api/admin/conservation', A.exigerDirecteur, (req, res) => {
  res.json({ dureeMois: CONS.DUREE_CONSERVATION_MOIS, candidats: CONS.candidats() });
});

routes.post('/api/admin/conservation/:id/anonymiser', A.exigerDirecteur, (req, res) => {
  repondre(res, CONS.anonymiser(req.params.id, req.utilisateur));
});

/* Ce qu'on remet a un salarie qui demande a savoir ce qui est detenu sur lui. */
routes.get('/api/admin/salaries/:id/dossier', A.exigerDirecteur, (req, res) => {
  repondre(res, CONS.dossierSalarie(req.params.id));
});

/* ------------------------------ Taux de la paie ---------------------------- */

/*
 * Les montants de la paie et leur date d'effet. Ils portent des salaires : ils
 * se lisent et se changent depuis la direction, et chaque changement est trace.
 */
routes.get('/api/admin/taux', A.exigerDirecteur, (req, res) => {
  const maintenant = new Date();
  const annee = Number(req.query.annee) || maintenant.getFullYear();
  const mois = Number(req.query.mois) || maintenant.getMonth() + 1;
  res.json({ catalogue: T.historique(), applicables: T.tauxDuMois(annee, mois), annee, mois });
});

routes.post('/api/admin/taux', A.exigerDirecteur, (req, res) => {
  repondre(
    res,
    T.definir(
      {
        cle: req.body.cle,
        valeur: req.body.valeur,
        annee: req.body.annee,
        mois: req.body.mois,
        note: req.body.note,
      },
      req.utilisateur
    )
  );
});

routes.delete('/api/admin/taux/:id', A.exigerDirecteur, (req, res) => {
  repondre(res, T.supprimer(req.params.id, req.utilisateur));
});

routes.get('/api/admin/vehicules', A.exigerDirecteur, (req, res) => {
  res.json({ vehicules: db.prepare('SELECT * FROM vehicules ORDER BY immatriculation').all() });
});

routes.post('/api/admin/vehicules', A.exigerDirecteur, (req, res) => {
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

routes.put('/api/admin/vehicules/:id', A.exigerDirecteur, (req, res) => {
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

routes.get('/api/admin/indicateurs', A.exigerDirecteur, (req, res) => {
  res.json({
    debutService: DEBUT_SERVICE,
    delaiJours: I.DELAI_ATTENDU_JOURS,
    chefs: I.indicateursChefs(DEBUT_SERVICE),
  });
});

module.exports = routes;
