/* Tableau de bord du directeur : verification, correction, validation, export. */

let reference = null;
let tableau = null;
const fichesChargees = new Map();

const $ = (id) => document.getElementById(id);

async function demarrer() {
  const { utilisateur } = await API.get('/api/moi');
  if (utilisateur.role !== 'directeur') {
    location.href = '/chef.html';
    return;
  }
  $('entete-nom').textContent = utilisateur.nom;

  reference = await API.get('/api/reference');
  $('annee').value = reference.semaineCourante.annee;
  $('semaine').value = reference.semaineCourante.semaine;
  await charger();
}

$('btn-charger').addEventListener('click', charger);
$('btn-quitter').addEventListener('click', deconnexion);
$('btn-precedente').addEventListener('click', () => decalerSemaine(-1));
$('btn-suivante').addEventListener('click', () => decalerSemaine(1));
$('btn-admin').addEventListener('click', basculerAdmin);
$('btn-export-xlsx').addEventListener('click', () => exporter('xlsx'));
$('btn-export-csv').addEventListener('click', () => exporter('csv'));

function decalerSemaine(pas) {
  let semaine = Number($('semaine').value) + pas;
  let annee = Number($('annee').value);
  if (semaine < 1) { semaine = 52; annee -= 1; }
  if (semaine > 53) { semaine = 1; annee += 1; }
  $('semaine').value = semaine;
  $('annee').value = annee;
  charger();
}

function exporter(format) {
  const params = new URLSearchParams({
    annee: $('annee').value,
    semaine: $('semaine').value,
  });
  const statut = $('portee-export').value;
  if (statut) params.set('statut', statut);
  window.location.href = `/api/export/periode.${format}?${params}`;
}

/* --------------------------------- Chargement ----------------------------- */

async function charger() {
  const annee = Number($('annee').value);
  const semaine = Number($('semaine').value);
  try {
    tableau = await API.get(`/api/tableau?annee=${annee}&semaine=${semaine}`);
  } catch (e) {
    message(e.message, 'erreur');
    return;
  }

  $('periode').textContent = `Semaine ${tableau.semaine} — du ${jourMois(tableau.dates[0])} au ${jourMois(tableau.dates[6])} ${tableau.annee}`;
  afficherIndicateurs();
  afficherSuivi();

  fichesChargees.clear();
  $('fiches').innerHTML = '';
  for (const resume of tableau.fiches) {
    const { fiche } = await API.get(`/api/fiches/${resume.id}`);
    fichesChargees.set(fiche.id, fiche);
    $('fiches').appendChild(construireFiche(fiche));
  }
  if (!tableau.fiches.length) {
    $('fiches').innerHTML = '<section class="carte"><p class="vide">Aucune fiche pour cette semaine.</p></section>';
  }
}

function afficherIndicateurs() {
  const t = tableau.totaux;
  const manquantes = tableau.suivi.filter((s) => s.statut === 'manquante').length;
  const cartes = [
    { valeur: `${t.validees}/${t.attendues}`, libelle: 'Fiches validées' },
    { valeur: tableau.fiches.filter((f) => f.statut === 'soumise').length, libelle: 'À vérifier' },
    { valeur: manquantes, libelle: 'Fiches manquantes' },
    { valeur: t.salaries, libelle: 'Salariés pointés' },
    { valeur: versTexteTotal(t.minutes), libelle: 'Total heures semaine' },
  ];
  $('indicateurs').innerHTML = cartes
    .map((c) => `<div class="indicateur"><div class="valeur">${c.valeur}</div><div class="libelle">${c.libelle}</div></div>`)
    .join('');
}

function afficherSuivi() {
  const corps = $('suivi').querySelector('tbody');
  corps.innerHTML = tableau.suivi
    .map((entree) => {
      const f = entree.fiche;
      return `<tr>
        <td>${echapper(entree.chef_nom)}</td>
        <td>${echapper(f ? f.chantier : '—')}</td>
        <td>${echapper(f ? f.ville : '—')}</td>
        <td class="num">${f ? f.nb_salaries : '—'}</td>
        <td class="num">${f ? versTexteTotal(f.total_minutes) : '—'}</td>
        <td>${badgeStatut(entree.statut)}</td>
        <td>${f ? `<button class="petit" onclick="allerA(${f.id})">Ouvrir</button>` : '<span class="aide">à relancer</span>'}</td>
      </tr>`;
    })
    .join('');
}

