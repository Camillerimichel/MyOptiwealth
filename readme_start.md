README_START.md

But : éviter les questions répétitives en début de session. Ce fichier centralise le contexte de travail.

## Contexte serveur
- Serveur : srv1114982 (accès root)
- IP publique : 72.61.94.45

## Domaines & accès
- Production : https://captiva-risks.com (proxy Nginx -> frontend pm2:3001, API pm2:3000)
- Accès direct dev/staging : http://72.61.94.45:3200

## Repos & chemins
- Backend API : /root/apps/captiva-api
- Frontend : /var/www/CAPTIVA

## Services (PM2)
- captiva-api (port 3000)
- captiva-frontend (port 3001)
- captiva-jobs

## Déploiement
- Frontend :
  - script : /var/www/CAPTIVA/ops/deploy-frontend.sh
  - action : build + pm2 restart captiva-frontend
- API :
  - action : pm2 restart captiva-api (migrations au démarrage)

## Nginx
- Config : /etc/nginx/sites-available/captiva-risks.conf
- Proxy :
  - /api/ -> http://127.0.0.1:3000
  - / -> http://127.0.0.1:3001

## Auth
- JWT stocké dans localStorage : captiva_token
- Tokens expirent (12h). En cas de "invalid_token", relogin requis.

## Notes opérationnelles
- CORS autorise : captiva-risks.com + localhost:3200 + 72.61.94.45:3200
- Déploiement domaine == déploiement frontend (même serveur)

## Accès & permissions (ne pas redemander)
- Accès DB et répertoires : OK pour agir dans /root/apps/captiva-api et /var/www/CAPTIVA.
- Sauf mention contraire, procéder directement (lecture/écriture/commandes) sans reposer la question des droits.

## Contrat d'execution (obligatoire)
### Regles immuables
1. MUST utiliser `/var/www/CAPTIVA` comme base frontend unique.
2. MUST NOT utiliser ou citer `/root/apps/frontend` dans les actions de deploiement.
3. MUST verifier avant deploiement: `pm2 describe captiva-frontend` et confirmer `exec cwd = /var/www/CAPTIVA`.
4. MUST deployer frontend via:
   - `bash /var/www/CAPTIVA/ops/deploy-local.sh` (par defaut), ou
   - `bash /var/www/CAPTIVA/ops/deploy-frontend.sh` (cas explicite).
5. MUST NOT elargir le scope sans validation explicite utilisateur.

### Workflow impose pour toute correction
1. Cibler une URL/page unique demandee par l'utilisateur.
2. Identifier le composant/fichier responsable, sans hypothese transverse.
3. Appliquer un patch minimal sur le perimetre cible uniquement.
4. Verifier localement (build et/ou checks pertinents).
5. Deployer en prod.
6. Prouver factuellement le resultat sur l'URL cible (HTTP + verification du rendu/markup si besoin).

### Controle anti-derive
1. En cas d'erreur d'analyse initiale: STOP, repartir de zero sur la page cible.
2. Interdiction de "compenser" une erreur par des changements hors sujet.
3. Si un doute persiste: demander confirmation courte avant de continuer.
