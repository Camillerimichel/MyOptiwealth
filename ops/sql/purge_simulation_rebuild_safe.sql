-- Purge "rebuild" : portefeuille métier + extensions simulation/ORSA/CAT
-- Conserve le schéma, users/roles/captives et référentiels branches/catégories/politiques.

SET @OLD_SQL_SAFE_UPDATES := @@SQL_SAFE_UPDATES;
SET SQL_SAFE_UPDATES = 0;

START TRANSACTION;

-- ORSA (enfants -> parents)
DELETE FROM orsa_run_comparison_snapshots;
DELETE FROM orsa_run_set_members;
DELETE FROM orsa_run_sets;

-- Geo / CAT concentration (enfants -> parents)
DELETE cezi
FROM cat_event_zone_impacts cezi
JOIN cat_events ce ON ce.id = cezi.cat_event_id;
DELETE FROM cat_concentration_snapshots;
DELETE FROM contract_geo_exposures;
DELETE FROM cat_events;

-- Réassurance / simulation claims/premiums/snapshots
DELETE FROM reinsurance_claim_cessions;
DELETE FROM reinsurance_premium_cessions;
DELETE FROM reinsurance_treaty_terms;
DELETE FROM reinsurance_treaty_scopes;
DELETE FROM reinsurance_treaties;

DELETE FROM s2_scr_results;
DELETE FROM s2_scr_inputs_non_life;
DELETE FROM broker_concentration_snapshots;
DELETE FROM portfolio_branch_snapshots;
DELETE FROM portfolio_snapshots;

DELETE FROM claim_reserve_snapshots;
DELETE FROM claim_events;
DELETE FROM claim_development_factors;

DELETE FROM premium_transactions;
DELETE FROM contract_coverages;

DELETE FROM client_branch_eligibility;
DELETE FROM client_simulation_profiles;
DELETE FROM partner_simulation_profiles;

DELETE FROM simulation_run_checks;
DELETE FROM simulation_runs;
DELETE FROM simulation_parameters;
DELETE FROM simulation_scenarios;

-- Historiques / traces metier
DELETE FROM report_jobs;
DELETE FROM audit_trail;

-- Sinistres métier (enfants -> parents)
DELETE FROM reglements;
DELETE FROM sinistre_lignes;
DELETE FROM sinistres;

-- Primes / contrats métier (enfants -> parents)
DELETE FROM contract_premium_payments;
DELETE FROM contract_premium_terms;
DELETE FROM contracts;

-- Courtiers et satellites
DELETE FROM partner_programme;
DELETE FROM partner_correspondant;
DELETE FROM partner_documents;
DELETE FROM partner_addresses;
DELETE FROM partner_mandataires;
DELETE FROM correspondants;

-- Clients
DELETE FROM clients;

-- Programmes et satellites
DELETE FROM programme_documents;
DELETE FROM programme_versions;
DELETE FROM programme_pricing;
DELETE FROM programme_deductibles;
DELETE FROM programme_exclusions;
DELETE FROM programme_conditions;
DELETE FROM programme_carriers;
DELETE FROM programme_insurers;
DELETE FROM programme_coverages;
DELETE FROM programme_layers;
DELETE FROM programmes;

-- Courtiers
DELETE FROM partners;

-- Référentiel assureurs (reconstruit dynamiquement)
DELETE FROM insurers;

-- Queue technique
DELETE FROM jobs;

-- Référentiel zones géo (après expositions / impacts)
DELETE FROM geo_zones;

COMMIT;

