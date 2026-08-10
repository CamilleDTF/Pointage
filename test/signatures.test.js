'use strict';

/*
 * Ce qu'une signature atteste.
 *
 * Une signature d'operateur ne valait que la POSITION de sa ligne : lors d'une
 * reecriture, le serveur la reprenait par rang. Remplacer le nom de la ligne 1
 * suffisait donc a transporter la signature du precedent sur le suivant, et la
 * fiche affirmait alors que quelqu'un avait signe des heures qu'il n'avait
 * jamais vues. C'est ce scenario-la que ce fichier interdit.
 *
 * La regle tient en une phrase : une signature ne vaut que pour la personne qui
 * l'a donnee, et pour le contenu qu'elle avait sous les yeux.
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pointage-sign-'));

const { db } = require('../server/db');
const F = require('../server/fiches');

test.after(() => fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }));

const chef = db
  .prepare("INSERT INTO utilisateurs (nom, identifiant, role, pin_hash) VALUES ('CHEF', 'chef', 'chef', 'x')")
  .run().lastInsertRowid;
const utilisateur = { id: chef, role: 'chef' };

const inserer = db.prepare('INSERT INTO salaries (matricule, nom, prenom, chef_id) VALUES (?, ?, ?, ?)');
const paul = inserer.run('A1', 'MARTIN', 'Paul', chef).lastInsertRowid;
const pierre = inserer.run('A2', 'DURAND', 'Pierre', chef).lastInsertRowid;

const SIGNATURE_PAUL = 'data:image/png;base64,UGF1bA==';
const SIGNATURE_PIERRE = 'data:image/png;base64,UGllcnJl';

/** Une semaine par test : chacun part d'une fiche neuve, sans rien traîner. */
let semaine = 10;
function ficheNeuve() {
  semaine += 1;
  return F.obtenirOuCreerFicheSemaine(chef, 2026, semaine);
}

/** Une ligne de pointage complete, telle que le navigateur l'envoie. */
function ligneDe({ salarieId, nom, minutes = 420, signature, route = 0, zone = 0, masque = '' }) {
  return {
    salarie_id: salarieId,
    nom_affiche: nom,
    minutes_route: route,
    minutes_trajet: 0,
    jours_zone: zone,
    type_masque: masque,
    nb_gd72: 0,
    nb_gd80: 0,
    observation: '',
    signature,
    jours: [0, 1, 2, 3, 4, 5, 6].map((j) => ({ jour: j, minutes: j <= 4 ? minutes : 0, code_absence: '', saisi: 1 })),
  };
}

const enregistrer = (id, lignes) => F.enregistrerFiche(id, { lignes }, utilisateur).fiche;
const signatureDe = (fiche, index) => fiche.lignes[index].signature;

/* ------------------------------------------------------------------------- */

test('une signature survit a un enregistrement qui ne touche a rien', () => {
  const fiche = ficheNeuve();
  const ligne = ligneDe({ salarieId: paul, nom: 'MARTIN Paul', signature: SIGNATURE_PAUL });

  enregistrer(fiche.id, [ligne]);
  // Le navigateur renvoie ce qu'il a recu : c'est un report, pas une signature neuve.
  const apres = enregistrer(fiche.id, [ligne]);
  assert.equal(signatureDe(apres, 0), SIGNATURE_PAUL, 'rien n a change : la signature reste');
});

/*
 * Le scenario de l'audit, mot pour mot : ligne 1 = Paul, il signe ; la ligne 1
 * devient Pierre. La signature de Paul ne doit pas se retrouver sous le nom de
 * Pierre.
 */
test('remplacer une personne n hérite jamais de la signature de la precedente', () => {
  const fiche = ficheNeuve();
  enregistrer(fiche.id, [ligneDe({ salarieId: paul, nom: 'MARTIN Paul', signature: SIGNATURE_PAUL })]);

  // Le conducteur reecrit la fiche sans renvoyer les signatures (visa.js ne les
  // transmet pas) : c'est exactement la voie par laquelle la signature migrait.
  const apres = enregistrer(fiche.id, [
    ligneDe({ salarieId: pierre, nom: 'DURAND Pierre', minutes: 480, signature: undefined }),
  ]);

  assert.equal(apres.lignes[0].nom_affiche, 'DURAND Pierre');
  assert.equal(signatureDe(apres, 0), null, 'la signature de Paul ne suit pas la ligne');
});

