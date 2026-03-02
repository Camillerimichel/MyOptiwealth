-- Performance indexes for Reinsurance / Fronting dashboard endpoints
-- Scope: speed up summary/trend queries filtered by (scenario_id, date)

ALTER TABLE reinsurance_premium_cessions
  ADD INDEX idx_rpc_scenario_accounting_date (scenario_id, accounting_date),
  ADD INDEX idx_rpc_scenario_accounting_run (scenario_id, accounting_date, run_id);

ALTER TABLE reinsurance_claim_cessions
  ADD INDEX idx_rcc_scenario_event_date (scenario_id, event_date),
  ADD INDEX idx_rcc_scenario_event_run (scenario_id, event_date, run_id);

ALTER TABLE fronting_run_adjustments
  ADD INDEX idx_fra_scenario_snapshot_date (scenario_id, snapshot_date);
