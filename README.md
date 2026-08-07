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

Une fiche transmise se reprend d'un clic tant qu'elle n'est pas validée ; le directeur
peut la corriger, la valider, ou la renvoyer au chef avec un motif.

## Deux chantiers dans la même semaine

Un chef d'équipe peut en tenir deux à la fois. Il ouvre alors **une fiche par
chantier** — comme sur le papier, où c'était déjà une feuille par chantier — avec le
bouton *Autre chantier cette semaine*. Le nom du chantier est demandé dès l'ouverture :
c'est lui qui distingue les deux fiches, jusque dans la contrainte d'unicité de la base.

La seconde fiche s'ouvre **vide**, sans l'équipe pré-remplie. C'est voulu : on ne
l'ouvre que parce qu'une *partie* du monde est ailleurs, et y reporter tout l'effectif
vaudrait une anomalie par personne et par jour pour des gens qui n'ont jamais mis les
pieds sur ce chantier.

### Les contrôles comptent la semaine, pas la feuille

Un même opérateur peut travailler sur les deux chantiers. Les contrôles reçoivent donc
**ce qui est déjà pointé ailleurs dans la semaine** (`optionsControle`, `server/fiches.js`),
et non plus la seule fiche ouverte. Sans cela :

| | Ce qui se passait | Ce qui se passe |
|---|---|---|
| **Plafond de 48 h** | 30 h ici, 25 h là-bas : deux fiches conformes | 55 h signalées, en nommant l'autre chantier |
| **Grand déplacement** | 5 jours déclarés de chaque côté = 10 jours dans une semaine de 5 | Bloqué, avec le détail du cumul |
| **Journée non renseignée** | Les jours passés sur l'autre chantier réclamaient un 0 | Silence : la journée est pointée ailleurs |

Le grand déplacement est le plus important des trois, et le moins visible. Le panier
repas vaut *jours travaillés − jours de GD*, avec un plancher à zéro : des GD comptés
deux fois ne produisent donc pas un montant absurde qu'on remarquerait — ils font
**disparaître les paniers en silence**. D'où un blocage, et non une simple alerte.

Le contexte de la semaine part avec la fiche vers le navigateur : le chef travaille sur
chantier, souvent sans réseau, et ses contrôles doivent être exactement ceux du serveur.
Le plafond de 48 h se compte sur **toutes** les fiches de la semaine, y compris celles
d'un autre chef — c'est la semaine d'un homme, pas celle d'une équipe — mais seuls les
chantiers du chef lui-même sont nommés dans les messages.

## Le circuit d'une fiche

```
  chef d'équipe          conducteur de travaux           directeur
  ─────────────          ─────────────────────           ─────────
  remplit et    ──────►  ouvre sa page          ──────►  vérifie, corrige,
  transmet               « Fiches à viser »               valide
       │                 vise ou renvoie
       │                        │
       └── le prévient ─────────┘
    (SMS, WhatsApp, courriel)   └── renvoyée avec commentaire ──► retour au chef
```

Le conducteur de travaux vise **avant** la direction. Il a désormais un **compte**,
avec son identifiant et son code, dans le même registre que les chefs d'équipe et la
direction — une personne y vit à un seul endroit, et s'y désactive une seule fois.

> **Son espace est en cours d'ouverture.** Les comptes existent et se gèrent depuis
> *Paramètres*, mais aucune route ne leur est encore ouverte : un conducteur connecté
> n'obtient rien de plus qu'un visiteur, et arrive sur un écran qui le lui dit. En
> attendant, il vise par son **lien personnel**, qu'il garde en favori.

**C'est le chef d'équipe qui désigne le conducteur**, en bas de sa fiche, juste avant
de transmettre. D'une semaine à l'autre le chantier peut relever de quelqu'un d'autre,
et c'est lui qui le sait. Le rattachement défini dans *Paramètres* n'est qu'une
proposition, pré-sélectionnée pour lui. Le choix est obligatoire — dès lors qu'au moins
un conducteur est enregistré : une organisation qui n'en a encore aucun n'est pas
bloquée par une étape qui n'existe pas chez elle.