test('modifier les heures signees fait tomber la signature', () => {
  const fiche = ficheNeuve();
  enregistrer(fiche.id, [ligneDe({ salarieId: paul, nom: 'MARTIN Paul', signature: SIGNATURE_PAUL })]);

  const apres = enregistrer(fiche.id, [
    ligneDe({ salarieId: paul, nom: 'MARTIN Paul', minutes: 480, signature: undefined }),
  ]);
  assert.equal(signatureDe(apres, 0), null, 'ce n est plus ce qu il a signe');
});

/*
 * Le cas dangereux : renvoyer l'image d'une signature ne doit pas suffire a la
 * faire passer pour une signature neuve. Sinon n'importe quel client — ou
 * n'importe qui rejouant une requete — blanchirait une modification.
 */
test('renvoyer la meme image ne revalide pas un contenu modifie', () => {
  const fiche = ficheNeuve();
  enregistrer(fiche.id, [ligneDe({ salarieId: paul, nom: 'MARTIN Paul', signature: SIGNATURE_PAUL })]);

  const apres = enregistrer(fiche.id, [
    ligneDe({ salarieId: paul, nom: 'MARTIN Paul', minutes: 600, signature: SIGNATURE_PAUL }),
  ]);
  assert.equal(signatureDe(apres, 0), null, 'la meme image sur un autre contenu ne vaut rien');
});

test('une signature neuve, elle, atteste du contenu du jour', () => {
  const fiche = ficheNeuve();
  enregistrer(fiche.id, [ligneDe({ salarieId: paul, nom: 'MARTIN Paul', signature: SIGNATURE_PAUL })]);

  // Les heures changent ET l'operateur re-signe : la signature vaut.
  const apres = enregistrer(fiche.id, [
    ligneDe({ salarieId: paul, nom: 'MARTIN Paul', minutes: 600, signature: SIGNATURE_PIERRE }),
  ]);
  assert.equal(signatureDe(apres, 0), SIGNATURE_PIERRE);

  // Et elle tient au report suivant, puisque plus rien ne bouge.
  const encore = enregistrer(fiche.id, [
    ligneDe({ salarieId: paul, nom: 'MARTIN Paul', minutes: 600, signature: undefined }),
  ]);
  assert.equal(signatureDe(encore, 0), SIGNATURE_PIERRE);
});

/*
 * Tout ce qui figure sur la ligne est couvert, pas seulement les heures : les
 * jours en zone et le masque decident de la prime d'amiante, la route et le
 * trajet se paient. Les signer puis les changer sans le dire reviendrait au
 * meme probleme, en moins visible.
 */
test('la zone, le masque et la route sont couverts comme les heures', () => {
  for (const changement of [{ zone: 3, masque: 'VA' }, { route: 90 }]) {
    const fiche = ficheNeuve();
    const depart = { salarieId: paul, nom: 'MARTIN Paul', signature: SIGNATURE_PAUL };
    enregistrer(fiche.id, [ligneDe(depart)]);

    const apres = enregistrer(fiche.id, [ligneDe({ ...depart, ...changement, signature: undefined })]);
    assert.equal(signatureDe(apres, 0), null, `couvert : ${JSON.stringify(changement)}`);
  }
});

/*
 * Deplacer une ligne n'est pas la modifier. Sans cela, ajouter quelqu'un en
 * haut de la fiche ferait tomber toutes les signatures d'en dessous — et une
 * regle qui punit une action anodine finit par etre contournee.
 */
test('changer une ligne de place ne fait pas tomber sa signature', () => {
  const fiche = ficheNeuve();
  enregistrer(fiche.id, [ligneDe({ salarieId: paul, nom: 'MARTIN Paul', signature: SIGNATURE_PAUL })]);

  const apres = enregistrer(fiche.id, [
    ligneDe({ salarieId: pierre, nom: 'DURAND Pierre', signature: SIGNATURE_PIERRE }),
    ligneDe({ salarieId: paul, nom: 'MARTIN Paul', signature: undefined }),
  ]);
  assert.equal(apres.lignes[1].nom_affiche, 'MARTIN Paul');
  assert.equal(signatureDe(apres, 1), SIGNATURE_PAUL, 'Paul n a pas bouge, sa signature non plus');
});

