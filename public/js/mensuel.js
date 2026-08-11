/*
 * Tableau mensuel pour la paie, en page a part.
 *
 * Deux versions du meme tableau : publique — heures, majorations et primes en
 * jours — et direction, qui ajoute les montants. La seconde redemande le code
 * du directeur a chaque ouverture et a chaque telechargement.
 */

let reference = null;

const $ = (id) => document.getElementById(id);

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

  reference = await API.get('/api/reference');
  $('entete-nom').textContent = `${utilisateur.nom} · version ${reference.version}`;
  preparerSelecteurMois();
  await apercuMois();
  await afficherMois();
}

function preparerSelecteurMois() {
  const courant = new Date();
  $('mois').innerHTML = Regles.MOIS
    .map((nom, i) => `<option value="${i + 1}"${i === courant.getMonth() ? ' selected' : ''}>${nom}</option>`)
    .join('');
  $('annee-mois').value = courant.getFullYear();
}

/** Annonce ce que contiendra le tableau avant de le calculer. */
async function apercuMois() {
  const zone = $('apercu-mois');
  if (!zone) return;
  try {
    const a = await API.get(`/api/export/mois-apercu?annee=${$('annee-mois').value}&mois=${$('mois').value}`);
    const semaines = a.semaines.map((s) => `S${s.semaine}`).join(', ');
    zone.textContent = a.nbSalaries
      ? `${a.nbSalaries} salarié(s), ${versTexte(a.minutes)} au total — semaines ${semaines}.`
      : `Aucune fiche validée sur les semaines ${semaines}.`;
    zone.style.color = a.nbSalaries ? '' : 'var(--orange)';
  } catch (e) {
    zone.textContent = e.message;
    zone.style.color = 'var(--rouge)';
  }
}

surClic('btn-retour', () => { location.href = '/directeur.html'; });
surClic('btn-quitter', deconnexion);
surClic('btn-export-mois', telechargerMois);
surClic('btn-voir-mois', () => afficherMois());
surClic('btn-verrouiller', masquerMontants);
surEvenement('version-mois', 'change', () => afficherMois());
for (const champ of ['mois', 'annee-mois']) {
  surEvenement(champ, 'change', () => { apercuMois(); afficherMois(); });
}

/* -------------------- Tableau mensuel consultable a l'ecran --------------- */

let moisAffiche = null;

const versionDemandee = () => ($('version-mois') ? $('version-mois').value : 'public');
const parametresMois = () => {
  const p = new URLSearchParams({
    annee: $('annee-mois').value,
    mois: $('mois').value,
    version: versionDemandee(),
  });
  return p;
};

/**
 * La version direction porte les salaires : elle demande le code du directeur,
 * meme si sa session est deja ouverte. Une session dure trente jours ; un
 * salaire affiche sur un ecran partage n'attend pas si longtemps.
 */
async function afficherMois() {
  const zone = $('tableau-mois');
  if (!zone) return;

  const parametres = parametresMois();
  if (versionDemandee() === 'direction') {
    const billet = await demanderBillet();
    if (billet === null) {
      $('version-mois').value = 'public';
      return afficherMois();
    }
    if (billet) parametres.set('billet', billet);
  }

  try {
    moisAffiche = await API.get(`/api/mois?${parametres}`);
  } catch (erreur) {
    message(erreur.message, 'erreur');
    return;
  }
  majBlocPanier();
  zone.innerHTML = gabaritTableauMois(moisAffiche);
}

/**
 * Ouvre les montants. `ouvrirLesMontants` sait laquelle des deux mecaniques
 * s'applique — la phrase du coffre, ou le code contre un billet — et rend soit
 * `true` (seance ouverte, l'en-tete part tout seul), soit le billet a glisser
 * en parametre, soit `false` si l'on a renonce.
 */
async function demanderBillet() {
  const ouvert = await ouvrirLesMontants();
  if (!ouvert) return null;
  return ouvert === true ? '' : ouvert;
}

function masquerMontants() {
  $('version-mois').value = 'public';
  message('Montants masqués.', 'succes', 2500);
  return afficherMois();
}

function majBlocPanier() {
  const direction = moisAffiche && moisAffiche.version === 'direction';
  const bloc = $('bloc-panier');
  if (bloc) bloc.classList.toggle('masque', !direction);
}

async function telechargerMois() {
  const version = versionDemandee();
  const parametres = new URLSearchParams({
    annee: $('annee-mois').value,
    mois: $('mois').value,
    version,
  });

  if (version === 'direction') {
    const billet = await demanderBillet();
    if (billet === null) return;
    if (billet) parametres.set('billet', billet);
  }
  try {
    await telechargerFichier(`/api/export/mois.xlsx?${parametres}`);
  } catch (e) {
    message(e.message, 'erreur');
  }
}

const euros = (v) => `${(Number(v) || 0).toFixed(2).replace('.', ',')} €`;
const nombre = (v) => (Number(v) ? String(Math.round(Number(v) * 100) / 100).replace('.', ',') : '—');

