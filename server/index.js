'use strict';

const path = require('path');
const express = require('express');

const { db, journaliser } = require('./db');
const D = require('./domaine');
const F = require('./fiches');
const A = require('./auth');
const X = require('./export');
const XM = require('./export-mensuel');
const M = require('./mensuel');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' })); // les signatures manuscrites sont transmises en PNG base64.
app.use(A.session);

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
  if (!req.utilisateur) return res.status(401).json({ erreur: 'Non connecte.' });
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
  res.json({ ok: true });
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
    // Un chef d equipe n a pas a connaitre la liste de ses collegues.
    chefs:
      req.utilisateur.role === 'directeur'
        ? db.prepare("SELECT id, nom FROM utilisateurs WHERE role = 'chef' AND actif = 1 ORDER BY nom").all()
        : [],
    equipe:
      req.utilisateur.role === 'chef'
        ? db
            .prepare('SELECT id, nom, prenom, matricule FROM salaries WHERE chef_id = ? AND actif = 1 ORDER BY nom')
            .all(req.utilisateur.id)
        : db.prepare('SELECT id, nom, prenom, matricule, chef_id FROM salaries WHERE actif = 1 ORDER BY nom').all(),
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
  res.json({ fiche: F.obtenirOuCreerFicheSemaine(chefId, annee, semaine) });
});

app.get('/api/fiches/:id', A.exigerConnexion, (req, res) => {
  const fiche = F.obtenirFiche(Number(req.params.id));
  if (!fiche) return res.status(404).json({ erreur: 'Fiche introuvable.' });
  if (req.utilisateur.role === 'chef' && fiche.chef_id !== req.utilisateur.id) {
    return res.status(403).json({ erreur: 'Cette fiche appartient a un autre chef d equipe.' });
  }
  fiche.anomalies = D.controlerFiche(fiche, fiche.lignes);
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
  if (resultat.fiche) resultat.anomalies = D.controlerFiche(resultat.fiche, resultat.fiche.lignes);
  repondre(res, resultat);
});

app.post('/api/fiches/:id/soumettre', A.exigerConnexion, (req, res) => {
  repondre(res, F.soumettre(Number(req.params.id), req.utilisateur));
});

app.post('/api/fiches/:id/decision', A.exigerDirecteur, (req, res) => {
  repondre(res, F.statuer(Number(req.params.id), req.utilisateur, req.body.decision, req.body.motif));
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

    const donnees = M.agregerMois(annee, mois, { statut: req.query.statut || 'validee' });
    const buffer = await XM.exporterMois(donnees);
    const nom = nomFichier(`pointage_mensuel_${annee}_${String(mois).padStart(2, '0')}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
    res.send(Buffer.from(buffer));
  })
);

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
    utilisateurs: db
      .prepare('SELECT id, nom, identifiant, role, actif FROM utilisateurs ORDER BY role DESC, nom')
      .all(),
    salaries: db
      .prepare(
        `SELECT s.*, u.nom AS chef_nom FROM salaries s
           LEFT JOIN utilisateurs u ON u.id = s.chef_id ORDER BY s.nom, s.prenom`
      )
      .all(),
  });
});

app.post('/api/admin/utilisateurs', A.exigerDirecteur, (req, res) => {
  const nom = String(req.body.nom || '').trim();
  const identifiant = String(req.body.identifiant || '').trim().toLowerCase();
  const pin = String(req.body.pin || '');
  const role = req.body.role === 'directeur' ? 'directeur' : 'chef';
  if (!nom || !identifiant) return res.status(400).json({ erreur: 'Nom et identifiant obligatoires.' });
  if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ erreur: 'Le code doit comporter 4 a 8 chiffres.' });
  try {
    const r = db
      .prepare('INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES (?, ?, ?, ?)')
      .run(nom, identifiant, role, A.hacherPin(pin));
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(409).json({ erreur: 'Cet identifiant existe deja.' });
  }
});

app.post('/api/admin/utilisateurs/:id/code', A.exigerDirecteur, (req, res) => {
  const pin = String(req.body.pin || '');
  if (!/^\d{4,8}$/.test(pin)) return res.status(400).json({ erreur: 'Le code doit comporter 4 a 8 chiffres.' });
  db.prepare('UPDATE utilisateurs SET pin_hash = ? WHERE id = ?').run(A.hacherPin(pin), Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/admin/utilisateurs/:id/actif', A.exigerDirecteur, (req, res) => {
  db.prepare('UPDATE utilisateurs SET actif = ? WHERE id = ?').run(req.body.actif ? 1 : 0, Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/admin/salaries', A.exigerDirecteur, (req, res) => {
  const nom = String(req.body.nom || '').trim();
  const prenom = String(req.body.prenom || '').trim();
  if (!nom || !prenom) return res.status(400).json({ erreur: 'Nom et prenom obligatoires.' });
  const r = db
    .prepare('INSERT INTO salaries (matricule, nom, prenom, chef_id) VALUES (?, ?, ?, ?)')
    .run(String(req.body.matricule || '').trim(), nom, prenom, req.body.chef_id || null);
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/admin/salaries/:id', A.exigerDirecteur, (req, res) => {
  const champs = ['matricule', 'nom', 'prenom', 'chef_id', 'actif'];
  const maj = {};
  for (const champ of champs) if (req.body[champ] !== undefined) maj[champ] = req.body[champ];
  if (!Object.keys(maj).length) return res.json({ ok: true });
  const set = Object.keys(maj).map((c) => `${c} = @${c}`).join(', ');
  db.prepare(`UPDATE salaries SET ${set} WHERE id = @id`).run({ ...maj, id: Number(req.params.id) });
  res.json({ ok: true });
});

/* --------------------------------- Statique -------------------------------- */

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ erreur: 'Route inconnue.' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erreur: 'Erreur interne du serveur.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Pointage DTF : http://localhost:${PORT}`);
  });
}

module.exports = app;
