'use strict';

/*
 * Un operateur sur deux chantiers dans la meme semaine.
 *
 * Les controles raisonnaient fiche par fiche. C'etait exact tant qu'un chef
 * n'avait qu'une fiche par semaine ; ca ne l'est plus des qu'il en tient deux.
 * Une semaine coupee en deux passe deux fois sous chaque plafond, et les primes
 * comptees en jours — grands deplacements, jours en zone — s'additionnent d'une
 * fiche a l'autre sans que rien ne le dise.
 *
 * Le plus sournois est le panier repas : il vaut « jours travailles moins jours
 * de GD », plancher a zero. Des GD comptes deux fois ne produisent donc pas un
 * montant absurde qu'on remarquerait — ils font disparaitre les paniers en
 * silence, et on ne s'en apercoit qu'en relisant une paie.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../server/domaine');

const ficheType = () => ({
  annee: 2026,
  semaine: 32,
  chantier: 'Lycee Jean Moulin',
  ville: 'Toulouse',
  conducteur_id: 1,
});

/** Une ligne pointee sur les jours demandes, le reste explicitement a zero. */
function ligne(nom, joursTravailles, extra = {}) {
  return {
    salarie_id: 12,
    nom_affiche: nom,
    jours_zone: 0,
    type_masque: '',
    nb_gd72: 0,
    nb_gd80: 0,
    signature: 'data:image/png;base64,xxx',
    ...extra,
    jours: Array.from({ length: 7 }, (_, j) => ({
      jour: j,
      minutes: joursTravailles.includes(j) ? 450 : 0,
      code_absence: '',
      saisi: j <= 4 ? 1 : 0,
    })),
  };
}

const messages = (anomalies) => anomalies.map((a) => a.message).join(' | ');
const bloquantes = (anomalies) => anomalies.filter((a) => a.niveau === 'bloquant');

test('une personne se reconnait d une fiche a l autre, par son numero ou son nom', () => {
  assert.equal(D.clePointage({ salarie_id: 12, nom_affiche: 'ANDRE Alain' }), 'id:12');
  // Un renfort saisi a la main n'a pas de numero : le nom fait foi, accents et
  // casse mis de cote.
  assert.equal(D.clePointage({ nom_affiche: 'ANDRÉ Alain' }), 'nom:andre alain');
  assert.equal(D.clePointage({ nom_affiche: 'andre alain' }), D.clePointage({ nom_affiche: 'ANDRÉ ALAIN' }));
});

/*
 * Le cas qui passait a travers : 30 h ici, 25 h la-bas. Chaque fiche est en
 * dessous de 48 h, la semaine est a 55 h.
 */
test('le plafond de 48h se compte sur la semaine, pas sur la fiche', () => {
  const lignes = [ligne('ANDRE Alain', [0, 1, 2, 3], { })];
  lignes[0].jours.forEach((j) => { if (j.jour <= 3) j.minutes = 450; }); // 30 h

  const seul = D.controlerFiche(ficheType(), lignes, { conducteursDisponibles: 1 });
  assert.equal(seul.filter((a) => /plafond/.test(a.message)).length, 0, '30 h seules ne depassent rien');

  const avecAilleurs = D.controlerFiche(ficheType(), lignes, {
    conducteursDisponibles: 1,
    ailleurs: {
      'id:12': {
        minutes: [0, 0, 0, 0, 1500, 0, 0],
        minutesTotal: 1500, // 25 h
        joursTravailles: 1,
        joursGD: 0,
        joursZone: 0,
        chantiers: ['Gymnase Sud'],
      },
    },
  });
  const plafond = avecAilleurs.find((a) => /plafond/.test(a.message));
  assert.ok(plafond, 'la semaine entiere depasse : il faut le dire');
  assert.match(plafond.message, /55h00/);
  assert.match(plafond.message, /« Gymnase Sud »/);
});

/*
 * Le coeur du sujet. Cinq jours de GD declares de chaque cote font dix jours de
 * grand deplacement dans une semaine qui n'en compte que cinq — et zero panier.
 */
test('les jours de grand deplacement ne peuvent pas depasser les jours travailles', () => {
  const lignes = [ligne('ANDRE Alain', [0, 1, 2, 3, 4], { nb_gd72: 5 })];

  const seul = D.controlerFiche(ficheType(), lignes, { conducteursDisponibles: 1 });
  assert.deepEqual(bloquantes(seul), [], '5 jours de GD sur 5 jours travailles : rien a dire');

  const double = D.controlerFiche(ficheType(), lignes, {
    conducteursDisponibles: 1,
    ailleurs: {
      'id:12': {
        minutes: [0, 0, 0, 0, 0, 0, 0],
        minutesTotal: 0,
        joursTravailles: 0,
        joursGD: 5,
        joursZone: 0,
        chantiers: ['Gymnase Sud'],
      },
    },
  });
  const gd = bloquantes(double).find((a) => /grand deplacement/.test(a.message));
  assert.ok(gd, 'dix jours de GD pour cinq jours travailles doit bloquer');
  assert.match(gd.message, /10 jours de grand deplacement/);
  assert.match(gd.message, /dont 5 sur « Gymnase Sud »/);
  assert.match(gd.message, /pour 5 jours travailles/);
  assert.equal(gd.cible.champ, 'gd');

  // Et la verification qui donne son sens au blocage : sans lui, la paie ne
  // versait aucun panier de la semaine, sans le signaler nulle part.
  assert.equal(D.joursPanierRepas(5, 10), 0);
  assert.equal(D.joursPanierRepas(5, 5), 0);
});

