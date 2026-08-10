/*
 * Calendrier mensuel du personnel non productif.
 *
 * Administratif, encadrement, atelier : ceux qui ne figurent sur aucune fiche de
 * chantier. Leur regle est plus simple — 7 h par jour ouvre — et c'est ce qui
 * commande l'ecran : un mois ordinaire ne demande aucune saisie. Seuls les
 * ecarts se declarent, d'un clic sur la case du jour.
 *
 * Le calendrier des equipes montre ce qui s'est passe ; celui-ci sert aussi a le
 * dire. D'ou une case cliquable, ce que l'autre n'a pas.
 */

let reference = null;
let mois = null;

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

async function demarrer() {
  const { utilisateur } = await API.get('/api/moi');
  if (utilisateur.role !== 'directeur') {
    location.href = '/chef.html';
    return;
  }
  definirRole('directeur');

  reference = await API.get('/api/reference');
  $('entete-nom').textContent = `${utilisateur.nom} · version ${reference.version}`;

  const maintenant = new Date();
  $('mois').innerHTML = Regles.MOIS.map(
    (nom, i) => `<option value="${i + 1}"${i === maintenant.getMonth() ? ' selected' : ''}>${nom}</option>`
  ).join('');
  $('annee').value = maintenant.getFullYear();

  await charger();
}

surClic('btn-retour', () => { location.href = '/directeur.html'; });
surClic('btn-quitter', deconnexion);
surClic('btn-precedent', () => decalerMois(-1));
surClic('btn-suivant', () => decalerMois(1));
for (const champ of ['mois', 'annee']) surEvenement(champ, 'change', charger);

function decalerMois(pas) {
  let m = Number($('mois').value) + pas;
  let a = Number($('annee').value);
  if (m < 1) { m = 12; a -= 1; }
  if (m > 12) { m = 1; a += 1; }
  $('mois').value = m;
  $('annee').value = a;
  charger();
}

/* -------------------------------- Chargement ------------------------------ */

async function charger() {
  const zone = $('calendrier-np');
  zone.innerHTML = '<p class="aide">Chargement…</p>';
  try {
    mois = await API.get(`/api/non-productif?annee=${$('annee').value}&mois=${$('mois').value}`);
  } catch (e) {
    zone.innerHTML = `<p class="vide">${echapper(e.message)}</p>`;
    return;
  }
  afficher();
}

const ETIQUETTES_ETAT = {
  travaille: 'Journée ordinaire — 7 h',
  partiel: 'Heures particulières',
  gd: 'Grand déplacement',
  absence: 'Absence déclarée',
  conge: 'Congé enregistré',
  weekend: 'Week-end',
};

const libelleCode = (code) => {
  const trouve = (mois.codesAbsence || []).find((c) => c.code === code)
    || (mois.motifsConge || []).find((c) => c.code === code);
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

  if (!mois.lignes.length) {
    zone.innerHTML =
      '<p class="vide">Aucune personne enregistrée. Ajoutez-les depuis ' +
      '<strong>Paramètres ▸ Personnel non productif</strong>.</p>';
    $('table-totaux').querySelector('tbody').innerHTML = '';
    $('resume-mois').textContent = '';
    return;
  }

  const JOURS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  const enteteJours = mois.jours
    .map(
      (j) => `<th class="jour-entete${j.ouvre ? '' : ' weekend'}">
        <span class="lettre">${JOURS[j.jourSemaine]}</span>
        <span class="numero">${j.quantieme}</span>
      </th>`
    )
    .join('');

  const rangs = mois.lignes
    .map((ligne) => {
      const cases = ligne.jours
        .map((c) => {
          const titre = `${ligne.nom} ${ligne.prenom} — ${c.quantieme}/${String(mois.mois).padStart(2, '0')}\n${
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

  $('resume-mois').textContent =
    `${mois.lignes.length} personne(s) · ${mois.joursOuvres} jours ouvrés · ` +
    `${mois.heuresReference} h de référence pour le mois.`;

  afficherTotaux();
}

function afficherTotaux() {
  const detail = (ligne) =>
    Object.entries(ligne.absences)
      .map(([code, n]) => `${code} ×${n}`)
      .join(', ') || '—';

  $('table-totaux').querySelector('tbody').innerHTML = mois.lignes
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
  const ligne = mois.lignes.find((l) => String(l.id) === String(salarieId));
  if (!ligne) return;
  const jour = ligne.jours.find((j) => j.date === date);

  const codes = (mois.codesAbsence || [])
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

      <div class="rangee" style="margin-top:14px">
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
      annee: Number($('annee').value),
      mois: Number($('mois').value),
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
