'use strict';

/*
 * Le serveur : sa configuration, ses routes, les fichiers de l'interface.
 *
 * Les routes elles-memes vivent dans server/routes/, un module par domaine.
 * Elles tenaient toutes ici — treize cents lignes — et il fallait ouvrir ce
 * fichier pour changer une ligne du calendrier comme pour toucher a la paie.
 */

// En premier, avant tout module qui lit process.env : configuration.txt pose
// les reglages du poste (dossier de donnees, serveur d'envoi des courriels).
require('./configuration');

const path = require('path');
const express = require('express');

const A = require('./auth');
const C = require('./courriel');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' })); // les signatures manuscrites sont transmises en PNG base64.
app.use(A.session);
app.use(A.codeProvisoireFerme);
app.use(A.espaceConducteurFerme);
app.use(A.adminEnLectureSeule);

/*
 * Les routes, dans l'ordre ou elles etaient declarees.
 *
 * Cet ordre compte : Express essaie les motifs les uns apres les autres, et
 * « /api/fiches/semaine » doit passer avant « /api/fiches/:id », faute de quoi
 * le second avalerait le premier. Deplacer un module dans cette liste n'est
 * donc jamais neutre.
 */
for (const groupe of [
  'authentification',
  'reference',
  'non-productif',
  'calendrier',
  'fiches',
  'conducteur',
  'paie',
  'tableau',
  'administration',
]) {
  app.use(require(`./routes/${groupe}`));
}


/* --------------------------------- Statique -------------------------------- */

/*
 * `no-cache` ne veut pas dire « ne rien garder » : le navigateur conserve les
 * fichiers, mais revalide a chaque fois et se contente d'un 304 quand rien n'a
 * bouge. C'est indispensable ici. Avec une duree de vie ferme (maxAge), une
 * page pouvait rester en cache pendant qu'un script etait recharge : la version
 * d'hier appelait alors le code d'aujourd'hui, et l'ecran restait vide. Sur une
 * poignee de postes en reseau local, la revalidation ne coute rien.
 */
app.use(
  express.static(path.join(__dirname, '..', 'public'), {
    etag: true,
    lastModified: true,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  })
);

/*
 * Une adresse inconnue renvoie a l'ecran de connexion — mais seulement s'il
 * s'agit d'une navigation. Repondre la page d'accueil a la place d'un fichier
 * .js ou .css manquant est pire que de ne rien repondre : le navigateur recoit
 * du HTML la ou il attend du code, et l'echec devient incomprehensible.
 */
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ erreur: 'Route inconnue.' });
  if (/\.[a-z0-9]+$/i.test(req.path)) return res.status(404).type('text/plain').send('Fichier introuvable.');
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

/*
 * Une panne interne, rendue racontable.
 *
 * « Erreur interne du serveur. » ne dit rien a la personne devant l'ecran, et
 * rien non plus a celle qui devra la corriger : la trace partait dans une
 * fenetre noire que l'on ferme, ou nulle part quand l'application tourne en
 * service. Chaque panne recoit donc une reference courte, ecrite avec sa trace
 * complete dans data/erreurs.log, et affichee a l'ecran. « Erreur interne
 * (ref. A7F3) » se recopie dans un message ; « erreur interne » ne se recopie
 * pas.
 */
app.use((err, req, res, next) => {
  const reference = require('crypto').randomBytes(2).toString('hex').toUpperCase();
  const quand = new Date().toISOString();
  const entree =
    `\n[${quand}] reference ${reference}\n`
    + `  ${req.method} ${req.originalUrl}\n`
    + `  utilisateur : ${req.utilisateur ? `${req.utilisateur.identifiant} (${req.utilisateur.role})` : 'non connecte'}\n`
    + `  ${err && err.stack ? err.stack : String(err)}\n`;

  console.error(entree);
  try {
    require('fs').appendFileSync(path.join(require('./db').DATA_DIR, 'erreurs.log'), entree);
  } catch {
    // Journal indisponible : la console reste, et la reponse part quand meme.
  }

  res.status(500).json({
    erreur:
      `Erreur interne (réf. ${reference}). Le détail est dans le fichier erreurs.log `
      + 'du dossier des données — transmettez-le pour que la cause soit identifiée.',
    reference,
  });
});

if (require.main === module) {
  const serveur = app.listen(PORT, () => {
    console.log(`Pointage DTF : http://localhost:${PORT}`);
    // Dit des le demarrage si les courriels partiront : sans cette ligne, on ne
    // s'en apercoit qu'au premier chef d'equipe qui transmet sa fiche.
    console.log(
      C.ACTIF
        ? "Envoi des courriels : actif (les demandes de visa partent aux conducteurs de travaux)."
        : "Envoi des courriels : inactif. Les demandes de visa sont conservees dans " +
          `${C.DOSSIER_COURRIELS} et le lien s'affiche sur la fiche. ` +
          'Pour les faire partir, remplissez les lignes SMTP de configuration.txt.'
    );
  });

  /*
   * Ce qui empeche de demarrer, dit en francais.
   *
   * Sans ce gestionnaire, Node repond par une trace de quinze lignes qui
   * commence par « EADDRINUSE » et cite `express/lib/application.js`. Or la
   * cause est presque toujours la meme, et n'a rien de technique : quelqu'un a
   * double-clique sur DEMARRER.bat une seconde fois, ou le service Windows
   * tourne deja. La personne devant l'ecran n'a pas a traduire une trace pour
   * apprendre qu'il n'y a rien de casse.
   */
  serveur.on('error', (err) => {
    const explications = {
      EADDRINUSE: [
        `Le port ${PORT} est deja pris : l'application tourne deja sur cette machine.`,
        '',
        `  → Ouvrez simplement http://localhost:${PORT} dans votre navigateur.`,
        '',
        "Si vous vouliez la redemarrer, fermez d'abord l'autre fenetre. Si elle est",
        'installee en service Windows, elle demarre toute seule : il n\'y a rien a',
        'lancer a la main. Pour l\'arreter :',
        '',
        '  net stop Pointage',
        '',
        `Pour utiliser un autre port, ajoutez une ligne PORT=3001 dans configuration.txt.`,
      ],
      EACCES: [
        `Le port ${PORT} est refuse par Windows : ce numero demande des droits`,
        'administrateur, ou une regle de securite le reserve.',
        '',
        '  → Choisissez un port au-dessus de 1024 : ajoutez PORT=3001 dans configuration.txt.',
      ],
    };

    const lignes = explications[err.code];
    console.error('');
    console.error('  Le pointage n\'a pas pu demarrer.');
    console.error('');
    if (lignes) {
      for (const ligne of lignes) console.error(ligne ? `  ${ligne}` : '');
    } else {
      console.error(`  ${err.message}`);
    }
    console.error('');
    process.exit(1);
  });
}

module.exports = app;
