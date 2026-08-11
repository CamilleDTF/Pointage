'use strict';

/*
 * Le coffre de la paie : les montants illisibles hors de l'application.
 *
 * Jusqu'ici, le cloisonnement vivait dans les ecrans. Il protegeait qui passait
 * par l'application, et personne d'autre : une seule commande sur le fichier
 * `pointage.db` livrait tous les taux horaires, sans le moindre identifiant.
 * Une sauvegarde, un instantane de machine virtuelle, un disque emporte —
 * chacun disait tout.
 *
 * Ce module deplace le mur de l'ecran vers la donnee. Trois colonnes seulement
 * portent de l'argent — le taux horaire d'un salarie, le montant d'une prime,
 * la valeur d'un parametre de paie — et tout le reste s'en deduit. Chiffrees,
 * elles rendent les tableaux mensuels et les exports incalculables sans la cle.
 *
 *
 * POURQUOI UNE PHRASE, ET NON LE CODE A SIX CHIFFRES
 *
 * Un code de six chiffres, c'est un million de combinaisons : qui detient le
 * fichier les essaie toutes en quelques minutes, hors ligne, sans que rien ne
 * l'en empeche — les huit tentatives par quart d'heure ne valent que devant
 * l'application. Une cle tiree d'un tel code ne protegerait rien. Il faut donc
 * une vraie phrase, et c'est le prix a payer pour que le mur soit reel.
 *
 *
 * DEUX ENVELOPPES POUR UNE SEULE CLE
 *
 * La cle qui chiffre les montants est tiree au hasard, jamais derivee de la
 * phrase : ainsi, changer la phrase ne demande pas de tout rechiffrer. Elle est
 * rangee dans deux enveloppes, chacune suffisant a l'ouvrir :
 *
 *   - la phrase de la direction, passee par scrypt — lent a dessein, pour qu'un
 *     essai coute cher meme hors ligne ;
 *   - une cle de secours tiree au hasard, montree UNE fois a la creation, a
 *     imprimer et ranger. Elle existe parce qu'un chiffrement sans reprise est
 *     une promesse de perte : une phrase oubliee effacerait tous les taux.
 *
 * L'administrateur technique ne voit ni l'une ni l'autre. C'est ce qui fait la
 * difference avec le cloisonnement precedent : il ne depend plus d'un controle
 * qu'on pourrait contourner, mais d'un secret qu'il n'a pas.
 *
 *
 * CE QUE CECI NE PROTEGE PAS
 *
 * Rien ici n'arrete quelqu'un qui modifierait le code du serveur et attendrait
 * que la direction tape sa phrase. Aucun chiffrement cote serveur ne le peut :
 * au moment ou l'application affiche un montant, elle le detient en clair. La
 * parade est humaine — qui a le droit de deployer — et c'est dit tel quel dans
 * la documentation plutot que passe sous silence.
 */

const crypto = require('crypto');
const { db } = require('./db');

/*
 * scrypt : N = 2^16 tient environ 0,3 s par essai sur une machine ordinaire, et
 * demande 64 Mo de memoire — ce qui est precisement le but, la memoire etant ce
 * qui coute le plus cher a paralleliser sur une carte graphique.
 */
const SCRYPT = { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
const TAILLE_CLE = 32;

/** Une seance ouverte : la cle en memoire, et rien sur le disque. */
const DUREE_SEANCE_MS = 15 * 60 * 1000;
const seances = new Map(); // jeton -> { cle, uid, expire }

/* ------------------------------ Primitives -------------------------------- */

function deriver(phrase, sel) {
  return crypto.scryptSync(String(phrase).normalize('NFKC'), sel, TAILLE_CLE, SCRYPT);
}

/** `nonce.chiffre.sceau`, en base64url : un seul champ texte a stocker. */
function sceller(cle, clair) {
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cle, nonce);
  const chiffre = Buffer.concat([c.update(String(clair), 'utf8'), c.final()]);
  return [nonce, chiffre, c.getAuthTag()].map((b) => b.toString('base64url')).join('.');
}

/**
 * Renvoie le clair, ou null si le sceau ne correspond pas.
 *
 * GCM authentifie : une valeur modifiee en base ne se dechiffre pas en silence,
 * elle echoue. C'est ce qui fait qu'un taux ne peut pas etre change a la main
 * dans le fichier sans que l'application s'en apercoive.
 */
