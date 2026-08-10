/*
 * L'ecran d'accueil d'un conducteur de travaux : ses fiches a viser.
 *
 * Il ne montre que les siennes — celles ou un chef l'a designe — et aucun
 * montant : c'est un ecran de verification des heures, pas de paie.
 */

const $ = (id) => document.getElementById(id);

async function demarrer() {
  let tableau;
  try {
    tableau = await API.get('/api/conducteur/moi');
  } catch (e) {
    return afficherErreur(e.message);
  }

  $('contenu').hidden = false;
  $('bloc-erreur').hidden = true;
  $('entete-conducteur').textContent = tableau.conducteur.nom;

  $('note-page').textContent =
    'Cette page se met à jour à chaque ouverture. Ajoutez-la à vos favoris, ou à l’écran '
    + 'd’accueil de votre téléphone, pour la retrouver d’un geste.';
  $('btn-quitter').classList.remove('masque');
  $('btn-quitter').addEventListener('click', deconnexion, { once: true });

  afficherAttente(tableau.enAttente);
  afficherRecentes(tableau.recentes);
}

function afficherErreur(texte) {
  $('bloc-erreur').hidden = false;
  $('contenu').hidden = true;
  $('texte-erreur').textContent = texte;
  $('entete-conducteur').textContent = '';
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
