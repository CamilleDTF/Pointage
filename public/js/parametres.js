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

/*
 * Deux metiers pour un seul ecran.
 *
 * L'administrateur technique tient les comptes, l'effectif, les vehicules ; il
 * ne voit ni les taux, ni rien qui porte un montant. Le serveur le lui refuse
 * de toute facon — c'est lui qui fait autorite — mais afficher un onglet qui
 * repondrait 403 serait une promesse en trompe-l'oeil. On le retire donc.
 */
const RESERVE_A_LA_DIRECTION = ['taux', 'coffre', 'miseenservice'];
let estAdministrateur = false;

async function demarrer() {
  const { utilisateur } = await API.get('/api/moi');
  if (!['directeur', 'admin'].includes(utilisateur.role)) {
    location.href = '/chef.html';
    return;
  }
  estAdministrateur = utilisateur.role === 'admin';
  definirRole(utilisateur.role);

  reference = await API.get('/api/reference');
  $('entete-nom').textContent = `${utilisateur.nom} · version ${reference.version}`;

  if (estAdministrateur) {
    for (const nom of RESERVE_A_LA_DIRECTION) {
      const onglet = document.querySelector(`#onglets-parametres .onglet[data-onglet="${nom}"]`);
      if (onglet) onglet.remove();
    }
    retirerColonneTaux();

    // L'ecran s'annonce pour ce qu'il est : ni le titre ni le panneau ne doivent
    // promettre une direction qu'on n'exerce pas.
    const titre = document.querySelector('header.appbar .titre');
    if (titre) titre.childNodes[0].nodeValue = 'Paramètres — Administration ';
    const enTete = document.querySelector('#panneau-effectif h2');
    if (enTete) enTete.textContent = 'Personnel et équipes';
    const rappelTaux = document.querySelector('#panneau-effectif .aide');
    if (rappelTaux) rappelTaux.remove();

    // Le retour au tableau de bord vaut toujours : il le lit, sans y decider.
    poserMention(
      "Votre compte tient l'application. Les montants, les taux horaires et la "
      + 'validation des fiches restent à la direction.'
    );
  }

  await chargerAdmin();
  ouvrirPanneau('effectif');
}

/*
 * La colonne des taux, ou rien du tout.
 *
 * Le serveur retire deja le taux des donnees envoyees a un administrateur. Mais
 * laisser la colonne afficher « — » pour tout le monde serait pire que de la
 * retirer : elle ne dirait pas « vous n'y avez pas acces », elle dirait « aucun
 * taux n'est renseigne » — une information fausse, sur laquelle quelqu'un
 * finirait par agir.
 */
const celluleTaux = (s) =>
  estAdministrateur
    ? ''
    : `<td class="num"><input type="number" min="0" step="0.01" class="cellule-calme champ-court"
                 value="${s.taux_horaire || ''}" placeholder="—"
                 onchange="fixerTaux(${s.id}, this.value)"></td>`;

/** Retire l'en-tete correspondant, pour que le tableau reste d'aplomb. */
function retirerColonneTaux() {
  if (!estAdministrateur) return;
  document.querySelectorAll('#panneau-effectif th, #panneau-nonproductif th').forEach((th) => {
    if (th.textContent.trim() === 'Taux horaire') th.remove();
  });
}

/** Une phrase sous l'en-tete, pour dire de quel siege on regarde l'ecran. */
function poserMention(texte) {
  const onglets = $('onglets-parametres');
  if (!onglets || !onglets.parentElement) return;
  const p = document.createElement('p');
  p.className = 'aide detache serree';
  p.textContent = texte;
  onglets.parentElement.appendChild(p);
}

surClic('btn-retour', () => { location.href = '/directeur.html'; });
surClic('btn-quitter', deconnexion);

/* Les volets de l'ecran Parametres. */
const PANNEAUX = ['effectif', 'nonproductif', 'comptes', 'conducteurs', 'vehicules', 'taux', 'conservation', 'indicateurs', 'miseenservice', 'coffre', 'compte'];

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
  if (nom === 'nonproductif') chargerNonProductifs();
  if (nom === 'conducteurs') chargerConducteurs();
  if (nom === 'vehicules') chargerVehicules();
  if (nom === 'taux') chargerTaux();
  if (nom === 'conservation') chargerConservation();
  if (nom === 'indicateurs') chargerIndicateurs();
  if (nom === 'compte') chargerMonCompte();
  if (nom === 'coffre') chargerCoffre();
  if (nom === 'miseenservice') chargerMiseEnService();
}

/* ----------------------------- Mise en service ----------------------------- */

