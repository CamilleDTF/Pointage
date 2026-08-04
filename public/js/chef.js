/* Espace chef d'equipe : saisie de la fiche hebdomadaire sur telephone. */

let reference = null;
let fiche = null;
let signaturesLignes = [];
let modifiable = true;

const $ = (id) => document.getElementById(id);

/* ------------------------------ Initialisation ---------------------------- */

async function demarrer() {
  const { utilisateur } = await API.get('/api/moi');
  if (utilisateur.role === 'directeur') {
    location.href = '/directeur.html';
    return;
  }
  $('entete-chef').textContent = utilisateur.nom;

  reference = await API.get('/api/reference');
  $('annee').value = reference.semaineCourante.annee;
  $('semaine').value = reference.semaineCourante.semaine;

  surveillerReseau(() => ouvrirFiche(false));
  await ouvrirFiche();
}

$('btn-ouvrir').addEventListener('click', () => ouvrirFiche());
$('btn-quitter').addEventListener('click', deconnexion);
$('btn-code').addEventListener('click', changerCode);
$('btn-transmettre').addEventListener('click', transmettre);
$('btn-excel').addEventListener('click', () => {
  if (fiche) window.location.href = `/api/export/fiche/${fiche.id}.xlsx`;
});

async function changerCode() {
  const actuel = prompt('Code actuel :');
  if (!actuel) return;
  const nouveau = prompt('Nouveau code (4 à 8 chiffres) :');
  if (!nouveau) return;
  try {
    await API.post('/api/mon-code', { actuel, nouveau });
    message('Code modifié.', 'succes');
  } catch (e) {
    message(e.message, 'erreur');
  }
}

/* --------------------------------- Chargement ----------------------------- */

async function ouvrirFiche(afficherMessage = true) {
  const annee = Number($('annee').value);
  const semaine = Number($('semaine').value);
  try {
    const reponse = await API.post('/api/fiches/semaine', { annee, semaine });
    fiche = reponse.fiche;
    const detail = await API.get(`/api/fiches/${fiche.id}`);
    fiche = detail.fiche;
    afficher();
    if (afficherMessage) message(`Semaine ${semaine} ouverte.`, 'info', 2000);
  } catch (e) {
    message(e.message, 'erreur');
  }
}

function afficher() {
  $('contenu').classList.remove('masque');
  modifiable = ['brouillon', 'rejetee'].includes(fiche.statut);

  $('badge-statut').innerHTML = badgeStatut(fiche.statut);
  $('periode').textContent = `Du ${jourMois(fiche.dates[0])} au ${jourMois(fiche.dates[6])} ${fiche.annee}`;

  const motif = $('motif-rejet');
  motif.classList.toggle('masque', fiche.statut !== 'rejetee' || !fiche.motif_rejet);
  motif.textContent = fiche.motif_rejet ? `Renvoyée par le directeur : ${fiche.motif_rejet}` : '';

  for (const champ of document.querySelectorAll('[data-entete]')) {
    champ.value = fiche[champ.dataset.entete] || '';
    champ.disabled = !modifiable;
    champ.oninput = enregistrerPlusTard;
  }

  signaturesLignes = fiche.lignes.map((l) => l.signature || null);
  construireSalaries();
  construireSignatureResponsable();
  afficherAnomalies(fiche.anomalies || []);

  $('btn-transmettre').disabled = !modifiable;
  $('btn-transmettre').textContent = modifiable
    ? 'Contrôler et transmettre au directeur'
    : 'Fiche déjà transmise';
}

/* ------------------------------ Saisie des lignes ------------------------- */

