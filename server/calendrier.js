'use strict';

/*
 * Vue calendaire d'un mois, pour la direction.
 *
 * Une ligne par personne — operateurs et chefs d'equipe confondus, puisqu'un
 * chef travaille lui aussi sur le chantier — et une colonne par jour.
 *
 * Le tableau de bord repond a « qui doit rendre sa fiche cette semaine ». Il ne
 * repond pas a « pourquoi Untel n'apparait nulle part depuis quinze jours ».
 * C'est a cette seconde question que sert cette page : chaque case dit ce qui
 * s'est passe ce jour-la, ou pourquoi il ne s'est rien passe. Un jour sans
 * pointage n'est un oubli que si rien ne le justifie — d'ou les conges, sans
 * lesquels une semaine de vacances ressemble a une semaine perdue.
 */

const { db } = require('./db');
const D = require('./domaine');

/*
 * Ce qu'une case peut valoir, du plus factuel au plus suppose. L'ordre compte :
 * des heures pointees l'emportent sur un conge enregistre, parce qu'elles
 * decrivent ce qui a eu lieu et non ce qui etait prevu.
 */
const ETATS = ['travaille', 'absence', 'conge', 'nonPointe', 'weekend', 'horsService'];

/** Les jours du mois, avec leur numero de semaine ISO et le repere du week-end. */
function joursDuMois(annee, mois) {
  const dernier = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  const jours = [];
  for (let numero = 1; numero <= dernier; numero += 1) {
    const date = new Date(Date.UTC(annee, mois - 1, numero));
    const jourSemaine = date.getUTCDay();
    jours.push({
      date: date.toISOString().slice(0, 10),
      numero,
      jourSemaine,
      weekend: jourSemaine === 0 || jourSemaine === 6,
      semaine: D.semaineISO(new Date(annee, mois - 1, numero)).semaine,
    });
  }
  return jours;
}

/**
 * Le mois complet : personnes, jours, et l'etat de chaque croisement.
 *
 * `debutService` grise ce qui precede la mise en service : ces semaines-la ont
 * ete pointees sur papier, et les afficher comme des trous serait mensonger.
 */
function moisComplet(annee, mois, { debutService = null } = {}) {
  const jours = joursDuMois(annee, mois);
  const premier = jours[0].date;
  const dernier = jours[jours.length - 1].date;

  const personnes = db
    .prepare(
      `SELECT s.id, s.matricule, s.nom, s.prenom, s.chef_id, u.nom AS chef_nom,
              CASE WHEN EXISTS (SELECT 1 FROM utilisateurs c
                                 WHERE c.role = 'chef' AND c.actif = 1
                                   AND upper(c.nom) = upper(s.nom || ' ' || s.prenom))
                   THEN 1 ELSE 0 END AS est_chef
         FROM salaries s
         LEFT JOIN utilisateurs u ON u.id = s.chef_id
        WHERE s.actif = 1
        ORDER BY COALESCE(u.nom, 'zzz'), s.nom, s.prenom`
    )
    .all();

  /*
   * Les journees pointees du mois, en une seule lecture. Un salarie peut
   * apparaitre deux fois le meme jour — deux chantiers dans la semaine : on
   * additionne les minutes et on garde le premier code d'absence rencontre.
   */
  const pointages = db
    .prepare(
      `SELECT l.salarie_id, l.nom_affiche, j.jour, j.minutes, j.code_absence, j.saisi,
              f.annee, f.semaine, f.chantier, f.statut
         FROM fiche_jours j
         JOIN fiche_lignes l ON l.id = j.ligne_id
         JOIN fiches f ON f.id = l.fiche_id
        WHERE TRIM(l.nom_affiche) <> ''`
    )
    .all();

  const parPersonneEtJour = new Map();
  for (const p of pointages) {
    const dates = D.datesDeLaSemaine(p.annee, p.semaine);
    const date = dates[p.jour];
    if (!date || date < premier || date > dernier) continue;

    // Le rattachement se fait par identifiant quand il existe, par nom sinon :
    // une ligne saisie a la main pour un renfort n'a pas de salarie_id.
    const cle = `${p.salarie_id || `nom:${D.sansAccents(p.nom_affiche)}`}|${date}`;
    const existant = parPersonneEtJour.get(cle);
    if (existant) {
      existant.minutes += p.minutes;
      existant.code = existant.code || p.code_absence;
      if (p.chantier && !existant.chantiers.includes(p.chantier)) existant.chantiers.push(p.chantier);
    } else {
      parPersonneEtJour.set(cle, {
        minutes: p.minutes,
        code: p.code_absence,
        saisi: p.saisi,
        statut: p.statut,
        chantiers: p.chantier ? [p.chantier] : [],
      });
    }
  }

  // Les conges qui touchent le mois, ramenes a un ensemble de dates par salarie.
  const conges = db
    .prepare('SELECT * FROM conges WHERE fin >= ? AND debut <= ? ORDER BY debut')
    .all(premier, dernier);

  const congeParPersonneEtJour = new Map();
  for (const conge of conges) {
    for (const jour of jours) {
      if (jour.date >= conge.debut && jour.date <= conge.fin) {
        congeParPersonneEtJour.set(`${conge.salarie_id}|${jour.date}`, conge);
      }
    }
  }

  const lignes = personnes.map((personne) => {
    /*
     * L'ordre va du constate au suppose. Des heures pointees un samedi restent
     * des heures pointees, et une journee travaillee avant la mise en service
     * reste travaillee : une convention de calendrier ne doit jamais effacer un
     * fait saisi par un chef d'equipe.
     */
    const cases = jours.map((jour) => {
      const pointage =
        parPersonneEtJour.get(`${personne.id}|${jour.date}`) ||
        parPersonneEtJour.get(`nom:${D.sansAccents(`${personne.nom} ${personne.prenom}`)}|${jour.date}`);

      if (pointage && pointage.minutes > 0) {
        return {
          etat: 'travaille',
          minutes: pointage.minutes,
          chantiers: pointage.chantiers,
          statut: pointage.statut,
        };
      }
      if (pointage && pointage.code) {
        return { etat: 'absence', code: pointage.code, statut: pointage.statut };
      }
      if (jour.weekend) return { etat: 'weekend' };

      const conge = congeParPersonneEtJour.get(`${personne.id}|${jour.date}`);
      if (conge) return { etat: 'conge', code: conge.motif, commentaire: conge.commentaire };

      // Journee explicitement mise a zero par le chef : elle est renseignee, le
      // salarie n'a simplement pas travaille. Ce n'est pas un trou.
      if (pointage && pointage.saisi) return { etat: 'absence', code: '0', statut: pointage.statut };

      // Avant la mise en service, le pointage se faisait sur papier : ces jours
      // n'ont rien a reclamer.
      if (debutService && jour.date < debutService) return { etat: 'horsService' };

      return { etat: 'nonPointe' };
    });

    const compter = (etat) => cases.filter((c) => c.etat === etat).length;
    return {
      salarie_id: personne.id,
      nom: `${personne.nom} ${personne.prenom}`.trim(),
      matricule: personne.matricule || '',
      chef_nom: personne.chef_nom || '',
      estChef: Boolean(personne.est_chef),
      cases,
      totaux: {
        minutes: cases.reduce((t, c) => t + (c.minutes || 0), 0),
        travaille: compter('travaille'),
        absence: compter('absence'),
        conge: compter('conge'),
        nonPointe: compter('nonPointe'),
      },
    };
  });

  return { annee, mois, jours, lignes, debutService };
}

