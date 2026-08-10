/* Fonctions partagees par l'espace chef d'equipe et le tableau de bord directeur. */

const API = {
  async appel(methode, url, corps) {
    const reponse = await fetch(url, {
      method: methode,
      headers: corps ? { 'Content-Type': 'application/json' } : undefined,
      body: corps ? JSON.stringify(corps) : undefined,
    });
    const donnees = await reponse.json().catch(() => ({}));

    /*
     * Une session finie renvoie a l'ecran de connexion. Un code mal tape, non :
     * il vaut un refus, pas une expulsion. Les deux repondaient 401, et se
     * tromper en ressaisissant son code renvoyait le directeur au tableau de
     * bord sans un mot d'explication. C'est le serveur qui distingue les deux.
     */
    if (
      reponse.status === 401 && donnees.sessionExpiree
      && !location.pathname.endsWith('/index.html') && location.pathname !== '/'
    ) {
      location.href = '/';
      throw new Error('Session expiree.');
    }

    if (!reponse.ok) {
      const erreur = new Error(donnees.erreur || `Erreur ${reponse.status}`);
      erreur.anomalies = donnees.anomalies;
      erreur.statut = reponse.status;
      throw erreur;
    }
    return donnees;
  },
  get: (url) => API.appel('GET', url),
  post: (url, corps) => API.appel('POST', url, corps),
  put: (url, corps) => API.appel('PUT', url, corps),
  supprimer: (url) => API.appel('DELETE', url),
};

function message(texte, type = 'info', duree = 4000) {
  let zone = document.querySelector('.messages');
  if (!zone) {
    zone = document.createElement('div');
    zone.className = 'messages';
    document.body.appendChild(zone);
  }
  const el = document.createElement('div');
  el.className = `message ${type}`;
  el.textContent = texte;
  zone.appendChild(el);
  setTimeout(() => el.remove(), duree);
}

/* ------------------------------ Heures / dates ---------------------------- */

// Reprises telles quelles de js/regles.js, partage avec le serveur : les totaux
// affiches a l'ecran sont calcules par le meme code que ceux de la paie.
const { versMinutes, versTexte, versSaisie, jourMois, controlerFiche } = Regles;

// Le role de la personne connectee, renseigne au demarrage de chaque ecran :
// un meme statut ne se dit pas pareil selon qu'on transmet ou qu'on valide.
let roleCourant = 'directeur';
const definirRole = (role) => { roleCourant = role; };

const etiquetteStatut = (statut, role) => Regles.etiquetteStatut(statut, role || roleCourant);

/** "2026-09-01" -> "1er septembre 2026" */
function dateFrancaise(iso) {
  // Un horodatage « 2026-08-10 08:55:07 » est une date aussi : sans cette
  // coupe, l'heure collee au quantieme rendait le nombre illisible et la
  // fonction retournait une chaine vide, sans rien dire.
  const [annee, mois, jour] = String(iso || '').slice(0, 10).split('-').map(Number);
  if (!annee || !mois || !jour) return '';
  const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  return `${jour === 1 ? '1er' : jour} ${MOIS[mois - 1]} ${annee}`;
}

function badgeStatut(statut, role) {
  return `<span class="etat ${statut}">${echapper(etiquetteStatut(statut, role))}</span>`;
}