/*
 * L'ecran ne declare rien : chaque ligne vient du serveur, qui a constate. Une
 * liste de securites qui s'affirmerait active sans verifier serait pire
 * qu'absente — on s'y fierait.
 */
async function chargerMiseEnService() {
  let etat;
  try {
    etat = await API.get('/api/mise-en-service');
  } catch (e) {
    $('liste-securites').innerHTML = `<p class="aide" style="color:var(--rouge)">${echapper(e.message)}</p>`;
    return;
  }

  $('liste-securites').innerHTML = etat.points
    .map((p) => `<div class="securite ${p.arme ? 'armee' : p.facultatif ? 'facultative' : 'ouverte'}">
      <span class="signe">${p.arme ? '✓' : p.facultatif ? '○' : '▲'}</span>
      <span class="texte">
        <strong>${echapper(p.intitule)}</strong>
        <span class="precision">${echapper(p.detail)}${
          p.horsApplication ? ' <em>Ne se règle pas ici : voir docs/DEPLOIEMENT.md.</em>' : ''
        }</span>
      </span>
    </div>`)
    .join('');

  // Le formulaire ne s'affiche que s'il reste quelque chose a armer.
  $('armement').classList.toggle('masque', etat.restantArmable.length === 0);
  $('resultat-armement').classList.add('masque');
  if (!etat.restantArmable.includes('coffre')) {
    // Le coffre existe deja : sa phrase n'a plus rien a faire dans ce formulaire.
    for (const id of ['mes-phrase', 'mes-phrase2']) {
      const champ = $(id);
      if (champ) champ.closest('div').classList.add('masque');
    }
  }
}

surClic('btn-armer', async () => {
  const aide = $('aide-armement');
  const phrase = $('mes-phrase').value;
  if (!$('mes-phrase').closest('div').classList.contains('masque') && phrase !== $('mes-phrase2').value) {
    aide.textContent = 'Les deux phrases ne sont pas identiques.';
    aide.style.color = 'var(--rouge)';
    return;
  }
  try {
    const r = await API.post('/api/mise-en-service', {
      phrase,
      question: $('mes-question').value,
      reponse: $('mes-reponse').value,
      actuel: $('mes-actuel').value,
      renouvelerLesCodes: $('mes-renouveler').value === 'oui',
    });
    if (r.seance) Paie.poser(r.seance, r.dureeMs);

    for (const id of ['mes-phrase', 'mes-phrase2', 'mes-reponse', 'mes-actuel']) $(id).value = '';
    $('mes-fait').innerHTML = r.fait.map((f) => `<li>${echapper(f)}</li>`).join('');
    $('mes-secours').textContent = r.secours || '';
    $('mes-secours').classList.toggle('masque', !r.secours);
    $('armement').classList.add('masque');
    $('resultat-armement').classList.remove('masque');
    aide.textContent = '';
  } catch (e) {
    aide.textContent = e.message;
    aide.style.color = 'var(--rouge)';
  }
});

surClic('btn-imprimer-mes', () => window.print());

surClic('btn-mes-note', async () => {
  $('mes-secours').textContent = '';
  $('resultat-armement').classList.add('masque');
  await chargerMiseEnService();
  message('Sécurités armées.', 'succes', 5000);
});

/* ---------------------------- Coffre de la paie ---------------------------- */

async function chargerCoffre() {
  let etat;
  try {
    etat = await API.get('/api/coffre');
  } catch (e) {
    $('etat-coffre').innerHTML = `<p class="aide" style="color:var(--rouge)">${echapper(e.message)}</p>`;
    return;
  }

  const zone = $('etat-coffre');
  $('creation-coffre').classList.toggle('masque', etat.existe);
  $('phrase-coffre').classList.toggle('masque', !etat.existe);

  if (!etat.existe) {
    /*
     * Le nombre de montants encore en clair est affiche tel quel : une promesse
     * d'etancheite se verifie, elle ne se declare pas.
     */
    zone.innerHTML = `<div class="etat-paie">
      <span class="signe">▲</span>
      <span class="texte">
        <strong>Le coffre n'est pas créé : ${etat.montantsEnClair} montant(s) sont lisibles dans le fichier de la base.</strong>
        <span class="precision">Une sauvegarde, un instantané de la machine ou un accès au serveur les livrent sans identifiant.</span>
      </span>
    </div>`;
    return;
  }

  const propre = etat.montantsEnClair === 0;
  zone.innerHTML = `<div class="etat-paie${propre ? ' fait' : ''}">
    <span class="signe">${propre ? '✓' : '▲'}</span>
    <span class="texte">
      <strong>${propre
        ? 'Coffre en place : aucun montant ne subsiste en clair.'
        : `Coffre en place, mais ${etat.montantsEnClair} montant(s) restent en clair.`}</strong>
      <span class="precision">Créé le ${echapper((etat.creeLe || '').slice(0, 10))}. La phrase ouvre les montants pour ${Math.round(etat.dureeSeanceMs / 60000)} minutes.</span>
    </span>
  </div>`;
}

