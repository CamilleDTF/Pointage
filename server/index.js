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
app.use(A.espaceConducteurFerme);

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

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ erreur: 'Erreur interne du serveur.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
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
}

module.exports = app;
