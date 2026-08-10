/*
 * Une fiche a viser, ouverte depuis l'espace du conducteur de travaux.
 *
 * Il la relit, corrige les heures s'il le faut, puis vise ou la renvoie au chef
 * avec un commentaire. Rien n'est decide a l'ouverture : la page se lit, la
 * decision passe par un envoi explicite.
 */

const $ = (id) => document.getElementById(id);

const FICHE = new URLSearchParams(location.search).get('fiche') || '';
const RACINE = `/api/visa/fiche/${encodeURIComponent(FICHE)}`;

let fiche = null;
let reference = null;
let corrections = new Map(); // id de ligne -> ligne corrigee, en attente d'envoi

async function demarrer() {
  if (!FICHE) return afficherErreur('Adresse incomplète : aucune fiche désignée.');

  try {
    const reponse = await API.get(RACINE);
    fiche = reponse.fiche;
    reference = reponse.reference;
  } catch (e) {
    return afficherErreur(e.message);
  }

  afficher();
}

/** Le conducteur peut-il corriger cette fiche ? Le serveur seul en decide. */
const corrigeable = () => Boolean(fiche && fiche.modifiable);

/*
 * Le bandeau d'etat, relu depuis la fiche. Il annoncait « En attente de votre
 * visa » meme apres qu'on l'eut visee : il n'etait pose qu'a l'ouverture.
 */
