# Mise en production

## Ce qu'il faut

- Node.js 20 ou plus récent.
- Un nom de domaine et un certificat HTTPS. **Ce n'est pas optionnel** : les
  cookies de session sont marqués `Secure` en production, et le service worker
  qui permet le fonctionnement hors ligne n'est actif qu'en HTTPS.
- Un disque persistant pour le dossier `data/` (base SQLite + clé de session).

## Option A — plateforme gérée (recommandé)

Railway, Render, Scalingo, Clever Cloud : environ 10 à 20 € par mois, HTTPS et
certificat automatiques.

1. Connecter le dépôt Git.
2. Commande de démarrage : `npm start`.
3. Monter un **volume persistant** sur `/data` et définir `DATA_DIR=/data`.
   Sans volume, la base est effacée à chaque redéploiement.
4. Définir les variables :
   ```
   NODE_ENV=production
   DATA_DIR=/data
   SESSION_SECRET=<64 caractères aléatoires>
   ```
   Générer le secret : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
5. Au premier démarrage : `npm run seed`, puis se connecter en directeur et
   changer tous les codes.

## Option B — VPS

Environ 5 € par mois (OVH, Hetzner, Scaleway).

```bash
git clone <dépôt> /opt/pointage && cd /opt/pointage
npm ci --omit=dev
```

Service systemd — `/etc/systemd/system/pointage.service` :

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

Puis :

```bash
install -d -o pointage -g pointage /var/lib/pointage
systemctl enable --now pointage
```

Reverse proxy Caddy — le certificat HTTPS est obtenu et renouvelé tout seul :

```
pointage.mondomaine.fr {
    reverse_proxy localhost:3000
}
```

## Sauvegardes

**À mettre en place le jour de la mise en production.** Toute la base tient dans
un fichier ; `sqlite3 .backup` produit une copie cohérente même serveur allumé.

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

Tâche quotidienne :

```
15 2 * * * /usr/local/bin/sauvegarde-pointage
```

Copier ces archives **hors du serveur** (S3, NAS, autre machine). Une sauvegarde
qui vit sur le disque qu'elle protège ne protège de rien.

Vérifier une restauration au moins une fois avant la bascule complète :

```bash
gunzip -c /var/backups/pointage/pointage-<horodatage>.db.gz > /tmp/verif.db
sqlite3 /tmp/verif.db "SELECT COUNT(*) FROM fiches;"
```

## Installation sur les téléphones

Chaque chef d'équipe, une seule fois :

1. Ouvrir `https://pointage.mondomaine.fr` dans Chrome (Android) ou Safari (iOS).
2. Se connecter avec son identifiant et son code.
3. Menu du navigateur → **Ajouter à l'écran d'accueil**.

L'application s'ouvre alors comme une application installée, y compris sans
réseau. Les saisies faites hors couverture partent automatiquement au retour du
signal ; une bannière orange indique ce qui reste en attente.

## Après la mise en service

- Créer les vrais comptes et désactiver les comptes de démonstration
  (écran **Équipes**).
- Saisir les salariés et leur affectation à un chef : c'est ce qui pré-remplit
  les fiches chaque semaine.
- Faire changer son code à chaque chef dès la première connexion.
- Mener les **deux semaines de double saisie** papier + application avant
  d'abandonner le papier, et comparer les totaux de paie.
