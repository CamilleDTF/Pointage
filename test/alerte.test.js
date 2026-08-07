'use strict';

/*
 * Prevenir un conducteur de travaux sans courriel.
 *
 * Le point qui fait tenir tout l'edifice : ce message **ne contient aucun
 * lien**. C'est ce qui permet au chef d'equipe de l'envoyer lui-meme, de son
 * telephone, sans jamais detenir de quoi viser — il pourrait sinon viser ses
 * propres fiches, et le controle ne serait plus qu'une formalite.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-alerte-'));

const AL = require('../server/alerte');

test.after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

const ficheType = {
  annee: 2026,
  semaine: 37,
  chantier: 'Lycée Jean Moulin',
  ville: 'Toulouse',
};
const conducteur = { nom: 'MOREAU Paul', telephone: '06 12 34 56 78', courriel: 'paul@exemple.fr' };

test('un numero se met au format international quelle que soit sa saisie', () => {
  assert.equal(AL.numeroInternational('06 12 34 56 78'), '+33612345678');
  assert.equal(AL.numeroInternational('06.12.34.56.78'), '+33612345678');
  assert.equal(AL.numeroInternational('0612345678'), '+33612345678');
  assert.equal(AL.numeroInternational('+33 6 12 34 56 78'), '+33612345678');
  assert.equal(AL.numeroInternational('0033612345678'), '+33612345678');
  assert.equal(AL.numeroInternational(''), '');
  assert.equal(AL.numeroInternational(null), '');
});

test('le message dit de quelle fiche il s agit', () => {
  const texte = AL.texteAlerte({
    fiche: ficheType,
    conducteur,
    chefNom: 'BENALI Karim',
    nbSalaries: 4,
    totalMinutes: 7005,
  });

  assert.match(texte, /Bonjour Paul/);
  assert.match(texte, /BENALI Karim/);
  assert.match(texte, /Semaine 37/);
  assert.match(texte, /Lycée Jean Moulin/);
  assert.match(texte, /Toulouse/);
  assert.match(texte, /4 salarié/);
  assert.match(texte, /116h45/);
  assert.match(texte, /Fiches à viser/);
});

/*
 * Le test qui compte : ce message part par le telephone d'un chef d'equipe. S'il
 * portait un jeton, une adresse de visa ou meme l'adresse de l'application, le
 * chef pourrait viser sa propre fiche.
 */
test('le message ne contient jamais de lien ni de secret', () => {
  const alerte = AL.alerteVisa({
    fiche: ficheType,
    conducteur,
    chefNom: 'BENALI Karim',
    nbSalaries: 4,
    totalMinutes: 7005,
  });

  assert.ok(!/https?:\/\//.test(alerte.texte), 'aucune adresse web dans le message');
  assert.ok(!/jeton|cle=|visa\.html|conducteur\.html/i.test(alerte.texte), 'aucun secret dans le message');

  // Les liens sms: et wa.me ne portent que ce meme texte.
  const contenuSms = decodeURIComponent(alerte.sms.split('body=')[1]);
  assert.equal(contenuSms, alerte.texte);
  const contenuWhatsapp = decodeURIComponent(alerte.whatsapp.split('text=')[1]);
  assert.equal(contenuWhatsapp, alerte.texte);
});

test('les liens sms et WhatsApp visent le bon numero', () => {
  const alerte = AL.alerteVisa({ fiche: ficheType, conducteur, chefNom: 'BENALI Karim' });
  assert.ok(alerte.sms.startsWith('sms:+33612345678?&body='));
  assert.ok(alerte.whatsapp.startsWith('https://wa.me/33612345678?text='));
});

test('sans numero, le message reste copiable mais aucun lien n est propose', () => {
  const alerte = AL.alerteVisa({
    fiche: ficheType,
    conducteur: { ...conducteur, telephone: '' },
    chefNom: 'BENALI Karim',
  });
  assert.equal(alerte.sms, '', 'un lien sms vide ouvrirait un message sans destinataire');
  assert.equal(alerte.whatsapp, '');
  assert.ok(alerte.texte.length > 50, 'le texte reste disponible a la copie');
});