function rafraichirEtat() {
  const etat = fiche.statut === 'rejetee' ? 'renvoyee' : fiche.visa_statut === 'vise' ? 'visee' : 'attente';
  $('badge-visa').innerHTML = {
    visee: '<span class="etat validee">Visée</span>',
    renvoyee: '<span class="etat rejetee">Renvoyée au chef d’équipe</span>',
    attente: '<span class="etat soumise">En attente de votre visa</span>',
  }[etat];
  $('bloc-decision').classList.toggle('masque', etat !== 'attente');
  const bloc = $('bloc-correction');
  if (bloc) bloc.classList.toggle('masque', etat !== 'attente' || !corrigeable());
  return etat === 'visee';
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

  if (rafraichirEtat()) {
    terminer('Fiche déjà visée', 'Vous avez déjà visé cette fiche : elle est partie à la direction.');
  }

  /*
   * L'en-tete se corrige aussi : un chantier mal nomme, une immatriculation
   * oubliee, un responsable manquant n'ont pas a faire revenir la fiche chez le
   * chef. La zone de deplacement a disparu de la fiche du chef — ce sont les
   * colonnes GD 72 et GD 80 qui portent l'information, jour par jour.
   */
  const champEntete = (nom, libelle, options) =>
    corrigeable()
      ? `<div>
           <label for="e-${nom}">${echapper(libelle)}</label>
           ${options
             ? `<select id="e-${nom}" data-entete="${nom}">${options}</select>`
             : `<input id="e-${nom}" data-entete="${nom}" value="${echapper(fiche[nom] || '')}">`}
         </div>`
      : `<div>
           <label>${echapper(libelle)}</label>
           <div class="valeur-lecture">${echapper(fiche[nom] || '—')}</div>
         </div>`;

  const parc = (reference.vehicules || [])
    .map((v) => `<option value="${echapper(v.immatriculation)}"${
      v.immatriculation === fiche.immatriculation ? ' selected' : ''
    }>${echapper(v.immatriculation)}</option>`)
    .join('');

  $('entete-chantier').innerHTML = [
    champEntete('chantier', 'Nom du chantier'),
    champEntete('ville', 'Ville'),
    champEntete('immatriculation', 'Immatriculation', `<option value="">—</option>${parc}`),
    champEntete('type_vehicule', 'Type de véhicule'),
    champEntete('conducteur_vehicule', 'Conducteur du véhicule'),
    champEntete('nom_responsable', 'Responsable de chantier'),
    champEntete('observations_pointage', 'Observations du chef d’équipe'),
    champEntete('commentaire_responsable', 'Commentaire du responsable'),
  ].join('');

  construireGrille();

  const remarques = [
    fiche.observations_pointage && `Observations du chef d'équipe : ${fiche.observations_pointage}`,
    fiche.commentaire_responsable && `Commentaire du responsable de chantier : ${fiche.commentaire_responsable}`,
  ].filter(Boolean);
  $('observations').textContent = remarques.join(' — ');

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
  const optionsCodes = (choisi) =>
    reference.codesAbsence
      .map((c) => `<option value="${c.code}"${c.code === choisi ? ' selected' : ''}>${c.code}</option>`)
      .join('');
  const optionsMasque = (choisi) =>
    (reference.typesMasque || ['', 'VA', 'AA'])
      .map((t) => `<option value="${t}"${t === choisi ? ' selected' : ''}>${t || '—'}</option>`)
      .join('');

  const modifiable = corrigeable();

  const rangs = fiche.lignes
    .map((ligne) => {
      /*
       * Les lignes vides sont montrees quand la fiche est corrigeable : c'est
       * ainsi que le conducteur ajoute quelqu'un que le chef a oublie. En
       * lecture, elles n'apprendraient rien et on les laisse de cote.
       */
      const nomme = String(ligne.nom_affiche || '').trim();
      if (!modifiable && !nomme) return '';

      const cellules = ligne.jours
        .map((jour, j) => {
          if (!modifiable) {
            const contenu = jour.code_absence
              ? `<abbr title="${echapper(libelleCode(jour.code_absence))}">${echapper(jour.code_absence)}</abbr>`
              : jour.minutes || jour.saisi
                ? echapper(versTexte(jour.minutes))
                : '—';
            return `<td class="num ${j >= 5 ? 'weekend' : ''}">${contenu}</td>`;
          }
          return `<td class="num ${j >= 5 ? 'weekend' : ''}">
            <input class="cellule heures ${jour.code_absence ? 'absent' : ''}" data-ligne="${ligne.id}" data-jour="${j}"
                   value="${Regles.versSaisieJour(jour)}" placeholder="—" inputmode="decimal">
            <select class="cellule code" data-ligne="${ligne.id}" data-jour="${j}">
              <option value="">—</option>${optionsCodes(jour.code_absence)}
            </select>
          </td>`;
        })
        .join('');

      const champ = (classe, valeur, extra = '') =>
        modifiable
          ? `<td class="num"><input class="cellule ${classe}" data-ligne="${ligne.id}" value="${echapper(valeur)}" ${extra}></td>`
          : `<td class="num">${echapper(valeur || '—')}</td>`;

      return `<tr>
        <td class="cellule-nom">${
          modifiable
            ? `<input class="nom-libre" list="liste-effectif" data-ligne="${ligne.id}"
                      value="${echapper(ligne.nom_affiche)}" placeholder="NOM Prénom">`
            : echapper(ligne.nom_affiche)
        }</td>
        ${cellules}
        <td class="num total" data-total="${ligne.id}">${echapper(versTexte(ligne.total_minutes))}</td>
        ${champ('route', versSaisie(ligne.minutes_route), 'placeholder="0h00" inputmode="decimal"')}
        ${champ('trajet', versSaisie(ligne.minutes_trajet), 'placeholder="0h00" inputmode="decimal"')}
        ${champ('zone', ligne.jours_zone || '', 'type="number" min="0" max="7" step="0.5"')}
        <td class="num">${
          modifiable
            ? `<select class="cellule masque-type" data-ligne="${ligne.id}">${optionsMasque(ligne.type_masque)}</select>`
            : echapper(ligne.type_masque || '—')
        }</td>
        ${champ('gd72', ligne.nb_gd72 || '', 'type="number" min="0" max="7" step="1"')}
        ${champ('gd80', ligne.nb_gd80 || '', 'type="number" min="0" max="7" step="1"')}
        <td>${
          modifiable
            ? `<input class="cellule observation" data-ligne="${ligne.id}" value="${echapper(ligne.observation || '')}">`
            : echapper(ligne.observation || '')
        }</td>
        <td class="num">${ligne.signature ? '✔' : '—'}</td>
      </tr>`;
    })
    .join('');

  const effectif = (reference.effectif || [])
    .map((s2) => `<option value="${echapper(`${s2.nom} ${s2.prenom}`)}"></option>`)
    .join('');

  $('grille').innerHTML = `
    <thead><tr>
      <th style="min-width:165px">Nom - Prénom</th>${entetes}
      <th class="num">Total<br>semaine</th><th class="num">Route<br>100%</th><th class="num">Trajet<br>50%</th>
      <th class="num">Jours<br>zone</th><th class="num">Masque</th>
      <th class="num">GD 72<br><small style="font-weight:400">jours</small></th>
      <th class="num">GD 80<br><small style="font-weight:400">jours</small></th>
      <th style="min-width:110px">Observations</th><th class="num">Signé</th>
    </tr></thead>
    <tbody>${rangs}</tbody>`;
  $('liste-effectif').innerHTML = effectif;

  if (modifiable) brancherCorrections();
}

