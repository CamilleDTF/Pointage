/*
 * L'accueil : de quoi s'occupe-t-on ?
 *
 * Le tableau de bord melait la semaine et le mois. On y verifiait des fiches,
 * puis on tombait sur la paie, sans que rien ne dise qu'on avait change de
 * sujet — deux rythmes, deux gestes, une seule page.
 *
 * Cet ecran ne fait donc rien d'autre que poser la question. Mais il ne la pose
 * pas a vide : chaque porte annonce ce qu'il y a derriere. Une porte qui dit
 * « 3 fiches vous attendent » se choisit ; une porte qui ne dit rien se
 * franchit au hasard, et l'on revient.
 */

let reference = null;

const $ = (id) => document.getElementById(id);

function surClic(id, action) {
  const element = $(id);
  if (!element) {
    console.warn(`Element "${id}" absent de la page : fonction indisponible, le reste fonctionne.`);
    return;
  }
  element.addEventListener('click', action);
}

/*
 * L'administrateur passe par ici lui aussi.
 *
 * Il voit tout le pointage — l'API le lui accorde depuis le debut — mais aucun
 * ecran ne l'y menait : il atterrissait dans les Parametres, et le tableau de
 * bord le renvoyait dehors. Le cloisonnement porte sur les MONTANTS, pas sur
 * les heures : qui a transmis, qui est en retard, cela le regarde.
 *
 * Sa deuxieme porte n'est donc pas la paie — elle lui est fermee, et une porte
 * qui refuse est pire qu'une porte absente — mais le suivi.
 */
let estAdmin = false;

async function demarrer() {
  const { utilisateur } = await API.get('/api/moi');
  if (!['directeur', 'admin'].includes(utilisateur.role)) {
    location.href = utilisateur.role === 'conducteur' ? '/conducteur.html' : '/chef.html';
    return;
  }
  estAdmin = utilisateur.role === 'admin';
  definirRole(utilisateur.role);

  reference = await API.get('/api/reference');
  $('entete-nom').textContent = `${utilisateur.nom} · version ${reference.version}`;

  if (estAdmin) preparerPorteAdministrateur();

  // Les deux etats se chargent en parallele : aucun ne depend de l'autre, et
  // l'accueil ne doit pas attendre deux allers-retours pour s'afficher.
  await Promise.all([etatDuPointage(), estAdmin ? etatDuSuivi() : etatDeLaPaie()]);
}

/* La porte de la paie devient celle du suivi : les montants lui sont fermes. */
function preparerPorteAdministrateur() {
  // La barre disait « Direction » a quelqu'un qui n'en est pas.
  if ($('entete-titre')) $('entete-titre').textContent = 'Pointage hebdomadaire — Administration';

  const porte = document.querySelector('.porte.paie');
  if (!porte) return;
  porte.querySelector('h2').textContent = 'Suivi';
  porte.querySelector('.quand').textContent = 'Toutes les semaines';
  porte.querySelector('.marqueur').textContent = 'I';
  porte.querySelector('.quoi').textContent =
    'L’assiduité de chaque chef d’équipe : ce qui est transmis, ce qui manque, '
    + 'et le retard moyen. Aucun montant n’y figure.';
  $('btn-paie').textContent = 'Ouvrir le suivi';
}

/*
 * Ce que le suivi annonce : combien de chefs sont en retard.
 *
 * On ne montre pas une moyenne d'assiduite sur la porte : une moyenne ne se
 * decide pas. Ce qui appelle un geste, c'est le nombre de chefs qui n'ont rien
 * transmis.
 */
async function etatDuSuivi() {
  const zone = $('etat-paie');
  try {
    const { chefs } = await API.get('/api/admin/indicateurs');
    const enRetard = chefs.filter((c) => (c.enRetard || 0) > 0);

    zone.innerHTML = `
      <p class="periode">${chefs.length} chef(s) d’équipe</p>
      ${
        enRetard.length
          ? `<ul class="points"><li class="manque"><strong>${enRetard.length}</strong> ${
              enRetard.length > 1 ? 'chefs ont des fiches en retard' : 'chef a des fiches en retard'
            }</li></ul>
             <p class="aide">${citer(enRetard.map((c) => c.nom))}</p>`
          : '<p class="rien-a-faire">Aucune fiche manquante : tout le monde a transmis.</p>'
      }`;
  } catch (e) {
    zone.innerHTML = `<p class="aide">${echapper(e.message)}</p>`;
  }
}

