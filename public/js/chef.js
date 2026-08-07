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
let differerEnregistrement = null;

const $ = (id) => document.getElementById(id);

/*
 * Cablage tolerant d'un bouton.
 *
 * Un `$('...').addEventListener(...)` sur un identifiant absent leve une erreur
 * qui interrompt tout le reste du fichier : les ecouteurs suivants ne sont plus
 * poses, la page ne demarre pas, et le chef d'equipe se retrouve devant un
 * ecran vide sans savoir pourquoi. C'est arrive avec un chef.html d'une version
 * anterieure servi avec ce script. Un bouton manquant ne doit couter que ce
 * bouton.
 */
const elementsAbsents = [];

/** Applique une preparation a un element, en notant son absence sans echouer. */
function poser(id, preparation) {
  const element = $(id);
  if (!element) {
    if (!elementsAbsents.includes(id)) elementsAbsents.push(id);
    return;
  }
  preparation(element);
}

function surClic(id, action) {
  poser(id, (bouton) => bouton.addEventListener('click', action));
}

/**
 * Si des elements attendus manquent, la page affichee vient d'une version
 * anterieure au script — un cache navigateur qui n'a pas suivi. Le dire est
 * plus utile que de laisser des fonctions disparaitre en silence.
 */
function signalerPagePerimee() {
  if (!elementsAbsents.length) return;
  console.warn('Elements absents de la page :', elementsAbsents.join(', '));
  message(
    'La page affichée date d’une version antérieure. Rechargez avec Ctrl+Maj+R (ou Cmd+Maj+R).',
    'erreur',
    15000
  );
}

/* ------------------------------ Initialisation ---------------------------- */

async function demarrer() {
  const { utilisateur } = await API.get('/api/moi');
  if (utilisateur.role === 'directeur') {
    location.href = '/directeur.html';
    return;
  }
  definirRole('chef');
  reference = await API.get('/api/reference');

  const grandEcran = window.matchMedia('(min-width: 1024px)').matches;
  // Chaque element est facultatif : une page d'une version anterieure doit
  // perdre une fonction, jamais l'ecran entier.
  poser('entete-chef', (e) => { e.textContent = `${utilisateur.nom} · version ${reference.version}`; });
  poser('annee', (e) => { e.value = reference.semaineCourante.annee; });
  poser('semaine', (e) => { e.value = reference.semaineCourante.semaine; });
  poser('annee-calendrier', (e) => { e.value = reference.semaineCourante.annee; });
  // Deplie sur grand ecran ; replie sur telephone, ou 53 semaines separeraient
  // le chef de sa fiche.
  poser('bloc-calendrier', (e) => { e.open = grandEcran; });

  construireListeVehicules();
  construireLegendeCodes();
  construireChoixConducteur();
  majBoutonPresentation();
  surveillerReseau();
  signalerPagePerimee();
  await chargerCalendrier();
  await ouvrirFiche();
}

if ($('annee-calendrier')) $('annee-calendrier').addEventListener('change', chargerCalendrier);

/* -------------------------- Chantier et vehicule -------------------------- */

/*
 * La ville du chantier reste saisie, mais elle ne decide plus de rien.
 *
 * Le taux de grand deplacement se deduisait d'elle — Paris et Nice au taux 80,
 * le reste au taux 72. C'etait faux dans les deux sens : un meme chantier peut
 * relever des deux selon les jours, et la ville ne dit pas sous quel taux
 * chaque salarie a dormi. Ce sont maintenant deux colonnes du tableau, comptees
 * en jours par le chef d'equipe, qui le disent.
 */

/** Le parc en liste : le type de vehicule se deduit de l'immatriculation. */
function construireListeVehicules() {
  poser('immatriculation', (select) => {
    const parc = reference.vehicules || [];
    // L'immatriculation seule : le type de vehicule s'affiche juste a cote, dans
    // son propre champ. Le repeter ici ne ferait qu'allonger la liste.
    select.innerHTML =
      '<option value="">—</option>' +
      parc.map((v) => `<option value="${echapper(v.immatriculation)}">${echapper(v.immatriculation)}</option>`).join('');
    select.addEventListener('change', () => {
      appliquerVehicule(select.value);
      enregistrerPlusTard();
    });
  });
}

