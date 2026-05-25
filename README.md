# 🤖 Discord Role Temp Bot

Bot Discord pour attribuer des rôles temporaires (1 jour / 1 semaine / 1 mois).

## Commandes

| Commande | Description |
|----------|-------------|
| `/giverole @user @role [durée]` | Donne un rôle temporaire |
| `/retirerole @user @role` | Retire un rôle temporaire manuellement |

## Installation

### 1. Créer le bot sur Discord
1. Va sur [discord.com/developers/applications](https://discord.com/developers/applications)
2. **New Application** → donne un nom
3. Onglet **Bot** → **Reset Token** → copie le token
4. Active **Server Members Intent** (dans Bot > Privileged Gateway Intents)
5. Onglet **OAuth2 > URL Generator** :
   - Scopes : `bot` + `applications.commands`
   - Permissions bot : `Manage Roles`
   - Copie l'URL générée → invite le bot sur ton serveur

### 2. Créer la base MongoDB
1. Va sur [mongodb.com/atlas](https://mongodb.com/atlas) → crée un compte gratuit
2. Crée un **cluster gratuit (M0)**
3. **Database Access** → crée un utilisateur avec mot de passe
4. **Network Access** → ajoute `0.0.0.0/0` (accès depuis partout)
5. **Connect** → **Drivers** → copie l'URI (remplace `<password>`)

### 3. Récupérer les IDs Discord
- Active le **Mode développeur** dans Discord (Paramètres > Avancés)
- Clic droit sur le rôle modérateur → **Copier l'ID** → `ALLOWED_ROLE_ID`
- Clic droit sur le salon de logs → **Copier l'ID** → `LOG_CHANNEL_ID`

### 4. Déployer sur Railway
1. Push ce repo sur GitHub (repo privé)
2. Va sur [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
3. Sélectionne ton repo
4. Onglet **Variables** → ajoute :
   - `DISCORD_TOKEN`
   - `MONGO_URI`
   - `ALLOWED_ROLE_ID`
   - `LOG_CHANNEL_ID`
5. Railway lance automatiquement `npm start`

## ⚠️ Important
- Le bot doit avoir un rôle **au-dessus** des rôles qu'il doit gérer dans la hiérarchie Discord
- Ne commit jamais ton fichier `.env` (il est dans le `.gitignore`)