/* ------------------------------ Correction -------------------------------- */

/*
 * Le conducteur controle le pointage : lui interdire de rectifier une erreur
 * l'obligerait a renvoyer la fiche entiere au chef pour une virgule. Il corrige
 * donc la fiche comme son auteur — l'en-tete, les heures, les absences, les
 * primes, et jusqu'a l'ajout d'un operateur oublie.
 *
 * Rien ne part tant qu'il n'a pas enregistre : contrairement a l'ecran du chef,
 * qui sauvegarde au fil de la frappe, une correction est ici un geste decide.
 * C'est ce qui permet de n'inscrire au journal qu'un releve par intervention,
 * lisible, plutot qu'une pluie de micro-modifications.
 */
let modifie = false;

function marquerModifie() {
  modifie = true;
  $('btn-enregistrer').disabled = false;
  $('etat-correction').textContent = 'Correction non enregistrée.';
}

/** La ligne du modele que designe ce champ. */
const ligneDe = (champ) => fiche.lignes.find((l) => String(l.id) === champ.dataset.ligne);

function recalculerTotal(ligne) {
  ligne.total_minutes = ligne.jours.reduce((t, j) => t + (Number(j.minutes) || 0), 0);
  const total = $('grille').querySelector(`[data-total="${ligne.id}"]`);
  if (total) total.textContent = versTexte(ligne.total_minutes);
}

function brancherCorrections() {
  const grille = $('grille');

  for (const champ of grille.querySelectorAll('input.heures')) {
    champ.addEventListener('change', () => {
      const ligne = ligneDe(champ);
      if (!ligne) return;
      const minutes = versMinutes(champ.value);
      champ.value = minutes ? versTexte(minutes) : '';
      const jour = ligne.jours[Number(champ.dataset.jour)];
      jour.minutes = minutes;
      // Des heures saisies valent declaration : c'est ce qui distingue une
      // journee mise a zero d'une journee simplement oubliee.
      jour.saisi = minutes > 0 || champ.value !== '' ? 1 : jour.saisi;
      recalculerTotal(ligne);
      marquerModifie();
    });
  }

  for (const champ of grille.querySelectorAll('select.code')) {
    champ.addEventListener('change', () => {
      const ligne = ligneDe(champ);
      if (!ligne) return;
      const jour = ligne.jours[Number(champ.dataset.jour)];
      jour.code_absence = champ.value;
      if (champ.value) jour.saisi = 1;
      const heures = grille.querySelector(`input.heures[data-ligne="${ligne.id}"][data-jour="${champ.dataset.jour}"]`);
      if (heures) heures.classList.toggle('absent', Boolean(champ.value));
      marquerModifie();
    });
  }

  const simples = [
    ['input.route', 'minutes_route', versMinutes],
    ['input.trajet', 'minutes_trajet', versMinutes],
    ['input.zone', 'jours_zone', Number],
    ['input.gd72', 'nb_gd72', Number],
    ['input.gd80', 'nb_gd80', Number],
    ['select.masque-type', 'type_masque', String],
    ['input.observation', 'observation', String],
  ];
  for (const [selecteur, propriete, convertir] of simples) {
    for (const champ of grille.querySelectorAll(selecteur)) {
      champ.addEventListener('change', () => {
        const ligne = ligneDe(champ);
        if (!ligne) return;
        ligne[propriete] = convertir(champ.value) || (convertir === String ? '' : 0);
        if (convertir === versMinutes) champ.value = ligne[propriete] ? versTexte(ligne[propriete]) : '';
        marquerModifie();
      });
    }
  }

  /*
   * Le nom : en le changeant on change de personne. Le numero de salarie suit
   * le nom choisi, ou tombe a rien pour un renfort saisi a la main — sans quoi
   * les heures partiraient en paie sous l'identite du precedent.
   */
  for (const champ of grille.querySelectorAll('input.nom-libre')) {
    champ.addEventListener('change', () => {
      const ligne = ligneDe(champ);
      if (!ligne) return;
      ligne.nom_affiche = champ.value.trim();
      const connu = (reference.effectif || []).find(
        (s2) => Regles.memePersonne(`${s2.nom} ${s2.prenom}`, ligne.nom_affiche)
      );
      ligne.salarie_id = connu ? connu.id : null;
      marquerModifie();
    });
  }

  for (const champ of document.querySelectorAll('#entete-chantier [data-entete]')) {
    champ.addEventListener('change', () => {
      fiche[champ.dataset.entete] = champ.value;
      marquerModifie();
    });
  }
}

