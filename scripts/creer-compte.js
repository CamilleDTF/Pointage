'use strict';

/*
 * Cree ou met a jour un compte, en ligne de commande.
 *
 *   node scripts/creer-compte.js --nom "Direction travaux" \
 *        --identifiant directeur --code 246810 --role directeur
 *
 *   node scripts/creer-compte.js --nom "MARTINEZ Camille" \
 *        --identifiant camille --code 135790 --role admin
 *
 * L'ecran "Equipes" permet ensuite de gerer les comptes, mais il faut deja etre
 * connecte en directeur pour y acceder : ce script est la porte d'entree d'une
 * installation neuve. Relance sur un identifiant existant, il se contente de
 * mettre a jour le nom, le role et le code.
 */

require('../server/configuration'); // reglages de configuration.txt
const { db } = require('../server/db');
const { hacherPin } = require('../server/auth');

function argument(nom) {
  const index = process.argv.indexOf(`--${nom}`);
  return index === -1 ? null : process.argv[index + 1];
}

const nom = argument('nom');
const identifiant = (argument('identifiant') || '').trim().toLowerCase();
const code = argument('code');
/*
 * Le role, avec « directeur » pour defaut historique.
 *
 * `admin` compte ici autant que les autres : c'est par ce script qu'un
 * administrateur technique recoit son premier compte, personne dans
 * l'application ne pouvant s'en creer un tout seul.
 */
const ROLES = ['directeur', 'chef', 'conducteur', 'admin'];
const role = ROLES.includes(argument('role')) ? argument('role') : 'directeur';

if (!nom || !identifiant || !code) {
  console.error(
    'Usage : node scripts/creer-compte.js --nom "NOM Prénom" --identifiant xxx --code 123456 [--role directeur|chef|conducteur|admin]'
  );
  process.exit(1);
}
if (!/^\d{4,8}$/.test(code)) {
  console.error('Le code doit comporter de 4 à 8 chiffres.');
  process.exit(1);
}

const existant = db.prepare('SELECT id FROM utilisateurs WHERE identifiant = ?').get(identifiant);

if (existant) {
  db.prepare('UPDATE utilisateurs SET nom = ?, role = ?, pin_hash = ?, actif = 1, code_provisoire = 1 WHERE id = ?')
    .run(nom, role, hacherPin(code), existant.id);
  console.log(`Compte mis à jour : ${nom} (${identifiant}), rôle ${role}.`);
} else {
  db.prepare('INSERT INTO utilisateurs (nom, identifiant, role, pin_hash, code_provisoire) VALUES (?, ?, ?, ?, 1)')
    .run(nom, identifiant, role, hacherPin(code));
  console.log(`Compte créé : ${nom} (${identifiant}), rôle ${role}.`);
}

console.log('Le code fourni est un code de première connexion : faites-le changer via le bouton « Code ».');
