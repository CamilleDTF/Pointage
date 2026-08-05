'use strict';

/*
 * Envoi des courriels.
 *
 * Un seul type de message pour l'instant : la demande de visa adressee au
 * conducteur de travaux quand un chef d'equipe transmet sa fiche.
 *
 * Deux modes, choisis par la configuration :
 *
 *  - SMTP renseigne : le message part reellement.
 *  - SMTP absent    : il est ecrit dans DATA_DIR/courriels/ et le lien est
 *                     renvoye a l'appelant, qui l'affiche a l'ecran.
 *
 * Le second mode n'est pas une degradation silencieuse : c'est ce qui permet de
 * faire tourner toute la chaine avant que le service informatique ait fourni un
 * compte d'envoi. Le directeur voit alors le lien et peut le transmettre lui
 * meme. Rien ne se perd, et l'application ne s'arrete pas a une case vide dans
 * un fichier de configuration.
 */

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');
const D = require('./domaine');

/*
 * nodemailer est facultatif, et son absence ne doit jamais empecher
 * l'application de demarrer.
 *
 * Une mise a jour posee sur une installation dont les composants datent d'avant
 * l'ajout de cette bibliotheque tombait sinon sur un ecran noir, pour une
 * fonction — l'envoi de courriels — dont le reste du logiciel n'a pas besoin.
 * Sans elle, les messages sont deposes sur disque, exactement comme lorsque
 * aucun serveur d'envoi n'est configure.
 */
let nodemailer = null;
try {
  // eslint-disable-next-line global-require
  nodemailer = require('nodemailer');
} catch {
  console.warn(
    "Composant d'envoi de courriels absent (nodemailer) : les messages destines aux " +
      'conducteurs de travaux seront conserves sur le serveur. Relancez REINSTALLER.bat ' +
      'ou "npm install" pour activer l envoi.'
  );
}

const CONFIG = {
  hote: process.env.SMTP_HOTE || process.env.SMTP_HOST || '',
  port: Number(process.env.SMTP_PORT) || 587,
  utilisateur: process.env.SMTP_UTILISATEUR || process.env.SMTP_USER || '',
  motDePasse: process.env.SMTP_MOT_DE_PASSE || process.env.SMTP_PASS || '',
  expediteur: process.env.COURRIEL_EXPEDITEUR || process.env.SMTP_FROM || '',
};

const ACTIF = Boolean(nodemailer && CONFIG.hote && CONFIG.expediteur);

let transport = null;
if (ACTIF) {
  transport = nodemailer.createTransport({
    host: CONFIG.hote,
    port: CONFIG.port,
    secure: CONFIG.port === 465,
    auth: CONFIG.utilisateur ? { user: CONFIG.utilisateur, pass: CONFIG.motDePasse } : undefined,
  });
}

const DOSSIER_COURRIELS = path.join(DATA_DIR, 'courriels');

/** Ecrit le message sur disque, pour qu'il reste consultable sans serveur d'envoi. */
function deposer(destinataire, sujet, html) {
  fs.mkdirSync(DOSSIER_COURRIELS, { recursive: true });
  const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
  const nom = `${horodatage}_${destinataire.replace(/[^\w.@-]/g, '_')}.html`;
  fs.writeFileSync(path.join(DOSSIER_COURRIELS, nom), `<!-- Pour : ${destinataire}\n     Sujet : ${sujet} -->\n${html}`);
  return path.join(DOSSIER_COURRIELS, nom);
}

async function envoyer({ destinataire, sujet, html, texte }) {
  if (!destinataire) return { envoye: false, raison: 'aucune adresse' };

  if (!ACTIF) {
    const fichier = deposer(destinataire, sujet, html);
    const raison = nodemailer ? 'smtp_absent' : 'composant_absent';
    console.warn(`Courriel non expedie (${raison}) : depose dans ${fichier}`);
    return { envoye: false, raison, fichier };
  }

  try {
    await transport.sendMail({ from: CONFIG.expediteur, to: destinataire, subject: sujet, html, text: texte });
    return { envoye: true };
  } catch (erreur) {
    // Un envoi qui echoue ne doit jamais faire perdre la transmission de la
    // fiche : on garde une trace lisible et on le dit a l'appelant.
    const fichier = deposer(destinataire, sujet, html);
    console.error(`Echec de l'envoi a ${destinataire} : ${erreur.message}. Message conserve dans ${fichier}`);
    return { envoye: false, raison: erreur.message, fichier };
  }
}

/* ------------------------- Demande de visa au conducteur ------------------- */

