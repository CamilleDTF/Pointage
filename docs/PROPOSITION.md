# Proposition — digitalisation des fiches de pointage

## 1. La situation actuelle

Chaque semaine, 8 chefs d'équipe remplissent à la main une fiche de pointage par
chantier (11 lignes de salariés × 7 jours), la photographient et l'envoient au
directeur. Celui-ci vérifie chaque jour de chaque personne, puis ressaisit les
heures dans son tableau Excel pour préparer la paie.

Ce circuit coûte cher sur trois plans :

| Point de friction | Conséquence |
|---|---|
| Ressaisie intégrale par le directeur | ~8 fiches × 11 lignes × 7 jours = jusqu'à 616 cases retapées chaque semaine |
| Photos manuscrites | Chiffres illisibles, allers-retours téléphoniques, corrections tardives |
| Aucun contrôle à la saisie | Les oublis (jour vide, code absence manquant, masque non renseigné) ne se voient qu'à la vérification |
| Fiches éparpillées dans les messageries | Retrouver la fiche d'un salarié sur une semaine passée est long ; en cas de contrôle, la traçabilité est fragile |
| Pas de vue d'ensemble | Impossible de savoir d'un coup d'œil quelles fiches manquent le lundi matin |

## 2. La solution retenue

Une application web dédiée, installée sur le téléphone des chefs d'équipe et
consultée au bureau par le directeur. Elle reprend **exactement** la fiche
papier existante : mêmes rubriques, mêmes 11 lignes, mêmes 7 jours, mêmes codes
absence, mêmes primes (zone, masque VA/AA, déplacements), mêmes signatures.

```
  CHEF D'ÉQUIPE                    DIRECTEUR                     PAIE
  ─────────────                    ─────────                     ────
  Ouvre sa fiche
  de la semaine
  (équipe pré-remplie)
        │
        │ saisit les heures, même sans réseau
        │ fait signer chaque salarié sur l'écran
        ▼
  Contrôles automatiques
  (jours vides, codes,
   masque, plafond 48 h)
        │
        │ « Transmettre »
        ▼
                          ┌──────────────────────┐
                          │ Tableau de bord      │
                          │ 8 chefs, 1 écran     │
                          │ qui a rendu / manque │
                          └──────────┬───────────┘
                                     │ corrige directement dans la grille
                                     │ (aucune ressaisie)
                                     ▼
                              Valide la fiche
                                     │
                                     ▼
                          Export Excel / CSV ──────────────► Tableau interne
                          (récap hebdo + détail            (copier-coller
                           journalier + copies              ou import direct)
                           conformes des fiches)
```

### Ce que ça change concrètement

**Pour le chef d'équipe**
- Sa fiche de la semaine s'ouvre déjà pré-remplie avec les noms de son équipe.
- Les heures se saisissent comme il en a l'habitude : `7h30`, `7:30` ou `7,5`.
- Le total de la semaine se calcule tout seul, ligne par ligne.
- **La saisie fonctionne sans réseau.** Sur chantier, tout est conservé sur le
  téléphone et transmis automatiquement dès le retour de la couverture.
- Chaque salarié signe du doigt sur l'écran ; la signature est archivée.
- Avant de transmettre, l'application liste ce qui manque. Une fiche incomplète
  ne part pas.

**Pour le directeur**
- Un écran par semaine : qui a rendu, qui doit être relancé, combien d'heures au
  total, combien de fiches restent à vérifier.
- Les fiches arrivent dans une **grille directement modifiable** : il corrige une
  case dans le tableau, c'est enregistré. Plus aucune ressaisie.
- Il valide, ou renvoie la fiche au chef avec un motif — le chef la retrouve
  ouverte à la correction, avec le motif affiché en tête.
- Les anomalies détectées sont affichées sous chaque fiche.
- Un bouton « Export Excel » produit le classeur pour son tableau interne.

**Pour l'archivage**
- Chaque fiche est reproduite à l'identique dans un onglet Excel imprimable en A4
  paysage, avec les signatures et les visas, prête à être classée ou présentée.
- Chaque action (création, transmission, correction, validation, renvoi) est
  horodatée et attribuée à son auteur.

### Les contrôles automatiques

Bloquants — la fiche ne peut pas être transmise :
- nom du chantier ou ville manquant ;
- aucun salarié renseigné ;
- un jour du lundi au vendredi sans heures **et** sans code absence ;
- un code absence qui n'existe pas dans la liste de la fiche ;
- des jours en zone déclarés sans type de masque (VA ou AA) ;
- plus de 7 jours en zone sur une semaine.