surClic('btn-creer-coffre', async () => {
  const aide = $('aide-coffre');
  const phrase = $('coffre-phrase').value;
  if (phrase !== $('coffre-phrase2').value) {
    aide.textContent = 'Les deux phrases ne sont pas identiques.';
    aide.style.color = 'var(--rouge)';
    return;
  }
  try {
    const r = await API.post('/api/coffre', { phrase });
    Paie.poser(r.seance, r.dureeMs);
    $('coffre-phrase').value = '';
    $('coffre-phrase2').value = '';
    $('valeur-secours').textContent = r.secours;
    $('creation-coffre').classList.add('masque');
    $('secours-coffre').classList.remove('masque');
    aide.textContent = '';
  } catch (e) {
    aide.textContent = e.message;
    aide.style.color = 'var(--rouge)';
  }
});

surClic('btn-imprimer-secours', () => window.print());

surClic('btn-secours-note', async () => {
  /*
   * On efface la cle de l'ecran des que la direction dit l'avoir notee. Elle
   * n'existe plus nulle part ensuite — ni en base, ni ici : seule son enveloppe
   * est conservee, et une enveloppe ne se relit pas.
   */
  $('valeur-secours').textContent = '';
  $('secours-coffre').classList.add('masque');
  await chargerCoffre();
  message('Coffre créé. Les montants sont désormais chiffrés dans la base.', 'succes', 5000);
});

surClic('btn-changer-phrase', async () => {
  const aide = $('aide-phrase-coffre');
  try {
    if (!(await ouvrirLesMontants())) return;
    await API.post('/api/coffre/phrase', { nouvelle: $('coffre-nouvelle').value });
    $('coffre-nouvelle').value = '';
    aide.textContent = 'Phrase changée. La clé de secours imprimée reste valable.';
    aide.style.color = 'var(--vert)';
  } catch (e) {
    aide.textContent = e.message;
    aide.style.color = 'var(--rouge)';
  }
});

/* ------------------------------- Mon compte ------------------------------- */

async function chargerMonCompte() {
  const etat = await API.get('/api/ma-reprise');
  const zone = $('etat-reprise');

  if (etat.definie) {
    zone.textContent = `Question enregistrée : « ${etat.question} ». La remplacer efface la précédente.`;
    zone.style.color = 'var(--vert)';
    $('reprise-q').value = etat.question;
  } else if (etat.recommandee) {
    /*
     * L'insistance est justifiee : la direction est le seul role que personne
     * ne peut depanner. Sans question posee, un code oublie ferme l'application
     * a la seule personne qui decide des salaires.
     */
    zone.textContent =
      "Aucune question enregistrée. Personne — pas même un administrateur — ne peut vous "
      + 'remettre un code : sans cette question, un code oublié vous ferme la porte.';
    zone.style.color = 'var(--orange)';
  } else {
    zone.textContent =
      "Vous n'en avez pas besoin : la direction peut vous remettre un code à tout moment.";
    zone.style.color = '';
  }
}

surClic('btn-changer-code', async () => {
  const aide = $('aide-code');
  try {
    await API.post('/api/mon-code', {
      actuel: $('code-actuel').value,
      nouveau: $('code-nouveau').value,
    });
    $('code-actuel').value = '';
    $('code-nouveau').value = '';
    aide.textContent = 'Code changé. Les autres sessions ouvertes ont été fermées.';
    aide.style.color = 'var(--vert)';
  } catch (e) {
    aide.textContent = e.message;
    aide.style.color = 'var(--rouge)';
  }
});

surClic('btn-reprise-poser', async () => {
  const aide = $('aide-reprise-poser');
  try {
    await API.post('/api/ma-reprise', {
      question: $('reprise-q').value,
      reponse: $('reprise-r').value,
      actuel: $('reprise-actuel').value,
    });
    $('reprise-r').value = '';
    $('reprise-actuel').value = '';
    aide.textContent = 'Question enregistrée. Notez la réponse : elle ne se relit nulle part.';
    aide.style.color = 'var(--vert)';
    await chargerMonCompte();
  } catch (e) {
    aide.textContent = e.message;
    aide.style.color = 'var(--rouge)';
  }
});

/* -------------------------- Conservation des donnees ----------------------- */