function echapper(texte) {
  return String(texte ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/* --------------------------------- Signature ------------------------------ */

/** Transforme un <canvas> en zone de signature tactile. */
function activerSignature(canvas, auChangement) {
  const ctx = canvas.getContext('2d');
  let dessine = false;
  let vide = true;

  function dimensionner() {
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const image = vide ? null : canvas.toDataURL();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#10416b';
    if (image) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = image;
    }
  }
  dimensionner();
  window.addEventListener('resize', dimensionner);

  const position = (e) => {
    const rect = canvas.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    return { x: point.clientX - rect.left, y: point.clientY - rect.top };
  };

  const debut = (e) => {
    e.preventDefault();
    dessine = true;
    const p = position(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const trace = (e) => {
    if (!dessine) return;
    e.preventDefault();
    const p = position(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    vide = false;
  };
  const fin = () => {
    if (!dessine) return;
    dessine = false;
    if (!vide && auChangement) auChangement(canvas.toDataURL('image/png'));
  };

  canvas.addEventListener('pointerdown', debut);
  canvas.addEventListener('pointermove', trace);
  canvas.addEventListener('pointerup', fin);
  canvas.addEventListener('pointerleave', fin);

  return {
    effacer() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      vide = true;
      if (auChangement) auChangement(null);
    },
    estVide: () => vide,
  };
}

/* -------------------------- Sauvegarde hors ligne ------------------------- */

/**
 * Sur chantier le reseau est souvent absent. Chaque enregistrement est d'abord
 * ecrit en local, puis rejoue des que la connexion revient.
 */
const FileAttente = {
  cle: 'pointage.file',

  lire() {
    try {
      return JSON.parse(localStorage.getItem(this.cle) || '[]');
    } catch {
      return [];
    }
  },

  ecrire(file) {
    localStorage.setItem(this.cle, JSON.stringify(file.slice(-40)));
  },

  ajouter(ficheId, corps) {
    const file = this.lire().filter((e) => e.ficheId !== ficheId);
    file.push({ ficheId, corps, horodatage: Date.now() });
    this.ecrire(file);
  },

  taille() {
    return this.lire().length;
  },

  async vider() {
    const file = this.lire();
    if (!file.length) return 0;
    const restants = [];
    let envoyes = 0;
    for (const entree of file) {
      try {
        await API.put(`/api/fiches/${entree.ficheId}`, entree.corps);
        envoyes += 1;
      } catch (e) {
        if (e.statut && e.statut >= 400 && e.statut < 500 && e.statut !== 401) continue; // rejet definitif
        restants.push(entree);
      }
    }
    this.ecrire(restants);
    return envoyes;
  },
};

function surveillerReseau(auChangement) {
  const banniere = document.getElementById('banniere-reseau');
  const actualiser = async () => {
    const enLigne = navigator.onLine;
    if (banniere) {
      banniere.classList.toggle('masque', enLigne && FileAttente.taille() === 0);
      banniere.textContent = enLigne
        ? `${FileAttente.taille()} enregistrement(s) en attente de synchronisation…`
        : 'Hors ligne — vos saisies sont conservées sur l’appareil et transmises au retour du réseau.';
    }
    if (enLigne && FileAttente.taille()) {
      const envoyes = await FileAttente.vider();
      if (envoyes) {
        message(`${envoyes} fiche(s) synchronisée(s).`, 'succes');
        if (auChangement) auChangement();
      }
      if (banniere) banniere.classList.toggle('masque', FileAttente.taille() === 0);
    }
  };
  window.addEventListener('online', actualiser);
  window.addEventListener('offline', actualiser);
  setInterval(actualiser, 20000);
  actualiser();
  return actualiser;
}

function antiRebond(fn, delai = 900) {
  let minuteur;
  return (...args) => {
    clearTimeout(minuteur);
    minuteur = setTimeout(() => fn(...args), delai);
  };
}

async function deconnexion() {
  await API.post('/api/deconnexion').catch(() => {});
  location.href = '/';
}

/*
 * Prevenir le conducteur : les boutons d'envoi, classes selon l'appareil.
 *
 * Une fiche se remplit au telephone, mais elle se corrige aussi depuis un PC de
 * bureau, et la direction relance depuis le sien. Or `sms:` n'y mene le plus
 * souvent nulle part — sous Windows il faut un telephone Android apparie — et un
 * bouton qui ne fait rien est pire que pas de bouton du tout : on croit avoir
 * prevenu.
 *
 * On classe donc les moyens par ce qui fonctionne sur l'appareil qu'on a en
 * main. Sur un PC, c'est la messagerie de celui qui est devant l'ecran qui prend
 * le relais : ce n'est pas elle qui est bloquee, c'est l'envoi automatique
 * depuis le serveur. « Copier le message » reste la, et marche partout.
 */
const surTelephone = window.matchMedia && matchMedia('(pointer: coarse)').matches;

function blocAlerte(alerte, attributCopier = 'data-copier') {
  const lien = (href, libelle, nouvelOnglet) =>
    href
      ? `<a class="bouton-lien" href="${echapper(href)}"${
          nouvelOnglet ? ' target="_blank" rel="noopener"' : ''
        }>${libelle}</a>`
      : '';

  // L'ordre compte : le premier bouton est celui qui aboutit a coup sur ici.
  const moyens = (
    surTelephone
      ? [lien(alerte.sms, 'SMS'), lien(alerte.whatsapp, 'WhatsApp', true), lien(alerte.courriel, 'Courriel')]
      : [lien(alerte.courriel, 'Courriel'), lien(alerte.whatsapp, 'WhatsApp', true)]
  ).filter(Boolean);

  const note = surTelephone
    ? ''
    : `<p class="aide" style="margin-top:8px">Depuis un ordinateur, le SMS n’est pas disponible. ${
        alerte.courriel
          ? '<strong>Courriel</strong> ouvre votre messagerie avec le message déjà écrit : c’est la vôtre qui l’envoie, pas le serveur.'
          : 'Copiez le message et envoyez-le par le moyen de votre choix.'
      }</p>`;

  return `<div class="rangee" style="margin-top:12px">
        ${moyens.join('\n        ')}
        <button class="petit" type="button" ${attributCopier}>Copier le message</button>
      </div>${note}`;
}

/*
 * Le service worker mettait la coquille de l'application en cache pour un mode
 * hors ligne dont les chefs d'equipe n'ont pas besoin : ils sont connectes en
 * permanence. En echange, il pouvait servir une page d'une version et son
 * script d'une autre — un ecran blanc pour un benefice nul. On le retire, et on
 * desinstalle celui deja pose sur les appareils.
 */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations?.()
    .then((enregistrements) => enregistrements.forEach((r) => r.unregister()))
    .catch(() => {});
  if (window.caches) caches.keys().then((cles) => cles.forEach((c) => caches.delete(c))).catch(() => {});
}
