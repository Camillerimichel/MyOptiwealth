# S2 / Solvabilité - Dossier technique

## Objet

Ce document décrit l'implémentation technique de la chaîne `S2 / Solvabilité` dans CAPTIVA, avec un focus sur :

- la distinction `simulation` / `réel`
- la production de snapshots S2
- la consommation dans `Pilotage > Solvabilité`
- les évolutions UI et endpoints associés

## 1. Périmètre fonctionnel couvert

### 1.1 Côté `Actuariat > S2`

- sélection d'un `run` comme **référence de travail S2**
- paramétrage du moteur S2 placeholder (UI + API)
- sauvegarde du paramétrage et relance S2 sur le run sélectionné
- calcul / enregistrement de snapshots `S2 réel` à date d'arrêté
- batch mensuel (fins de mois) de snapshots `S2 réel`

### 1.2 Côté `Pilotage > Solvabilité`

- lecture des snapshots solvabilité avec filtre de source :
  - `simulation`
  - `réel`
  - `auto (réel prioritaire)`
- KPI SCR/MCR/FP éligibles
- jauges de couverture SCR / MCR
- suivi mensuel
- historique récent
- analyse des variations mensuelles (`M` vs `M-1`) avec waterfalls

## 2. Architecture générale

## 2.1 Sources de données S2

### Simulation

- table principale : `s2_scr_results`
- produit des runs S2 de simulation / ORSA
- utilisé historiquement par `Overview` et la lecture S2

### Réel (nouveau flux)

- table principale : `s2_scr_results_real`
- table détail par branche : `s2_scr_inputs_non_life_real`
- snapshots datés `as-of` à partir des données constatées

## 2.2 Consommateurs UI

- `src/app/actuariat/page.tsx` (`section=s2`)
- `src/app/pilotage/solvabilite/page.tsx`

## 2.3 Couche API

- `src/routes/actuariat.js` : endpoints de calcul/configuration S2
- `src/routes/pilotage.js` : endpoint de page solvabilité

## 3. Paramétrage moteur S2 (placeholder) - V1.1

## 3.1 Problème initial

Le moteur S2 utilisait des hardcodes (notamment `own_funds_eligible=12M`) dans plusieurs scripts, ce qui produisait :

- des `SCR` variables
- des `own funds` quasi fixes
- des ratios SCR incohérents pour un usage régulateur

## 3.2 Refactor de paramétrage

Helper central ajouté :

- `src/db/s2EngineConfig.js`

Il lit la configuration dans :

- `simulation_parameters`
- `parameter_group = 's2'`
- `parameter_key = 'engine_placeholder_config_v1'`

## 3.3 Paramètres centralisés (exemples)

- `own_funds_eligible_base_eur`
- `mcr_eur`
- coefficients placeholder par étape :
  - `claims_v1`
  - `reinsurance_v1`
  - `cat_xol_v2`
  - `fronting_v2`

## 3.4 Scripts touchés

- `src/db/generateSimulationClaimsV1.js`
- `src/db/applySimulationReinsuranceV1.js`
- `src/db/enhanceSimulationRunV2.js`
- `src/db/applyFrontingMotorRunV2.js`
- `src/db/recomputeS2FromGeoCatV1.js`
- `src/db/generateSimulationPortfolioV1.js`

## 3.5 SQL de configuration

- `ops/sql/s2_engine_placeholder_config_v1.sql`

## 4. UI de paramétrage S2 (Actuariat > S2)

## 4.1 Bloc `Paramétrage moteur S2 (placeholder)`

Fonctionnalités :

- chargement du paramétrage pour le scénario sélectionné
- édition des valeurs numéraires (format FR : espaces + virgule)
- enregistrement
- relance S2 sur le `run de travail`

## 4.2 Endpoints associés

- `GET /api/actuariat/s2-engine-config?scenario_id=...`
- `PUT /api/actuariat/s2-engine-config`
- `POST /api/actuariat/s2-engine-config/rerun`

### Relance S2 actuelle

- script utilisé : `src/db/applySimulationReinsuranceV1.js`
- raison : c'est le script le plus fiable sur les runs actuellement disponibles pour recalculer `s2_scr_results` avec le nouveau paramétrage

