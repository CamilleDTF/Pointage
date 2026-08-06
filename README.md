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
écrans réels (même HTML, même CSS, même JavaScript), un jeu de données
fictives et un faux serveur en mémoire. Aucune installation, aucun réseau, rien
n'est enregistré — un rechargement remet tout à zéro.

Elle est reconstruite depuis le code de l'application : `scripts/construire-demo.js`
échoue si un motif qu'il adapte a disparu, pour qu'elle ne dérive jamais
silencieusement de l'original.

## Essayer sur son poste, avant tout hébergement

Il suffit d'avoir [Node.js](https://nodejs.org) 22 ou plus. Aucun droit
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
directeur peut réinitialiser n'importe quel code depuis l'écran **Paramètres**.

`npm run seed -- --demo` reste disponible pour peupler une base d'essai avec
8 chefs fictifs, leurs équipes et une fiche d'exemple.

```bash
npm test                   # contrôles métier, semaines ISO, paie, cloisonnement des accès
node scripts/verifier-composants.js   # les composants installés sont-ils à jour ?
```

`verifier-composants.js` compare ce qui est installé à ce que `package.json` demande.
Les lanceurs l'appellent avant de démarrer : ajouter une dépendance ne peut plus
laisser une installation existante s'arrêter sur un module manquant.

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

## Le circuit d'une fiche

```
  chef d'équipe          conducteur de travaux           directeur
  ─────────────          ─────────────────────           ─────────
  remplit et    ──────►  reçoit un courriel     ──────►  vérifie, corrige,
  transmet               vise ou renvoie                 valide
                                │
                                └── renvoyée avec commentaire ──► retour au chef
```

Le conducteur de travaux vise **avant** la direction. Il n'a pas de compte : chaque
transmission lui envoie un courriel qui contient le pointage sous les yeux et deux
boutons — *viser*, ou *renvoyer avec un commentaire*. C'est un choix délibéré : un
compte de plus par conducteur, ce serait un code de plus à distribuer, à retenir et
à réinitialiser, pour deux clics par semaine.

**C'est le chef d'équipe qui désigne le conducteur**, en bas de sa fiche, juste avant
de transmettre. D'une semaine à l'autre le chantier peut relever de quelqu'un d'autre,
et c'est lui qui le sait. Le rattachement défini dans *Paramètres* n'est qu'une
proposition, pré-sélectionnée pour lui. Le choix est obligatoire — dès lors qu'au moins
un conducteur est enregistré : une organisation qui n'en a encore aucun n'est pas
bloquée par une étape qui n'existe pas chez elle.

Ce que le lien autorise est volontairement étroit : **une seule fiche**, **deux
actions**, et seulement **tant qu'elle attend ce visa**. Une fiche modifiée puis
retransmise reçoit un nouveau secret, ce qui condamne aussitôt les liens précédents.

Les liens du courriel **ouvrent une page, ils ne décident de rien**. La décision
passe par un envoi depuis cette page. Sans cette précaution, l'antivirus d'une
messagerie d'entreprise — qui visite les liens des messages pour les analyser —
viserait les fiches à la place du conducteur.

Tant qu'**aucun conducteur n'est enregistré**, les fiches partent directement à la
direction : l'étape est sautée sans blocage. Et le directeur peut toujours **valider sans le
visa** quand le conducteur n'est pas joignable ; le bouton le dit alors explicitement.

### Envoi des courriels

| Variable | Rôle |
|---|---|
| `SMTP_HOTE`, `SMTP_PORT` | Serveur d'envoi (587 par défaut, 465 pour du TLS direct) |
| `SMTP_UTILISATEUR`, `SMTP_MOT_DE_PASSE` | Identifiants, si le serveur en demande |
| `COURRIEL_EXPEDITEUR` | Adresse d'expédition |
| `ADRESSE_PUBLIQUE` | L'adresse à laquelle les conducteurs joignent l'application |