/* ------------------------------- Conges ----------------------------------- */

const MOTIFS_CONGE = [
  { code: 'CP', libelle: 'Congés payés' },
  { code: 'RTT', libelle: 'RTT' },
  { code: 'MAL', libelle: 'Arrêt maladie' },
  { code: 'AT', libelle: 'Accident du travail' },
  { code: 'FOR', libelle: 'Formation' },
  { code: 'SS', libelle: 'Congé sans solde' },
  { code: 'AUT', libelle: 'Autre absence' },
];

function listerConges({ depuis = null } = {}) {
  const condition = depuis ? 'WHERE c.fin >= @depuis' : '';
  return db
    .prepare(
      `SELECT c.*, s.nom, s.prenom, s.matricule
         FROM conges c JOIN salaries s ON s.id = c.salarie_id
         ${condition}
        ORDER BY c.debut DESC, s.nom`
    )
    .all(depuis ? { depuis } : {});
}

const estDateISO = (valeur) => /^\d{4}-\d{2}-\d{2}$/.test(String(valeur || ''));

function enregistrerConge({ salarie_id, debut, fin, motif, commentaire }) {
  const salarie = db.prepare('SELECT id FROM salaries WHERE id = ?').get(Number(salarie_id));
  if (!salarie) return { erreur: 'Salarie inconnu.', code: 400 };
  if (!estDateISO(debut) || !estDateISO(fin)) return { erreur: 'Dates attendues au format AAAA-MM-JJ.', code: 400 };
  if (fin < debut) return { erreur: 'La date de fin precede la date de debut.', code: 400 };

  const code = MOTIFS_CONGE.some((m) => m.code === motif) ? motif : 'CP';
  const r = db
    .prepare('INSERT INTO conges (salarie_id, debut, fin, motif, commentaire) VALUES (?, ?, ?, ?, ?)')
    .run(Number(salarie_id), debut, fin, code, String(commentaire || '').trim().slice(0, 300));
  return { id: r.lastInsertRowid };
}

function supprimerConge(id) {
  const r = db.prepare('DELETE FROM conges WHERE id = ?').run(Number(id));
  if (!r.changes) return { erreur: 'Conge introuvable.', code: 404 };
  return { ok: true };
}

module.exports = { moisComplet, joursDuMois, listerConges, enregistrerConge, supprimerConge, MOTIFS_CONGE, ETATS };
