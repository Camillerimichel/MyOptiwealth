# Moteurs de simulation et paramètres utilisés

## Objectif

Ce document explique le fonctionnement des principaux moteurs de simulation CAPTIVA et la logique de paramétrage associée.

Il sert de guide de lecture pour :

- comprendre la chaîne de calcul
- identifier où se règlent les hypothèses
- savoir ce qui est `réel`, `simulation`, `placeholder`
- faciliter les échanges entre métier, actuariat et technique

## 1. Vue d'ensemble de la chaîne

CAPTIVA utilise plusieurs moteurs / scripts qui se complètent :

- **Simulation sinistres**
- **Réassurance**
- **Fronting**
- **S2 / solvabilité (placeholder / ORSA)**
- **ALM / liquidité / actifs**
- **Exports / reporting comité**

Ces moteurs ne sont pas tous lancés en même temps. Selon le besoin, on rejoue :

- un run complet
- une étape spécifique
- un recalcul partiel (ex. S2 après changement de paramétrage)

## 2. Principe général de paramétrage

Les paramètres peuvent venir de plusieurs sources :

- tables de configuration (`simulation_parameters`, profils ALM, stress config)
- paramètres de script (CLI)
- données de run/scénario
- valeurs de fallback (par défaut)

## 2.1 Règle de lecture recommandée

Toujours distinguer :

