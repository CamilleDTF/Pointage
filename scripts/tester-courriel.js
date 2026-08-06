'use strict';

require('../server/configuration'); // reglages de configuration.txt

/*
 * Verifie que l'application sait envoyer un courriel, et le dit en francais.
 *
 *   node scripts/tester-courriel.js mon.adresse@exemple.fr
 *
 * Sans ce script, la seule facon de tester l'envoi etait de faire transmettre
 * une vraie fiche par un chef d'equipe : long, et on n'apprenait qu'une chose,
 * « le courriel n'est pas parti », sans savoir lequel des cinq reglages etait en
 * cause. Ici, chaque manque est nomme, et le refus du serveur d'envoi est
 * recopie tel quel — c'est lui qui explique le probleme.
 */

const C = require('../server/courriel');
const Fournisseurs = require('../server/fournisseurs-courriel');

const REGLAGES = [
  ['SMTP_HOTE', "l'adresse du serveur d'envoi, par exemple smtp.office365.com"],
  ['SMTP_UTILISATEUR', "le compte de messagerie utilise pour envoyer"],
  ['SMTP_MOT_DE_PASSE', "son mot de passe, ou son mot de passe d'application"],
  ['COURRIEL_EXPEDITEUR', "l'adresse qui apparaitra comme expediteur"],
];

/** Traduit les refus les plus courants des serveurs d'envoi. */
function expliquer(raison) {
  const texte = String(raison || '').toLowerCase();
  if (texte.includes('invalid login') || texte.includes('authentication') || texte.includes('535')) {
    return "Le serveur a refuse le compte ou le mot de passe. Sur une messagerie professionnelle, " +
      "c'est presque toujours l'une de ces trois causes : Microsoft 365 et Google Workspace " +
      "n'acceptent pas le mot de passe habituel et reclament un « mot de passe d'application » ; " +
      "l'organisation doit parfois autoriser l'authentification SMTP sur la boite utilisee ; " +
      'ou le compte n a pas le droit d envoyer depuis cette adresse.';
  }
  if (texte.includes('5.7.') || texte.includes('not allowed') || texte.includes('sender')) {
    return "Le serveur a accepte le compte mais refuse l'adresse d'expedition. Mettez la meme " +
      'adresse dans SMTP_UTILISATEUR et COURRIEL_EXPEDITEUR : beaucoup de messageries ' +
      "d'entreprise n'autorisent a envoyer que depuis l'adresse du compte connecte.";
  }
  if (texte.includes('enotfound') || texte.includes('eai_again')) {
    return "Le nom du serveur d'envoi est introuvable : verifiez SMTP_HOTE, une faute de frappe suffit.";
  }
  if (texte.includes('etimedout') || texte.includes('econnrefused')) {
    return 'Le serveur ne repond pas sur ce port. Essayez SMTP_PORT=465, et verifiez que le ' +
      "pare-feu de la machine laisse sortir les connexions vers ce port.";
  }
  if (texte.includes('self signed') || texte.includes('certificate')) {
    return "Le certificat du serveur d'envoi n'a pas ete reconnu. C'est le cas des serveurs internes " +
      "d'entreprise : demandez au service informatique le nom exact a mettre dans SMTP_HOTE.";
  }
  return null;
}

/**
 * Propose les reglages du domaine, lus dans ses enregistrements MX.
 *
 * « Que mettre dans SMTP_HOTE ? » n'a rien d'evident quand on ne l'a jamais
 * demande, et attendre le service informatique coute des jours pour un
 * renseignement de trente secondes. Le domaine de l'adresse le dit deja.
 */
