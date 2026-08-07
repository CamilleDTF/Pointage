'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db, DATA_DIR } = require('./db');

const DUREE_SESSION_MS = 30 * 24 * 3600 * 1000; // 30 jours : les chefs ne se reconnectent pas chaque semaine.
const NOM_COOKIE = 'pointage_session';

function chargerSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const fichier = path.join(DATA_DIR, 'session.key');
  if (fs.existsSync(fichier)) return fs.readFileSync(fichier, 'utf8').trim();
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(fichier, secret, { mode: 0o600 });
  return secret;
}

const SECRET = chargerSecret();

function signer(donnees) {
  const charge = Buffer.from(JSON.stringify(donnees)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(charge).digest('base64url');
  return `${charge}.${sig}`;
}

function verifier(jeton) {
  if (typeof jeton !== 'string' || !jeton.includes('.')) return null;
  const [charge, sig] = jeton.split('.');
  const attendu = crypto.createHmac('sha256', SECRET).update(charge).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(attendu);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const donnees = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'));
    if (!donnees.exp || donnees.exp < Date.now()) return null;
    return donnees;
  } catch {
    return null;
  }
}

function lireCookies(req) {
  const brut = req.headers.cookie || '';
  return Object.fromEntries(
    brut
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        const i = p.indexOf('=');
        return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
      })
  );
}

/** Attache req.utilisateur si la session est valide. Ne bloque jamais. */
function session(req, res, next) {
  const jeton = lireCookies(req)[NOM_COOKIE];
  const donnees = jeton ? verifier(jeton) : null;
  if (donnees) {
    const u = db
      .prepare('SELECT id, nom, identifiant, role, actif, conducteur_id FROM utilisateurs WHERE id = ?')
      .get(donnees.uid);
    if (u && u.actif) req.utilisateur = u;
  }
  next();
}

/**
 * La connexion en cours est-elle chiffree ? Derriere un proxy (Tailscale serve,
 * Caddy, reverse proxy du NAS), c'est l'en-tete transmise qui fait foi.
 */
function connexionChiffree(req) {
  if (req.secure) return true;
  const transmis = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  return transmis === 'https';
}

let avertissementEmis = false;

function ouvrirSession(req, res, utilisateur) {
  const jeton = signer({ uid: utilisateur.id, role: utilisateur.role, exp: Date.now() + DUREE_SESSION_MS });

  /*
   * L'attribut Secure est pose selon la facon dont l'application est REELLEMENT
   * jointe, pas selon NODE_ENV. Sinon, une installation en HTTPS derriere
   * Tailscale et un acces direct en http:// sur le reseau local ne peuvent pas
   * cohabiter : le navigateur rejette silencieusement un cookie Secure recu en
   * clair, et la connexion echoue sans le moindre message.
   */
  const chiffree = connexionChiffree(req);
  const force = process.env.COOKIE_SECURE === 'true';
  const secure = chiffree || force ? '; Secure' : '';

  if (!chiffree && !force && !avertissementEmis) {
    avertissementEmis = true;
    console.warn(
      'Attention : application jointe en HTTP simple. Les codes circulent en clair ' +
        "et l'installation sur l'ecran d'accueil des telephones n'est pas proposee. " +
        'Voir docs/DEPLOIEMENT.md pour passer en HTTPS via Tailscale.'
    );
  }

  res.setHeader(
    'Set-Cookie',
    `${NOM_COOKIE}=${encodeURIComponent(jeton)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
      DUREE_SESSION_MS / 1000
    }${secure}`
  );
}

