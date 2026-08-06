'use strict';

/*
 * Le port est-il joignable depuis cette machine ?
 *
 * Une tentative d'envoi qui echoue sur un port bloque coute vingt secondes et ne
 * dit qu'une chose : « le serveur n'a pas repondu ». Elle laisse entiere la seule
 * question qui compte — est-ce le pare-feu, le nom du serveur, ou le compte ?
 *
 * Une simple ouverture de connexion tranche en trois secondes, et se pose sur
 * plusieurs ports d'affilee : savoir que le 25 est ferme et le 587 ouvert, c'est
 * savoir quelle option de configuration retenir, sans rien demander a personne.
 */

const net = require('net');

const DELAI_PAR_DEFAUT = 4000;

/**
 * Ouvre une connexion, puis la referme aussitot. Ne leve jamais : l'echec est
 * une reponse, pas une panne.
 *
 * `raison` vaut 'refuse' quand la machine repond mais ferme la porte — un vrai
 * refus, immediat — et 'silence' quand rien ne revient, la signature d'un
 * pare-feu qui jette les paquets sans le dire.
 */
function joignable(hote, port, delai = DELAI_PAR_DEFAUT) {
  return new Promise((resoudre) => {
    const debut = Date.now();
    const prise = new net.Socket();
    let tranche = false;

    const finir = (resultat) => {
      if (tranche) return;
      tranche = true;
      prise.destroy();
      resoudre({ hote, port, duree: Date.now() - debut, ...resultat });
    };

    prise.setTimeout(delai);
    prise.once('connect', () => finir({ ouvert: true }));
    prise.once('timeout', () => finir({ ouvert: false, raison: 'silence' }));
    prise.once('error', (erreur) =>
      finir({ ouvert: false, raison: erreur.code === 'ECONNREFUSED' ? 'refuse' : erreur.code || 'erreur' })
    );

    prise.connect(port, hote);
  });
}

/** Sonde plusieurs ports du meme serveur, l'un apres l'autre. */
async function sonderPorts(hote, ports, delai = DELAI_PAR_DEFAUT) {
  const resultats = [];
  for (const port of ports) resultats.push(await joignable(hote, port, delai));
  return resultats;
}

module.exports = { joignable, sonderPorts, DELAI_PAR_DEFAUT };
