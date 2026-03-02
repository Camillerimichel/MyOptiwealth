export type CodeOption = { value: string; label: string };

const CODE_LABELS: Record<string, string> = {
  PROPERTY: "Dommages",
  LIABILITY: "Responsabilite civile",
  MOTOR: "Automobile",
  OTHER: "Autre",
  PRIMARY: "Primaire",
  EXCESS: "Excedent",
  QUOTA: "Quote-part",
  FIXED: "Montant fixe",
  PERCENTAGE: "Pourcentage",
  NONE: "Aucune",
  LIMITED: "Limitee",
  STRICT: "Stricte",
  PROHIBITED: "Interdit",
  ALLOWED: "Autorise",
  CONDITIONAL: "Conditionnel",
  FRONTING_ONLY: "Fronting uniquement",
  REINSURANCE_ONLY: "Reassurance uniquement",
  VALIDATION_REQUIRED: "Validation requise",
  LOW: "Faible",
  MEDIUM: "Moyen",
  HIGH: "Eleve",
  FRONTING: "Fronting",
  QUOTA_SHARE: "Quote-part",
  EXCESS_OF_LOSS: "Excedent de perte",
  STOP_LOSS: "Stop loss",
  STANDARD_FORMULA: "Formule standard",
  INTERNAL_MODEL: "Modele interne",
  SIMPLIFIED: "Simplifie",
  LEAD: "Chef de file",
  CO_INSURER: "Coassureur",
  POLICY: "Police",
  ANNEX: "Annexe",
  CERTIFICATE: "Attestation",
};

export function labelForCode(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  const raw = String(value).trim();
  if (!raw) return "—";
  const normalized = raw.toUpperCase();
  return CODE_LABELS[normalized] || raw;
}

function buildCodeOptions<T extends readonly string[]>(codes: T): { value: T[number]; label: string }[] {
  return codes.map((value) => ({ value, label: labelForCode(value) }));
}

export const LAYER_TYPE_CODES = ["PRIMARY", "EXCESS", "QUOTA"] as const;
export const COVERAGE_TYPE_CODES = ["PROPERTY", "LIABILITY", "MOTOR", "OTHER"] as const;
export const DEDUCTIBLE_UNIT_CODES = ["FIXED", "PERCENTAGE"] as const;
export const CARRIER_ROLE_CODES = ["LEAD", "CO_INSURER", "FRONTING"] as const;
export const DOCUMENT_TYPE_CODES = ["POLICY", "ANNEX", "CERTIFICATE", "OTHER"] as const;
export const RESTRICTION_LEVEL_CODES = ["NONE", "LIMITED", "STRICT", "PROHIBITED"] as const;
export const ELIGIBILITY_MODE_CODES = [
  "ALLOWED",
  "CONDITIONAL",
  "PROHIBITED",
  "FRONTING_ONLY",
  "REINSURANCE_ONLY",
  "VALIDATION_REQUIRED",
] as const;
export const VOLATILITY_LEVEL_CODES = ["LOW", "MEDIUM", "HIGH"] as const;
export const CAPITAL_INTENSITY_CODES = ["LOW", "MEDIUM", "HIGH"] as const;
export const REINSURANCE_TYPE_CODES = ["FRONTING", "QUOTA_SHARE", "EXCESS_OF_LOSS", "STOP_LOSS"] as const;
export const CAPITAL_METHOD_CODES = ["STANDARD_FORMULA", "INTERNAL_MODEL", "SIMPLIFIED"] as const;

export const LAYER_TYPE_OPTIONS = buildCodeOptions(LAYER_TYPE_CODES);
export const COVERAGE_TYPE_OPTIONS = buildCodeOptions(COVERAGE_TYPE_CODES);
export const DEDUCTIBLE_UNIT_OPTIONS = buildCodeOptions(DEDUCTIBLE_UNIT_CODES);
export const CARRIER_ROLE_OPTIONS = buildCodeOptions(CARRIER_ROLE_CODES);
export const DOCUMENT_TYPE_OPTIONS = buildCodeOptions(DOCUMENT_TYPE_CODES);
export const RESTRICTION_LEVEL_OPTIONS = buildCodeOptions(RESTRICTION_LEVEL_CODES);
export const ELIGIBILITY_MODE_OPTIONS = buildCodeOptions(ELIGIBILITY_MODE_CODES);
export const VOLATILITY_LEVEL_OPTIONS = buildCodeOptions(VOLATILITY_LEVEL_CODES);
export const CAPITAL_INTENSITY_OPTIONS = buildCodeOptions(CAPITAL_INTENSITY_CODES);
export const REINSURANCE_TYPE_OPTIONS = buildCodeOptions(REINSURANCE_TYPE_CODES);
export const CAPITAL_METHOD_OPTIONS = buildCodeOptions(CAPITAL_METHOD_CODES);
