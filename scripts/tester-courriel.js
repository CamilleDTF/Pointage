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

/*
 * --details doit etre pris en compte avant de charger le module d'envoi : c'est
 * a son chargement que la connexion est configuree, et donc que se decide
 * l'enregistrement ou non du dialogue avec le serveur.
 */
const DETAILS = process.argv.includes('--details');
if (DETAILS) process.env.SMTP_TRACE = '1';

const C = require('../server/courriel');
const Fournisseurs = require('../server/fournisseurs-courriel');
const Sonde = require('../server/sonde-port');

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
function expliquer(raison, { avecCompte = true, code = null, codeReponse = null, commande = null } = {}) {
  const texte = String(raison || '').toLowerCase();

  /*
   * Le code numerique du serveur est plus sur que sa phrase, qui change d'un
   * editeur a l'autre et n'est jamais traduite. On le lit en premier.
   */
  if (codeReponse === 550 && commande === 'RCPT TO') {
    return avecCompte
      ? "Le serveur connait le compte mais refuse le destinataire : l'adresse n'existe pas, ou " +
        "le compte n'a pas le droit d'ecrire a cette boite."
      : "Le serveur refuse le destinataire. Sans compte, il n'accepte que les adresses de son " +
        "propre domaine : verifiez que l'adresse d'essai se termine bien par le meme domaine " +
        "que l'expediteur. Pour ecrire a l'exterieur, il faut l'option avec compte et mot de passe.";
  }
  if (codeReponse === 550 || codeReponse === 554) {
    return "Le serveur a refuse le message lui-meme. Le plus souvent, l'adresse d'expedition " +
      "n'est pas autorisee depuis cette machine : c'est le cas quand l'adresse publique de la " +
      "connexion internet n'est pas declaree dans l'enregistrement SPF du domaine. Le service " +
      'informatique peut le confirmer en une minute a partir de la reponse complete ci-dessus.';
  }
  if (codeReponse === 535 || codeReponse === 534 || commande === 'AUTH PLAIN' || commande === 'AUTH LOGIN') {
    return "Le serveur a refuse le compte ou le mot de passe. Chez Microsoft 365, trois causes " +
      "possibles : le mot de passe habituel du compte n'est pas accepte et il faut un mot de " +
      "passe d'application ; l'authentification SMTP est desactivee sur la boite et " +
      "l'administrateur doit l'autoriser ; ou le compte n'a pas de licence permettant l'envoi.";
  }

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

/**
 * Ouvre une connexion vers le serveur configure avant d'essayer d'envoyer.
 *
 * Renvoie `true` si l'envoi peut etre tente. Sinon, dit ce qui bloque et, si un
 * autre port du meme fournisseur repond, lequel prendre : « le 25 est ferme, le
 * 587 est ouvert » est une conclusion, pas une piste.
 */
async function verifierLaPorte(destinataire) {
  const hote = process.env.SMTP_HOTE;
  const port = Number(process.env.SMTP_PORT) || 587;

  process.stdout.write(`Verification de l acces a ${hote}:${port} ... `);
  const essai = await Sonde.joignable(hote, port);

  if (essai.ouvert) {
    console.log(`ouvert (${essai.duree} ms)\n`);
    return true;
  }

  console.log(essai.raison === 'silence' ? 'AUCUNE REPONSE\n' : `${essai.raison}\n`);
  console.log('=== L ENVOI N A MEME PAS PU ETRE TENTE ===\n');

  if (essai.raison === 'enotfound' || essai.raison === 'eai_again') {
    console.log(`  Le nom "${hote}" est introuvable. Verifiez SMTP_HOTE dans configuration.txt :`);
    console.log('  une faute de frappe suffit.\n');
    return false;
  }

  /*
   * Les deux echecs ne disent pas la meme chose. Un silence, c'est un pare-feu
   * qui jette les paquets sans repondre. Un refus immediat, c'est que la porte
   * existe mais que personne n'ecoute derriere : le port est le mauvais.
   */
  console.log(
    essai.raison === 'silence'
      ? `  Le port ${port} ne sort pas de cette machine : rien ne revient, la connexion\n` +
        "  reste sans reponse. C'est la signature d'un pare-feu d'entreprise ou d'un\n" +
        "  fournisseur d'acces qui bloque ce port. Ce n'est ni un probleme de compte,\n" +
        '  ni de mot de passe : la conversation ne commence jamais.\n'
      : `  La connexion au port ${port} a ete refusee immediatement : le serveur repond,\n` +
        "  mais rien n'ecoute sur ce port. C'est le numero de port qui est en cause,\n" +
        '  pas le pare-feu.\n'
  );

  // Le port 25 bloque est la regle, pas l'exception. Reste a savoir si le 587
  // passe, auquel cas la reponse est toute trouvee.
  const alternatifs = [587, 465, 25].filter((p) => p !== port);
  const detection = await Fournisseurs.detecter(process.env.COURRIEL_EXPEDITEUR || destinataire);
  const hoteAuthentifie = detection.trouve ? detection.fournisseur.hote : hote;

  console.log(`  Recherche d un port ouvert vers ${hoteAuthentifie} :\n`);
  const resultats = await Sonde.sonderPorts(hoteAuthentifie, alternatifs);
  for (const r of resultats) {
    console.log(`    port ${String(r.port).padEnd(4)} ${r.ouvert ? 'OUVERT' : 'ferme'}`);
  }
  console.log('');

  const ouvert = resultats.find((r) => r.ouvert);
  if (!ouvert) {
    console.log(
      "  Aucun port d'envoi ne sort de cette machine. Demandez au service informatique\n" +
        `  l'autorisation de joindre ${hoteAuthentifie} sur le port 587, en expliquant que\n` +
        "  l'application doit envoyer les demandes de visa aux conducteurs de travaux.\n"
    );
    return false;
  }

  console.log(`  Le port ${ouvert.port} repond. Remplacez ces lignes dans configuration.txt :\n`);
  console.log(`    SMTP_HOTE=${hoteAuthentifie}`);
  console.log(`    SMTP_PORT=${ouvert.port}`);
  console.log(`    SMTP_UTILISATEUR=${process.env.COURRIEL_EXPEDITEUR || destinataire}`);
  console.log('    SMTP_MOT_DE_PASSE=<mot de passe d application>');
  console.log(`    COURRIEL_EXPEDITEUR=${process.env.COURRIEL_EXPEDITEUR || destinataire}\n`);
  if (detection.trouve) console.log(`  ${detection.fournisseur.note}\n`);

  return false;
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

  // Avant tout envoi : la porte est-elle ouverte ? Sinon, vingt secondes
  // d'attente pour apprendre « le serveur n'a pas repondu », alors qu'une
  // ouverture de connexion tranche en trois.
  if (!(await verifierLaPorte(destinataire))) {
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

  console.log('=== LE MESSAGE N EST PAS PARTI ===\n');
  console.log(`  Ce que dit le serveur : ${resultat.raison}`);

  /*
   * Le resume de la bibliotheque ne suffit pas toujours. La reponse brute du
   * serveur — son code numerique et sa phrase — est ce qui permet de trancher,
   * et c'est aussi ce qu'un service informatique demandera.
   */
  if (resultat.codeReponse) console.log(`  Code de refus         : ${resultat.codeReponse}`);
  if (resultat.reponse) console.log(`  Reponse complete      : ${String(resultat.reponse).trim()}`);
  if (resultat.commande) console.log(`  A quelle etape        : commande ${resultat.commande}`);
  if (resultat.code) console.log(`  Nature du probleme    : ${resultat.code}`);
  console.log('');

  const explication = expliquer(resultat.raison, {
    avecCompte: Boolean(compte),
    code: resultat.code,
    codeReponse: resultat.codeReponse,
    commande: resultat.commande,
  });
  if (explication) console.log(`${explication}\n`);
  else {
    console.log(
      "Ce refus n'est pas dans la liste des causes connues. Relancez l essai avec le detail\n" +
        'du dialogue avec le serveur, qui montre exactement ou la conversation s arrete :\n\n' +
        '    TESTER-COURRIEL.bat votre.adresse@dtffrance.com --details\n'
    );
  }

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