Signalés, sans bloquer — le directeur tranche :
- heures **et** code absence saisis le même jour ;
- plus de 12 h sur une journée ;
- plus de 48 h sur la semaine (plafond légal) ;
- signature d'un salarié manquante.

## 3. Les formats d'export

Le classeur remis au directeur contient, dans un seul fichier :

1. **« Récap hebdo »** — une ligne par salarié et par semaine : année, semaine,
   dates, matricule, nom, chef d'équipe, chantier, ville, total heures, heures
   route 100 %, heures trajet 50 %, jours en zone, type de masque, nombre de
   déplacements, codes absence, statut. C'est le format le plus proche d'un
   import paie.
2. **« Détail journalier »** — une ligne par salarié et par jour, avec le code
   absence et son libellé. Permet tous les recalculs et tous les contrôles.
3. **Une copie conforme de chaque fiche**, une par onglet, au format de la fiche
   papier actuelle.

Un export **CSV** est également disponible pour les logiciels de paie qui
n'acceptent pas le `.xlsx`.

> **Point restant à caler avec vous.** Je n'ai pas le tableau Excel interne du
> directeur, seulement la fiche de pointage. Les colonnes de l'onglet « Récap
> hebdo » ont donc été construites à partir des rubriques de la fiche. Envoyez-moi
> ce tableau et je cale l'export exactement sur ses colonnes et son ordre, pour
> que le collage soit direct — voire l'import automatique.

## 4. Pourquoi une application dédiée plutôt qu'une solution no-code

J'ai écarté deux alternatives, pour des raisons précises :

| Solution | Pourquoi elle ne convient pas ici |
|---|---|
| **Microsoft Forms / Google Forms** | Un formulaire est linéaire. Ici il faut saisir une grille de 11 personnes × 7 jours, revenir en arrière, corriger. Sur un formulaire, cela représente 77 questions à la suite — inutilisable sur un chantier. Aucun fonctionnement hors réseau, aucune signature. |
| **Power Apps / AppSheet** | Techniquement faisables, mais ils imposent une licence par utilisateur, dépendent de votre tenant, et le mode hors ligne y est limité et fragile. Le coût récurrent dépasse rapidement celui d'un hébergement simple, et vous ne maîtrisez ni le code ni les données. |

L'application dédiée coûte un hébergement (**10 à 20 € par mois** sur un service
type Railway, Render, Scalingo ou un petit VPS OVH), n'impose aucune licence par
utilisateur, fonctionne hors réseau, et les données restent chez vous dans un
fichier que vous pouvez sauvegarder et emporter.

## 5. Mise en service

| Étape | Contenu | Durée |
|---|---|---|
| 1 | Hébergement + nom de domaine + certificat HTTPS | ½ journée |
| 2 | Création des 8 chefs, saisie des salariés et de leur affectation | 1 h |
| 3 | Calage de l'export sur le tableau interne du directeur | ½ journée (dès réception du fichier) |
| 4 | Prise en main : 20 min par chef, sur son propre téléphone | 1 demi-journée |
| 5 | **Double saisie sur 2 semaines** — papier + application en parallèle, pour comparer et rassurer | 2 semaines |
| 6 | Bascule complète | — |

L'étape 5 n'est pas facultative : c'est elle qui permet de vérifier que les
totaux de la paie sont rigoureusement identiques avant d'abandonner le papier.

## 6. Points d'attention

- **Signatures.** Une signature tracée à l'écran vaut ce que valent vos usages
  internes actuels. Si vous voulez une valeur probante renforcée (horodatage
  qualifié, certificat), c'est un module à ajouter — dites-le-moi.
- **Données personnelles.** L'application stocke des noms, des horaires et des
  signatures : c'est un traitement RH à porter au registre RGPD, avec une durée
  de conservation à fixer (5 ans est l'usage pour les éléments de paie).
- **Sauvegardes.** La base est un fichier unique (`data/pointage.db`). Une copie
  quotidienne automatique doit être mise en place dès la mise en production —
  c'est deux lignes de configuration, mais elles sont indispensables.
- **Fiches d'exposition journalières.** La fiche papier précise qu'elles
  accompagnent obligatoirement le pointage. Elles ne sont pas couvertes par cette
  première version. Les numériser au même endroit est l'extension la plus
  évidente, et la plus utile en cas de contrôle.

## 7. Ce qui est livré aujourd'hui

Une application complète et fonctionnelle : saisie mobile hors ligne, signatures,
contrôles automatiques, tableau de bord directeur, grille de correction, circuit
de validation et de renvoi, exports Excel et CSV, réplique conforme de la fiche,
gestion des comptes et des équipes, journal des actions.

Voir le [README](../README.md) pour l'installation et le
[guide de déploiement](DEPLOIEMENT.md) pour la mise en production.
