/*
 * Ecran du conducteur de travaux, ouvert depuis le lien recu par courriel.
 *
 * Le seul ecran de l'application qui fonctionne sans compte : le conducteur
 * arrive avec un jeton signe qui ne donne acces qu'a une fiche, et seulement
 * tant qu'elle attend son visa.
 *
 * Rien n'est decide a l'ouverture, meme quand le lien porte `action=viser` :
 * le parametre ne fait que mettre en avant le bouton correspondant. Une messagerie
 * d'entreprise visite les liens de ses courriels pour les analyser ; si un GET
 * pouvait viser une fiche, l'antivirus viserait a la place du conducteur.
 */

const $ = (id) => document.getElementById(id);

const parametres = new URLSearchParams(location.search);
const JETON = parametres.get('jeton') || '';
const ACTION = parametres.get('action') || '';

let fiche = null;
let reference = null;

async function demarrer() {
  if (!JETON) return afficherErreur('Lien incomplet : il manque son identifiant.');

  try {
    const reponse = await API.get(`/api/visa/${encodeURIComponent(JETON)}`);
    fiche = reponse.fiche;
    reference = reponse.reference;
  } catch (e) {
    return afficherErreur(e.message);
  }

  afficher();
}

function afficherErreur(texte) {
  $('bloc-erreur').hidden = false;
  $('texte-erreur').textContent = texte;
  $('entete-conducteur').textContent = '';
}

function afficher() {
  $('contenu').hidden = false;
  $('entete-conducteur').textContent = fiche.conducteur_nom || '';

  $('titre-fiche').textContent = `${fiche.chantier || 'Chantier non renseigné'}${fiche.ville ? ` — ${fiche.ville}` : ''}`;
  $('sous-titre').textContent =
    `${fiche.chef_nom} · semaine ${fiche.semaine} · du ${jourMois(fiche.dates[0])} au ${jourMois(fiche.dates[6])} ${fiche.annee}` +
    ` · ${versTexte(fiche.total_minutes)} au total`;

  const deja = fiche.visa_statut === 'vise';
  $('badge-visa').innerHTML = deja
    ? '<span class="etat validee">Déjà visée</span>'
    : '<span class="etat soumise">En attente de votre visa</span>';
  $('bloc-decision').classList.toggle('masque', deja);
  if (deja) {
    terminer('Fiche déjà visée', 'Vous avez déjà visé cette fiche : elle est partie à la direction.');
  }

  const zone = { PARIS: 'Paris', NICE: 'Nice', AUTRE: 'Hors Paris et Nice' }[fiche.zone_deplacement] || '—';
  $('entete-chantier').innerHTML = [
    ['Chantier', fiche.chantier],
    ['Ville', fiche.ville],
    ['Zone de déplacement', zone],
    ['Conducteur du véhicule', fiche.conducteur_vehicule],
    ['Véhicule', [fiche.type_vehicule, fiche.immatriculation].filter(Boolean).join(' · ')],
    ['Responsable de chantier', fiche.nom_responsable],
  ]
    .map(
      ([libelle, valeur]) => `
      <div>
        <label>${echapper(libelle)}</label>
        <div class="valeur-lecture">${echapper(valeur || '—')}</div>
      </div>`
    )
    .join('');

  construireGrille();

  const remarques = [
    fiche.observations_pointage && `Observations du chef d'équipe : ${fiche.observations_pointage}`,
    fiche.commentaire_responsable && `Commentaire du responsable de chantier : ${fiche.commentaire_responsable}`,
  ].filter(Boolean);
  $('observations').textContent = remarques.join(' — ');

  // Le lien du courriel met en avant le geste choisi, sans rien décider.
  if (ACTION === 'renvoyer' && !deja) {
    $('commentaire').focus();
    $('commentaire').placeholder = 'Indiquez ce qui doit être corrigé…';
  }
}

