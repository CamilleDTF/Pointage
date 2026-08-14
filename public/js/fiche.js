/*
 * L'ecran d'une fiche, cote direction.
 *
 * Ce code vivait dans directeur.js, ou il occupait plus de la moitie du
 * fichier : le tableau de bord depliait les fiches de la semaine les unes sous
 * les autres, et la page atteignait sept mille pixels de haut. On y traversait
 * quatre grilles de saisie de onze lignes sur sept jours pour atteindre le
 * suivi, qu'on venait justement consulter.
 *
 * Une fiche s'ouvre desormais sur sa propre adresse — `/fiche.html?id=…` —
 * c'est-a-dire quand on a decide de s'en occuper. Le code, lui, n'a pas change :
 * meme grille, memes controles, memes decisions.
 */

let ficheCourante = null;
let reference = null;

const $ = (id) => document.getElementById(id);

async function demarrer() {
  const { utilisateur } = await API.get('/api/moi');
  if (!['directeur', 'admin'].includes(utilisateur.role)) {
    location.href = '/chef.html';
    return;
  }
  definirRole(utilisateur.role);

  reference = await API.get('/api/reference');
  $('entete-nom').textContent = `${utilisateur.nom} · version ${reference.version}`;

  const id = Number(new URLSearchParams(location.search).get('id'));
  if (!id) {
    location.href = '/directeur.html';
    return;
  }

  const { fiche } = await API.get(`/api/fiches/${id}`);
  ficheCourante = fiche;
  $('entete-fiche').textContent = `${fiche.chef_nom} — semaine ${fiche.semaine}/${fiche.annee}`;

  const bloc = construireFiche(fiche);
  $('fiche').innerHTML = '';
  $('fiche').appendChild(bloc);
  // Sur sa propre page, la fiche est deja ce qu'on est venu voir : elle s'ouvre.
  const repli = bloc.querySelector('details');
  if (repli) repli.open = true;
}

/* Les deux boutons de l'en-tete, qui ne dependent pas de la fiche. */
document.getElementById('btn-retour').addEventListener('click', () => {
  const f = ficheCourante;
  location.href = f ? `/directeur.html?annee=${f.annee}&semaine=${f.semaine}` : '/directeur.html';
});
document.getElementById('btn-quitter').addEventListener('click', deconnexion);

/*
 * `allerA` existait pour deplier une fiche dans la longue page du tableau de
 * bord. Elle y menait par un ancrage ; elle y mene maintenant par une adresse.
 */
function allerA(ficheId) {
  location.href = `/fiche.html?id=${ficheId}`;
}
window.allerA = allerA;


/** Renvoie un lien de visa au conducteur, et affiche ce lien en cas d'echec d'envoi. */
async function relancerVisa(ficheId) {
  try {
    const { visa } = await API.post(`/api/fiches/${ficheId}/relancer-visa`);
    if (!visa.demande) {
      message("Aucun conducteur de travaux n'est rattaché à ce chef d'équipe.", 'erreur', 7000);
    } else if (visa.envoye) {
      message(`Nouveau lien envoyé à ${visa.conducteur} (${visa.courriel}).`, 'succes', 6000);
    } else {
      // Sans serveur d'envoi, deux voies restent ouvertes : prevenir le
      // conducteur par message — il ouvre sa page habituelle — ou lui
      // transmettre ce lien-ci, qui ouvre cette fiche precise.
      afficherLienVisa(visa);
    }
    await charger();
  } catch (e) {
    message(e.message, 'erreur');
  }
}

/*
 * Quand le courriel ne part pas.
 *
 * Il n'y a rien a rattraper cote acces : le conducteur a un compte, ses fiches
 * l'attendent des qu'il se connecte. Il ne lui manque que de savoir qu'une fiche
 * est arrivee — un message sans lien y pourvoit, et se transmet par n'importe
 * quel moyen.
 */
function afficherLienVisa(visa) {
  const alerte = visa.alerte || {};
  const fenetre = document.createElement('div');
  fenetre.className = 'fenetre';
  fenetre.innerHTML = `
    <div class="fenetre-corps">
      <h2>Prévenir ${echapper(visa.conducteur)}</h2>
      <p class="aide">
        Le courriel n'est pas parti. ${echapper(visa.conducteur)} retrouvera la fiche en se
        connectant : il lui suffit de savoir qu'elle l'attend.
      </p>
      <textarea readonly style="min-height:130px;font-size:0.86rem">${echapper(alerte.texte || '')}</textarea>
      ${blocAlerte(alerte, 'data-copier-message')}
      <div class="rangee detache">
        <span class="pousse"></span>
        <button class="petit principal" type="button" data-fermer>Fermer</button>
      </div>
    </div>`;
  document.body.appendChild(fenetre);

  fenetre.querySelector('[data-copier-message]').addEventListener('click', async () => {
    await navigator.clipboard.writeText(alerte.texte || '').catch(() => {});
    message('Message copié.', 'succes', 2500);
  });
  const fermer = () => fenetre.remove();
  fenetre.querySelector('[data-fermer]').addEventListener('click', fermer);
  fenetre.addEventListener('click', (e) => { if (e.target === fenetre) fermer(); });
}

