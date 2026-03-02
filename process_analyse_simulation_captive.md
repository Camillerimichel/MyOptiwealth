# Process d'analyse - Simulation captive (réutilisable)

## Objectif

Ce document sert de **mode opératoire** pour rejouer et analyser une simulation captive avec l'assistant, à partir de la base locale (`captiva`) et des scripts déjà créés dans `src/db/` et `ops/sql/`.

Il permet de :

- reconstruire un jeu de simulation (portefeuille + sinistres + réassurance + S2),
- enrichir avec concentration CAT géographique,
- produire des runs ORSA comparatifs,
- exporter des livrables (JSON / CSV / pack comité Markdown),
- itérer sur les hypothèses avec l'assistant.

## 1. Pré-requis

- Base MySQL locale accessible (`.env` configuré)
- Schéma applicatif déjà présent (`src/db/migrate.js`)
- Scripts de simulation disponibles dans `src/db/`
- Scripts SQL de support dans `ops/sql/`

## 2. Vue d'ensemble du pipeline

Ordre recommandé :

1. Créer les tables d'extension simulation
2. Bootstrap scénario / run
3. Générer portefeuille synthétique
4. Générer sinistres + réserves
5. Appliquer réassurance (QS)
6. Enrichir CAT + XoL + Stop Loss
7. Calculer concentration CAT géographique
8. Recalculer S2 avec CAT géographique
9. Générer ORSA (BASE/ADVERSE/SEVERE)
10. Exporter les rapports (SQL / JSON / CSV / Markdown)

## 3. Scripts et rôle

### Schémas SQL

- `ops/sql/simulation_schema_v1.sql`
  - tables d'extension simulation (runs, primes, réserves, réassurance, S2, snapshots)
- `ops/sql/simulation_geo_cat_v2.sql`
  - tables géographiques / concentration CAT
- `ops/sql/simulation_orsa_v1.sql`
  - tables de sets ORSA et comparaison inter-runs
- `ops/sql/simulation_run_report_v1.sql`
  - report SQL consolidé d'un `run_id`

### Scripts Node (simulation)

- `src/db/populateSimulationV1.js`
  - bootstrap scénario + run + paramètres de base
- `src/db/generateSimulationPortfolioV1.js`
  - génère courtiers, clients, contrats, couvertures, primes, snapshots initiaux
- `src/db/generateSimulationClaimsV1.js`
  - génère sinistres, paiements, réserves + met à jour snapshots et S2 placeholder
- `src/db/applySimulationReinsuranceV1.js`
  - applique QS (primes + sinistres) + recalcul net/S2 placeholder
- `src/db/enhanceSimulationRunV2.js`
  - ajoute CAT events Property + XoL + Stop Loss + recalcul net/S2
- `src/db/buildCatConcentrationV1.js`
  - construit expositions géographiques Property + concentration CAT
- `src/db/recomputeS2FromGeoCatV1.js`
  - recalcule `cat_exposure` S2 depuis la concentration géographique

### Scripts Node (ORSA / reporting)

- `src/db/seedOrsaStressParametersV1.js`
  - injecte des profils de stress ORSA dans `simulation_parameters`
- `src/db/generateOrsaStressRunsV1.js`
  - crée les runs ORSA (`BASE/ADVERSE/SEVERE`) et la table de comparaison
- `src/db/exportOrsaSetReportV1.js`
  - export JSON/CSV d'un set ORSA
- `src/db/exportOrsaCommitteePackV1.js`
  - export pack comité ORSA en Markdown

## 4. Process standard (exécution complète)

## A. Mise en place du schéma extension

```bash
mysql -h 127.0.0.1 -u captiva -p... captiva < ops/sql/simulation_schema_v1.sql
mysql -h 127.0.0.1 -u captiva -p... captiva < ops/sql/simulation_geo_cat_v2.sql
mysql -h 127.0.0.1 -u captiva -p... captiva < ops/sql/simulation_orsa_v1.sql
```

## B. Bootstrap scénario

```bash
node src/db/populateSimulationV1.js --scenario SIM_CAPTIVE_2028_BASE --year 2028 --run bootstrap-v1
```

Résultat attendu :

- `simulation_scenarios` alimenté
- `simulation_runs` (bootstrap)
- `simulation_parameters` (hypothèses initiales)

## C. Génération portefeuille

```bash
node src/db/generateSimulationPortfolioV1.js --scenario SIM_CAPTIVE_2028_BASE --run portfolio-v1-full --seed 20280223
```

Résultat attendu (cible V1) :

- ~`1 100` courtiers
- ~`85 000` clients
- ~`250 000` contrats
- `GWP = 208 M€`

## D. Sinistres / réserves

```bash
node src/db/generateSimulationClaimsV1.js --scenario-id 1 --run-id 3 --snapshot-date 2028-12-31
```

Résultat :

- `sinistres`, `sinistre_lignes`, `reglements`
- `claim_reserve_snapshots`
- mise à jour `portfolio_*` et `s2_scr_*`

