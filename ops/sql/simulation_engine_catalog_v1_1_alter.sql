SET NAMES utf8mb4;

ALTER TABLE simulation_engine_catalog
  ADD COLUMN IF NOT EXISTS script_name VARCHAR(255) NULL AFTER limitations,
  ADD COLUMN IF NOT EXISTS repo_path VARCHAR(255) NULL AFTER script_name;