- **paramètre métier** (hypothèse de gestion / risque)
- **paramètre technique** (performance, batch, options d'écrasement)
- **fallback** (valeur par défaut si rien n'est fourni)

## 2.2 Règle de gouvernance

Quand un résultat est utilisé pour pilotage/régulateur :

- tracer la version de paramétrage utilisée
- tracer la méthode (`methodology_version`)
- tracer la source (`réel` vs `simulation`)

## 3. Moteur de simulation sinistres

## 3.1 Finalité

Produire / enrichir des runs de sinistralité simulée et alimenter les calculs en aval :

- projections sinistres
- impacts S2
- analyses ORSA

## 3.2 Script(s) repères

- `src/db/generateSimulationClaimsV1.js`

## 3.3 Paramètres typiques

- volumes / expositions par branche
- fréquences / sévérités (selon implémentation du run)
- paramètres de calcul S2 placeholder (via config centrale, voir section 6)

## 3.4 Sorties utiles

- données de run de sinistres
- composantes utilisées ensuite par réassurance / S2

## 4. Moteur réassurance

## 4.1 Finalité

Appliquer les effets de réassurance sur les runs :

- cessions de primes
- recoveries sur sinistres
- risque de contrepartie
- impacts sur S2

## 4.2 Script(s) repères

- `src/db/applySimulationReinsuranceV1.js`

## 4.3 Paramètres typiques

- traités / termes de réassurance
- paramètres S2 placeholder `reinsurance_v1`
  - `cat_charge_factor`
  - `counterparty_charge_factor`
  - `nonlife_multiplier`
  - `operational_fixed_eur`

## 4.4 Particularité actuelle

Ce script est aussi utilisé comme **recalcul S2 fiable** depuis l'UI `Actuariat > S2` quand on clique :

- `Enregistrer + relancer S2 (run de travail)`

## 5. Moteur fronting

## 5.1 Finalité

Intégrer les coûts et ajustements économiques du fronting :

- frais de fronting
- frais de gestion sinistres
- expositions contrepartie
- impacts S2 (placeholder V2)

## 5.2 Script(s) repères

- `src/db/applyFrontingMotorRunV1.js`
- `src/db/applyFrontingMotorRunV2.js`

## 5.3 Données / tables associées

- `fronting_programs`
- `fronting_run_adjustments`
- `fronting_run_counterparty_allocations`

## 5.4 Paramètres S2 placeholder `fronting_v2`

- `cat_charge_factor`
- `counterparty_charge_factor`
- `nonlife_multiplier`
- `operational_fixed_eur`

## 6. Moteur S2 / Solvabilité (placeholder) et ORSA

## 6.1 Finalité

Calculer des indicateurs de solvabilité simplifiés (MVP / placeholder) :

- `SCR`
- `MCR`
- `Fonds propres éligibles`
- `Ratio de solvabilité`

Puis appliquer des stress ORSA sur ces grandeurs.

## 6.2 Tables de résultats

### Simulation

- `s2_scr_results`

### Réel (snapshots datés)

- `s2_scr_results_real`
- `s2_scr_inputs_non_life_real`

## 6.3 Paramétrage centralisé S2 (V1.1)

Le paramétrage placeholder S2 est centralisé via :

- `src/db/s2EngineConfig.js`
- source : `simulation_parameters`
- clé : `parameter_group='s2'`, `parameter_key='engine_placeholder_config_v1'`

## 6.4 Paramètres principaux

### Fonds propres / MCR

- `own_funds_eligible_base_eur`
- `mcr_eur`

### Modules placeholder (par étape)

- `claims_v1`
- `reinsurance_v1`
- `cat_xol_v2`
- `fronting_v2`

Chaque module expose typiquement :

- coefficients de charge CAT / contrepartie
- multiplicateur non-vie
- charge opérationnelle fixe

## 6.5 ORSA (stress)

Le moteur ORSA applique des stress sur un run/base de solvabilité :

- stress de charges
- multiplicateurs de fonds propres
- scénarios `BASE`, `ADVERSE`, `SEVERE`, etc.

Script repère :

- `src/db/generateOrsaStressRunsV1.js`

## 6.6 Important (lecture métier)

Le moteur actuel est **partiellement placeholder** :

- utile pour pilotage/scénarios/analyses
- à calibrer avant usage régulateur strict

## 7. Moteur ALM (actifs / passifs / liquidité)

## 7.1 Finalité

Produire des snapshots ALM journaliers et analyses de pilotage :

- cash / flux
- expositions actifs
- durations
- gaps de liquidité
- stress ALM

## 7.2 Scripts repères

- `src/db/runAlmV3DailySnapshots.js`
- `src/db/generateAlmV3DailyMarketValuations.js`
- `src/db/buildAlmV3LiabilityCashflowsFromCore.js`

## 7.3 Tables / profils

- `alm_v3_profiles`
- `alm_v3_daily_snapshots`
- `alm_v3_position_valuations_daily`
- tables de cashflows / positions / instruments

## 7.4 Paramétrage ALM

- profil ALM (`alm_v3_profiles`)
- stress globaux / chocs par classe d'actifs
  - `alm_v3_stress_scenarios`
  - `alm_v3_stress_asset_class_shocks`
- seuils d'alerte ALM (sur profils)

## 8. Moteur "S2 réel" (as-of date) - usage de pilotage

## 8.1 Finalité

Construire des snapshots S2 datés à partir des données constatées pour alimenter :

- `Pilotage > Solvabilité`
- suivi mensuel
- analyses de variations

## 8.2 Helper / calcul

- `src/db/s2RealSnapshots.js`

Fonctions :

- `calculateS2RealSnapshot`
- `saveS2RealSnapshot`
- `listS2RealSnapshotsByYear`

## 8.3 Paramètres du calcul `S2 réel`

Dans `Actuariat > S2` :

- `Date d'analyse`
- `Mode fonds propres`
  - `Auto (manuel > proxy)`
  - `Proxy`
  - `Manuel`
- `Own funds manuel` (si manuel)
- `run S2 de référence` (méthodologie / traçabilité)
- `Écraser snapshot réel existant`

## 8.4 Batch mensuel

Le batch `Générer fins de mois (année)` produit automatiquement les snapshots S2 réels de chaque fin de mois.

## 9. Paramètres exposés dans l'UI (actuellement)

## 9.1 `Actuariat > S2`

- sélection de run de travail
- `Inputs S2 par branche`
- `Paramétrage moteur S2 (placeholder)`
- `Analyse S2 sur données réelles`

## 9.2 `Pilotage > Solvabilité`

- `Source` (`Réel`, `Simulation`, `Auto`)
- `Année`
- `Run S2` (pour la vue simulation)

## 10. Comment interpréter les paramètres (méthode pratique)

## 10.1 Paramètres de fonds propres

Question à se poser :

- la valeur vient-elle d'un **proxy**, d'une **saisie manuelle**, ou d'une **hypothèse de simulation** ?

Impact :

- ils pilotent directement le `ratio SCR`

## 10.2 Paramètres de charges / multiplicateurs S2

Question à se poser :

- ces coefficients sont-ils des placeholders de démonstration, ou des calibrages validés ?

Impact :

- ils pilotent fortement le niveau de `SCR`

## 10.3 Paramètres de date / périmètre

Question à se poser :

- parle-t-on d'un `as-of` réel (constaté) ou d'un run de simulation ?

Impact :

- mélange possible de lectures si la source n'est pas explicitée

## 11. Bonnes pratiques de pilotage

1. Toujours afficher la source (`réel` / `simulation`)
2. Tracer le `run` et la `methodology_version`
3. Stabiliser un `run de référence` pour les comparaisons
4. Valider les paramètres S2 avant comité
5. Distinguer clairement :
   - réglage moteur
   - recalcul
   - lecture de pilotage

## 12. Limites et vigilance

- certains moteurs restent en logique `placeholder`
- tous les runs ne supportent pas toute la chaîne (claims → reinsurance → fronting)
- les réserves `as-of` réelles sont en mode MVP (reconstitution partielle)
- les interprétations régulateur doivent être faites avec méthode et traçabilité

## 13. Repères techniques (fichiers)

### Paramétrage / S2

- `src/db/s2EngineConfig.js`
- `src/db/s2RealSnapshots.js`
- `ops/sql/s2_engine_placeholder_config_v1.sql`
- `ops/sql/s2_real_snapshots_v1.sql`

### Moteurs

- `src/db/generateSimulationClaimsV1.js`
- `src/db/applySimulationReinsuranceV1.js`
- `src/db/applyFrontingMotorRunV2.js`
- `src/db/generateOrsaStressRunsV1.js`
- `src/db/runAlmV3DailySnapshots.js`

### Interfaces

- `src/app/actuariat/page.tsx`
- `src/app/pilotage/solvabilite/page.tsx`
- `src/routes/actuariat.js`
- `src/routes/pilotage.js`

## 14. Suites recommandées

1. Documenter les jeux de paramètres "validés" par scénario
2. Versionner explicitement les calibrages métier
3. Ajouter exports (CSV/PDF) des analyses de variations mensuelles
4. Renforcer l'historique des réserves pour un `S2 réel` plus précis