/** Trois noms, puis « et N autres » : une porte n'est pas une liste. */
function citer(noms) {
  if (noms.length <= 3) return noms.join(', ');
  return `${noms.slice(0, 3).join(', ')} et ${noms.length - 3} autre(s)`;
}

surClic('btn-admin', () => { location.href = '/parametres.html'; });
surClic('btn-quitter', deconnexion);
surClic('btn-semaine', () => { location.href = '/directeur.html'; });
surClic('btn-conges', () => { location.href = '/calendrier.html'; });
surClic('btn-paie', () => { location.href = estAdmin ? '/parametres.html#indicateurs' : '/paie.html'; });

/*
 * Ce qui attend derriere la porte « Pointage » : la semaine en cours.
 *
 * On annonce ce qui appelle un geste — les fiches a verifier, celles qui
 * manquent — et non un total d'heures : le total ne se decide pas, il se
 * constate. L'accueil sert a choisir quoi faire.
 */
async function etatDuPointage() {
  const zone = $('etat-pointage');
  const { annee, semaine } = reference.semaineCourante;

  try {
    const t = await API.get(`/api/tableau?annee=${annee}&semaine=${semaine}`);
    const rendues = t.fiches.length;
    const aVerifier = t.fiches.filter((f) => Regles.etatAffiche(f) === 'soumise').length;
    const manquantes = Math.max(0, t.totaux.attendues - rendues);

    const points = [];
    if (aVerifier) points.push({ nombre: aVerifier, texte: aVerifier > 1 ? 'fiches à vérifier' : 'fiche à vérifier', ton: 'agir' });
    if (manquantes) points.push({ nombre: manquantes, texte: manquantes > 1 ? 'fiches manquantes' : 'fiche manquante', ton: 'manque' });

    zone.innerHTML = `
      <p class="periode">Semaine ${semaine} · du ${jourMois(t.dates[0])} au ${jourMois(t.dates[6])}</p>
      ${
        points.length
          ? `<ul class="points">${points
              .map((p) => `<li class="${p.ton}"><strong>${p.nombre}</strong> ${p.texte}</li>`)
              .join('')}</ul>`
          : '<p class="rien-a-faire">Rien à traiter : toutes les fiches sont validées.</p>'
      }`;
  } catch (e) {
    zone.innerHTML = `<p class="aide">${echapper(e.message)}</p>`;
  }
}

/*
 * Ce qui attend derriere la porte « Paie » : le mois en cours.
 *
 * Le nombre de fiches non validees, parce que c'est le seul chiffre qui
 * empeche de transmettre — et le seul qu'on ne peut pas voir depuis la paie
 * elle-meme sans y entrer.
 */
async function etatDeLaPaie() {
  const zone = $('etat-paie');
  const maintenant = new Date();
  const annee = maintenant.getFullYear();
  const mois = maintenant.getMonth() + 1;

  try {
    const a = await API.get(`/api/export/mois-apercu?annee=${annee}&mois=${mois}`);
    const manquantes = Number(a.nonValidees) || 0;

    zone.innerHTML = `
      <p class="periode">${Regles.MOIS[mois - 1]} ${annee}</p>
      ${
        manquantes
          ? `<ul class="points"><li class="manque"><strong>${manquantes}</strong> ${
              manquantes > 1 ? 'fiches non validées' : 'fiche non validée'
            }</li></ul>
             <p class="aide">Elles ne compteront pas dans le tableau du cabinet.</p>`
          : `<p class="rien-a-faire">${
              a.nbSalaries
                ? `${a.nbSalaries} salarié(s), ${versTexte(a.minutes)} — rien ne bloque la transmission.`
                : 'Aucune fiche validée pour l’instant.'
            }</p>`
      }`;
  } catch (e) {
    zone.innerHTML = `<p class="aide">${echapper(e.message)}</p>`;
  }
}

demarrer().catch((e) => message(e.message, 'erreur'));