## 4.3 Sélection du `run de travail`

Dans `Actuariat > S2` :

- clic sur un cadre de run = sélection comme référence de travail
- mise en évidence visuelle (fond grisé)
- le paramétrage S2 devient contextuel à ce run (traçabilité affichée)

## 5. Snapshots `S2 réel` (nouveau flux)

## 5.1 Objectif

Produire des snapshots S2 datés à partir des **données constatées** pour alimenter le suivi mensuel solvabilité.

## 5.2 Tables

### `s2_scr_results_real`

Contient le résultat consolidé du snapshot réel :

- `snapshot_date`
- `reference_run_id`
- `own_funds_mode`
- `own_funds_source_used`
- `own_funds_eligible`
- `scr_non_life`, `scr_counterparty`, `scr_market`, `scr_operational`, `scr_total`
- `mcr`
- `solvency_ratio_pct`
- `methodology_version`
- `engine_config_json`
- `calc_scope_json`
- `status`

### `s2_scr_inputs_non_life_real`

Détail des inputs S2 non-vie par branche pour un snapshot réel :

- branche (`id_branch`, `s2_code`, `branch_label`)
- volumes prime / réserve
- expositions CAT / contrepartie
- paramètres / sigma / corrélation (MVP)
- traçabilité de calcul (JSON)

## 5.3 Migration SQL

- `ops/sql/s2_real_snapshots_v1.sql`

Note de compatibilité :

- la colonne `year_month` a été renommée `snapshot_year_month` (problème de compatibilité SQL parseur / mot réservé)

## 5.4 Helper de calcul / persistence

- `src/db/s2RealSnapshots.js`

Exporte :

- `calculateS2RealSnapshot(...)`
- `saveS2RealSnapshot(...)`
- `listS2RealSnapshotsByYear(...)`

## 5.5 Règles de calcul MVP (as-of date)

À date d'arrêté `D` :

- primes : encaissements `<= D`
- sinistres : stock connu à date + règlements `<= D`
- réserves : approche reconstituée MVP (estimé - réglé)
- réassurance/fronting : usage du `run de référence` pour certaines composantes (MVP)
- fonds propres :
  - `auto (manuel > proxy)`
  - `proxy`
  - `manuel`

## 6. UI `Analyse S2 sur données réelles` (Actuariat > S2)

## 6.1 Bloc ajouté

Bloc masquable/affichable (masqué par défaut) dans `Actuariat > S2`, positionné :

- sous `Inputs S2 par branche (run de base)`
- au-dessus de `Paramétrage moteur S2 (placeholder)`

## 6.2 Actions disponibles

- `Calculer (prévisualisation)`
- `Calculer + enregistrer snapshot réel`
- `Générer fins de mois (année)` (batch mensuel)

## 6.3 Endpoints associés

- `POST /api/actuariat/s2-real/calculate`
- `POST /api/actuariat/s2-real/save`
- `POST /api/actuariat/s2-real/generate-monthly`
- `GET /api/actuariat/s2-real/list?year=YYYY`

## 6.4 Batch mensuel - comportement

Le batch génère un snapshot `S2 réel` pour chaque fin de mois de l'année choisie.

Cas standard :

- premier lancement : création des 12 snapshots (si données disponibles)
- relance sans `overwrite` :
  - retour `s2_real_snapshot_exists`
  - attendu (protection anti-écrasement)

## 7. `Pilotage > Solvabilité` - lecture multi-source

## 7.1 Endpoint de page

- `GET /api/pilotage/solvabilite-page-data`

Paramètres :

- `year`
- `source = real | simulation | auto`
- `run_id` (optionnel, pour forcer un run simulation)

## 7.2 Stratégie de fusion (mode `auto`)

- si snapshot `réel` disponible pour une date / mois : priorité au `réel`
- sinon : fallback sur `simulation`

Appliqué à :

- KPI de synthèse
- suivi mensuel
- historique récent

## 7.3 Spécificité date ALM

`alm_v3_daily_snapshots` peut contenir des dates futures (projections ALM).

Pour éviter une lecture trompeuse en vue régulateur :

- `Dernier snapshot ALM` affiché est aligné sur la date du `Dernier snapshot S2` (plutôt que `MAX(business_date)` global)

