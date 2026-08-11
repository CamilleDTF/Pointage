/*
 * Tableau mensuel de paie du personnel non productif.
 *
 * Il est a part, et pas par commodite : ces salaries n'ont pas de fiche de
 * chantier, donc pas de semaines a additionner, pas de zone amiante, pas de
 * panier. Les melanger au tableau des chantiers aurait donne un tableau a moitie
 * vide ou chaque colonne aurait demande « pour qui ? ».
 *
 * Tout ce qui est ici vaut de l'argent : l'ecran s'ouvre donc vide, et chaque
 * affichage comme chaque telechargement redemande le code du directeur. Les
 * heures, elles, restent consultables sans code sur le calendrier.
 */

let paie = null;

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

  const reference = await API.get('/api/reference');
  $('entete-nom').textContent = `${utilisateur.nom} · version ${reference.version}`;

  const courant = new Date();
  $('mois').innerHTML = Regles.MOIS
    .map((nom, i) => `<option value="${i + 1}"${i === courant.getMonth() ? ' selected' : ''}>${nom}</option>`)
    .join('');
  $('annee').value = courant.getFullYear();
  await apercu();
}

surClic('btn-retour', () => { location.href = '/directeur.html'; });
surClic('btn-calendrier-np', () => { location.href = '/non-productif.html'; });
surClic('btn-quitter', deconnexion);
surClic('btn-voir', afficher);
surClic('btn-export', telecharger);
surClic('btn-masquer', masquer);
// Changer de mois referme les montants : ils ne suivent pas d'un mois a l'autre
// sans que le code soit redonne.
for (const champ of ['mois', 'annee']) surEvenement(champ, 'change', () => { masquer(); apercu(); });

/** Ce que contient le mois, sans un seul montant : lisible sans code. */
async function apercu() {
  const zone = $('apercu');
  try {
    const m = await API.get(`/api/non-productif?annee=${$('annee').value}&mois=${$('mois').value}`);
    zone.textContent = m.lignes.length
      ? `${m.lignes.length} personne(s) · ${m.joursOuvres} jours ouvrés · ${m.heuresReference} h de référence.`
      : 'Aucune personne enregistrée dans le personnel non productif.';
    zone.style.color = m.lignes.length ? '' : 'var(--orange)';
  } catch (e) {
    zone.textContent = e.message;
    zone.style.color = 'var(--rouge)';
  }
}

/**
 * Le code s'echange contre un billet a usage unique, valable deux minutes, que
 * le serveur consomme des la premiere requete : un ecran laisse ouvert ne
 * redonne jamais acces aux salaires.
 */
async function demanderBillet() {
  const pin = prompt('Les montants demandent votre code directeur :');
  if (!pin) return null;
  try {
    const { billet } = await API.post('/api/paie/billet', { pin });
    return billet;
  } catch (e) {
    message(e.message, 'erreur');
    return null;
  }
}

async function afficher() {
  const billet = await demanderBillet();
  if (!billet) return;

  const parametres = new URLSearchParams({ annee: $('annee').value, mois: $('mois').value, billet });
  try {
    paie = await API.get(`/api/non-productif/paie?${parametres}`);
  } catch (e) {
    message(e.message, 'erreur');
    return;
  }
  $('tableau-paie').innerHTML = gabarit(paie);
}

function masquer() {
  if (!paie) return;
  paie = null;
  $('tableau-paie').innerHTML =
    '<p class="vide">Montants masqués. Cliquez sur <strong>Afficher les montants</strong> ' +
    'pour les rouvrir.</p>';
}

async function telecharger() {
  const billet = await demanderBillet();
  if (!billet) return;
  const parametres = new URLSearchParams({ annee: $('annee').value, mois: $('mois').value, billet });
  window.location.href = `/api/export/non-productif.xlsx?${parametres}`;
}

const euros = (v) => `${(Number(v) || 0).toFixed(2).replace('.', ',')} €`;