function construireSalaries() {
  const zone = $('salaries');
  zone.innerHTML = '';

  fiche.lignes.forEach((ligne, index) => {
    const bloc = document.createElement('details');
    bloc.className = 'salarie';
    bloc.dataset.index = index;
    if (ligne.nom_affiche && index < 3) bloc.open = true;

    const options = reference.equipe
      .map((s) => {
        const nom = `${s.nom} ${s.prenom}`;
        return `<option value="${echapper(nom)}"${nom === ligne.nom_affiche ? ' selected' : ''}>${echapper(nom)}</option>`;
      })
      .join('');

    const jours = ligne.jours
      .map((jour, j) => {
        const codes = reference.codesAbsence
          .map((c) => `<option value="${c.code}"${c.code === jour.code_absence ? ' selected' : ''}>${c.code}</option>`)
          .join('');
        return `
          <div class="jour ${j >= 5 ? 'repos' : ''}">
            <div class="entete">${reference.joursCourts[j]}</div>
            <div class="date">${jourMois(fiche.dates[j])}</div>
            <input class="heures ${jour.code_absence ? 'absent' : ''}" data-jour="${j}"
                   inputmode="text" placeholder="—" value="${versTexte(jour.minutes)}">
            <select class="code" data-jour="${j}">
              <option value="">—</option>${codes}
            </select>
          </div>`;
      })
      .join('');

    bloc.innerHTML = `
      <summary>
        <span class="rang">${index + 1}</span>
        <span class="nom">${echapper(ligne.nom_affiche || 'Ligne libre')}</span>
        <span class="total">${versTexteTotal(ligne.total_minutes)}</span>
      </summary>
      <div class="corps">
        <div class="grille deux" style="margin-bottom:12px">
          <div>
            <label>Salarié</label>
            <select class="choix-salarie"><option value="">— aucun —</option>${options}</select>
          </div>
          <div>
            <label>ou saisir un nom</label>
            <input class="nom-libre" value="${echapper(ligne.nom_affiche)}" placeholder="NOM Prénom">
          </div>
        </div>

        <label>Heures de travail (hors repas et trajet)</label>
        <div class="jours">${jours}</div>

        <div class="grille trois" style="margin-top:14px">
          <div>
            <label>Heures route 100%</label>
            <input class="route" value="${versTexte(ligne.minutes_route)}" placeholder="0h00">
          </div>
          <div>
            <label>Heures trajet 50%</label>
            <input class="trajet" value="${versTexte(ligne.minutes_trajet)}" placeholder="0h00">
          </div>
          <div>
            <label>Jours en zone</label>
            <input class="zone" type="number" min="0" max="7" step="0.5" value="${ligne.jours_zone || ''}">
          </div>
          <div>
            <label>Type de masque</label>
            <select class="masque-type">
              <option value=""${!ligne.type_masque ? ' selected' : ''}>—</option>
              <option value="VA"${ligne.type_masque === 'VA' ? ' selected' : ''}>VA</option>
              <option value="AA"${ligne.type_masque === 'AA' ? ' selected' : ''}>AA</option>
            </select>
          </div>
          <div>
            <label>Nb déplacements</label>
            <input class="deplacement" type="number" min="0" step="1" value="${ligne.nb_deplacement || ''}">
          </div>
        </div>

        <div style="margin-top:12px">
          <label>Observations</label>
          <input class="observation" value="${echapper(ligne.observation)}">
        </div>

        <div style="margin-top:12px">
          <label>Signature du salarié (obligatoire)</label>
          <div class="signature">
            <div class="apercu-signature"></div>
            <canvas class="toile-signature"></canvas>
            <button class="petit effacer-signature" type="button" style="margin-top:6px">Effacer</button>
          </div>
        </div>
      </div>`;

    zone.appendChild(bloc);
    cablerLigne(bloc, index);
  });
}

function cablerLigne(bloc, index) {
  const surSaisie = () => {
    recalculerLigne(bloc, index);
    enregistrerPlusTard();
  };

  bloc.querySelectorAll('input, select').forEach((champ) => {
    champ.disabled = !modifiable;
    champ.addEventListener('input', surSaisie);
    champ.addEventListener('change', surSaisie);
  });

  const choix = bloc.querySelector('.choix-salarie');
  const libre = bloc.querySelector('.nom-libre');
  choix.addEventListener('change', () => {
    if (choix.value) libre.value = choix.value;
    bloc.querySelector('.nom').textContent = libre.value || 'Ligne libre';
    enregistrerPlusTard();
  });
  libre.addEventListener('input', () => {
    bloc.querySelector('.nom').textContent = libre.value || 'Ligne libre';
  });

  // Un code absence remet la journee a zero : les deux ne se cumulent pas.
  bloc.querySelectorAll('select.code').forEach((select) => {
    select.addEventListener('change', () => {
      const saisieHeures = bloc.querySelector(`input.heures[data-jour="${select.dataset.jour}"]`);
      saisieHeures.classList.toggle('absent', Boolean(select.value));
      if (select.value) saisieHeures.value = '';
    });
  });

  bloc.querySelectorAll('input.heures').forEach((champ) => {
    champ.addEventListener('blur', () => {
      const minutes = versMinutes(champ.value);
      champ.value = versTexte(minutes);
      recalculerLigne(bloc, index);
    });
  });
  for (const classe of ['.route', '.trajet']) {
    const champ = bloc.querySelector(classe);
    champ.addEventListener('blur', () => { champ.value = versTexte(versMinutes(champ.value)); });
  }

  const toile = bloc.querySelector('.toile-signature');
  const apercu = bloc.querySelector('.apercu-signature');
  if (signaturesLignes[index]) {
    apercu.innerHTML = `<img src="${signaturesLignes[index]}" alt="Signature enregistrée">`;
    toile.classList.add('masque');
  }
  const pad = activerSignature(toile, (image) => {
    signaturesLignes[index] = image;
    enregistrerPlusTard();
  });
  bloc.querySelector('.effacer-signature').addEventListener('click', () => {
    if (!modifiable) return;
    apercu.innerHTML = '';
    toile.classList.remove('masque');
    pad.effacer();
    signaturesLignes[index] = null;
    enregistrerPlusTard();
  });
}

