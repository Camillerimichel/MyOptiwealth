# TODO Base de simulation captive (quasi réelle)

## Objectif

Construire une base de données **de simulation** capable de supporter :

- le portefeuille cible 2028 (208 MEUR, ~85k clients, ~250k contrats, ~1k courtiers),
- la simulation de sinistralité (dont long-tail PI / Medical),
- la réassurance (QS / XL / Stop Loss),
- des agrégats de pilotage et de solvabilité (S2 simplifié / ORSA-like),
- plusieurs scénarios rejouables (`scenario_id`, `run_id`).

La base doit être **cohérente avec l’existant** (tables déjà présentes dans `src/db/migrate.js`) et étendue de manière progressive.

## 1. Ce qui existe déjà (à réutiliser)

### Référentiels / gouvernance

- `captives`
- `users`, `roles`, `users_roles`, `user_captive_memberships`
- `audit_trail`, `jobs`, `report_jobs`, `report_templates`

### Programmes / branches / règles captive

- `programmes` (programme métier existant)
- `insurance_branch` (branches S2 / captive)
- `insurance_branch_category`, `insurance_branch_category_map`
- `captive_branch_policy`
- `branch_risk_parameters`
- `branch_reinsurance_rules`
- `insurance_program`, `program_branch_map`
- `branch_capital_parameters`

### Réseau / portefeuille

- `partners` (à utiliser comme **courtiers / distributeurs** dans la simulation)
- `partner_programme`
- `clients`
- `contracts`
- `contract_premium_terms`
- `contract_premium_payments`

### Sinistres

- `sinistres`
- `sinistre_lignes`
- `reglements`

## 2. Principe de modélisation recommandé

Ne pas remplacer l’existant. Construire une couche de simulation **par-dessus** :

1. Réutiliser les tables existantes pour les objets métiers centraux
- courtiers (`partners`)
- clients (`clients`)
- contrats (`contracts`)
- primes (au minimum `contract_premium_terms`, `contract_premium_payments`)
- sinistres (`sinistres`, `sinistre_lignes`, `reglements`)
- branches S2 (`insurance_branch`)

2. Ajouter des tables d’extension pour :
- scénarios / runs
- calibration et hypothèses
- granularité des couvertures par contrat
- événements et réserves de sinistres (long-tail)
- réassurance détaillée
- agrégats S2 / pilotage

3. Tagger toutes les données de simulation
- `scenario_id`
- `run_id`
- `data_origin = 'synthetic'`

## 3. Gaps de l’existant à combler

L’existant couvre déjà la structure commerciale et une partie des sinistres, mais il manque pour une simulation captive quasi réelle :

- moteur de scénarios / paramètres (rejouable),
- distribution et segmentation des courtiers (Pareto, poids),
- profilage client pour multi-équipement et éligibilité par branche,
- granularité produit/couverture par contrat (branche par contrat),
- transactions de primes émises/ajustements (GWP vs cash encaissé),
- historique de réserves (RBNS/IBNR simulé),
- événements de sinistre (ouverture, réouverture, clôture),
- réassurance explicite (traités, cessions primes/sinistres),
- agrégats de concentration et SCR par scénario.

## 4. Stratégie de création et population (ordre d’exécution)

### Phase 0 — Cadre de simulation

Créer les tables de pilotage de simulation en premier :

- `simulation_scenarios`
- `simulation_runs`
- `simulation_parameters`
- `simulation_run_checks`

### Phase 1 — Référentiels et calibration

Charger / générer :

- branches S2 (`insurance_branch`) pour chaque captive,
- mapping programme↔branche (`program_branch_map` / `programmes.branch_s2_code`),
- paramètres de branche (`branch_risk_parameters`, `branch_capital_parameters`),
- segments courtiers et hypothèses de distribution (nouvelles tables proposées ci-dessous).

### Phase 2 — Réseau courtiers (réutiliser `partners`)

Populer `partners` comme courtiers synthétiques :

- ~1 100 courtiers,
- segmentation (`top/core/tail`),
- poids volumique pour distribution Pareto,
- spécialisation par branche (optionnel),
- rattachement géographique.

Les attributs spécifiques à la simulation doivent être stockés dans une table d’extension (pas dans `partners` directement).

### Phase 3 — Clients (réutiliser `clients`)

Créer ~85 000 clients avec :

- profil de risque / type,
- courtier principal,
- zone géographique,
- propension multi-équipement,
- variables d’exposition (CA, masse salariale, etc. déjà partiellement présentes).

Le lien courtier-client peut utiliser :

