# Acces MyOptiWealth (copie CAPTIVA)

Date de preparation: 2026-03-02

## Serveur VPS
- IP publique: 72.61.94.45
- Utilisateur systeme disponible: root
- Methode d'acces observee: SSH (cle), pas de mot de passe VPS lisible dans les configs du projet.

## Repertoire projet
- Front/API unifie: /var/www/myoptiwealth
- Logs symlink: /var/www/myoptiwealth_logs -> /var/www/myoptiwealth/storage/logs
- Uploads symlink: /var/www/myoptiwealth_uploads -> /var/www/myoptiwealth/storage/uploads

## PM2 (meme mecanique que CAPTIVA)
- Fichier: /var/www/myoptiwealth/ecosystem.config.cjs
- Processus:
  - myoptiwealth-api (port 3400)
  - myoptiwealth-frontend (port 3401)

## Acces base de donnees (copie CAPTIVA)
- DB_HOST=127.0.0.1
- DB_PORT=3306
- DB_NAME=captiva
- DB_USER=captiva
- DB_PASS=b8d0a427a4156542f625b9f6ba9f58bb

Note: l'utilisateur SQL `captiva` a les privileges complets sur la base `captiva` uniquement.

## Acces SMTP (copie CAPTIVA)
- SMTP_HOST=smtp.hostinger.com
- SMTP_PORT=465
- SMTP_USER=admin@captiva-risks.com
- SMTP_PASS=Veduta1789@@

## Droits fichiers appliques
- Proprietaire/groupe: root:www-data
- Dossiers: 775
- Fichiers: 664
- .env: 664

## Commandes utiles
- Installer deps: npm install
- Lancer API locale: node src/index.js
- Lancer frontend local: npm run dev -- --port 3200
- Demarrer PM2: pm2 start /var/www/myoptiwealth/ecosystem.config.cjs