test('les jours travailles se comptent sur les deux chantiers', () => {
  // Trois jours ici, deux la-bas : cinq jours de GD sont donc justifies.
  const lignes = [ligne('ANDRE Alain', [0, 1, 2], { nb_gd72: 3, nb_gd80: 2 })];
  const anomalies = D.controlerFiche(ficheType(), lignes, {
    conducteursDisponibles: 1,
    ailleurs: {
      'id:12': {
        minutes: [0, 0, 0, 450, 450, 0, 0],
        minutesTotal: 900,
        joursTravailles: 2,
        joursGD: 0,
        joursZone: 0,
        chantiers: ['Gymnase Sud'],
      },
    },
  });
  assert.deepEqual(bloquantes(anomalies), [], `rien ne doit bloquer : ${messages(anomalies)}`);
});

/*
 * Exiger un zero sur les jours passes sur l'autre chantier obligerait le chef a
 * declarer absent quelqu'un qui travaillait.
 */
test('une journee pointee sur l autre chantier n est pas une journee oubliee', () => {
  const lignes = [ligne('ANDRE Alain', [0, 1, 2])];
  // Jeudi et vendredi ne sont pas renseignes ici.
  lignes[0].jours.forEach((j) => { if (j.jour === 3 || j.jour === 4) j.saisi = 0; });

  const seul = D.controlerFiche(ficheType(), lignes, { conducteursDisponibles: 1 });
  assert.equal(bloquantes(seul).length, 2, 'sans autre chantier, ce sont bien deux oublis');

  const avecAilleurs = D.controlerFiche(ficheType(), lignes, {
    conducteursDisponibles: 1,
    ailleurs: {
      'id:12': {
        minutes: [0, 0, 0, 450, 450, 0, 0],
        minutesTotal: 900,
        joursTravailles: 2,
        joursGD: 0,
        joursZone: 0,
        chantiers: ['Gymnase Sud'],
      },
    },
  });
  assert.deepEqual(bloquantes(avecAilleurs), [], `les deux jours sont pointes ailleurs : ${messages(avecAilleurs)}`);

  // Mais un jour oublie des DEUX cotes reste un oubli.
  const trou = D.controlerFiche(ficheType(), lignes, {
    conducteursDisponibles: 1,
    ailleurs: {
      'id:12': {
        minutes: [0, 0, 0, 450, 0, 0, 0],
        minutesTotal: 450,
        joursTravailles: 1,
        joursGD: 0,
        joursZone: 0,
        chantiers: ['Gymnase Sud'],
      },
    },
  });
  assert.equal(bloquantes(trou).length, 1, 'vendredi n est pointe nulle part');
  assert.match(trou[0].message, /Vendredi/);
});

test('un chantier d un autre chef ne se nomme pas', () => {
  const lignes = [ligne('ANDRE Alain', [0, 1, 2, 3, 4], { nb_gd72: 5 })];
  const anomalies = D.controlerFiche(ficheType(), lignes, {
    conducteursDisponibles: 1,
    ailleurs: {
      'id:12': {
        minutes: [0, 0, 0, 0, 0, 0, 0],
        minutesTotal: 0,
        joursTravailles: 0,
        joursGD: 5,
        joursZone: 0,
        // C'est ce que le serveur transmet quand la fiche appartient a un autre
        // chef : l'information sert, le nom du chantier ne le regarde pas.
        chantiers: [],
        autresEquipes: true,
      },
    },
  });
  const gd = bloquantes(anomalies).find((a) => /grand deplacement/.test(a.message));
  assert.match(gd.message, /dont 5 sur un autre chantier/);
  assert.ok(!/Gymnase|Lycee/.test(gd.message));
});

test('sans contexte de semaine, les controles se comportent comme avant', () => {
  const lignes = [ligne('ANDRE Alain', [0, 1, 2, 3, 4], { nb_gd72: 2 })];
  const sansOptions = D.controlerFiche(ficheType(), lignes, { conducteursDisponibles: 1 });
  const avecVide = D.controlerFiche(ficheType(), lignes, { conducteursDisponibles: 1, ailleurs: {} });
  assert.deepEqual(sansOptions, avecVide);
  assert.deepEqual(bloquantes(sansOptions), []);
});
