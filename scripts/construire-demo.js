'use strict';

/*
 * Assemble une page de demonstration autonome a partir du code reel de
 * l'application : meme HTML, meme CSS, meme JavaScript d'interface. Seul le
 * transport change — les appels reseau sont rejoues en memoire par
 * demo/faux-serveur.js.
 *
 *   node scripts/construire-demo.js   ->   demo/demonstration.html
 *
 * Chaque adaptation est declaree ci-dessous et verifiee : si le code source
 * evolue et qu'un motif ne correspond plus, la construction echoue au lieu de
 * produire une demonstration silencieusement cassee.
 */

const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

/** Remplace un motif unique, en echouant si le code source a change. */
function adapter(source, motif, remplacement, intitule) {
  const occurrences = source.split(motif).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Adaptation "${intitule}" : ${occurrences} occurrence(s) trouvée(s) au lieu d'une. ` +
        'Le code source a changé, mettez à jour scripts/construire-demo.js.'
    );
  }
  return source.split(motif).join(remplacement);
}

/* ----------------------- Adaptation du code d'interface -------------------- */

function preparerCommun() {
  let source = lire('public', 'js', 'commun.js');

  // Le transport HTTP est remplace par le faux serveur en memoire.
  const debut = source.indexOf('const API = {');
  const fin = source.indexOf('\n};', debut) + 3;
  if (debut === -1 || fin < debut) throw new Error("Objet API introuvable dans commun.js.");
  source =
    source.slice(0, debut) +
    `const API = {
  async appel(methode, url, corps) {
    await new Promise((r) => setTimeout(r, 90)); // latence simulée, pour un rendu réaliste
    try {
      return FauxServeur.appel(methode, url, corps);
    } catch (e) {
      const erreur = new Error(e.message);
      erreur.statut = e.statut || 500;
      erreur.anomalies = e.anomalies;
      throw erreur;
    }
  },
  get: (url) => API.appel('GET', url),
  post: (url, corps) => API.appel('POST', url, corps),
  put: (url, corps) => API.appel('PUT', url, corps),
};` +
    source.slice(fin);

  source = adapter(
    source,
    "  await API.post('/api/deconnexion').catch(() => {});\n  location.href = '/';",
    "  await API.post('/api/deconnexion').catch(() => {});\n  Demo.deconnecter();",
    'déconnexion'
  );

  // La desinstallation du service worker n'a pas de sens dans une page unique.
  const swDebut = source.indexOf("if ('serviceWorker' in navigator)");
  if (swDebut === -1) throw new Error('Bloc service worker introuvable dans commun.js.');
  source = source.slice(0, swDebut);

  return source;
}

function preparerChef() {
  let source = lire('public', 'js', 'chef.js');
  source = adapter(source, "location.href = '/directeur.html';", "Demo.aller('directeur');", 'redirection directeur');
  source = adapter(
    source,
    'if (fiche) window.location.href = `/api/export/fiche/${fiche.id}.xlsx`;',
    "Demo.indisponible('Téléchargement Excel');",
    'export Excel du chef'
  );
  return source;
}

function preparerDirecteur() {
  let source = lire('public', 'js', 'directeur.js');
  source = adapter(source, "location.href = '/chef.html';", "Demo.aller('chef');", 'redirection chef');
  source = adapter(
    source,
    '  window.location.href = `/api/export/periode.${format}?${params}`;',
    "  Demo.indisponible(`Export ${format.toUpperCase()}`);",
    'exports de la période'
  );
  source = adapter(
    source,
    '        window.location.href = `/api/export/fiche/${fiche.id}.xlsx`;',
    "        Demo.indisponible('Fiche Excel');",
    'export Excel d’une fiche'
  );
  // La demonstration n'a pas d'adresses : la navigation passe par l'aiguillage.
  source = adapter(
    source,
    "surClic('btn-admin', () => { location.href = '/parametres.html'; });",
    "surClic('btn-admin', () => Demo.aller('parametres'));",
    'accès aux paramètres'
  );
  source = adapter(
    source,
    "  surClic(bouton, () => { location.href = '/mensuel.html'; });",
    "  surClic(bouton, () => Demo.aller('mensuel'));",
    'accès au tableau mensuel'
  );
  return source;
}

function preparerMensuel() {
  let source = lire('public', 'js', 'mensuel.js');
  source = adapter(source, "location.href = '/chef.html';", "Demo.aller('chef');", 'redirection chef');
  source = adapter(
    source,
    "surClic('btn-retour', () => { location.href = '/directeur.html'; });",
    "surClic('btn-retour', () => Demo.aller('directeur'));",
    'retour au tableau de bord'
  );
  source = adapter(
    source,
    '  window.location.href = `/api/export/mois.xlsx?${parametres}`;',
    "  Demo.indisponible(`Tableau mensuel (version ${version})`);",
    'téléchargement du tableau mensuel'
  );
  return source;
}

function preparerParametres() {
  let source = lire('public', 'js', 'parametres.js');
  source = adapter(source, "location.href = '/chef.html';", "Demo.aller('chef');", 'redirection chef');
  source = adapter(
    source,
    "surClic('btn-retour', () => { location.href = '/directeur.html'; });",
    "surClic('btn-retour', () => Demo.aller('directeur'));",
    'retour au tableau de bord'
  );
  return source;
}

/** Corps d'une page, sans ses balises <script> : le script est joue separement. */
function corpsDePage(fichier) {
  const html = lire('public', fichier);
  const corps = html.match(/<body>([\s\S]*?)<\/body>/);
  if (!corps) throw new Error(`Balise <body> introuvable dans ${fichier}.`);
  return corps[1].replace(/<script[\s\S]*?<\/script>/g, '').trim();
}

/* ------------------------------- Assemblage -------------------------------- */

const remplacements = {
  STYLE: lire('public', 'css', 'style.css'),
  REGLES: lire('public', 'js', 'regles.js'),
  FAUX_SERVEUR: lire('demo', 'faux-serveur.js'),
  COMMUN: preparerCommun(),
  GABARIT_CHEF: JSON.stringify(corpsDePage('chef.html')),
  GABARIT_DIRECTEUR: JSON.stringify(corpsDePage('directeur.html')),
  GABARIT_PARAMETRES: JSON.stringify(corpsDePage('parametres.html')),
  GABARIT_MENSUEL: JSON.stringify(corpsDePage('mensuel.html')),
  SCRIPT_CHEF: JSON.stringify(preparerChef()),
  SCRIPT_DIRECTEUR: JSON.stringify(preparerDirecteur()),
  SCRIPT_PARAMETRES: JSON.stringify(preparerParametres()),
  SCRIPT_MENSUEL: JSON.stringify(preparerMensuel()),
};

let page = lire('demo', 'coquille.html');
for (const [nom, contenu] of Object.entries(remplacements)) {
  const marqueur = `/*{${nom}}*/`;
  if (!page.includes(marqueur)) throw new Error(`Marqueur ${marqueur} absent de demo/coquille.html.`);
  page = page.replace(marqueur, () => contenu);
}

const titre = '<title>Pointage hebdomadaire — démonstration</title>\n';
const sortie = path.join(RACINE, 'demo', 'demonstration.html');
fs.writeFileSync(sortie, titre + page);

console.log(`Démonstration écrite : demo/demonstration.html (${Math.round(page.length / 1024)} Ko)`);
