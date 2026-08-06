'use strict';

/*
 * La sonde qui repond a « la porte est-elle ouverte ? » avant de tenter un
 * envoi. Elle a ete ecrite apres un essai qui a coute vingt secondes pour
 * conclure « le serveur n'a pas repondu » : la meme reponse s'obtient en trois,
 * et surtout elle distingue le pare-feu qui ne repond pas du port ou personne
 * n'ecoute — deux pannes, deux corrections differentes.
 */

const net = require('node:net');
const test = require('node:test');
const assert = require('node:assert/strict');

const { joignable, sonderPorts } = require('../server/sonde-port');

test('un port qui ecoute est declare ouvert', async () => {
  const serveur = net.createServer(() => {});
  await new Promise((resoudre) => serveur.listen(0, '127.0.0.1', resoudre));
  const port = serveur.address().port;

  const resultat = await joignable('127.0.0.1', port);
  assert.equal(resultat.ouvert, true);
  assert.equal(resultat.port, port);
  assert.ok(resultat.duree >= 0);

  serveur.close();
});

test('un port ou personne n ecoute est refuse, et vite', async () => {
  // Un port qu'on vient de liberer : la machine repond, mais ferme la porte.
  const serveur = net.createServer(() => {});
  await new Promise((resoudre) => serveur.listen(0, '127.0.0.1', resoudre));
  const port = serveur.address().port;
  await new Promise((resoudre) => serveur.close(resoudre));

  const resultat = await joignable('127.0.0.1', port, 3000);
  assert.equal(resultat.ouvert, false);
  assert.equal(resultat.raison, 'refuse', 'un refus immediat n est pas un pare-feu');
  assert.ok(resultat.duree < 2000, `un refus doit etre immediat, ici ${resultat.duree} ms`);
});

test('un nom introuvable est signale comme tel, pas comme un port ferme', async () => {
  const resultat = await joignable('serveur-qui-n-existe-vraiment-pas-42.invalid', 587, 4000);
  assert.equal(resultat.ouvert, false);
  assert.match(String(resultat.raison).toLowerCase(), /notfound|again|erreur/);
});

test('plusieurs ports se sondent d affilee, dans l ordre demande', async () => {
  const serveur = net.createServer(() => {});
  await new Promise((resoudre) => serveur.listen(0, '127.0.0.1', resoudre));
  const ouvert = serveur.address().port;

  const resultats = await sonderPorts('127.0.0.1', [ouvert, ouvert + 1], 2000);
  assert.deepEqual(resultats.map((r) => r.port), [ouvert, ouvert + 1]);
  assert.equal(resultats[0].ouvert, true);

  serveur.close();
});
