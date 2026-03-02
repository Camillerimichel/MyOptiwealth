-- Usage example:
--   SET @run_id := 3;
--   SET @snapshot_date := '2028-12-31';
--   SOURCE ops/sql/simulation_run_report_v1.sql;

SELECT @run_id AS run_id, @snapshot_date AS snapshot_date;

SELECT
  sr.id,
  sr.run_label,
  sr.status,
  sr.started_at,
  sr.ended_at,
  ss.code AS scenario_code,
  ss.name AS scenario_name
FROM simulation_runs sr
JOIN simulation_scenarios ss ON ss.id = sr.scenario_id
WHERE sr.id = @run_id;

SELECT
  ROUND(ps.gwp_total,2) AS gwp_total,
  ROUND(ps.claims_paid_total,2) AS claims_paid_total,
  ROUND(ps.claims_incurred_total,2) AS claims_incurred_total,
  ROUND(ps.rbns_total,2) AS rbns_total,
  ROUND(ps.ibnr_total,2) AS ibnr_total
FROM portfolio_snapshots ps
WHERE ps.run_id = @run_id
  AND ps.snapshot_date = @snapshot_date;

SELECT
  ib.s2_code,
  ib.name AS branch_name,
  pbs.contracts_count,
  pbs.clients_count,
  ROUND(pbs.gwp_gross,2) AS gwp_gross,
  ROUND(pbs.gwp_net,2) AS gwp_net,
  ROUND(pbs.paid_gross,2) AS paid_gross,
  ROUND(pbs.paid_net,2) AS paid_net,
  ROUND(pbs.incurred_gross,2) AS incurred_gross,
  ROUND(pbs.incurred_net,2) AS incurred_net,
  ROUND(pbs.cat_loss_gross,2) AS cat_loss_gross
FROM portfolio_branch_snapshots pbs
JOIN insurance_branch ib ON ib.id_branch = pbs.id_branch
WHERE pbs.run_id = @run_id
  AND pbs.snapshot_date = @snapshot_date
ORDER BY pbs.gwp_gross DESC;

SELECT
  ROUND(SUM(rpc.amount_ceded),2) AS premium_ceded_total,
  COUNT(*) AS premium_cessions_count
FROM reinsurance_premium_cessions rpc
WHERE rpc.run_id = @run_id;

SELECT
  rt.treaty_type,
  ROUND(SUM(CASE WHEN rcc.cession_type='PAID' THEN rcc.amount_ceded ELSE 0 END),2) AS paid_ceded,
  ROUND(SUM(CASE WHEN rcc.cession_type='RESERVE' THEN rcc.amount_ceded ELSE 0 END),2) AS reserve_ceded,
  ROUND(SUM(CASE WHEN rcc.cession_type='RECOVERY' THEN rcc.amount_ceded ELSE 0 END),2) AS recovery_ceded,
  COUNT(*) AS cession_rows
FROM reinsurance_claim_cessions rcc
JOIN reinsurance_treaties rt ON rt.id = rcc.treaty_id
WHERE rcc.run_id = @run_id
GROUP BY rt.treaty_type
ORDER BY rt.treaty_type;

SELECT
  ROUND(s2.scr_non_life,2) AS scr_non_life,
  ROUND(s2.scr_counterparty,2) AS scr_counterparty,
  ROUND(s2.scr_market,2) AS scr_market,
  ROUND(s2.scr_operational,2) AS scr_operational,
  ROUND(s2.scr_total,2) AS scr_total,
  ROUND(s2.mcr,2) AS mcr,
  ROUND(s2.own_funds_eligible,2) AS own_funds_eligible,
  ROUND(s2.solvency_ratio_pct,2) AS solvency_ratio_pct,
  s2.methodology_version
FROM s2_scr_results s2
WHERE s2.run_id = @run_id
  AND s2.snapshot_date = @snapshot_date;

SELECT
  ccs.geo_code,
  ROUND(ccs.property_gwp_gross,2) AS property_gwp_gross,
  ROUND(ccs.property_gwp_share_pct * 100,2) AS property_gwp_share_pct,
  ROUND(ccs.property_sum_insured,2) AS property_sum_insured,
  ROUND(ccs.property_si_share_pct * 100,2) AS property_si_share_pct,
  ccs.cat_event_count,
  ccs.cat_impacted_contracts_count,
  ROUND(ccs.cat_impacted_gwp_gross,2) AS cat_impacted_gwp_gross,
  ROUND(ccs.weighted_cat_exposure,2) AS weighted_cat_exposure
FROM cat_concentration_snapshots ccs
WHERE ccs.run_id = @run_id
  AND ccs.snapshot_date = @snapshot_date
ORDER BY ccs.property_gwp_gross DESC;

SELECT
  ROUND(SUM(ccs.hhi_contribution), 6) AS property_geo_hhi
FROM cat_concentration_snapshots ccs
WHERE ccs.run_id = @run_id
  AND ccs.snapshot_date = @snapshot_date;

SELECT
  src.check_code,
  src.severity,
  src.status,
  src.metric_value,
  src.message,
  src.created_at
FROM simulation_run_checks src
WHERE src.run_id = @run_id
ORDER BY src.id;