- `clients.partner_id` (si un seul courtier principal),
- ou une table d’historique si besoin de temporalité.

### Phase 4 — Contrats (réutiliser `contracts`)

Créer ~250 000 contrats en respectant :

- moyenne ~3 contrats/client (distribution, pas constante),
- éligibilité par branche selon profil client,
- saisonnalité / étalement des dates d’effet,
- rattachement à `partners`, `clients`, `programmes`.

### Phase 5 — Primes / GWP

L’existant distingue déjà :

- `contract_premium_terms` (conditions de prime)
- `contract_premium_payments` (encaissements)

Pour une simulation captive, ajouter une table de **transactions de prime émises** (GWP) afin de séparer :

- prime émise (GWP/EP),
- ajustement / annulation,
- encaissement cash.

### Phase 6 — Sinistres / provisions (réutiliser + étendre)

Réutiliser :

- `sinistres` (entête)
- `sinistre_lignes` (par branche)
- `reglements` (paiements)

Ajouter :

- événements de cycle de vie du sinistre,
- snapshots de réserve (RBNS/IBNR),
- attributs de long-tail (lags, AY/UY, patterns).

### Phase 7 — Réassurance (nouveau bloc)

Même si `branch_reinsurance_rules` existe, il faut des tables de simulation de traité et de cessions :

- traité / termes / période,
- cessions de primes,
- récupérations et cessions sinistres,
- vue brute vs nette.

### Phase 8 — Agrégats S2 et contrôles

Calculer et stocker :

- concentration par courtier,
- GWP/earned/réserves par branche,
- inputs SCR non-life simplifiés,
- résultats SCR/MCR/ratio de solvabilité par scénario,
- checks de cohérence automatiques.

## 5. Proposition de tables (compatible avec l’existant)

## A. Tables d’extension de simulation (nouvelles)

### A.1 Pilotage des scénarios / runs

#### `simulation_scenarios`

But : définition métier d’un scénario (base, stress, adverse).

Champs clés (proposition) :

- `id` PK
- `captive_id` FK -> `captives.id`
- `code` (unique par captive)
- `name`
- `description`
- `status` (`draft`,`active`,`archived`)
- `target_year` (ex. 2028)
- `data_origin` (`synthetic`)
- `created_at`, `updated_at`

#### `simulation_runs`

But : exécution concrète d’un scénario (rejouable/versionnée).

Champs :

- `id` PK
- `scenario_id` FK -> `simulation_scenarios.id`
- `run_label`
- `seed_value` (reproductibilité)
- `started_at`, `ended_at`
- `status` (`running`,`done`,`failed`)
- `engine_version`
- `notes`

#### `simulation_parameters`

But : stocker les hypothèses paramétriques (clé/valeur ou JSON) par scénario.

Champs :

- `id` PK
- `scenario_id` FK
- `parameter_group` (`portfolio`,`claims`,`reinsurance`,`s2`,`distribution`)
- `parameter_key`
- `value_json` JSON
- `effective_from`, `effective_to`

#### `simulation_run_checks`

But : résultat des contrôles automatiques (qualité/cohérence).

Champs :

- `id` PK
- `run_id` FK
- `check_code`
- `severity` (`info`,`warning`,`error`)
- `status` (`pass`,`fail`)
- `metric_value` DECIMAL / `metric_json` JSON
- `message`
- `created_at`

### A.2 Extension du réseau de courtiers (réutilise `partners`)

#### `partner_simulation_profiles`

But : attributs de simulation des courtiers sans polluer `partners`.

Champs :

- `id` PK
- `partner_id` FK -> `partners.id`
- `scenario_id` FK -> `simulation_scenarios.id`
- `broker_segment` (`top`,`core`,`tail`)
- `pareto_weight` DECIMAL(12,6)
- `target_clients_count`
- `target_contracts_count`
- `target_gwp_amount`
- `specialization_json` JSON (branches favorites)
- `region_code` / `zone_code`
- `is_active`
- `created_at`, `updated_at`

Contraintes :

- unique (`partner_id`,`scenario_id`)

### A.3 Extension clients (réutilise `clients`)

#### `client_simulation_profiles`

But : profils de risque / équipement / exposition par scénario.

Champs :

- `id` PK
- `client_id` FK -> `clients.id`
- `scenario_id` FK
- `partner_id` FK -> `partners.id` (courtier principal du scénario)
- `client_segment` (`particulier`,`pro`,`pme`,`sante`,`medical`)
- `geo_code`
- `equipment_score`
- `target_contracts_count`
- `risk_score`
- `price_sensitivity`
- `annual_revenue` (peut dupliquer CA simulé si distinct du réel)
- `payroll_amount`
- `headcount`
- `created_at`, `updated_at`

