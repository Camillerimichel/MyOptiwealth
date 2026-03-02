-- Purge metier "safe" (MySQL / InnoDB)
-- Objectif:
-- - supprimer portefeuille quasi-reel: programmes, contrats, courtiers, clients, primes, sinistres
-- - supprimer les tables satellites (documents, correspondants, audit, report_jobs, insurers)
-- - conserver le schema, les users/roles/captives et le referentiel branches/categories
--
-- IMPORTANT:
-- 1) Faire un backup avant execution.
-- 2) Executer sur la bonne base.
-- 3) Les DELETE peuvent etre lents sur gros volumes (transaction unique).

SET @OLD_SQL_SAFE_UPDATES := @@SQL_SAFE_UPDATES;
SET SQL_SAFE_UPDATES = 0;

START TRANSACTION;

-- Historiques / traces metier (proposition incluse)
DELETE FROM report_jobs;
DELETE FROM audit_trail;

-- Sinistres (enfants -> parents)
DELETE FROM reglements;
DELETE FROM sinistre_lignes;
DELETE FROM sinistres;

-- Primes / contrats (enfants -> parents)
DELETE FROM contract_premium_payments;
DELETE FROM contract_premium_terms;
DELETE FROM contracts;

-- Courtiers (partners) et satellites
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

-- Courtiers (apres contracts/programmes)
DELETE FROM partners;

-- Assureurs (table de reference derivee de programmes/carriers/insurers)
DELETE FROM insurers;

-- Optionnel: vider la queue technique si tu veux repartir "propre" aussi
DELETE FROM jobs;

COMMIT;

-- Reset des auto-increments (facultatif mais pratique pour base de demo)
ALTER TABLE report_jobs AUTO_INCREMENT = 1;
ALTER TABLE jobs AUTO_INCREMENT = 1;
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

SET SQL_SAFE_UPDATES = @OLD_SQL_SAFE_UPDATES;

-- Verification rapide (post-purge)
SELECT 'programmes' AS table_name, COUNT(*) AS cnt FROM programmes
UNION ALL SELECT 'contracts', COUNT(*) FROM contracts
UNION ALL SELECT 'clients', COUNT(*) FROM clients
UNION ALL SELECT 'partners', COUNT(*) FROM partners
UNION ALL SELECT 'sinistres', COUNT(*) FROM sinistres
UNION ALL SELECT 'reglements', COUNT(*) FROM reglements
UNION ALL SELECT 'contract_premium_terms', COUNT(*) FROM contract_premium_terms
UNION ALL SELECT 'contract_premium_payments', COUNT(*) FROM contract_premium_payments
UNION ALL SELECT 'audit_trail', COUNT(*) FROM audit_trail
UNION ALL SELECT 'report_jobs', COUNT(*) FROM report_jobs
UNION ALL SELECT 'jobs', COUNT(*) FROM jobs
UNION ALL SELECT 'insurers', COUNT(*) FROM insurers;
