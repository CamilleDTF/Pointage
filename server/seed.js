'use strict';

/**
 * Jeu de donnees initial : 1 directeur + 8 chefs d'equipe + leurs operateurs.
 * Codes PIN de demarrage a communiquer aux interesses, a changer des la
 * premiere connexion (bouton "Changer mon code").
 *
 *   node server/seed.js            -> cree les comptes manquants
 *   node server/seed.js --demo     -> ajoute en plus une fiche d'exemple remplie
 */

const { db, journaliser } = require('./db');
const { hacherPin } = require('./auth');
const D = require('./domaine');

const DIRECTEUR = { nom: 'Direction travaux', identifiant: 'directeur', pin: '246810' };

const CHEFS = [
  { nom: 'BENALI Karim', identifiant: 'kbenali', pin: '1001' },
  { nom: 'DUARTE Manuel', identifiant: 'mduarte', pin: '1002' },
  { nom: 'FONTAINE Julien', identifiant: 'jfontaine', pin: '1003' },
  { nom: 'GRANJON Patrick', identifiant: 'pgranjon', pin: '1004' },
  { nom: 'LEMOINE Sebastien', identifiant: 'slemoine', pin: '1005' },
  { nom: 'MARCHAND Yannick', identifiant: 'ymarchand', pin: '1006' },
  { nom: 'NGUYEN Thierry', identifiant: 'tnguyen', pin: '1007' },
  { nom: 'ROSSI Fabien', identifiant: 'frossi', pin: '1008' },
];

const PRENOMS = ['Alain', 'Bruno', 'Cedric', 'David', 'Emeric', 'Franck', 'Gilles', 'Hakim'];
const NOMS = ['ANDRE', 'BERTIN', 'CHEVALIER', 'DELAUNAY', 'ESTEVE', 'FAURE', 'GARNIER', 'HERVE',
  'IMBERT', 'JOLY', 'KOWALSKI', 'LAMBERT', 'MOREAU', 'NOEL', 'OLIVIER', 'PERRIN',
  'QUENTIN', 'RENAUD', 'SOARES', 'TESSIER', 'VASSEUR', 'WEBER', 'XAVIER', 'YOUNES'];

function creerUtilisateur({ nom, identifiant, pin, role }) {
  const existant = db.prepare('SELECT id FROM utilisateurs WHERE identifiant = ?').get(identifiant);
  if (existant) return existant.id;
  const r = db
    .prepare('INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES (?, ?, ?, ?)')
    .run(nom, identifiant, role, hacherPin(pin));
  console.log(`  + ${role.padEnd(9)} ${nom.padEnd(24)} identifiant "${identifiant}"  code ${pin}`);
  return r.lastInsertRowid;
}

function amorcer() {
  console.log('Creation des comptes :');
  creerUtilisateur({ ...DIRECTEUR, role: 'directeur' });

  let curseur = 0;
  CHEFS.forEach((chef, index) => {
    const chefId = creerUtilisateur({ ...chef, role: 'chef' });
    const dejaAffectes = db.prepare('SELECT COUNT(*) AS n FROM salaries WHERE chef_id = ?').get(chefId).n;
    if (dejaAffectes > 0) return;

    const taille = 3 + (index % 3); // equipes de 3 a 5 operateurs
    for (let i = 0; i < taille; i += 1) {
      db.prepare('INSERT INTO salaries (matricule, nom, prenom, chef_id) VALUES (?, ?, ?, ?)').run(
        `M${String(100 + curseur).padStart(4, '0')}`,
        NOMS[curseur % NOMS.length],
        PRENOMS[curseur % PRENOMS.length],
        chefId
      );
      curseur += 1;
    }
  });

  console.log(`\n${db.prepare('SELECT COUNT(*) AS n FROM salaries').get().n} salaries enregistres.`);
}

function ficheDemo() {
  const chef = db.prepare("SELECT id, nom FROM utilisateurs WHERE role = 'chef' ORDER BY id LIMIT 1").get();
  const { annee, semaine } = D.semaineISO(new Date());
  const dejaLa = db
    .prepare('SELECT id FROM fiches WHERE chef_id = ? AND annee = ? AND semaine = ?')
    .get(chef.id, annee, semaine);
  if (dejaLa) {
    console.log('Fiche de demonstration deja presente.');
    return;
  }

  const equipe = db.prepare('SELECT id, nom, prenom FROM salaries WHERE chef_id = ? ORDER BY nom').all(chef.id);
  const res = db
    .prepare(
      `INSERT INTO fiches (chef_id, annee, semaine, chantier, ville, conducteur_vehicule,
                           type_vehicule, immatriculation, statut, soumise_le)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'soumise', datetime('now'))`
    )
    .run(chef.id, annee, semaine, 'Lycee Jean Moulin - Bat. C', 'Toulouse', chef.nom, 'Master L2H2', 'GK-482-QR');
  const ficheId = res.lastInsertRowid;

  const insLigne = db.prepare(
    `INSERT INTO fiche_lignes (fiche_id, salarie_id, nom_affiche, ordre, minutes_route,
                               minutes_trajet, jours_zone, type_masque, nb_deplacement, observation)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insJour = db.prepare('INSERT INTO fiche_jours (ligne_id, jour, minutes, code_absence) VALUES (?, ?, ?, ?)');

  for (let i = 0; i < 11; i += 1) {
    const membre = equipe[i];
    const r = insLigne.run(
      ficheId,
      membre ? membre.id : null,
      membre ? `${membre.nom} ${membre.prenom}` : '',
      i,
      membre ? 150 : 0,
      membre ? 90 : 0,
      membre ? 4 : 0,
      membre ? (i % 2 ? 'AA' : 'VA') : '',
      membre ? 5 : 0,
      ''
    );
    for (let j = 0; j < 7; j += 1) {
      let minutes = 0;
      let code = '';
      if (membre) {
        if (j <= 4) minutes = j === 4 ? 390 : 465; // 7h45 du lundi au jeudi, 6h30 le vendredi
        if (i === 1 && j === 2) { minutes = 0; code = 'AT'; }
        if (i === 2 && j === 4) { minutes = 0; code = 'VM'; }
      }
      insJour.run(r.lastInsertRowid, j, minutes, code);
    }
  }

  journaliser(ficheId, chef.id, 'soumission', 'Fiche de demonstration');
  console.log(`Fiche de demonstration creee (semaine ${semaine}/${annee}, chef ${chef.nom}).`);
}

db.transaction(() => {
  amorcer();
  if (process.argv.includes('--demo')) ficheDemo();
})();

console.log('\nConnexion directeur : identifiant "directeur", code 246810');
console.log('Changez tous les codes apres la premiere connexion.');
