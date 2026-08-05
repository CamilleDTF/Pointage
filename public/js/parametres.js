/*
 * Ecran Parametres du directeur : personnel et taux horaires, comptes des chefs
 * d'equipe, parc de vehicules, indicateurs de suivi.
 *
 * Page a part entiere, et non un volet du tableau de bord : on ne regle pas des
 * taux horaires en faisant defiler les fiches de la semaine, et une adresse
 * propre se met en favori.
 */

let reference = null;

const $ = (id) => document.getElementById(id);

/*
 * Cablage tolerant : un identifiant absent de la page ne doit couter que la
 * fonction concernee, jamais le reste du fichier.
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

  reference = await API.get('/api/reference');
  $('entete-nom').textContent = `${utilisateur.nom} · version ${reference.version}`;
  await chargerAdmin();
  ouvrirPanneau('effectif');
}

surClic('btn-retour', () => { location.href = '/directeur.html'; });
surClic('btn-quitter', deconnexion);

/* Les quatre volets de l'ecran Parametres. */
const PANNEAUX = ['effectif', 'comptes', 'vehicules', 'indicateurs'];

surEvenement('onglets-parametres', 'click', (e) => {
  const onglet = e.target.closest('.onglet');
  if (!onglet) return;
  ouvrirPanneau(onglet.dataset.onglet);
});

function ouvrirPanneau(nom) {
  for (const p of PANNEAUX) {
    const panneau = $(`panneau-${p}`);
    if (panneau) panneau.classList.toggle('masque', p !== nom);
  }
  document.querySelectorAll('#onglets-parametres .onglet').forEach((o) => {
    o.classList.toggle('actif', o.dataset.onglet === nom);
  });
  if (nom === 'vehicules') chargerVehicules();
  if (nom === 'indicateurs') chargerIndicateurs();
}

/* ------------------------------- Vehicules -------------------------------- */

async function chargerVehicules() {
  const table = $('table-vehicules');
  if (!table) return;
  const { vehicules } = await API.get('/api/admin/vehicules');
  table.querySelector('tbody').innerHTML = vehicules
    .map(
      (v) => `<tr style="${v.actif ? '' : 'opacity:.5'}">
        <td><strong>${echapper(v.immatriculation)}</strong></td>
        <td>${echapper(v.marque)}</td>
        <td>${echapper(v.modele)}</td>
        <td>${echapper(v.motorisation)}</td>
        <td><button class="petit" onclick="basculerVehicule(${v.id}, ${v.actif ? 0 : 1})">${
          v.actif ? 'Retirer du parc' : 'Remettre'
        }</button></td>
      </tr>`
    )
    .join('');
}

window.basculerVehicule = async (id, actif) => {
  await API.put(`/api/admin/vehicules/${id}`, { actif });
  await chargerVehicules();
  reference = await API.get('/api/reference');
};

surClic('btn-ajout-vehicule', async () => {
  try {
    await API.post('/api/admin/vehicules', {
      immatriculation: $('v-immat').value,
      marque: $('v-marque').value,
      modele: $('v-modele').value,
      motorisation: $('v-motorisation').value,
    });
    for (const id of ['v-immat', 'v-marque', 'v-modele', 'v-motorisation']) $(id).value = '';
    await chargerVehicules();
    message('Véhicule ajouté.', 'succes');
  } catch (e) {
    message(e.message, 'erreur');
  }
});

/* ------------------------------ Indicateurs ------------------------------- */

async function chargerIndicateurs() {
  const table = $('table-indicateurs');
  if (!table) return;
  const { chefs, debutService } = await API.get('/api/admin/indicateurs');

  $('aide-indicateurs').textContent = chefs.length && chefs[0].semainesAttendues
    ? `${chefs[0].semainesAttendues} semaine(s) attendue(s) depuis la mise en service du ${dateFrancaise(debutService)}.`
    : `Aucune semaine complète depuis la mise en service du ${dateFrancaise(debutService)} : rien à mesurer encore.`;

  const jours = (v) => (v === null ? '—' : `${v} j`);
  const pourcent = (v, seuilVert, seuilOrange) => {
    if (v === null) return '<span class="aide">—</span>';
    const classe = v >= seuilVert ? 'bon' : v >= seuilOrange ? 'moyen' : 'faible';
    return `<span class="jauge ${classe}">${v} %</span>`;
  };

  table.querySelector('tbody').innerHTML = chefs
    .map(
      (c) => `<tr>
        <td>${echapper(c.nom)}</td>
        <td class="num">${pourcent(c.assiduite, 90, 70)}</td>
        <td class="num">${c.fichesTransmises}/${c.semainesAttendues}</td>
        <td class="num">${c.enRetard ? `<span class="jauge faible">${c.enRetard}</span>` : '0'}</td>
        <td class="num">${jours(c.retardMoyen)}</td>
        <td class="num">${jours(c.retardMax)}</td>
        <td class="num">${c.horsDelai || '0'}</td>
        <td class="num">${c.fichesRenvoyees}${c.tauxRejet !== null ? ` <span class="aide">(${c.tauxRejet} %)</span>` : ''}</td>
      </tr>`
    )
    .join('');
}

