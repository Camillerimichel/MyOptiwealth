# Mode d'emploi ALM / Fonds propres (Captive)

## 1. Objet du document

Ce document décrit la mécanique `ALM / Fonds propres` mise en place dans le projet Captiva :

- ce que fait le module,
- quelles données il utilise,
- comment le paramétrer,
- comment lancer / relancer les calculs,
- comment lire les résultats dans le site,
- quelles sont les limites actuelles.

Il sert de référence de travail avant la prochaine étape : `visualisation détaillée des actifs ALM`.

---

## 2. Périmètre fonctionnel (état actuel)

Le module ALM couvre aujourd’hui 3 niveaux :

1. `ALM Proxy V2` (paramétrable)
- estimation de la durée de détention des fonds propres
- allocation proxy des fonds propres par classes d’actifs et buckets de duration
- fondé sur les résultats ORSA / S2 et les hypothèses de branche

2. `ALM V3 data foundation` (journalier)
- référentiel actifs
- inventaire / positions
- flux passifs quotidiens (primes, sinistres, réassurance, fronting)
- snapshots ALM journaliers
- ladders de liquidité et duration

3. `ALM V3 stress` (branché ORSA, paramétrable)
- runs `BASE / ADVERSE / SEVERE`
- stress journaliers sur flux, liquidité, duration, actifs
- comparaisons fin de période
- drill-down journalier

---

## 3. Accès dans le site

Menu :
- `Pilotage et analyse` -> `ALM / Fonds propres`
- `Pilotage et analyse` -> `Finance ALM / Actifs`

URL :
- `https://captiva-risks.com/actuariat?section=alm`
- `https://captiva-risks.com/actuariat?section=finance`

Cette page centralise :
- paramétrages ALM V2 (proxy)
- résultats ALM V2
- runs ALM V3 journaliers
- comparaison des stress ALM V3
- paramétrages de stress ALM V3
- drill-down journalier
- analyse des actifs ALM (positions / instruments / valorisations / contreparties)

---

## 4. Architecture globale

## 4.1 Flux logique

1. `Simulation portefeuille / sinistres / réassurance / fronting`
2. `ORSA` (BASE / ADVERSE / SEVERE)
3. `ALM Proxy V2` (assiette fonds propres + durations cibles)
4. `ALM V3` :
- seed actifs / inventaire
- flux passifs quotidiens depuis le cœur métier
- snapshots journaliers
- stress journaliers (adverse / severe)
5. `Visualisation ALM` dans `/actuariat?section=alm`

## 4.2 Deux couches ALM complémentaires

### A. ALM Proxy V2 (rapide, paramétrable)
Usage :
- cadrage comité / risk / CFO
- calibration grossière des durations et allocations
- estimation de détention des fonds propres

### B. ALM V3 (journalier, plus fin)
Usage :
- lecture de liquidité et duration dans le temps
- stress journaliers
- drill-down par date / run

---

## 5. Tables de données (vue d’ensemble)

## 5.1 Tables ALM Proxy V2

Créées par :
- `ops/sql/alm_proxy_v2.sql`

Principales tables :
- `alm_v2_configs`
- `alm_v2_duration_buckets`
- `alm_v2_asset_classes`
- `alm_v2_allocation_lines`
- `alm_v2_branch_assumptions`
- `alm_v2_results`
- `alm_v2_result_asset_classes`
- `alm_v2_result_duration_buckets`

Rôle :
- configuration editable
- résultats de calcul proxy persistés

## 5.2 Tables ALM V3 (fondation journalière)

Créées par :
- `ops/sql/alm_data_foundation_v3.sql`

### Référentiel
- `alm_v3_profiles`
- `alm_v3_strata`
- `alm_v3_asset_classes`
- `alm_v3_duration_buckets`
- `alm_v3_counterparties`
- `alm_v3_instruments`
- `alm_v3_cash_accounts`

