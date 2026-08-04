'use strict';

/*
 * Affiche ce que contient reellement la base : comptes et salaries.
 *
 *   node scripts/lister-effectif.js
 *
 * Sert a trancher entre "l'import n'a rien ecrit" et "l'import a ecrit mais
 * l'ecran ne le montre pas", sans avoir a interpreter une capture d'ecran.
 */

const { db } = require('../server/db');

const utilisateurs = db
  .prepare('SELECT id, nom, identifiant, role, actif FROM utilisateurs ORDER BY role DESC, nom')
  .all();

const salaries = db
  .prepare(
    `SELECT s.matricule, s.nom, s.prenom, s.actif, u.nom AS chef
       FROM salaries s LEFT JOIN utilisateurs u ON u.id = s.chef_id
      ORDER BY s.nom, s.prenom`
  )
  .all();

console.log('');
console.log('=== COMPTES ===');
if (!utilisateurs.length) {
  console.log('  AUCUN COMPTE. L import ne s est pas execute.');
} else {
  for (const u of utilisateurs) {
    console.log(
      `  ${u.role.padEnd(9)} ${u.nom.padEnd(26)} identifiant "${u.identifiant}"${u.actif ? '' : '  (desactive)'}`
    );
  }
}
console.log(`  -> ${utilisateurs.filter((u) => u.role === 'chef').length} chef(s) d equipe, ` +
  `${utilisateurs.filter((u) => u.role === 'directeur').length} directeur(s)`);

console.log('');
console.log('=== SALARIES ===');
if (!salaries.length) {
  console.log('  AUCUN SALARIE.');
} else {
  for (const s of salaries) {
    console.log(
      `  ${(s.matricule || '').padEnd(8)} ${`${s.nom} ${s.prenom}`.padEnd(30)} ${s.chef || '-- sans chef --'}`
    );
  }
}
console.log(`  -> ${salaries.length} salarie(s), ` +
  `${salaries.filter((s) => !s.chef).length} sans chef assigne`);

console.log('');
console.log(`Base lue : ${require('path').join(require('../server/db').DATA_DIR, 'pointage.db')}`);
console.log('');
