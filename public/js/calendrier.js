/*
 * Calendrier mensuel de la direction.
 *
 * Une ligne par personne — operateurs et chefs d'equipe confondus, puisqu'un
 * chef travaille lui aussi sur le chantier — et une colonne par jour du mois.
 *
 * Le tableau de bord repond a « qui doit rendre sa fiche cette semaine ». Il ne
 * repond pas a « pourquoi Untel n'apparait nulle part depuis quinze jours »,
 * qui est pourtant la question couteuse : c'est elle qui declenche les appels
 * telephoniques. Chaque case dit donc ce qui s'est passe ce jour-la, ou pourquoi
 * il ne s'est rien passe.
 */

let reference = null;
let mois = null;
let effectif = [];

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
  effectif = reference.effectif || [];

  const maintenant = new Date();
  $('mois').innerHTML = Regles.MOIS.map(
    (nom, i) => `<option value="${i + 1}"${i === maintenant.getMonth() ? ' selected' : ''}>${nom}</option>`
  ).join('');
  $('annee').value = maintenant.getFullYear();

  $('conge-salarie').innerHTML = effectif
    .map((s) => `<option value="${s.id}">${echapper(`${s.nom} ${s.prenom}`.trim())}</option>`)
    .join('');

  await charger();
  await chargerConges();
}

surClic('btn-retour', () => { location.href = '/directeur.html'; });
surClic('btn-quitter', deconnexion);
surClic('btn-precedent', () => decalerMois(-1));
surClic('btn-suivant', () => decalerMois(1));
for (const champ of ['mois', 'annee']) surEvenement(champ, 'change', charger);
surEvenement('filtre-equipe', 'change', afficher);

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
  const zone = $('calendrier-mensuel');
  zone.innerHTML = '<p class="aide">Chargement…</p>';
  try {
    mois = await API.get(`/api/calendrier-mensuel?annee=${$('annee').value}&mois=${$('mois').value}`);
  } catch (e) {
    zone.innerHTML = `<p class="vide">${echapper(e.message)}</p>`;
    return;
  }

  // La liste des equipes se deduit des lignes : elle suit l'organisation reelle
  // sans avoir a la redemander au serveur.
  const equipes = [...new Set(mois.lignes.map((l) => l.chef_nom).filter(Boolean))].sort();
  const choisie = $('filtre-equipe').value;
  $('filtre-equipe').innerHTML =
    '<option value="">Toutes les équipes</option>' +
    equipes.map((e) => `<option value="${echapper(e)}"${e === choisie ? ' selected' : ''}>${echapper(e)}</option>`).join('');

  afficher();
}

const ETIQUETTES_ETAT = {
  travaille: 'Pointé',
  absence: 'Absence justifiée sur la fiche',
  conge: 'Congé enregistré',
  nonPointe: 'Aucun pointage',
  weekend: 'Week-end',
  horsService: 'Avant la mise en service',
};