Quand l'envoi de courriels est configuré, chaque transmission lui adresse en plus un
message qui porte un lien direct vers la fiche. Ce que ce lien-là autorise est
volontairement étroit : **une seule fiche**, **deux actions**, et seulement **tant
qu'elle attend ce visa**. Une fiche modifiée puis retransmise reçoit un nouveau secret,
ce qui condamne aussitôt les liens précédents.

Les liens du courriel **ouvrent une page, ils ne décident de rien**. La décision
passe par un envoi depuis cette page. Sans cette précaution, l'antivirus d'une
messagerie d'entreprise — qui visite les liens des messages pour les analyser —
viserait les fiches à la place du conducteur.

Tant qu'**aucun conducteur n'est enregistré**, les fiches partent directement à la
direction : l'étape est sautée sans blocage. Et le directeur peut toujours **valider sans le
visa** quand le conducteur n'est pas joignable ; le bouton le dit alors explicitement.

### Prévenir le conducteur sans courriel

Le lien personnel règle l'**accès** du conducteur ; il ne le **prévient** de rien. Il
faut encore qu'il pense à ouvrir sa page. C'était le rôle du courriel — et c'est
justement lui qui manque quand le port 25 est fermé ou que l'envoi n'est pas encore
autorisé sur le locataire.

Alors le chef d'équipe le prévient lui-même. Sitôt la fiche transmise, une fenêtre lui
propose un message tout prêt et de quoi l'envoyer d'un appui, **depuis l'appareil qu'il
a en main**. Renseignez le téléphone du conducteur dans *Paramètres ▸ Conducteurs de
travaux* et les boutons apparaissent ; sans numéro, le texte reste copiable.

| Sur téléphone | Sur PC |
| --- | --- |
| **SMS**, **WhatsApp**, **Courriel**, *Copier* | **Courriel**, **WhatsApp**, *Copier* |

Le SMS disparaît sur PC, et ce n'est pas un oubli : `sms:` n'y aboutit qu'avec un
téléphone Android apparié, et un bouton qui ne fait rien est pire que pas de bouton —
on croit avoir prévenu. C'est alors **Courriel** qui prend le relais : il ouvre la
messagerie de celui qui est devant l'écran, message déjà écrit. Là non plus, pas de
contradiction avec ce qui précède : ce qui est bloqué, c'est l'envoi *automatique par
le serveur* ; la messagerie du chef, elle, fonctionne — c'est celle dont il se sert
toute la journée. Le classement est fait par `blocAlerte` (`public/js/commun.js`) sur
`(pointer: coarse)`, et *Copier le message* est là partout.

```
Bonjour Paul,

BENALI Karim a transmis un pointage qui attend votre visa.
Semaine 32 (du 03/08 au 09/08)
Chantier : Lycée Jean Moulin — Toulouse
4 salarié(s), 116h15

Ouvrez votre page « Fiches à viser » (celle que la direction vous a transmise,
à garder en favori).
```

**Ce message ne contient aucun lien**, et c'est tout l'édifice qui repose là-dessus.
Un chef d'équipe qui transporterait le lien personnel du conducteur pourrait viser ses
propres fiches, et le contrôle ne serait plus qu'une formalité. Le message dit ce qu'il
faut savoir — qui, quelle semaine, quel chantier, combien d'heures — et rien de plus ;
le conducteur ouvre sa page depuis ses favoris. `test/alerte.test.js` vérifie qu'aucune
adresse web ni aucun secret n'y figure, et `test/cloisonnement.test.js` qu'un chef ne
reçoit jamais de lien de visa dans ses réponses.

### Envoi des courriels

| Variable | Rôle |
|---|---|
| `SMTP_HOTE`, `SMTP_PORT` | Serveur d'envoi (587 par défaut, 465 pour du TLS direct) |
| `SMTP_UTILISATEUR`, `SMTP_MOT_DE_PASSE` | Identifiants — **facultatifs**, voir *Envoyer sans compte* |
| `COURRIEL_EXPEDITEUR` | Adresse d'expédition |
| `ADRESSE_PUBLIQUE` | L'adresse à laquelle les conducteurs joignent l'application |

Ces réglages se posent dans `configuration.txt` (voir *Configuration*). Pour
vérifier qu'ils fonctionnent sans faire transmettre une vraie fiche :
**`TESTER-COURRIEL.bat`**, ou `node scripts/tester-courriel.js mon.adresse@exemple.fr`.