function fermerSession(res) {
  res.setHeader('Set-Cookie', `${NOM_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function exigerConnexion(req, res, next) {
  if (!req.utilisateur) return res.status(401).json({ erreur: 'Session expiree, reconnectez-vous.' });
  next();
}

/*
 * Le role conducteur existe ; son espace n'est pas encore ouvert.
 *
 * Ce garde-fou est ferme par defaut, et c'est tout son interet. Les routes
 * ouvertes a tout compte connecte se branchent sur « chef » ou « directeur » :
 * un role de plus tomberait dans la branche du directeur et verrait passer
 * toutes les fiches de la maison. Plutot que de corriger chaque route — en en
 * oubliant une — on refuse tout, et on ouvrira deliberement, une par une, quand
 * ses pouvoirs seront decides.
 *
 * Restent joignables : ce qui ne concerne que lui, et les liens signes, qui ne
 * doivent rien a la session — c'est le jeton qui autorise, pas le compte.
 */
const ouvertAuConducteur = (chemin) =>
  ['/api/moi', '/api/deconnexion', '/api/mon-code'].includes(chemin) ||
  chemin.startsWith('/api/visa/') ||
  chemin.startsWith('/api/conducteur/') ||
  // Le calendrier des presences et le registre des conges : ils expliquent une
  // journee sans heures avant de viser. Aucun montant n'y figure.
  chemin === '/api/calendrier-mensuel' ||
  chemin === '/api/conges';

function espaceConducteurFerme(req, res, next) {
  const conducteur = req.utilisateur && req.utilisateur.role === 'conducteur';
  if (conducteur && req.path.startsWith('/api/') && !ouvertAuConducteur(req.path)) {
    return res.status(403).json({
      erreur: "Votre espace n'est pas encore ouvert. La direction vous préviendra.",
    });
  }
  next();
}

/*
 * Le calendrier des presences est le seul ecran que le conducteur partage avec
 * la direction. Il n'y a aucun montant : il sert a comprendre pourquoi telle
 * journee est vide avant de viser une fiche.
 */
function exigerDirecteurOuConducteur(req, res, next) {
  if (!req.utilisateur) return res.status(401).json({ erreur: 'Session expiree, reconnectez-vous.' });
  if (!['directeur', 'conducteur'].includes(req.utilisateur.role)) {
    return res.status(403).json({ erreur: 'Action reservee a la direction.' });
  }
  next();
}

function exigerDirecteur(req, res, next) {
  if (!req.utilisateur) return res.status(401).json({ erreur: 'Session expiree, reconnectez-vous.' });
  if (req.utilisateur.role !== 'directeur') {
    return res.status(403).json({ erreur: 'Action reservee au directeur.' });
  }
  next();
}

/* --------------------- Acces aux montants de la paie ---------------------- */

/*
 * Les salaires ne s'ouvrent jamais sur la seule foi d'une session : le code du
 * directeur est redemande a chaque consultation et a chaque telechargement de
 * la version direction.
 *
 * Le code n'est donc pas echange contre un droit qui dure, mais contre un
 * billet a usage unique, valable deux minutes, consomme des la premiere
 * requete. Un ecran laisse ouvert, une session oubliee, un navigateur partage :
 * aucun de ces cas ne redonne acces aux montants sans redemander le code.
 */
const DUREE_BILLET_MS = 2 * 60 * 1000;
const billetsConsommes = new Map(); // identifiant -> expiration, pour interdire le rejeu

function purgerBillets() {
  const maintenant = Date.now();
  for (const [id, exp] of billetsConsommes) if (exp < maintenant) billetsConsommes.delete(id);
}

/** Delivre un billet a usage unique, apres verification du code. */
function delivrerBilletPaie(utilisateur) {
  return signer({
    uid: utilisateur.id,
    paie: true,
    bid: crypto.randomBytes(9).toString('base64url'),
    exp: Date.now() + DUREE_BILLET_MS,
  });
}

/**
 * Verifie et consomme un billet. Le second appel avec le meme billet echoue :
 * c'est ce qui fait qu'ouvrir le tableau puis le telecharger redemande le code.
 */
function consommerBilletPaie(req, jeton) {
  if (!req.utilisateur || req.utilisateur.role !== 'directeur') return false;
  const donnees = verifier(String(jeton || ''));
  if (!donnees || !donnees.paie || !donnees.bid || donnees.uid !== req.utilisateur.id) return false;

  purgerBillets();
  if (billetsConsommes.has(donnees.bid)) return false;
  billetsConsommes.set(donnees.bid, donnees.exp);
  return true;
}

// Limitation simple des tentatives de PIN, en memoire (un seul processus).
const tentatives = new Map();
const MAX_TENTATIVES = 8;
const FENETRE_MS = 15 * 60 * 1000;

function tropDeTentatives(cle) {
  const entree = tentatives.get(cle);
  if (!entree) return false;
  if (Date.now() - entree.depuis > FENETRE_MS) {
    tentatives.delete(cle);
    return false;
  }
  return entree.nb >= MAX_TENTATIVES;
}

function enregistrerEchec(cle) {
  const entree = tentatives.get(cle);
  if (!entree || Date.now() - entree.depuis > FENETRE_MS) {
    tentatives.set(cle, { nb: 1, depuis: Date.now() });
  } else {
    entree.nb += 1;
  }
}

function reinitialiserTentatives(cle) {
  tentatives.delete(cle);
}

const hacherPin = (pin) => bcrypt.hashSync(String(pin), 10);

/*
 * Un compte peut exister sans code : ceux des conducteurs de travaux, nes de la
 * migration, attendent que le directeur leur en donne un. L'empreinte vide dit
 * exactement cela, et ne peut correspondre a aucune saisie — la comparaison la
 * refuserait de toute facon, mais mieux vaut que le refus soit ecrit ici que
 * confie au comportement d'une bibliotheque.
 */
const SANS_CODE = '';
const codeUtilisable = (hash) => Boolean(hash);
const verifierPin = (pin, hash) => codeUtilisable(hash) && bcrypt.compareSync(String(pin), hash);

module.exports = {
  // Partage avec server/visa.js, qui signe les liens envoyes aux conducteurs
  // de travaux avec la meme cle : elle vit deja dans DATA_DIR/session.key.
  SECRET_JETONS: SECRET,
  session,
  ouvrirSession,
  fermerSession,
  exigerConnexion,
  exigerDirecteur,
  exigerDirecteurOuConducteur,
  espaceConducteurFerme,
  delivrerBilletPaie,
  consommerBilletPaie,
  hacherPin,
  verifierPin,
  codeUtilisable,
  SANS_CODE,
  tropDeTentatives,
  enregistrerEchec,
  reinitialiserTentatives,
};
