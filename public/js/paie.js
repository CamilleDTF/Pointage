/*
 * La paie du mois : un ecran, la ou il y en avait quatre.
 *
 * « Tableau mensuel », « Non productif », « Paie non productif », plus un
 * detour par Parametres pour inscrire les gens. Trois noms qui se ressemblent,
 * et rien qui dise lequel ouvrir ni dans quel ordre. Le quatrieme n'etait meme
 * pas un ecran : il n'affichait rien tant qu'on n'avait pas saisi le code, puis
 * montrait le tableau du troisieme avec une colonne de plus.
 *
 * Ici : le mois choisi une fois, deux onglets pour les deux populations, un
 * seul interrupteur pour les montants, un seul bouton de telechargement.
 *
 * Le code de rendu des tableaux vient tel quel des trois ecrans precedents —
 * meme grille, memes colonnes, memes calculs. Ce qui change est ce qui les
 * entoure.
 */

let reference = null;
let mois = null;          // le tableau des chantiers, tel que rendu par /api/mois
let moisNP = null;        // la grille du personnel non productif
let paieNP = null;        // ses montants, quand la seance est ouverte
let onglet = 'chantier';

const $ = (id) => document.getElementById(id);

function surEvenement(id, evenement, action) {
  const element = $(id);
  if (!element) {
    console.warn(`Element "${id}" absent de la page : fonction indisponible, le reste fonctionne.`);
    return;
  }
  element.addEventListener(evenement, action);
}
const surClic = (id, action) => surEvenement(id, 'click', action);

/* L'annee et le mois affiches. Ils ne vivent que la, et les fleches les bougent. */
const maintenant = new Date();
let annee = maintenant.getFullYear();
let numeroMois = maintenant.getMonth() + 1;

async function demarrer() {
  const { utilisateur } = await API.get('/api/moi');
  if (utilisateur.role !== 'directeur') {
    location.href = utilisateur.role === 'admin' ? '/parametres.html' : '/chef.html';
    return;
  }
  definirRole('directeur');
  reference = await API.get('/api/reference');
  $('entete-nom').textContent = `${utilisateur.nom} · version ${reference.version}`;
  await charger();

  // Venir de « Non productif » ouvre directement cet onglet-la.
  if (location.hash === '#nonproductif') {
    document.querySelector('#onglets-paie .onglet[data-onglet="nonproductif"]').click();
  }
}

surClic('btn-retour', () => { location.href = '/directeur.html'; });
surClic('btn-quitter', deconnexion);
surClic('btn-conges', () => { location.href = '/calendrier.html'; });
surClic('btn-precedent', () => decalerMois(-1));
surClic('btn-suivant', () => decalerMois(1));

function decalerMois(pas) {
  numeroMois += pas;
  if (numeroMois < 1) { numeroMois = 12; annee -= 1; }
  if (numeroMois > 12) { numeroMois = 1; annee += 1; }
  charger();
}

surEvenement('onglets-paie', 'click', (e) => {
  const bouton = e.target.closest('.onglet');
  if (!bouton) return;
  onglet = bouton.dataset.onglet;
  document.querySelectorAll('#onglets-paie .onglet').forEach((o) => {
    o.classList.toggle('actif', o.dataset.onglet === onglet);
  });
  $('panneau-chantier').classList.toggle('masque', onglet !== 'chantier');
  $('panneau-nonproductif').classList.toggle('masque', onglet !== 'nonproductif');
  majEtatDuMois();
});

/*
 * L'avertissement sur les fiches ne vaut que pour le personnel de chantier.
 *
 * Le personnel non productif ne remplit aucune fiche : ses heures sont posees
 * ici, a 7 h par jour ouvre. Lui annoncer que « 4 fiches ne sont pas validees »
 * revenait a le rendre responsable d'un retard qui ne le regarde pas, et a
 * faire douter d'un tableau qui, lui, etait complet.
 */
function majEtatDuMois() {
  $('etat-mois').classList.toggle('masque', onglet !== 'chantier');
}

/*
 * Un seul interrupteur pour les deux onglets.
 *
 * Il y en avait deux, exprimes differemment : un menu « Version » d'un cote, un
 * bouton « Afficher les montants » de l'autre. Ils ouvraient pourtant la meme
 * chose, et le second n'existait que pour cela.
 */
const montantsOuverts = () => Paie.ouverte();

surClic('btn-montants', async () => {
  if (montantsOuverts()) {
    Paie.fermer();
    message('Montants masqués.', 'succes', 2500);
    return charger();
  }
  if (await ouvrirLesMontants()) await charger();
});

