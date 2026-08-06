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
const PANNEAUX = ['effectif', 'comptes', 'conducteurs', 'vehicules', 'indicateurs'];

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
  if (nom === 'conducteurs') chargerConducteurs();
  if (nom === 'vehicules') chargerVehicules();
  if (nom === 'indicateurs') chargerIndicateurs();
}

/* ------------------------------- Vehicules -------------------------------- */

async function chargerVehicules() {
  const table = $('table-vehicules');
  if (!table) return;
  const { vehicules } = await API.get('/api/admin/vehicules');
  const champ = (v, nom, largeur) =>
    `<input value="${echapper(v[nom])}" style="width:${largeur}" onchange="corrigerVehicule(${v.id}, '${nom}', this.value, this)">`;

  table.querySelector('tbody').innerHTML = vehicules
    .map(
      (v) => `<tr style="${v.actif ? '' : 'opacity:.5'}">
        <td>${champ(v, 'immatriculation', '130px')}</td>
        <td>${champ(v, 'marque', '120px')}</td>
        <td>${champ(v, 'modele', '120px')}</td>
        <td>${champ(v, 'motorisation', '120px')}</td>
        <td><button class="petit" onclick="basculerVehicule(${v.id}, ${v.actif ? 0 : 1})">${
          v.actif ? 'Retirer du parc' : 'Remettre'
        }</button></td>
      </tr>`
    )
    .join('');
}

/** Correction d'une case du parc, enregistree a la sortie du champ. */
window.corrigerVehicule = async (id, champ, valeur, element) => {
  const ancienne = element.defaultValue;
  try {
    await API.put(`/api/admin/vehicules/${id}`, { [champ]: valeur.trim() });
    element.defaultValue = valeur.trim();
    reference = await API.get('/api/reference');
    message('Véhicule mis à jour.', 'succes', 2500);
  } catch (e) {
    // On remet la valeur d'avant : laisser a l'ecran une correction refusee
    // ferait croire qu'elle a ete prise en compte.
    element.value = ancienne;
    message(e.message, 'erreur');
  }
};

/* --------------------------- Conducteurs de travaux ------------------------ */

async function chargerConducteurs() {
  const table = $('table-conducteurs');
  if (!table) return;
  const { conducteurs, chefs, envoiConfigure } = await API.get('/api/admin/conducteurs');

  $('aide-envoi').innerHTML = envoiConfigure
    ? '<span class="jauge bon">Envoi de courriels configuré</span>'
    : '<span class="jauge moyen">Aucun serveur d’envoi configuré</span> — les messages sont conservés sur le serveur ' +
      'et le lien de visa s’affiche sur la fiche, à transmettre à la main. Pour que les courriels partent ' +
      'vraiment : copiez <code>configuration-exemple.txt</code> en <code>configuration.txt</code> à côté de ' +
      'DEMARRER.bat, remplissez les lignes SMTP, puis relancez l’application.';

  const champ = (c, nom, largeur, type = 'text') =>
    `<input type="${type}" value="${echapper(c[nom])}" style="width:${largeur}"
            onchange="corrigerConducteur(${c.id}, '${nom}', this.value, this)">`;

  table.querySelector('tbody').innerHTML = conducteurs.length
    ? conducteurs
        .map(
          (c) => `<tr style="${c.actif ? '' : 'opacity:.5'}">
            <td>${champ(c, 'nom', '190px')}</td>
            <td>${champ(c, 'courriel', '260px', 'email')}</td>
            <td><button class="petit" onclick="basculerConducteur(${c.id}, ${c.actif ? 0 : 1})">${
              c.actif ? 'Désactiver' : 'Réactiver'
            }</button></td>
          </tr>`
        )
        .join('')
    : '<tr><td colspan="3" class="vide">Aucun conducteur de travaux enregistré.</td></tr>';

  const options = (selectionne) =>
    `<option value="">— aucun, transmission directe à la direction</option>${conducteurs
      .filter((c) => c.actif)
      .map((c) => `<option value="${c.id}"${c.id === selectionne ? ' selected' : ''}>${echapper(c.nom)}</option>`)
      .join('')}`;

  $('table-rattachement').querySelector('tbody').innerHTML = chefs
    .map(
      (chef) => `<tr>
        <td>${echapper(chef.nom)}</td>
        <td><select onchange="rattacherChef(${chef.id}, this.value)" style="min-width:280px">${options(
          chef.conducteur_id
        )}</select></td>
      </tr>`
    )
    .join('');
}