Le script fait trois choses. Il nomme les réglages manquants. Il **devine le
serveur d'envoi** à partir du domaine de l'adresse : les enregistrements MX
désignent l'hébergeur de la messagerie, et l'hébergeur détermine le SMTP — ce qui
évite d'attendre le service informatique pour un renseignement de trente secondes
(`server/fournisseurs-courriel.js`, complété par Microsoft 365, OVHcloud, IONOS,
Gandi, Infomaniak, Orange Pro, Google Workspace, Zoho). Un domaine servi par une
machine interne à l'entreprise est annoncé comme tel, avec le nom du MX en piste,
plutôt que rattaché à un hébergeur au hasard. Enfin il recopie le refus du serveur
en l'expliquant.

Deux causes de refus reviennent sans cesse sur une messagerie professionnelle :
Microsoft 365 et Google Workspace **n'acceptent pas le mot de passe du compte** —
il faut un mot de passe d'application, et parfois que l'organisation autorise
d'abord l'authentification SMTP sur la boîte ; et beaucoup de serveurs
**n'autorisent à envoyer que depuis l'adresse du compte connecté**, ce qui impose
la même valeur dans `SMTP_UTILISATEUR` et `COURRIEL_EXPEDITEUR`.

`TESTER-COURRIEL.bat` propose enfin de **préparer `configuration.txt`** avec les
réglages trouvés, plutôt que de laisser recopier six lignes à la main. Il n'écrase
jamais un fichier existant : celui-ci peut contenir un mot de passe et des réglages
qui ne le regardent pas.

### Envoyer sans compte ni mot de passe

`SMTP_UTILISATEUR` et `SMTP_MOT_DE_PASSE` sont **facultatifs**. Sans eux, aucune
commande d'authentification n'est envoyée — ce qui correspond à deux situations
courantes : un relais interne à l'entreprise, et l'envoi direct de Microsoft 365
vers ses propres boîtes.

Ce second cas mérite d'être connu, parce qu'il correspond exactement à l'usage
ici : les conducteurs de travaux ont des adresses de la maison. Microsoft accepte
un message adressé à l'une de ses boîtes sur le serveur d'entrée du domaine
(`<domaine>.mail.protection.outlook.com`, port 25), sans compte. **Aucun mot de
passe n'est alors posé sur le poste, donc aucun n'est à protéger**, et rien n'est
à demander à l'administrateur du locataire. En échange, aucun message ne peut
partir vers une adresse extérieure, et le pare-feu doit laisser sortir le port 25
— souvent bloqué.

### Quand l'essai échoue

`TESTER-COURRIEL.bat` enregistre tout dans **`essai-courriel.txt`**, à côté de
`DEMARRER.bat`, et ouvre ce fichier en cas d'échec. Une fenêtre de console qui se
ferme emportait sinon la seule explication du problème.

Le fichier donne quatre choses que le message résumé ne donne pas : le **code de
refus** du serveur (550, 535, …), sa **réponse complète**, **la commande SMTP** à
laquelle il a répondu — c'est elle qui situe l'échec : `AUTH` pour un problème de
compte, `RCPT TO` pour un destinataire refusé, rien du tout pour un port bloqué —
et le **dialogue complet** avec le serveur, ligne à ligne.

Ce dialogue ne contient jamais le mot de passe : `nodemailer` le remplace par une
marque dans la ligne d'authentification, qui est encodée mais pas chiffrée.
`test/courriel.test.js` le vérifie, en clair et en base64 — c'est un fichier fait
pour être envoyé à qui dépanne, et une mise à jour de la bibliothèque ne doit pas
y glisser un mot de passe à notre insu.

### Un envoi ne fait jamais attendre le chef d'équipe

`soumettre` attend l'envoi avant de répondre. Les délais de `nodemailer`
s'appliquent **par adresse IP essayée**, et un nom de serveur en désigne souvent
quatre : un port bloqué faisait tourner la roue une minute ou deux après un appui
sur *transmettre*, pour finir sur un échec. `server/courriel.js` pose donc un
plafond ferme de **20 secondes sur l'opération entière** (`SMTP_DELAI_MS`), au
terme desquelles le message part sur le disque et le chef reçoit sa réponse. Sa
fiche, elle, est enregistrée depuis le début : l'envoi n'a jamais conditionné la
transmission.