function recalculerLigne(bloc, index) {
  let total = 0;
  bloc.querySelectorAll('input.heures').forEach((champ) => { total += versMinutes(champ.value); });
  bloc.querySelector('.total').textContent = versTexteTotal(total);
}

function construireSignatureResponsable() {
  const toile = $('signature-responsable');
  const conteneur = toile.parentElement;
  const ancienApercu = conteneur.querySelector('img');
  if (ancienApercu) ancienApercu.remove();

  if (fiche.signature_responsable) {
    const img = document.createElement('img');
    img.src = fiche.signature_responsable;
    img.alt = 'Signature du responsable';
    conteneur.insertBefore(img, toile);
    toile.classList.add('masque');
  } else {
    toile.classList.remove('masque');
  }

  const pad = activerSignature(toile, (image) => {
    fiche.signature_responsable = image;
    enregistrerPlusTard();
  });
  $('effacer-responsable').onclick = () => {
    if (!modifiable) return;
    const img = conteneur.querySelector('img');
    if (img) img.remove();
    toile.classList.remove('masque');
    pad.effacer();
    fiche.signature_responsable = null;
    enregistrerPlusTard();
  };
}

/* -------------------------------- Sauvegarde ------------------------------ */

function collecter() {
  const corps = { lignes: [] };
  for (const champ of document.querySelectorAll('[data-entete]')) corps[champ.dataset.entete] = champ.value;
  if (fiche.signature_responsable !== undefined) corps.signature_responsable = fiche.signature_responsable;

  document.querySelectorAll('.salarie').forEach((bloc, index) => {
    const jours = [];
    for (let j = 0; j < 7; j += 1) {
      jours.push({
        jour: j,
        minutes: versMinutes(bloc.querySelector(`input.heures[data-jour="${j}"]`).value),
        code_absence: bloc.querySelector(`select.code[data-jour="${j}"]`).value,
      });
    }
    const nom = bloc.querySelector('.nom-libre').value.trim();
    const choisi = reference.equipe.find((s) => `${s.nom} ${s.prenom}` === nom);
    corps.lignes.push({
      salarie_id: choisi ? choisi.id : null,
      nom_affiche: nom,
      minutes_route: versMinutes(bloc.querySelector('.route').value),
      minutes_trajet: versMinutes(bloc.querySelector('.trajet').value),
      jours_zone: Number(bloc.querySelector('.zone').value) || 0,
      type_masque: bloc.querySelector('.masque-type').value,
      nb_deplacement: Number(bloc.querySelector('.deplacement').value) || 0,
      observation: bloc.querySelector('.observation').value,
      signature: signaturesLignes[index] ?? null,
      jours,
    });
  });
  return corps;
}

async function enregistrer() {
  if (!fiche || !modifiable) return;
  const corps = collecter();
  $('etat-sauvegarde').textContent = 'Enregistrement…';
  try {
    const reponse = await API.put(`/api/fiches/${fiche.id}`, corps);
    fiche = { ...reponse.fiche, anomalies: reponse.anomalies };
    afficherAnomalies(reponse.anomalies || []);
    $('etat-sauvegarde').textContent = `Enregistré à ${new Date().toLocaleTimeString('fr-FR')}`;
  } catch (e) {
    FileAttente.ajouter(fiche.id, corps);
    $('etat-sauvegarde').textContent = 'Conservé sur l’appareil — sera transmis au retour du réseau.';
  }
}

const enregistrerPlusTard = antiRebond(enregistrer, 1200);

/* -------------------------------- Contrôles ------------------------------- */

function afficherAnomalies(anomalies) {
  const liste = $('anomalies');
  liste.innerHTML = '';
  if (!anomalies.length) {
    liste.innerHTML = '<li style="background:#e2f4ea;border-color:var(--vert)" class="alerte">Aucune anomalie détectée : la fiche peut être transmise.</li>';
    return;
  }
  for (const anomalie of anomalies) {
    const li = document.createElement('li');
    li.className = anomalie.niveau;
    li.textContent = `${anomalie.niveau === 'bloquant' ? 'À corriger' : 'À vérifier'} — ${anomalie.message}`;
    liste.appendChild(li);
  }
}

async function transmettre() {
  await enregistrer();
  try {
    const reponse = await API.post(`/api/fiches/${fiche.id}/soumettre`);
    fiche = reponse.fiche;
    afficher();
    message('Fiche transmise au directeur.', 'succes');
  } catch (e) {
    if (e.anomalies) afficherAnomalies(e.anomalies);
    message(e.message, 'erreur');
    $('bloc-controles').scrollIntoView({ behavior: 'smooth' });
  }
}

demarrer().catch((e) => message(e.message, 'erreur'));