/*
 * Ce que le RGPD demande de savoir faire, et que la documentation seule ne fait
 * pas : dire qui est concerne par la duree de conservation, effacer ce qui
 * identifie une personne, et rassembler son dossier si elle le demande.
 */
async function chargerConservation() {
  let donnees;
  try {
    donnees = await API.get('/api/admin/conservation');
  } catch (e) {
    message(e.message, 'erreur');
    return;
  }

  const ans = Math.round(donnees.dureeMois / 12);
  $('aide-conservation').innerHTML =
    `Durée de conservation retenue : <strong>${ans} ans</strong> après le dernier pointage `
    + `(${donnees.dureeMois} mois). Tous les salariés <strong>sortis de l'effectif</strong> `
    + 'figurent ici ; chacun devient effaçable à l’échéance indiquée.';

  const corps = $('table-conservation').querySelector('tbody');
  if (!donnees.candidats.length) {
    corps.innerHTML = '<tr><td colspan="5" class="vide">Personne n\'est sorti de l\'effectif.</td></tr>';
  } else {
    corps.innerHTML = donnees.candidats
      .map((s) => {
        const derniere = s.derniere.periode
          ? `semaine ${String(s.derniere.periode).slice(4)} / ${String(s.derniere.periode).slice(0, 4)}`
          : s.derniere.date || 'aucun pointage';
        const nom = echapper(`${s.nom} ${s.prenom}`.trim());
        return `<tr${s.effacable ? '' : ' style="opacity:.72"'}>
          <td>${nom}</td>
          <td>${echapper(s.matricule || '—')}</td>
          <td>${echapper(s.productif === 0 ? 'Non productif' : 'Chantier')}</td>
          <td>${echapper(derniere)}</td>
          <td>${
            s.effacable
              ? `<button class="petit danger" onclick="anonymiser(${s.id}, '${nom}')">Anonymiser</button>`
              : `<span class="aide">à conserver jusqu’au ${
                  s.effacableLe ? echapper(dateFrancaise(s.effacableLe)) : '—'
                }</span>`
          }</td>
        </tr>`;
      })
      .join('');
  }

  /*
   * La liste du dossier : tout le monde, y compris les sortis, mais range.
   *
   * Les deux populations etaient melangees dans une seule liste alphabetique :
   * un chef qui cherchait un operateur tombait sur la comptable, et rien ne
   * disait laquelle des deux on tenait. Ce sont deux effectifs distincts —
   * l'un pointe sur des fiches, l'autre est a 7 h par jour ouvre — et le
   * dossier qu'on remet n'a pas le meme contenu.
   */
  const { salariesTous } = await API.get('/api/admin/utilisateurs');
  const option = (s) =>
    `<option value="${s.id}">${echapper(`${s.nom} ${s.prenom}`.trim())}${s.actif ? '' : ' (sorti)'}</option>`;
  const groupe = (intitule, gens) =>
    gens.length ? `<optgroup label="${intitule} (${gens.length})">${gens.map(option).join('')}</optgroup>` : '';

  $('dossier-salarie').innerHTML =
    groupe('Personnel de chantier', salariesTous.filter((s) => s.productif !== 0))
    + groupe('Personnel non productif', salariesTous.filter((s) => s.productif === 0));
}

window.anonymiser = async (id, nom) => {
  if (!confirm(
    `Anonymiser ${nom} ?\n\nSon nom, son matricule et ses signatures seront effacés partout, `
      + 'y compris dans les fiches archivées. Ses heures et ses fiches validées seront conservées.\n\n'
      + 'Cette opération est irréversible.'
  )) return;

  try {
    const r = await API.post(`/api/admin/conservation/${id}/anonymiser`);
    await chargerConservation();
    message(`${nom} est désormais ${r.etiquette}.`, 'succes', 7000);
  } catch (e) {
    message(e.message, 'erreur');
  }
};

surClic('btn-dossier', async () => {
  const id = $('dossier-salarie').value;
  if (!id) return;
  try {
    const dossier = await API.get(`/api/admin/salaries/${id}/dossier`);
    const nom = `${dossier.salarie.nom}_${dossier.salarie.prenom}`.replace(/\s+/g, '_');
    telechargerJson(dossier, `dossier_${nom}.json`);
  } catch (e) {
    message(e.message, 'erreur');
  }
});

/** Depose un objet sur le disque, sans passer par le serveur. */
function telechargerJson(donnees, nomFichier) {
  const lien = document.createElement('a');
  lien.href = URL.createObjectURL(new Blob([JSON.stringify(donnees, null, 2)], { type: 'application/json' }));
  lien.download = nomFichier;
  lien.click();
  URL.revokeObjectURL(lien.href);
}