async function proposerReglages(adresse) {
  const resultat = await Fournisseurs.detecter(adresse);
  if (!resultat.domaine) return;

  console.log(`\n--- Reglages probables pour le domaine ${resultat.domaine} ---\n`);

  if (resultat.trouve) {
    const f = resultat.fournisseur;
    console.log(`  Votre messagerie est hebergee chez ${f.nom}.`);
    console.log('  A recopier dans configuration.txt :\n');
    console.log(`    SMTP_HOTE=${f.hote}`);
    console.log(`    SMTP_PORT=${f.port}`);
    console.log(`    SMTP_UTILISATEUR=${adresse}`);
    console.log('    SMTP_MOT_DE_PASSE=');
    console.log(`    COURRIEL_EXPEDITEUR=${adresse}\n`);
    console.log(`  ${f.note}`);
    return;
  }

  if (resultat.suggestion) {
    console.log(`  Hebergeur non reconnu. Le courrier de ce domaine arrive sur :`);
    for (const nom of resultat.mx.slice(0, 3)) console.log(`    ${nom}`);
    console.log(
      `\n  C'est probablement un serveur interne a l'entreprise. Essayez d'abord\n` +
        `    SMTP_HOTE=${resultat.suggestion}\n` +
        '  et si le serveur refuse, demandez au service informatique le serveur\n' +
        "  d'envoi (SMTP) et un compte autorise a envoyer depuis cette adresse."
    );
    return;
  }

  console.log(
    `  Impossible de lire les enregistrements du domaine (${resultat.raison}).\n` +
      "  Demandez au service informatique le serveur d'envoi (SMTP), son port,\n" +
      '  et un compte autorise a envoyer depuis cette adresse.'
  );
}

async function principal() {
  const destinataire = process.argv[2];

  if (!destinataire || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destinataire)) {
    console.error('Indiquez l adresse a laquelle envoyer l essai :');
    console.error('  node scripts/tester-courriel.js mon.adresse@exemple.fr');
    process.exitCode = 2;
    return;
  }

  const manquants = REGLAGES.filter(([cle]) => !process.env[cle]);
  if (manquants.length) {
    console.log("L'envoi de courriels n'est pas configure. Il manque :\n");
    for (const [cle, role] of manquants) console.log(`  ${cle.padEnd(20)} ${role}`);
    console.log(
      '\nCes lignes se remplissent dans le fichier "configuration.txt", a cote de DEMARRER.bat.' +
        '\nSi ce fichier n existe pas encore, copiez "configuration-exemple.txt" sous ce nom.'
    );
    await proposerReglages(destinataire);
    process.exitCode = 1;
    return;
  }

  console.log(`Envoi d un message d essai a ${destinataire}`);
  console.log(`  serveur     ${process.env.SMTP_HOTE}:${process.env.SMTP_PORT || 587}`);
  console.log(`  compte      ${process.env.SMTP_UTILISATEUR}`);
  console.log(`  expediteur  ${process.env.COURRIEL_EXPEDITEUR}\n`);

  const resultat = await C.envoyer({
    destinataire,
    sujet: 'Pointage — essai d envoi',
    html:
      '<div style="font-family:Arial,sans-serif;font-size:15px">' +
      '<p>Ce message confirme que l application de pointage sait envoyer des courriels.</p>' +
      '<p>Les demandes de visa adressees aux conducteurs de travaux partiront de la meme facon.</p>' +
      '</div>',
    texte: "Ce message confirme que l application de pointage sait envoyer des courriels.",
  });

  if (resultat.envoye) {
    console.log('Message parti. Regardez la boite de reception, et le dossier des indesirables :');
    console.log("une premiere adresse d'expedition y atterrit souvent.");
    return;
  }

  console.log(`Le message n est pas parti. Refus du serveur : ${resultat.raison}\n`);
  const explication = expliquer(resultat.raison);
  if (explication) console.log(`${explication}\n`);
  if (resultat.fichier) console.log(`Le message a ete conserve ici : ${resultat.fichier}`);
  process.exitCode = 1;
}

principal().catch((erreur) => {
  console.error(`Essai interrompu : ${erreur.message}`);
  process.exitCode = 1;
});