### Inventaire / valorisations
- `alm_v3_positions`
- `alm_v3_position_lots`
- `alm_v3_position_valuations_daily`

### Flux
- `alm_v3_asset_cashflows`
- `alm_v3_cash_movements`
- `alm_v3_cash_balances_daily`
- `alm_v3_liability_cashflows_daily`

### Runs / snapshots
- `alm_v3_orsa_links`
- `alm_v3_runs`
- `alm_v3_daily_snapshots`
- `alm_v3_daily_strata_snapshots`
- `alm_v3_daily_asset_class_snapshots`
- `alm_v3_daily_duration_ladder`
- `alm_v3_daily_liquidity_ladder`
- `alm_v3_run_checks`

## 5.3 Tables ALM V3 stress (V6)

Créées par :
- `ops/sql/alm_v3_stress_config_v6.sql`

Tables :
- `alm_v3_stress_scenarios`
- `alm_v3_stress_asset_class_shocks`

Rôle :
- paramétrage des stress ALM journaliers (globaux + par classe d’actifs)

## 5.4 Seuils d’alerte (V6.1)

Ajoutés sur :
- `alm_v3_profiles`

Colonnes :
- `liq_alert_tension_threshold_eur`
- `liq_alert_vigilance_threshold_eur`
- `duration_alert_vigilance_abs_years`
- `duration_alert_tension_abs_years`

DDL :
- `ops/sql/alm_v3_alert_thresholds_v61.sql`

Rôle :
- piloter les couleurs / alertes dans les tableaux ALM

---

## 6. Sources de données métier utilisées par l’ALM

L’ALM V3 s’alimente à partir de la base métier/simulation existante.

Sources principales :
- `contract_premium_payments` (encaissements de primes)
- `reglements` (paiements sinistres)
- `reinsurance_premium_cessions` (primes de réassurance)
- `reinsurance_claim_cessions` (recoveries / cessions de sinistres)
- `fronting_run_adjustments` (frais de fronting / claims handling)

Important :
- les flux ALM sont `horodatés quotidiennement`
- les longues traînes (sinistres) peuvent dépasser l’année de contrat

---

## 7. Scripts ALM (opérationnels)

## 7.1 Seed / référentiel / inventaire

### `src/db/seedAlmV3Foundation.js`
Fonctions :
- crée le profil ALM V3 par défaut (`ALM_V3_DEFAULT`)
- seed les strates, classes d’actifs, buckets, contreparties, comptes cash
- crée des instruments / positions / lots
- seed une valorisation initiale
- crée le lien ORSA ↔ ALM

Exemple :
```bash
node src/db/seedAlmV3Foundation.js --business-date 2026-12-31
```

## 7.2 Flux passifs quotidiens

### `src/db/buildAlmV3LiabilityCashflowsFromCore.js`
Fonctions :
- reconstruit les flux passifs quotidiens ALM depuis les tables métier
- alimente :
  - `alm_v3_liability_cashflows_daily`
  - `alm_v3_cash_movements`

Exemple :
```bash
node src/db/buildAlmV3LiabilityCashflowsFromCore.js --profile-code ALM_V3_DEFAULT --date-from 2026-01-01 --date-to 2026-12-31
```

## 7.3 Valorisations quotidiennes d’actifs (simulées)

### `src/db/generateAlmV3DailyMarketValuations.js`
Fonctions :
- génère des prix / MV / duration / YTM journaliers simulés
- alimente `alm_v3_position_valuations_daily`

Exemple :
```bash
node src/db/generateAlmV3DailyMarketValuations.js --profile-code ALM_V3_DEFAULT --date-from 2026-01-01 --date-to 2026-12-31 --base-date 2026-12-31
```

## 7.4 Snapshots journaliers ALM

### `src/db/runAlmV3DailySnapshots.js`
Fonctions :
- calcule les snapshots journaliers
- calcule duration ladder / liquidity ladder
- stocke les agrégats journaliers