function allerA(ficheId) {
  const el = document.getElementById(`fiche-${ficheId}`);
  if (el) {
    el.open = true;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
window.allerA = allerA;

/* ------------------ Grille de correction, une par fiche ------------------- */

function construireFiche(fiche) {
  const bloc = document.createElement('details');
  bloc.className = 'carte';
  bloc.id = `fiche-${fiche.id}`;
  bloc.open = fiche.statut === 'soumise';

  const lignes = fiche.lignes.filter((l) => l.nom_affiche.trim());
  const entetesJours = tableau.dates
    .map((iso, j) => `<th class="num ${j >= 5 ? 'weekend' : ''}">${reference.joursCourts[j]}<br><small>${jourMois(iso)}</small></th>`)
    .join('');

  const corpsLignes = lignes
    .map((ligne, index) => {
      const cellulesJours = ligne.jours
        .map((jour, j) => {
          const codes = reference.codesAbsence
            .map((c) => `<option value="${c.code}"${c.code === jour.code_absence ? ' selected' : ''}>${c.code}</option>`)
            .join('');
          return `<td class="num ${j >= 5 ? 'weekend' : ''}">
            <input class="cellule heures" data-jour="${j}" value="${versTexte(jour.minutes)}"
                   style="padding:5px;text-align:center;min-width:56px">
            <select class="cellule code" data-jour="${j}" style="padding:2px;font-size:0.72rem;margin-top:3px">
              <option value="">—</option>${codes}
            </select>
          </td>`;
        })
        .join('');

      return `<tr data-index="${index}" data-ligne-id="${ligne.id}">
        <td style="min-width:170px">${echapper(ligne.nom_affiche)}</td>
        ${cellulesJours}
        <td class="num total" style="font-weight:700">${versTexteTotal(ligne.total_minutes)}</td>
        <td class="num"><input class="cellule route" value="${versTexte(ligne.minutes_route)}" style="padding:5px;text-align:center;min-width:60px"></td>
        <td class="num"><input class="cellule trajet" value="${versTexte(ligne.minutes_trajet)}" style="padding:5px;text-align:center;min-width:60px"></td>
        <td class="num"><input class="cellule zone" type="number" min="0" max="7" step="0.5" value="${ligne.jours_zone || ''}" style="padding:5px;text-align:center;min-width:56px"></td>
        <td class="num"><select class="cellule masque-type" style="padding:5px;min-width:62px">
          <option value=""${!ligne.type_masque ? ' selected' : ''}>—</option>
          <option value="VA"${ligne.type_masque === 'VA' ? ' selected' : ''}>VA</option>
          <option value="AA"${ligne.type_masque === 'AA' ? ' selected' : ''}>AA</option>
        </select></td>
        <td class="num"><input class="cellule deplacement" type="number" min="0" step="1" value="${ligne.nb_deplacement || ''}" style="padding:5px;text-align:center;min-width:56px"></td>
        <td><input class="cellule observation" value="${echapper(ligne.observation)}" style="padding:5px;min-width:150px"></td>
        <td class="num">${ligne.signature ? '<span title="Signée">✔</span>' : '<span style="color:var(--rouge)" title="Signature manquante">✘</span>'}</td>
      </tr>`;
    })
    .join('');

  bloc.innerHTML = `
    <summary style="cursor:pointer;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <strong>${echapper(fiche.chef_nom)}</strong>
      <span>${echapper(fiche.chantier || 'chantier non renseigné')} — ${echapper(fiche.ville)}</span>
      ${badgeStatut(fiche.statut)}
      <span class="pousse aide" style="margin:0">${lignes.length} salarié(s) · ${versTexteTotal(fiche.total_minutes)}</span>
    </summary>

    <div style="margin-top:14px">
      ${fiche.motif_rejet ? `<p class="aide" style="color:var(--rouge);font-weight:600">Renvoyée : ${echapper(fiche.motif_rejet)}</p>` : ''}
      <div class="grille trois" style="margin-bottom:12px">
        <div><label>Chantier</label><input class="entete" data-champ="chantier" value="${echapper(fiche.chantier)}"></div>
        <div><label>Ville</label><input class="entete" data-champ="ville" value="${echapper(fiche.ville)}"></div>
        <div><label>Conducteur du véhicule</label><input class="entete" data-champ="conducteur_vehicule" value="${echapper(fiche.conducteur_vehicule)}"></div>
        <div><label>Type de véhicule</label><input class="entete" data-champ="type_vehicule" value="${echapper(fiche.type_vehicule)}"></div>
        <div><label>Immatriculation</label><input class="entete" data-champ="immatriculation" value="${echapper(fiche.immatriculation)}"></div>
        <div><label>Visa conducteur de travaux</label><input class="entete" data-champ="visa_conducteur" value="${echapper(fiche.visa_conducteur)}"></div>
      </div>

      <div class="enveloppe-table">
        <table>
          <thead><tr>
            <th>Nom - Prénom</th>${entetesJours}
            <th class="num">Total<br>semaine</th>
            <th class="num">Route<br>100%</th>
            <th class="num">Trajet<br>50%</th>
            <th class="num">Jours<br>zone</th>
            <th class="num">Masque</th>
            <th class="num">Nb<br>dépl.</th>
            <th>Observations</th>
            <th class="num">Signé</th>
          </tr></thead>
          <tbody>${corpsLignes || '<tr><td colspan="17" class="vide">Aucun salarié renseigné.</td></tr>'}</tbody>
        </table>
      </div>

      <ul class="anomalies" style="margin-top:12px"></ul>

      <div class="rangee" style="margin-top:12px">
        <span class="aide etat-enregistrement" style="margin:0"></span>
        <span class="pousse"></span>
        <button class="petit" data-action="excel">Fiche Excel</button>
        <button class="petit" data-action="rouvrir">Rouvrir pour le chef</button>
        <button class="petit danger" data-action="rejeter">Renvoyer au chef</button>
        <button class="petit valide" data-action="valider">Valider</button>
      </div>
    </div>`;

  cablerFiche(bloc, fiche);
  return bloc;
}

function cablerFiche(bloc, fiche) {
  const enregistrerPlusTard = antiRebond(() => enregistrerFiche(bloc, fiche.id), 900);

  bloc.querySelectorAll('.cellule, .entete').forEach((champ) => {
    champ.addEventListener('input', enregistrerPlusTard);
    champ.addEventListener('change', enregistrerPlusTard);
  });

  bloc.querySelectorAll('input.heures').forEach((champ) => {
    champ.addEventListener('blur', () => {
      champ.value = versTexte(versMinutes(champ.value));
      recalculerTotal(champ.closest('tr'));
    });
    champ.addEventListener('input', () => recalculerTotal(champ.closest('tr')));
  });
  for (const classe of ['input.route', 'input.trajet']) {
    bloc.querySelectorAll(classe).forEach((champ) => {
      champ.addEventListener('blur', () => { champ.value = versTexte(versMinutes(champ.value)); });
    });
  }
  bloc.querySelectorAll('select.code').forEach((select) => {
    select.addEventListener('change', () => {
      const rang = select.closest('tr');
      const saisie = rang.querySelector(`input.heures[data-jour="${select.dataset.jour}"]`);
      if (select.value) saisie.value = '';
      recalculerTotal(rang);
    });
  });

  bloc.querySelectorAll('button[data-action]').forEach((bouton) => {
    bouton.addEventListener('click', async (e) => {
      e.preventDefault();
      const action = bouton.dataset.action;
      if (action === 'excel') {
        window.location.href = `/api/export/fiche/${fiche.id}.xlsx`;
        return;
      }
      await enregistrerFiche(bloc, fiche.id);
      let motif = '';
      if (action === 'rejeter') {
        motif = prompt('Motif du renvoi au chef d’équipe :') || '';
        if (!motif.trim()) return;
      }
      try {
        await API.post(`/api/fiches/${fiche.id}/decision`, { decision: action, motif });
        message(
          { valider: 'Fiche validée.', rejeter: 'Fiche renvoyée au chef d’équipe.', rouvrir: 'Fiche rouverte.' }[action],
          'succes'
        );
        await charger();
      } catch (erreur) {
        if (erreur.anomalies) afficherAnomalies(bloc, erreur.anomalies);
        message(erreur.message, 'erreur');
      }
    });
  });

  afficherAnomalies(bloc, fiche.anomalies || []);
}

function recalculerTotal(rang) {
  let total = 0;
  rang.querySelectorAll('input.heures').forEach((champ) => { total += versMinutes(champ.value); });
  rang.querySelector('.total').textContent = versTexteTotal(total);
}

function collecter(bloc, fiche) {
  const corps = { lignes: [] };
  bloc.querySelectorAll('.entete').forEach((champ) => { corps[champ.dataset.champ] = champ.value; });

  const rangs = [...bloc.querySelectorAll('tbody tr[data-index]')];
  const remplies = rangs.map((rang) => {
    const index = Number(rang.dataset.index);
    const origine = fiche.lignes.filter((l) => l.nom_affiche.trim())[index];
    const jours = [];
    for (let j = 0; j < 7; j += 1) {
      jours.push({
        jour: j,
        minutes: versMinutes(rang.querySelector(`input.heures[data-jour="${j}"]`).value),
        code_absence: rang.querySelector(`select.code[data-jour="${j}"]`).value,
      });
    }
    return {
      salarie_id: origine.salarie_id,
      nom_affiche: origine.nom_affiche,
      minutes_route: versMinutes(rang.querySelector('.route').value),
      minutes_trajet: versMinutes(rang.querySelector('.trajet').value),
      jours_zone: Number(rang.querySelector('.zone').value) || 0,
      type_masque: rang.querySelector('.masque-type').value,
      nb_deplacement: Number(rang.querySelector('.deplacement').value) || 0,
      observation: rang.querySelector('.observation').value,
      signature: origine.signature || null, // le directeur ne resigne pas : on renvoie la signature du salarie
      jours,
    };
  });

  // Les lignes vides de la fiche papier sont conservees telles quelles.
  const vides = fiche.lignes.filter((l) => !l.nom_affiche.trim()).map((l) => ({
    salarie_id: l.salarie_id,
    nom_affiche: '',
    minutes_route: 0,
    minutes_trajet: 0,
    jours_zone: 0,
    type_masque: '',
    nb_deplacement: 0,
    observation: '',
    signature: l.signature || null,
    jours: l.jours,
  }));

  corps.lignes = [...remplies, ...vides];
  return corps;
}

async function enregistrerFiche(bloc, ficheId) {
  const fiche = fichesChargees.get(ficheId);
  if (!fiche) return;
  const etat = bloc.querySelector('.etat-enregistrement');
  etat.textContent = 'Enregistrement…';
  try {
    const reponse = await API.put(`/api/fiches/${ficheId}`, collecter(bloc, fiche));
    fichesChargees.set(ficheId, reponse.fiche);
    afficherAnomalies(bloc, reponse.anomalies || []);
    etat.textContent = `Enregistré à ${new Date().toLocaleTimeString('fr-FR')}`;
  } catch (e) {
    etat.textContent = `Échec : ${e.message}`;
    message(e.message, 'erreur');
  }
}

function afficherAnomalies(bloc, anomalies) {
  const liste = bloc.querySelector('.anomalies');
  if (!anomalies.length) {
    liste.innerHTML = '';
    return;
  }
  liste.innerHTML = anomalies
    .map((a) => `<li class="${a.niveau}">${a.niveau === 'bloquant' ? 'À corriger' : 'À vérifier'} — ${echapper(a.message)}</li>`)
    .join('');
}

/* ------------------------------ Administration ---------------------------- */

async function basculerAdmin() {
  const bloc = $('bloc-admin');
  bloc.classList.toggle('masque');
  if (bloc.classList.contains('masque')) return;
  await chargerAdmin();
  bloc.scrollIntoView({ behavior: 'smooth' });
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

window.basculerSalarie = async (id, actif) => {
  await API.put(`/api/admin/salaries/${id}`, { actif });
  await chargerAdmin();
};

$('btn-ajout-chef').addEventListener('click', async () => {
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

$('btn-ajout-salarie').addEventListener('click', async () => {
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
