# Pointage hebdomadaire par chantier

Application de saisie et de validation des fiches de pointage hebdomadaires,
conçue pour remplacer le circuit actuel « fiche manuscrite → photo → ressaisie
Excel ».

Elle reprend à l'identique la fiche papier `SXX__CHANTIER_2026.xlsx` : 11 lignes
de salariés, 7 jours, totaux heures / route 100 % / trajet 50 %, primes (jours en
zone, type de masque VA-AA, nombre de déplacements), codes absence et signatures.

**La proposition détaillée — situation actuelle, gains, alternatives écartées,
coûts et plan de mise en service — est dans [docs/PROPOSITION.md](docs/PROPOSITION.md).**

## En deux phrases

Le chef d'équipe remplit sa fiche sur chantier, au téléphone ou au PC portable,
fait signer ses opérateurs à l'écran, et la transmet. Le directeur la reçoit dans
une grille qu'il **corrige directement**, la valide, et exporte le tout vers son
tableau Excel interne — sans jamais retaper une heure.

**Hébergement : 0 €.** L'application tourne sur une machine que vous possédez
déjà et reste accessible depuis les chantiers via Tailscale (gratuit, HTTPS
compris). Aucun abonnement, aucun nom de domaine — voir
[docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).

## Voir la démonstration

```bash
npm run demo     # produit demo/demonstration.html
```

Une page autonome, à ouvrir dans n'importe quel navigateur : elle contient les
deux écrans réels (même HTML, même CSS, même JavaScript), un jeu de données
fictives et un faux serveur en mémoire. Aucune installation, aucun réseau, rien
n'est enregistré — un rechargement remet tout à zéro.

Elle est reconstruite depuis le code de l'application : `scripts/construire-demo.js`
échoue si un motif qu'il adapte a disparu, pour qu'elle ne dérive jamais
silencieusement de l'original.

## Démarrage

```bash
npm install
npm run seed -- --demo     # crée le directeur, 8 chefs, leurs équipes et une fiche d'exemple
npm start                  # http://localhost:3000
```

Comptes créés par `npm run seed` (**à changer à la première connexion**) :

| Rôle | Identifiant | Code |
|---|---|---|
| Directeur | `directeur` | `246810` |
| Chefs d'équipe | `kbenali`, `mduarte`, `jfontaine`, `pgranjon`, `slemoine`, `ymarchand`, `tnguyen`, `frossi` | `1001` à `1008` |

Chacun change son code depuis le bouton **Code** de l'en-tête ; le directeur peut
réinitialiser n'importe quel code depuis l'écran **Équipes**.

```bash
npm test                   # contrôles métier, semaines ISO, cloisonnement des accès
```

## Chaque code ouvre sur ses propres données

Le code saisi à la connexion détermine entièrement ce qui s'affiche :

| Qui se connecte | Ce qu'il voit |
|---|---|
| Un chef d'équipe | Ses fiches et sa seule équipe — ni les fiches, ni les salariés, ni les noms des autres chefs |
| Le directeur | Les 8 chefs, toutes les fiches, les exports, la gestion des comptes |

Le cloisonnement est appliqué côté serveur, pas seulement à l'affichage : un chef
qui ouvrirait directement l'adresse de la fiche d'un collègue reçoit un refus.
`test/cloisonnement.test.js` le vérifie à chaque modification du code.

Une fiche transmise n'est plus modifiable par son chef ; seul le directeur peut la
corriger, la valider, ou la lui renvoyer pour correction avec un motif.

## Les deux écrans

### Chef d'équipe — `/chef.html`

- La fiche de la semaine courante s'ouvre pré-remplie avec les salariés affectés.
- Heures acceptées en `7h30`, `7:30`, `7,5` ou `7.5` ; le total se recalcule à la volée.
- Un code absence par jour, repris de la fiche papier (`ACH`, `F`, `NJ`, `VM`,
  `AT`, `EV`, `FOR`, `CSS`, `AA`).
- Signature tactile par salarié, plus celle du responsable de chantier.
- **Deux présentations de la même fiche**, choisies automatiquement selon la
  taille de l'écran et permutables d'un bouton :
  - *cartes* — une carte dépliante par salarié, pour le pouce sur un téléphone ;
  - *tableau* — la grille complète de la fiche papier, 11 lignes × 7 jours
    visibles d'un coup, saisie au clavier en tabulant. C'est la vue par défaut
    dès 1024 px de large.