function construireGrille() {
  const entetes = fiche.dates
    .map(
      (iso, j) =>
        `<th class="num ${j >= 5 ? 'weekend' : ''}">${reference.joursCourts[j]}<br><small>${jourMois(iso)}</small></th>`
    )
    .join('');

  const libelleCode = (code) => {
    const trouve = reference.codesAbsence.find((c) => c.code === code);
    return trouve ? `${code} — ${trouve.libelle}` : code;
  };

  const rangs = fiche.lignes
    .map((ligne) => {
      const cellules = ligne.jours
        .map((jour, j) => {
          const contenu = jour.code_absence
            ? `<abbr title="${echapper(libelleCode(jour.code_absence))}">${echapper(jour.code_absence)}</abbr>`
            : jour.minutes || jour.saisi
              ? echapper(versTexte(jour.minutes))
              : '—';
          return `<td class="num ${j >= 5 ? 'weekend' : ''}">${contenu}</td>`;
        })
        .join('');

      return `<tr>
        <td>${echapper(ligne.nom_affiche)}</td>
        ${cellules}
        <td class="num total">${echapper(versTexte(ligne.total_minutes))}</td>
        <td class="num">${ligne.minutes_route ? echapper(versTexte(ligne.minutes_route)) : '—'}</td>
        <td class="num">${ligne.minutes_trajet ? echapper(versTexte(ligne.minutes_trajet)) : '—'}</td>
        <td class="num">${ligne.jours_zone || '—'}</td>
        <td class="num">${echapper(ligne.type_masque || '—')}</td>
        <td class="num">${ligne.nb_deplacement || '—'}</td>
        <td>${echapper(ligne.observation || '')}</td>
        <td class="num">${ligne.signature ? '✔' : '—'}</td>
      </tr>`;
    })
    .join('');

  $('grille').innerHTML = `
    <thead><tr>
      <th style="min-width:165px">Nom - Prénom</th>${entetes}
      <th class="num">Total<br>semaine</th><th class="num">Route<br>100%</th><th class="num">Trajet<br>50%</th>
      <th class="num">Jours<br>zone</th><th class="num">Masque</th><th class="num">Nb<br>dépl.</th>
      <th style="min-width:110px">Observations</th><th class="num">Signé</th>
    </tr></thead>
    <tbody>${rangs}</tbody>`;
}

/* --------------------------------- Décision -------------------------------- */

$('btn-viser').addEventListener('click', () => decider('viser'));
$('btn-renvoyer').addEventListener('click', () => decider('renvoyer'));

async function decider(decision) {
  const commentaire = $('commentaire').value.trim();
  if (decision === 'renvoyer' && !commentaire) {
    message('Indiquez ce qui doit être corrigé : le chef d’équipe a besoin de le savoir.', 'erreur');
    $('commentaire').focus();
    return;
  }

  const question =
    decision === 'viser'
      ? `Viser le pointage de ${fiche.chef_nom}, semaine ${fiche.semaine} ?`
      : `Renvoyer cette fiche à ${fiche.chef_nom} pour correction ?`;
  if (!confirm(question)) return;

  for (const bouton of ['btn-viser', 'btn-renvoyer']) $(bouton).disabled = true;

  try {
    const reponse = await API.post(`/api/visa/${encodeURIComponent(JETON)}/decision`, { decision, commentaire });
    fiche = reponse.fiche || fiche;
    if (decision === 'viser') {
      terminer('Fiche visée', 'Merci. Elle est transmise à la direction pour validation.');
    } else {
      terminer(
        'Fiche renvoyée',
        `${fiche.chef_nom} est invité à la corriger ; votre commentaire lui est transmis tel quel.`
      );
    }
  } catch (e) {
    for (const bouton of ['btn-viser', 'btn-renvoyer']) $(bouton).disabled = false;
    message(e.message, 'erreur');
  }
}

function terminer(titre, texte) {
  $('bloc-decision').classList.add('masque');
  $('bloc-resultat').classList.remove('masque');
  $('titre-resultat').textContent = titre;
  $('texte-resultat').textContent = `${texte} Vous pouvez fermer cette page.`;
  $('bloc-resultat').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

demarrer().catch((e) => afficherErreur(e.message));
