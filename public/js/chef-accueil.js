/*
 * L'accueil du chef d'equipe.
 *
 * Il arrivait droit dans la grille : onze lignes sur sept jours, des la
 * connexion. Ce qui avait change sur ses fiches — un renvoi de la direction,
 * une correction du conducteur — s'affichait au-dessus, mais il fallait le
 * lire en passant, avant de descendre saisir ; et son annee se depliait sous
 * un volet qu'on n'ouvrait jamais.
 *
 * Cet ecran pose la question dans l'ordre ou elle se pose un lundi matin :
 * est-ce qu'on me demande quelque chose, et par ou je commence.
 */

let reference = null;

const $ = (id) => document.getElementById(id);

function surClic(id, action) {
  const element = $(id);
  if (!element) {
    console.warn(`Element "${id}" absent de la page : fonction indisponible, le reste fonctionne.`);
    return;
  }
  element.addEventListener('click', action);
}

async function demarrer() {
  const { utilisateur } = await API.get('/api/moi');
  if (utilisateur.role !== 'chef') {
    location.href = utilisateur.role === 'directeur'
      ? '/accueil.html'
      : utilisateur.role === 'conducteur' ? '/conducteur.html' : '/parametres.html';
    return;
  }
  definirRole('chef');

  reference = await API.get('/api/reference');
  $('entete-nom').textContent = `${utilisateur.nom} · version ${reference.version}`;

  // Les trois se chargent en parallele : aucun ne depend des autres.
  await Promise.all([chargerNotifications(), chargerLesDeuxPortes()]);
}

surClic('btn-quitter', deconnexion);
surClic('btn-code', () => { location.href = '/chef.html#code'; });
surClic('btn-semaine', () => { location.href = '/chef.html'; });
surClic('btn-calendrier', () => { location.href = '/chef.html#calendrier'; });

/*
 * Ce qu'on lui demande : un renvoi, une correction du conducteur.
 *
 * Un encadre par fiche, et non un par evenement — la meme fiche revenait sur
 * trois encadres en repetant son chantier a chaque ligne.
 */
async function chargerNotifications() {
  const bloc = $('bloc-notifications');
  if (!bloc) return;

  let donnees;
  try {
    donnees = await API.get('/api/mes-notifications');
  } catch {
    return; // une notification manquante ne doit pas couter l'ecran
  }

  const semaine = (n) => `semaine ${n.semaine} — ${n.chantier || 'chantier non renseigné'}`;
  const parFiche = new Map();
  const ajouter = (id, entete, point) => {
    if (!parFiche.has(id)) parFiche.set(id, { id, entete, points: [] });
    parFiche.get(id).points.push(point);
  };

  for (const f of donnees.renvoyees) {
    ajouter(f.id, semaine(f), {
      quoi: 'À corriger',
      ton: 'agir',
      detail: f.motif_rejet || 'Renvoyée pour correction.',
    });
  }
  for (const c of donnees.corrections) {
    ajouter(c.fiche_id, semaine(c), {
      quoi: `${c.auteur || 'Le conducteur de travaux'} a corrigé vos heures`,
      ton: 'informer',
      detail: c.detail.split(' ; ').join('\n'),
    });
  }

  const fiches = [...parFiche.values()];
  bloc.classList.toggle('masque', fiches.length === 0);
  if (!fiches.length) return;

  $('titre-notifications').textContent =
    fiches.length === 1 ? 'À votre attention' : `À votre attention — ${fiches.length} fiches`;

  $('liste-notifications').innerHTML = fiches
    .map(
      (f) => `<div class="notification">
        <div class="objet">${echapper(f.entete)}</div>
        ${f.points
          .map(
            (p) => `<div class="point ${p.ton}">
              <span class="quoi">${echapper(p.quoi)}</span>
              <span class="detail">${echapper(p.detail)}</span>
            </div>`
          )
          .join('')}
      </div>`
    )
    .join('');
}

/*
 * Ou en est sa semaine, et ou en est son annee.
 *
 * Les deux viennent du meme appel. Le calendrier de l'annee porte deja l'etat
 * de chaque semaine, la courante comprise — et surtout il ne CREE rien : la
 * route qui rend la fiche de la semaine ouvre un brouillon quand il n'en
 * existe pas, ce qui ferait naitre une fiche vide au seul fait de passer par
 * l'accueil.
 */
const ETATS_SEMAINE = {
  brouillon: { texte: 'En cours de saisie', ton: 'agir' },
  rejetee: { texte: 'Renvoyée par la direction', ton: 'manque' },
  soumise: { texte: 'Transmise, en attente', ton: '' },
  validee: { texte: 'Validée', ton: '' },
  manquante: { texte: 'Rien de saisi', ton: 'agir' },
  avenir: { texte: 'Semaine à venir', ton: '' },
  horsPerimetre: { texte: 'Avant la mise en service', ton: '' },
};

async function chargerLesDeuxPortes() {
  const annee = reference.semaineCourante.annee;
  const numero = reference.semaineCourante.semaine;
  $('quand-semaine').textContent = `Semaine ${numero}`;

  let donnees;
  try {
    donnees = await API.get(`/api/calendrier?annee=${annee}`);
  } catch (e) {
    for (const id of ['etat-semaine', 'etat-annee']) {
      $(id).innerHTML = `<p class="aide">${echapper(e.message)}</p>`;
    }
    return;
  }

  /* --- La porte de la semaine. --- */
  const courante = donnees.semaines.find((s) => s.courante) || {};
  const m = ETATS_SEMAINE[courante.etat] || ETATS_SEMAINE.manquante;
  const fiche = courante.fiche;

  $('etat-semaine').innerHTML = `
    <p class="periode">${courante.debut ? `Du ${jourMois(courante.debut)} au ${jourMois(courante.fin)}` : ''}</p>
    <ul class="points"><li class="${m.ton}"><strong>${m.texte}</strong></li></ul>
    <p class="aide">${
      fiche && fiche.chantier
        ? echapper(fiche.chantier)
        : 'Le chantier reste à renseigner.'
    }</p>`;

  $('btn-semaine').textContent = fiche ? 'Ouvrir ma fiche' : 'Commencer ma fiche';

  /* --- La porte de l'annee. --- */
  const t = donnees.totaux;
  const aTraiter = (t.rejetee || 0) + (t.manquante || 0) + (t.brouillon || 0);

  $('etat-annee').innerHTML = `
    <p class="periode">Année ${annee}</p>
    ${
      aTraiter
        ? `<ul class="points"><li class="agir"><strong>${aTraiter}</strong> semaine(s) à traiter</li></ul>
           <p class="aide">${t.validee || 0} validée(s), ${t.soumise || 0} transmise(s).</p>`
        : `<p class="rien-a-faire">${t.validee || 0} semaine(s) validée(s) — rien en attente.</p>`
    }`;
}

demarrer().catch((e) => message(e.message, 'erreur'));