Contraintes :

- unique (`client_id`,`scenario_id`)

#### `client_branch_eligibility`

But : rendre explicite l’éligibilité des clients aux branches (utile pour générateur).

Champs :

- `id` PK
- `client_id` FK
- `scenario_id` FK
- `id_branch` FK -> `insurance_branch.id_branch`
- `eligibility_status` (`eligible`,`conditional`,`excluded`)
- `reason_code`
- `max_limit`
- `created_at`

Contraintes :

- unique (`client_id`,`scenario_id`,`id_branch`)

### A.4 Granularité contrat / couverture / prime émise

L’existant a `contracts` et `contract_premium_terms`, mais pas de granularité de couverture par branche sur le contrat.

#### `contract_coverages`

But : rattacher explicitement un contrat à une branche/couverture (et ses paramètres).

Champs :

- `id` PK
- `contract_id` FK -> `contracts.id`
- `id_branch` FK -> `insurance_branch.id_branch`
- `programme_coverage_id` FK nullable -> `programme_coverages.id_coverage`
- `coverage_label`
- `limit_per_claim`
- `limit_annual`
- `deductible_amount`
- `currency`
- `effective_from`, `effective_to`
- `created_at`, `updated_at`

Contraintes :

- index (`contract_id`,`id_branch`)

#### `premium_transactions`

But : distinguer prime émise / ajustement / annulation / prime acquise (source GWP).

Champs :

- `id` PK
- `scenario_id` FK
- `run_id` FK
- `contract_id` FK -> `contracts.id`
- `contract_coverage_id` FK nullable -> `contract_coverages.id`
- `transaction_type` (`ISSUED`,`ENDORSEMENT`,`CANCELLATION`,`EARNED`)
- `accounting_date`
- `effective_date`
- `amount_gross`
- `currency`
- `tax_amount` nullable
- `commission_amount` nullable
- `brokerage_amount` nullable
- `source_ref`
- `created_at`

Index :

- (`scenario_id`,`accounting_date`)
- (`contract_id`,`accounting_date`)

### A.5 Sinistres : événements + réserves + long-tail (extension de `sinistres`)

#### `claim_events`

But : journal des transitions de sinistre.

Champs :

- `id` PK
- `sinistre_id` FK -> `sinistres.id`
- `sinistre_ligne_id` FK nullable -> `sinistre_lignes.id`
- `event_type` (`OPEN`,`UPDATE`,`CLOSE`,`REOPEN`,`REJECT`)
- `event_date`
- `status_after`
- `payload_json` JSON
- `created_at`

#### `claim_reserve_snapshots`

But : snapshots de réserves par date (RBNS/IBNR/ULAE simplifiés).

Champs :

- `id` PK
- `scenario_id` FK
- `run_id` FK
- `sinistre_id` FK -> `sinistres.id`
- `sinistre_ligne_id` FK nullable -> `sinistre_lignes.id`
- `snapshot_date`
- `rbns_gross`
- `ibnr_gross`
- `expense_reserve_gross`
- `rbns_net`
- `ibnr_net`
- `case_outstanding_gross`
- `paid_to_date_gross`
- `currency`
- `created_at`

Contraintes :

- unique (`sinistre_ligne_id`,`snapshot_date`) si ligne renseignée

#### `claim_development_factors` (optionnel mais utile)

But : stocker les patterns de développement utilisés pour PI/Medical.

Champs :

- `id` PK
- `scenario_id` FK
- `id_branch` FK
- `basis` (`REPORTING`,`PAYMENT`,`INCURRED`)
- `development_period` INT
- `factor_value`
- `created_at`

### A.6 Réassurance (simulation explicite)

`branch_reinsurance_rules` existe mais sert surtout à des règles génériques. Il faut un niveau “traité + cessions”.

#### `reinsurance_treaties`

But : traité actif dans un scénario / run.

Champs :

- `id` PK
- `scenario_id` FK
- `run_id` FK nullable
- `captive_id` FK -> `captives.id`
- `code`
- `name`
- `treaty_type` (`QUOTA_SHARE`,`XOL`,`STOP_LOSS`,`FRONTING`)
- `counterparty_insurer_id` FK nullable -> `insurers.id`
- `inception_date`, `expiry_date`
- `currency`
- `status`
- `created_at`, `updated_at`

#### `reinsurance_treaty_scopes`

But : périmètre du traité (branches/programmes).

Champs :

