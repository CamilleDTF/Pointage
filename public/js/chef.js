/*
 * Espace chef d'equipe. Deux presentations de la meme fiche :
 *  - "cartes"  : une carte depliante par salarie, pour la saisie au telephone ;
 *  - "tableau" : la grille complete de la fiche papier, pour le PC portable.
 * Les deux produisent le meme balisage de champs, donc un seul collecteur.
 */

let reference = null;
let fiche = null;
let signaturesLignes = [];
let modifiable = true;
let presentation = window.matchMedia('(min-width: 1024px)').matches ? 'tableau' : 'cartes';

const $ = (id) => document.getElementById(id);

/* ------------------------------ Initialisation ---------------------------- */

async function demarrer() {
  const { utilisateur } = await API.get('/api/moi');
  if (utilisateur.role === 'directeur') {
    location.href = '/directeur.html';
    return;
  }
  definirRole('chef');
  $('entete-chef').textContent = utilisateur.nom;

  reference = await API.get('/api/reference');
  $('annee').value = reference.semaineCourante.annee;
  $('semaine').value = reference.semaineCourante.semaine;

  $('annee-calendrier').value = reference.semaineCourante.annee;
  // Deplie sur grand ecran ; replie sur telephone, ou 53 semaines separeraient
  // le chef de sa fiche.
  $('bloc-calendrier').open = window.matchMedia('(min-width: 1024px)').matches;
  majBoutonPresentation();
  surveillerReseau();
  await chargerCalendrier();
  await ouvrirFiche();
}

$('annee-calendrier').addEventListener('change', chargerCalendrier);

/* -------------------------- Calendrier de l'annee ------------------------- */

