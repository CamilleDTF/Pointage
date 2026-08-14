'use strict';

/*
 * La question de reprise : comment la direction retrouve son code, seule.
 *
 * Elle se depose depuis deux endroits — l'onglet « Mon compte », et la mise en
 * service qui arme tout d'un coup. La regle est la meme dans les deux cas, et
 * elle tient a un detail qui compte : le code actuel est redemande. Sans lui,
 * une session restee ouverte sur un poste partage suffirait a se substituer la
 * porte de secours du compte, et a revenir quand on veut.
 *
 * D'ou ce module plutot qu'une copie de dix lignes : deux exemplaires de cette
 * regle, c'est un jour ou l'un des deux oubliera de redemander le code.
 */

const { db, journaliser } = require('./db');
const A = require('./auth');

/** Les roles a qui la reprise s'adresse. Voir POURQUOI dans routes/authentification.js. */
const RESERVEE = ['directeur'];

function poser({ question, reponse, actuel }, utilisateur) {
  const intitule = String(question || '').trim();
  if (intitule.length < 8 || intitule.length > 200) {
    return { erreur: 'La question doit comporter 8 a 200 caracteres.', code: 400 };
  }
  if (A.normaliserReponse(reponse).length < 3) {
    return { erreur: 'La reponse doit comporter au moins 3 caracteres.', code: 400 };
  }

  const compte = db.prepare('SELECT pin_hash FROM utilisateurs WHERE id = ?').get(utilisateur.id);
  if (!A.verifierPin(String(actuel || ''), compte.pin_hash)) {
    return { erreur: 'Code actuel incorrect.', code: 401 };
  }

  db.prepare(
    `UPDATE utilisateurs SET question_reprise = ?, reponse_reprise_hash = ?, reprise_le = datetime('now')
      WHERE id = ?`
  ).run(intitule, A.hacherReponse(reponse), utilisateur.id);

  // La question part au journal, jamais la reponse.
  journaliser(null, utilisateur.id, 'reprise_definie', intitule);
  return { ok: true };
}

module.exports = { poser, RESERVEE };