function majBoutonMontants() {
  $('btn-montants').textContent = montantsOuverts() ? 'Masquer les montants' : 'Afficher les montants';
}

surClic('btn-telecharger', async () => {
  if (!(await ouvrirLesMontants())) return;
  const p = new URLSearchParams({ annee, mois: numeroMois });
  const url = onglet === 'chantier'
    ? `/api/export/mois.xlsx?${p}&version=direction`
    : `/api/export/non-productif.xlsx?${p}`;
  try {
    await telechargerFichier(url);
  } catch (e) {
    message(e.message, 'erreur');
  }
});

/* ------------------------------- Le chargement ---------------------------- */

async function charger() {
  $('quand-mois').textContent = `${Regles.MOIS[numeroMois - 1]} ${annee}`;
  majBoutonMontants();

  const p = new URLSearchParams({ annee, mois: numeroMois });
  const version = montantsOuverts() ? 'direction' : 'public';

  try {
    mois = await API.get(`/api/mois?${p}&version=${version}`);
  } catch (e) {
    // Coffre ferme : on retombe sur la version publique plutot que de ne rien
    // montrer. Les heures ne sont pas un secret.
    mois = await API.get(`/api/mois?${p}&version=public`).catch(() => null);
  }

  try {
    moisNP = await API.get(`/api/non-productif?${p}`);
    paieNP = montantsOuverts() ? await API.get(`/api/non-productif/paie?${p}`).catch(() => null) : null;
  } catch {
    moisNP = null;
    paieNP = null;
  }

  afficherEtatDuMois();
  majEtatDuMois();
  afficherChantier();
  afficherNonProductif();
}

/*
 * L'etat du mois, avant tout chiffre.
 *
 * Le tableau ne compte QUE les fiches validees — c'est juste, et c'est le
 * piege : rien ne le disait, et on transmettait un mois ampute sans le voir.
 */
async function afficherEtatDuMois() {
  const zone = $('etat-mois');
  try {
    const a = await API.get(`/api/export/mois-apercu?annee=${annee}&mois=${numeroMois}`);
    const manquantes = Number(a.nonValidees) || 0;
    zone.innerHTML = `<div class="etat-paie${manquantes ? '' : ' fait'}">
      <span class="signe">${manquantes ? '▲' : '✓'}</span>
      <span class="texte">
        <strong>${manquantes
          ? `${manquantes} fiche(s) de ce mois ne sont pas encore validées.`
          : 'Toutes les fiches du mois sont validées.'}</strong>
        <span class="precision">${manquantes
          ? 'Elles ne sont pas comptées dans les tableaux ci-dessous.'
          : `${a.nbSalaries} salarié(s), ${versTexte(a.minutes)} comptées. Rien ne bloque la transmission au cabinet.`}</span>
      </span>
      ${manquantes ? '<button class="petit" onclick="location.href=\'/directeur.html\'">Les vérifier</button>' : ''}
    </div>`;
  } catch (e) {
    zone.innerHTML = `<p class="aide" style="color:var(--rouge)">${echapper(e.message)}</p>`;
  }
}

function afficherChantier() {
  if (!mois) {
    $('tableau-mois').innerHTML = '<p class="vide">Mois indisponible.</p>';
    return;
  }
  $('compte-chantier').textContent = `· ${mois.salaries.length}`;
  // Le gabarit annonce deja la version et l'horaire de reference : le repeter
  // au-dessus faisait deux fois la meme phrase, a deux lignes d'intervalle.
  $('aide-chantier').textContent = 'Les heures viennent des fiches de pointage validées.';
  $('tableau-mois').innerHTML = gabaritTableauMois(mois);
}