test('effacer une signature reste possible, et ne se signale pas comme une perte', () => {
  const fiche = ficheNeuve();
  enregistrer(fiche.id, [ligneDe({ salarieId: paul, nom: 'MARTIN Paul', signature: SIGNATURE_PAUL })]);

  const apres = enregistrer(fiche.id, [ligneDe({ salarieId: paul, nom: 'MARTIN Paul', signature: null })]);
  assert.equal(signatureDe(apres, 0), null);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM journal WHERE fiche_id = ? AND action = 'signature_invalidee'").get(fiche.id).n,
    0,
    'un effacement volontaire n est pas une signature perdue'
  );
});

/*
 * Une signature qui tombe doit se lire quelque part. Le chef le voit a l'ecran ;
 * le journal, lui, garde la trace de qui doit re-signer et pourquoi.
 */
test('une signature invalidee laisse une trace nominative au journal', () => {
  const fiche = ficheNeuve();
  enregistrer(fiche.id, [
    ligneDe({ salarieId: paul, nom: 'MARTIN Paul', signature: SIGNATURE_PAUL }),
    ligneDe({ salarieId: pierre, nom: 'DURAND Pierre', signature: SIGNATURE_PIERRE }),
  ]);

  enregistrer(fiche.id, [
    ligneDe({ salarieId: paul, nom: 'MARTIN Paul', minutes: 480, signature: undefined }),
    ligneDe({ salarieId: pierre, nom: 'DURAND Pierre', signature: undefined }),
  ]);

  const trace = db
    .prepare("SELECT detail FROM journal WHERE fiche_id = ? AND action = 'signature_invalidee'")
    .get(fiche.id);
  assert.ok(trace, 'le journal note la perte');
  assert.match(trace.detail, /MARTIN Paul/);
  assert.ok(!trace.detail.includes('DURAND Pierre'), 'Pierre n a pas bouge : il n est pas concerne');
});

/*
 * Les fiches d'avant la migration n'ont pas d'empreinte : on ne peut pas savoir
 * ce qui a ete signe. On ne fait donc pas semblant — la signature tombe a la
 * premiere reecriture, plutot que d'etre reattachee a un contenu qu'on ne sait
 * pas comparer.
 */
test('une signature d avant la migration ne se laisse pas blanchir', () => {
  const fiche = ficheNeuve();
  enregistrer(fiche.id, [ligneDe({ salarieId: paul, nom: 'MARTIN Paul', signature: SIGNATURE_PAUL })]);

  // On simule l'ancien enregistrement : signature presente, empreinte absente.
  db.prepare(
    "UPDATE fiche_lignes SET signature_cle = '', signature_empreinte = '' WHERE fiche_id = ?"
  ).run(fiche.id);

  const apres = enregistrer(fiche.id, [
    ligneDe({ salarieId: paul, nom: 'MARTIN Paul', signature: SIGNATURE_PAUL }),
  ]);
  assert.equal(signatureDe(apres, 0), null, 'ce qui n est pas verifiable n est pas affirme');
});

/*
 * Une ligne videe ne garde rien. C'est le pendant du garde-fou sur salarie_id :
 * une ligne libre reutilisee ne doit hériter ni de l'identite ni de la
 * signature de celui qui l'occupait.
 */
test('vider une ligne emporte sa signature avec elle', () => {
  const fiche = ficheNeuve();
  enregistrer(fiche.id, [ligneDe({ salarieId: paul, nom: 'MARTIN Paul', signature: SIGNATURE_PAUL })]);

  const apres = enregistrer(fiche.id, [ligneDe({ salarieId: null, nom: '', signature: undefined })]);
  assert.equal(signatureDe(apres, 0), null);
  assert.equal(apres.lignes[0].salarie_id, null);
});