Exemple :
```bash
node src/db/runAlmV3DailySnapshots.js --profile-code ALM_V3_DEFAULT --date-from 2026-01-01 --date-to 2026-12-31 --run-code ALM_DAILY_2026_V1
```

## 7.5 Stress ALM journaliers

### `src/db/runAlmV3StressScenarios.js`
Fonctions :
- lit ORSA + paramètres ALM stress V6
- clone le run ALM `BASE`
- génère les runs `ADVERSE` / `SEVERE`
- applique les stress sur :
  - flux passifs
  - liquidité par horizon
  - actifs par classe
  - durations

Exemple :
```bash
node src/db/runAlmV3StressScenarios.js --profile-code ALM_V3_DEFAULT --base-run-code ALM_DAILY_2026_V1
```

## 7.6 Rebascule de millésime (si besoin)

### `src/db/rebaseSimulationCashflowDatesYear.js`
Fonctions :
- rebascule les dates de flux de simulation (ex. 2028 -> 2026)
- permet de réaligner les flux ALM sur l’année de travail

---

## 8. API ALM (site)

Fichier :
- `src/routes/actuariat.js`

## 8.1 Lecture

### `GET /api/actuariat/alm-proxy`
Retourne :
- ALM Proxy V2 (configs + résultats)
- ALM V3 runs + comparaisons + time series
- paramètres de stress ALM V3
- seuils d’alerte ALM V3
- drill-down journalier (si `run/date` fournis)
- payload `Finance ALM / Actifs` (KPIs, positions, historique, détail position)

Paramètres utiles :
- `orsa_set_id`
- `alm_v3_run_id`
- `alm_v3_date`
- `finance_business_date`
- `finance_asset_code`
- `finance_strata_code`
- `finance_counterparty_id`
- `finance_position_id`

## 8.2 Sauvegarde paramétrages proxy / stress

### `PUT /api/actuariat/alm-proxy/config`
Met à jour :
- allocations d’actifs V2
- hypothèses de détention par branche V2

### `PUT /api/actuariat/alm-proxy/stress-config`
Met à jour :
- paramètres de stress ALM V3 (globaux)
- chocs par classe d’actifs
- seuils d’alerte ALM V3 (`liq`, `duration`)

## 8.3 Recalculs / exécution

### `POST /api/actuariat/alm-proxy/recompute`
Recalcule :
- ALM Proxy V2

### `POST /api/actuariat/alm-proxy/rerun-v3-stress`
Relance :
- moteur de stress ALM V3 (ADVERSE / SEVERE)

Retourne :
- payload ALM rafraîchi
- `rerun_result` (durée, résumé, stdout/stderr)

---

## 9. Mode d’emploi dans l’interface (pas à pas)

## 9.1 Pré-requis

Avant d’utiliser `ALM / Fonds propres`, vérifier :
- un `set ORSA` disponible
- des runs ORSA `BASE/ADVERSE/SEVERE`
- des données ALM V3 (seed + flux + snapshots)

Si ce n’est pas le cas :
1. seed ALM V3
2. construire les flux passifs
3. générer les valorisations journalières
4. lancer les snapshots journaliers
5. lancer les stress ALM

## 9.2 Lecture des blocs (ordre conseillé)

1. `KPI ALM`
- Set ORSA
- SCR peak ORSA
- durée de détention pondérée
- duration actifs / besoin de liquidité court terme

2. `Paramétrages ALM V2`
- allocations d’actifs
- hypothèses de détention par branche
- `Enregistrer` puis `Recalculer`

3. `Résultats proxy V2`
- par classe d’actifs
- par bucket de duration

4. `Runs ALM V3`
- vérifier présence du run `daily_snapshot`
- vérifier runs stress `ADVERSE/SEVERE`

5. `Comparaison ALM stress (fin de période)`
- lecture rapide des stress
- colonnes `Statut`, `Alerte liq`, `Alerte duration`

