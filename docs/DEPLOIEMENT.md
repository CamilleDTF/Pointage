# Mise en service — sans abonnement

L'application n'a besoin d'aucun service payant. Elle tient dans un processus
Node.js et un fichier SQLite : tout ce qu'il lui faut, c'est une machine allumée
et un moyen d'y accéder depuis les chantiers.

**Coût de la solution retenue : 0 €**, sans carte bancaire, sans nom de domaine,
sans abonnement.

| Option | Coût | Ce qu'il vous faut | Pour qui |
|---|---|---|---|
| **A. Oracle Cloud Always Free + Tailscale** ← retenue | **0 €** (carte demandée à l'inscription, jamais débitée) | Un compte Oracle Cloud, créé par vous | Votre cas : aucune machine à administrer chez vous |
| B. Un NAS ou un PC de l'entreprise | 0 € | Un accès administrateur à la machine | Si vous obtenez cet accès plus tard |
| **D. Un serveur Windows** | 0 € | Un accès administrateur à la machine | **Si on vous confie une machine virtuelle Windows** |
| C. Réseau local seul | 0 € | Une machine au dépôt | **Seulement si** la saisie a toujours lieu au dépôt |

Ces options installent exactement la même chose : seule la machine change, et
la façon de la faire démarrer toute seule (Docker, systemd, service Windows).
Passer de l'une à l'autre plus tard ne demande aucune modification du code, juste
une copie du fichier de base de données.

---

## Option A — Oracle Cloud Always Free + Tailscale (retenue)

Une machine virtuelle dans le cloud, **gratuite à vie**, que vous créez vous-même :
aucun droit administrateur à demander à quiconque, aucun matériel dans vos locaux.
Tailscale lui donne ensuite une adresse HTTPS joignable depuis n'importe quel
chantier, sans ouvrir le moindre port.

### 1. Créer le compte Oracle Cloud

Sur [oracle.com/cloud/free](https://www.oracle.com/cloud/free/). Une carte bancaire
est demandée pour vérifier votre identité ; le compte reste en mode gratuit tant
que vous ne le passez pas manuellement en payant.

**Choisissez une région européenne** (Paris ou Marseille) au moment de
l'inscription : elle n'est plus modifiable ensuite, et c'est ce qui garde vos
données de paie dans l'Union européenne.

### 2. Créer la machine

*Compute → Instances → Create instance* :

- **Image** : Ubuntu 24.04
- **Shape** : `VM.Standard.A1.Flex`, **1 OCPU et 6 Go de mémoire**
- **Clé SSH** : téléchargez la clé privée proposée, vous en aurez besoin

Deux points à connaître :

- Depuis juin 2026, l'offre gratuite plafonne à **2 OCPU et 12 Go** au total. En
  restant à 1 OCPU / 6 Go vous êtes largement dedans — et largement au-dessus des
  besoins de l'application.
- Si Oracle répond *« Out of host capacity »*, la région manque temporairement de
  machines ARM. Réessayez plus tard ou changez de domaine de disponibilité. À
  défaut, le shape `VM.Standard.E2.1.Micro` (1 Go) est toujours disponible et
  suffit ici, la base ne pesant que quelques mégaoctets.

### 3. Installer l'application

Connectez-vous en SSH à l'adresse IP publique de la machine, puis :

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo usermod -aG docker $USER && exec su -l $USER

git clone -b claude/timesheet-digitalization-gpuajx \
  https://github.com/CamilleDTF/Pointage.git ~/pointage
cd ~/pointage
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env
docker compose up -d
```

Le premier démarrage compile une dépendance native : comptez deux à trois minutes.

Vérifier, depuis la machine elle-même :
`curl -s localhost:3000 | head -5` doit renvoyer du HTML.

### 4. Rendre l'application joignable depuis les chantiers

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale serve --bg 3000
```

La dernière commande affiche une adresse du type
`https://pointage.votre-reseau.ts.net`. C'est **l'adresse HTTPS définitive**, avec
son certificat, renouvelé automatiquement.

> Tailscale vous évite au passage toute la configuration réseau d'Oracle : aucune
> règle de sécurité à ouvrir, aucun port exposé sur Internet. C'est le piège
> classique d'une première installation sur Oracle, et vous le contournez
> entièrement.

Sur chaque téléphone : installer Tailscale (App Store / Play Store), se connecter
au même compte, ouvrir l'adresse, puis **Ajouter à l'écran d'accueil**.

### 5. Charger l'effectif

```bash
docker compose cp Tableau_affectation_operateurs.xlsx pointage:/data/effectif.xlsx
docker compose exec pointage node scripts/importer-effectif.js /data/effectif.xlsx
docker compose exec pointage node scripts/importer-effectif.js /data/effectif.xlsx --appliquer
```

Le premier passage ne fait que simuler : il liste les chefs et les opérateurs
reconnus, et signale ceux dont la colonne « chef d'équipe » ne désigne personne de
connu. Le second écrit réellement. La commande est rejouable : elle met à jour
l'existant au lieu de créer des doublons, ce qui permet de la relancer à chaque
mouvement de personnel.

### 6. Redémarrage et pérennité

Docker relance l'application au redémarrage de la machine (`restart:
unless-stopped`) : rien à configurer.

Oracle se réserve le droit de récupérer une machine gratuite **restée totalement
inactive**. L'application et Tailscale entretiennent en permanence un peu de
trafic, ce qui suffit à l'écarter. Connectez-vous malgré tout à la console Oracle
de temps en temps, et surveillez les courriels qu'ils envoient.

---

## Option B — un NAS ou un PC de l'entreprise

Si vous obtenez un jour l'accès administrateur au NAS, ou si un PC du bureau peut
rester allumé, l'installation est la même qu'à l'option A à partir de l'étape 3.
Sur un NAS, activez d'abord Docker (Synology : *Centre de paquets → Container
Manager* ; QNAP : *Container Station*) et installez dans un dossier du volume
principal, par exemple `/volume1/docker/pointage`.

L'intérêt : vos données de paie ne sortent pas de l'entreprise, ce qui est
l'argument RGPD le plus simple à défendre. Vérifiez alors que la machine redémarre
seule après une coupure de courant (Synology : *Panneau de configuration →
Alimentation → Redémarrage automatique* ; PC : réglage « Restore on AC power
loss » du BIOS).

Pour déménager depuis Oracle, il suffit de recopier le fichier
`/data/pointage.db` : tout y est.

Sur une machine sans Docker, un service systemd fait l'affaire :

```ini
[Unit]
Description=Pointage hebdomadaire
After=network.target

[Service]
Type=simple
User=pointage
WorkingDirectory=/opt/pointage
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=DATA_DIR=/var/lib/pointage
EnvironmentFile=/etc/pointage.env
ExecStart=/usr/bin/node server/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

`/etc/pointage.env`, en `chmod 600`, contient `SESSION_SECRET=<64 caractères
aléatoires>`. Puis :

```bash
install -d -o pointage -g pointage /var/lib/pointage
systemctl enable --now pointage
```

---

## Option D — un serveur Windows

Si la machine qu'on vous confie tourne sous Windows, l'application s'y installe
en **service** : elle démarre avec le serveur, tourne sans session ouverte, et
repart seule après un plantage.

> `DEMARRER.bat` ne convient pas sur un serveur. Il est fait pour un poste où
> quelqu'un est assis : il tient l'application dans sa fenêtre, ouvre le
> navigateur, et **fermer la fenêtre — ou simplement se déconnecter du serveur —
> arrête tout**. C'est le piège de cette configuration, et la première panne du
> lundi matin.

### 1. Installer Node.js — pour toute la machine

Depuis [nodejs.org](https://nodejs.org), le bouton **LTS**, avec l'installateur
`.msi`. Il place Node dans `C:\Program Files\nodejs`, visible de tous les comptes.

Ce point n'est pas un détail : un service ne tourne pas sous votre compte mais
sous le compte **Système**, qui n'a ni votre `PATH` ni vos variables. Une
installation par utilisateur (fnm, nvm, un dossier sous `AppData`) marche pour
vous et pour personne d'autre — le service échouerait au démarrage avec un
message qui ne dit pas pourquoi. Le script d'installation refuse ce cas et vous
le dit.

### 2. Poser le dossier et lancer l'installation

Décompressez l'archive dans un chemin court et sans parenthèses, par exemple
`C:\Pointage`. Puis **clic droit sur `INSTALLER-SERVICE.bat` → Exécuter en tant
qu'administrateur** — un double-clic suffit aussi, les droits sont demandés
tout seuls.

Il fait tout : il installe les composants, crée le compte directeur à la
première fois, enregistre le service, ouvre le port dans le pare-feu, puis
vérifie que l'application **répond vraiment** avant de vous annoncer que c'est
bon. Comptez deux minutes.

Pour un autre port : `INSTALLER-SERVICE.bat -Port 8080`.
Si un proxy se charge déjà de joindre l'application, `-SansPareFeu` laisse le
pare-feu fermé.

### 3. Une fois installé

| Fichier | Ce qu'il fait |
|---|---|
| `ETAT-SERVICE.bat` | Dit si le service tourne et montre les vingt dernières lignes du journal. **C'est le fichier à lancer quand « ça ne répond plus »** : il distingue le service arrêté du service démarré dont l'application est tombée. |
| `ARRETER-SERVICE.bat` | Retire le service. Les données ne sont pas touchées. |
| `INSTALLER-SERVICE.bat` | Relançable : il remplace le service en place, sans perdre les données. C'est aussi ce qui applique une mise à jour de l'application. |

Le service apparaît dans `services.msc` sous **Pointage hebdomadaire**, et se
pilote comme les autres :

```
net stop Pointage
net start Pointage
```

Son journal est dans `data\service.log`, remis à zéro au-delà de 5 Mo.

> **Comment Windows arrive à piloter Node.** Windows ne sait pas gérer
> n'importe quel programme en service : il attend un exécutable qui sache lui
> répondre, et `node.exe` ne le sait pas — un `sc create` pointé droit dessus
> donne le fameux *« le service n'a pas répondu à temps »* (erreur 1053).
> L'installateur télécharge donc **NSSM** (300 Ko, [nssm.cc](https://nssm.cc)),
> qui fait l'intermédiaire. Si le téléchargement est bloqué — c'est fréquent sur
> un réseau d'entreprise — il bascule tout seul sur le **planificateur de
> tâches** livré avec Windows : même résultat au démarrage, sans l'entrée dans
> `services.msc`. Il vous dit lequel des deux il a posé.

### 4. Rendre l'application joignable depuis les chantiers

L'installation ne l'expose que sur le réseau local, en clair. **Ne vous arrêtez
pas là si la saisie a lieu sur chantier** : `http://` transporte les codes en
clair, et les navigateurs refusent l'ajout à l'écran d'accueil sur un site qui
n'est pas en HTTPS.

Tailscale existe aussi pour Windows et reste le chemin le plus court :

```powershell
winget install tailscale.tailscale
tailscale up
tailscale serve --bg 3000
```

Vous obtenez une adresse `https://<machine>.<votre-réseau>.ts.net`, son
certificat compris et renouvelé tout seul, joignable en 4G, sans ouvrir le
moindre port sur Internet.

Si vous disposez d'un nom de domaine public pointant sur ce serveur, un reverse
proxy fait le même office : [Caddy](https://caddyserver.com) obtient et
renouvelle le certificat sans configuration, avec un fichier de deux lignes.

```
pointage.mon-entreprise.fr {
    reverse_proxy 127.0.0.1:3000
}
```

Dans les deux cas, ajoutez ensuite `COOKIE_SECURE=true` dans `configuration.txt`
et relancez le service : le cookie de session ne circulera plus jamais en clair,
même si quelqu'un ouvre l'adresse en `http://`.

### 5. Sauvegardes

Toute la base tient dans `data\pointage.db`. Une tâche planifiée quotidienne
suffit — à créer une fois, dans le Planificateur de tâches, sur ce script :

```powershell
# C:\Pointage\sauvegarder.ps1
$horodatage = Get-Date -Format 'yyyyMMdd-HHmm'
$destination = 'D:\Sauvegardes\Pointage'
New-Item -ItemType Directory -Force -Path $destination | Out-Null
Copy-Item 'C:\Pointage\data\pointage.db' "$destination\pointage-$horodatage.db"
Get-ChildItem $destination -Filter 'pointage-*.db' |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-90) } | Remove-Item
```

Arrêtez le service le temps de la copie (`net stop Pointage` / `net start
Pointage`), ou installez `sqlite3.exe` et utilisez `.backup`, qui copie sans
interrompre le service.

**Copiez ces archives hors du serveur.** Une sauvegarde qui vit sur le disque
qu'elle protège ne protège de rien.

---

## Option C — réseau local seul

Une adresse locale du type `http://192.168.1.20:3000` fonctionne telle quelle :
l'application détecte qu'elle est jointe en clair et n'exige pas HTTPS. Elle
l'écrit une fois dans son journal au premier accès.

Trois limites, dont une rédhibitoire selon l'usage :

1. **Une adresse locale n'est joignable que depuis vos locaux.** Un chef d'équipe
   sur chantier, en 4G, ne l'atteindra pas. C'est la limite qui décide : cette
   option ne convient que si la saisie a systématiquement lieu au dépôt, sur le
   Wi-Fi de l'entreprise.
2. **Les codes circulent en clair** sur le réseau. Acceptable sur un réseau
   d'entreprise maîtrisé, à peser tout de même.
3. **Pas d'installation sur l'écran d'accueil** des téléphones : les navigateurs
   la réservent aux sites en HTTPS. L'application reste utilisable dans le
   navigateur, simplement moins pratique à ouvrir.

Ouvrir un port de votre box vers l'application pour la rendre accessible depuis
les chantiers serait le pire des choix : cela exposerait vos données de paie à
tout Internet, sans chiffrement. Tailscale règle exactement ce problème, sans
ouvrir quoi que ce soit.

### Forcer HTTPS malgré tout

Si vous placez l'application derrière un reverse proxy dont vous êtes sûr, vous
pouvez exiger que le cookie de session ne circule jamais en clair :

```
COOKIE_SECURE=true
```

---

## Sauvegardes — à mettre en place le jour de la mise en service

Toute la base tient dans un seul fichier. `sqlite3 .backup` en produit une copie
cohérente même serveur allumé.

```bash
cat > ~/sauvegarde-pointage <<'EOF'
#!/bin/sh
set -e
horodatage=$(date +%Y%m%d-%H%M)
destination=$HOME/sauvegardes
mkdir -p "$destination"
cd "$HOME/pointage"
docker compose exec -T pointage sqlite3 /data/pointage.db ".backup '/data/copie.db'"
docker compose cp pointage:/data/copie.db "$destination/pointage-$horodatage.db"
docker compose exec -T pointage rm -f /data/copie.db
gzip -f "$destination/pointage-$horodatage.db"
find "$destination" -name 'pointage-*.db.gz' -mtime +90 -delete
EOF
chmod +x ~/sauvegarde-pointage
```

Tâche quotidienne (`crontab -e`) :

```
15 2 * * * $HOME/sauvegarde-pointage
```

**Copiez ces archives hors de la machine** — un disque externe, un autre poste, un
espace cloud gratuit. Une sauvegarde qui vit sur le disque qu'elle protège ne
protège de rien.

Testez une restauration au moins une fois avant d'abandonner le papier :

```bash
gunzip -c ~/sauvegardes/pointage-<horodatage>.db.gz > /tmp/verif.db
sqlite3 /tmp/verif.db "SELECT COUNT(*) FROM fiches;"
```

**La machine étant chez Oracle, cette copie hors site compte double** : c'est votre
seul recours si le compte gratuit venait à être suspendu. Rapatriez-la
régulièrement sur un poste du bureau (`scp`).

---

## Configuration

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | Port d'écoute | `3000` |
| `DATA_DIR` | Dossier de la base et de la clé de session | `./data` |
| `SESSION_SECRET` | Clé de signature des sessions | générée dans `DATA_DIR/session.key` |
| `NODE_ENV` | `production` : messages d'erreur non détaillés | — |
| `COOKIE_SECURE` | `true` force le cookie `Secure`, même joint en HTTP | déduit du protocole utilisé |

---

## Après la mise en service

- Écran **Équipes** : affecter les opérateurs que l'import n'a pas pu rattacher
  (ceux dont la colonne « chef » indiquait « non indiqué » ou « dépôt »).
- Désactiver les comptes de démonstration s'ils ont été créés.
- Faire changer son code à chaque chef dès la première connexion (bouton **Code**).
- Mener **deux semaines de double saisie** papier + application, et comparer les
  totaux de paie avant de basculer.
