'use strict';

/*
 * Reconnaissance de l'hebergeur d'une adresse professionnelle a partir de ses
 * enregistrements MX. Le reseau n'est pas sollicite ici : ce qui merite d'etre
 * verrouille, c'est le rapprochement des motifs, pas la resolution DNS.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { domaineDe, FOURNISSEURS } = require('../server/fournisseurs-courriel');

/** Meme rapprochement que dans detecter(), sans passer par le reseau. */
const reconnaitre = (mx) => FOURNISSEURS.find((f) => mx.some((nom) => f.motif.test(nom))) || null;

test('le domaine se lit meme sur une adresse tordue', () => {
  assert.equal(domaineDe('camille@mon-entreprise.fr'), 'mon-entreprise.fr');
  assert.equal(domaineDe('  Camille.M@Mon-Entreprise.FR '), 'mon-entreprise.fr');
  // Une adresse peut contenir une arobase entre guillemets : c'est la derniere
  // qui separe la partie locale du domaine.
  assert.equal(domaineDe('"a@b"@entreprise.fr'), 'entreprise.fr');
  assert.equal(domaineDe('sans-arobase'), '');
  assert.equal(domaineDe(null), '');
});

test('les hebergeurs courants des messageries professionnelles sont reconnus', () => {
  const cas = [
    [['mon-entreprise-fr.mail.protection.outlook.com'], 'smtp.office365.com'],
    [['aspmx.l.google.com', 'alt1.aspmx.l.google.com'], 'smtp.gmail.com'],
    [['mx1.mail.ovh.net', 'mx2.mail.ovh.net'], 'ssl0.ovh.net'],
    [['mx00.ionos.fr'], 'smtp.ionos.fr'],
    [['spool.mail.gandi.net'], 'mail.gandi.net'],
    [['mta-gw.infomaniak.ch'], 'mail.infomaniak.com'],
    [['smtp-in.orange.fr'], 'smtp.orange.fr'],
  ];
  for (const [mx, hote] of cas) {
    const trouve = reconnaitre(mx);
    assert.ok(trouve, `hebergeur non reconnu pour ${mx[0]}`);
    assert.equal(trouve.hote, hote);
  }
});

test('un serveur interne d entreprise n est pas rattache a un hebergeur au hasard', () => {
  // Le cas le plus frequent chez une PME : sa propre machine. Mieux vaut
  // l'annoncer comme inconnu que proposer un serveur qui refusera le compte.
  assert.equal(reconnaitre(['mail.mon-entreprise.fr']), null);
  assert.equal(reconnaitre(['courrier.interne.local']), null);
});

test('chaque hebergeur annonce un port et une explication utilisables', () => {
  for (const f of FOURNISSEURS) {
    assert.ok(f.nom && f.hote, 'un hebergeur sans nom ni serveur ne sert a rien');
    assert.ok([587, 465].includes(f.port), `port inattendu pour ${f.nom}`);
    assert.ok(f.note.length > 20, `explication trop courte pour ${f.nom}`);
  }
});