function gabaritTableauMois(mois) {
  if (!mois.salaries.length) {
    return '<p class="vide">Aucune fiche validée sur les six semaines de ce mois.</p>';
  }
  const direction = mois.version === 'direction';

  const entetes = [
    'Salarié', ...mois.semaines.map((s) => `S${s.semaine}`),
    'Total', '25 %', '50 %', 'Route', 'Trajet', 'Amiante 1', 'Amiante 2',
    'Paniers', 'GD 72', 'GD 80', 'Fériés',
    ...(direction ? ['Taux', 'S. brut', 'H. sup', 'Fériés €', 'Primes', 'Paniers €', 'GD €', 'Trajet €', 'Total brut', 'Net estimé'] : []),
  ];

  const lignes = mois.salaries
    .map((s) => {
      const base = [
        `<td>${echapper(`${s.nom} ${s.prenom}`.trim())}</td>`,
        ...s.semaines.map((m) => `<td class="num">${m ? versTexte(m) : '—'}</td>`),
        `<td class="num total">${versTexte(s.minutesMois)}</td>`,
        `<td class="num">${s.minutes25 ? versTexte(s.minutes25) : '—'}</td>`,
        `<td class="num">${s.minutes50 ? versTexte(s.minutes50) : '—'}</td>`,
        `<td class="num">${s.minutesRoute ? versTexte(s.minutesRoute) : '—'}</td>`,
        `<td class="num">${s.minutesTrajet ? versTexte(s.minutesTrajet) : '—'}</td>`,
        `<td class="num">${nombre(s.joursAmiante1)}</td>`,
        `<td class="num">${nombre(s.joursAmiante2)}</td>`,
        `<td class="num">${nombre(s.joursPanier)}</td>`,
        `<td class="num">${nombre(s.joursGD72)}</td>`,
        `<td class="num">${nombre(s.joursGD80)}</td>`,
        `<td class="num" title="${s.minutesFeries ? `dont ${versTexte(s.minutesFeries)} travaillées` : 'aucune heure travaillée'}">${nombre(s.joursFeries)}</td>`,
      ];
      if (!direction) return `<tr>${base.join('')}</tr>`;

      // Sans taux horaire, rien n'est calcule : une case vide vaut mieux qu'un
      // salaire faux, et le manque doit se voir.
      if (s.tauxManquant) {
        return `<tr>${base.join('')}<td class="num manque" colspan="10">Taux horaire à renseigner dans Paramètres</td></tr>`;
      }
      return `<tr>${base.join('')}
        <td class="num">${euros(s.tauxHoraire)}</td>
        <td class="num">${euros(s.salaireBrut)}</td>
        <td class="num">${euros(s.heuresSupBrut)}</td>
        <td class="num" title="Heures travaillées un jour férié, payées double">${euros(s.feries)}</td>
        <td class="num">${euros(s.primeAmiante)}</td>
        <td class="num">${euros(s.paniers)}</td>
        <td class="num">${euros(s.grandDeplacement)}</td>
        <td class="num">${euros(s.trajet)}</td>
        <td class="num total">${euros(s.totalBrut)}</td>
        <td class="num total">${euros(s.totalNet)}</td>
      </tr>`;
    })
    .join('');

  const cumul = (champ) => mois.salaries.reduce((t, s) => t + (Number(s[champ]) || 0), 0);
  const pied = direction
    ? `<tr class="cumul"><th colspan="${entetes.length - 2}">Masse salariale (net estimé)</th>
         <th class="num">${euros(cumul('totalBrut'))}</th>
         <th class="num">${euros(cumul('totalNet'))}</th></tr>`
    : `<tr class="cumul"><th>${mois.salaries.length} salarié(s)</th>
         <th class="num" colspan="${mois.semaines.length}"></th>
         <th class="num">${versTexte(cumul('minutesMois'))}</th>
         <th colspan="${entetes.length - mois.semaines.length - 3}"></th></tr>`;

  return `
    <p class="aide">
      ${direction
        ? 'Version direction — montants visibles. Ils se masquent seuls au bout de 20 minutes.'
        : 'Version publique — aucun montant, aucun taux horaire.'}
    </p>
    <p class="aide">
      ${direction
        ? 'Le « net estimé » est un ordre de grandeur — le taux du classeur appliqué au brut — '
          + 'et non un calcul de paie. Les taux appliqués sont ceux de ce mois-là : '
          + '<em>Paramètres ▸ Taux de la paie</em>.'
        : ''}
    </p>
    <p class="aide">
      Horaire de référence du mois (case « Mois » du classeur de paie) :
      <strong>${nombre(mois.heuresReference)} h</strong>
      — ${mois.joursOuvres} jours ouvrés × 7 h.
    </p>
    <div class="enveloppe-table">
      <table class="grille-mois">
        <thead><tr>${entetes.map((e) => `<th>${echapper(e)}</th>`).join('')}</tr></thead>
        <tbody>${lignes}</tbody>
        <tfoot>${pied}</tfoot>
      </table>
    </div>`;
}

/** Annonce ce que contiendra le tableau mensuel avant de le telecharger. */
async function apercuMois() {
  const zone = $('apercu-mois');
  try {
    const a = await API.get(`/api/export/mois-apercu?annee=${$('annee-mois').value}&mois=${$('mois').value}`);
    const semaines = a.semaines.map((s) => `S${s.semaine}`).join(', ');
    zone.textContent = a.nbSalaries
      ? `${a.nbSalaries} salarié(s), ${versTexte(a.minutes)} au total — semaines ${semaines}.`
      : `Aucune fiche validée sur les semaines ${semaines}.`;
    zone.style.color = a.nbSalaries ? '' : 'var(--orange)';
  } catch (e) {
    zone.textContent = e.message;
    zone.style.color = 'var(--rouge)';
  }
}

function preparerSelecteurMois() {
  const courant = new Date();
  $('mois').innerHTML = Regles.MOIS
    .map((nom, i) => `<option value="${i + 1}"${i === courant.getMonth() ? ' selected' : ''}>${nom}</option>`)
    .join('');
  $('annee-mois').value = courant.getFullYear();
}

demarrer().catch((e) => message(e.message, 'erreur'));