Ces réglages se posent dans `configuration.txt` (voir *Configuration*). Pour
vérifier qu'ils fonctionnent sans faire transmettre une vraie fiche :
**`TESTER-COURRIEL.bat`**, ou `node scripts/tester-courriel.js mon.adresse@exemple.fr`.
Le script nomme les réglages manquants, et recopie le refus du serveur d'envoi en
l'expliquant — un mot de passe d'application exigé par Gmail et Microsoft 365, un
nom de serveur mal orthographié, un port bloqué par le pare-feu.

L'envoi repose sur `nodemailer`, **chargé de façon facultative** : une installation
dont les composants datent d'avant son ajout démarre quand même, et se contente de
déposer les messages sur disque. Une bibliothèque d'envoi absente ne doit pas coûter
l'application entière.

**Sans SMTP configuré, rien ne casse** : le message est écrit dans
`DATA_DIR/courriels/`, et le directeur récupère le lien depuis son tableau de bord
(*Relancer le conducteur*) pour le transmettre lui-même. Ce n'est pas une
dégradation silencieuse — c'est ce qui permet de faire tourner toute la chaîne
avant que le service informatique ait fourni un compte d'envoi.

## Les écrans

### Chef d'équipe — `/chef.html`

- La fiche de la semaine courante s'ouvre pré-remplie avec l'équipe, **le chef
  d'équipe en première ligne** : il travaille sur le chantier comme ses
  opérateurs, ses heures doivent partir en paie comme les leurs. Son compte de
  connexion vit dans `utilisateurs`, sa fiche de paie dans `salaries` ; les deux
  sont rapprochés par le nom, et la fiche salarié est créée si elle manque
  (`salarieDuChef`, idempotent — jamais de doublon).
- **Tout l'effectif est proposé à la saisie**, pas seulement l'équipe rattachée :
  un chantier réunit souvent des renforts venus d'autres équipes, et le chef doit
  pouvoir les pointer sans attendre une réaffectation. L'autocomplétion place son
  équipe en tête et étiquette chaque proposition (*mon équipe* / *autre équipe*).
  Contrepartie assumée : un chef d'équipe voit désormais les noms de tout
  l'effectif. Il ne voit toujours ni les fiches, ni les heures, ni les comptes
  des autres chefs.
- **La zone du chantier se coche** — Paris, Nice, ou Autre avec la ville à préciser.
  C'est ce choix, et non l'orthographe du nom de ville, qui décide du taux de grand
  déplacement (80 pour Paris et Nice, 72 ailleurs). Paris et Nice remplissent la ville
  d'eux-mêmes. Les fiches saisies avant cette zone restent lues à l'ancienne, par
  lecture du nom de ville.
- **L'immatriculation se choisit dans le parc**, et le type de véhicule se remplit
  tout seul. Le parc se gère depuis l'écran Paramètres.
- **Une aide dépliante rappelle les codes d'absence** et leur signification, reprise
  du bas de la fiche papier.
- Heures acceptées en `7h30`, `7:30`, `7,5` ou `7.5` ; le total se recalcule à la volée.
- Un code absence par jour, repris de la fiche papier (`ACH`, `F`, `NJ`, `VM`,
  `AT`, `EV`, `FOR`, `CSS`, `AA`).
- **Un jour non travaillé se déclare en saisissant `0`.** La case affiche alors
  `0h00`, ce qui la distingue d'une case que personne n'a remplie : une fiche
  d'un seul opérateur avec un seul jour travaillé est complète dès lors que les
  autres jours portent un `0` ou un code absence. C'est la colonne `saisi` de
  `fiche_jours` qui porte cette distinction.
- Le bouton **Mettre à 0 les jours non travaillés** fait le geste d'un coup sur
  toute la fiche : il remplit d'un `0h00` chaque jour ouvré resté vide des lignes
  nommées, sans jamais toucher à ce qui est déjà renseigné.
- Le bandeau affiche la **version** exécutée (`version` de `package.json`), à
  côté du nom de l'utilisateur : quand un comportement surprend, elle répond sans
  détour à la question « quel code tourne réellement ? ».