/* ------------------ Grille de correction, une par fiche ------------------- */

/*
 * Ce que le conducteur de travaux a corrige, avant de viser.
 *
 * Les operateurs ont signe une version du pointage ; le directeur valide la
 * suivante. Lui montrer la difference lui evite de comparer deux ecrans — ou,
 * plus probablement, de ne rien comparer du tout.
 */
const INTITULES_RELEVE = {
  correction_conducteur: 'Corrigé par',
  correction_directeur: 'Corrigé par',
  correction_rectificatif: 'Corrigé par',
  rectificatif_ouvert: 'Rectificatif ouvert par',
  rectificatif_valide: 'Rectificatif validé par',
  signature_invalidee: 'Signature à reprendre —',
  identite_corrigee: 'Identité rétablie —',
};

function relevesConducteur(fiche) {
  const releves = (fiche.journal || []).filter((e) => INTITULES_RELEVE[e.action]);
  if (!releves.length) return '';

  // Le journal arrive du plus recent au plus ancien : on le remet dans l'ordre
  // ou les choses se sont passees, qui est celui ou on les lit.
  return releves
    .slice()
    .reverse()
    .map(
      (e) => `<div class="corrections-conducteur">
        <strong>${INTITULES_RELEVE[e.action]} ${echapper(e.auteur || 'la direction')}</strong>
        le ${echapper(dateFrancaise(e.horodatage))} :
        ${echapper(e.detail.split(' ; ').join('\n'))}
      </div>`
    )
    .join('');
}

/**
 * Le bandeau d'une fiche validee.
 *
 * Elle est partie en paie et porte les signatures des operateurs : elle ne se
 * corrige plus a la main. Le dire vaut mieux que de laisser cliquer dans des
 * cases dont l'enregistrement sera refuse.
 */
function bandeauValidee(fiche) {
  if (fiche.statut !== 'validee') return '';
  return `<p class="aide" style="background:#eef6ee;border-left:3px solid var(--vert);padding:8px 10px;margin:0 0 12px">
      <strong>Fiche validée${fiche.version > 1 ? ` — version ${fiche.version}` : ''}</strong>${
        fiche.validee_le ? ` le ${echapper(dateFrancaise(fiche.validee_le))}` : ''
      } : elle n'est plus modifiable. Pour la corriger, ouvrez un <strong>rectificatif</strong> —
      la version validée est conservée telle quelle.
    </p>`;
}

