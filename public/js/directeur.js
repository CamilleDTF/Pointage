/* Tableau de bord du directeur : verification, correction, validation, export. */

let reference = null;
let tableau = null;

const $ = (id) => document.getElementById(id);

/*
 * Cablage tolerant : un identifiant absent de la page ne doit couter que la
 * fonction concernee. Sans ce garde-fou, un `addEventListener` sur un element
 * manquant interrompt tout le fichier — les ecouteurs suivants ne sont plus
 * poses et l'ecran ne demarre jamais.
 */
function surEvenement(id, evenement, action) {
  const element = $(id);
  if (!element) {
    console.warn(`Element "${id}" absent de la page : fonction indisponible, le reste fonctionne.`);
    return;
  }
  element.addEventListener(evenement, action);
}
function surClic(id, action) {
  surEvenement(id, 'click', action);
}

async function demarrer() {
  const { utilisateur } = await API.get('/api/moi');
  if (utilisateur.role !== 'directeur') {
    location.href = '/chef.html';
    return;
  }
  definirRole('directeur');
  $('entete-nom').textContent = utilisateur.nom;

  reference = await API.get('/api/reference');
  $('entete-nom').textContent = `${utilisateur.nom} · version ${reference.version}`;

  /*
   * Revenir d'une fiche doit ramener sur SA semaine, pas sur celle
   * d'aujourd'hui : on repart verifier la suivante, et retomber en semaine
   * courante obligerait a re-naviguer a chaque aller-retour.
   */
  const url = new URLSearchParams(location.search);
  $('annee').value = Number(url.get('annee')) || reference.semaineCourante.annee;
  $('semaine').value = Number(url.get('semaine')) || reference.semaineCourante.semaine;

  await charger();
  await apercuMois();
}

/** Applique une action a un element, s'il existe sur la page. */
function poser(id, action) {
  const element = $(id);
  if (element) action(element);
}

/*
 * L'etat du mois, la ou il y avait quatre boutons.
 *
 * Le tableau du cabinet ne compte QUE les fiches validees. C'est juste, et
 * c'est le piege : rien ne le disait, et on pouvait transmettre un mois ampute
 * de trois fiches sans s'en apercevoir. La ligne le dit avant qu'on ouvre quoi
 * que ce soit.
 */
