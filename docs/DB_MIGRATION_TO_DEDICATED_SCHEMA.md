# Migration vers base dédiée MyOptiWealth

Le serveur courant ne donne pas d'accès admin MySQL depuis shell (`root@localhost` refusé), donc la création DB/user dédiée est préparée mais non appliquée.

## 1) Créer la DB et le user (compte admin MySQL requis)
```bash
mysql -u root -p < /var/www/myoptiwealth/ops/sql/create_myoptiwealth_db.sql
```

## 2) Copier les données existantes
```bash
mysqldump -u captiva -p'b8d0a427a4156542f625b9f6ba9f58bb' --single-transaction captiva \
  | mysql -u root -p myoptiwealth
```

## 3) Basculer le .env
- `DB_NAME=myoptiwealth`
- `DB_USER=myoptiwealth`
- `DB_PASS=<mot_de_passe_fort>`

## 4) Redémarrer l'application
```bash
bash /var/www/myoptiwealth/ops/release.sh full
```
