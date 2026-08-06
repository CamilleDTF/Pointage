'use strict';

/*
 * Reglages lus dans un fichier texte, a cote de DEMARRER.bat.
 *
 * Tout se regle par variables d'environnement — c'est commode sur un serveur
 * Linux, ou elles se posent dans un fichier de service. Sur le poste de la
 * direction, personne ne va ouvrir une invite de commandes pour taper
 * `set SMTP_HOTE=...` avant chaque demarrage : le reglage se perdrait a la
 * premiere fermeture de la fenetre.
 *
 * D'ou ce fichier : `configuration.txt`, une ligne par reglage, ouvert au
 * bloc-notes comme n'importe quel document. Il est lu au demarrage et ses
 * valeurs sont posees dans l'environnement, sans jamais ecraser une variable
 * deja definie — la ligne de commande et le service systeme restent
 * prioritaires sur le fichier.
 *
 * Il contient un mot de passe de messagerie : il n'est pas suivi par git et ne
 * part dans aucune sauvegarde publique.
 */

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const FICHIER = process.env.POINTAGE_CONFIG || path.join(RACINE, 'configuration.txt');

/** "CLE = valeur  # note" -> ['CLE', 'valeur']. Renvoie null si la ligne n'en est pas une. */
function lireLigne(ligne) {
  const nette = ligne.trim();
  if (!nette || nette.startsWith('#') || nette.startsWith(';') || /^rem\b/i.test(nette)) return null;

  const separateur = nette.indexOf('=');
  if (separateur === -1) return null;

  const cle = nette.slice(0, separateur).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(cle)) return null;

  let valeur = nette.slice(separateur + 1).trim();
  // Les guillemets sont tolerés : un mot de passe finissant par une espace se
  // protege ainsi, et un copier-coller depuis une documentation en garde souvent.
  if (valeur.length > 1 && ((valeur.startsWith('"') && valeur.endsWith('"')) ||
      (valeur.startsWith("'") && valeur.endsWith("'")))) {
    valeur = valeur.slice(1, -1);
  }
  return [cle, valeur];
}

function charger(fichier = FICHIER) {
  let texte;
  try {
    texte = fs.readFileSync(fichier, 'utf8');
  } catch {
    return { fichier, trouve: false, cles: [] };
  }

  const cles = [];
  for (const ligne of texte.split(/\r?\n/)) {
    const paire = lireLigne(ligne);
    if (!paire) continue;
    const [cle, valeur] = paire;
    if (process.env[cle] !== undefined) continue; // l'environnement l'emporte
    if (valeur === '') continue;                  // une case laissee vide n'est pas un reglage
    process.env[cle] = valeur;
    cles.push(cle);
  }

  return { fichier, trouve: true, cles };
}

const resultat = charger();

module.exports = { charger, lireLigne, FICHIER, resultat };