async function apercuMois() {
  const zone = $('etat-mois');
  if (!zone) return;
  const maintenant = new Date();
  const annee = maintenant.getFullYear();
  const mois = maintenant.getMonth() + 1;

  try {
    const a = await API.get(`/api/export/mois-apercu?annee=${annee}&mois=${mois}`);
    const nom = `${Regles.MOIS[a.mois - 1]} ${a.annee || annee}`;
    const manquantes = Number(a.nonValidees) || 0;

    zone.innerHTML = `<div class="etat-paie${manquantes ? '' : ' fait'}">
      <span class="signe">${manquantes ? '▲' : '✓'}</span>
      <span class="texte">
        <strong>${a.nbSalaries
          ? `${nom} — ${a.nbSalaries} salarié(s), ${versTexte(a.minutes)} comptées.`
          : `${nom} — aucune fiche validée pour l'instant.`}</strong>
        <span class="precision">${manquantes
          ? `${manquantes} fiche(s) du mois ne sont pas validées : tant qu'elles ne le sont pas, `
            + 'elles ne comptent pas dans le tableau du cabinet.'
          : 'Rien ne bloque la transmission au cabinet.'}</span>
      </span>
    </div>`;
  } catch (e) {
    zone.innerHTML = `<p class="aide" style="color:var(--rouge)">${echapper(e.message)}</p>`;
  }
}

surClic('btn-charger', charger);
surClic('btn-quitter', deconnexion);
surClic('btn-precedente', () => decalerSemaine(-1));
surClic('btn-suivante', () => decalerSemaine(1));
surClic('btn-admin', () => { location.href = '/parametres.html'; });
surClic('btn-export-xlsx', () => exporter('xlsx'));
surClic('btn-export-csv', () => exporter('csv'));
surClic('btn-mensuel', () => { location.href = '/mensuel.html'; });
surClic('btn-calendrier', () => { location.href = '/calendrier.html'; });
surClic('btn-non-productif', () => { location.href = '/non-productif.html'; });

/*
 * Les deux champs de saisie ne servent qu'a sauter loin — changer d'annee, ou
 * revenir sur un mois passe. Les fleches font tout le reste, et occuper le haut
 * de l'ecran en permanence avec deux cases qu'on remplit trois fois par an
 * n'avait pas de sens.
 */
surClic('btn-autre', () => {
  const choix = $('choix-semaine');
  choix.classList.toggle('masque');
  if (!choix.classList.contains('masque')) $('semaine').focus();
});

function decalerSemaine(pas) {
  let semaine = Number($('semaine').value) + pas;
  let annee = Number($('annee').value);
  if (semaine < 1) { semaine = 52; annee -= 1; }
  if (semaine > 53) { semaine = 1; annee += 1; }
  $('semaine').value = semaine;
  $('annee').value = annee;
  charger();
}

function exporter(format) {
  const params = new URLSearchParams({
    annee: $('annee').value,
    semaine: $('semaine').value,
  });
  const statut = $('portee-export').value;
  if (statut) params.set('statut', statut);
  window.location.href = `/api/export/periode.${format}?${params}`;
}

/* --------------------------------- Chargement ----------------------------- */

async function charger() {
  const annee = Number($('annee').value);
  const semaine = Number($('semaine').value);
  try {
    tableau = await API.get(`/api/tableau?annee=${annee}&semaine=${semaine}`);
  } catch (e) {
    message(e.message, 'erreur');
    return;
  }

  $('quand').textContent = `Semaine ${tableau.semaine}`;
  $('periode').textContent =
    `du ${jourMois(tableau.dates[0])} au ${jourMois(tableau.dates[6])} ${tableau.annee}`;
  afficherJauge();
  afficherAppels();
  afficherChefs();
}

/*
 * La jauge : ce que vaut la semaine, d'un coup d'oeil.
 *
 * Deux parts et non une — ce qui est valide, et ce qui est rendu sans l'etre.
 * Un seul remplissage confondrait « le travail est fait » et « le travail est
 * arrive », qui sont les deux choses que cet ecran doit distinguer.
 */
function afficherJauge() {
  const t = tableau.totaux;
  const attendues = t.attendues || 1;
  const rendues = tableau.fiches.length;
  $('part-validee').style.width = `${(t.validees / attendues) * 100}%`;
  $('part-rendue').style.width = `${(Math.max(rendues - t.validees, 0) / attendues) * 100}%`;
  $('contexte-semaine').textContent =
    `${rendues} fiche(s) rendue(s) sur ${t.attendues} · ${t.validees} validée(s) · `
    + `${t.salaries} salarié(s) pointé(s) · ${versTexte(t.minutes)} au total.`;
}

/*
 * Les chefs de la semaine, en cartes.
 *
 * A la place des fiches depliees ET du tableau de suivi, qui disaient la meme
 * chose deux fois : l'une en sept mille pixels de grilles de saisie, l'autre en
 * sept colonnes tout en bas de l'ecran. Une carte par chef, meme forme pour
 * tous, et l'etat porte un symbole autant qu'une couleur.
 */
const MARQUES = {
  soumise: { classe: 'verifier', signe: '▲', texte: 'À vérifier' },
  attenteVisa: { classe: 'visa', signe: '◷', texte: 'Chez le conducteur' },
  validee: { classe: 'validee', signe: '✓', texte: 'Validée' },
  rejetee: { classe: 'verifier', signe: '▲', texte: 'Renvoyée au chef' },
  brouillon: { classe: 'attente', signe: '◌', texte: 'En cours de saisie' },
  manquante: { classe: 'manquante', signe: '●', texte: 'Rien reçu' },
};

function afficherChefs() {
  $('titre-chefs').textContent = `Les ${tableau.suivi.length} chefs cette semaine`;

  $('chefs').innerHTML = tableau.suivi
    .map((entree) => {
      const f = entree.fiche;
      const etat = f ? Regles.etatAffiche(f) : 'manquante';
      const m = MARQUES[etat] || MARQUES.manquante;
      return `<article class="chef">
        <span class="nom">${echapper(entree.chef_nom)}</span>
        <span class="ou">${f ? `${echapper(f.chantier || '—')}<br>${echapper(f.ville || '')}` : '—'}</span>
        <span class="bas">
          <span class="marque ${m.classe}"><span class="signe">${m.signe}</span>${m.texte}</span>
          <span class="heures">${f ? versTexte(f.total_minutes) : '—'}</span>
        </span>
        ${f
          ? `<button class="petit" onclick="allerA(${f.id})">Ouvrir</button>`
          : '<span class="aide serree">à relancer</span>'}
      </article>`;
    })
    .join('');
}

/**
 * Ouvre une fiche sur son propre ecran, et retient la semaine d'ou l'on part.
 */
function allerA(ficheId) {
  location.href = `/fiche.html?id=${ficheId}`;
}
window.allerA = allerA;

/**
 * Enumere des noms sans allonger la ligne indefiniment : trois, puis le compte
 * de ceux qui restent. Huit chefs cites d'affilee ne se lisent pas.
 */
function citerNoms(noms) {
  if (noms.length <= 3) return noms.map(echapper).join(', ');
  return `${noms.slice(0, 3).map(echapper).join(', ')} et ${noms.length - 3} autre(s)`;
}

/*
 * Ce qui attend le directeur, dans l'ordre ou il peut y faire quelque chose.
 *
 * Six nombres de meme poids occupaient cette place — dont quatre qui n'appellent
 * aucun geste. On y lisait l'etat de la semaine, jamais ce qu'il fallait en
 * faire. Ne restent ici que les trois situations qui demandent une decision,
 * une relance ou une attente ; le reste de l'etat tient sur une ligne, en
 * dessous. Une rubrique a zero ne s'affiche pas : un tableau de bord qui
 * signale toujours quelque chose ne signale plus rien.
 *
 * La couleur ne porte jamais l'information seule — le libelle la dit aussi,
 * pour qui la distingue mal.
 */
function afficherAppels() {
  const t = tableau.totaux;
  const aVerifier = tableau.fiches.filter((f) => f.statut === 'soumise' && f.visa_statut !== 'attente');
  const chezLeConducteur = tableau.fiches.filter((f) => f.visa_statut === 'attente');
  const manquantes = tableau.suivi.filter((s) => s.statut === 'manquante');

  const appels = [];
  if (aVerifier.length) {
    appels.push({
      ton: 'agir',
      nombre: aVerifier.length,
      titre: aVerifier.length > 1 ? 'fiches à vérifier' : 'fiche à vérifier',
      detail: citerNoms(aVerifier.map((f) => f.chef_nom)),
      action: { intitule: 'Ouvrir la première', ficheId: aVerifier[0].id },
    });
  }
  if (manquantes.length) {
    appels.push({
      ton: 'relancer',
      nombre: manquantes.length,
      titre: manquantes.length > 1 ? 'fiches manquantes' : 'fiche manquante',
      detail: citerNoms(manquantes.map((s) => s.chef_nom)),
    });
  }
  if (chezLeConducteur.length) {
    appels.push({
      ton: 'attendre',
      nombre: chezLeConducteur.length,
      titre: chezLeConducteur.length > 1 ? 'fiches chez le conducteur' : 'fiche chez le conducteur',
      detail: citerNoms(chezLeConducteur.map((f) => f.chef_nom)),
    });
  }

  /*
   * Une action par ligne, et non un bouton discret en bout de course. Le geste
   * qu'on vient faire ne doit pas se chercher.
   */
  $('appels').innerHTML = appels.length
    ? appels
        .map(
          (a) => `<div class="appel-l ${a.ton}">
            <span class="compte">${a.nombre}</span>
            <span class="quoi">
              <strong>${a.titre}</strong>
              <span class="detail">${a.detail}</span>
            </span>
            ${a.action
              ? `<button class="principal" onclick="allerA(${a.action.ficheId})">${a.action.intitule}</button>`
              : ''}
          </div>`
        )
        .join('')
    : '<p class="rien-a-faire">Rien à traiter : aucune fiche n\'attend de décision cette semaine.</p>';
}

demarrer().catch((e) => message(e.message, 'erreur'));
