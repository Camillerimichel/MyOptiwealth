# CAPITVA-RISKS
Plateforme de suivi et d'analyses des risques pour captives en assurances.

## Travaux du 30 janvier 2026 (hier)
Objectif : poser les bases CAPTIVA (schéma DB, API, exports, reporting, jobs).

- Schéma de base de données complet pour la gestion captive : branches, catégories, politiques, paramètres de risques, règles de réassurance, programmes, capital, versions de politiques, audit, jobs, rapports.
- API CAPTIVA avec CRUD sécurisé (rôles) sur les référentiels et règles de gouvernance des branches.
- Exports CSV étendus pour programmes, sinistres et nouveaux référentiels captive.
- Reporting : templates, files d'attente de rapports, génération multi-formats (PDF/XLSX/CSV/JSON), téléchargements et nettoyage.
- Jobs asynchrones : worker, monitor, crons d'enqueue (snapshot mensuel, recompute actuariel, cleanup exports/rapports).

## Points techniques ajoutés
### API
- `/api/captive` :
  - branches, catégories, mapping branches-catégories
  - policies, risk parameters, reinsurance rules
  - programs, program-branches, capital parameters
  - policy versions
- `/api/export` :
  - CSV programmes, sinistres, et référentiels captive (branches, catégories, mappings, policies, risk parameters, reinsurance rules, programs, program-branches, capital parameters, policy versions)
- `/api/reports` :
  - CRUD templates
  - création de jobs de rapport, statut et téléchargement
- `/api/jobs` :
  - health, liste filtrable, enqueue manuel

### Jobs & Cron
- Worker : `src/jobs/runner.js`
- Monitor : `src/jobs/monitor-jobs.js`
- Enqueue crons : `src/jobs/cron/*.js`
- Exemple crontab : `ops/cron.jobs.example`

### Schéma DB (migrations)
- `src/db/migrate.js` crée/évolue :
  - `insurance_branch`, `insurance_branch_category`, `insurance_branch_category_map`
  - `captive_branch_policy`, `branch_risk_parameters`, `branch_reinsurance_rules`
  - `insurance_program`, `program_branch_map`, `branch_capital_parameters`, `branch_policy_version`
  - `report_jobs`, `report_templates`, `jobs`, `audit_trail`, + tables existantes (`programmes`, `sinistres`, `reglements`, users/roles)

### Dépendances clés
- Génération : `pdfkit`, `exceljs`, `archiver`
- Validation : `zod`
- DB : `mysql2`

## Scripts utiles
- API : `npm run start` / `npm run dev`
- Jobs : `npm run jobs:runner` / `npm run jobs:monitor`
- Enqueue :
  - `npm run jobs:cleanup:enqueue`
  - `npm run jobs:reports:cleanup:enqueue`
  - `npm run jobs:actuarial:enqueue`
  - `npm run jobs:snapshot:enqueue`

## Fichiers clés modifiés/ajoutés le 30/01/2026
- `src/db/migrate.js`
- `src/routes/captive.js`
- `src/routes/export.js`
- `src/routes/reports.js`
- `src/routes/jobs.js`
- `src/jobs/*`
- `ops/cron.jobs.example`
- `package.json` / `package-lock.json`

## Notes
- La migration est idempotente et s'exécute au démarrage (`src/index.js`).
- Les endpoints sont protégés par rôles (admin, cfo, risk_manager, actuaire, conseil).