async function enregistrerCorrections() {
  if (!modifie) return true;

  const corps = {
    chantier: fiche.chantier,
    ville: fiche.ville,
    immatriculation: fiche.immatriculation,
    type_vehicule: fiche.type_vehicule,
    conducteur_vehicule: fiche.conducteur_vehicule,
    nom_responsable: fiche.nom_responsable,
    observations_pointage: fiche.observations_pointage,
    commentaire_responsable: fiche.commentaire_responsable,
    lignes: fiche.lignes.map((l) => ({
      salarie_id: l.salarie_id,
      nom_affiche: l.nom_affiche,
      minutes_route: l.minutes_route,
      minutes_trajet: l.minutes_trajet,
      jours_zone: l.jours_zone,
      type_masque: l.type_masque,
      nb_gd72: l.nb_gd72,
      nb_gd80: l.nb_gd80,
      observation: l.observation,
      jours: l.jours.map((j) => ({ jour: j.jour, minutes: j.minutes, code_absence: j.code_absence, saisi: j.saisi })),
    })),
  };

  try {
    const reponse = await API.put(RACINE, corps);
    fiche = { ...reponse.fiche, modifiable: true };
    modifie = false;
    $('btn-enregistrer').disabled = true;
    $('etat-correction').textContent = 'Corrections enregistrées.';
    afficher();
    return true;
  } catch (e) {
    message(e.message, 'erreur');
    return false;
  }
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

  // Viser sans enregistrer ferait perdre les corrections au moment meme ou l'on
  // approuve ce qu'on vient de corriger.
  if (!(await enregistrerCorrections())) {
    for (const bouton of ['btn-viser', 'btn-renvoyer']) $(bouton).disabled = false;
    return;
  }

  try {
    const reponse = await API.post(`${RACINE}/decision`, { decision, commentaire });
    // L'etat vient du serveur : c'est lui qui dit ou en est la fiche, et le
    // bandeau doit cesser d'annoncer un visa qu'on vient justement de donner.
    fiche = { ...(reponse.fiche || fiche), modifiable: false };
    rafraichirEtat();
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
  const bloc = $('bloc-correction');
  if (bloc) bloc.classList.add('masque');
  $('texte-resultat').textContent = texte;
  const retour = document.createElement('button');
  retour.className = 'petit principal';
  retour.type = 'button';
  retour.textContent = '◀ Retour à mes fiches';
  retour.addEventListener('click', () => { location.href = '/conducteur.html'; });
  $('bloc-resultat').appendChild(retour);
  $('bloc-resultat').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* Revenir a ses fiches : la page ne doit jamais etre un cul-de-sac. */
if ($('btn-retour')) $('btn-retour').addEventListener('click', () => { location.href = '/conducteur.html'; });

/*
 * Une seule fois, au chargement : `afficher()` reconstruit la grille a chaque
 * enregistrement, et y rebrancher ce bouton empilerait les ecouteurs.
 */
if ($('btn-enregistrer')) {
  $('btn-enregistrer').disabled = true;
  $('btn-enregistrer').addEventListener('click', enregistrerCorrections);
}

demarrer().catch((e) => afficherErreur(e.message));