function appliquerVehicule(immatriculation) {
  const vehicule = (reference.vehicules || []).find((v) => v.immatriculation === immatriculation);
  poser('type_vehicule', (champ) => {
    champ.value = vehicule ? `${vehicule.marque} ${vehicule.modele}`.trim() : '';
  });
}

/**
 * Qui doit viser cette fiche. Le chef choisit lui-meme : d'une semaine a
 * l'autre le chantier peut relever d'un autre conducteur de travaux, et c'est
 * lui qui le sait. Son rattachement habituel n'est qu'une proposition.
 */
function construireChoixConducteur() {
  const conducteurs = reference.conducteurs || [];

  poser('bloc-conducteur', (bloc) => {
    // Aucun conducteur enregistre : l'etape n'existe pas encore, on n'affiche
    // pas un choix vide dont personne ne comprendrait l'objet.
    bloc.classList.toggle('masque', conducteurs.length === 0);
  });

  poser('conducteur_id', (select) => {
    select.innerHTML =
      '<option value="">— choisir —</option>' +
      conducteurs.map((c) => `<option value="${c.id}">${echapper(c.nom)}</option>`).join('');
    select.addEventListener('change', enregistrerPlusTard);
  });

  poser('aide-conducteur', (aide) => {
    aide.textContent = conducteurs.length
      ? "Il verra la fiche dans sa page « Fiches à viser » dès la transmission, et pourra la viser " +
        'ou vous la renvoyer avec un commentaire. Vous pourrez le prévenir par SMS ou WhatsApp.'
      : '';
  });
}

/** Le bas de la fiche papier, repris a l'ecran : chaque code et son libelle. */
function construireLegendeCodes() {
  poser('legende-codes', (corps) => {
    corps.innerHTML = reference.codesAbsence
      .map((c) => `<tr><td>${echapper(c.libelle)}</td><td class="code">${echapper(c.code)}</td></tr>`)
      .join('');
  });
}

/* -------------------------- Calendrier de l'annee ------------------------- */