function construireFiche(fiche) {
  const bloc = document.createElement('details');
  bloc.className = 'carte';
  bloc.id = `fiche-${fiche.id}`;
  bloc.open = fiche.statut === 'soumise';

  const lignes = fiche.lignes.filter((l) => l.nom_affiche.trim());
  /*
   * Les sept dates viennent de la fiche, qui les porte deja. Elles venaient du
   * tableau de bord — la longue page qui depliait toutes les fiches — et cette
   * dependance-la n'avait pas de raison d'etre : une fiche sait de quelle
   * semaine elle est.
   */
  const entetesJours = fiche.dates
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
            <input class="cellule heures" data-jour="${j}" value="${Regles.versSaisieJour(jour)}"
                  >
            <select class="cellule code" data-jour="${j}">
              <option value="">—</option>${codes}
            </select>
          </td>`;
        })
        .join('');

      return `<tr data-index="${index}" data-ligne-id="${ligne.id}">
        <td style="min-width:170px">${echapper(ligne.nom_affiche)}</td>
        ${cellulesJours}
        <td class="num total" style="font-weight:700">${versTexte(ligne.total_minutes)}</td>
        <td class="num"><input class="cellule route" value="${versSaisie(ligne.minutes_route)}"></td>
        <td class="num"><input class="cellule trajet" value="${versSaisie(ligne.minutes_trajet)}"></td>
        <td class="num"><input class="cellule zone" type="number" min="0" max="7" step="0.5" value="${ligne.jours_zone || ''}"></td>
        <td class="num"><select class="cellule masque-type">
          <option value=""${!ligne.type_masque ? ' selected' : ''}>—</option>
          <option value="VA"${ligne.type_masque === 'VA' ? ' selected' : ''}>VA</option>
          <option value="AA"${ligne.type_masque === 'AA' ? ' selected' : ''}>AA</option>
        </select></td>
        <td class="num"><input class="cellule deplacement" type="number" min="0" step="1" value="${ligne.nb_deplacement || ''}"></td>
        <td><input class="cellule observation" value="${echapper(ligne.observation)}"></td>
        <td class="num">${ligne.signature ? '<span title="Signée">✔</span>' : '<span style="color:var(--rouge)" title="Signature manquante">✘</span>'}</td>
      </tr>`;
    })
    .join('');

  bloc.innerHTML = `
    <summary style="cursor:pointer;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
      <strong>${echapper(fiche.chef_nom)}</strong>
      <span>${echapper(fiche.chantier || 'chantier non renseigné')} — ${echapper(fiche.ville)}</span>
      ${badgeStatut(Regles.etatAffiche(fiche))}
      <span class="pousse aide serree">${lignes.length} salarié(s) · ${versTexte(fiche.total_minutes)}</span>
    </summary>

    <div class="detache">
      ${fiche.motif_rejet ? `<p class="aide" style="color:var(--rouge);font-weight:600">Renvoyée : ${echapper(fiche.motif_rejet)}</p>` : ''}
      ${bandeauValidee(fiche)}
      ${bandeauVisa(fiche)}
      ${relevesConducteur(fiche)}
      <div class="grille trois detache-apres">
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

      <ul class="anomalies detache"></ul>

      <div class="rangee detache">
        <span class="aide etat-enregistrement serree"></span>
        <span class="pousse"></span>
        <button class="petit" data-action="excel">Fiche Excel</button>
        ${
          fiche.statut === 'validee'
            ? '<button class="petit" data-action="rouvrir">Ouvrir un rectificatif</button>'
            : `${fiche.visa_statut === 'attente' ? '<button class="petit" data-action="relancer">Relancer le conducteur</button>' : ''}
               <button class="petit" data-action="rouvrir">Rouvrir pour le chef</button>
               <button class="petit danger" data-action="rejeter">Renvoyer au chef</button>
               <button class="petit valide" data-action="valider">${
                 fiche.visa_statut === 'attente' ? 'Valider sans le visa' : 'Valider'
               }</button>`
        }
      </div>
    </div>`;

  cablerFiche(bloc, fiche);
  return bloc;
}

/**
 * L'etat du visa du conducteur de travaux, en une ligne. Le directeur doit
 * pouvoir dire d'un coup d'oeil s'il attend quelqu'un — et qui.
 */
function bandeauVisa(fiche) {
  if (fiche.statut !== 'soumise' && !fiche.visa_le) return '';

  if (fiche.visa_statut === 'vise') {
    return `<p class="bandeau-visa vise">
        ✓ Visée par le conducteur de travaux${fiche.visa_le ? ` le ${echapper(fiche.visa_le.slice(0, 10))}` : ''}.
        ${fiche.visa_commentaire ? `Son commentaire : ${echapper(fiche.visa_commentaire)}` : ''}
      </p>`;
  }
  if (fiche.visa_statut === 'attente') {
    return `<p class="bandeau-visa attente">
        En attente du visa de ${echapper(fiche.visa_courriel || 'du conducteur de travaux')}${
      fiche.visa_envoye_le ? `, envoyé le ${echapper(fiche.visa_envoye_le.slice(0, 10))}` : ''
    }. Vous pouvez valider sans attendre s'il n'est pas joignable.
      </p>`;
  }
  return `<p class="bandeau-visa aucun">
      Aucun conducteur de travaux n'est rattaché à ce chef d'équipe : la fiche vous est venue directement.
      Le rattachement se règle dans Paramètres.
    </p>`;
}

function cablerFiche(bloc, fiche) {
  const enregistrerPlusTard = antiRebond(() => enregistrerFiche(bloc, fiche.id), 900);

  /*
   * Une fiche validee ne se corrige pas a la main : les cases sont fermees
   * plutot que laissees ouvertes sur un enregistrement qui sera refuse. Le
   * bandeau dit par ou passer — le rectificatif.
   */
  if (fiche.statut === 'validee') {
    bloc.querySelectorAll('.cellule, .entete').forEach((champ) => { champ.disabled = true; });
    cablerDecisions(bloc, fiche);
    afficherAnomalies(bloc, fiche.anomalies || []);
    return;
  }

  bloc.querySelectorAll('.cellule, .entete').forEach((champ) => {
    champ.addEventListener('input', enregistrerPlusTard);
    champ.addEventListener('change', enregistrerPlusTard);
  });

  bloc.querySelectorAll('input.heures').forEach((champ) => {
    // Un zero saisi reste "0h00" : c'est la declaration d'un jour non travaille,
    // a ne pas confondre avec une case que personne n'a remplie.
    champ.addEventListener('blur', () => {
      champ.value = champ.value.trim() === '' ? '' : versTexte(versMinutes(champ.value));
      recalculerTotal(champ.closest('tr'));
    });
    champ.addEventListener('input', () => recalculerTotal(champ.closest('tr')));
  });
  for (const classe of ['input.route', 'input.trajet']) {
    bloc.querySelectorAll(classe).forEach((champ) => {
      champ.addEventListener('blur', () => { champ.value = versSaisie(versMinutes(champ.value)); });
    });
  }
  // « F » est le seul code qui garde ses heures : un ferie peut se travailler.
  bloc.querySelectorAll('select.code').forEach((select) => {
    select.addEventListener('change', () => {
      const rang = select.closest('tr');
      const saisie = rang.querySelector(`input.heures[data-jour="${select.dataset.jour}"]`);
      if (select.value && !Regles.CODES_AVEC_HEURES.includes(select.value)) saisie.value = '';
      recalculerTotal(rang);
    });
  });

  cablerDecisions(bloc, fiche);
  afficherAnomalies(bloc, fiche.anomalies || []);
}

function cablerDecisions(bloc, fiche) {
  bloc.querySelectorAll('button[data-action]').forEach((bouton) => {
    bouton.addEventListener('click', async (e) => {
      e.preventDefault();
      const action = bouton.dataset.action;
      if (action === 'excel') {
        window.location.href = `/api/export/fiche/${fiche.id}.xlsx`;
        return;
      }
      if (action === 'relancer') return relancerVisa(fiche.id);
      if (action === 'valider' && fiche.visa_statut === 'attente') {
        const nom = fiche.visa_courriel || 'le conducteur de travaux';
        if (!confirm(`${nom} n'a pas encore visé cette fiche. La valider quand même ?`)) return;
      }

      let motif = '';
      if (action === 'rejeter') {
        motif = prompt('Motif du renvoi au chef d’équipe :') || '';
        if (!motif.trim()) return;
      }
      /*
       * Rouvrir une fiche validee, c'est ouvrir un rectificatif : elle est
       * partie en paie, et le motif est la premiere chose qu'on cherchera dans
       * six mois. Le serveur l'exige aussi — on ne demande pas ici ce qu'on
       * pourrait contourner la.
       */
      if (action === 'rouvrir' && fiche.statut === 'validee') {
        motif = prompt(
          'Cette fiche a été validée. Ouvrir un rectificatif conserve la version validée '
            + 'et en prépare une nouvelle.\n\nMotif du rectificatif :'
        ) || '';
        if (!motif.trim()) return;
      }

      // Une fiche validee est figee : rien a enregistrer avant de decider, et
      // l'enregistrement serait refuse.
      if (fiche.statut !== 'validee') await enregistrerFiche(bloc, fiche.id);

      try {
        await API.post(`/api/fiches/${fiche.id}/decision`, { decision: action, motif });
        message(
          {
            valider: 'Fiche validée.',
            rejeter: 'Fiche renvoyée au chef d’équipe.',
            rouvrir: fiche.statut === 'validee' ? 'Rectificatif ouvert.' : 'Fiche rouverte.',
          }[action],
          'succes'
        );
        await charger();
      } catch (erreur) {
        if (erreur.anomalies) afficherAnomalies(bloc, erreur.anomalies);
        message(erreur.message, 'erreur');
      }
    });
  });
}

function recalculerTotal(rang) {
  let total = 0;
  rang.querySelectorAll('input.heures').forEach((champ) => { total += versMinutes(champ.value); });
  rang.querySelector('.total').textContent = versTexte(total);
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
      const saisie = rang.querySelector(`input.heures[data-jour="${j}"]`).value;
      jours.push({
        jour: j,
        minutes: versMinutes(saisie),
        code_absence: rang.querySelector(`select.code[data-jour="${j}"]`).value,
        saisi: saisie.trim() === '' ? 0 : 1,
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
demarrer().catch((e) => message(e.message, 'erreur'));
