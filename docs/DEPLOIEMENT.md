# Mise en service — sans abonnement

L'application n'a besoin d'aucun service payant. Elle tient dans un processus
Node.js et un fichier SQLite : tout ce qu'il lui faut, c'est une machine allumée
et un moyen d'y accéder depuis les chantiers.

**Coût de la solution retenue : 0 €**, sans carte bancaire, sans nom de domaine,
sans abonnement.

| Option | Coût | Ce qu'il vous faut | Pour qui |
|---|---|---|---|
| **A. Votre NAS + Tailscale** ← retenue | **0 €** | Le NAS de l'entreprise, avec Docker | Votre cas |
| B. Oracle Cloud Always Free | 0 € (carte demandée à l'inscription, jamais débitée) | Un compte Oracle Cloud | Si aucune machine ne peut rester allumée |
| C. Réseau local seul | 0 € | Une machine au dépôt | **Seulement si** la saisie a toujours lieu au dépôt |

---

## Option A — votre NAS + Tailscale (retenue)

Le principe : l'application tourne sur le NAS de l'entreprise, et **Tailscale**
(gratuit jusqu'à 100 appareils) crée un réseau privé entre le NAS et les
téléphones des chefs d'équipe. Aucun port ouvert sur Internet, aucun nom de
domaine à acheter, un vrai certificat HTTPS fourni gratuitement.

Les avantages vont au-delà du prix : vos données de paie ne quittent jamais vos
locaux, et l'application n'est pas exposée publiquement.

### 1. Installer l'application sur le NAS

Activez **Docker** (Synology : *Centre de paquets → Container Manager* ;
QNAP : *Container Station*), puis en SSH sur le NAS :

```bash
git clone -b claude/timesheet-digitalization-gpuajx \
  https://github.com/CamilleDTF/Pointage.git /volume1/docker/pointage
cd /volume1/docker/pointage
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env
docker compose up -d
```

Adaptez le chemin si votre volume principal ne s'appelle pas `volume1`. Si `git`
n'est pas disponible sur le NAS, téléchargez l'archive ZIP du dépôt depuis GitHub
et décompressez-la au même endroit. Les données vivent ensuite dans un volume
Docker, sauvegardé avec le NAS.

Le premier démarrage compile une dépendance native : comptez deux à trois minutes,
davantage sur un NAS d'entrée de gamme.

Vérifier : `http://<ip-du-nas>:3000` doit afficher l'écran de connexion.

### 2. Charger l'effectif

Plutôt que de saisir les 40 personnes à la main, importez le tableau
d'affectation des opérateurs :

```bash
docker compose cp Tableau_affectation_operateurs.xlsx pointage:/data/effectif.xlsx
docker compose exec pointage node scripts/importer-effectif.js /data/effectif.xlsx
docker compose exec pointage node scripts/importer-effectif.js /data/effectif.xlsx --appliquer
```

Le premier passage ne fait que simuler : il liste les chefs et les opérateurs
reconnus, et signale ceux dont la colonne « chef d'équipe » ne désigne personne
de connu. Le second écrit réellement. La commande est rejouable : elle met à jour
l'existant au lieu de créer des doublons, ce qui permet de la relancer à chaque
mouvement de personnel.

### 3. Rendre l'application accessible depuis les chantiers

Installez Tailscale sur le NAS (Synology : paquet **Tailscale** dans le Centre de
paquets ; sinon en ligne de commande), puis :

```bash
sudo tailscale up
sudo tailscale serve --bg 3000
```

La dernière commande affiche une adresse du type
`https://bureau.votre-reseau.ts.net`. C'est **l'adresse HTTPS définitive** de
l'application. Le certificat est gratuit et renouvelé automatiquement.

Sur chaque téléphone : installer Tailscale (App Store / Play Store), se connecter
au même compte, ouvrir l'adresse, puis **Ajouter à l'écran d'accueil**.

> HTTPS n'est pas un luxe ici : les codes des chefs d'équipe circulent sur le
> réseau, et l'installation sur l'écran d'accueil du téléphone en dépend. C'est la
> raison pour laquelle on passe par Tailscale plutôt que par une simple adresse IP
> locale.

### 4. Démarrage automatique

Docker s'en charge (`restart: unless-stopped`) : au redémarrage du NAS,
l'application repart seule. Sur une machine sans Docker, créer
`/etc/systemd/system/pointage.service` :

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

`/etc/pointage.env`, en `chmod 600` :

```
SESSION_SECRET=<64 caractères aléatoires>
```

```bash
install -d -o pointage -g pointage /var/lib/pointage
systemctl enable --now pointage
```

Vérifiez enfin que le NAS lui-même redémarre après une coupure de courant
(Synology : *Panneau de configuration → Alimentation → Redémarrage automatique*).

---

## Option B — Oracle Cloud Always Free

Si aucune machine ne peut rester allumée. L'offre « Always Free » d'Oracle Cloud
inclut une machine virtuelle ARM gratuite **à vie** (jusqu'à 4 cœurs et 24 Go de
RAM), largement surdimensionnée pour cet usage. Une carte bancaire est demandée à
l'inscription pour vérifier l'identité, mais le compte reste en mode gratuit tant
que vous ne le passez pas manuellement en payant.

1. Créer une instance **Ampere A1** (Ubuntu), en choisissant une région
   européenne — vos données restent alors dans l'UE.
2. Installer l'application comme à l'option A.
3. Pour l'accès : soit Tailscale à nouveau (le plus simple et le plus sûr), soit
   une exposition publique avec Caddy si vous possédez un nom de domaine :

```
pointage.mondomaine.fr {
    reverse_proxy localhost:3000
}
```

Caddy obtient et renouvelle le certificat Let's Encrypt tout seul, gratuitement.
Seul le nom de domaine reste payant (environ 10 € par an) — d'où la préférence
pour Tailscale, qui n'en demande aucun.

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
cat > /usr/local/bin/sauvegarde-pointage <<'EOF'
#!/bin/sh
set -e
horodatage=$(date +%Y%m%d-%H%M)
destination=/var/backups/pointage
mkdir -p "$destination"
sqlite3 /var/lib/pointage/pointage.db ".backup '$destination/pointage-$horodatage.db'"
gzip -f "$destination/pointage-$horodatage.db"
find "$destination" -name 'pointage-*.db.gz' -mtime +90 -delete
EOF
chmod +x /usr/local/bin/sauvegarde-pointage
```

Avec Docker, la base est dans le volume : remplacer le chemin par
`docker compose exec -T pointage sqlite3 /data/pointage.db ".backup '/data/sauvegarde.db'"`.

Tâche quotidienne (`crontab -e`) :

```
15 2 * * * /usr/local/bin/sauvegarde-pointage
```

**Copiez ces archives hors de la machine** — un disque externe, un autre poste, un
espace cloud gratuit. Une sauvegarde qui vit sur le disque qu'elle protège ne
protège de rien.

Testez une restauration au moins une fois avant d'abandonner le papier :

```bash
gunzip -c /var/backups/pointage/pointage-<horodatage>.db.gz > /tmp/verif.db
sqlite3 /tmp/verif.db "SELECT COUNT(*) FROM fiches;"
```

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
