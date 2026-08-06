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

const fs = require('fs');
const path = require('path');

const C = require('../server/courriel');
const Fournisseurs = require('../server/fournisseurs-courriel');

/*
 * Seuls deux reglages sont indispensables. Le compte et le mot de passe ne le
 * sont pas : un relais interne, ou l'envoi direct de Microsoft vers ses propres
 * boites, se passe d'authentification — et se passer d'un mot de passe pose sur
 * le poste vaut mieux que d'en poser un.
 */
const REGLAGES = [
  ['SMTP_HOTE', "l'adresse du serveur d'envoi, par exemple smtp.office365.com"],
  ['COURRIEL_EXPEDITEUR', "l'adresse qui apparaitra comme expediteur"],
];

/** Traduit les refus les plus courants des serveurs d'envoi. */
function expliquer(raison, { avecCompte = true } = {}) {
  const texte = String(raison || '').toLowerCase();

  // Envoi sans compte : le refus le plus probable n'est pas le mot de passe,
  // c'est le destinataire, ou le port 25 ferme par le pare-feu.
  if (!avecCompte && (texte.includes('550') || texte.includes('relay') || texte.includes('5.7.'))) {
    return "Le serveur a refuse le destinataire. Sans compte, il n'accepte que les adresses " +
      "de son propre domaine : verifiez que l'adresse d'essai en fait partie. Pour ecrire a " +
      "l'exterieur, il faut passer par l'option avec compte et mot de passe.";
  }
  if (!avecCompte && (texte.includes('etimedout') || texte.includes('econnrefused'))) {
    return 'Le port 25 ne sort pas de cette machine : beaucoup de pare-feu et de fournisseurs ' +
      "d'acces le bloquent par defaut. Demandez son ouverture, ou passez a l'option avec " +
      'compte et mot de passe sur le port 587.';
  }

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
  if (texte.includes("n'a pas repondu")) {
    return "Le serveur n'a pas repondu du tout. Le port est probablement bloque : le 25 l'est " +
      "presque partout, le 587 beaucoup plus rarement. Verifiez aussi le nom du serveur, et " +
      "que cette machine a bien acces a internet.";
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
async function proposerReglages(adresse, { preparer = false } = {}) {
  const resultat = await Fournisseurs.detecter(adresse);
  if (!resultat.domaine) return;

  console.log(`\n--- Reglages probables pour le domaine ${resultat.domaine} ---\n`);

  const afficher = (titre, reglages, note) => {
    console.log(`  ${titre}\n`);
    for (const [cle, valeur] of reglages) console.log(`    ${cle}=${valeur}`);
    console.log(`\n  ${note}\n`);
  };

  if (resultat.trouve) {
    const f = resultat.fournisseur;
    console.log(`  Votre messagerie est hebergee chez ${f.nom}.\n`);

    const avecCompte = [
      ['SMTP_HOTE', f.hote],
      ['SMTP_PORT', f.port],
      ['SMTP_UTILISATEUR', adresse],
      ['SMTP_MOT_DE_PASSE', ''],
      ['COURRIEL_EXPEDITEUR', adresse],
    ];

    // L'envoi sans compte, quand l'hebergeur le permet, passe en premier : il
    // ne demande aucun mot de passe, donc aucune autorisation a obtenir.
    const sans = f.sansCompte;
    if (sans && resultat.mx.length) {
      const sansCompte = [
        ['SMTP_HOTE', resultat.mx[0]],
        ['SMTP_PORT', sans.port],
        ['SMTP_UTILISATEUR', ''],
        ['SMTP_MOT_DE_PASSE', ''],
        ['COURRIEL_EXPEDITEUR', adresse],
      ];
      afficher(`OPTION 1 — sans compte ni mot de passe (${sans.condition})`, sansCompte, sans.explication);
      afficher('OPTION 2 — avec le compte de messagerie', avecCompte, f.note);
      if (preparer) ecrireConfiguration(sansCompte, `envoi sans compte via ${f.nom}`);
      return;
    }

    afficher('A recopier dans configuration.txt :', avecCompte, f.note);
    if (preparer) ecrireConfiguration(avecCompte, f.nom);
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
    if (preparer) {
      ecrireConfiguration(
        [
          ['SMTP_HOTE', resultat.suggestion],
          ['SMTP_PORT', 587],
          ['SMTP_UTILISATEUR', adresse],
          ['SMTP_MOT_DE_PASSE', ''],
          ['COURRIEL_EXPEDITEUR', adresse],
        ],
        'serveur interne (a confirmer)'
      );
    }
    return;
  }

  console.log(
    `  Impossible de lire les enregistrements du domaine (${resultat.raison}).\n` +
      "  Demandez au service informatique le serveur d'envoi (SMTP), son port,\n" +
      '  et un compte autorise a envoyer depuis cette adresse.'
  );
}

/**
 * Ecrit configuration.txt avec les reglages trouves, et jamais par-dessus un
 * fichier existant : il peut contenir un mot de passe et des reglages qui ne
 * regardent pas ce script.
 */
function ecrireConfiguration(reglages, origine) {
  const fichier = path.join(__dirname, '..', 'configuration.txt');
  if (fs.existsSync(fichier)) {
    console.log(`  Le fichier ${fichier} existe deja : il n'a pas ete modifie.`);
    console.log('  Recopiez-y les lignes ci-dessus a la main.');
    return;
  }

  const contenu = [
    'rem  Reglages de l application de pointage.',
    `rem  Prepare par TESTER-COURRIEL.bat le ${new Date().toLocaleString('fr-FR')}`,
    `rem  Serveur d envoi deduit du domaine de l adresse : ${origine}.`,
    'rem',
    'rem  Les explications de chaque ligne sont dans configuration-exemple.txt.',
    '',
    ...reglages.map(([cle, valeur]) => `${cle}=${valeur}`),
    '',
    'rem  Adresse a laquelle les conducteurs de travaux joignent l application,',
    'rem  sans barre oblique finale. Sans elle, les liens des courriels pointent',
    'rem  sur cette machine et ne fonctionnent que depuis elle.',
    'ADRESSE_PUBLIQUE=',
    '',
  ].join('\r\n'); // fins de ligne Windows : le fichier s'ouvre au Bloc-notes

  fs.writeFileSync(fichier, contenu, 'utf8');
  console.log(`  Fichier prepare : ${fichier}`);
  console.log('  Relancez TESTER-COURRIEL.bat pour envoyer un essai avec ces reglages.');
}

async function principal() {
  const arguments_ = process.argv.slice(2);
  const preparer = arguments_.includes('--preparer');
  const destinataire = arguments_.find((a) => !a.startsWith('--'));

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
      '\nCes lignes se remplissent dans le fichier "configuration.txt", a cote de DEMARRER.bat.'
    );
    await proposerReglages(destinataire, { preparer });
    process.exitCode = 1;
    return;
  }

  // Un mot de passe sans compte, ou l'inverse, ne mene qu'a un refus obscur du
  // serveur : autant le dire ici, ou la cause est encore visible.
  const compte = process.env.SMTP_UTILISATEUR;
  const motDePasse = process.env.SMTP_MOT_DE_PASSE;
  if (Boolean(compte) !== Boolean(motDePasse)) {
    console.log(
      `Attention : ${compte ? 'SMTP_UTILISATEUR est renseigne sans SMTP_MOT_DE_PASSE' :
        'SMTP_MOT_DE_PASSE est renseigne sans SMTP_UTILISATEUR'}.` +
        ' Renseignez les deux, ou aucun des deux.\n'
    );
  }

  console.log(`Envoi d un message d essai a ${destinataire}`);
  console.log(`  serveur     ${process.env.SMTP_HOTE}:${process.env.SMTP_PORT || 587}`);
  console.log(`  compte      ${compte || 'aucun (envoi sans authentification)'}`);
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
  const explication = expliquer(resultat.raison, { avecCompte: Boolean(compte) });
  if (explication) console.log(`${explication}\n`);
  if (resultat.fichier) console.log(`Le message a ete conserve ici : ${resultat.fichier}`);
  process.exitCode = 1;
}

principal()
  .catch((erreur) => {
    console.error(`Essai interrompu : ${erreur.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    /*
     * Une tentative abandonnee garde sa connexion en cours d'etablissement, et
     * Node attend qu'elle s'eteigne avant de rendre la main : le script
     * afficherait son resultat puis semblerait fige une demi-minute. On sort
     * une fois la reponse ecrite — elle est deja complete, il n'y a plus rien a
     * attendre.
     */
    C.fermer();
    const sortir = () => process.exit(process.exitCode || 0);
    if (process.stdout.write('')) sortir();
    else process.stdout.once('drain', sortir);
  });
