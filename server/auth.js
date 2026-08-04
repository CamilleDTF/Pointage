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
      .prepare('SELECT id, nom, identifiant, role, actif FROM utilisateurs WHERE id = ?')
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

function exigerDirecteur(req, res, next) {
  if (!req.utilisateur) return res.status(401).json({ erreur: 'Session expiree, reconnectez-vous.' });
  if (req.utilisateur.role !== 'directeur') {
    return res.status(403).json({ erreur: 'Action reservee au directeur.' });
  }
  next();
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
const verifierPin = (pin, hash) => bcrypt.compareSync(String(pin), hash);

module.exports = {
  session,
  ouvrirSession,
  connexionChiffree,
  fermerSession,
  exigerConnexion,
  exigerDirecteur,
  hacherPin,
  verifierPin,
  tropDeTentatives,
  enregistrerEchec,
  reinitialiserTentatives,
};