L'envoi repose sur `nodemailer`, **chargé de façon facultative** : une installation
dont les composants datent d'avant son ajout démarre quand même, et se contente de
déposer les messages sur disque. Une bibliothèque d'envoi absente ne doit pas coûter
l'application entière.

**Sans SMTP configuré, rien ne casse** : le message est écrit dans
`DATA_DIR/courriels/`, le conducteur passe par son lien personnel, et le chef le
prévient par SMS ou WhatsApp (voir *Prévenir le conducteur sans courriel*). Ce n'est
pas une dégradation silencieuse — c'est ce qui permet de faire tourner toute la chaîne
sans jamais attendre que le service informatique fournisse un compte d'envoi.

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
- Boutons **Calendrier du mois**, **Tableau mensuel** et **Paramètres** vers les
  trois pages dédiées.
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

## Le calendrier du mois — `/calendrier.html`

Une ligne par personne — opérateurs **et** chefs d'équipe, puisqu'un chef travaille
lui aussi sur le chantier — et une colonne par jour du mois.

Le tableau de bord répond à « qui doit rendre sa fiche cette semaine ». Il ne répond
pas à « pourquoi Untel n'apparaît nulle part depuis quinze jours », qui est pourtant
la question coûteuse : c'est celle qui déclenche les appels téléphoniques. Chaque case
dit donc ce qui s'est passé ce jour-là, **ou pourquoi il ne s'est rien passé**.

| Couleur | Ce qu'elle dit |
|---|---|
| Vert, avec les heures | Journée pointée |
| Orange, avec le code | Absence justifiée sur la fiche (`AT`, `F`, `CP`…) |
| Bleu | Congé enregistré dans le registre |
| Blanc, en semaine | **Aucun pointage, aucune justification** — c'est ce qu'il faut aller chercher |
| Gris | Week-end, ou semaine antérieure à la mise en service |

L'ordre de lecture va du constaté au supposé : des heures pointées un samedi restent
des heures pointées, et une journée travaillée avant la mise en service reste
travaillée. Une convention de calendrier n'efface jamais un fait saisi par un chef.

### Le registre des congés

Les codes d'absence de la fiche expliquent un jour sans heures, mais ils supposent
qu'une fiche existe. **Une semaine entière de congés ne produit aucune ligne** : le
salarié apparaissait simplement absent, comme un oubli. Le registre — `CP`, `RTT`,
arrêt maladie, formation, congé sans solde — répond à la question sans qu'on ait à la
poser. Il n'entre dans **aucun calcul de paie** : il ne sert qu'à expliquer les trous.
Les bornes sont incluses : un congé du 3 au 7 couvre les cinq jours.

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
| `PANIER` | Jours travaillés **moins** les jours de grand déplacement |
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

- **Panier repas** *(validé)* — **12,20 € par jour**, et rien à saisir : ni le montant,
  qui ne change pas, ni le nombre de jours, qui se compte depuis le pointage. Tout jour
  travaillé y donne droit **sauf** s'il est couvert par un grand déplacement, dont
  l'indemnité comprend déjà le repas. Le montant est dans `public/js/regles.js`
  (`MONTANT_PANIER_REPAS`), la règle dans `joursPanierRepas`.
