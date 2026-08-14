# Mise en place — ce que fait la direction

Ce document s'adresse au **directeur**, une fois l'application installée sur la
machine. L'installation elle-même — serveur, service Windows ou Docker, HTTPS —
est décrite dans [DEPLOIEMENT.md](DEPLOIEMENT.md) et relève de l'administrateur
technique.

Comptez **une heure**, en une fois de préférence. Tout se fait depuis l'écran
*Paramètres*, sauf la première étape.

> **L'ordre compte.** Les taux horaires se saisissent **avant** la mise en
> service : une fois le coffre créé, chaque saisie de montant redemande la
> phrase. C'est le seul endroit où l'ordre change quelque chose, mais il vous
> ferait perdre une demi-heure.

---

## 1. Première connexion — choisir votre code

L'administrateur vous a remis un identifiant et un code. **Ce code, il le
connaît** : il vient de le poser.

À votre première connexion, l'application ne vous laissera donc rien faire
d'autre que d'en choisir un autre — pas même consulter une fiche. C'est
volontaire : tant que vous ne l'avez pas fait, la personne qui a créé votre
compte peut s'y connecter, et donc atteindre la paie.

Le changement ferme au passage toutes les autres sessions ouvertes, y compris la
sienne.

---

## 2. Vérifier l'effectif — *Paramètres ▸ Personnel et équipes*

L'effectif a normalement été chargé depuis votre tableau d'affectation. Trois
choses à vérifier :

- **Chaque opérateur est rattaché au bon chef d'équipe.** C'est ce rattachement
  qui décide de ce que chaque chef voit : il ne verra que son équipe.
- **Les chefs d'équipe figurent aussi comme salariés.** Ils travaillent sur le
  chantier et doivent apparaître en tête de leur propre fiche.
- **Les noms sont correctement orthographiés.** Ils partiront tels quels au
  cabinet comptable.

---

## 3. Les comptes — *Paramètres ▸ Comptes des chefs*

Un compte par chef d'équipe. Donnez-lui son identifiant et son code, et
**prévenez-le qu'il devra le changer** à sa première connexion : comme le vôtre,
ce code est provisoire tant qu'il ne se l'est pas approprié. L'écran l'y conduit,
mais un chef qui ne s'y attend pas appellera.

Faites de même dans *Conducteurs de travaux* pour ceux qui visent les fiches
avant vous. Un compte marqué **Sans code** existe mais n'ouvre rien.

---

## 4. Les taux horaires — *Paramètres ▸ Personnel et équipes*

La colonne **Taux horaire**, tout à droite. Tant qu'elle est vide pour
quelqu'un, aucun montant n'est calculé pour lui — une case vide vaut mieux qu'un
salaire faux, et le tableau mensuel le signalera plutôt que d'inventer.

C'est l'étape la plus longue. **Faites-la maintenant**, avant l'étape 6.

---

## 5. Les paramètres de paie — *Paramètres ▸ Taux de la paie*

Panier repas, grands déplacements 72 et 80, primes de zone amiante, horaire
mensualisé, majorations des heures supplémentaires. Les valeurs de la convention
sont déjà en place ; corrigez ce qui diffère chez vous.

Chaque taux porte une **date d'effet au mois**. Un taux qui change au 1er janvier
s'applique à toute la paie de janvier, et les mois déjà calculés ne bougent pas —
c'est ce qui permet de rejouer un mois passé avec les taux de l'époque.

---

## 6. Armer les sécurités — *Paramètres ▸ Mise en service*

L'écran liste cinq points, avec leur état **constaté** : le coffre est interrogé
dans la base, le chiffrement du lien vérifié sur la page même. Rien n'y est
déclaré sur parole.

Le bouton **Armer toutes les sécurités** vous demande trois choses, qui ne
peuvent pas être inventées à votre place — les inventer reviendrait à les
connaître :

| Ce qu'on vous demande | À quoi cela sert |
|---|---|
| **La phrase du coffre** (12 caractères minimum) | Elle chiffre les taux horaires, les primes et les paramètres de paie. Sans elle, une copie du fichier de la base ne livre plus aucun montant. |
| **Une question de reprise** et sa réponse | Votre seul moyen de retrouver votre code si vous l'oubliez : personne, pas même l'administrateur, ne peut vous en remettre un. |
| **Votre code actuel** | Pour qu'une session laissée ouverte sur un poste partagé ne suffise pas à faire tout cela à votre place. |

**Choisissez une phrase, pas un mot de passe tordu.** « les fiches de pointage
de 2026 » se retient ; `Xk9!2p` ne se retient pas et ne protège pas mieux. Votre
code à six chiffres ne pourrait pas servir de clé : un million de combinaisons se
testent hors ligne en quelques minutes.

L'écran propose aussi de **faire renouveler le code de tous les autres comptes**.
Dites oui : c'est le moment. Votre propre code n'est pas touché.

---

## 7. La clé de secours — à imprimer immédiatement

Une fois les sécurités armées, l'écran affiche une clé du type
`4ZLU-ZYR4-FJ73-69XU-652C`.

**Elle ne sera plus jamais affichée.** Elle n'est stockée nulle part : seule une
empreinte l'est, et une empreinte ne se relit pas.

Imprimez-la tout de suite et rangez-la **ailleurs que sur le serveur** — un
coffre, un classeur fermé, chez votre expert-comptable.

> Si la phrase **et** ce papier sont perdus, les taux horaires et les primes sont
> définitivement illisibles. Il faudra les ressaisir un par un. Le reste — les
> heures, les fiches, les chantiers — n'est pas touché.

---

## 8. Vérifier

Revenez sur *Mise en service*. Quatre lignes doivent être au vert.

La cinquième, **« Les codes ne circulent pas en clair »**, ne dépend pas de
l'application : elle reste rouge tant que vous ouvrez le site en `http://`. Si
vos chefs saisissent depuis un chantier, c'est à régler avant d'ouvrir le service
— voir [DEPLOIEMENT.md](DEPLOIEMENT.md). Sur le réseau du dépôt uniquement, c'est
un risque que vous pouvez accepter en connaissance de cause.

---

## Ensuite, chaque semaine

Les chefs saisissent leur fiche depuis leur téléphone et la transmettent. Le
conducteur de travaux la vise, s'il y en a un de rattaché. Vous la vérifiez et la
validez depuis le tableau de bord.

Une fiche non validée **ne compte pas** dans le tableau mensuel. C'est juste, et
c'est le piège : le tableau de bord vous dit combien il en manque, nommément.

## Et chaque mois

*Tableau mensuel* → version **Direction — avec les montants** → la phrase du
coffre → **Télécharger**. Le classeur part au cabinet.

La phrase ouvre une séance de quinze minutes : afficher puis télécharger le même
tableau ne la redemande pas.

---

## Ce qui n'est protégé par rien

L'administrateur technique ne peut atteindre aucun montant : ni par les écrans,
ni par le fichier de la base, ni en se donnant votre identité.

**Mais rien n'arrête quelqu'un qui modifierait le programme lui-même sur le
serveur, et attendrait que vous tapiez votre phrase.** Aucun chiffrement ne le
peut : au moment où l'application affiche un montant, elle le détient en clair.

La parade n'est pas informatique. Elle tient à qui a le droit d'installer une
nouvelle version sur la machine. Si ce n'est pas vous, le coffre vous protège de
la copie du fichier, de la sauvegarde égarée et du disque emporté — pas de cette
personne-là.
