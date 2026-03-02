-- Performance helpers for /api/primes
-- 1) Add indexes on contracts and premium payments
-- 2) Materialize aggregated payments per contract into contract_premium_payments_agg

ALTER TABLE contract_premium_payments
  ADD INDEX idx_cpp_contract_paidon_amount (contract_id, paid_on, amount),
  ADD INDEX idx_cpp_paidon_contract_amount (paid_on, contract_id, amount);

ALTER TABLE contracts
  ADD INDEX idx_contracts_programme_statut_created (programme_id, statut, created_at, id);

CREATE TABLE IF NOT EXISTS contract_premium_payments_agg (
  contract_id INT(11) NOT NULL,
  total_paid DECIMAL(16,2) NOT NULL DEFAULT 0.00,
  last_paid_on DATE DEFAULT NULL,
  payment_count INT(11) NOT NULL DEFAULT 0,
  refreshed_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (contract_id),
  CONSTRAINT fk_cpp_agg_contract FOREIGN KEY (contract_id) REFERENCES contracts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO contract_premium_payments_agg (contract_id, total_paid, last_paid_on, payment_count)
SELECT
  cpp.contract_id,
  ROUND(COALESCE(SUM(cpp.amount), 0), 2) AS total_paid,
  MAX(cpp.paid_on) AS last_paid_on,
  COUNT(*) AS payment_count
FROM contract_premium_payments cpp
GROUP BY cpp.contract_id
ON DUPLICATE KEY UPDATE
  total_paid = VALUES(total_paid),
  last_paid_on = VALUES(last_paid_on),
  payment_count = VALUES(payment_count);