- Signature tactile par salarié, plus celle du responsable de chantier.
- **Deux présentations de la même fiche**, choisies automatiquement selon la
  taille de l'écran et permutables d'un bouton :
  - *cartes* — une carte dépliante par salarié, pour le pouce sur un téléphone ;
  - *tableau* — la grille complète de la fiche papier, 11 lignes × 7 jours
    visibles d'un coup, saisie au clavier en tabulant. C'est la vue par défaut
    dès 1024 px de large.
- Filet de sécurité réseau : si la connexion tombe en pleine saisie, le travail est
  conservé sur l'appareil et transmis dès son rétablissement.
- Le bouton *Contrôler et transmettre* refuse une fiche incomplète et **encadre
  en rouge les cases à compléter**, dans la grille comme dans les cartes : le
  message dit quoi corriger, la bordure dit où. Chaque anomalie porte la
  référence du champ qu'elle vise (`cible` dans `controlerFiche`), et l'envoi
  refusé amène directement à la première case fautive. En vue cartes, une carte
  repliée qui contient une case à compléter se signale d'un liseré rouge et de
  la mention *à compléter*.
- **Calendrier de l'année** — toutes les semaines avec l'état de leur fiche, en
  un écran : *à faire*, *à compléter*, *en attente de validation*, *à corriger*,
  *validé*. Les semaines non encore arrivées sont marquées *à venir* plutôt
  qu'en retard. Un clic sur une semaine ouvre sa fiche. Déplié sur grand écran,
  replié sur téléphone — le résumé chiffré reste visible dans les deux cas.
- **Mise en service au 1er septembre 2026** — avant cette date le pointage se
  faisait sur papier. Ces semaines-là apparaissent en gris et ne sont jamais
  comptées comme des fiches en retard. La date se règle par la variable
  d'environnement `DEBUT_SERVICE` (`AAAA-MM-JJ`) si le déploiement glisse ; une
  semaine à cheval appartient à l'application dès lors que son dimanche tombe
  après la bascule.

Un même statut ne se dit pas pareil selon qui le lit : une fiche transmise est
« en attente de validation » pour le chef qui l'a envoyée, et « à vérifier » pour
le directeur qui doit s'en occuper. Les libellés suivent le rôle
(`ETIQUETTES_STATUT` dans `public/js/regles.js`).

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
- Bouton **Tableau mensuel** vers la page dédiée (voir ci-dessous).
- Statut particulier **Attente visa conducteur** tant que le conducteur n'a pas
  répondu, et **Visée — à vérifier** une fois qu'il l'a fait, avec son commentaire.
  Boutons *Relancer le conducteur* et *Valider sans le visa*.

### Paramètres — `/parametres.html`

Une page à part entière, atteinte par le bouton **Paramètres** du tableau de bord :
on ne règle pas des taux horaires en faisant défiler les fiches de la semaine, et
une adresse propre se met en favori. Quatre volets :
  - *Personnel et équipes* — affectations et **taux horaire** de chacun ;
  - *Comptes des chefs* — création, codes, désactivation ;
  - *Véhicules* — le parc proposé aux chefs à la saisie ;
  - *Indicateurs de suivi* — voir plus bas.

Comme les deux autres écrans, elle est fermée aux chefs d'équipe côté serveur : un
chef qui ouvrirait l'adresse directement est renvoyé vers sa fiche, et les routes
`/api/admin/*` lui répondent un refus.

## Le tableau mensuel pour la paie — `/mensuel.html`

Une page à part, atteinte depuis le tableau de bord. Il se consulte à l'écran et se
télécharge, dans **deux versions** :

| Version | Contenu | Accès |
|---|---|---|
| **Publique** | Heures, majorations 25/50 %, route, trajet, jours d'amiante, paniers, GD 72 / GD 80, fériés | Le directeur connecté |
| **Direction** | La même chose **plus** le taux horaire, le salaire brut et net, les primes en euros et la masse salariale | Le directeur, **après avoir ressaisi son code** |

Le code est redemandé **à chaque ouverture et à chaque téléchargement** de la
version direction, même quand la session est déjà ouverte. Il ne s'échange pas
contre un droit qui dure, mais contre un **billet à usage unique**, valable deux
minutes, que le serveur consomme dès la première requête : un écran laissé ouvert,
une session oubliée, un navigateur partagé ne redonnent jamais accès aux salaires.
Le refus est appliqué côté serveur — `test/cloisonnement.test.js` vérifie qu'un
même billet ne sert pas deux fois.