## 8. Jauges et lecture réglementaire (UI)

## 8.1 Correction des jauges SCR/MCR

Les jauges affichent désormais :

- si couverture OK :
  - `besoin couvert` + `marge`
- si insuffisance :
  - `FP éligibles` + `insuffisance`

Ce changement évite les lectures ambiguës où la marge restait visuellement à `0%`.

## 8.2 Codes couleur utilisés (MVP)

- vert : amélioration / couverture / conformité
- ambre : vigilance
- rouge : insuffisance / dégradation

## 9. Analyse mensuelle des variations (Pilotage > Solvabilité)

## 9.1 Objectif

Expliquer pourquoi le besoin de fonds propres (SCR) et le ratio bougent d'un mois à l'autre.

## 9.2 Inputs utilisés

Le calcul repose sur les snapshots mensuels déjà disponibles (`monthly`), enrichis avec :

- `scr_non_life`
- `scr_counterparty`
- `scr_market`
- `scr_operational`
- `scr_total`
- `own_funds_eligible`
- `solvency_ratio_pct`

## 9.3 Restitution UI (MVP)

Bloc `Variation mensuelle du besoin de fonds propres (SCR)` :

- sélection d'un `mois analysé`
- comparaison `M` vs dernier mois précédent disponible
- KPI de delta (`Δ SCR`, `Δ ratio`)
- waterfall `SCR (M-1 → M)` par composante
- waterfall `ratio SCR (M-1 → M)` :
  - effet `Δ FP`
  - effet `Δ SCR`
- tableau de détail des composantes (`M-1`, `M`, `Delta`, observation)

## 9.4 Limites de l'analyse (MVP)

- décomposition du ratio en 2 effets (`Δ FP`, `Δ SCR`) = explication de pilotage, pas attribution réglementaire normative
- pas de recalcul actuariel détaillé à ce niveau (lecture des snapshots existants)

## 10. Performance / cache

## 10.1 Caches page solvabilité

L'endpoint `/api/pilotage/solvabilite-page-data` utilise un cache mémoire court.

La clé de cache inclut :

- `captive_id`
- `year`
- `source`
- `run_id`

## 10.2 Intérêt

- éviter des relectures SQL répétées lors de navigation UI
- stabiliser la réactivité du tableau de bord et de la page solvabilité

## 11. Limites actuelles / dette technique

## 11.1 Réserves historiques `as-of`

Le calcul `S2 réel` est MVP :

- la reconstitution des réserves est partiellement dérivée (`estimé - réglé`)
- un vrai historique des révisions de réserve améliorerait fortement la qualité des snapshots réels passés

## 11.2 Relance S2 via UI

La relance `Enregistrer + relancer S2` cible actuellement un script de recalcul compatible (`applySimulationReinsuranceV1.js`).

Limite :

- tous les runs ne supportent pas la chaîne complète `claims -> reinsurance -> fronting`

## 11.3 Paramétrage S2 placeholder

Le moteur reste un moteur simplifié / placeholder sur certaines composantes. La trajectoire cible est :

- paramétrage plus fin
- calibration de coefficients
- source robuste des fonds propres éligibles (ALM / finance / bilan économique)

## 12. Fichiers clés (repères)

### UI

- `src/app/actuariat/page.tsx`
- `src/app/pilotage/solvabilite/page.tsx`

### API

- `src/routes/actuariat.js`
- `src/routes/pilotage.js`

### Moteur / calcul

- `src/db/s2EngineConfig.js`
- `src/db/s2RealSnapshots.js`
- `src/db/applySimulationReinsuranceV1.js`

### SQL / migration

- `ops/sql/s2_engine_placeholder_config_v1.sql`
- `ops/sql/s2_real_snapshots_v1.sql`

## 13. Prochaines évolutions recommandées

1. Export CSV du bloc `Variation mensuelle du SCR`
2. Validation métier des snapshots `S2 réel` (`provisoire` / `validé`)
3. Historisation plus fine des réserves/estimés `as-of`
4. Vue de calibration des paramètres S2 placeholder (avec profils par scénario)
5. Lien plus explicite ALM ↔ S2 (source des fonds propres proxy)