- Filet de sécurité réseau : si la connexion tombe en pleine saisie, le travail est
  conservé sur l'appareil et transmis dès son rétablissement.
- Le bouton *Contrôler et transmettre* refuse une fiche incomplète et affiche
  précisément ce qui manque.

### Directeur — `/directeur.html`

- Indicateurs de la semaine : fiches validées, à vérifier, manquantes, salariés
  pointés, total des heures.
- Suivi des 8 chefs : qui a rendu, qui reste à relancer.
- Chaque fiche s'ouvre dans une **grille modifiable** (jour par jour, primes,
  observations) enregistrée automatiquement à chaque frappe.
- Actions : **Valider**, **Renvoyer au chef** (avec motif), **Rouvrir**,
  **Fiche Excel**.
- Exports de la semaine : **Excel** et **CSV**, au choix sur les fiches validées,
  les fiches à vérifier, ou toutes.
- Écran **Équipes** : comptes des chefs, codes, salariés et leur affectation.

## Contenu des exports

Le classeur Excel contient trois choses dans un seul fichier :

| Onglet | Contenu |
|---|---|
| `Récap hebdo` | Une ligne par salarié et par semaine — le format le plus proche d'un import paie |
| `Détail journalier` | Une ligne par salarié et par jour, avec le code absence et son libellé |
| Un onglet par fiche | Copie conforme de la fiche papier, imprimable en A4 paysage |

L'export CSV reprend l'onglet `Récap hebdo`, en `;` et UTF-8 avec BOM (Excel
français l'ouvre directement).

## Organisation du code

```
server/
  domaine.js    Règles métier : conversion des heures, semaines ISO, contrôles de cohérence
  db.js         Schéma SQLite et journal des actions
  auth.js       Sessions signées, codes PIN, limitation des tentatives
  fiches.js     Cycle de vie d'une fiche : création, saisie, transmission, validation
  export.js     Génération des classeurs Excel et du CSV
  index.js      API HTTP et service des fichiers statiques
  seed.js       Jeu de données initial
public/
  index.html    Connexion
  chef.html     Saisie mobile           + js/chef.js
  directeur.html Tableau de bord        + js/directeur.js
  js/regles.js  Règles métier partagées avec le serveur (heures, semaines, contrôles)
  js/commun.js  API, signature tactile, file d'attente en cas de coupure réseau
  sw.js         Service worker : mise en cache de la coquille de l'application
test/
  domaine.test.js       Conversion des heures, semaines ISO, contrôles de cohérence
  cloisonnement.test.js Cloisonnement des accès par code, bout en bout sur l'API
Dockerfile, docker-compose.yml   Installation en une commande sur votre machine
```

Les règles métier sont écrites **une seule fois**, dans `public/js/regles.js` :
le navigateur le charge tel quel et `server/domaine.js` l'importe. Les totaux et
les contrôles affichés au chef d'équipe sont donc rigoureusement ceux appliqués à
la réception de la fiche — aucune divergence possible entre l'écran et la paie.

## Cycle de vie d'une fiche

```
brouillon ──transmettre──► soumise ──valider──► validée
    ▲                         │                    │
    └──── renvoyer (motif) ◄──┘                    │
    └──────────────── rouvrir ─────────────────────┘
```

Un chef ne modifie que ses propres fiches, et seulement en `brouillon` ou
`rejetée`. Le directeur peut corriger n'importe quelle fiche à tout moment ;
chaque correction est tracée dans le journal.

## Configuration

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port d'écoute | `3000` |
| `DATA_DIR` | Dossier de la base et de la clé de session | `./data` |
| `SESSION_SECRET` | Clé de signature des sessions | générée dans `DATA_DIR/session.key` |
| `NODE_ENV` | `production` active le cookie `Secure` (HTTPS obligatoire) | — |

Mise en production sans abonnement : voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).

## Suite prévue

- Caler l'export sur le tableau Excel interne du directeur, dès réception du fichier.
- Fiches d'exposition journalières : projet distinct, dans un second temps.