/** Vue d'ensemble : chaque semaine de l'annee avec l'etat de sa fiche. */
async function chargerCalendrier() {
  const annee = Number($('annee-calendrier').value);
  let donnees;
  try {
    donnees = await API.get(`/api/calendrier?annee=${annee}`);
  } catch (e) {
    message(e.message, 'erreur');
    return;
  }

  const aTraiter = [
    ['rejetee', donnees.totaux.rejetee],
    ['manquante', donnees.totaux.manquante],
    ['brouillon', donnees.totaux.brouillon],
    ['soumise', donnees.totaux.soumise],
    ['validee', donnees.totaux.validee],
  ];
  $('resume-calendrier').innerHTML = aTraiter
    .filter(([, nombre]) => nombre > 0)
    .map(([etat, nombre]) => `<span class="etat ${etat}">${nombre} ${echapper(etiquetteStatut(etat))}</span>`)
    .join('');

  const parMois = new Map();
  for (const semaine of donnees.semaines) {
    if (!parMois.has(semaine.mois)) parMois.set(semaine.mois, []);
    parMois.get(semaine.mois).push(semaine);
  }

  $('calendrier').innerHTML = [...parMois.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([mois, semaines]) => `
      <div class="mois">
        <h3>${Regles.MOIS[mois - 1]}</h3>
        <div class="semaines">${semaines.map(caseSemaine).join('')}</div>
      </div>`)
    .join('');

  $('calendrier').querySelectorAll('.case-semaine').forEach((bouton) => {
    bouton.addEventListener('click', () => {
      $('annee').value = donnees.annee;
      $('semaine').value = bouton.dataset.semaine;
      ouvrirFiche();
      $('contenu').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function caseSemaine(semaine) {
  const fiche = semaine.fiche;
  // Le chantier quand il existe, sinon l'etat en toutes lettres : la couleur
  // seule ne suffit pas a qui la distingue mal.
  const detail = fiche && fiche.chantier
    ? echapper(fiche.chantier)
    : semaine.etat === 'avenir' ? '' : echapper(etiquetteStatut(semaine.etat));
  return `
    <button type="button" class="case-semaine ${semaine.etat}${semaine.courante ? ' courante' : ''}"
            data-semaine="${semaine.semaine}"
            title="${echapper(etiquetteStatut(semaine.etat))}">
      <span class="numero">S${String(semaine.semaine).padStart(2, '0')}</span>
      <span class="dates">${jourMois(semaine.debut)} – ${jourMois(semaine.fin)}</span>
      <span class="detail">${detail}</span>
      ${semaine.courante ? '<span class="marque">cette semaine</span>' : ''}
    </button>`;
}

$('btn-ouvrir').addEventListener('click', () => ouvrirFiche());
$('btn-quitter').addEventListener('click', deconnexion);
$('btn-code').addEventListener('click', changerCode);
$('btn-transmettre').addEventListener('click', transmettre);
$('btn-presentation').addEventListener('click', () => {
  presentation = presentation === 'tableau' ? 'cartes' : 'tableau';
  majBoutonPresentation();
  construireSalaries();
});
$('btn-excel').addEventListener('click', () => {
  if (fiche) window.location.href = `/api/export/fiche/${fiche.id}.xlsx`;
});

function majBoutonPresentation() {
  $('btn-presentation').textContent = presentation === 'tableau' ? 'Vue téléphone' : 'Vue tableau';
  $('btn-presentation').title =
    presentation === 'tableau'
      ? 'Basculer vers la saisie en cartes, adaptée au téléphone'
      : 'Basculer vers la grille complète, adaptée au PC portable';
}

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
    const detail = await API.get(`/api/fiches/${reponse.fiche.id}`);
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

/* --------------------------- Fragments de formulaire ---------------------- */

/**
 * Un seul champ pour le nom, avec l'equipe du chef en autocompletion : il choisit
 * dans sa liste en deux frappes, et reste libre de saisir un renfort ponctuel.
 */
function listeEquipe() {
  return `<datalist id="liste-equipe">${reference.equipe
    .map((s) => `<option value="${echapper(`${s.nom} ${s.prenom}`)}"></option>`)
    .join('')}</datalist>`;
}

function champNom(ligne) {
  return `<input class="nom-libre" list="liste-equipe" value="${echapper(ligne.nom_affiche)}"
                 placeholder="NOM Prénom" autocomplete="off">`;
}

function optionsCodes(codeActuel) {
  return reference.codesAbsence
    .map((c) => `<option value="${c.code}"${c.code === codeActuel ? ' selected' : ''}>${c.code}</option>`)
    .join('');
}

function optionsMasque(actuel) {
  return ['', 'VA', 'AA']
    .map((v) => `<option value="${v}"${v === actuel ? ' selected' : ''}>${v || '—'}</option>`)
    .join('');
}

/* ------------------------------ Saisie des lignes ------------------------- */

function construireSalaries() {
  const zone = $('salaries');
  zone.className = presentation === 'tableau' ? 'enveloppe-table' : '';
  zone.innerHTML = presentation === 'tableau' ? gabaritTableau() : '';

  if (presentation === 'cartes') {
    zone.insertAdjacentHTML('beforeend', listeEquipe());
    fiche.lignes.forEach((ligne, index) => {
      zone.appendChild(carteSalarie(ligne, index));
    });
  }

  document.querySelectorAll('[data-ligne]').forEach((conteneur) => {
    cablerLigne(conteneur, Number(conteneur.dataset.ligne));
  });
}

function carteSalarie(ligne, index) {
  const bloc = document.createElement('details');
  bloc.className = 'salarie';
  bloc.dataset.ligne = index;
  if (ligne.nom_affiche && index < 3) bloc.open = true;

  const jours = ligne.jours
    .map(
      (jour, j) => `
        <div class="jour ${j >= 5 ? 'repos' : ''}">
          <div class="entete">${reference.joursCourts[j]}</div>
          <div class="date">${jourMois(fiche.dates[j])}</div>
          <input class="heures ${jour.code_absence ? 'absent' : ''}" data-jour="${j}"
                 inputmode="text" placeholder="—" value="${versSaisie(jour.minutes)}">
          <select class="code" data-jour="${j}">
            <option value="">—</option>${optionsCodes(jour.code_absence)}
          </select>
        </div>`
    )
    .join('');

  bloc.innerHTML = `
    <summary>
      <span class="rang">${index + 1}</span>
      <span class="nom">${echapper(ligne.nom_affiche || 'Ligne libre')}</span>
      <span class="total">${versTexte(ligne.total_minutes)}</span>
    </summary>
    <div class="corps">
      <div style="margin-bottom:12px">
        <label>Salarié</label>
        ${champNom(ligne)}
      </div>

      <label>Heures de travail (hors repas et trajet)</label>
      <div class="jours">${jours}</div>

      <div class="grille trois" style="margin-top:14px">
        <div><label>Heures route 100%</label><input class="route" value="${versSaisie(ligne.minutes_route)}" placeholder="0h00"></div>
        <div><label>Heures trajet 50%</label><input class="trajet" value="${versSaisie(ligne.minutes_trajet)}" placeholder="0h00"></div>
        <div><label>Jours en zone</label><input class="zone" type="number" min="0" max="7" step="0.5" value="${ligne.jours_zone || ''}"></div>
        <div><label>Type de masque</label><select class="masque-type">${optionsMasque(ligne.type_masque)}</select></div>
        <div><label>Nb déplacements</label><input class="deplacement" type="number" min="0" step="1" value="${ligne.nb_deplacement || ''}"></div>
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

  return bloc;
}

function gabaritTableau() {
  const entetesJours = fiche.dates
    .map(
      (iso, j) =>
        `<th class="num ${j >= 5 ? 'weekend' : ''}">${reference.joursCourts[j]}<br><small>${jourMois(iso)}</small></th>`
    )
    .join('');

  const rangs = fiche.lignes
    .map((ligne, index) => {
      const cellulesJours = ligne.jours
        .map(
          (jour, j) => `
            <td class="num ${j >= 5 ? 'weekend' : ''}">
              <input class="cellule heures ${jour.code_absence ? 'absent' : ''}" data-jour="${j}"
                     value="${versSaisie(jour.minutes)}" placeholder="—">
              <select class="cellule code" data-jour="${j}"><option value="">—</option>${optionsCodes(jour.code_absence)}</select>
            </td>`
        )
        .join('');

      return `
        <tr data-ligne="${index}">
          <td class="cellule-nom">${champNom(ligne)}</td>
          ${cellulesJours}
          <td class="num total">${versTexte(ligne.total_minutes)}</td>
          <td class="num"><input class="cellule route" value="${versSaisie(ligne.minutes_route)}" placeholder="0h00"></td>
          <td class="num"><input class="cellule trajet" value="${versSaisie(ligne.minutes_trajet)}" placeholder="0h00"></td>
          <td class="num"><input class="cellule zone" type="number" min="0" max="7" step="0.5" value="${ligne.jours_zone || ''}"></td>
          <td class="num"><select class="cellule masque-type">${optionsMasque(ligne.type_masque)}</select></td>
          <td class="num"><input class="cellule deplacement" type="number" min="0" step="1" value="${ligne.nb_deplacement || ''}"></td>
          <td><input class="cellule observation" value="${echapper(ligne.observation)}"></td>
          <td class="num"><button type="button" class="petit signer">Signer</button></td>
        </tr>`;
    })
    .join('');

  return `
    ${listeEquipe()}
    <table class="grille-pointage">
      <thead><tr>
        <th style="min-width:165px">Nom - Prénom</th>${entetesJours}
        <th class="num">Total<br>semaine</th><th class="num">Route<br>100%</th><th class="num">Trajet<br>50%</th>
        <th class="num">Jours<br>zone</th><th class="num">Masque</th><th class="num">Nb<br>dépl.</th>
        <th style="min-width:110px">Observations</th><th class="num">Signature</th>
      </tr></thead>
      <tbody>${rangs}</tbody>
    </table>`;
}

function cablerLigne(conteneur, index) {
  const surSaisie = () => {
    recalculerLigne(conteneur);
    enregistrerPlusTard();
  };

  conteneur.querySelectorAll('input, select').forEach((champ) => {
    champ.disabled = !modifiable;
    champ.addEventListener('input', surSaisie);
    champ.addEventListener('change', surSaisie);
  });
  conteneur.querySelectorAll('button').forEach((bouton) => { bouton.disabled = !modifiable; });

  const libre = conteneur.querySelector('.nom-libre');
  const etiquette = conteneur.querySelector('.nom');
  libre.addEventListener('input', () => {
    if (etiquette) etiquette.textContent = libre.value || 'Ligne libre';
  });

  // Un code absence remet la journee a zero : les deux ne se cumulent pas.
  conteneur.querySelectorAll('select.code').forEach((select) => {
    select.addEventListener('change', () => {
      const saisie = conteneur.querySelector(`input.heures[data-jour="${select.dataset.jour}"]`);
      saisie.classList.toggle('absent', Boolean(select.value));
      if (select.value) saisie.value = '';
      recalculerLigne(conteneur);
    });
  });

  conteneur.querySelectorAll('input.heures').forEach((champ) => {
    champ.addEventListener('blur', () => {
      champ.value = versSaisie(versMinutes(champ.value));
      recalculerLigne(conteneur);
    });
  });
  for (const classe of ['.route', '.trajet']) {
    const champ = conteneur.querySelector(classe);
    champ.addEventListener('blur', () => { champ.value = versSaisie(versMinutes(champ.value)); });
  }

  cablerSignature(conteneur, index);
}

function cablerSignature(conteneur, index) {
  const bouton = conteneur.querySelector('button.signer');
  if (bouton) {
    // Vue tableau : la signature ne tient pas dans une cellule, on l'ouvre en fenetre.
    const rafraichir = () => {
      bouton.textContent = signaturesLignes[index] ? 'Signée ✔' : 'Signer';
      bouton.classList.toggle('valide', Boolean(signaturesLignes[index]));
    };
    rafraichir();
    bouton.addEventListener('click', () => {
      ouvrirFenetreSignature(conteneur.querySelector('.nom-libre').value, index, rafraichir);
    });
    return;
  }

  const toile = conteneur.querySelector('.toile-signature');
  const apercu = conteneur.querySelector('.apercu-signature');
  if (signaturesLignes[index]) {
    apercu.innerHTML = `<img src="${signaturesLignes[index]}" alt="Signature enregistrée">`;
    toile.classList.add('masque');
  }
  const pad = activerSignature(toile, (image) => {
    signaturesLignes[index] = image;
    enregistrerPlusTard();
  });
  conteneur.querySelector('.effacer-signature').addEventListener('click', () => {
    if (!modifiable) return;
    apercu.innerHTML = '';
    toile.classList.remove('masque');
    pad.effacer();
    signaturesLignes[index] = null;
    enregistrerPlusTard();
  });
}

function ouvrirFenetreSignature(nom, index, auxChangements) {
  const fenetre = document.createElement('div');
  fenetre.className = 'fenetre';
  fenetre.innerHTML = `
    <div class="fenetre-corps">
      <h2>Signature — ${echapper(nom || `ligne ${index + 1}`)}</h2>
      <div class="signature"><canvas class="toile-signature" style="height:180px"></canvas></div>
      <div class="rangee" style="margin-top:12px">
        <button type="button" class="petit effacer">Effacer</button>
        <span class="pousse"></span>
        <button type="button" class="petit fermer">Annuler</button>
        <button type="button" class="petit principal valider">Enregistrer</button>
      </div>
    </div>`;
  document.body.appendChild(fenetre);

  const toile = fenetre.querySelector('.toile-signature');
  let capturee = signaturesLignes[index];
  const pad = activerSignature(toile, (image) => { capturee = image; });
  if (signaturesLignes[index]) {
    const img = new Image();
    img.onload = () => toile.getContext('2d').drawImage(img, 0, 0, toile.clientWidth, toile.clientHeight);
    img.src = signaturesLignes[index];
  }

  const fermer = () => fenetre.remove();
  fenetre.querySelector('.effacer').addEventListener('click', () => { pad.effacer(); capturee = null; });
  fenetre.querySelector('.fermer').addEventListener('click', fermer);
  fenetre.addEventListener('click', (e) => { if (e.target === fenetre) fermer(); });
  fenetre.querySelector('.valider').addEventListener('click', () => {
    signaturesLignes[index] = capturee;
    auxChangements();
    enregistrerPlusTard();
    fermer();
  });
}

function recalculerLigne(conteneur) {
  let total = 0;
  conteneur.querySelectorAll('input.heures').forEach((champ) => { total += versMinutes(champ.value); });
  conteneur.querySelector('.total').textContent = versTexte(total);
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

  document.querySelectorAll('[data-ligne]').forEach((conteneur) => {
    const index = Number(conteneur.dataset.ligne);
    const jours = [];
    for (let j = 0; j < 7; j += 1) {
      jours.push({
        jour: j,
        minutes: versMinutes(conteneur.querySelector(`input.heures[data-jour="${j}"]`).value),
        code_absence: conteneur.querySelector(`select.code[data-jour="${j}"]`).value,
      });
    }
    const nom = conteneur.querySelector('.nom-libre').value.trim();
    const choisi = reference.equipe.find((s) => `${s.nom} ${s.prenom}` === nom);
    corps.lignes.push({
      salarie_id: choisi ? choisi.id : null,
      nom_affiche: nom,
      minutes_route: versMinutes(conteneur.querySelector('.route').value),
      minutes_trajet: versMinutes(conteneur.querySelector('.trajet').value),
      jours_zone: Number(conteneur.querySelector('.zone').value) || 0,
      type_masque: conteneur.querySelector('.masque-type').value,
      nb_deplacement: Number(conteneur.querySelector('.deplacement').value) || 0,
      observation: conteneur.querySelector('.observation').value,
      signature: signaturesLignes[index] ?? null,
      jours,
    });
  });
  return corps;
}

async function enregistrer() {
  if (!fiche || !modifiable) return;
  const corps = collecter();

  // Controle immediat, avec les memes regles que le serveur : le chef voit ce
  // qui manque sans attendre la reponse.
  afficherAnomalies(controlerFiche({ ...fiche, ...corps }, corps.lignes));

  $('etat-sauvegarde').textContent = 'Enregistrement…';
  try {
    const reponse = await API.put(`/api/fiches/${fiche.id}`, corps);
    fiche = { ...reponse.fiche, anomalies: reponse.anomalies };
    afficherAnomalies(reponse.anomalies || []);
    $('etat-sauvegarde').textContent = `Enregistré à ${new Date().toLocaleTimeString('fr-FR')}`;
  } catch (e) {
    FileAttente.ajouter(fiche.id, corps);
    $('etat-sauvegarde').textContent = 'Connexion perdue — saisie conservée, transmise dès son rétablissement.';
  }
}

const enregistrerPlusTard = antiRebond(enregistrer, 1200);

/* -------------------------------- Contrôles ------------------------------- */

function afficherAnomalies(anomalies) {
  const liste = $('anomalies');
  liste.innerHTML = '';
  if (!anomalies.length) {
    liste.innerHTML =
      '<li class="conforme">Aucune anomalie détectée : la fiche peut être transmise.</li>';
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
    await chargerCalendrier();
    message('Fiche transmise au directeur.', 'succes');
  } catch (e) {
    if (e.anomalies) afficherAnomalies(e.anomalies);
    message(e.message, 'erreur');
    $('bloc-controles').scrollIntoView({ behavior: 'smooth' });
  }
}

demarrer().catch((e) => message(e.message, 'erreur'));