- `id` PK
- `treaty_id` FK -> `reinsurance_treaties.id`
- `id_branch` FK nullable -> `insurance_branch.id_branch`
- `programme_id` FK nullable -> `programmes.id`
- `priority_order`

#### `reinsurance_treaty_terms`

But : paramètres techniques du traité.

Champs :

- `id` PK
- `treaty_id` FK
- `term_type` (`CESSION_RATE`,`RETENTION`,`LIMIT`,`ATTACHMENT`,`AAL`,`AGG_LIMIT`)
- `value_numeric`
- `value_json` JSON nullable
- `effective_from`, `effective_to`

#### `reinsurance_premium_cessions`

But : prime cédée par transaction / contrat / branche.

Champs :

- `id` PK
- `scenario_id` FK
- `run_id` FK
- `treaty_id` FK
- `premium_transaction_id` FK -> `premium_transactions.id`
- `amount_ceded`
- `commission_reinsurance`
- `net_cost`
- `accounting_date`
- `created_at`

#### `reinsurance_claim_cessions`

But : récupération / cession de sinistres par traité.

Champs :

- `id` PK
- `scenario_id` FK
- `run_id` FK
- `treaty_id` FK
- `sinistre_id` FK -> `sinistres.id`
- `sinistre_ligne_id` FK nullable -> `sinistre_lignes.id`
- `event_date`
- `cession_type` (`PAID`,`RESERVE`,`RECOVERY`)
- `amount_ceded`
- `currency`
- `created_at`

### A.7 Agrégats portefeuille / concentration / S2

#### `portfolio_snapshots`

But : snapshot analytique par date/scénario.

Champs :

- `id` PK
- `scenario_id` FK
- `run_id` FK
- `snapshot_date`
- `captive_id` FK
- `gwp_total`
- `earned_premium_total`
- `claims_paid_total`
- `claims_incurred_total`
- `rbns_total`
- `ibnr_total`
- `net_result_technical`
- `created_at`

#### `portfolio_branch_snapshots`

But : même logique, mais par branche.

Champs :

- `id` PK
- `scenario_id` FK
- `run_id` FK
- `snapshot_date`
- `id_branch` FK
- `contracts_count`
- `clients_count`
- `gwp_gross`
- `gwp_net`
- `earned_gross`
- `paid_gross`
- `paid_net`
- `incurred_gross`
- `incurred_net`
- `rbns_gross`
- `ibnr_gross`
- `cat_loss_gross`
- `created_at`

Contraintes :

- unique (`run_id`,`snapshot_date`,`id_branch`)

#### `broker_concentration_snapshots`

But : mesure de concentration de distribution (top 1/5/20, HHI, etc.).

Champs :

- `id` PK
- `scenario_id` FK
- `run_id` FK
- `snapshot_date`
- `partner_id` FK -> `partners.id`
- `rank_by_gwp`
- `gwp_amount`
- `gwp_share_pct`
- `contracts_count`
- `clients_count`
- `hhi_contribution`
- `created_at`

#### `s2_scr_inputs_non_life`

But : inputs de calcul SCR (simplifiés) par branche/période.

Champs :

- `id` PK
- `scenario_id` FK
- `run_id` FK
- `snapshot_date`
- `id_branch` FK
- `premium_volume`
- `reserve_volume`
- `cat_exposure`
- `counterparty_exposure`
- `sigma_premium`
- `sigma_reserve`
- `corr_group_code`
- `created_at`

#### `s2_scr_results`

But : résultats SCR/MCR par scénario/run/date.

Champs :

- `id` PK
- `scenario_id` FK
- `run_id` FK
- `snapshot_date`
- `scr_non_life`
- `scr_counterparty`
- `scr_market`
- `scr_operational`
- `scr_bscr`
- `scr_total`
- `mcr`
- `own_funds_eligible`
- `solvency_ratio_pct`
- `methodology_version`
- `created_at`

## B. Évolutions minimales de tables existantes (optionnel mais utile)

Ces ajouts sont facultatifs si vous préférez tout mettre en tables d’extension, mais ils simplifient la simulation.

### `clients`

Ajouts proposés :

- `scenario_id` nullable (si vous voulez stocker plusieurs jeux dans la même table ; sinon éviter)
- `data_origin` nullable

Recommandation :

- **ne pas** ajouter `scenario_id` aux tables cœur déjà en production si elles servent aussi au métier courant.
- Préférer une table de mapping d’exécution (`simulation_object_map`) si besoin d’isoler les runs.

### `contracts`

Ajouts proposés :

