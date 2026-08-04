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

**Hébergement : 0 €.** L'application tourne sur une machine virtuelle Oracle Cloud
Always Free — gratuite à vie, créée sans dépendre d'un administrateur — et reste
accessible depuis les chantiers via Tailscale (gratuit, HTTPS compris). Aucun
abonnement, aucun nom de domaine, aucun matériel. Elle s'installe à l'identique
sur un NAS ou un PC d'entreprise si l'accès est disponible :
voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).

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

## Essayer sur son poste, avant tout hébergement

Il suffit d'avoir [Node.js](https://nodejs.org) 20 ou plus. Aucun droit
particulier, aucune installation serveur.

**Windows** : double-cliquez sur `DEMARRER.bat`, à la racine du dossier. Un
fichier `.bat` échappe à la politique d'exécution qui bloque les scripts
PowerShell sur la plupart des postes d'entreprise — c'est la voie la plus sûre.
`scripts\demarrer.ps1` fait la même chose pour qui préfère PowerShell.

**macOS et Linux** :

```bash
./scripts/demarrer.sh
```

Le script installe les dépendances au premier lancement, crée un compte directeur
(`directeur` / `246810`) et sert l'application sur `http://localhost:3000`. Il est
relançable sans risque : les données déjà saisies sont conservées.

Pour travailler sur l'effectif réel plutôt que sur des données fictives :

```bash
node scripts/importer-effectif.js votre-fichier.xlsx --appliquer
```

Les chefs se connectent alors avec les identifiants et les codes de ce fichier.

### Comptes

Sur une installation neuve, le premier compte se crée en ligne de commande — les
écrans d'administration supposent d'être déjà connecté en directeur :

```bash
node scripts/creer-compte.js --nom "Direction travaux" \
     --identifiant directeur --code 246810 --role directeur
```

Chacun change ensuite son code depuis le bouton **Code** de l'en-tête ; le
directeur peut réinitialiser n'importe quel code depuis l'écran **Équipes**.

`npm run seed -- --demo` reste disponible pour peupler une base d'essai avec
8 chefs fictifs, leurs équipes et une fiche d'exemple.

```bash
npm test                   # contrôles métier, semaines ISO, paie, cloisonnement des accès
```

## Charger l'effectif depuis le tableau d'affectation

```bash
node scripts/importer-effectif.js effectif.xlsx              # simulation
node scripts/importer-effectif.js effectif.xlsx --appliquer  # écriture
```

Le classeur attendu comporte une feuille `identifiant`
(*Chef de chantier | Identifiant | Mdp*) et une feuille `Affectation opérateurs`
(*Matricule | NOM | Prénom | Chef d'équipe assigné*). Le rapprochement se fait sur
le nom, sans tenir compte des accents ni de la casse ; un opérateur dont le chef
n'est pas reconnu est créé sans affectation et signalé. La commande est
rejouable : elle met à jour l'existant plutôt que de créer des doublons.

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

## Le tableau mensuel pour la paie

Depuis le tableau de bord, le bouton **Télécharger le tableau mensuel** produit le
classeur au format du tableau interne : une feuille `Total` et une feuille par
salarié, avec les six emplacements de semaine, la ligne de totaux et le bloc de
calcul de paie. Les formules d'origine sont conservées (`INDIRECT` depuis Total,
taux horaire remonté vers les feuilles individuelles).

| Colonne | D'où elle vient |
|---|---|
| Lundi → dimanche | Heures du jour, ou code absence si la journée n'a pas été travaillée |
| `0,25` | Les 8 premières heures au-delà de 35 h **sur la semaine** |
| `0,5` | Les heures supplémentaires suivantes |
| `TRAJET 50%` / `TRAJET 100%` | Colonnes trajet 50 % et route 100 % de la fiche |
| `FÉRIÉS` | Jours marqués `F` sur la fiche, valorisés à 7 h par jour |
| `AMIANTE 1` / `AMIANTE 2` | Jours en zone, selon que le masque est `VA` ou `AA` |
| `PANIER` | Jours de déplacement |
| `GD 72` / `GD 80` | Ces mêmes jours, ventilés selon la ville du chantier |
| `Contrôle` | `total − 25 % − 50 % − 100 % − 35` : ce qui reste à redistribuer |

Restent à la main du directeur : `NUIT`, `DIMANCHE`, la colonne `1` (100 %),
`PERFO`, `EDEN RED`, `GD AUTRES`, les heures d'absence, le nombre d'heures du mois
et le taux horaire.

**Code couleur** — une case attendue de la direction s'affiche en **orange** tant
qu'elle est vide, et revient au **jaune** dès qu'elle est saisie. C'est une mise en
forme conditionnelle : l'alerte s'éteint d'elle-même, sans rien à effacer. Elle ne
porte que sur les semaines effectivement pointées : un emplacement de semaine
inutilisé ne réclame rien. La légende figure en haut de chaque feuille.

### Conventions retenues

- **Grand déplacement** *(validé)* — dès que la ville du chantier contient `Nice`
  ou `Paris`, le déplacement passe en GD 80 ; toute autre ville relève du GD 72.
  La liste est dans `public/js/regles.js` (`VILLES_GRAND_DEPLACEMENT_80`).
- **Semaines à cheval sur deux mois** *(validé)* — chaque tableau ne retient que
  ses propres jours, comme dans le classeur d'origine où le 29 et le 30 juin
  restent vides sur la feuille de juillet. Les primes suivent au prorata des jours
  pointés, et les heures supplémentaires sont calculées sur la portion du mois.
- **Valorisation d'un jour férié** *(à confirmer)* — la fiche de pointage porte un
  code `F`, pas un nombre d'heures. Un jour férié est donc compté
  `DUREE_JOURNEE_REFERENCE_MINUTES`, soit **7 h** (35 h sur 5 jours). C'est la
  seule hypothèse chiffrée de l'export : elle se change sur une ligne dans
  `public/js/regles.js`.

## Contenu des exports hebdomadaires

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
  domaine.js    Point d'entrée des règles métier (réexporte public/js/regles.js)
  mensuel.js    Agrégation d'un mois de paie par salarié et par semaine
  export-mensuel.js  Classeur mensuel au format du tableau interne du directeur
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
  paie.test.js          Majorations 25 / 50 %, grand déplacement, découpage des mois
  mensuel.test.js       Agrégation d'un mois depuis les fiches
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
| `NODE_ENV` | `production` : messages d'erreur non détaillés | — |
| `COOKIE_SECURE` | `true` force le cookie `Secure`, même joint en HTTP | déduit du protocole utilisé |

Mise en production sans abonnement : voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).

## Suite prévue

- Fiches d'exposition journalières : projet distinct, dans un second temps.