async function chargerAdmin() {
  const { utilisateurs, salaries } = await API.get('/api/admin/utilisateurs');

  $('table-utilisateurs').querySelector('tbody').innerHTML = utilisateurs
    .map(
      (u) => `<tr style="${u.actif ? '' : 'opacity:.5'}">
        <td>${echapper(u.nom)}</td><td>${echapper(u.identifiant)}</td><td>${u.role}</td>
        <td>
          <button class="petit" onclick="reinitialiserCode(${u.id})">Nouveau code</button>
          <button class="petit" onclick="basculerActif(${u.id}, ${u.actif ? 0 : 1})">${u.actif ? 'Désactiver' : 'Réactiver'}</button>
        </td>
      </tr>`
    )
    .join('');

  const chefs = utilisateurs.filter((u) => u.role === 'chef' && u.actif);
  const options = (selectionne) =>
    `<option value="">—</option>${chefs
      .map((c) => `<option value="${c.id}"${c.id === selectionne ? ' selected' : ''}>${echapper(c.nom)}</option>`)
      .join('')}`;

  $('s-chef').innerHTML = options(null);
  $('table-salaries').querySelector('tbody').innerHTML = salaries
    .map(
      (s) => `<tr style="${s.actif ? '' : 'opacity:.5'}">
        <td>${echapper(s.matricule || '')}</td><td>${echapper(s.nom)}</td><td>${echapper(s.prenom)}</td>
        <td><select onchange="affecter(${s.id}, this.value)">${options(s.chef_id)}</select></td>
        <td class="num"><input class="taux" type="number" min="0" step="0.01" style="width:92px;text-align:right"
               value="${s.taux_horaire || ''}" placeholder="—"
               onchange="fixerTaux(${s.id}, this.value)"></td>
        <td><button class="petit" onclick="basculerSalarie(${s.id}, ${s.actif ? 0 : 1})">${s.actif ? 'Sortie' : 'Réactiver'}</button></td>
      </tr>`
    )
    .join('');
}

window.reinitialiserCode = async (id) => {
  const pin = prompt('Nouveau code (4 à 8 chiffres) :');
  if (!pin) return;
  try {
    await API.post(`/api/admin/utilisateurs/${id}/code`, { pin });
    message('Code réinitialisé.', 'succes');
  } catch (e) {
    message(e.message, 'erreur');
  }
};

window.basculerActif = async (id, actif) => {
  await API.post(`/api/admin/utilisateurs/${id}/actif`, { actif });
  await chargerAdmin();
};

window.affecter = async (id, chefId) => {
  await API.put(`/api/admin/salaries/${id}`, { chef_id: chefId ? Number(chefId) : null });
  message('Affectation mise à jour.', 'succes', 2000);
};

window.fixerTaux = async (id, valeur) => {
  const taux = Math.max(0, Number(valeur) || 0);
  try {
    await API.put(`/api/admin/salaries/${id}`, { taux_horaire: taux });
    message(taux ? `Taux horaire enregistré : ${taux.toFixed(2)} €.` : 'Taux horaire effacé.', 'succes', 2500);
  } catch (e) {
    message(e.message, 'erreur');
  }
};

window.basculerSalarie = async (id, actif) => {
  await API.put(`/api/admin/salaries/${id}`, { actif });
  await chargerAdmin();
};

surClic('btn-ajout-chef', async () => {
  try {
    await API.post('/api/admin/utilisateurs', {
      nom: $('u-nom').value,
      identifiant: $('u-identifiant').value,
      pin: $('u-pin').value,
      role: 'chef',
    });
    $('u-nom').value = $('u-identifiant').value = $('u-pin').value = '';
    await chargerAdmin();
    message('Chef d’équipe ajouté.', 'succes');
  } catch (e) {
    message(e.message, 'erreur');
  }
});

surClic('btn-ajout-salarie', async () => {
  try {
    await API.post('/api/admin/salaries', {
      matricule: $('s-matricule').value,
      nom: $('s-nom').value,
      prenom: $('s-prenom').value,
      chef_id: $('s-chef').value ? Number($('s-chef').value) : null,
    });
    $('s-matricule').value = $('s-nom').value = $('s-prenom').value = '';
    await chargerAdmin();
    message('Salarié ajouté.', 'succes');
  } catch (e) {
    message(e.message, 'erreur');
  }
});

demarrer().catch((e) => message(e.message, 'erreur'));