function afficherNonProductif() {
  if (!moisNP) {
    $('calendrier-np').innerHTML = '<p class="vide">Aucune personne enregistrée dans le personnel non productif.</p>';
    $('totaux-np').innerHTML = '';
    $('compte-np').textContent = '';
    return;
  }
  $('compte-np').textContent = `· ${moisNP.lignes.length}`;
  afficher();
  afficherTotaux();
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

/* La legende de la grille, et l'infobulle de chaque case. */
const ETIQUETTES_ETAT = {
  travaille: 'Journée ordinaire — 7 h',
  partiel: 'Heures particulières',
  gd: 'Grand déplacement',
  absence: 'Absence déclarée',
  conge: 'Congé enregistré',
  weekend: 'Week-end',
};

const libelleCode = (code) => {
  const trouve = (moisNP.codesAbsence || []).find((c) => c.code === code)
    || (moisNP.motifsConge || []).find((c) => c.code === code);
  return trouve ? `${code} — ${trouve.libelle}` : code;
};

/** Ce qu'on lit dans la case : le moins possible, mais jamais rien d'ambigu. */
function contenuCase(c) {
  if (c.etat === 'absence' || c.etat === 'conge') return echapper(c.code || '?');
  if (c.etat === 'gd') return echapper(c.gd);
  if (c.etat === 'partiel') return echapper(versTexte(c.minutes));
  return '';
}

function afficher() {
  const zone = $('calendrier-np');
  if (!mois) return;

  if (!moisNP.lignes.length) {
    zone.innerHTML =
      '<p class="vide">Aucune personne enregistrée. Ajoutez-les depuis ' +
      '<strong>Paramètres ▸ Personnel non productif</strong>.</p>';
    $('totaux-np').innerHTML = '';
    $('resume-np').textContent = '';
    return;
  }

  const JOURS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  const enteteJours = moisNP.jours
    .map(
      (j) => `<th class="jour-entete${j.ouvre ? '' : ' weekend'}">
        <span class="lettre">${JOURS[j.jourSemaine]}</span>
        <span class="numero">${j.quantieme}</span>
      </th>`
    )
    .join('');

  const rangs = moisNP.lignes
    .map((ligne) => {
      const cases = ligne.jours
        .map((c) => {
          const titre = `${ligne.nom} ${ligne.prenom} — ${c.quantieme}/${String(moisNP.mois).padStart(2, '0')}\n${
            ETIQUETTES_ETAT[c.etat]
          }${c.code ? `\n${libelleCode(c.code)}` : ''}${c.minutes ? `\n${versTexte(c.minutes)}` : ''}`;
          return `<td class="case-jour ${c.etat}" title="${echapper(titre)}"
                      data-salarie="${ligne.id}" data-date="${c.date}" style="cursor:pointer">${contenuCase(c)}</td>`;
        })
        .join('');

      return `<tr>
        <th class="nom-personne">${echapper(`${ligne.nom} ${ligne.prenom}`.trim())}</th>
        ${cases}
        <td class="total-mois">${versTexte(ligne.minutes)}</td>
      </tr>`;
    })
    .join('');

  zone.innerHTML = `
    <div class="calendrier-mois">
      <table>
        <thead>
          <tr><th class="nom-personne"></th>${enteteJours}<th class="total-mois">Total</th></tr>
        </thead>
        <tbody>${rangs}</tbody>
      </table>
    </div>`;

  for (const cellule of zone.querySelectorAll('.case-jour')) {
    cellule.addEventListener('click', () => ouvrirJour(cellule.dataset.salarie, cellule.dataset.date));
  }

  $('legende-np').innerHTML = ['travaille', 'partiel', 'gd', 'absence', 'conge', 'weekend']
    .map((etat) => `<span><span class="case-jour ${etat}"></span> ${echapper(ETIQUETTES_ETAT[etat])}</span>`)
    .join('');

  $('resume-np').textContent =
    `${moisNP.lignes.length} personne(s) · ${moisNP.joursOuvres} jours ouvrés · ` +
    `${moisNP.heuresReference} h de référence pour le mois.`;

  afficherTotaux();
}

function afficherTotaux() {
  const detail = (ligne) =>
    Object.entries(ligne.absences)
      .map(([code, n]) => `${code} ×${n}`)
      .join(', ') || '—';

  $('totaux-np').innerHTML = moisNP.lignes
    .map(
      (ligne) => `<tr>
        <td>${echapper(ligne.nom)}</td>
        <td>${echapper(ligne.prenom)}</td>
        <td class="num">${ligne.joursTravailles}</td>
        <td class="num">${echapper(versTexte(ligne.minutes))}</td>
        <td class="num" title="${echapper(detail(ligne))}">${ligne.joursAbsence || '—'}</td>
        <td class="num">${ligne.joursGD72 || '—'}</td>
        <td class="num">${ligne.joursGD80 || '—'}</td>
        <td class="num">
          ${ligne.montantPrimes ? `${ligne.montantPrimes.toFixed(2)} €` : '—'}
          <button class="petit" style="margin-left:6px" onclick="ajouterPrime(${ligne.id}, '${echapper(
            `${ligne.nom} ${ligne.prenom}`.trim()
          )}')">+</button>
        </td>
        <td>${
          ligne.primes.length
            ? ligne.primes
                .map(
                  (p) => `<div>${echapper(p.libelle || 'Prime')} — ${Number(p.montant).toFixed(2)} €
                    <button class="petit" onclick="supprimerPrime(${p.id})">✕</button></div>`
                )
                .join('')
            : ''
        }</td>
      </tr>`
    )
    .join('');
}

/* ------------------------------ Saisie d'un jour --------------------------- */

/*
 * Une fenetre plutot qu'une saisie en place : une journee porte trois choses —
 * une absence, un grand deplacement, des heures — et un menu deroulant dans une
 * case de vingt pixels serait illisible sur un mois de trente et un jours.
 */
function ouvrirJour(salarieId, date) {
  const ligne = moisNP.lignes.find((l) => String(l.id) === String(salarieId));
  if (!ligne) return;
  const jour = ligne.jours.find((j) => j.date === date);

  const codes = (moisNP.codesAbsence || [])
    .map((c) => `<option value="${c.code}"${c.code === jour.code ? ' selected' : ''}>${c.code} — ${echapper(c.libelle)}</option>`)
    .join('');

  const fenetre = document.createElement('div');
  fenetre.className = 'fenetre';
  fenetre.innerHTML = `
    <div class="fenetre-corps">
      <h2>${echapper(`${ligne.nom} ${ligne.prenom}`.trim())} — ${echapper(dateFrancaise(date))}</h2>
      <p class="aide">
        Sans rien déclarer, la journée vaut <strong>7 h</strong> si elle est ouvrée. Renseignez
        seulement ce qui s'en écarte.
      </p>

      <div class="grille deux">
        <div>
          <label for="j-code">Absence</label>
          <select id="j-code"><option value="">— aucune —</option>${codes}</select>
        </div>
        <div>
          <label for="j-gd">Grand déplacement</label>
          <select id="j-gd">
            <option value="">— aucun —</option>
            <option value="72"${jour.gd === '72' ? ' selected' : ''}>GD 72</option>
            <option value="80"${jour.gd === '80' ? ' selected' : ''}>GD 80</option>
          </select>
        </div>
        <div>
          <label for="j-heures">Heures travaillées</label>
          <input id="j-heures" value="${jour.etat === 'travaille' ? '' : echapper(versSaisie(jour.minutes))}"
                 placeholder="7h00 par défaut" inputmode="decimal">
        </div>
      </div>

      <div class="rangee detache">
        <button class="petit" type="button" data-effacer>Revenir à l'ordinaire</button>
        <span class="pousse"></span>
        <button class="petit" type="button" data-fermer>Annuler</button>
        <button class="petit principal" type="button" data-valider>Enregistrer</button>
      </div>
    </div>`;
  document.body.appendChild(fenetre);

  const fermer = () => fenetre.remove();
  fenetre.querySelector('[data-fermer]').addEventListener('click', fermer);

  const envoyer = async (corps) => {
    try {
      await API.put('/api/non-productif/jour', { salarie_id: ligne.id, date, ...corps });
      fermer();
      await charger();
    } catch (e) {
      message(e.message, 'erreur');
    }
  };

  // Effacer plutot que declarer « rien » : l'absence de ligne est deja la facon
  // dont on dit qu'il ne s'est rien passe.
  fenetre.querySelector('[data-effacer]').addEventListener('click', () => envoyer({ code: '', gd: '', minutes: null }));

  fenetre.querySelector('[data-valider]').addEventListener('click', () => {
    const saisie = fenetre.querySelector('#j-heures').value.trim();
    envoyer({
      code: fenetre.querySelector('#j-code').value,
      gd: fenetre.querySelector('#j-gd').value,
      minutes: saisie === '' ? undefined : versMinutes(saisie),
    });
  });
}

/* --------------------------------- Primes ---------------------------------- */

window.ajouterPrime = async (salarieId, nom) => {
  const libelle = prompt(`Motif de la prime pour ${nom} :`, '');
  if (libelle === null) return;
  const montant = prompt('Montant en euros :', '');
  if (montant === null) return;

  try {
    await API.post('/api/non-productif/primes', {
      salarie_id: salarieId,
      annee,
      mois: numeroMois,
      libelle,
      montant: Number(String(montant).replace(',', '.')),
    });
    await charger();
    message('Prime enregistrée.', 'succes');
  } catch (e) {
    message(e.message, 'erreur');
  }
};

window.supprimerPrime = async (id) => {
  if (!confirm('Supprimer cette prime ?')) return;
  try {
    await API.supprimer(`/api/non-productif/primes/${id}`);
    await charger();
  } catch (e) {
    message(e.message, 'erreur');
  }
};
demarrer().catch((e) => message(e.message, 'erreur'));
