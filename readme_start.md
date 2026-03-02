# README_START

Contexte opérationnel rapide pour travailler sur MyOptiWealth.

## Serveur
- VPS: `72.61.94.45`
- Projet: `/var/www/myoptiwealth`

## Domaines
- Production: `https://myoptiwealth.fr`
- WWW: `https://www.myoptiwealth.fr`

## PM2
- `myoptiwealth-api` -> port `3400`
- `myoptiwealth-frontend` -> port `3401`

## Déploiement standard
```bash
bash /var/www/myoptiwealth/ops/deploy-local.sh
```

## Santé
```bash
curl -I https://myoptiwealth.fr
curl -I https://myoptiwealth.fr/api/health
pm2 list
```

## Base de données
- Actuel: utilise encore `captiva` (faute d'accès MySQL admin)
- Cible: DB dédiée `myoptiwealth` + user dédié
