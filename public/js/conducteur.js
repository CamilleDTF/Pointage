/*
 * La page personnelle d'un conducteur de travaux : ses fiches en attente.
 *
 * Le courriel etait le seul maillon du circuit qui dependait de quelque chose
 * qu'on ne maitrise pas — un serveur d'envoi, un port ouvert dans un pare-feu,
 * une autorisation a demander. Cette adresse-la, le conducteur la recoit une
 * fois de la direction, la met en favori, et la rouvre quand il veut.
 *
 * Elle ne montre que ses fiches a lui, et aucun montant : c'est un ecran de
 * verification des heures, pas de paie. Le geste de viser reste ou il etait,
 * sur la page d'une fiche, avec son secret propre renouvele a chaque
 * transmission.
 */

const $ = (id) => document.getElementById(id);

/*
 * Deux facons d'arriver ici, et un seul ecran.
 *
 * Le lien personnel precede les comptes : il donnait un acces a qui n'en avait
 * pas. Depuis, le conducteur se connecte. Les deux chemins montrent la meme
 * chose — seule la porte differe — et le jour ou le lien disparaitra, il n'y
 * aura qu'une branche a retirer.
 */
const CLE = new URLSearchParams(location.search).get('cle') || '';
const PAR_LIEN = Boolean(CLE);

async function demarrer() {
  let tableau;
  try {
    tableau = await API.get(PAR_LIEN ? `/api/conducteur/${encodeURIComponent(CLE)}` : '/api/conducteur/moi');
  } catch (e) {
    return afficherErreur(e.message);
  }

  $('contenu').hidden = false;
  $('bloc-erreur').hidden = true;
  $('entete-conducteur').textContent = tableau.conducteur.nom;

  $('note-page').textContent = PAR_LIEN
    ? 'Cette page est la vôtre : ajoutez-la à vos favoris, ou à l’écran d’accueil de votre téléphone. '
      + 'Elle se met à jour toute seule à chaque ouverture, et ne demande ni compte ni code.'
    : 'Vous êtes connecté avec votre compte. Cette page se met à jour à chaque ouverture ; '
      + 'ajoutez-la à vos favoris pour la retrouver d’un geste.';
  if (!PAR_LIEN) {
    $('btn-quitter').classList.remove('masque');
    $('btn-quitter').addEventListener('click', deconnexion, { once: true });
  }

  afficherAttente(tableau.enAttente);
  afficherRecentes(tableau.recentes);
}

function afficherErreur(texte) {
  $('bloc-erreur').hidden = false;
  $('contenu').hidden = true;
  $('texte-erreur').textContent = texte;
  $('entete-conducteur').textContent = '';
  if (!PAR_LIEN) {
    $('titre-erreur').textContent = 'Impossible d’afficher vos fiches';
    $('conseil-erreur').textContent =
      'Reconnectez-vous, ou signalez-le à la direction si le message persiste.';
  }
}

function periode(annee, semaine) {
  const dates = Regles.datesDeLaSemaine(annee, semaine);
  return `du ${jourMois(dates[0])} au ${jourMois(dates[6])} ${annee}`;
}

function afficherAttente(fiches) {
  // Le nombre en toutes lettres avant la liste : sur un telephone, on voit
  // d'abord s'il y a quelque chose a faire, avant de faire defiler.
  $('resume-attente').textContent = fiches.length
    ? `${fiches.length} fiche(s) attendent votre visa.`
    : 'Rien à viser pour le moment. Cette page vous préviendra à la prochaine ouverture.';

  $('liste-attente').innerHTML = fiches.length
    ? fiches
        .map(
          (f) => `
      <a class="fiche-a-viser" href="${echapper(f.lien)}">
        <div class="entete-fiche">
          <span class="semaine">S${String(f.semaine).padStart(2, '0')}</span>
          <span class="chef">${echapper(f.chef_nom)}</span>
        </div>
        <div class="chantier">${echapper(f.chantier || 'Chantier non renseigné')}${
          f.ville ? ` — ${echapper(f.ville)}` : ''
        }</div>
        <div class="aide">${echapper(periode(f.annee, f.semaine))} · ${f.nb_salaries} salarié(s) · ${
          echapper(versTexte(f.total_minutes))
        }</div>
        <span class="ouvrir">Ouvrir et viser →</span>
      </a>`
        )
        .join('')
    : '';
}

function afficherRecentes(fiches) {
  $('bloc-recentes').hidden = !fiches.length;
  if (!fiches.length) return;

  // La preuve que le geste a porte : sans elle, un conducteur qui a vise le
  // matin rouvre sa page l'apres-midi et se demande s'il a bien fait quelque
  // chose.
  $('liste-recentes').innerHTML = fiches
    .map(
      (f) => `
      <div class="visa-passe">
        <span class="semaine">S${String(f.semaine).padStart(2, '0')}</span>
        <span>${echapper(f.chef_nom)} — ${echapper(f.chantier || 'chantier')}</span>
        <span class="aide">visée le ${echapper(dateFrancaise(String(f.visa_le || '').slice(0, 10)))}</span>
      </div>`
    )
    .join('');
}

if ($('btn-rafraichir')) $('btn-rafraichir').addEventListener('click', () => demarrer());

demarrer().catch((e) => afficherErreur(e.message));
