'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../server/domaine');

test('les heures se saisissent en h/min, en decimal ou avec deux points', () => {
  assert.equal(D.versMinutes('7h30'), 450);
  assert.equal(D.versMinutes('7:30'), 450);
  assert.equal(D.versMinutes('7,5'), 450);
  assert.equal(D.versMinutes('7.5'), 450);
  assert.equal(D.versMinutes('8h'), 480);
  assert.equal(D.versMinutes('8'), 480);
  assert.equal(D.versMinutes(''), 0);
  assert.equal(D.versMinutes(null), 0);
  assert.equal(D.versMinutes('abc'), 0);
  assert.equal(D.versMinutes('-3'), 0);
});

test('les minutes se reaffichent au format de la fiche papier', () => {
  assert.equal(D.versTexte(450), '7h30');
  assert.equal(D.versTexte(480), '8h00');
  assert.equal(D.versTexte(0), '0h00');
  assert.equal(D.versDecimal(450), 7.5);
  assert.equal(D.versDecimal(465), 7.75);
});

test('les dates de la semaine ISO commencent bien un lundi', () => {
  const dates = D.datesDeLaSemaine(2026, 31);
  assert.equal(dates.length, 7);
  assert.equal(dates[0], '2026-07-27');
  assert.equal(dates[6], '2026-08-02');
  assert.equal(new Date(`${dates[0]}T00:00:00Z`).getUTCDay(), 1);
});

test('la semaine 1 respecte la regle du premier jeudi', () => {
  // Le 1er janvier 2026 est un jeudi : il appartient donc a la semaine 1.
  assert.deepEqual(D.semaineISO(new Date(2026, 0, 1)), { annee: 2026, semaine: 1 });
  // Le 1er janvier 2027 est un vendredi : il reste rattache a la semaine 53 de 2026.
  assert.deepEqual(D.semaineISO(new Date(2027, 0, 1)), { annee: 2026, semaine: 53 });
});

function ficheType(modifications = {}) {
  return {
    chantier: 'Lycee Jean Moulin',
    ville: 'Toulouse',
    zone_deplacement: 'AUTRE',
    conducteur_id: 1,
    annee: 2026,
    semaine: 31,
    ...modifications,
  };
}

function ligneType(modifications = {}) {
  return {
    nom_affiche: 'ANDRE Alain',
    minutes_route: 150,
    minutes_trajet: 90,
    jours_zone: 4,
    type_masque: 'VA',
    nb_deplacement: 5,
    signature: 'data:image/png;base64,xxx',
    jours: Array.from({ length: 7 }, (_, j) => ({
      jour: j,
      minutes: j <= 4 ? 450 : 0,
      code_absence: '',
    })),
    ...modifications,
  };
}

test('une fiche complete ne remonte aucune anomalie', () => {
  assert.deepEqual(D.controlerFiche(ficheType(), [ligneType()]), []);
});

test('le chantier et la ville sont obligatoires', () => {
  const anomalies = D.controlerFiche(ficheType({ chantier: '', ville: '  ' }), [ligneType()]);
  const messages = anomalies.map((a) => a.message);
  assert.ok(messages.some((m) => m.includes('chantier')));
  assert.ok(messages.some((m) => m.includes('ville')));
  assert.ok(anomalies.every((a) => a.niveau === 'bloquant'));
});

test('un jour ouvre sans heures ni code absence bloque la transmission', () => {
  const ligne = ligneType();
  ligne.jours[2].minutes = 0;
  const anomalies = D.controlerFiche(ficheType(), [ligne]);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].niveau, 'bloquant');
  assert.match(anomalies[0].message, /Mercredi/);
});

test('un zero explicitement saisi declare un jour non travaille', () => {
  // Le cas signale par le client : un seul operateur, un seul jour travaille.
  // Les autres jours mis a zero par le chef d equipe rendent la fiche complete.
  const ligne = ligneType({
    jours: Array.from({ length: 7 }, (_, j) => ({
      jour: j,
      minutes: j === 0 ? 450 : 0,
      code_absence: '',
      saisi: j <= 4 ? 1 : 0,
    })),
  });
  assert.deepEqual(D.controlerFiche(ficheType(), [ligne]), []);
});

test('un zero non saisi reste un jour oublie', () => {
  const ligne = ligneType();
  ligne.jours[2] = { jour: 2, minutes: 0, code_absence: '', saisi: 0 };
  const anomalies = D.controlerFiche(ficheType(), [ligne]);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].niveau, 'bloquant');
  assert.match(anomalies[0].message, /Mercredi/);
});