const echapper = (t) =>
  String(t ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const BLEU = '#10416b';

function bouton(lien, libelle, fond, couleur = '#ffffff') {
  return `<a href="${echapper(lien)}" style="display:inline-block;padding:13px 22px;margin:0 8px 8px 0;
    background:${fond};color:${couleur};text-decoration:none;border-radius:8px;
    font-family:Arial,sans-serif;font-size:15px;font-weight:bold">${echapper(libelle)}</a>`;
}

/**
 * Le message adresse au conducteur de travaux : le pointage sous les yeux, et
 * les deux gestes possibles. Les liens ouvrent une page — ils ne decident de
 * rien par eux-memes. Un antivirus de messagerie qui visite les liens d'un
 * courriel viserait sinon les fiches a la place du conducteur.
 */
function messageVisa({ fiche, lignes, conducteur, chefNom, lien }) {
  const dates = D.datesDeLaSemaine(fiche.annee, fiche.semaine);
  const periode = `du ${D.jourMois(dates[0])} au ${D.jourMois(dates[6])} ${fiche.annee}`;

  const rangs = lignes
    .map((ligne) => {
      const cellules = ligne.jours
        .map((jour) => {
          const contenu = jour.code_absence || (jour.minutes ? D.versTexte(jour.minutes) : '—');
          return `<td style="border:1px solid #d7dde5;padding:5px 7px;text-align:center;font-size:13px">${echapper(contenu)}</td>`;
        })
        .join('');
      return `<tr>
        <td style="border:1px solid #d7dde5;padding:5px 9px;font-size:13px">${echapper(ligne.nom_affiche)}</td>
        ${cellules}
        <td style="border:1px solid #d7dde5;padding:5px 9px;text-align:right;font-size:13px;font-weight:bold">${
          echapper(D.versTexte(ligne.total_minutes))
        }</td>
      </tr>`;
    })
    .join('');

  const entetesJours = D.JOURS_COURTS.map(
    (j, i) =>
      `<th style="border:1px solid #d7dde5;padding:5px 7px;background:#f2f5f9;font-size:12px">${j}<br>
       <span style="font-weight:normal;color:#5a6472">${D.jourMois(dates[i])}</span></th>`
  ).join('');

  const total = lignes.reduce((s, l) => s + l.total_minutes, 0);

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;color:#1c2430;max-width:820px;margin:0 auto">
  <div style="background:${BLEU};color:#fff;padding:18px 22px;border-radius:10px 10px 0 0">
    <div style="font-size:19px;font-weight:bold">Fiche de pointage à viser</div>
    <div style="font-size:14px;opacity:.85;margin-top:3px">Semaine ${fiche.semaine} — ${periode}</div>
  </div>

  <div style="border:1px solid #d7dde5;border-top:none;border-radius:0 0 10px 10px;padding:22px">
    <p style="margin:0 0 16px">Bonjour ${echapper(conducteur.nom)},</p>
    <p style="margin:0 0 18px">
      <strong>${echapper(chefNom)}</strong> a transmis le pointage du chantier
      <strong>${echapper(fiche.chantier)}</strong>${fiche.ville ? ` à ${echapper(fiche.ville)}` : ''}.
      Il attend votre visa avant de partir à la direction.
    </p>

    <table style="border-collapse:collapse;width:100%;margin-bottom:20px">
      <thead><tr>
        <th style="border:1px solid #d7dde5;padding:5px 9px;background:#f2f5f9;font-size:12px;text-align:left">Salarié</th>
        ${entetesJours}
        <th style="border:1px solid #d7dde5;padding:5px 9px;background:#f2f5f9;font-size:12px">Total</th>
      </tr></thead>
      <tbody>${rangs}</tbody>
      <tfoot><tr>
        <th colspan="8" style="border:1px solid #d7dde5;padding:5px 9px;text-align:right;font-size:13px">Total de la semaine</th>
        <th style="border:1px solid #d7dde5;padding:5px 9px;text-align:right;font-size:13px">${echapper(D.versTexte(total))}</th>
      </tr></tfoot>
    </table>

    <p style="margin:0 0 14px;font-size:15px">Que souhaitez-vous faire ?</p>
    ${bouton(`${lien}&action=viser`, '✓ Viser cette fiche', '#1e7a46')}
    ${bouton(`${lien}&action=renvoyer`, '↩ Renvoyer avec un commentaire', '#c0392b')}

    <p style="margin:20px 0 0;font-size:13px;color:#5a6472">
      Les deux boutons ouvrent la fiche complète dans votre navigateur : rien n'est décidé
      tant que vous n'avez pas confirmé. Ce lien vous est personnel et cesse de fonctionner
      si le chef d'équipe modifie puis retransmet sa fiche.
    </p>
  </div>
</div>`;

  const texte = [
    `Fiche de pointage à viser — semaine ${fiche.semaine}, ${periode}`,
    `${chefNom} — chantier ${fiche.chantier}${fiche.ville ? ` (${fiche.ville})` : ''}`,
    `Total de la semaine : ${D.versTexte(total)}`,
    '',
    `Viser ou renvoyer : ${lien}`,
  ].join('\n');

  return {
    sujet: `Pointage à viser — ${fiche.chantier || 'chantier'} — semaine ${fiche.semaine}`,
    html,
    texte,
  };
}

module.exports = { envoyer, messageVisa, ACTIF, DOSSIER_COURRIELS };