- **Grand déplacement** *(validé)* — le chef d'équipe compte lui-même, ligne par
  ligne, les **jours passés sous chacun des deux taux** (colonnes `GD 72` et
  `GD 80`). Le taux se déduisait auparavant de la ville du chantier : c'était faux
  dans les deux sens, puisqu'un même chantier peut relever des deux selon les jours,
  et que la ville ne dit pas où le salarié a dormi. Les fiches antérieures à ces deux
  colonnes gardent leur répartition calculée depuis la ville — sans quoi un mois déjà
  pointé changerait de montant après coup. Sur une **semaine à cheval sur deux mois**,
  ces jours suivent le prorata des jours pointés, comme les paniers : 2 jours de GD 72
  sur une semaine dont 4 jours sur 5 tombent en septembre donnent 1,5 jour à septembre.
  L'application ne peut pas savoir lesquels des deux jours c'étaient ; le prorata est la
  seule réponse qui ne favorise arbitrairement aucun des deux mois.
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
  configuration.js  Lecture de configuration.txt, avant tout le reste
  db.js         Schéma SQLite et journal des actions
  auth.js       Sessions signées, codes PIN, limitation des tentatives, fermeture par rôle
  fiches.js     Cycle de vie d'une fiche : création, saisie, transmission, validation
  export.js     Génération des classeurs Excel et du CSV
  mensuel.js    Agrégation d'un mois et valorisation de la paie
  export-mensuel.js  Le classeur mensuel, versions publique et direction
  indicateurs.js Suivi des chefs : assiduité, retards, fiches renvoyées
  calendrier.js Vue mensuelle par personne, et registre des congés
  visa.js       Liens signés du conducteur de travaux, visa et renvoi
  alerte.js     Message prévenant le conducteur (SMS, WhatsApp, courriel) — sans aucun lien
  courriel.js   Envoi SMTP, et dépôt sur disque à défaut de serveur d'envoi
  fournisseurs-courriel.js  Réglages SMTP devinés depuis les MX du domaine
  index.js      API HTTP et service des fichiers statiques
  seed.js       Jeu de données initial
public/
  index.html      Connexion
  chef.html       Saisie mobile        + js/chef.js
  directeur.html  Tableau de bord      + js/directeur.js
  parametres.html Paramètres direction + js/parametres.js
  mensuel.html    Tableau mensuel      + js/mensuel.js
  calendrier.html Calendrier du mois   + js/calendrier.js
  visa.html       Visa du conducteur   + js/visa.js  (sans compte, par lien signé)
  js/regles.js  Règles métier partagées avec le serveur (heures, semaines, contrôles)
  js/commun.js  API, signature tactile, file d'attente réseau, boutons d'alerte selon l'appareil
test/
  domaine.test.js       Conversion des heures, semaines ISO, contrôles de cohérence
  paie.test.js          Majorations 25 / 50 %, grand déplacement, découpage des mois
  mensuel.test.js       Agrégation d'un mois depuis les fiches
  cloisonnement.test.js Cloisonnement des accès par code, bout en bout sur l'API
  indicateurs.test.js   Délai attendu, calcul des retards et des semaines dues
  composants.test.js    Les lanceurs vérifient bien toutes les dépendances
  configuration.test.js Lecture de configuration.txt, priorité de l'environnement
  fournisseurs.test.js  Reconnaissance de l'hébergeur d'une adresse professionnelle
  courriel.test.js      Un serveur muet ne bloque pas la transmission d'une fiche
  alerte.test.js        Le message envoyé par le chef ne porte ni lien ni secret
  migration-conducteurs.test.js  Les conducteurs deviennent des comptes sans perdre une fiche
  semaine-partagee.test.js  Un operateur sur deux chantiers : plafonds et primes de la semaine
scripts/
  tester-courriel.js    Essai d'envoi, et diagnostic des réglages SMTP
  importer-effectif.js  Chargement de l'effectif depuis le tableau d'affectation
  verifier-composants.js  Les dépendances installées correspondent-elles ?
  construire-demo.js    Fabrication de la page de démonstration autonome
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

Un chef ne modifie que ses propres fiches. Une fiche transmise se **reprend d'un
clic** tant qu'elle n'est pas validée : il ne faut plus attendre une réouverture de
la direction pour une virgule. La reprise **annule le visa en cours** — un conducteur
qui a visé une version ne doit pas se retrouver signataire d'une autre — et le secret
de la fiche tombe avec lui, ce qui condamne les liens déjà envoyés. Une fois validée,
la fiche est partie en paie : la rouvrir redevient une décision de la direction.

Le directeur peut corriger n'importe quelle fiche à tout moment ; chaque correction
est tracée dans le journal.

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
| `SMTP_UTILISATEUR`, `SMTP_MOT_DE_PASSE` | Identifiants du serveur d'envoi (facultatifs) | — |
| `SMTP_DELAI_MS` | Plafond de temps sur un envoi, en millisecondes | `20000` |
| `SMTP_TRACE` | `1` : recopie le dialogue avec le serveur d'envoi | — |
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
