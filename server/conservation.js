'use strict';

/*
 * Combien de temps garde-t-on ces donnees, et que reste-t-il apres.
 *
 * Une fiche de pointage justifie des heures de travail. Elle ne se garde pas
 * indefiniment — la CNIL demande une duree definie, et l'archivage
 * intermediaire du suivi du temps de travail va jusqu'a cinq ans — mais elle ne
 * s'efface pas non plus d'un trait : c'est une preuve, et elle sert aux deux
 * parties. Ecrire « RGPD : 5 ans » dans un dossier de projet ne suffit pas ; il
 * faut que le logiciel sache le faire.
 *
 * La reponse retenue est l'ANONYMISATION, pas la suppression :
 *
 *   - ce qui identifie la personne disparait — nom, prenom, matricule, et sa
 *     signature manuscrite, qui l'identifie autant que son nom ;
 *   - ce qui prouve les heures reste — les journees, les totaux, les fiches
 *     validees, le journal des decisions.
 *
 * Supprimer aurait vide des fiches deja validees et fait bouger des totaux de
 * mois passes : on aurait detruit la preuve en croyant proteger la personne, et
 * contredit la regle meme qui rend une fiche validee intangible.
 *
 * Rien ne se declenche tout seul. L'ecran dit qui est concerne ; c'est la
 * direction qui agit. Un effacement automatique, un jour de mauvais reglage,
 * effacerait ce que personne n'a decide d'effacer.
 */

const { db, journaliser } = require('./db');
const COFFRE = require('./coffre');

/*
 * Cinq ans apres le dernier pointage. C'est la borne haute de l'archivage
 * intermediaire pour le suivi du temps de travail ; en deca, les prescriptions
 * en matiere de salaire ont joue.
 */
const DUREE_CONSERVATION_MOIS = 60;

const nomAnonyme = (id) => ({ nom: 'SALARIÉ', prenom: `n° ${id}`, matricule: '' });
const etiquette = (id) => `SALARIÉ n° ${id}`;

/** Le dernier jour pointe pour quelqu'un, tous chantiers confondus. */
function derniereActivite(salarieId) {
  const fiche = db
    .prepare(
      `SELECT MAX(f.annee * 100 + f.semaine) AS periode
         FROM fiche_lignes l JOIN fiches f ON f.id = l.fiche_id
        WHERE l.salarie_id = ?`
    )
    .get(salarieId);
  const jour = db
    .prepare('SELECT MAX(date) AS date FROM jours_non_productifs WHERE salarie_id = ?')
    .get(salarieId);
  return { periode: fiche ? fiche.periode : null, date: jour ? jour.date : null };
}

/**
 * Qui peut etre anonymise : les salaries inactifs dont plus rien n'a bouge
 * depuis la duree de conservation. Un salarie encore en poste n'y figure jamais,
 * meme s'il n'a pas ete pointe depuis longtemps — c'est une sortie d'effectif
 * qu'on traite, pas une absence.
 */
function candidats(maintenant = new Date()) {
  const limite = new Date(maintenant);
  limite.setMonth(limite.getMonth() - DUREE_CONSERVATION_MOIS);
  const limiteIso = limite.toISOString().slice(0, 10);
  const [anneeLimite, moisLimite] = [limite.getUTCFullYear(), limite.getUTCMonth() + 1];
  // Une semaine ISO se compare mal a un mois : on prend la semaine du premier
  // du mois, ce qui reste du bon cote de la borne a quelques jours pres.
  const periodeLimite = anneeLimite * 100 + (moisLimite === 1 ? 1 : Math.floor((moisLimite - 1) * 4.34));

  return db
    .prepare(
      'SELECT id, matricule, nom, prenom, actif, productif FROM salaries WHERE actif = 0 AND anonymise_le IS NULL ORDER BY nom, prenom'
    )
    .all()
    .map((s) => {
      const derniere = derniereActivite(s.id);
      return { ...s, derniere };
    })
    .filter((s) => {
      const parFiche = s.derniere.periode === null || s.derniere.periode < periodeLimite;
      const parJour = !s.derniere.date || s.derniere.date < limiteIso;
      return parFiche && parJour;
    });
}

/**
 * Efface ce qui identifie une personne, partout ou son nom a ete recopie.
 *
 * Le nom a voyage : la ligne de fiche le porte en clair (`nom_affiche`), les
 * versions archivees en gardent une copie JSON, et le journal l'a ecrit dans ses
 * releves de corrections. Un effacement qui n'irait pas partout laisserait le
 * nom lisible a l'endroit meme ou on le cherche.
 */
