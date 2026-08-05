'use strict';

/*
 * Importe l'effectif depuis le tableau d'affectation des operateurs.
 *
 *   node scripts/importer-effectif.js <fichier.xlsx> [--appliquer]
 *
 * Sans --appliquer, rien n'est ecrit : le script affiche ce qu'il ferait. C'est
 * le mode a utiliser en premier, pour verifier les rapprochements de noms.
 *
 * Le classeur attendu comporte deux feuilles :
 *   - "identifiant"            : Chef de chantier | Identifiant | Mdp
 *   - "Affectation operateurs" : Matricule | NOM | Prenom | Chef d'equipe assigne
 *
 * Le rapprochement entre un operateur et son chef se fait sur le nom, sans tenir
 * compte des accents ni de la casse. Un operateur dont la colonne "chef" ne
 * designe personne de connu (mentions du type "Non indique") est cree sans
 * affectation : le directeur la completera depuis l'ecran Equipes.
 */

const path = require('path');
const ExcelJS = require('exceljs');
const { db } = require('../server/db');
const { hacherPin } = require('../server/auth');
const D = require('../server/domaine');
const { salarieDuChef } = require('../server/fiches');

const fichier = process.argv[2];
const appliquer = process.argv.includes('--appliquer');

if (!fichier) {
  console.error('Usage : node scripts/importer-effectif.js <fichier.xlsx> [--appliquer]');
  process.exit(1);
}

const cle = (nom) => D.sansAccents(nom).replace(/[^A-Z]/g, '');
const texte = (cellule) => String(cellule?.text ?? cellule?.value ?? '').trim();

/** Nom de feuille tolerant aux accents et a la casse. */
function feuille(classeur, recherche) {
  const cherche = cle(recherche);
  const trouvee = classeur.worksheets.find((ws) => cle(ws.name).startsWith(cherche));
  if (!trouvee) {
    throw new Error(
      `Feuille "${recherche}" introuvable. Feuilles présentes : ${classeur.worksheets.map((w) => w.name).join(', ')}`
    );
  }
  return trouvee;
}

async function importer() {
  const classeur = new ExcelJS.Workbook();
  await classeur.xlsx.readFile(path.resolve(fichier));

  /* ------------------------------ Chefs d'equipe --------------------------- */

  const chefs = [];
  feuille(classeur, 'identifiant').eachRow((ligne, numero) => {
    if (numero === 1) return; // en-tete
    const nom = texte(ligne.getCell(1));
    const identifiant = texte(ligne.getCell(2)).toLowerCase();
    const code = texte(ligne.getCell(3));
    if (!nom || !identifiant) return;
    if (!/^\d{4,8}$/.test(code)) {
      console.warn(`  ! ${nom} : code "${code}" invalide (4 à 8 chiffres attendus), ligne ignorée.`);
      return;
    }
    chefs.push({ nom, identifiant, code });
  });

  /* -------------------------------- Operateurs ----------------------------- */

  const operateurs = [];
  feuille(classeur, 'Affectation').eachRow((ligne, numero) => {
    if (numero === 1) return;
    const nom = texte(ligne.getCell(2));
    const prenom = texte(ligne.getCell(3));
    if (!nom || !prenom) return;
    operateurs.push({
      matricule: texte(ligne.getCell(1)),
      nom,
      prenom,
      chefBrut: texte(ligne.getCell(4)),
    });
  });

  /* ------------------------------ Rapprochements --------------------------- */

  const parCle = new Map(chefs.map((c) => [cle(c.nom), c]));
  const sansChef = [];
  for (const operateur of operateurs) {
    operateur.chef = parCle.get(cle(operateur.chefBrut)) || null;
    if (!operateur.chef) sansChef.push(operateur);
  }

  console.log(`\n${chefs.length} chef(s) d'équipe et ${operateurs.length} opérateur(s) lus.`);
  if (sansChef.length) {
    console.log(`\n${sansChef.length} opérateur(s) sans chef reconnu — à affecter depuis l'écran Équipes :`);
    for (const o of sansChef) console.log(`  · ${o.nom} ${o.prenom}  (colonne chef : "${o.chefBrut}")`);
  }

  if (!appliquer) {
    console.log('\nSimulation terminée — rien n\'a été écrit.');
    console.log('Relancez avec --appliquer pour créer les comptes et les salariés.');
    return;
  }

  /* -------------------------------- Ecriture ------------------------------- */

  const resume = { chefsCrees: 0, chefsMisAJour: 0, salariesCrees: 0, salariesMisAJour: 0, chefsAjoutesAuxSalaries: 0 };

  db.transaction(() => {
    for (const chef of chefs) {
      const existant = db.prepare('SELECT id FROM utilisateurs WHERE identifiant = ?').get(chef.identifiant);
      if (existant) {
        db.prepare('UPDATE utilisateurs SET nom = ?, actif = 1 WHERE id = ?').run(chef.nom, existant.id);
        chef.id = existant.id;
        resume.chefsMisAJour += 1;
      } else {
        chef.id = db
          .prepare("INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES (?, ?, 'chef', ?)")
          .run(chef.nom, chef.identifiant, hacherPin(chef.code)).lastInsertRowid;
        resume.chefsCrees += 1;
      }
    }

    for (const operateur of operateurs) {
      const chefId = operateur.chef ? operateur.chef.id : null;
      // Le matricule identifie un salarie ; a defaut, le couple nom + prenom.
      const existant = operateur.matricule
        ? db.prepare('SELECT id FROM salaries WHERE matricule = ?').get(operateur.matricule)
        : db.prepare('SELECT id FROM salaries WHERE nom = ? AND prenom = ?').get(operateur.nom, operateur.prenom);

      if (existant) {
        db.prepare('UPDATE salaries SET nom = ?, prenom = ?, chef_id = ?, actif = 1 WHERE id = ?')
          .run(operateur.nom, operateur.prenom, chefId, existant.id);
        resume.salariesMisAJour += 1;
      } else {
        db.prepare('INSERT INTO salaries (matricule, nom, prenom, chef_id) VALUES (?, ?, ?, ?)')
          .run(operateur.matricule, operateur.nom, operateur.prenom, chefId);
        resume.salariesCrees += 1;
      }
    }

    // Un chef d'equipe pointe ses heures comme ses operateurs : il lui faut une
    // fiche salarie. On le fait apres les operateurs, pour rattacher la sienne
    // s'il figure deja dans le tableau d'affectation plutot qu'en creer une
    // seconde.
    for (const chef of chefs) {
      const avant = db.prepare('SELECT COUNT(*) AS n FROM salaries').get().n;
      salarieDuChef(chef.id);
      if (db.prepare('SELECT COUNT(*) AS n FROM salaries').get().n > avant) resume.chefsAjoutesAuxSalaries += 1;
    }
  })();

  console.log('\nImport terminé :');
  console.log(`  chefs d'équipe : ${resume.chefsCrees} créé(s), ${resume.chefsMisAJour} mis à jour`);
  console.log(`  salariés       : ${resume.salariesCrees} créé(s), ${resume.salariesMisAJour} mis à jour`);
  console.log(`  dont chefs ajoutés à l'effectif : ${resume.chefsAjoutesAuxSalaries}`);
  console.log('\nLes codes du fichier sont les codes de première connexion.');
  console.log('Demandez à chaque chef de le changer via le bouton « Code ».');
}

importer().catch((e) => {
  console.error(`\nÉchec de l'import : ${e.message}`);
  process.exit(1);
});