**Le taux horaire** se renseigne dans *Paramètres → Personnel et équipes*. Tant
qu'il ne l'est pas, aucun montant n'est calculé pour la personne concernée et la
ligne l'indique : une case vide vaut mieux qu'un salaire faux.

Le bouton **Télécharger** produit le classeur au format du tableau interne : une feuille `Total` et une feuille par
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
| `Mois` | Horaire de référence du mois : **jours ouvrés × 7 h** |

Restent à la main du directeur : `NUIT`, `DIMANCHE`, la colonne `1` (100 %),
`PERFO`, `EDEN RED`, `GD AUTRES`, les heures d'absence et le taux horaire.

La case `Mois`, elle, n'est plus saisie : elle vaut le nombre de jours ouvrés du
mois (les lundis au vendredis, jours fériés non déduits) multiplié par 7 h — 21
jours ouvrés en août 2026 donnent 147 h. C'est un fait de calendrier, et elle sert
de dénominateur à la retenue pour absence : une saisie approximative faussait
toutes les paies du mois. Elle apparaît en vert pâle dans le classeur, et au-dessus
du tableau mensuel à l'écran. Le calcul est dans `public/js/regles.js`
(`joursOuvresDuMois`, `heuresReferenceMois`).

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
  mensuel.js    Agrégation d'un mois et valorisation de la paie
  export-mensuel.js  Le classeur mensuel, versions publique et direction
  indicateurs.js Suivi des chefs : assiduité, retards, fiches renvoyées
  visa.js       Liens signés du conducteur de travaux, visa et renvoi
  courriel.js   Envoi SMTP, et dépôt sur disque à défaut de serveur d'envoi
  index.js      API HTTP et service des fichiers statiques
  seed.js       Jeu de données initial
public/
  index.html      Connexion
  chef.html       Saisie mobile        + js/chef.js
  directeur.html  Tableau de bord      + js/directeur.js
  parametres.html Paramètres direction + js/parametres.js
  mensuel.html    Tableau mensuel      + js/mensuel.js
  visa.html       Visa du conducteur   + js/visa.js  (sans compte, par lien signé)
  js/regles.js  Règles métier partagées avec le serveur (heures, semaines, contrôles)
  js/commun.js  API, signature tactile, file d'attente en cas de coupure réseau
test/
  domaine.test.js       Conversion des heures, semaines ISO, contrôles de cohérence
  paie.test.js          Majorations 25 / 50 %, grand déplacement, découpage des mois
  mensuel.test.js       Agrégation d'un mois depuis les fiches
  cloisonnement.test.js Cloisonnement des accès par code, bout en bout sur l'API
  indicateurs.test.js   Délai attendu, calcul des retards et des semaines dues
  composants.test.js    Les lanceurs vérifient bien toutes les dépendances
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

## Indicateurs de suivi

*Paramètres → Indicateurs de suivi* répond à trois questions : qui rend ses fiches,
qui les rend à temps, qui les rend justes.

| Indicateur | Ce qu'il mesure |
|---|---|
| Assiduité | Part des semaines attendues effectivement transmises |
| Transmises / Manquantes | Le décompte brut, depuis la mise en service |
| Retard moyen et maximum | Jours écoulés entre le dimanche de la semaine et l'envoi |
| Hors délai | Fiches transmises **après le lundi** qui suit, avec la part rendue à l'heure |
| Renvoyées | Fiches que le directeur a dû retourner pour correction |

**L'échéance est le lundi** qui suit la semaine pointée : une fiche transmise le lundi
est à l'heure, à partir du mardi elle est hors délai. Le seuil se règle par
`DELAI_TRANSMISSION_JOURS` si la consigne change.