function anonymiser(salarieId, utilisateur) {
  const salarie = db.prepare('SELECT * FROM salaries WHERE id = ?').get(Number(salarieId));
  if (!salarie) return { erreur: 'Salarie introuvable.', code: 404 };
  if (salarie.anonymise_le) return { erreur: 'Ce salarie est deja anonymise.', code: 409 };

  const ancien = `${salarie.nom} ${salarie.prenom}`.trim();
  const anonyme = nomAnonyme(salarie.id);
  const nouveau = etiquette(salarie.id);

  db.transaction(() => {
    db.prepare(
      `UPDATE salaries SET nom = @nom, prenom = @prenom, matricule = @matricule,
              actif = 0, anonymise_le = datetime('now') WHERE id = @id`
    ).run({ ...anonyme, id: salarie.id });

    /*
     * La signature manuscrite part avec le nom : elle identifie son auteur au
     * moins autant. Ce qu'elle attestait — les heures — reste sur la ligne.
     */
    db.prepare(
      `UPDATE fiche_lignes SET nom_affiche = ?, signature = NULL, signature_cle = '', signature_empreinte = ''
        WHERE salarie_id = ?`
    ).run(nouveau, salarie.id);

    // Les lignes sans rattachement qui portaient son nom en clair — un renfort
    // saisi a la main avant qu'il soit au registre.
    if (ancien) {
      db.prepare(
        `UPDATE fiche_lignes SET nom_affiche = ?, signature = NULL, signature_cle = '', signature_empreinte = ''
          WHERE salarie_id IS NULL AND TRIM(nom_affiche) = ?`
      ).run(nouveau, ancien);
    }

    /*
     * Les versions archivees sont du JSON fige : on ne peut pas les mettre a
     * jour par SQL, il faut les relire. Elles restent des pieces justificatives,
     * mais sans le nom ni la signature.
     */
    if (ancien) {
      const versions = db.prepare('SELECT id, contenu FROM fiche_versions').all();
      const ecrire = db.prepare('UPDATE fiche_versions SET contenu = ? WHERE id = ?');
      for (const version of versions) {
        let fiche;
        try {
          fiche = JSON.parse(version.contenu);
        } catch {
          continue; // un contenu illisible ne doit pas bloquer l'anonymisation
        }
        let touche = false;
        for (const ligne of fiche.lignes || []) {
          const sienne = ligne.salarie_id === salarie.id || String(ligne.nom_affiche || '').trim() === ancien;
          if (!sienne) continue;
          ligne.nom_affiche = nouveau;
          ligne.signature = null;
          ligne.signature_cle = '';
          ligne.signature_empreinte = '';
          touche = true;
        }
        if (touche) ecrire.run(JSON.stringify(fiche), version.id);
      }
    }

    /*
     * Le journal a ecrit son nom dans les releves de corrections. On le remplace
     * dans le texte : la trace de ce qui a change reste, la personne n'y est
     * plus nommee.
     */
    if (ancien) {
      db.prepare("UPDATE journal SET detail = REPLACE(detail, ?, ?) WHERE detail LIKE '%' || ? || '%'")
        .run(ancien, nouveau, ancien);
    }
  })();

  journaliser(
    null,
    utilisateur ? utilisateur.id : null,
    'anonymisation',
    `Salarié n° ${salarie.id} anonymisé — durée de conservation dépassée`
  );
  return { ok: true, id: salarie.id, etiquette: nouveau };
}

/**
 * Tout ce que l'application detient sur une personne, en un seul objet.
 *
 * C'est ce qu'on remet a un salarie qui demande a savoir. Le rassembler a la
 * main dans six tables, le jour ou la demande arrive, serait la meilleure facon
 * d'en oublier une.
 */
function dossierSalarie(salarieId, cleCoffre = null) {
  const salarie = db.prepare('SELECT * FROM salaries WHERE id = ?').get(Number(salarieId));
  if (!salarie) return { erreur: 'Salarie introuvable.', code: 404 };

  const pointages = db
    .prepare(
      `SELECT f.annee, f.semaine, f.chantier, f.ville, f.statut, l.id AS ligne_id,
              l.minutes_route, l.minutes_trajet, l.jours_zone, l.type_masque,
              l.nb_gd72, l.nb_gd80, l.observation, l.signature IS NOT NULL AS signee
         FROM fiche_lignes l JOIN fiches f ON f.id = l.fiche_id
        WHERE l.salarie_id = ?
        ORDER BY f.annee, f.semaine`
    )
    .all(salarie.id);

  const jours = db.prepare('SELECT jour, minutes, code_absence FROM fiche_jours WHERE ligne_id = ? ORDER BY jour');
  for (const p of pointages) {
    p.jours = jours.all(p.ligne_id);
    delete p.ligne_id;
  }

  return {
    salarie: {
      id: salarie.id,
      matricule: salarie.matricule,
      nom: salarie.nom,
      prenom: salarie.prenom,
      actif: salarie.actif,
      productif: salarie.productif,
      /*
       * Le dossier remis a un salarie qui demande ce qu'on detient sur lui.
       * Coffre ouvert, son taux y figure — c'est SON salaire, il a le droit de
       * le lire. Coffre ferme, la ligne dit qu'il existe sans le divulguer,
       * plutot que d'afficher un zero qu'on prendrait pour la verite.
       */
      tauxHoraire: COFFRE.montantDe(cleCoffre, salarie, 'taux_horaire', 'taux_horaire_scelle'),
      anonymiseLe: salarie.anonymise_le,
    },
    pointages,
    conges: db
      .prepare('SELECT debut, fin, motif, commentaire FROM conges WHERE salarie_id = ? ORDER BY debut')
      .all(salarie.id),
    joursNonProductifs: db
      .prepare('SELECT date, code_absence, minutes, gd FROM jours_non_productifs WHERE salarie_id = ? ORDER BY date')
      .all(salarie.id),
    primes: db
      .prepare('SELECT annee, mois, libelle, montant, montant_scelle FROM primes_non_productifs WHERE salarie_id = ? ORDER BY annee, mois')
      .all(salarie.id)
      .map(({ montant, montant_scelle, ...reste }) => ({
        ...reste,
        montant: COFFRE.montantDe(cleCoffre, { montant, montant_scelle }, 'montant', 'montant_scelle'),
      })),
  };
}

module.exports = { DUREE_CONSERVATION_MOIS, candidats, anonymiser, dossierSalarie, etiquette };