## E. Réassurance V1 (QS)

```bash
node src/db/applySimulationReinsuranceV1.js --scenario-id 1 --run-id 3 --snapshot-date 2028-12-31
```

Résultat :

- `reinsurance_treaties`
- `reinsurance_premium_cessions`
- `reinsurance_claim_cessions`
- mise à jour net + S2

## F. Enrichissement V2 (CAT + XoL + Stop Loss)

```bash
node src/db/enhanceSimulationRunV2.js --scenario-id 1 --run-id 3 --snapshot-date 2028-12-31
```

Résultat :

- `cat_events`
- sinistres CAT Property supplémentaires
- traités `XOL` / `STOP_LOSS`
- recalcul net et S2

## G. Concentration CAT géographique

```bash
node src/db/buildCatConcentrationV1.js --scenario-id 1 --run-id 3 --snapshot-date 2028-12-31
```

Résultat :

- `geo_zones`
- `contract_geo_exposures`
- `cat_event_zone_impacts`
- `cat_concentration_snapshots`

## H. Recalcul S2 depuis CAT géographique

```bash
node src/db/recomputeS2FromGeoCatV1.js --scenario-id 1 --run-id 3 --snapshot-date 2028-12-31
```

Résultat :

- `s2_scr_inputs_non_life.cat_exposure` Property recalculé via géographie
- `s2_scr_results` mis à jour (`methodology_version = v3-geo-cat-s2-placeholder`)

## I. ORSA (paramètres + runs + comparaison)

1. Seed paramètres ORSA :

```bash
node src/db/seedOrsaStressParametersV1.js --scenario-id 1
```

2. Générer set ORSA :

```bash
node src/db/generateOrsaStressRunsV1.js \
  --scenario-id 1 \
  --base-run-id 3 \
  --snapshot-date 2028-12-31 \
  --orsa-code ORSA_2028_SET2_PARAM \
  --orsa-name "ORSA 2028 Parametrized"
```

Remarque :

- Par défaut, les runs ORSA dérivés sont maintenant **isolés par `orsa-code`** dans le label de run.
- Utiliser `--reuse-existing-runs` seulement si on veut réutiliser des runs existants.

## J. Exports / livrables

### Report SQL run complet

```bash
mysql -h 127.0.0.1 -u captiva -p... captiva -e "SET @run_id := 3; SET @snapshot_date := '2028-12-31'; SOURCE ops/sql/simulation_run_report_v1.sql;"
```

### Export ORSA JSON/CSV

```bash
node src/db/exportOrsaSetReportV1.js --orsa-set-id 2 --out-dir /tmp
```

### Pack comité ORSA (Markdown)

```bash
node src/db/exportOrsaCommitteePackV1.js --orsa-set-id 2 --out-dir /tmp
```

## 5. Comment utiliser ce process avec l'assistant (workflow de collaboration)

Quand vous revenez pour une analyse, donner :

- `scenario_id` / `scenario_code`
- `run_id` (ou `orsa_set_id`)
- `snapshot_date`
- objectif (ex. stress CAT, optimisation réassurance, comité, S2, ORSA)

Exemples de demandes utiles :

- "Compare le run 3 et le run ORSA adverse sur la branche Property"
- "Propose une optimisation de QS/XoL pour remonter le ratio de solvabilité > 35%"
- "Régénère un scénario severe avec CAT plus concentré sur PACA/OCC"
- "Prépare une synthèse comité avec focus PI/Medical capital intensive"

## 6. Checklist d'analyse (à suivre avec l'assistant)

Avant de conclure une analyse :

- Volumes conformes (`courtiers`, `clients`, `contrats`, `GWP`)
- Branches conformes (répartition GWP)
- Sinistres cohérents (paid / incurred / RBNS / IBNR)
- Réassurance cohérente (brut vs net, cessions par traité)
- CAT géographique cohérent (zones, exposition pondérée, HHI)
- S2 cohérent (cat exposure, SCR, MCR, ratio)
- ORSA comparatif lisible (BASE / ADVERSE / SEVERE + deltas)

## 7. Limites actuelles (important)

Cette base est **très utile pour cadrage et simulation quasi réelle**, mais ce n'est pas encore :

- un modèle actuariel réglementaire complet,
- un calcul SCR standard formula exact,
- un ORSA exhaustif au niveau sinistre individuel re-simulé sur tous les runs.

Actuellement :

- plusieurs modules sont des **placeholders calibrés**,
- l'ORSA V1 est **agrégé** (stress sur snapshots),
- les stress par branche détaillés restent à implémenter.

## 8. Prochaines améliorations possibles (backlog)

1. Stress ORSA par branche (`motor/pi/medical/property`)
2. ORSA semi-granulaire (recalcul branch snapshots piloté par paramètres)
3. Génération multi-run automatisée (batch ORSA)
4. Export HTML/PDF du pack comité
5. Paramètres de concentration CAT par zone dans `simulation_parameters`
6. Réassurance avancée (XoL multi-couches, reinstatements, aggregate XL)