/* ----------------------------- Taux de la paie ---------------------------- */

/*
 * Les montants qui vivaient en dur dans le code, avec leur date d'effet.
 *
 * L'ecran montre deux choses a la fois, et c'est voulu : ce qui s'applique au
 * mois consulte, et l'histoire complete du taux. Sans la seconde, on ne saurait
 * pas pourquoi un mois de l'an dernier ne donne pas le meme montant qu'un mois
 * d'aujourd'hui — et c'est precisement la question qu'on se pose.
 */
let taux = null;

function preparerMoisTaux() {
  const courant = new Date();
  const select = $('taux-mois');
  const annee = $('taux-annee');
  if (!select || !annee) return;

  if (!select.options.length) {
    select.innerHTML = Regles.MOIS
      .map((nom, i) => `<option value="${i + 1}"${i === courant.getMonth() ? ' selected' : ''}>${nom}</option>`)
      .join('');
    select.addEventListener('change', chargerTaux);
  }
  if (!annee.value) annee.value = courant.getFullYear();
  if (!annee.dataset.cable) {
    annee.dataset.cable = '1';
    annee.addEventListener('change', chargerTaux);
  }
}

async function chargerTaux() {
  preparerMoisTaux();
  const annee = $('taux-annee').value;
  const mois = $('taux-mois').value;
  try {
    taux = await API.get(`/api/admin/taux?annee=${annee}&mois=${mois}`);
  } catch (e) {
    message(e.message, 'erreur');
    return;
  }

  const nombre = (v) => String(Math.round(Number(v) * 10000) / 10000).replace('.', ',');
  const moisDe = (debut) => {
    const [a, m] = String(debut).split('-');
    return `${Regles.MOIS[Number(m) - 1]} ${a}`;
  };

  $('table-taux').querySelector('tbody').innerHTML = taux.catalogue
    .map((t) => {
      const histoire = t.valeurs
        .map((v) => {
          // La valeur d'origine porte deja son explication : on ne la redit pas
          // une seconde fois derriere sa note.
          const origine = v.debut === '2000-01-01';
          const suite = origine
            ? '<span class="aide">— valeur d’origine, reprise du code</span>'
            : `${v.note ? `<span class="aide">— ${echapper(v.note)}</span>` : ''}
               <button class="petit" onclick="supprimerTaux(${v.id})" title="Retirer cette date d’effet">✕</button>`;
          return `<div>
            <strong>${nombre(v.valeur)}</strong> à compter de ${echapper(moisDe(v.debut))} ${suite}
          </div>`;
        })
        .join('');

      return `<tr>
        <td>
          ${echapper(t.libelle)}
          <div class="aide">${echapper(t.unite)}${t.estimation ? ' — estimation, pas un calcul de paie' : ''}</div>
        </td>
        <td class="num total">${nombre(taux.applicables[t.cle])}</td>
        <td>${histoire}</td>
        <td>
          <button class="petit principal" onclick="nouveauTaux('${t.cle}')">Changer…</button>
        </td>
      </tr>`;
    })
    .join('');
}

/*
 * Le mois d'effet est demande explicitement, et jamais devine : « a compter de
 * quand ? » est la seule chose qui distingue une correction de saisie d'un
 * changement d'accord, et se tromper la-dessus deplace des montants deja payes.
 */
window.nouveauTaux = async (cle) => {
  const entree = taux.catalogue.find((t) => t.cle === cle);
  const valeur = prompt(`${entree.libelle} — nouvelle valeur (${entree.unite}) :`, '');
  if (valeur === null || !String(valeur).trim()) return;

  const quand = prompt(
    'À compter de quel mois ? Au format MM/AAAA.\n\n'
      + 'Les mois antérieurs garderont leur valeur actuelle.',
    `${String($('taux-mois').value).padStart(2, '0')}/${$('taux-annee').value}`
  );
  if (quand === null) return;
  const [mois, annee] = String(quand).split('/').map((x) => Number(String(x).trim()));
  if (!mois || !annee) return message('Mois attendu au format MM/AAAA.', 'erreur');

  const note = prompt('Motif du changement (accord, avenant, décision interne…) :', '') || '';

  try {
    await API.post('/api/admin/taux', { cle, valeur, annee, mois, note });
    await chargerTaux();
    message(`${entree.libelle} : ${valeur} à compter de ${String(mois).padStart(2, '0')}/${annee}.`, 'succes', 6000);
  } catch (e) {
    message(e.message, 'erreur');
  }
};

