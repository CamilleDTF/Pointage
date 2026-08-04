# Mise en service — sans abonnement

L'application n'a besoin d'aucun service payant. Elle tient dans un processus
Node.js et un fichier SQLite : tout ce qu'il lui faut, c'est une machine allumée
et un moyen d'y accéder depuis les chantiers.

**Coût de la solution retenue : 0 €**, sans carte bancaire, sans nom de domaine,
sans abonnement.

| Option | Coût | Ce qu'il vous faut | Pour qui |
|---|---|---|---|
| **A. Machine que vous avez déjà + Tailscale** ← recommandée | **0 €** | Un PC de bureau, un NAS ou un Raspberry Pi qui reste allumé | Le cas général |
| B. Oracle Cloud Always Free | 0 € (carte demandée à l'inscription, jamais débitée) | Un compte Oracle Cloud | Si aucune machine ne peut rester allumée |
| C. Réseau local seul | 0 € | Un PC au dépôt | Si les fiches sont remplies au dépôt et jamais sur chantier |

---

## Option A — votre machine + Tailscale (recommandée)

Le principe : l'application tourne sur une machine à vous, et **Tailscale**
(gratuit jusqu'à 100 appareils) crée un réseau privé entre cette machine et les
téléphones des chefs d'équipe. Aucun port ouvert sur Internet, aucun nom de
domaine à acheter, un vrai certificat HTTPS fourni gratuitement.

Les avantages vont au-delà du prix : vos données de paie ne quittent jamais vos
locaux, et l'application n'est pas exposée publiquement.

### 1. Installer l'application

Avec Docker, sur la machine qui restera allumée :

```bash
git clone <dépôt> /opt/pointage && cd /opt/pointage
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(32).toString('hex'))" > .env
docker compose up -d
docker compose exec pointage node server/seed.js
```

Sans Docker (Node.js 20 ou plus) :

```bash
git clone <dépôt> /opt/pointage && cd /opt/pointage
npm ci --omit=dev
npm run seed
NODE_ENV=production npm start
```

Vérifier : `http://localhost:3000` doit afficher l'écran de connexion.

### 2. Rendre l'application accessible depuis les chantiers

```bash
curl -fsSL https://tailscale.com/install.sh | sh
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

### 3. Démarrage automatique

Docker s'en charge (`restart: unless-stopped`). Sans Docker, créer
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

Vérifier enfin que la machine redémarre bien toute seule après une coupure de
courant (réglage « Restore on AC power loss » dans le BIOS de la plupart des PC).

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

Si les fiches sont toujours remplies au dépôt, sur le Wi-Fi de l'entreprise, une
adresse locale du type `http://192.168.1.20:3000` suffit et ne coûte rien.

Limite à connaître : **sans HTTPS, les codes circulent en clair** sur le réseau, et
l'installation sur l'écran d'accueil du téléphone n'est pas proposée. Cette option
ne convient donc que si la saisie a toujours lieu au dépôt, sur votre propre Wi-Fi.

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
| `NODE_ENV` | `production` active le cookie `Secure` (HTTPS requis) | — |

---

## Après la mise en service

- Écran **Équipes** : créer les vrais comptes, désactiver ceux de démonstration.
- Saisir les salariés et leur affectation à un chef — c'est ce qui pré-remplit
  les fiches chaque semaine.
- Faire changer son code à chaque chef dès la première connexion (bouton **Code**).
- Mener **deux semaines de double saisie** papier + application, et comparer les
  totaux de paie avant de basculer.