test('la case a completer est designee par la cible de l anomalie', () => {
  const ligne = ligneType();
  ligne.jours[3].minutes = 0;
  const anomalies = D.controlerFiche(ficheType({ ville: '' }), [ligneType(), ligne]);

  const ville = anomalies.find((a) => /ville/.test(a.message));
  assert.deepEqual(ville.cible, { entete: 'ville' });

  const jeudi = anomalies.find((a) => /Jeudi/.test(a.message));
  assert.deepEqual(jeudi.cible, { ligne: 1, jour: 3 }); // seconde ligne, jeudi
});

test('la cible pointe la ligne d origine, meme derriere des lignes vides', () => {
  const lignes = [ligneType({ nom_affiche: '' }), ligneType({ nom_affiche: '' }), ligneType({ signature: null })];
  const anomalies = D.controlerFiche(ficheType(), lignes);
  assert.equal(anomalies.length, 1);
  assert.deepEqual(anomalies[0].cible, { ligne: 2, champ: 'signature' });
});

test('les semaines anterieures a la mise en service sortent du perimetre', () => {
  // Le 1er septembre 2026 tombe un mardi : la semaine qui le contient (lundi
  // 31 aout au dimanche 6 septembre) est deja du ressort de l application.
  assert.equal(D.semaineAvantService('2026-08-30', '2026-09-01'), true);
  assert.equal(D.semaineAvantService('2026-09-06', '2026-09-01'), false);
  assert.equal(D.semaineAvantService('2026-09-13', '2026-09-01'), false);
  assert.equal(D.semaineAvantService('2026-08-30', ''), false); // sans date, tout est dans le perimetre
});

test('une journee mise a zero se reaffiche 0h00, une journee vide reste vide', () => {
  assert.equal(D.versSaisieJour({ minutes: 0, saisi: 1 }), '0h00');
  assert.equal(D.versSaisieJour({ minutes: 0, saisi: 0 }), '');
  assert.equal(D.versSaisieJour({ minutes: 450, saisi: 0 }), '7h30');
});

test('un code absence dispense de saisir des heures', () => {
  const ligne = ligneType();
  ligne.jours[2] = { jour: 2, minutes: 0, code_absence: 'AT' };
  assert.deepEqual(D.controlerFiche(ficheType(), [ligne]), []);
});

test('un code absence inconnu est refuse', () => {
  const ligne = ligneType();
  ligne.jours[2] = { jour: 2, minutes: 0, code_absence: 'ZZ' };
  const anomalies = D.controlerFiche(ficheType(), [ligne]);
  assert.equal(anomalies[0].niveau, 'bloquant');
  assert.match(anomalies[0].message, /inconnu/);
});

/*
 * Une demi-journee d'absence s'ecrit : les heures travaillees, plus le motif
 * qui couvre le reste. C'etait signale comme une anomalie, et le motif effacait
 * la duree — un conge paye d'une demi-journee n'avait aucune facon de s'ecrire.
 */
test('heures et code absence le meme jour sont une combinaison legitime', () => {
  const ligne = ligneType();
  ligne.jours[2].code_absence = 'CP';
  const anomalies = D.controlerFiche(ficheType(), [ligne]);
  assert.equal(anomalies.length, 0, `anomalies inattendues : ${anomalies.map((a) => a.message).join(' | ')}`);
});

test('les conges payes et la RTT sont proposables sur une fiche', () => {
  const codes = D.CODES_ABSENCE.map((c) => c.code);
  assert.ok(codes.includes('CP'), 'CP absent');
  assert.ok(codes.includes('RTT'), 'RTT absent');
  // Et ils gardent leurs heures, faute de quoi la demi-journee est perdue.
  assert.ok(D.CODES_AVEC_HEURES.includes('CP'));
  assert.ok(D.CODES_AVEC_HEURES.includes('RTT'));
});

test('les jours en zone imposent un type de masque et ne depassent pas 7', () => {
  const sansMasque = D.controlerFiche(ficheType(), [ligneType({ type_masque: '' })]);
  assert.ok(sansMasque.some((a) => a.niveau === 'bloquant' && /masque/.test(a.message)));

  const tropDeJours = D.controlerFiche(ficheType(), [ligneType({ jours_zone: 9 })]);
  assert.ok(tropDeJours.some((a) => a.niveau === 'bloquant' && /jours en zone/.test(a.message)));
});

test('un depassement du plafond de 48h est signale sans bloquer la paie', () => {
  const ligne = ligneType();
  for (const jour of ligne.jours) jour.minutes = 8 * 60; // 56h sur 7 jours
  const anomalies = D.controlerFiche(ficheType(), [ligne]);
  assert.ok(anomalies.every((a) => a.niveau === 'alerte'));
  assert.ok(anomalies.some((a) => /48h/.test(a.message)));
});

test('une signature manquante alerte le directeur sans bloquer', () => {
  const anomalies = D.controlerFiche(ficheType(), [ligneType({ signature: null })]);
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].niveau, 'alerte');
  assert.match(anomalies[0].message, /signature/);
});