window.supprimerTaux = async (id) => {
  if (!confirm('Supprimer cette date d’effet ? Les mois concernés reprendront la valeur précédente.')) return;
  try {
    await API.supprimer(`/api/admin/taux/${id}`);
    await chargerTaux();
  } catch (e) {
    message(e.message, 'erreur');
  }
};

/* ------------------------------- Vehicules -------------------------------- */

async function chargerVehicules() {
  const table = $('table-vehicules');
  if (!table) return;
  const { vehicules } = await API.get('/api/admin/vehicules');
  const champ = (v, nom, largeur) =>
    `<input value="${echapper(v[nom])}" class="cellule-calme" style="width:${largeur}"
       onchange="corrigerVehicule(${v.id}, '${nom}', this.value, this)">`;

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

/* -------------------------- Personnel non productif ------------------------ */

/*
 * Meme table que l'effectif de chantier, meme facon de le corriger : c'est le
 * meme registre du personnel, separe par un seul indicateur. Ce qui change est
 * ailleurs — ils n'ont pas de chef d'equipe, et leur mois se tient sur un autre
 * ecran.
 */
async function chargerNonProductifs() {
  const table = $('table-nonproductifs');
  if (!table) return;
  const { salaries } = await API.get('/api/admin/non-productifs');

  table.querySelector('tbody').innerHTML = salaries.length
    ? salaries
        .map(
          (s) => `<tr style="${s.actif ? '' : 'opacity:.5'}">
            <td><input value="${echapper(s.matricule || '')}" class="cellule-calme champ-court"
                       onchange="corrigerSalarie(${s.id}, 'matricule', this.value, this)"></td>
            <td><input value="${echapper(s.nom)}" class="cellule-calme champ-moyen"
                       onchange="corrigerSalarie(${s.id}, 'nom', this.value, this)"></td>
            <td><input value="${echapper(s.prenom)}" class="cellule-calme champ-court"
                       onchange="corrigerSalarie(${s.id}, 'prenom', this.value, this)"></td>
            ${celluleTaux(s)}
            <td><button class="petit" onclick="basculerSalarie(${s.id}, ${s.actif ? 0 : 1})">${
              s.actif ? 'Désactiver' : 'Réactiver'
            }</button></td>
          </tr>`
        )
        .join('')
    : `<tr><td colspan="${estAdministrateur ? 4 : 5}" class="vide">Aucune personne enregistrée.</td></tr>`;
}

surClic('btn-ajout-nonproductif', async () => {
  try {
    await API.post('/api/admin/salaries', {
      matricule: $('np-matricule').value,
      nom: $('np-nom').value.toUpperCase(),
      prenom: $('np-prenom').value,
      productif: 0,
    });
    for (const id of ['np-matricule', 'np-nom', 'np-prenom']) $(id).value = '';
    await chargerNonProductifs();
    message('Personne ajoutée.', 'succes');
  } catch (e) {
    message(e.message, 'erreur');
  }
});

/* --------------------------- Conducteurs de travaux ------------------------ */

async function chargerConducteurs() {
  const table = $('table-conducteurs');
  if (!table) return;
  const { conducteurs, chefs, envoiConfigure } = await API.get('/api/admin/conducteurs');

  // L'envoi de courriels est un confort : le conducteur se connecte de toute
  // facon a son espace. On le dit ainsi, plutot qu'en alarme.
  $('aide-envoi').innerHTML = envoiConfigure
    ? '<span class="jauge bon">Envoi de courriels configuré</span> — chaque transmission prévient ' +
      'le conducteur par courriel qu’une fiche l’attend.'
    : '<span class="jauge moyen">Pas d’envoi de courriels</span> — le circuit fonctionne quand même : ' +
      'chaque conducteur retrouve ses fiches en se connectant, et le chef d’équipe peut le prévenir ' +
      'par SMS ou WhatsApp. Pour qu’ils reçoivent en plus un message à chaque transmission, remplissez ' +
      'les lignes SMTP de <code>configuration.txt</code> (voir <code>TESTER-COURRIEL.bat</code>).';

  const champ = (c, nom, valeur, largeur, type = 'text') =>
    `<input type="${type}" value="${echapper(valeur)}" class="cellule-calme" style="width:${largeur}"
            onchange="corrigerConducteur(${c.id}, '${nom}', this.value, this)">`;

  table.querySelector('tbody').innerHTML = conducteurs.length
    ? conducteurs
        .map((c) => {
          const { nom, prenom } = Regles.separerNomPrenom(c.nom);
          return `<tr style="${c.actif ? '' : 'opacity:.5'}">
            <td>${champ(c, 'nom', nom, '130px')}</td>
            <td>${champ(c, 'prenom', prenom, '110px')}</td>
            <td>${champ(c, 'identifiant', c.identifiant, '110px')}</td>
            <td>${champ(c, 'courriel', c.courriel, '210px', 'email')}</td>
            <td>${champ(c, 'telephone', c.telephone, '130px', 'tel')}</td>
            <td>
              <button class="petit" onclick="definirCode(${c.id}, '${echapper(c.nom)}')">${
                c.codeADefinir ? 'Donner un code' : 'Réinitialiser'
              }</button>
              ${c.codeADefinir ? '<div class="jauge moyen" style="margin-top:4px">Sans code</div>' : ''}
            </td>
            <td>
              <button class="petit" onclick="basculerConducteur(${c.id}, ${c.actif ? 0 : 1})">${
                c.actif ? 'Désactiver' : 'Réactiver'
              }</button>
              <button class="petit danger" onclick="supprimerCompte(${c.id}, '${echapper(c.nom).replace(/'/g, "\\'")}')">Supprimer</button>
            </td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="7" class="vide">Aucun conducteur de travaux enregistré.</td></tr>';

  const options = (selectionne) =>
    `<option value="">— aucun, transmission directe à la direction</option>${conducteurs
      .filter((c) => c.actif)
      .map((c) => `<option value="${c.id}"${c.id === selectionne ? ' selected' : ''}>${echapper(c.nom)}</option>`)
      .join('')}`;

  $('table-rattachement').querySelector('tbody').innerHTML = chefs
    .map(
      (chef) => `<tr>
        <td>${echapper(chef.nom)}</td>
        <td><select class="cellule-calme" onchange="rattacherChef(${chef.id}, this.value)" style="min-width:280px">${options(
          chef.conducteur_id
        )}</select></td>
      </tr>`
    )
    .join('');
}

/*
 * Correction du nom ou de l'identifiant d'un compte.
 *
 * Un nom mal orthographie a l'import, un identifiant choisi trop vite : il
 * fallait auparavant desactiver le compte et en creer un autre, ce qui
 * detachait ses fiches de leur auteur.
 */
window.corrigerCompte = async (id, champ, valeur, element) => {
  const ancienne = element.defaultValue;
  const propre = valeur.trim();
  if (propre === ancienne) return;
  try {
    await API.put(`/api/admin/utilisateurs/${id}`, { [champ]: propre });
    await chargerAdmin();
    message(
      champ === 'identifiant'
        ? 'Identifiant modifié. Prévenez l’intéressé : c’est avec celui-là qu’il se connectera.'
        : 'Compte mis à jour. Sa fiche de salarié suit le même nom.',
      'succes',
      champ === 'identifiant' ? 7000 : 3500
    );
  } catch (e) {
    // On remet la valeur d'avant : laisser a l'ecran une correction refusee
    // ferait croire qu'elle a ete prise en compte.
    element.value = ancienne;
    message(e.message, 'erreur');
  }
};

window.corrigerConducteur = async (id, champ, valeur, element) => {
  const ancienne = element.defaultValue;
  const propre = valeur.trim();
  if (propre === ancienne) return;
  try {
    await API.put(`/api/admin/utilisateurs/${id}`, { [champ]: propre });
    element.defaultValue = propre;
    await chargerConducteurs();
    message(
      champ === 'identifiant'
        ? 'Identifiant modifié. Prévenez l’intéressé : c’est avec celui-là qu’il se connectera.'
        : 'Conducteur mis à jour.',
      'succes',
      champ === 'identifiant' ? 7000 : 2500
    );
  } catch (e) {
    element.value = ancienne;
    message(e.message, 'erreur');
  }
};

window.definirCode = async (id, nom) => {
  const pin = prompt(`Code de connexion de ${nom} (4 à 8 chiffres) :`);
  if (pin === null) return;
  try {
    await API.post(`/api/admin/utilisateurs/${id}/code`, { pin: pin.trim() });
    await chargerConducteurs();
    message(`Code enregistré. Transmettez-le à ${nom} — lui seul doit le connaître.`, 'succes', 7000);
  } catch (e) {
    message(e.message, 'erreur');
  }
};

window.basculerConducteur = async (id, actif) => {
  await API.post(`/api/admin/utilisateurs/${id}/actif`, { actif });
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
    await API.post('/api/admin/utilisateurs', {
      role: 'conducteur',
      nom: $('c-nom').value,
      prenom: $('c-prenom').value,
      identifiant: $('c-identifiant').value,
      pin: $('c-pin').value,
      courriel: $('c-courriel').value,
      telephone: $('c-telephone').value,
    });
    for (const id of ['c-nom', 'c-prenom', 'c-identifiant', 'c-pin', 'c-courriel', 'c-telephone']) {
      $(id).value = '';
    }
    await chargerConducteurs();
    message('Conducteur de travaux ajouté. Transmettez-lui son identifiant et son code.', 'succes', 7000);
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

  /*
   * Cette table s'appelle « Comptes des chefs d'equipe » : elle listait
   * pourtant la direction, avec son bouton « Desactiver ». Desactiver la
   * direction depuis l'ecran des chefs est un geste qu'on ne fait jamais
   * volontairement — et son compte se regle dans « Mon compte ».
   */
  const comptesChefs = utilisateurs.filter((u) => u.role === 'chef');

  $('table-utilisateurs').querySelector('tbody').innerHTML = comptesChefs.length
    ? comptesChefs
    .map(
      (u) => {
        // Le compte ne porte qu'un champ « NOM Prenom » : on le presente en deux
        // cases, parce que c'est ainsi qu'on corrige une orthographe.
        const { nom, prenom } = Regles.separerNomPrenom(u.nom);
        return `<tr style="${u.actif ? '' : 'opacity:.5'}">
        <td><input value="${echapper(nom)}" class="cellule-calme champ-moyen"
                   onchange="corrigerCompte(${u.id}, 'nom', this.value, this)"></td>
        <td><input value="${echapper(prenom)}" class="cellule-calme champ-court"
                   onchange="corrigerCompte(${u.id}, 'prenom', this.value, this)"></td>
        <td><input value="${echapper(u.identifiant)}" class="cellule-calme champ-court"
                   onchange="corrigerCompte(${u.id}, 'identifiant', this.value, this)"></td>
        <td>${u.role}</td>
        <td>
          <button class="petit" onclick="reinitialiserCode(${u.id})">Nouveau code</button>
          <button class="petit" onclick="basculerActif(${u.id}, ${u.actif ? 0 : 1})">${u.actif ? 'Désactiver' : 'Réactiver'}</button>
          <button class="petit danger" onclick="supprimerCompte(${u.id}, '${echapper(u.nom).replace(/'/g, "\\'")}')">Supprimer</button>
        </td>
      </tr>`;
      }
    )
        .join('')
    : '<tr><td colspan="5" class="vide">Aucun compte de chef d’équipe.</td></tr>';

  const chefs = utilisateurs.filter((u) => u.role === 'chef' && u.actif);
  const options = (selectionne) =>
    `<option value="">—</option>${chefs
      .map((c) => `<option value="${c.id}"${c.id === selectionne ? ' selected' : ''}>${echapper(c.nom)}</option>`)
      .join('')}`;

  $('s-chef').innerHTML = options(null);
  $('table-salaries').querySelector('tbody').innerHTML = salaries
    .map(
      (s) => `<tr style="${s.actif ? '' : 'opacity:.5'}">
        <td><input value="${echapper(s.matricule || '')}" class="cellule-calme champ-court"
                   onchange="corrigerSalarie(${s.id}, 'matricule', this.value, this)"></td>
        <td><input value="${echapper(s.nom)}" class="cellule-calme champ-moyen"
                   onchange="corrigerSalarie(${s.id}, 'nom', this.value, this)"></td>
        <td><input value="${echapper(s.prenom)}" class="cellule-calme champ-moyen"
                   onchange="corrigerSalarie(${s.id}, 'prenom', this.value, this)"></td>
        <td><select class="cellule-calme" onchange="affecter(${s.id}, this.value)">${options(s.chef_id)}</select></td>
        ${celluleTaux(s)}
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

/*
 * Supprimer un compte, chef d'equipe comme conducteur de travaux.
 *
 * On ne pouvait que desactiver : un conducteur parti restait dans la liste,
 * grise, indefiniment. Le serveur refuse la suppression d'un compte rattache a
 * des fiches — la trace de qui a saisi ou vise doit survivre a son auteur — et
 * son refus explique quoi faire a la place. On le montre tel quel.
 */
window.supprimerCompte = async (id, nom) => {
  if (!confirm(`Supprimer définitivement le compte de ${nom} ?\n\nCette action est irréversible.`)) return;
  try {
    await API.supprimer(`/api/admin/utilisateurs/${id}`);
    message(`Compte de ${nom} supprimé.`, 'succes');
    await chargerAdmin();
    await chargerConducteurs();
  } catch (e) {
    message(e.message, 'erreur', 9000);
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
  // Le meme bouton sert aux deux populations : on rafraichit la liste ouverte.
  const nonProductif = !$('panneau-nonproductif').classList.contains('masque');
  await (nonProductif ? chargerNonProductifs() : chargerAdmin());
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
