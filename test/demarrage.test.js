'use strict';

/*
 * Ce qui empeche de demarrer doit se lire sans traduire.
 *
 * Le cas est arrive en vrai : un double-clic de trop sur DEMARRER.bat, et
 * l'application repondait par quinze lignes de trace Node commencant par
 * « EADDRINUSE » et citant express/lib/application.js. Rien n'etait casse — le
 * pointage tournait deja — mais rien ne le disait dans une langue qu'on lit.
 *
 * Ces tests lancent deux serveurs sur le meme port et relisent ce que le
 * second a ecrit. Ils protegent le message lui-meme, pas sa mise en forme :
 * ce qui compte est qu'on y trouve la cause, et le geste a faire.
 */

const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');

const RACINE = path.join(__dirname, '..');

/** Un port libre, pris puis relache : personne d'autre ne l'occupe entre-temps. */
function portLibre() {
  return new Promise((resoudre, rejeter) => {
    const prise = net.createServer();
    prise.once('error', rejeter);
    prise.listen(0, '127.0.0.1', () => {
      const { port } = prise.address();
      prise.close(() => resoudre(port));
    });
  });
}

/** Lance le serveur et rend ce qu'il a ecrit, une fois qu'il a rendu la main. */
function lancer(port, dossier) {
  return new Promise((resoudre) => {
    const fils = spawn(process.execPath, [path.join(RACINE, 'server', 'index.js')], {
      env: { ...process.env, PORT: String(port), DATA_DIR: dossier, NODE_ENV: 'test' },
      cwd: RACINE,
    });
    let sortie = '';
    fils.stdout.on('data', (d) => { sortie += d; });
    fils.stderr.on('data', (d) => { sortie += d; });
    fils.on('exit', (code) => resoudre({ code, sortie, fils }));
    // Un serveur qui demarre bien ne rend jamais la main : on le rend nous-memes.
    setTimeout(() => {
      if (fils.exitCode === null) {
        fils.kill();
        resoudre({ code: null, sortie, fils });
      }
    }, 6000);
  });
}

test('un port deja pris est explique en francais, pas en trace Node', async () => {
  const port = await portLibre();
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-port-'));

  // Un occupant, qui tient le port pendant toute la duree du test.
  const occupant = net.createServer();
  await new Promise((r) => occupant.listen(port, r));

  try {
    const { code, sortie } = await lancer(port, dossier);

    assert.equal(code, 1, 'le serveur doit s arreter net, sans laisser croire qu il tourne');
    assert.ok(!/EADDRINUSE/.test(sortie), `la trace brute ne doit pas remonter :\n${sortie}`);
    assert.ok(!/express|node:net|at Server/.test(sortie), `aucun chemin de module :\n${sortie}`);

    // La cause, dite simplement.
    assert.match(sortie, /pas pu demarrer/i);
    assert.match(sortie, new RegExp(`port ${port} est deja pris`, 'i'));
    // Et le geste a faire, qui n'est pas « relancer ».
    assert.match(sortie, /Ouvrez simplement http:\/\/localhost/i);
    assert.match(sortie, /net stop Pointage/);
    assert.match(sortie, /configuration\.txt/);
  } finally {
    occupant.close();
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test('un port libre demarre sans se plaindre', async () => {
  const port = await portLibre();
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-port-'));

  try {
    const { code, sortie } = await lancer(port, dossier);
    assert.equal(code, null, 'il doit rester en route');
    assert.match(sortie, new RegExp(`http://localhost:${port}`));
    assert.ok(!/pas pu demarrer/i.test(sortie), `demarrage sain, aucun reproche :\n${sortie}`);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

/*
 * Le lanceur Windows fait mieux que d'expliquer : il regarde d'abord si le
 * port repond, et se contente d'ouvrir le navigateur. C'est la reponse juste
 * a un double-clic — il n'y a rien a relancer.
 */
test('DEMARRER.bat ouvre le navigateur au lieu de relancer', () => {
  const bat = fs.readFileSync(path.join(RACINE, 'DEMARRER.bat'), 'latin1');
  assert.match(bat, /netstat/, 'il doit regarder si le port repond');
  assert.match(bat, /tourne deja/i, 'et le dire');
  assert.match(bat, /start "" "http:\/\/localhost:3000"/, 'puis ouvrir le navigateur');
});