test('une fiche sans aucun salarie ne peut pas etre transmise', () => {
  const anomalies = D.controlerFiche(ficheType(), [ligneType({ nom_affiche: '' })]);
  assert.ok(anomalies.some((a) => a.niveau === 'bloquant' && /Aucun salarie/.test(a.message)));
});

test('semaineISO et datesDeLaSemaine sont reciproques sur toute une annee', () => {
  for (let semaine = 1; semaine <= 52; semaine += 1) {
    for (const iso of D.datesDeLaSemaine(2026, semaine)) {
      const [a, m, j] = iso.split('-').map(Number);
      assert.deepEqual(
        D.semaineISO(new Date(a, m - 1, j)),
        { annee: 2026, semaine },
        `${iso} devrait tomber en semaine ${semaine}`
      );
    }
  }
});

test('la zone cochee decide seule du taux de grand deplacement', () => {
  // Paris et Nice ouvrent le taux 80, quelle que soit la ville saisie.
  assert.equal(D.estGrandDeplacement80('Levallois', 'PARIS'), true);
  assert.equal(D.estGrandDeplacement80('Cagnes', 'NICE'), true);
  // Et « Autre » ferme le 80, meme si le nom de ville contient Paris.
  assert.equal(D.estGrandDeplacement80('Paris-l Hopital', 'AUTRE'), false);
});

test('sans zone, la lecture du nom de ville reste la regle historique', () => {
  // Les fiches saisies avant l introduction de la zone doivent continuer a
  // etre valorisees comme elles l ont toujours ete.
  assert.equal(D.estGrandDeplacement80('Nice', ''), true);
  assert.equal(D.estGrandDeplacement80('PARIS 15e', ''), true);
  assert.equal(D.estGrandDeplacement80('Toulouse', ''), false);
});

test('la zone se deduit d une ancienne fiche pour proposer un choix', () => {
  assert.equal(D.zoneDepuisVille('Nice'), 'NICE');
  assert.equal(D.zoneDepuisVille('Paris 15e'), 'PARIS');
  assert.equal(D.zoneDepuisVille('Toulouse'), 'AUTRE');
  assert.equal(D.zoneDepuisVille(''), '');
});

/*
 * La zone du chantier ne commande plus rien : les jours de grand deplacement
 * sont comptes ligne par ligne par le chef, sous chacun des deux taux. Une
 * fiche sans zone se transmet donc, du moment que la ville est renseignee.
 */
test('la zone du chantier n est plus exigee, la ville si', () => {
  assert.deepEqual(D.controlerFiche(ficheType({ zone_deplacement: '' }), [ligneType()]), []);

  const sansVille = D.controlerFiche(ficheType({ ville: '' }), [ligneType()]);
  assert.equal(sansVille.length, 1);
  assert.equal(sansVille[0].niveau, 'bloquant');
  assert.match(sansVille[0].message, /ville/i);
});

test('un nom complet se separe en nom de famille et prenom', () => {
  assert.deepEqual(D.separerNomPrenom('BENALI Karim'), { nom: 'BENALI', prenom: 'Karim' });
  assert.deepEqual(D.separerNomPrenom('DE LA CROIX Jean-Pierre'), { nom: 'DE LA CROIX', prenom: 'Jean-Pierre' });
  // Tout en capitales : on ne peut plus deviner, le premier mot fait office de nom.
  assert.deepEqual(D.separerNomPrenom('BENALI KARIM'), { nom: 'BENALI', prenom: 'KARIM' });
  assert.deepEqual(D.separerNomPrenom(''), { nom: '', prenom: '' });
});

test('le conducteur de travaux doit etre choisi, mais seulement s il y en a', () => {
  const sansChoix = ficheType({ conducteur_id: null });

  // Aucun conducteur enregistre : l etape n existe pas, rien n est exige.
  assert.deepEqual(D.controlerFiche(sansChoix, [ligneType()], { conducteursDisponibles: 0 }), []);
  assert.deepEqual(D.controlerFiche(sansChoix, [ligneType()]), []);

  // Des qu il y en a, le choix devient obligatoire avant de transmettre.
  const anomalies = D.controlerFiche(sansChoix, [ligneType()], { conducteursDisponibles: 2 });
  assert.equal(anomalies.length, 1);
  assert.equal(anomalies[0].niveau, 'bloquant');
  assert.match(anomalies[0].message, /conducteur de travaux/);
  assert.deepEqual(anomalies[0].cible, { entete: 'conducteur_id' });

  // Et le choix fait leve le blocage.
  assert.deepEqual(D.controlerFiche(ficheType(), [ligneType()], { conducteursDisponibles: 2 }), []);
});