Le retard se compte en jours calendaires, sans tenir compte des week-ends ni des jours
fériés, et la date retenue est celle de la **première demande de validation** : un chef
qui envoie le lundi est à l'heure, même si sa fiche lui revient ensuite pour correction.
Les allers-retours se comptent dans la colonne *Renvoyées*, pour qu'un même incident ne
soit pas facturé deux fois. Cette date est figée au premier envoi dans
`fiches.premiere_soumission_le` ; `soumise_le`, lui, suit les retransmissions.

Rien n'est compté avant la date de mise en service, ni sur la semaine en cours :
une semaine pointée sur papier n'est pas un oubli, une semaine en cours n'est pas
un retard. Ces chiffres décrivent un circuit administratif, pas des personnes — un
chantier isolé rend naturellement plus tard qu'un autre. Ils servent à savoir qui
relancer.

## Configuration

Tout se règle par variables d'environnement — commode sur un serveur Linux, où
elles se posent dans un fichier de service. Sur le poste de la direction, elles se
perdraient à la première fenêtre fermée : l'application lit donc aussi un fichier
**`configuration.txt`**, à côté de `DEMARRER.bat`, une ligne par réglage.

```
SMTP_HOTE=smtp.office365.com
SMTP_UTILISATEUR=pointage@mon-entreprise.fr
SMTP_MOT_DE_PASSE=xxxxxxxxxxxxxxxx
COURRIEL_EXPEDITEUR=pointage@mon-entreprise.fr
ADRESSE_PUBLIQUE=https://pointage.mon-entreprise.fr
```

`configuration-exemple.txt` sert de modèle commenté : le copier sous le nom
`configuration.txt` et remplir les lignes utiles. Une variable déjà définie dans
l'environnement l'emporte toujours sur le fichier, et une ligne laissée vide ne
définit rien. Le fichier contient un mot de passe de messagerie : il n'est pas
suivi par git.

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port d'écoute | `3000` |
| `DATA_DIR` | Dossier de la base et de la clé de session | `./data` |
| `SESSION_SECRET` | Clé de signature des sessions | générée dans `DATA_DIR/session.key` |
| `NODE_ENV` | `production` : messages d'erreur non détaillés | — |
| `COOKIE_SECURE` | `true` force le cookie `Secure`, même joint en HTTP | déduit du protocole utilisé |
| `DEBUT_SERVICE` | Première semaine attendue dans l'application (`AAAA-MM-JJ`) | `2026-09-01` |
| `DELAI_TRANSMISSION_JOURS` | Délai attendu, en jours après le dimanche (1 = le lundi) | `1` |
| `ADRESSE_PUBLIQUE` | Adresse publique, pour les liens envoyés aux conducteurs | `http://localhost:PORT` |
| `SMTP_HOTE`, `SMTP_PORT` | Serveur d'envoi des courriels | — (messages déposés sur disque) |
| `SMTP_UTILISATEUR`, `SMTP_MOT_DE_PASSE` | Identifiants du serveur d'envoi | — |
| `COURRIEL_EXPEDITEUR` | Adresse d'expédition | — |

### Mise à jour des fichiers de l'interface

Les pages, feuilles de style et scripts sont servis en `Cache-Control: no-cache` :
le navigateur les garde, mais revalide à chaque fois et se contente d'un `304`
tant que rien n'a changé. C'est délibéré. Avec une durée de vie ferme, une page
pouvait rester en cache pendant qu'un script était rechargé — la page de la
veille appelait alors le code du jour, et l'écran restait vide. Sur une poignée
de postes en réseau local, la revalidation ne coûte rien.

Pour la même raison, l'application n'installe plus de *service worker* : le mode
hors ligne n'est pas nécessaire (les chefs sont connectés en permanence) et il
pouvait servir une page et son script de deux générations différentes. Celui
déjà posé sur un appareil se désinstalle tout seul au premier chargement.

Si un écran se comporte malgré tout comme s'il datait, il l'annonce lui-même et
demande un `Ctrl+Maj+R`. La version exécutée est affichée dans le bandeau, à côté
du nom de l'utilisateur.

Mise en production sans abonnement : voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).

## Suite prévue

- Fiches d'exposition journalières : projet distinct, dans un second temps.