window.corrigerConducteur = async (id, champ, valeur, element) => {
  const ancienne = element.defaultValue;
  try {
    await API.put(`/api/admin/conducteurs/${id}`, { [champ]: valeur.trim() });
    element.defaultValue = valeur.trim();
    message('Conducteur mis à jour.', 'succes', 2500);
  } catch (e) {
    element.value = ancienne;
    message(e.message, 'erreur');
  }
};

window.basculerConducteur = async (id, actif) => {
  await API.put(`/api/admin/conducteurs/${id}`, { actif });
  await chargerConducteurs();
};

window.rattacherChef = async (chefId, conducteurId) => {
  try {
    await API.put(`/api/admin/chefs/${chefId}/conducteur`, { conducteur_id: conducteurId || null });
    message('Rattachement enregistré.', 'succes', 2500);
  } catch (e) {
    message(e.message, 'erreur');
  }
};

surClic('btn-ajout-conducteur', async () => {
  try {
    await API.post('/api/admin/conducteurs', { nom: $('c-nom').value, courriel: $('c-courriel').value });
    $('c-nom').value = $('c-courriel').value = '';
    await chargerConducteurs();
    message('Conducteur de travaux ajouté.', 'succes');
  } catch (e) {
    message(e.message, 'erreur');
  }
});

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
  const { chefs, debutService, delaiJours } = await API.get('/api/admin/indicateurs');

  const echeance = delaiJours === 1 ? 'le lundi qui suit' : `${delaiJours} jour(s) après le dimanche`;
  const attendues = chefs.length ? chefs[0].semainesAttendues : 0;
  $('aide-indicateurs').innerHTML = attendues
    ? `${attendues} semaine(s) attendue(s) depuis la mise en service du ${echapper(dateFrancaise(debutService))}. ` +
      `Une fiche est <strong>à l'heure</strong> si elle est transmise ${echapper(echeance)} au plus tard.`
    : `Aucune semaine complète depuis la mise en service du ${echapper(dateFrancaise(debutService))} : ` +
      `rien à mesurer encore. Les fiches sont attendues pour ${echapper(echeance)}.`;

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
        <td class="num">${
          c.horsDelai
            ? `<span class="jauge faible">${c.horsDelai}</span>`
            : '0'
        }${c.ponctualite !== null ? ` <span class="aide">(${c.ponctualite} % à l’heure)</span>` : ''}</td>
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
        <td><input value="${echapper(s.matricule || '')}" style="width:95px"
                   onchange="corrigerSalarie(${s.id}, 'matricule', this.value, this)"></td>
        <td><input value="${echapper(s.nom)}" style="width:150px"
                   onchange="corrigerSalarie(${s.id}, 'nom', this.value, this)"></td>
        <td><input value="${echapper(s.prenom)}" style="width:150px"
                   onchange="corrigerSalarie(${s.id}, 'prenom', this.value, this)"></td>
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

/** Matricule, nom, prenom : corrigeables sur place. */
window.corrigerSalarie = async (id, champ, valeur, element) => {
  const ancienne = element.defaultValue;
  const propre = valeur.trim();
  if (champ === 'nom' && !propre) {
    element.value = ancienne;
    return message('Le nom ne peut pas être vide.', 'erreur');
  }
  try {
    await API.put(`/api/admin/salaries/${id}`, { [champ]: propre });
    element.defaultValue = propre;
    message('Fiche du salarié mise à jour.', 'succes', 2500);
  } catch (e) {
    element.value = ancienne;
    message(e.message, 'erreur');
  }
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
