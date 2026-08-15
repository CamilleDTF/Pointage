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

async function demarrer() {
  const { utilisateur } = await API.get('/api/moi');
  if (utilisateur.role !== 'directeur') {
    location.href = utilisateur.role === 'admin' ? '/parametres.html' : '/chef.html';
    return;
  }
  definirRole('directeur');

  reference = await API.get('/api/reference');
  $('entete-nom').textContent = `${utilisateur.nom} · version ${reference.version}`;

  // Les deux etats se chargent en parallele : aucun ne depend de l'autre, et
  // l'accueil ne doit pas attendre deux allers-retours pour s'afficher.
  await Promise.all([etatDuPointage(), etatDeLaPaie()]);
}

surClic('btn-admin', () => { location.href = '/parametres.html'; });
surClic('btn-quitter', deconnexion);
surClic('btn-semaine', () => { location.href = '/directeur.html'; });
surClic('btn-conges', () => { location.href = '/calendrier.html'; });
surClic('btn-paie', () => { location.href = '/paie.html'; });

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