function gabarit(mois) {
  if (!mois.salaries.length) {
    return (
      '<p class="vide">Aucune personne enregistrée. Ajoutez-les depuis ' +
      '<strong>Paramètres ▸ Personnel non productif</strong>.</p>'
    );
  }

  const entetes = [
    'Salarié', 'Jours', 'Heures', 'Absences', '25 %', '50 %', 'GD 72', 'GD 80',
    'Taux', 'S. brut', 'H. sup', 'Primes', 'GD €', 'EDENRED', 'Total brut', 'Net estimé',
  ];

  const lignes = mois.salaries
    .map((s) => {
      const detail = Object.entries(s.absences || {})
        .map(([code, n]) => `${code} ×${n}`)
        .join(', ');
      const base = [
        `<td>${echapper(`${s.nom} ${s.prenom}`.trim())}</td>`,
        `<td class="num">${s.joursTravailles}</td>`,
        `<td class="num total">${versTexte(s.minutes)}</td>`,
        `<td class="num" title="${echapper(detail)}">${s.joursAbsence || '—'}</td>`,
        `<td class="num">${s.minutes25 ? versTexte(s.minutes25) : '—'}</td>`,
        `<td class="num">${s.minutes50 ? versTexte(s.minutes50) : '—'}</td>`,
        `<td class="num">${s.joursGD72 || '—'}</td>`,
        `<td class="num">${s.joursGD80 || '—'}</td>`,
      ];

      // Sans taux horaire, rien n'est calcule : une case vide vaut mieux qu'un
      // salaire faux, et le manque doit se voir.
      if (s.tauxManquant) {
        return `<tr>${base.join('')}
          <td class="num manque" colspan="8">Taux horaire à renseigner dans Paramètres</td></tr>`;
      }

      const primes = s.detailPrimes && s.detailPrimes.length
        ? s.detailPrimes.map((p) => `${p.libelle || 'Prime'} : ${Number(p.montant).toFixed(2)} €`).join('\n')
        : '';
      return `<tr>${base.join('')}
        <td class="num">${euros(s.tauxHoraire)}</td>
        <td class="num">${euros(s.salaireBrut)}</td>
        <td class="num">${euros(s.heuresSupBrut)}</td>
        <td class="num" title="${echapper(primes)}">${euros(s.primes)}</td>
        <td class="num">${euros(s.grandDeplacement)}</td>
        <td class="num" title="${s.joursTravailles} jour(s) travaillé(s)">${euros(s.edenred)}</td>
        <td class="num total">${euros(s.totalBrut)}</td>
        <td class="num total">${euros(s.totalNet)}</td>
      </tr>`;
    })
    .join('');

  const cumul = (champ) => mois.salaries.reduce((t, s) => t + (Number(s[champ]) || 0), 0);
  const pied = `<tr class="cumul">
      <th colspan="${entetes.length - 2}">${mois.salaries.length} personne(s) — masse salariale (net estimé)</th>
      <th class="num">${euros(cumul('totalBrut'))}</th>
      <th class="num">${euros(cumul('totalNet'))}</th>
    </tr>`;

  return `
    <p class="aide">
      Horaire de référence du mois : <strong>${mois.heuresReference} h</strong>
      — ${mois.joursOuvres} jours ouvrés × 7 h. Le salaire de base est mensualisé à 151,67 h.
    </p>
    <p class="aide">
      Le grand déplacement est une indemnité : il se verse net. Les primes suivent le salaire.
      Ni prime amiante ni panier repas ici — ce personnel n'entre pas en zone —
      mais un <strong>titre-restaurant par jour travaillé</strong>. Le
      « net estimé » est un ordre de grandeur, pas un calcul de paie ; les taux appliqués
      sont ceux de ce mois-là (<em>Paramètres ▸ Taux de la paie</em>).
    </p>
    <div class="enveloppe-table">
      <table class="grille-mois">
        <thead><tr>${entetes.map((e) => `<th>${echapper(e)}</th>`).join('')}</tr></thead>
        <tbody>${lignes}</tbody>
        <tfoot>${pied}</tfoot>
      </table>
    </div>`;
}

demarrer().catch((e) => message(e.message, 'erreur'));