- `external_contract_ref` (si non présent)
- `renewal_of_contract_id` FK nullable (traçabilité renouvellement)
- `cancel_reason_code`

### `sinistres`

Ajouts proposés :

- `occurrence_year`
- `reporting_delay_days`
- `is_cat_event`
- `cat_event_id` FK nullable (si table `cat_events`)

## C. Table optionnelle pour événements CAT (Property)

#### `cat_events`

Champs :

- `id` PK
- `scenario_id` FK
- `run_id` FK
- `event_code`
- `event_date`
- `event_type` (`FLOOD`,`WIND`,`HAIL`,`FIRE`,`OTHER`)
- `geo_scope_json` JSON
- `severity_index`
- `loss_multiplier`
- `created_at`

Utilité :

- stress `Property`,
- concentration géographique,
- calcul Cat Risk simplifié.

## 6. Mapping métier -> tables (simulation cible)

- Courtier = `partners` + `partner_simulation_profiles`
- Client = `clients` + `client_simulation_profiles`
- Contrat = `contracts`
- Couverture de contrat = `contract_coverages`
- Prime émise (GWP) = `premium_transactions`
- Encaissement prime = `contract_premium_payments`
- Sinistre entête = `sinistres`
- Sinistre par branche = `sinistre_lignes`
- Paiement sinistre = `reglements`
- Réserves / développement = `claim_reserve_snapshots`
- Réassurance = `reinsurance_*`
- S2 / pilotage = `portfolio_*`, `broker_concentration_snapshots`, `s2_scr_*`

## 7. Pipeline de génération recommandé (rejouable)

1. Créer/mettre à jour schéma (`migrate.js` ou migration SQL dédiée)
2. Créer `simulation_scenarios` + `simulation_parameters`
3. Générer courtiers (`partners`) + profils (`partner_simulation_profiles`)
4. Générer clients (`clients`) + profils (`client_simulation_profiles`)
5. Générer contrats (`contracts`) + couvertures (`contract_coverages`)
6. Générer primes émises (`premium_transactions`) puis encaissements (`contract_premium_payments`)
7. Générer sinistres (`sinistres`, `sinistre_lignes`, `reglements`)
8. Générer réserves / snapshots (`claim_reserve_snapshots`)
9. Appliquer réassurance (`reinsurance_*`)
10. Produire agrégats S2 (`portfolio_*`, `s2_scr_*`)
11. Exécuter contrôles (`simulation_run_checks`)

## 8. Contrôles de cohérence à automatiser (minimum)

### Portefeuille

- ~85 000 clients
- ~250 000 contrats
- ~1 100 courtiers (`partners` ciblés simulation)
- GWP total ~208 M€
- distribution GWP par branche conforme
- moyenne contrats/client proche de 3
- Pareto courtiers conforme (ex. top 20% = 60-70%)

### Sinistres / réserves

- `date_decl >= date_survenue`
- pas de paiements incohérents vs montants
- long-tail visible sur PI / Medical (lags et réserves)
- `Property` avec scénarios CAT si activés

### S2 / pilotage

- cohérence brut/net après réassurance
- MCR calculé / renseigné
- ratio solvabilité calculable pour chaque `run_id`

## 9. Décisions à trancher avant implémentation

1. `partners` représente-t-il exclusivement des courtiers dans ce jeu de simulation ? (recommandé : oui)
2. Voulez-vous stocker les données de simulation dans les tables métier existantes (`clients`, `contracts`, `sinistres`) ou dans des tables parallèles `sim_*` ?
3. Niveau de granularité S2 attendu : simplifié (agrégats par branche) ou quasi-complet (triangles, contreparties, actifs) ?
4. Réassurance à simuler en V1 : `Quota Share + Stop Loss` uniquement, ou ajout `XoL` ?

## 10. Recommandation de mise en oeuvre V1 (pragmatique)

Pour livrer vite une base exploitable :

- Réutiliser `partners`, `clients`, `contracts`, `sinistres`, `sinistre_lignes`, `reglements`
- Ajouter en priorité :
  - `simulation_scenarios`
  - `simulation_runs`
  - `simulation_parameters`
  - `partner_simulation_profiles`
  - `client_simulation_profiles`
  - `contract_coverages`
  - `premium_transactions`
  - `claim_reserve_snapshots`
  - `reinsurance_treaties`
  - `reinsurance_premium_cessions`
  - `reinsurance_claim_cessions`
  - `portfolio_branch_snapshots`
  - `s2_scr_results`

Ce socle suffit pour une simulation quasi réelle utilisable par comité / actuariat / risk.