/** Vue d'ensemble : chaque semaine de l'annee avec l'etat de sa fiche. */
async function chargerCalendrier() {
  if (!$('calendrier')) return; // page d'une version anterieure : pas de calendrier a remplir
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
  poser('resume-calendrier', (zone) => {
    zone.innerHTML = aTraiter
      .filter(([, nombre]) => nombre > 0)
      .map(([etat, nombre]) => `<span class="etat ${etat}">${nombre} ${echapper(etiquetteStatut(etat))}</span>`)
      .join('');
  });

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

  // Les semaines grisees d'avant la mise en service ne sont pas un oubli : on
  // le dit, plutot que de laisser deviner pourquoi elles sont eteintes.
  const grisees = donnees.semaines.some((s) => s.etat === 'horsPerimetre');
  poser('note-mise-en-service', (note) => {
    const echeance =
      donnees.delaiJours === 1
        ? ' La fiche de la semaine est attendue pour le lundi qui suit.'
        : donnees.delaiJours
          ? ` La fiche de la semaine est attendue sous ${donnees.delaiJours} jours après le dimanche.`
          : '';
    const papier =
      grisees && donnees.debutService
        ? ` Les semaines antérieures au ${dateFrancaise(donnees.debutService)} ont été pointées sur papier : elles n'ont rien à recevoir ici.`
        : '';
    note.textContent = echeance + papier;
  });

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
    : ['avenir', 'horsPerimetre'].includes(semaine.etat) ? '' : echapper(etiquetteStatut(semaine.etat));
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

surClic('btn-ouvrir', () => ouvrirFiche());
surClic('btn-quitter', deconnexion);
surClic('btn-code', changerCode);
surClic('btn-transmettre', transmettre);
surClic('btn-reprendre', reprendre);
surClic('btn-presentation', () => {
  presentation = presentation === 'tableau' ? 'cartes' : 'tableau';
  majBoutonPresentation();
  construireSalaries();
  // La grille vient d etre reconstruite : les champs en rouge sont a reposer.
  if (fiche) afficherAnomalies(fiche.anomalies || []);
});
surClic('btn-excel', () => {
  if (fiche) window.location.href = `/api/export/fiche/${fiche.id}.xlsx`;
});
surClic('btn-jours-vides', marquerJoursNonTravailles);

/**
 * Declare non travaillees toutes les journees ouvrables restees vides. Saisir
 * "0" case par case revient a taper cinq fois par salarie absent une semaine :
 * ce bouton fait le meme geste d'un coup, sans jamais toucher a ce qui est
 * deja renseigne.
 */
function marquerJoursNonTravailles() {
  if (!modifiable) return;
  let remplies = 0;

  document.querySelectorAll('[data-ligne]').forEach((conteneur) => {
    if (!conteneur.querySelector('.nom-libre').value.trim()) return;
    for (let j = 0; j <= 4; j += 1) {
      const heures = conteneur.querySelector(`input.heures[data-jour="${j}"]`);
      const code = conteneur.querySelector(`select.code[data-jour="${j}"]`);
      if (heures.value.trim() !== '' || code.value) continue;
      heures.value = versTexte(0);
      remplies += 1;
    }
    recalculerLigne(conteneur);
  });

  if (!remplies) {
    message('Aucune journée vide : tout est déjà renseigné.', 'info', 3000);
    return;
  }
  message(`${remplies} journée(s) déclarée(s) non travaillée(s).`, 'succes', 3000);
  enregistrer();
}

function majBoutonPresentation() {
  poser('btn-presentation', (bouton) => {
    bouton.textContent = presentation === 'tableau' ? 'Vue téléphone' : 'Vue tableau';
    bouton.title =
      presentation === 'tableau'
        ? 'Basculer vers la saisie en cartes, adaptée au téléphone'
        : 'Basculer vers la grille complète, adaptée au PC portable';
  });
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

  $('badge-statut').innerHTML = badgeStatut(Regles.etatAffiche(fiche));
  $('periode').textContent = `Du ${jourMois(fiche.dates[0])} au ${jourMois(fiche.dates[6])} ${fiche.annee}`;

  const motif = $('motif-rejet');
  motif.classList.toggle('masque', fiche.statut !== 'rejetee' || !fiche.motif_rejet);
  motif.textContent = fiche.motif_rejet ? `Renvoyée par le directeur : ${fiche.motif_rejet}` : '';

  for (const champ of document.querySelectorAll('[data-entete]')) {
    champ.value = fiche[champ.dataset.entete] || '';
    champ.disabled = !modifiable;
    champ.oninput = enregistrerPlusTard;
  }

  if (!fiche.type_vehicule) appliquerVehicule(fiche.immatriculation);

  // A defaut de choix deja fait, on propose le conducteur habituel du chef.
  poser('conducteur_id', (select) => {
    select.value = String(fiche.conducteur_id || reference.conducteurParDefaut || '');
  });

  signaturesLignes = fiche.lignes.map((l) => l.signature || null);
  construireSalaries();
  construireSignatureResponsable();
  afficherAnomalies(fiche.anomalies || []);

  $('btn-transmettre').disabled = !modifiable;
  // Sans conducteur enregistre, l'etape du visa n'existe pas : la fiche part
  // directement au directeur et le bouton doit dire ou elle va vraiment.
  const versConducteur = (reference.conducteurs || []).length > 0;
  $('btn-transmettre').textContent = !modifiable
    ? 'Fiche déjà transmise'
    : versConducteur
      ? 'Contrôler et transmettre au conducteur de travaux'
      : 'Contrôler et transmettre au directeur';

  // Une fiche transmise mais pas encore validee se reprend d'un clic : il ne
  // faut plus attendre une reouverture de la direction pour une virgule.
  poser('btn-reprendre', (bouton) => {
    bouton.classList.toggle('masque', fiche.statut !== 'soumise');
  });
}

/* --------------------------- Fragments de formulaire ---------------------- */

/**
 * Un seul champ pour le nom, avec tout l'effectif en autocompletion.
 *
 * Son equipe vient en tete — c'est elle qu'il saisit tous les jours — mais un
 * chantier reunit souvent des operateurs venus d'ailleurs : ils doivent pouvoir
 * etre pointes sans attendre une reaffectation par le directeur. L'etiquette
 * de chaque proposition dit d'ou vient la personne.
 */
function listeEquipe() {
  const siens = new Set(reference.equipe.map((s) => s.id));
  const propositions = [...(reference.effectif || reference.equipe)].sort((a, b) => {
    const rang = (s) => (siens.has(s.id) ? 0 : 1);
    return rang(a) - rang(b) || `${a.nom} ${a.prenom}`.localeCompare(`${b.nom} ${b.prenom}`, 'fr');
  });

  return `<datalist id="liste-equipe">${propositions
    .map((s) => `<option value="${echapper(`${s.nom} ${s.prenom}`)}"
                         label="${siens.has(s.id) ? 'mon équipe' : 'autre équipe'}"></option>`)
    .join('')}</datalist>`;
}

/** La personne designee par un nom saisi, cherchee dans tout l'effectif. */
function salarieParNom(nom) {
  const liste = reference.effectif || reference.equipe;
  return liste.find((s) => Regles.memePersonne(`${s.nom} ${s.prenom}`, nom)) || null;
}

function champNom(ligne) {
  // L'identifiant du salarie rattache voyage avec le champ : c'est lui qui
  // permet de proposer une correction d'identite plutot qu'une simple retouche
  // de la ligne.
  const rattache = ligne.salarie_id ? ` data-salarie="${ligne.salarie_id}"` : '';
  return `<span class="champ-nom">
      <input class="nom-libre" list="liste-equipe" value="${echapper(ligne.nom_affiche)}"
             placeholder="NOM Prénom" autocomplete="off"${rattache}>
      <button type="button" class="corriger-nom masque" title="Corriger l'identité dans le fichier du personnel">✎</button>
    </span>`;
}

/**
 * Le chef d'equipe a la personne devant lui : c'est lui qui voit le premier
 * qu'un prenom est mal orthographie ou qu'un nom compose a ete tronque a
 * l'import. Il corrige donc l'identite directement, sans passer par le
 * directeur — et la correction vaut pour tout l'effectif, pas seulement pour
 * cette semaine.
 */
function cablerCorrectionNom(conteneur) {
  const libre = conteneur.querySelector('.nom-libre');
  const bouton = conteneur.querySelector('.corriger-nom');
  if (!libre || !bouton) return;

  const salarie = () => {
    const id = Number(libre.dataset.salarie);
    return id ? (reference.effectif || []).find((s) => s.id === id) : null;
  };

  const rafraichir = () => {
    const s = salarie();
    const saisi = libre.value.trim();
    // Le bouton n'apparait que si le nom saisi differe de la fiche du salarie
    // rattache, et qu'il ne designe pas quelqu'un d'autre de l'effectif.
    const utile = Boolean(s) && saisi !== '' && !Regles.memePersonne(`${s.nom} ${s.prenom}`, saisi) && !salarieParNom(saisi);
    bouton.classList.toggle('masque', !utile);
    if (utile) bouton.title = `Corriger l'identité de ${s.nom} ${s.prenom} dans le fichier du personnel`;
  };

  libre.addEventListener('input', rafraichir);
  rafraichir();

  bouton.addEventListener('click', async () => {
    const s = salarie();
    const saisi = libre.value.trim();
    if (!s || !saisi) return;
    const { nom, prenom } = Regles.separerNomPrenom(saisi);
    if (!confirm(`Remplacer « ${s.nom} ${s.prenom} » par « ${nom} ${prenom} » dans le fichier du personnel ?`)) return;

    try {
      await API.put(`/api/salaries/${s.id}/nom`, { nom, prenom });
      reference = await API.get('/api/reference');
      s.nom = nom;
      s.prenom = prenom;
      rafraichir();
      message('Identité corrigée pour toute l’équipe.', 'succes');
      enregistrerPlusTard();
    } catch (e) {
      message(e.message, 'erreur');
    }
  });
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
                 inputmode="text" placeholder="—" value="${Regles.versSaisieJour(jour)}">
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
        <div><label>Jours GD 72</label><input class="gd72" type="number" min="0" max="7" step="1" value="${ligne.nb_gd72 || ''}"></div>
        <div><label>Jours GD 80</label><input class="gd80" type="number" min="0" max="7" step="1" value="${ligne.nb_gd80 || ''}"></div>
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
                     value="${Regles.versSaisieJour(jour)}" placeholder="—">
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
          <td class="num"><input class="cellule gd72" type="number" min="0" max="7" step="1" value="${ligne.nb_gd72 || ''}"></td>
          <td class="num"><input class="cellule gd80" type="number" min="0" max="7" step="1" value="${ligne.nb_gd80 || ''}"></td>
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
        <th class="num">Jours<br>zone</th><th class="num">Masque</th>
        <th class="num">GD 72<br><small style="font-weight:400">jours</small></th>
        <th class="num">GD 80<br><small style="font-weight:400">jours</small></th>
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
  cablerCorrectionNom(conteneur);

  // Un code absence remet la journee a zero : les deux ne se cumulent pas.
  conteneur.querySelectorAll('select.code').forEach((select) => {
    select.addEventListener('change', () => {
      const saisie = conteneur.querySelector(`input.heures[data-jour="${select.dataset.jour}"]`);
      saisie.classList.toggle('absent', Boolean(select.value));
      if (select.value) saisie.value = '';
      recalculerLigne(conteneur);
    });
  });

  // A la sortie de la case, la saisie est remise au format "7h30" — et un zero
  // saisi devient "0h00" au lieu de disparaitre : c'est la facon de declarer un
  // jour non travaille.
  conteneur.querySelectorAll('input.heures').forEach((champ) => {
    champ.addEventListener('blur', () => {
      champ.value = champ.value.trim() === '' ? '' : versTexte(versMinutes(champ.value));
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
      const saisie = conteneur.querySelector(`input.heures[data-jour="${j}"]`).value;
      jours.push({
        jour: j,
        minutes: versMinutes(saisie),
        code_absence: conteneur.querySelector(`select.code[data-jour="${j}"]`).value,
        // Case non vide = journee declaree, y compris a zero.
        saisi: saisie.trim() === '' ? 0 : 1,
      });
    }
    const nom = conteneur.querySelector('.nom-libre').value.trim();
    const choisi = salarieParNom(nom);
    corps.lignes.push({
      salarie_id: choisi ? choisi.id : null,
      nom_affiche: nom,
      minutes_route: versMinutes(conteneur.querySelector('.route').value),
      minutes_trajet: versMinutes(conteneur.querySelector('.trajet').value),
      jours_zone: Number(conteneur.querySelector('.zone').value) || 0,
      type_masque: conteneur.querySelector('.masque-type').value,
      nb_gd72: Number(conteneur.querySelector('.gd72').value) || 0,
      nb_gd80: Number(conteneur.querySelector('.gd80').value) || 0,
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
  afficherAnomalies(
    controlerFiche({ ...fiche, ...corps }, corps.lignes, {
      conducteursDisponibles: (reference.conducteurs || []).length,
    })
  );

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

/*
 * Volontairement une fonction declaree, et non une const : `afficher()` s'en
 * sert bien plus haut dans le fichier. Avec une const, la moindre interruption
 * du script avant cette ligne laissait la liaison dans sa zone morte, et le
 * premier affichage de fiche echouait sur un message incomprehensible. Une
 * declaration de fonction est hoistee, et l'anti-rebond se construit au premier
 * appel : plus rien ici ne depend de l'ordre d'evaluation du fichier.
 */
function enregistrerPlusTard(...args) {
  if (!differerEnregistrement) differerEnregistrement = antiRebond(enregistrer, 1200);
  differerEnregistrement(...args);
}

/* -------------------------------- Contrôles ------------------------------- */

function afficherAnomalies(anomalies, { deplier = false } = {}) {
  const liste = $('anomalies');
  liste.innerHTML = '';
  designerChamps(anomalies, deplier);

  if (!anomalies.length) {
    liste.innerHTML =
      '<li class="conforme">Aucune anomalie détectée : la fiche peut être transmise.</li>';
    return;
  }

  const bloquantes = anomalies.filter((a) => a.niveau === 'bloquant').length;
  if (bloquantes) {
    const entete = document.createElement('li');
    entete.className = 'bloquant recapitulatif';
    entete.textContent = bloquantes === 1
      ? '1 point à compléter avant de transmettre — il est encadré en rouge dans la fiche.'
      : `${bloquantes} points à compléter avant de transmettre — ils sont encadrés en rouge dans la fiche.`;
    liste.appendChild(entete);
  }

  for (const anomalie of anomalies) {
    const li = document.createElement('li');
    li.className = anomalie.niveau;
    li.textContent = `${anomalie.niveau === 'bloquant' ? 'À corriger' : 'À vérifier'} — ${anomalie.message}`;
    liste.appendChild(li);
  }
}

/*
 * Les champs vises par la classe CSS de leur anomalie. Sur onze lignes et sept
 * jours, lire un message ne suffit pas a retrouver la case : c'est la case
 * elle-meme qui doit se signaler.
 */
const CLASSES_CHAMP = {
  nom: '.nom-libre',
  zone: '.zone',
  masque: '.masque-type',
  signature: '.toile-signature, button.signer',
};

function elementsVises(cible) {
  if (!cible) return [];
  if (cible.champZone) return [$('zone-deplacement')].filter(Boolean);
  if (cible.entete) return [...document.querySelectorAll(`[data-entete="${cible.entete}"]`)];

  const conteneur = document.querySelector(`[data-ligne="${cible.ligne}"]`);
  if (!conteneur) return [];
  if (typeof cible.jour === 'number') {
    return [conteneur.querySelector(`input.heures[data-jour="${cible.jour}"]`)].filter(Boolean);
  }
  if (cible.champ) return [...conteneur.querySelectorAll(CLASSES_CHAMP[cible.champ] || `.${cible.champ}`)];
  return [conteneur];
}

function designerChamps(anomalies, deplier) {
  document.querySelectorAll('.champ-bloquant, .champ-alerte').forEach((el) => {
    el.classList.remove('champ-bloquant', 'champ-alerte');
  });
  document.querySelectorAll('.salarie.contient-bloquant').forEach((el) => {
    el.classList.remove('contient-bloquant');
  });

  for (const anomalie of anomalies) {
    const classe = anomalie.niveau === 'bloquant' ? 'champ-bloquant' : 'champ-alerte';
    for (const element of elementsVises(anomalie.cible)) {
      // Une alerte ne doit pas effacer le rouge d'un blocage sur le meme champ.
      if (classe === 'champ-alerte' && element.classList.contains('champ-bloquant')) continue;
      element.classList.add(classe);

      // En vue cartes, la carte du salarie peut etre repliee : elle porte alors
      // une pastille rouge. On ne la deplie qu'a la demande — apres un envoi
      // refuse — pour ne pas tout ouvrir des l'arrivee sur une fiche vierge.
      const carte = element.closest('.salarie');
      if (carte && anomalie.niveau === 'bloquant') {
        carte.classList.add('contient-bloquant');
        if (deplier) carte.open = true;
      }
    }
  }
}

/*
 * Prevenir le conducteur de travaux, sans courriel.
 *
 * Le message ne contient aucun lien : le conducteur ouvre sa page « Fiches a
 * viser », qu'il garde en favori. C'est ce qui permet au chef de l'envoyer
 * lui-meme sans jamais detenir de quoi viser — il pourrait sinon viser ses
 * propres fiches, et le controle ne serait plus qu'une formalite.
 */
function proposerAlerte(alerte) {
  const fenetre = document.createElement('div');
  fenetre.className = 'fenetre';
  fenetre.innerHTML = `
    <div class="fenetre-corps">
      <h2>Prévenir ${echapper(alerte.nom)}</h2>
      <p class="aide">
        Le courriel n'a pas pu partir. Envoyez-lui ce message : il ouvrira sa page
        « Fiches à viser », celle qu'il garde en favori.
      </p>
      <textarea readonly style="min-height:150px;font-size:0.86rem">${echapper(alerte.texte)}</textarea>
      <div class="rangee" style="margin-top:12px">
        ${alerte.whatsapp ? `<a class="bouton-lien" href="${echapper(alerte.whatsapp)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
        ${alerte.sms ? `<a class="bouton-lien" href="${echapper(alerte.sms)}">SMS</a>` : ''}
        <button class="petit" type="button" data-copier>Copier le message</button>
        <span class="pousse"></span>
        <button class="petit principal" type="button" data-fermer>Fermer</button>
      </div>
      ${
        alerte.telephone
          ? `<p class="aide" style="margin-top:10px">${echapper(alerte.telephone)}</p>`
          : `<p class="aide" style="margin-top:10px">Aucun numéro enregistré pour ${echapper(alerte.nom)} :
             copiez le message et envoyez-le par vos propres moyens. La direction peut ajouter son
             numéro dans Paramètres.</p>`
      }
    </div>`;
  document.body.appendChild(fenetre);

  fenetre.querySelector('[data-copier]').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(alerte.texte);
      e.target.textContent = 'Copié';
    } catch {
      // Presse-papiers refuse : la selection permet au moins un appui long.
      const zone = fenetre.querySelector('textarea');
      zone.focus();
      zone.select();
    }
  });
  fenetre.querySelector('[data-fermer]').addEventListener('click', () => fenetre.remove());
}

/*
 * Reprendre sa fiche pour la corriger.
 *
 * Le visa en cours est annule : un conducteur qui a vise une version ne doit
 * pas se retrouver signataire d'une autre. On le dit avant, pas apres.
 */
async function reprendre() {
  const attendVisa = fiche.visa_statut === 'attente' || fiche.visa_statut === 'vise';
  const question = attendVisa
    ? 'Reprendre cette fiche pour la modifier ?\n\nLe visa du conducteur de travaux sera annulé : il devra la viser à nouveau après votre correction.'
    : 'Reprendre cette fiche pour la modifier ?';
  if (!confirm(question)) return;

  try {
    const reponse = await API.post(`/api/fiches/${fiche.id}/reprendre`);
    fiche = reponse.fiche;
    afficher();
    await chargerCalendrier();
    message(
      reponse.visaAnnule
        ? 'Fiche reprise. Le visa précédent est annulé : retransmettez-la une fois corrigée.'
        : 'Fiche reprise. Vous pouvez la modifier, puis la retransmettre.',
      'succes',
      7000
    );
  } catch (e) {
    message(e.message, 'erreur');
  }
}

async function transmettre() {
  await enregistrer();
  try {
    const reponse = await API.post(`/api/fiches/${fiche.id}/soumettre`);
    fiche = reponse.fiche;
    afficher();
    await chargerCalendrier();

    const visa = reponse.visa || {};
    if (!visa.demande) {
      message('Fiche transmise au directeur.', 'succes');
    } else if (visa.envoye) {
      message(`Fiche envoyée à ${visa.conducteur} pour visa.`, 'succes', 6000);
    } else {
      /*
       * Le courriel n'est pas parti — pare-feu, serveur d'envoi non configure.
       * La fiche attend bel et bien le visa : ce qui manque, c'est de prevenir
       * le conducteur. Le chef le fait de son telephone, par le moyen qu'ils
       * utilisent deja.
       */
      message(`Fiche transmise. Prévenez ${visa.conducteur} qu'elle l'attend.`, 'succes', 7000);
      if (visa.alerte) proposerAlerte(visa.alerte);
    }
  } catch (e) {
    if (e.anomalies) {
      afficherAnomalies(e.anomalies, { deplier: true });
      // Amener le chef au premier champ fautif plutot qu'a la liste des
      // messages : c'est la case qu'il doit remplir.
      const premier = document.querySelector('.champ-bloquant');
      if (premier) {
        premier.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (typeof premier.focus === 'function') premier.focus({ preventScroll: true });
        return message(e.message, 'erreur');
      }
    }
    message(e.message, 'erreur');
    $('bloc-controles').scrollIntoView({ behavior: 'smooth' });
  }
}

demarrer().catch((e) => message(e.message, 'erreur'));