function ouvrir(cle, scelle) {
  try {
    const [nonce, chiffre, sceau] = String(scelle).split('.').map((p) => Buffer.from(p, 'base64url'));
    if (!nonce || !chiffre || !sceau) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', cle, nonce);
    d.setAuthTag(sceau);
    return Buffer.concat([d.update(chiffre), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/* ------------------------------ Le coffre --------------------------------- */

const etat = () => db.prepare('SELECT * FROM coffre_paie WHERE id = 1').get() || null;
const existe = () => Boolean(etat());

/*
 * La cle de secours, telle qu'on la lit sur un papier.
 *
 * Vingt caracteres d'un alphabet sans I, O, 0 ni 1 — les quatre qu'on recopie
 * de travers — groupes par quatre. Cela fait environ 92 bits : hors d'atteinte
 * d'une recherche exhaustive, et transcrivible sans se tromper.
 */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function tirerCleSecours() {
  const octets = crypto.randomBytes(20);
  const lettres = Array.from(octets, (o) => ALPHABET[o % ALPHABET.length]).join('');
  return lettres.match(/.{1,4}/g).join('-');
}

const normaliserSecours = (saisie) =>
  String(saisie || '').toUpperCase().replace(/[^A-Z2-9]/g, '');

/**
 * Cree le coffre et renvoie la cle de secours — la seule fois ou elle existe
 * en clair. Elle n'est stockee nulle part : seule son enveloppe l'est.
 */
function creer(phrase) {
  if (existe()) return { erreur: 'Le coffre existe deja.', code: 409 };
  if (String(phrase || '').normalize('NFKC').trim().length < 12) {
    return { erreur: 'La phrase doit comporter au moins 12 caracteres.', code: 400 };
  }

  const cle = crypto.randomBytes(TAILLE_CLE);
  const secours = tirerCleSecours();
  const selPhrase = crypto.randomBytes(16);
  const selSecours = crypto.randomBytes(16);

  db.prepare(
    `INSERT INTO coffre_paie (id, sel_phrase, enveloppe_phrase, sel_secours, enveloppe_secours, cree_le)
     VALUES (1, ?, ?, ?, ?, datetime('now'))`
  ).run(
    selPhrase.toString('base64url'),
    sceller(deriver(phrase, selPhrase), cle.toString('base64url')),
    selSecours.toString('base64url'),
    sceller(deriver(normaliserSecours(secours), selSecours), cle.toString('base64url'))
  );

  return { cle, secours };
}

/** Ouvre le coffre avec la phrase, ou avec la cle de secours. Rien d'autre. */
function deverrouiller({ phrase, secours }) {
  const c = etat();
  if (!c) return null;

  if (phrase !== undefined && phrase !== null && String(phrase) !== '') {
    const clair = ouvrir(deriver(phrase, Buffer.from(c.sel_phrase, 'base64url')), c.enveloppe_phrase);
    if (clair) return Buffer.from(clair, 'base64url');
  }
  if (secours) {
    const clair = ouvrir(
      deriver(normaliserSecours(secours), Buffer.from(c.sel_secours, 'base64url')),
      c.enveloppe_secours
    );
    if (clair) return Buffer.from(clair, 'base64url');
  }
  return null;
}

/**
 * Change la phrase sans toucher aux donnees chiffrees.
 *
 * C'est tout l'interet d'avoir tire la cle au hasard plutot que de la deriver
 * de la phrase : on remplace une enveloppe, pas des milliers de valeurs.
 */
function changerPhrase(cleActuelle, nouvellePhrase) {
  if (String(nouvellePhrase || '').normalize('NFKC').trim().length < 12) {
    return { erreur: 'La phrase doit comporter au moins 12 caracteres.', code: 400 };
  }
  const sel = crypto.randomBytes(16);
  db.prepare('UPDATE coffre_paie SET sel_phrase = ?, enveloppe_phrase = ? WHERE id = 1').run(
    sel.toString('base64url'),
    sceller(deriver(nouvellePhrase, sel), cleActuelle.toString('base64url'))
  );
  return { ok: true };
}

/* ------------------------------ Les seances -------------------------------- */

function purger() {
  const maintenant = Date.now();
  for (const [jeton, s] of seances) {
    if (s.expire < maintenant) {
      s.cle.fill(0); // la cle ne traine pas en memoire une fois la seance close
      seances.delete(jeton);
    }
  }
}

/** Ouvre une seance de quinze minutes et renvoie son jeton. */
function ouvrirSeance(cle, uid) {
  purger();
  const jeton = crypto.randomBytes(18).toString('base64url');
  seances.set(jeton, { cle, uid, expire: Date.now() + DUREE_SEANCE_MS });
  return jeton;
}

/**
 * La cle d'une seance, ou null.
 *
 * Le titulaire est verifie : un jeton vole ne sert a rien depuis une autre
 * session, et une seance ouverte par la direction ne se prolonge pas en
 * changeant de compte.
 */
function cleDeSeance(jeton, uid) {
  purger();
  const s = seances.get(String(jeton || ''));
  if (!s || s.uid !== uid) return null;
  return s.cle;
}

function fermerSeances(uid) {
  for (const [jeton, s] of seances) {
    if (s.uid === uid) { s.cle.fill(0); seances.delete(jeton); }
  }
}

/* --------------------------- Valeurs monetaires ---------------------------- */

/*
 * Un montant absent et un montant nul ne disent pas la meme chose : « pas
 * encore renseigne » n'est pas « zero euro ». Le premier reste vide, et c'est
 * ce qui fait dire a l'application « taux manquant » plutot que de calculer un
 * salaire faux.
 */
const chiffrerMontant = (cle, valeur) =>
  valeur === null || valeur === undefined || valeur === '' ? '' : sceller(cle, String(valeur));

function dechiffrerMontant(cle, scelle) {
  if (!scelle) return null;
  const clair = ouvrir(cle, scelle);
  if (clair === null) return null;
  const n = Number(clair);
  return Number.isFinite(n) ? n : null;
}

/*
 * La bascule : chiffrer ce qui existe deja, puis effacer le clair.
 *
 * Le second geste est le seul qui compte. Sceller les taux en laissant les
 * anciennes colonnes remplies ne protegerait rien du tout — le fichier
 * continuerait de tout dire, et on aurait juste ajoute du travail. La remise a
 * zero se fait donc dans la meme transaction que le chiffrement : soit les deux,
 * soit ni l'un ni l'autre.
 */
function chiffrerExistant(cle) {
  const compte = { taux: 0, primes: 0, parametres: 0 };

  db.transaction(() => {
    for (const s of db.prepare('SELECT id, taux_horaire FROM salaries WHERE taux_horaire > 0').all()) {
      db.prepare('UPDATE salaries SET taux_horaire_scelle = ?, taux_horaire = 0 WHERE id = ?')
        .run(chiffrerMontant(cle, s.taux_horaire), s.id);
      compte.taux += 1;
    }
    for (const p of db.prepare('SELECT id, montant FROM primes_non_productifs WHERE montant != 0').all()) {
      db.prepare('UPDATE primes_non_productifs SET montant_scelle = ?, montant = 0 WHERE id = ?')
        .run(chiffrerMontant(cle, p.montant), p.id);
      compte.primes += 1;
    }
    for (const t of db.prepare('SELECT id, valeur FROM taux').all()) {
      db.prepare('UPDATE taux SET valeur_scellee = ?, valeur = 0 WHERE id = ?')
        .run(chiffrerMontant(cle, t.valeur), t.id);
      compte.parametres += 1;
    }
  })();

  return compte;
}

/**
 * Reste-t-il un montant en clair dans le fichier ?
 *
 * Sert au controle d'apres-bascule, et a l'ecran qui l'affiche : une promesse
 * d'etancheite se verifie, elle ne se declare pas.
 */
function resteDuClair() {
  const n = (sql) => db.prepare(sql).get().n;
  return (
    n('SELECT COUNT(*) AS n FROM salaries WHERE taux_horaire > 0')
    + n('SELECT COUNT(*) AS n FROM primes_non_productifs WHERE montant != 0')
    + n('SELECT COUNT(*) AS n FROM taux WHERE valeur != 0')
  );
}

/**
 * Le montant d'une ligne, scelle ou non.
 *
 * Tant que le coffre n'est pas cree, l'application lit le clair et fonctionne
 * comme avant : la bascule est un geste de la direction, pas une condition au
 * demarrage. Une fois le coffre en place, la meme lecture rend `null` sans la
 * cle — et `null` n'est pas zero, c'est ce qui fait dire « taux manquant »
 * plutot que de calculer un salaire faux.
 */
function montantDe(cle, ligne, champClair, champScelle) {
  const scelle = ligne[champScelle];
  if (scelle) return cle ? dechiffrerMontant(cle, scelle) : null;
  const clair = Number(ligne[champClair]);
  return Number.isFinite(clair) ? clair : null;
}

module.exports = {
  existe,
  chiffrerExistant,
  resteDuClair,
  montantDe,
  etat,
  creer,
  deverrouiller,
  changerPhrase,
  ouvrirSeance,
  cleDeSeance,
  fermerSeances,
  chiffrerMontant,
  dechiffrerMontant,
  normaliserSecours,
  DUREE_SEANCE_MS,
};