-- Reset auto-increments (tables fréquemment utilisées)
ALTER TABLE simulation_scenarios AUTO_INCREMENT = 1;
ALTER TABLE simulation_runs AUTO_INCREMENT = 1;
ALTER TABLE simulation_parameters AUTO_INCREMENT = 1;
ALTER TABLE simulation_run_checks AUTO_INCREMENT = 1;
ALTER TABLE partner_simulation_profiles AUTO_INCREMENT = 1;
ALTER TABLE client_simulation_profiles AUTO_INCREMENT = 1;
ALTER TABLE client_branch_eligibility AUTO_INCREMENT = 1;
ALTER TABLE contract_coverages AUTO_INCREMENT = 1;
ALTER TABLE premium_transactions AUTO_INCREMENT = 1;
ALTER TABLE claim_events AUTO_INCREMENT = 1;
ALTER TABLE claim_reserve_snapshots AUTO_INCREMENT = 1;
ALTER TABLE claim_development_factors AUTO_INCREMENT = 1;
ALTER TABLE cat_events AUTO_INCREMENT = 1;
ALTER TABLE contract_geo_exposures AUTO_INCREMENT = 1;
ALTER TABLE cat_event_zone_impacts AUTO_INCREMENT = 1;
ALTER TABLE cat_concentration_snapshots AUTO_INCREMENT = 1;
ALTER TABLE reinsurance_treaties AUTO_INCREMENT = 1;
ALTER TABLE reinsurance_treaty_scopes AUTO_INCREMENT = 1;
ALTER TABLE reinsurance_treaty_terms AUTO_INCREMENT = 1;
ALTER TABLE reinsurance_premium_cessions AUTO_INCREMENT = 1;
ALTER TABLE reinsurance_claim_cessions AUTO_INCREMENT = 1;
ALTER TABLE portfolio_snapshots AUTO_INCREMENT = 1;
ALTER TABLE portfolio_branch_snapshots AUTO_INCREMENT = 1;
ALTER TABLE broker_concentration_snapshots AUTO_INCREMENT = 1;
ALTER TABLE s2_scr_inputs_non_life AUTO_INCREMENT = 1;
ALTER TABLE s2_scr_results AUTO_INCREMENT = 1;
ALTER TABLE orsa_run_sets AUTO_INCREMENT = 1;
ALTER TABLE orsa_run_set_members AUTO_INCREMENT = 1;
ALTER TABLE orsa_run_comparison_snapshots AUTO_INCREMENT = 1;

ALTER TABLE reglements AUTO_INCREMENT = 1;
ALTER TABLE sinistre_lignes AUTO_INCREMENT = 1;
ALTER TABLE sinistres AUTO_INCREMENT = 1;
ALTER TABLE contract_premium_payments AUTO_INCREMENT = 1;
ALTER TABLE contract_premium_terms AUTO_INCREMENT = 1;
ALTER TABLE contracts AUTO_INCREMENT = 1;
ALTER TABLE partner_correspondant AUTO_INCREMENT = 1;
ALTER TABLE partner_documents AUTO_INCREMENT = 1;
ALTER TABLE partner_addresses AUTO_INCREMENT = 1;
ALTER TABLE partner_mandataires AUTO_INCREMENT = 1;
ALTER TABLE correspondants AUTO_INCREMENT = 1;
ALTER TABLE clients AUTO_INCREMENT = 1;
ALTER TABLE programme_documents AUTO_INCREMENT = 1;
ALTER TABLE programme_versions AUTO_INCREMENT = 1;
ALTER TABLE programme_pricing AUTO_INCREMENT = 1;
ALTER TABLE programme_deductibles AUTO_INCREMENT = 1;
ALTER TABLE programme_exclusions AUTO_INCREMENT = 1;
ALTER TABLE programme_conditions AUTO_INCREMENT = 1;
ALTER TABLE programme_carriers AUTO_INCREMENT = 1;
ALTER TABLE programme_insurers AUTO_INCREMENT = 1;
ALTER TABLE programme_coverages AUTO_INCREMENT = 1;
ALTER TABLE programme_layers AUTO_INCREMENT = 1;
ALTER TABLE programmes AUTO_INCREMENT = 1;
ALTER TABLE partners AUTO_INCREMENT = 1;
ALTER TABLE insurers AUTO_INCREMENT = 1;
ALTER TABLE jobs AUTO_INCREMENT = 1;
ALTER TABLE report_jobs AUTO_INCREMENT = 1;

SET SQL_SAFE_UPDATES = @OLD_SQL_SAFE_UPDATES;

-- Vérification rapide
SELECT 'simulation_runs' AS table_name, COUNT(*) AS cnt FROM simulation_runs
UNION ALL SELECT 'partners', COUNT(*) FROM partners
UNION ALL SELECT 'clients', COUNT(*) FROM clients
UNION ALL SELECT 'contracts', COUNT(*) FROM contracts
UNION ALL SELECT 'premium_transactions', COUNT(*) FROM premium_transactions
UNION ALL SELECT 'sinistres', COUNT(*) FROM sinistres
UNION ALL SELECT 'cat_events', COUNT(*) FROM cat_events
UNION ALL SELECT 'orsa_run_sets', COUNT(*) FROM orsa_run_sets;