function afficher() {
  const zone = $('calendrier-mensuel');
  if (!mois) return;

  const equipe = $('filtre-equipe').value;
  const lignes = equipe ? mois.lignes.filter((l) => l.chef_nom === equipe) : mois.lignes;

  if (!lignes.length) {
    zone.innerHTML = '<p class="vide">Aucun salarié dans cette sélection.</p>';
    return;
  }

  const JOURS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  const enteteJours = mois.jours
    .map(
      (j) => `<th class="jour-entete${j.weekend ? ' weekend' : ''}">
        <span class="lettre">${JOURS[j.jourSemaine]}</span>
        <span class="numero">${j.numero}</span>
      </th>`
    )
    .join('');

  // Les lignes se regroupent par equipe : c'est ainsi que le directeur relance,
  // un chef a la fois.
  let equipeCourante = null;
  const rangs = lignes
    .map((ligne) => {
      let separateur = '';
      if (ligne.chef_nom !== equipeCourante) {
        equipeCourante = ligne.chef_nom;
        separateur = `<tr class="separateur-equipe">
          <th class="nom-personne">${echapper(equipeCourante || 'Sans équipe')}</th>
          <td colspan="${mois.jours.length + 1}"></td>
        </tr>`;
      }

      const cases = ligne.cases
        .map((c, i) => {
          const jour = mois.jours[i];
          const titre = `${ligne.nom} — ${jour.numero}/${String(mois.mois).padStart(2, '0')}\n${
            ETIQUETTES_ETAT[c.etat]
          }${c.minutes ? `\n${versTexte(c.minutes)}` : ''}${
            c.chantiers && c.chantiers.length ? `\n${c.chantiers.join(' / ')}` : ''
          }${c.code && c.code !== '0' ? `\n${libelleCode(c.code)}` : ''}${
            c.commentaire ? `\n${c.commentaire}` : ''
          }`;
          return `<td class="case-jour ${c.etat}" title="${echapper(titre)}">${contenuCase(c)}</td>`;
        })
        .join('');

      return `${separateur}<tr>
        <th class="nom-personne">${echapper(ligne.nom)}${
          ligne.estChef ? ' <span class="marque-chef">chef</span>' : ''
        }</th>
        ${cases}
        <td class="total-mois">${versTexte(ligne.totaux.minutes)}</td>
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

  $('legende-calendrier').innerHTML = ['travaille', 'absence', 'conge', 'nonPointe', 'weekend']
    .map((etat) => `<span><span class="case-jour ${etat}"></span>${echapper(ETIQUETTES_ETAT[etat])}</span>`)
    .join('');

  const trous = lignes.reduce((t, l) => t + l.totaux.nonPointe, 0);
  const conges = lignes.reduce((t, l) => t + l.totaux.conge, 0);
  $('resume-mois').innerHTML =
    `${lignes.length} personne(s) · ${trous ? `<strong>${trous} jour(s) sans pointage ni justification</strong>` : 'aucun jour inexpliqué'}` +
    `${conges ? ` · ${conges} jour(s) de congé enregistrés` : ''}`;
}

/** Une case porte peu de chose : l'essentiel se lit a la couleur. */
function contenuCase(c) {
  if (c.etat === 'travaille') return versTexte(c.minutes).replace('h00', '').replace('h', ',');
  if (c.etat === 'absence') return c.code === '0' ? '0' : echapper(c.code);
  if (c.etat === 'conge') return echapper(c.code);
  return '';
}

function libelleCode(code) {
  const absence = (mois.codesAbsence || []).find((c) => c.code === code);
  if (absence) return absence.libelle;
  const conge = (mois.motifsConge || []).find((c) => c.code === code);
  return conge ? conge.libelle : code;
}

/* ---------------------------- Conges et absences -------------------------- */

async function chargerConges() {
  const table = $('table-conges');
  if (!table) return;
  const { conges, motifs } = await API.get('/api/conges');

  $('conge-motif').innerHTML = motifs
    .map((m) => `<option value="${m.code}">${echapper(m.libelle)}</option>`)
    .join('');

  table.querySelector('tbody').innerHTML = conges.length
    ? conges
        .map(
          (c) => `<tr>
        <td>${echapper(`${c.nom} ${c.prenom}`.trim())}</td>
        <td>${echapper(dateFrancaise(c.debut))}</td>
        <td>${echapper(dateFrancaise(c.fin))}</td>
        <td>${echapper(libelleMotif(motifs, c.motif))}</td>
        <td>${echapper(c.commentaire || '')}</td>
        <td><button class="petit" onclick="supprimerConge(${c.id})">Supprimer</button></td>
      </tr>`
        )
        .join('')
    : '<tr><td colspan="6" class="vide">Aucun congé enregistré.</td></tr>';
}

const libelleMotif = (motifs, code) => (motifs.find((m) => m.code === code) || {}).libelle || code;

surClic('btn-conge', () => {
  // Pre-remplissage sur le mois affiche : c'est celui qu'on est en train de lire.
  const premier = `${$('annee').value}-${String($('mois').value).padStart(2, '0')}-01`;
  $('conge-debut').value = premier;
  $('conge-fin').value = premier;
  $('conge-commentaire').value = '';
  $('fenetre-conge').classList.remove('masque');
});

surClic('btn-annuler-conge', () => $('fenetre-conge').classList.add('masque'));

surClic('btn-valider-conge', async () => {
  try {
    await API.post('/api/conges', {
      salarie_id: $('conge-salarie').value,
      debut: $('conge-debut').value,
      fin: $('conge-fin').value,
      motif: $('conge-motif').value,
      commentaire: $('conge-commentaire').value,
    });
    $('fenetre-conge').classList.add('masque');
    message('Congé enregistré.', 'succes');
    await charger();
    await chargerConges();
  } catch (e) {
    message(e.message, 'erreur');
  }
});

window.supprimerConge = async (id) => {
  if (!confirm('Supprimer ce congé ?')) return;
  try {
    await API.supprimer(`/api/conges/${id}`);
    await charger();
    await chargerConges();
  } catch (e) {
    message(e.message, 'erreur');
  }
};

demarrer().catch((e) => message(e.message, 'erreur'));
