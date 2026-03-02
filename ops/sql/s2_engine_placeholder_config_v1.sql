-- Paramétrage central du moteur S2 placeholder (scénario donné)
-- Remplace les hardcodes de type 12M / 2.7M et coefficients de charge dans les scripts V1/V2.
--
-- Usage:
--   SET @scenario_id = 1;
--   SOURCE /var/www/myoptiwealth/ops/sql/s2_engine_placeholder_config_v1.sql;

SET @scenario_id = COALESCE(@scenario_id, 1);

INSERT INTO simulation_parameters (
  scenario_id,
  parameter_group,
  parameter_key,
  value_json,
  effective_from
)
VALUES (
  @scenario_id,
  's2',
  'engine_placeholder_config_v1',
  JSON_OBJECT(
    'own_funds_eligible_base_eur', 12000000,
    'mcr_eur', 2700000,
    'claims_v1', JSON_OBJECT(
      'cat_charge_factor', 0.25,
      'nonlife_multiplier', 0.80,
      'operational_min_eur', 100000,
      'operational_per_claim_eur', 50
    ),
    'reinsurance_v1', JSON_OBJECT(
      'cat_charge_factor', 0.25,
      'counterparty_charge_factor', 0.08,
      'nonlife_multiplier', 0.78,
      'operational_fixed_eur', 350000
    ),
    'cat_xol_v2', JSON_OBJECT(
      'cat_charge_factor', 0.30,
      'counterparty_charge_factor', 0.10,
      'nonlife_multiplier', 0.76,
      'operational_fixed_eur', 450000
    ),
    'fronting_v2', JSON_OBJECT(
      'cat_charge_factor', 0.30,
      'counterparty_charge_factor', 0.10,
      'nonlife_multiplier', 0.76,
      'operational_fixed_eur', 450000
    )
  ),
  CURRENT_DATE()
)
ON DUPLICATE KEY UPDATE
  value_json = VALUES(value_json),
  updated_at = CURRENT_TIMESTAMP;

