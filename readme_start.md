# README_START

Contexte opérationnel rapide pour travailler sur MyOptiWealth.

## Serveur
- VPS: `72.61.94.45`
- Projet: `/var/www/myoptiwealth`

## Domaines
- Production: `https://myoptiwealth.fr`
- WWW: `https://www.myoptiwealth.fr`

## PM2
- `myoptiwealth-saas-api` -> port `7000`
- `myoptiwealth-saas-web` -> port `3002`

## Déploiement standard
```bash
bash /var/www/myoptiwealth/ops/release.sh
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