6. `Stress ALM V3 (paramétrables)`
- ajuster les multiplicateurs
- ajuster les chocs par classe d’actifs
- ajuster les seuils d’alerte
- `Enregistrer stress ALM V3`
- `Rejouer stress ALM V3`

7. `Rejouement stress ALM V3` (bloc vert)
- vérifier durée d’exécution
- vérifier runs touchés
- lire alertes et gaps
- `Copier le résumé` (partage comité)
- consulter `stdout/stderr` si besoin

8. `Drill-down journalier ALM V3`
- choisir `run`
- choisir `date`
- `Charger le détail`
- analyser :
  - snapshot du jour
  - ladder liquidité
  - ladder duration
  - classes d’actifs
  - strates ALM

9. `Finance ALM / Actifs` (onglet dédié)
- filtrer par `date`, `classe d’actifs`, `strate`, `contrepartie`
- lire les KPI (`MV`, `BV`, `P&L latent`, `duration modifiée pondérée`)
- analyser le tableau des positions (snapshot)
- cliquer une position pour ouvrir :
  - fiche instrument / position
  - lots
  - historique de valorisation (MV / duration)

---

## 10. Paramétrages ALM V3 stress : explication des champs

## 10.1 Paramètres globaux (par stress)

### `Inflows x`
Multiplie les encaissements passifs (primes, recoveries, etc.).

### `Outflows x`
Multiplie les décaissements passifs (sinistres, réassurance, fronting, etc.).

### `Src D1 / D7 / D30`
Multiplie les `sources de liquidité` par horizon :
- `D1` : 1 jour
- `D7` : 7 jours
- `D30` : 30 jours

### `Uses D1 / D7 / D30`
Multiplie les `usages / besoins de liquidité` par horizon.

### `ΔDur actifs`
Décalage appliqué à la duration des actifs (proxy).

### `Dur passif x`
Multiplicateur appliqué à la duration du passif proxy.

### `Cash floor (% actifs)`
Plancher optionnel appliqué au cash stressé (en `%` des actifs), pour borner la trésorerie minimale du scénario.

### `Own funds x`
Multiplicateur appliqué aux `fonds propres` utilisés dans le stress ALM (cohérence avec les hypothèses de solvabilité).

### `S2 x`
Multiplicateur appliqué au niveau de charge / besoin de capital `S2` utilisé par le moteur de stress.

### `CAT x`
Multiplicateur appliqué à la composante catastrophe (Property/CAT) utilisée dans le stress ALM.

### `cash négatif` / `buffer négatif`
Autorise (ou non) des valeurs négatives en stress sur :
- cash
- buffer de liquidité

Usage :
- `ON` : stress plus “réaliste / brutal”
- `OFF` : stress plus “borné / prudent”

## 10.2 Chocs par classe d’actifs

Par couple `(stress, classe d’actifs)` :

### `MV x`
Multiplicateur de valeur de marché.

### `Δ Duration`
Décalage de duration spécifique à la classe.

### `Src liq D1/D7/D30`
Dégrade (ou améliore) la mobilisabilité de cette classe d’actifs dans les ladders de liquidité.

### `Actif`
Permet de neutraliser temporairement un choc sans supprimer la ligne.

---

## 11. Seuils d’alerte (couleurs) : logique

## 11.1 Alerte liquidité (`Min gap liq`)

Basée sur le plus faible gap parmi :
- `D1`
- `D7`
- `D30`

Logique :
- `Tension` si `min_gap_liq < seuil_tension`
- `Vigilance` si `min_gap_liq < seuil_vigilance`
- `Confort` sinon

Exemple par défaut :
- seuil tension = `0 EUR`
- seuil vigilance = `500 000 EUR`

## 11.2 Alerte duration (`Avg duration gap`)

Basée sur la valeur absolue de `avg duration gap`.

Logique :
- `Écart fort` si `|gap| > seuil_tension`
- `À surveiller` si `|gap| > seuil_vigilance`
- `Acceptable` sinon

Exemple par défaut :
- vigilance = `3 ans`
- tension = `5 ans`

---

## 12. Interprétation des indicateurs ALM

## 12.1 `Duration gap`

Définition :
- `duration actifs - duration passif proxy`

Lecture :
- trop négatif : actifs trop courts vs passifs
- trop positif : actifs trop longs / immobilisation potentiellement excessive

## 12.2 `Liquidity need 30d`

Besoin de liquidité à 30 jours.

À comparer avec :
- `liquidity_buffer_available`
- `cash`
- ladders D1/D7/D30

## 12.3 `Min gap liq`

Signal de stress de liquidité.

Lecture :
- positif : marge disponible
- proche de zéro : zone de vigilance
- négatif : tension (besoin > sources)

## 12.4 `Avg duration gap`

Indicateur de mismatch structurel (sur le run / stress).

Lecture :
- stable et modéré : adossement plus cohérent
- amplitude forte : mismatch structurel ou stress trop sévère

---

## 13. Workflow comité (recommandé)

## 13.1 Préparation

1. Vérifier set ORSA sélectionné
2. Vérifier runs ALM V3 (`BASE/ADVERSE/SEVERE`)
3. Vérifier seuils d’alerte (cohérents avec l’appétence au risque)

## 13.2 Lecture rapide

1. `Comparaison ALM stress (fin de période)`
2. Identifier `Statut`, `Alerte liq`, `Alerte duration`
3. Ouvrir `Drill-down` sur la date la plus critique

## 13.3 Partage

1. Lancer `Rejouer stress ALM V3` si changement de paramétrage
2. Cliquer `Copier le résumé`
3. Coller dans compte-rendu / mail / note comité

---

## 14. Limitations actuelles (à connaître)

1. `Valorisations d’actifs` :
- encore simulées (pas de market data réelle / courbes de taux complètes)

2. `Duration passif` :
- proxy ALM (pas un moteur actuariel complet de cash-flow passif)

3. `Stress ALM` :
- mélange ORSA + paramètres ALM V3
- puissant pour pilotage, mais pas encore ALM de marché complet

4. `Alertes couleurs` :
- heuristiques paramétrables (pas des limites réglementaires en soi)

---

## 15. Dépannage (problèmes fréquents)

## 15.1 Je ne vois pas les alertes / statuts

Regarder le tableau :
- `Comparaison ALM stress (fin de période)`

Ce tableau est permanent (contrairement au bloc temporaire du rejouement).

## 15.2 Le bloc de rejouement n’apparaît pas

Il apparaît seulement après clic sur :
- `Rejouer stress ALM V3`

## 15.3 Les données ALM semblent vides

Vérifier l’ordre d’exécution :
1. seed ALM V3
2. flux passifs quotidiens
3. valorisations quotidiennes
4. snapshots ALM journaliers
5. stress ALM

## 15.4 L’année ne correspond pas

Vérifier le millésime des flux source :
- utiliser `rebaseSimulationCashflowDatesYear.js` si nécessaire

---

## 16. Évolutions récentes et prochaine étape

Évolutions récentes intégrées :
- `Finance ALM / Actifs` (onglet dédié dans `actuariat`)
- filtres de lecture finance (`date`, `classe`, `strate`, `contrepartie`, `position`)
- KPIs finance (MV/BV/P&L latent/duration pondérée)
- détail position (instrument, lots, historique de valorisation)

Prochaine brique prioritaire (désormais) :
- enrichir la traçabilité entre `stress ALM` et `positions/instruments` impactés

Objectif :
- expliquer plus directement l’effet d’un choc par classe d’actifs sur les positions réelles
- faciliter la lecture comité (du paramétrage stress vers l’impact portefeuille)
