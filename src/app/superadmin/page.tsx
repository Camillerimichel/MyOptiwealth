"use client";

import Link from "next/link";
import { FormEvent, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";
import { apiRequest } from "@/lib/api";
import {
  CAPITAL_INTENSITY_CODES,
  CAPITAL_METHOD_CODES,
  ELIGIBILITY_MODE_CODES,
  REINSURANCE_TYPE_CODES,
  RESTRICTION_LEVEL_CODES,
  VOLATILITY_LEVEL_CODES,
  labelForCode,
} from "@/lib/codeLabels";

type Captive = {
  id: number;
  code: string;
  name: string;
  status: "active" | "disabled";
  active_members?: number;
  active_owners?: number;
};

type UserMembership = {
  captive_id: number;
  captive_code?: string;
  captive_name?: string;
  role: "owner" | "intervenant" | "manager" | "viewer";
  is_owner: boolean;
  status: "active" | "disabled";
};

type SuperUser = {
  id: number;
  email: string;
  status: "active" | "disabled";
  roles: string[];
  memberships: UserMembership[];
};

const ROLE_OPTIONS = [
  { value: "super_admin", label: "Super administrateur" },
  { value: "admin", label: "Admin" },
  { value: "cfo", label: "CFO" },
  { value: "risk_manager", label: "Risk manager" },
  { value: "actuaire", label: "Actuaire" },
  { value: "conseil", label: "Conseil" },
] as const;

const MEMBERSHIP_ROLES = [
  { value: "owner", label: "Owner" },
  { value: "manager", label: "Manager" },
  { value: "intervenant", label: "Intervenant" },
  { value: "viewer", label: "Lecture seule" },
] as const;

const RESTRICTION_OPTIONS = RESTRICTION_LEVEL_CODES;
const ELIGIBILITY_OPTIONS = ELIGIBILITY_MODE_CODES;
const VOLATILITY_OPTIONS = VOLATILITY_LEVEL_CODES;
const CAPITAL_INTENSITY_OPTIONS = CAPITAL_INTENSITY_CODES;
const REINSURANCE_TYPE_OPTIONS = REINSURANCE_TYPE_CODES;
const CAPITAL_METHOD_OPTIONS = CAPITAL_METHOD_CODES;
const SEED_BLOCK_TITLES = [
  "Catégorie",
  "Branche",
  "Programme",
  "Politique",
  "Risque",
  "Réassurance",
  "Capital",
  "Version de politique",
] as const;
const SEED_STEP_HELP: string[][] = [
  [
    "Code: identifiant métier de la catégorie.",
    "Nom: libellé affiché aux utilisateurs.",
    "Description: précision libre sur le périmètre couvert.",
  ],
  [
    "Code S2: code branche utilisé dans les référentiels.",
    "Nom: libellé de la branche.",
    "Type: type de branche (ex: PROPERTY, LIABILITY).",
    "Description: détail complémentaire.",
    "Active: rend la branche disponible ou non.",
  ],
  [
    "Un programme est un cadre produit qui regroupe des branches et leurs règles de souscription pour une captive.",
    "Code: identifiant unique du programme.",
    "Nom: libellé métier affiché dans l'application.",
    "Actif: rend le programme sélectionnable ou non.",
    "Description: périmètre, objectif et cas d'usage du programme.",
  ],
  [
    "Autorisé: indique si la souscription est permise.",
    "Restriction: niveau de contrainte appliqué.",
    "Éligibilité: mode global d'accès (dont interdit).",
    "Fronting/Réassurance/Validation: obligations de traitement.",
    "Début/Fin: période de validité.",
    "Commentaires/Notes validation: consignes métier.",
  ],
  [
    "Limite / sinistre: plafond par événement.",
    "Limite / an: plafond annuel cumulé.",
    "Franchise: montant retenu avant indemnisation.",
    "Volatilité/Intensité capital: profil de risque.",
    "Modèle actuariel: exigence de modélisation.",
    "Rétention nette %: part réelle du risque conservée par la captive après réassurance (ex: 35% = la captive garde 35%, 65% est cédé).",
    "Target loss ratio %: ratio cible Sinistres / Primes (ex: 70% = 70 de sinistres attendus pour 100 de primes).",
  ],
  [
    "Type: typologie de règle de réassurance.",
    "Cession %: part transférée au réassureur.",
    "Limite rétention: plafond gardé par la captive.",
    "Priorité: ordre d'application des règles.",
    "Début/Fin: période de validité.",
  ],
  [
    "Méthode: mode de calcul du besoin en capital.",
    "Charge %: taux appliqué au calcul.",
    "Scénario stress: hypothèse de test défavorable.",
    "Début/Fin: période de validité.",
  ],
  [
    "Version: identifiant de version de politique.",
    "Date: date du changement.",
    "Modifié par: auteur de la modification.",
    "Notes: justification et détails de version.",
  ],
];

type SeedForm = {
  categoryCode: string;
  categoryName: string;
  categoryDescription: string;
  branchCode: string;
  branchName: string;
  branchDescription: string;
  branchType: string;
  branchIsActive: number;
  programCode: string;
  programName: string;
  programDescription: string;
  programIsActive: number;
  policyIsAllowed: number;
  policyRestriction: (typeof RESTRICTION_OPTIONS)[number];
  policyFrontingRequired: number;
  policyReinsuranceRequired: number;
  policyComments: string;
  policyEffectiveFrom: string;
  policyEffectiveTo: string;
  policyEligibility: (typeof ELIGIBILITY_OPTIONS)[number];
  policyApprovalRequired: number;
  policyApprovalNotes: string;
  riskMaxLimitPerClaim: number | null;
  riskMaxLimitPerYear: number | null;
  riskDefaultDeductible: number | null;
  riskVolatility: (typeof VOLATILITY_OPTIONS)[number];
  riskCapital: (typeof CAPITAL_INTENSITY_OPTIONS)[number];
  riskRequiresActuarialModel: number;
  riskNetRetentionRatio: number | null;
  riskTargetLossRatio: number | null;
  reinsuranceType: (typeof REINSURANCE_TYPE_OPTIONS)[number];
  reinsuranceCessionRate: number | null;
  reinsuranceRetentionLimit: number | null;
  reinsurancePriority: number;
  reinsuranceEffectiveFrom: string;
  reinsuranceEffectiveTo: string;
  capitalMethod: (typeof CAPITAL_METHOD_OPTIONS)[number];
  capitalChargePct: number | null;
  capitalStressScenario: string;
  capitalEffectiveFrom: string;
  capitalEffectiveTo: string;
  policyVersionLabel: string;
  policyVersionChangedAt: string;
  policyVersionChangedBy: string;
  policyVersionChangeNotes: string;
};

type CategoryTemplate = {
  id_category: number;
  code: string;
  name: string;
  description?: string | null;
};

type BranchTemplate = {
  id_branch: number;
  s2_code: string;
  name: string;
  description?: string | null;
  branch_type: string;
  is_active: number;
};

type ProgramTemplate = {
  id_program: number;
  code: string;
  name: string;
  description?: string | null;
  is_active: number;
};

type ProgramBranchTemplate = {
  id_program: number;
  id_branch: number;
  program_code?: string | null;
  s2_code?: string | null;
};

type BranchCategoryTemplate = {
  id_branch: number;
  id_category: number;
  s2_code?: string | null;
  category_code?: string | null;
};

type PolicyTemplate = {
  id_policy: number;
  id_branch: number;
  branch_name?: string | null;
  is_allowed: number;
  restriction_level: (typeof RESTRICTION_OPTIONS)[number];
  fronting_required: number;
  reinsurance_required: number;
  comments?: string | null;
  effective_from: string;
  effective_to?: string | null;
  eligibility_mode: (typeof ELIGIBILITY_OPTIONS)[number];
  approval_required: number;
  approval_notes?: string | null;
};

type RiskTemplate = {
  id_parameters: number;
  id_branch: number;
  branch_name?: string | null;
  max_limit_per_claim?: number | string | null;
  max_limit_per_year?: number | string | null;
  default_deductible?: number | string | null;
  volatility_level: (typeof VOLATILITY_OPTIONS)[number];
  capital_intensity: (typeof CAPITAL_INTENSITY_OPTIONS)[number];
  requires_actuarial_model: number;
  net_retention_ratio?: number | string | null;
  target_loss_ratio?: number | string | null;
};

type ReinsuranceTemplate = {
  id_rule: number;
  id_branch: number;
  branch_name?: string | null;
  rule_type: (typeof REINSURANCE_TYPE_OPTIONS)[number];
  cession_rate?: number | string | null;
  retention_limit?: number | string | null;
  priority: number;
  effective_from: string;
  effective_to?: string | null;
};

type CapitalTemplate = {
  id_capital: number;
  id_branch: number;
  branch_name?: string | null;
  capital_method: (typeof CAPITAL_METHOD_OPTIONS)[number];
  capital_charge_pct?: number | string | null;
  stress_scenario?: string | null;
  effective_from: string;
  effective_to?: string | null;
};

type PolicyVersionTemplate = {
  id_version: number;
  id_policy: number;
  version_label: string;
  changed_at?: string | null;
  changed_by?: string | null;
  change_notes?: string | null;
};

type UserEditDraft = {
  id: number;
  email: string;
  status: "active" | "disabled";
  roles: string[];
  memberships: UserMembership[];
  password: string;
};

type CaptiveEditDraft = {
  id: number;
  code: string;
  name: string;
  status: "active" | "disabled";
  active_members: number;
  active_owners: number;
};

function cloneUserEditDraft(draft: UserEditDraft): UserEditDraft {
  return {
    ...draft,
    roles: [...draft.roles],
    memberships: (draft.memberships || []).map((m) => ({ ...m })),
  };
}

function cloneCaptiveEditDraft(draft: CaptiveEditDraft): CaptiveEditDraft {
  return { ...draft };
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toDateInput(value?: string | null): string {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function formatIntegerWithSpaces(value?: number | null): string {
  if (value === null || value === undefined) return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return Math.trunc(num)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function parseIntegerInput(value: string, opts?: { min?: number; max?: number }): number | null {
  const normalized = String(value || "").replace(/\s+/g, "").trim();
  if (!normalized) return null;
  const matched = normalized.match(/^-?\d+/);
  if (!matched) return null;
  let parsed = Number.parseInt(matched[0], 10);
  if (!Number.isFinite(parsed)) return null;
  if (typeof opts?.min === "number") parsed = Math.max(opts.min, parsed);
  if (typeof opts?.max === "number") parsed = Math.min(opts.max, parsed);
  return parsed;
}

type CodeOption = { value: string; label: string };

function buildCodeOptions<T>(
  items: T[],
  codeGetter: (item: T) => string,
  labelGetter: (item: T) => string | undefined,
  current: string,
  includeCurrentFallback = true
): CodeOption[] {
  const byCode = new Map<string, string>();
  for (const item of items) {
    const code = String(codeGetter(item) || "").trim();
    if (!code || byCode.has(code)) continue;
    byCode.set(code, String(labelGetter(item) || "").trim());
  }
  const cur = String(current || "").trim();
  if (includeCurrentFallback && !byCode.size && cur) byCode.set(cur, "");
  return Array.from(byCode.entries())
    .sort((a, b) => a[0].localeCompare(b[0], "fr"))
    .map(([value, name]) => ({
      value,
      label: name && name.toLowerCase() !== value.toLowerCase() ? `${value} - ${name}` : value,
    }));
}

function createDefaultSeed(today: string): SeedForm {
  return {
    categoryCode: "GEN",
    categoryName: "Général",
    categoryDescription: "",
    branchCode: "GEN",
    branchName: "Branche Générale",
    branchDescription: "",
    branchType: "IARD",
    branchIsActive: 1,
    programCode: "BASE",
    programName: "Programme de Base",
    programDescription: "",
    programIsActive: 1,
    policyIsAllowed: 1,
    policyRestriction: "NONE",
    policyFrontingRequired: 0,
    policyReinsuranceRequired: 0,
    policyComments: "Autorisée",
    policyEffectiveFrom: today,
    policyEffectiveTo: "",
    policyEligibility: "ALLOWED",
    policyApprovalRequired: 0,
    policyApprovalNotes: "",
    riskMaxLimitPerClaim: 1000000,
    riskMaxLimitPerYear: 5000000,
    riskDefaultDeductible: 25000,
    riskVolatility: "MEDIUM",
    riskCapital: "MEDIUM",
    riskRequiresActuarialModel: 1,
    riskNetRetentionRatio: 30,
    riskTargetLossRatio: 55,
    reinsuranceType: "FRONTING",
    reinsuranceCessionRate: 100,
    reinsuranceRetentionLimit: 0,
    reinsurancePriority: 1,
    reinsuranceEffectiveFrom: today,
    reinsuranceEffectiveTo: "",
    capitalMethod: "STANDARD_FORMULA",
    capitalChargePct: 18,
    capitalStressScenario: "Stress 1 an",
    capitalEffectiveFrom: today,
    capitalEffectiveTo: "",
    policyVersionLabel: "v1",
    policyVersionChangedAt: today,
    policyVersionChangedBy: "admin",
    policyVersionChangeNotes: "Initialisation automatique",
  };
}

function cloneSeed(seed: SeedForm): SeedForm {
  return { ...seed };
}

function buildSeedFromTemplates(payload: any, today: string): SeedForm {
  const next = createDefaultSeed(today);
  const firstCategory = Array.isArray(payload?.categories) ? payload.categories[0] : null;
  const firstBranch = Array.isArray(payload?.branches) ? payload.branches[0] : null;
  const firstProgram = Array.isArray(payload?.programs) ? payload.programs[0] : null;
  const firstPolicy = Array.isArray(payload?.policies) ? payload.policies[0] : null;
  const firstRisk = Array.isArray(payload?.risks) ? payload.risks[0] : null;
  const firstReinsurance = Array.isArray(payload?.reinsurance) ? payload.reinsurance[0] : null;
  const firstCapital = Array.isArray(payload?.capitals) ? payload.capitals[0] : null;
  const firstVersion = Array.isArray(payload?.policy_versions) ? payload.policy_versions[0] : null;

  if (firstCategory) {
    next.categoryCode = String(firstCategory.code || "");
    next.categoryName = String(firstCategory.name || "");
    next.categoryDescription = String(firstCategory.description || "");
  }
  if (firstBranch) {
    next.branchCode = String(firstBranch.s2_code || "");
    next.branchName = String(firstBranch.name || "");
    next.branchDescription = String(firstBranch.description || "");
    next.branchType = String(firstBranch.branch_type || next.branchType);
    next.branchIsActive = Number(firstBranch.is_active) ? 1 : 0;
  }
  if (firstProgram) {
    next.programCode = String(firstProgram.code || "");
    next.programName = String(firstProgram.name || "");
    next.programDescription = String(firstProgram.description || "");
    next.programIsActive = Number(firstProgram.is_active) ? 1 : 0;
  }
  if (firstPolicy) {
    next.policyIsAllowed = Number(firstPolicy.is_allowed) ? 1 : 0;
    next.policyRestriction = firstPolicy.restriction_level || next.policyRestriction;
    next.policyFrontingRequired = Number(firstPolicy.fronting_required) ? 1 : 0;
    next.policyReinsuranceRequired = Number(firstPolicy.reinsurance_required) ? 1 : 0;
    next.policyComments = String(firstPolicy.comments || "");
    next.policyEffectiveFrom = toDateInput(firstPolicy.effective_from) || next.policyEffectiveFrom;
    next.policyEffectiveTo = toDateInput(firstPolicy.effective_to);
    next.policyEligibility = firstPolicy.eligibility_mode || next.policyEligibility;
    next.policyApprovalRequired = Number(firstPolicy.approval_required) ? 1 : 0;
    next.policyApprovalNotes = String(firstPolicy.approval_notes || "");
  }
  if (firstRisk) {
    next.riskMaxLimitPerClaim = toNullableNumber(firstRisk.max_limit_per_claim);
    next.riskMaxLimitPerYear = toNullableNumber(firstRisk.max_limit_per_year);
    next.riskDefaultDeductible = toNullableNumber(firstRisk.default_deductible);
    next.riskVolatility = firstRisk.volatility_level || next.riskVolatility;
    next.riskCapital = firstRisk.capital_intensity || next.riskCapital;
    next.riskRequiresActuarialModel = Number(firstRisk.requires_actuarial_model) ? 1 : 0;
    next.riskNetRetentionRatio = toNullableNumber(firstRisk.net_retention_ratio);
    next.riskTargetLossRatio = toNullableNumber(firstRisk.target_loss_ratio);
  }
  if (firstReinsurance) {
    next.reinsuranceType = firstReinsurance.rule_type || next.reinsuranceType;
    next.reinsuranceCessionRate = toNullableNumber(firstReinsurance.cession_rate);
    next.reinsuranceRetentionLimit = toNullableNumber(firstReinsurance.retention_limit);
    next.reinsurancePriority = Number(firstReinsurance.priority) || 1;
    next.reinsuranceEffectiveFrom = toDateInput(firstReinsurance.effective_from) || next.reinsuranceEffectiveFrom;
    next.reinsuranceEffectiveTo = toDateInput(firstReinsurance.effective_to);
  }
  if (firstCapital) {
    next.capitalMethod = firstCapital.capital_method || next.capitalMethod;
    next.capitalChargePct = toNullableNumber(firstCapital.capital_charge_pct);
    next.capitalStressScenario = String(firstCapital.stress_scenario || "");
    next.capitalEffectiveFrom = toDateInput(firstCapital.effective_from) || next.capitalEffectiveFrom;
    next.capitalEffectiveTo = toDateInput(firstCapital.effective_to);
  }
  if (firstVersion) {
    next.policyVersionLabel = String(firstVersion.version_label || "");
    next.policyVersionChangedAt = toDateInput(firstVersion.changed_at);
    next.policyVersionChangedBy = String(firstVersion.changed_by || "");
    next.policyVersionChangeNotes = String(firstVersion.change_notes || "");
  }

  return next;
}

function validateSeed(seed: SeedForm): string | null {
  if (!seed.categoryCode.trim()) return "Le code catégorie est requis.";
  if (!seed.categoryName.trim()) return "Le nom de catégorie est requis.";
  if (!seed.branchCode.trim()) return "Le code branche est requis.";
  if (!seed.branchName.trim()) return "Le nom de branche est requis.";
  if (!seed.branchType.trim()) return "Le type de branche est requis.";
  if (!seed.programCode.trim()) return "Le code programme est requis.";
  if (!seed.programName.trim()) return "Le nom de programme est requis.";
  if (!seed.policyVersionLabel.trim()) return "Le label de version de politique est requis.";

  if (seed.policyEffectiveFrom && seed.policyEffectiveTo && seed.policyEffectiveTo < seed.policyEffectiveFrom) {
    return "Politique: la date de fin doit être postérieure à la date de début.";
  }
  if (seed.reinsuranceEffectiveFrom && seed.reinsuranceEffectiveTo && seed.reinsuranceEffectiveTo < seed.reinsuranceEffectiveFrom) {
    return "Réassurance: la date de fin doit être postérieure à la date de début.";
  }
  if (seed.capitalEffectiveFrom && seed.capitalEffectiveTo && seed.capitalEffectiveTo < seed.capitalEffectiveFrom) {
    return "Capital: la date de fin doit être postérieure à la date de début.";
  }
  if (
    seed.riskMaxLimitPerClaim !== null &&
    seed.riskMaxLimitPerYear !== null &&
    seed.riskMaxLimitPerClaim > seed.riskMaxLimitPerYear
  ) {
    return "Risque: la limite par sinistre ne peut pas dépasser la limite annuelle.";
  }
  if (seed.policyEligibility === "PROHIBITED" && Number(seed.policyIsAllowed) !== 0) {
    return "Politique: le mode Interdit impose Autorisé = Non.";
  }
  if (seed.reinsuranceType === "FRONTING" && seed.reinsuranceCessionRate !== null && Number(seed.reinsuranceCessionRate) !== 100) {
    return "Réassurance: le type Fronting impose une cession de 100%.";
  }
  return null;
}

function tokenRoles(): string[] {
  const token = typeof window !== "undefined" ? localStorage.getItem("myoptiwealth_token") : null;
  if (!token) return [];
  try {
    const payloadBase64 = token.split(".")[1] || "";
    const payload = JSON.parse(atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/")));
    return Array.isArray(payload?.roles) ? payload.roles : [];
  } catch {
    return [];
  }
}

function tokenSubject(): string {
  const token = typeof window !== "undefined" ? localStorage.getItem("myoptiwealth_token") : null;
  if (!token) return "";
  try {
    const payloadBase64 = token.split(".")[1] || "";
    const payload = JSON.parse(atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/")));
    return String(payload?.sub || "").trim();
  } catch {
    return "";
  }
}

function SuperadminContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const section = searchParams.get("section") === "captives" ? "captives" : "users";
  const captivesView =
    searchParams.get("captives_view") === "visualisation" || searchParams.get("view") === "visualisation"
      ? "visualisation"
      : "creation";
  const usersView = searchParams.get("users_view") === "visualisation" ? "visualisation" : "creation";

  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [captives, setCaptives] = useState<Captive[]>([]);
  const [users, setUsers] = useState<SuperUser[]>([]);

  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [newCaptiveCode, setNewCaptiveCode] = useState("");
  const [newCaptiveName, setNewCaptiveName] = useState("");
  const [newCaptiveStatus, setNewCaptiveStatus] = useState<"active" | "disabled">("active");
  const [seedInitMode, setSeedInitMode] = useState<"" | "existing" | "manual">("");
  const [seedStep, setSeedStep] = useState(0);
  const [seedInfoOpen, setSeedInfoOpen] = useState(false);
  const [seed, setSeed] = useState<SeedForm>(() => createDefaultSeed(today));
  const [seedFormError, setSeedFormError] = useState<string | null>(null);
  const [seedTemplatesLoading, setSeedTemplatesLoading] = useState(false);
  const [seedTemplatesError, setSeedTemplatesError] = useState<string | null>(null);
  const [seedSourceCaptiveId, setSeedSourceCaptiveId] = useState<number | "">("");
  const [categoryTemplates, setCategoryTemplates] = useState<CategoryTemplate[]>([]);
  const [branchTemplates, setBranchTemplates] = useState<BranchTemplate[]>([]);
  const [branchCategoryTemplates, setBranchCategoryTemplates] = useState<BranchCategoryTemplate[]>([]);
  const [programTemplates, setProgramTemplates] = useState<ProgramTemplate[]>([]);
  const [programBranchTemplates, setProgramBranchTemplates] = useState<ProgramBranchTemplate[]>([]);
  const [policyTemplates, setPolicyTemplates] = useState<PolicyTemplate[]>([]);
  const [riskTemplates, setRiskTemplates] = useState<RiskTemplate[]>([]);
  const [reinsuranceTemplates, setReinsuranceTemplates] = useState<ReinsuranceTemplate[]>([]);
  const [capitalTemplates, setCapitalTemplates] = useState<CapitalTemplate[]>([]);
  const [policyVersionTemplates, setPolicyVersionTemplates] = useState<PolicyVersionTemplate[]>([]);
  const [programContentModalOpen, setProgramContentModalOpen] = useState(false);

  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserStatus, setNewUserStatus] = useState<"active" | "disabled">("active");
  const [newUserRole, setNewUserRole] = useState<string>("admin");
  const [newUserCaptiveId, setNewUserCaptiveId] = useState<number | "">("");
  const [newMembershipRole, setNewMembershipRole] = useState<"owner" | "intervenant" | "manager" | "viewer">(
    "intervenant"
  );
  const [newMembershipStatus, setNewMembershipStatus] = useState<"active" | "disabled">("active");
  const [newIsOwner, setNewIsOwner] = useState(false);
  const [editingUserDraft, setEditingUserDraft] = useState<UserEditDraft | null>(null);
  const [editingUserInitial, setEditingUserInitial] = useState<UserEditDraft | null>(null);
  const [userModalLoading, setUserModalLoading] = useState(false);
  const [userModalSaving, setUserModalSaving] = useState(false);
  const [editingCaptiveDraft, setEditingCaptiveDraft] = useState<CaptiveEditDraft | null>(null);
  const [editingCaptiveInitial, setEditingCaptiveInitial] = useState<CaptiveEditDraft | null>(null);
  const [editingCaptiveSeed, setEditingCaptiveSeed] = useState<SeedForm>(() => createDefaultSeed(today));
  const [editingCaptiveSeedInitial, setEditingCaptiveSeedInitial] = useState<SeedForm>(() => createDefaultSeed(today));
  const [editingCaptiveSeedLoading, setEditingCaptiveSeedLoading] = useState(false);
  const [editingCaptiveSeedError, setEditingCaptiveSeedError] = useState<string | null>(null);
  const [captiveModalSaving, setCaptiveModalSaving] = useState(false);
  const [captiveConfirmOpen, setCaptiveConfirmOpen] = useState(false);
  const [deleteTargetCaptive, setDeleteTargetCaptive] = useState<Captive | null>(null);
  const [deleteAdminIdentifier, setDeleteAdminIdentifier] = useState("");
  const [deleteAdminPassword, setDeleteAdminPassword] = useState("");
  const [deleteModalDeleting, setDeleteModalDeleting] = useState(false);

  const canAccess = useMemo(() => isSuperAdmin, [isSuperAdmin]);
  const hasCaptiveIdentity = newCaptiveCode.trim() !== "" && newCaptiveName.trim() !== "";
  const codeAlreadyExists = useMemo(
    () => captives.some((c) => c.code.trim().toLowerCase() === newCaptiveCode.trim().toLowerCase()),
    [captives, newCaptiveCode]
  );
  const nameAlreadyExists = useMemo(
    () => captives.some((c) => c.name.trim().toLowerCase() === newCaptiveName.trim().toLowerCase()),
    [captives, newCaptiveName]
  );
  const hasIdentityConflict = codeAlreadyExists || nameAlreadyExists;
  const hasSeedChoice = seedInitMode === "existing" || seedInitMode === "manual";
  const canConfigureSeed = hasCaptiveIdentity && !hasIdentityConflict && hasSeedChoice;
  const maxSeedStep = SEED_BLOCK_TITLES.length - 1;
  const seedStepTitle = SEED_BLOCK_TITLES[seedStep] || SEED_BLOCK_TITLES[0];
  const seedStepHelp = SEED_STEP_HELP[seedStep] || [];
  const canGoPrevSeedStep = seedStep > 0;
  const canGoNextSeedStep = seedStep < maxSeedStep;
  const getCategoryOptionsForBranch = useCallback(
    (branchCode: string, currentCategoryCode: string) => {
      const selectedBranch = branchTemplates.find((item) => item.s2_code === branchCode);
      if (!selectedBranch) {
        return buildCodeOptions(categoryTemplates, (item) => item.code, (item) => item.name, currentCategoryCode);
      }
      const allowedCategoryIds = new Set(
        branchCategoryTemplates
          .filter((item) => Number(item.id_branch) === Number(selectedBranch.id_branch))
          .map((item) => Number(item.id_category))
      );
      const filtered = categoryTemplates.filter((item) => allowedCategoryIds.has(Number(item.id_category)));
      return buildCodeOptions(filtered, (item) => item.code, (item) => item.name, currentCategoryCode, false);
    },
    [categoryTemplates, branchTemplates, branchCategoryTemplates]
  );

  const getBranchOptionsForCategory = useCallback(
    (categoryCode: string, currentBranchCode: string) => {
      const selectedCategory = categoryTemplates.find((item) => item.code === categoryCode);
      if (!selectedCategory) {
        return buildCodeOptions(branchTemplates, (item) => item.s2_code, (item) => item.name, currentBranchCode);
      }
      const allowedBranchIds = new Set(
        branchCategoryTemplates
          .filter((item) => Number(item.id_category) === Number(selectedCategory.id_category))
          .map((item) => Number(item.id_branch))
      );
      const filtered = branchTemplates.filter((item) => allowedBranchIds.has(Number(item.id_branch)));
      return buildCodeOptions(filtered, (item) => item.s2_code, (item) => item.name, currentBranchCode, false);
    },
    [categoryTemplates, branchTemplates, branchCategoryTemplates]
  );

  const getProgramOptionsForBranch = useCallback(
    (branchCode: string, currentProgramCode: string) => {
      const selectedBranch = branchTemplates.find((item) => item.s2_code === branchCode);
      if (!selectedBranch) return [];
      const allowedProgramIds = new Set(
        programBranchTemplates
          .filter((item) => Number(item.id_branch) === Number(selectedBranch.id_branch))
          .map((item) => Number(item.id_program))
      );
      const filtered = programTemplates.filter((item) => allowedProgramIds.has(Number(item.id_program)));
      return buildCodeOptions(filtered, (item) => item.code, (item) => item.name, currentProgramCode, false);
    },
    [branchTemplates, programTemplates, programBranchTemplates]
  );

  const allCategoryCodeOptions = useMemo(
    () => buildCodeOptions(categoryTemplates, (item) => item.code, (item) => item.name, seed.categoryCode),
    [categoryTemplates, seed.categoryCode]
  );
  const categoryCodeOptions = useMemo(
    () =>
      seedInitMode === "manual"
        ? allCategoryCodeOptions
        : getCategoryOptionsForBranch(seed.branchCode, seed.categoryCode),
    [seedInitMode, allCategoryCodeOptions, getCategoryOptionsForBranch, seed.branchCode, seed.categoryCode]
  );
  const branchCodeOptions = useMemo(
    () => getBranchOptionsForCategory(seed.categoryCode, seed.branchCode),
    [getBranchOptionsForCategory, seed.categoryCode, seed.branchCode]
  );
  const programCodeOptions = useMemo(
    () => getProgramOptionsForBranch(seed.branchCode, seed.programCode),
    [getProgramOptionsForBranch, seed.branchCode, seed.programCode]
  );
  const selectedBranchTemplate = useMemo(
    () => branchTemplates.find((item) => item.s2_code === seed.branchCode) || null,
    [branchTemplates, seed.branchCode]
  );
  const selectedProgramTemplate = useMemo(
    () => programTemplates.find((item) => item.code === seed.programCode) || null,
    [programTemplates, seed.programCode]
  );
  const selectedProgramContent = useMemo(() => {
    if (!selectedProgramTemplate) return [];
    const selectedProgramId = Number(selectedProgramTemplate.id_program);
    const allowedBranchIds = new Set(
      programBranchTemplates
        .filter((item) => Number(item.id_program) === selectedProgramId)
        .map((item) => Number(item.id_branch))
    );
    const linkedBranches = branchTemplates
      .filter((item) => allowedBranchIds.has(Number(item.id_branch)))
      .sort((a, b) => String(a.s2_code || "").localeCompare(String(b.s2_code || ""), "fr"));

    return linkedBranches.map((branch) => {
      const policy = policyTemplates.find((item) => Number(item.id_branch) === Number(branch.id_branch)) || null;
      const policyVersions = policy
        ? policyVersionTemplates.filter((item) => Number(item.id_policy) === Number(policy.id_policy))
        : [];
      return {
        branch,
        policy,
        risk: riskTemplates.find((item) => Number(item.id_branch) === Number(branch.id_branch)) || null,
        reinsurance: reinsuranceTemplates.find((item) => Number(item.id_branch) === Number(branch.id_branch)) || null,
        capital: capitalTemplates.find((item) => Number(item.id_branch) === Number(branch.id_branch)) || null,
        policyVersions,
      };
    });
  }, [
    selectedProgramTemplate,
    programBranchTemplates,
    branchTemplates,
    policyTemplates,
    riskTemplates,
    reinsuranceTemplates,
    capitalTemplates,
    policyVersionTemplates,
  ]);
  const selectedProgramContentCounts = useMemo(() => {
    const versions = selectedProgramContent.reduce((acc, row) => acc + row.policyVersions.length, 0);
    return {
      branches: selectedProgramContent.length,
      policies: selectedProgramContent.filter((row) => row.policy).length,
      risks: selectedProgramContent.filter((row) => row.risk).length,
      reinsurance: selectedProgramContent.filter((row) => row.reinsurance).length,
      capitals: selectedProgramContent.filter((row) => row.capital).length,
      versions,
    };
  }, [selectedProgramContent]);

  const applyCategoryCode = useCallback(
    (categoryCode: string) => {
      setSeed((prev) => {
        const nextBranchOptions = getBranchOptionsForCategory(categoryCode, prev.branchCode);
        const nextBranchCode = nextBranchOptions.some((item) => item.value === prev.branchCode)
          ? prev.branchCode
          : nextBranchOptions[0]?.value || "";
        const nextProgramOptions = getProgramOptionsForBranch(nextBranchCode, prev.programCode);
        const nextProgramCode = nextProgramOptions.some((item) => item.value === prev.programCode)
          ? prev.programCode
          : nextProgramOptions[0]?.value || "";
        return { ...prev, categoryCode, branchCode: nextBranchCode, programCode: nextProgramCode };
      });
    },
    [getBranchOptionsForCategory, getProgramOptionsForBranch]
  );

  useEffect(() => {
    if (!selectedProgramTemplate && programContentModalOpen) {
      setProgramContentModalOpen(false);
    }
  }, [selectedProgramTemplate, programContentModalOpen]);

  const applyBranchCode = useCallback(
    (branchCode: string) => {
      setSeed((prev) => {
        const nextCategoryOptions = getCategoryOptionsForBranch(branchCode, prev.categoryCode);
        const nextCategoryCode = nextCategoryOptions.some((item) => item.value === prev.categoryCode)
          ? prev.categoryCode
          : nextCategoryOptions[0]?.value || "";
        const nextProgramOptions = getProgramOptionsForBranch(branchCode, prev.programCode);
        const nextProgramCode = nextProgramOptions.some((item) => item.value === prev.programCode)
          ? prev.programCode
          : nextProgramOptions[0]?.value || "";
        return { ...prev, branchCode, categoryCode: nextCategoryCode, programCode: nextProgramCode };
      });
    },
    [getCategoryOptionsForBranch, getProgramOptionsForBranch]
  );

  const editingAllCategoryCodeOptions = useMemo(
    () => buildCodeOptions(categoryTemplates, (item) => item.code, (item) => item.name, editingCaptiveSeed.categoryCode),
    [categoryTemplates, editingCaptiveSeed.categoryCode]
  );
  const editingCategoryCodeOptions = useMemo(() => {
    const filtered = getCategoryOptionsForBranch(editingCaptiveSeed.branchCode, editingCaptiveSeed.categoryCode);
    return filtered.length ? filtered : editingAllCategoryCodeOptions;
  }, [getCategoryOptionsForBranch, editingCaptiveSeed.branchCode, editingCaptiveSeed.categoryCode, editingAllCategoryCodeOptions]);
  const editingBranchCodeOptions = useMemo(
    () => getBranchOptionsForCategory(editingCaptiveSeed.categoryCode, editingCaptiveSeed.branchCode),
    [getBranchOptionsForCategory, editingCaptiveSeed.categoryCode, editingCaptiveSeed.branchCode]
  );
  const editingProgramCodeOptions = useMemo(
    () => getProgramOptionsForBranch(editingCaptiveSeed.branchCode, editingCaptiveSeed.programCode),
    [getProgramOptionsForBranch, editingCaptiveSeed.branchCode, editingCaptiveSeed.programCode]
  );
  const editingSelectedBranchTemplate = useMemo(
    () => branchTemplates.find((item) => item.s2_code === editingCaptiveSeed.branchCode) || null,
    [branchTemplates, editingCaptiveSeed.branchCode]
  );

  const applyEditCategoryCode = useCallback(
    (categoryCode: string) => {
      setEditingCaptiveSeed((prev) => {
        const nextBranchOptions = getBranchOptionsForCategory(categoryCode, prev.branchCode);
        const nextBranchCode = nextBranchOptions.some((item) => item.value === prev.branchCode)
          ? prev.branchCode
          : nextBranchOptions[0]?.value || "";
        const nextProgramOptions = getProgramOptionsForBranch(nextBranchCode, prev.programCode);
        const nextProgramCode = nextProgramOptions.some((item) => item.value === prev.programCode)
          ? prev.programCode
          : nextProgramOptions[0]?.value || "";
        return { ...prev, categoryCode, branchCode: nextBranchCode, programCode: nextProgramCode };
      });
    },
    [getBranchOptionsForCategory, getProgramOptionsForBranch]
  );

  const applyEditBranchCode = useCallback(
    (branchCode: string) => {
      setEditingCaptiveSeed((prev) => {
        const nextCategoryOptions = getCategoryOptionsForBranch(branchCode, prev.categoryCode);
        const nextCategoryCode = nextCategoryOptions.some((item) => item.value === prev.categoryCode)
          ? prev.categoryCode
          : nextCategoryOptions[0]?.value || "";
        const nextProgramOptions = getProgramOptionsForBranch(branchCode, prev.programCode);
        const nextProgramCode = nextProgramOptions.some((item) => item.value === prev.programCode)
          ? prev.programCode
          : nextProgramOptions[0]?.value || "";
        return { ...prev, branchCode, categoryCode: nextCategoryCode, programCode: nextProgramCode };
      });
    },
    [getCategoryOptionsForBranch, getProgramOptionsForBranch]
  );

  const loadSeedTemplates = useCallback(async (captiveId?: number | "" | "all") => {
    setSeedTemplatesLoading(true);
    setSeedTemplatesError(null);
    try {
      const query =
        captiveId === "all" ? "?scope=all" : captiveId ? `?captive_id=${Number(captiveId)}` : "";
      const payload = await apiRequest<any>(`/api/superadmin/referential-templates${query}`);
      setCategoryTemplates(Array.isArray(payload?.categories) ? payload.categories : []);
      setBranchTemplates(Array.isArray(payload?.branches) ? payload.branches : []);
      setBranchCategoryTemplates(Array.isArray(payload?.branch_categories) ? payload.branch_categories : []);
      setProgramTemplates(Array.isArray(payload?.programs) ? payload.programs : []);
      setProgramBranchTemplates(Array.isArray(payload?.program_branches) ? payload.program_branches : []);
      setPolicyTemplates(Array.isArray(payload?.policies) ? payload.policies : []);
      setRiskTemplates(Array.isArray(payload?.risks) ? payload.risks : []);
      setReinsuranceTemplates(Array.isArray(payload?.reinsurance) ? payload.reinsurance : []);
      setCapitalTemplates(Array.isArray(payload?.capitals) ? payload.capitals : []);
      setPolicyVersionTemplates(Array.isArray(payload?.policy_versions) ? payload.policy_versions : []);
    } catch {
      setCategoryTemplates([]);
      setBranchTemplates([]);
      setBranchCategoryTemplates([]);
      setProgramTemplates([]);
      setProgramBranchTemplates([]);
      setPolicyTemplates([]);
      setRiskTemplates([]);
      setReinsuranceTemplates([]);
      setCapitalTemplates([]);
      setPolicyVersionTemplates([]);
      setSeedTemplatesError("Impossible de charger les éléments existants du référentiel.");
    } finally {
      setSeedTemplatesLoading(false);
    }
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [captivesData, usersData] = await Promise.all([
        apiRequest<Captive[]>("/api/superadmin/captives"),
        apiRequest<SuperUser[]>("/api/superadmin/users"),
      ]);
      setCaptives(captivesData);
      setUsers(usersData);
      if (!seedSourceCaptiveId && captivesData.length) {
        const preferred = [...captivesData].sort(
          (a, b) => (Number(b.active_members || 0) - Number(a.active_members || 0)) || (Number(b.id) - Number(a.id))
        )[0];
        setSeedSourceCaptiveId(preferred.id);
      }
    } catch (err: any) {
      setError(err?.message || "Chargement impossible.");
    } finally {
      setLoading(false);
    }
  }, [seedSourceCaptiveId]);

  useEffect(() => {
    setIsSuperAdmin(tokenRoles().includes("super_admin"));
  }, []);

  useEffect(() => {
    if (isSuperAdmin) {
      loadData();
    }
  }, [isSuperAdmin, loadData]);

  useEffect(() => {
    if (!isSuperAdmin || seedInitMode !== "existing" || !seedSourceCaptiveId) return;
    loadSeedTemplates(Number(seedSourceCaptiveId));
  }, [isSuperAdmin, seedInitMode, seedSourceCaptiveId, loadSeedTemplates]);

  useEffect(() => {
    if (!isSuperAdmin || seedInitMode !== "manual" || !hasCaptiveIdentity) return;
    loadSeedTemplates("all");
  }, [isSuperAdmin, seedInitMode, hasCaptiveIdentity, loadSeedTemplates]);

  useEffect(() => {
    if (seed.policyEligibility === "PROHIBITED" && seed.policyIsAllowed !== 0) {
      setSeed((prev) => ({ ...prev, policyIsAllowed: 0 }));
    }
  }, [seed.policyEligibility, seed.policyIsAllowed]);

  useEffect(() => {
    if (seed.reinsuranceType === "FRONTING" && Number(seed.reinsuranceCessionRate) !== 100) {
      setSeed((prev) => ({ ...prev, reinsuranceCessionRate: 100 }));
    }
  }, [seed.reinsuranceType, seed.reinsuranceCessionRate]);

  useEffect(() => {
    if (!seedFormError) return;
    const currentError = validateSeed(seed);
    if (!currentError) setSeedFormError(null);
  }, [seed, seedFormError]);

  useEffect(() => {
    if (!categoryTemplates.length && !branchTemplates.length && !programTemplates.length) return;
    setSeed((prev) => {
      const nextCategoryOptions = getCategoryOptionsForBranch(prev.branchCode, prev.categoryCode);
      const nextCategoryCode = nextCategoryOptions.some((item) => item.value === prev.categoryCode)
        ? prev.categoryCode
        : nextCategoryOptions[0]?.value || "";
      const nextBranchOptions = getBranchOptionsForCategory(nextCategoryCode, prev.branchCode);
      const nextBranchCode = nextBranchOptions.some((item) => item.value === prev.branchCode)
        ? prev.branchCode
        : nextBranchOptions[0]?.value || "";
      const nextProgramOptions = getProgramOptionsForBranch(nextBranchCode, prev.programCode);
      const nextProgramCode = nextProgramOptions.some((item) => item.value === prev.programCode)
        ? prev.programCode
        : nextProgramOptions[0]?.value || "";
      if (
        nextCategoryCode === prev.categoryCode &&
        nextBranchCode === prev.branchCode &&
        nextProgramCode === prev.programCode
      ) {
        return prev;
      }
      return {
        ...prev,
        categoryCode: nextCategoryCode,
        branchCode: nextBranchCode,
        programCode: nextProgramCode,
      };
    });
  }, [
    categoryTemplates,
    branchTemplates,
    programTemplates,
    branchCategoryTemplates,
    programBranchTemplates,
    getCategoryOptionsForBranch,
    getBranchOptionsForCategory,
    getProgramOptionsForBranch,
  ]);

  useEffect(() => {
    const selected = categoryTemplates.find((item) => item.code === seed.categoryCode);
    if (!selected) return;
    setSeed((prev) => {
      if (
        prev.categoryName === selected.name &&
        prev.categoryDescription === (selected.description || "")
      ) {
        return prev;
      }
      return {
        ...prev,
        categoryName: selected.name,
        categoryDescription: selected.description || "",
      };
    });
  }, [seed.categoryCode, categoryTemplates]);

  useEffect(() => {
    const selectedBranch = branchTemplates.find((item) => item.s2_code === seed.branchCode);
    if (!selectedBranch) return;
    setSeed((prev) => {
      let next: SeedForm = {
        ...prev,
        branchName: selectedBranch.name,
        branchDescription: selectedBranch.description || "",
        branchType: selectedBranch.branch_type,
        branchIsActive: Number(selectedBranch.is_active) ? 1 : 0,
      };

      const branchPolicy = policyTemplates.find((item) => Number(item.id_branch) === Number(selectedBranch.id_branch));
      if (branchPolicy) {
        next = {
          ...next,
          policyIsAllowed: Number(branchPolicy.is_allowed) ? 1 : 0,
          policyRestriction: branchPolicy.restriction_level,
          policyFrontingRequired: Number(branchPolicy.fronting_required) ? 1 : 0,
          policyReinsuranceRequired: Number(branchPolicy.reinsurance_required) ? 1 : 0,
          policyComments: branchPolicy.comments || "",
          policyEffectiveFrom: toDateInput(branchPolicy.effective_from),
          policyEffectiveTo: toDateInput(branchPolicy.effective_to),
          policyEligibility: branchPolicy.eligibility_mode,
          policyApprovalRequired: Number(branchPolicy.approval_required) ? 1 : 0,
          policyApprovalNotes: branchPolicy.approval_notes || "",
        };

        const policyVersion = policyVersionTemplates.find((item) => Number(item.id_policy) === Number(branchPolicy.id_policy));
        if (policyVersion) {
          next = {
            ...next,
            policyVersionLabel: policyVersion.version_label,
            policyVersionChangedAt: toDateInput(policyVersion.changed_at),
            policyVersionChangedBy: policyVersion.changed_by || "",
            policyVersionChangeNotes: policyVersion.change_notes || "",
          };
        }
      }

      const branchRisk = riskTemplates.find((item) => Number(item.id_branch) === Number(selectedBranch.id_branch));
      if (branchRisk) {
        next = {
          ...next,
          riskMaxLimitPerClaim: toNullableNumber(branchRisk.max_limit_per_claim),
          riskMaxLimitPerYear: toNullableNumber(branchRisk.max_limit_per_year),
          riskDefaultDeductible: toNullableNumber(branchRisk.default_deductible),
          riskVolatility: branchRisk.volatility_level,
          riskCapital: branchRisk.capital_intensity,
          riskRequiresActuarialModel: Number(branchRisk.requires_actuarial_model) ? 1 : 0,
          riskNetRetentionRatio: toNullableNumber(branchRisk.net_retention_ratio),
          riskTargetLossRatio: toNullableNumber(branchRisk.target_loss_ratio),
        };
      }

      const branchReinsurance = reinsuranceTemplates.find(
        (item) => Number(item.id_branch) === Number(selectedBranch.id_branch)
      );
      if (branchReinsurance) {
        next = {
          ...next,
          reinsuranceType: branchReinsurance.rule_type,
          reinsuranceCessionRate: toNullableNumber(branchReinsurance.cession_rate),
          reinsuranceRetentionLimit: toNullableNumber(branchReinsurance.retention_limit),
          reinsurancePriority: Number(branchReinsurance.priority) || 1,
          reinsuranceEffectiveFrom: toDateInput(branchReinsurance.effective_from),
          reinsuranceEffectiveTo: toDateInput(branchReinsurance.effective_to),
        };
      }

      const branchCapital = capitalTemplates.find((item) => Number(item.id_branch) === Number(selectedBranch.id_branch));
      if (branchCapital) {
        next = {
          ...next,
          capitalMethod: branchCapital.capital_method,
          capitalChargePct: toNullableNumber(branchCapital.capital_charge_pct),
          capitalStressScenario: branchCapital.stress_scenario || "",
          capitalEffectiveFrom: toDateInput(branchCapital.effective_from),
          capitalEffectiveTo: toDateInput(branchCapital.effective_to),
        };
      }

      return next;
    });
  }, [seed.branchCode, branchTemplates, policyTemplates, riskTemplates, reinsuranceTemplates, capitalTemplates, policyVersionTemplates]);

  useEffect(() => {
    const selected = programTemplates.find((item) => item.code === seed.programCode);
    if (!selected) return;
    setSeed((prev) => {
      if (
        prev.programName === selected.name &&
        prev.programDescription === (selected.description || "") &&
        prev.programIsActive === (Number(selected.is_active) ? 1 : 0)
      ) {
        return prev;
      }
      return {
        ...prev,
        programName: selected.name,
        programDescription: selected.description || "",
        programIsActive: Number(selected.is_active) ? 1 : 0,
      };
    });
  }, [seed.programCode, programTemplates]);

  useEffect(() => {
    if (!canConfigureSeed && seedStep !== 0) {
      setSeedStep(0);
      return;
    }
    if (seedStep > maxSeedStep) setSeedStep(0);
  }, [canConfigureSeed, seedStep, maxSeedStep]);

  useEffect(() => {
    setSeedInfoOpen(false);
  }, [seedStep]);

  const createCaptive = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setSeedFormError(null);
    if (hasIdentityConflict) {
      if (codeAlreadyExists && nameAlreadyExists) {
        setError("Le code et le nom de captive existent déjà.");
      } else if (codeAlreadyExists) {
        setError("Ce code de captive existe déjà.");
      } else {
        setError("Ce nom de captive existe déjà.");
      }
      return;
    }
    if (!hasSeedChoice) {
      setError("Choisis si tu veux initialiser le référentiel depuis une captive existante.");
      return;
    }
    if (seedInitMode === "existing" && !seedSourceCaptiveId) {
      setError("Sélectionne une captive source pour initialiser le référentiel.");
      return;
    }
    const validationError = validateSeed(seed);
    if (validationError) {
      setSeedFormError(validationError);
      return;
    }
    try {
      const referentialSeed = {
        enabled: 1,
        category: {
          code: seed.categoryCode,
          name: seed.categoryName,
          description: seed.categoryDescription || null,
        },
        branch: {
          s2_code: seed.branchCode,
          name: seed.branchName,
          description: seed.branchDescription || null,
          branch_type: seed.branchType,
          is_active: seed.branchIsActive,
        },
        program: {
          code: seed.programCode,
          name: seed.programName,
          description: seed.programDescription || null,
          is_active: seed.programIsActive,
        },
        policy: {
          is_allowed: seed.policyEligibility === "PROHIBITED" ? 0 : seed.policyIsAllowed,
          restriction_level: seed.policyRestriction,
          fronting_required: seed.policyFrontingRequired,
          reinsurance_required: seed.policyReinsuranceRequired,
          comments: seed.policyComments || null,
          effective_from: seed.policyEffectiveFrom,
          effective_to: seed.policyEffectiveTo || null,
          eligibility_mode: seed.policyEligibility,
          approval_required: seed.policyApprovalRequired,
          approval_notes: seed.policyApprovalNotes || null,
        },
        risk: {
          max_limit_per_claim: seed.riskMaxLimitPerClaim,
          max_limit_per_year: seed.riskMaxLimitPerYear,
          default_deductible: seed.riskDefaultDeductible,
          volatility_level: seed.riskVolatility,
          capital_intensity: seed.riskCapital,
          requires_actuarial_model: seed.riskRequiresActuarialModel,
          net_retention_ratio: seed.riskNetRetentionRatio,
          target_loss_ratio: seed.riskTargetLossRatio,
        },
        reinsurance: {
          rule_type: seed.reinsuranceType,
          cession_rate: seed.reinsuranceCessionRate,
          retention_limit: seed.reinsuranceRetentionLimit,
          priority: seed.reinsurancePriority,
          effective_from: seed.reinsuranceEffectiveFrom,
          effective_to: seed.reinsuranceEffectiveTo || null,
        },
        capital: {
          capital_method: seed.capitalMethod,
          capital_charge_pct: seed.capitalChargePct,
          stress_scenario: seed.capitalStressScenario || null,
          effective_from: seed.capitalEffectiveFrom,
          effective_to: seed.capitalEffectiveTo || null,
        },
        policy_version: {
          version_label: seed.policyVersionLabel,
          changed_at: seed.policyVersionChangedAt || null,
          changed_by: seed.policyVersionChangedBy || null,
          change_notes: seed.policyVersionChangeNotes || null,
        },
      };

      await apiRequest("/api/superadmin/captives", "POST", {
        code: newCaptiveCode,
        name: newCaptiveName,
        status: newCaptiveStatus,
        referential_seed: referentialSeed,
      });
      setNewCaptiveCode("");
      setNewCaptiveName("");
      setNewCaptiveStatus("active");
      setSeedInitMode("");
      setSeedStep(0);
      setSeedSourceCaptiveId("");
      setSeed(createDefaultSeed(today));
      setSeedFormError(null);
      setMessage("Captive créée.");
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Création captive impossible.");
    }
  };

  const abandonCaptiveCreation = () => {
    setError(null);
    setMessage(null);
    setNewCaptiveCode("");
    setNewCaptiveName("");
    setNewCaptiveStatus("active");
    setSeedInitMode("");
    setSeedStep(0);
    setSeedInfoOpen(false);
    setSeed(createDefaultSeed(today));
    setSeedFormError(null);
    setSeedTemplatesError(null);
    setSeedSourceCaptiveId("");
    setProgramContentModalOpen(false);
    router.push("/superadmin?section=captives&view=visualisation");
  };

  const createUser = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (newUserCaptiveId === "") {
      setError("Sélectionne une captive pour rattacher l'utilisateur.");
      return;
    }

    try {
      await apiRequest("/api/superadmin/users", "POST", {
        email: newUserEmail,
        password: newUserPassword,
        status: newUserStatus,
        roles: [newUserRole],
        memberships: [
          {
            captive_id: Number(newUserCaptiveId),
            role: newMembershipRole,
            is_owner: newMembershipRole === "owner" || newIsOwner ? 1 : 0,
            status: newMembershipStatus,
          },
        ],
      });
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserStatus("active");
      setNewUserRole("admin");
      setNewUserCaptiveId("");
      setNewMembershipRole("intervenant");
      setNewMembershipStatus("active");
      setNewIsOwner(false);
      setMessage("Utilisateur créé et rattaché.");
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Création utilisateur impossible.");
    }
  };

  const openUserEditor = async (userId: number) => {
    setError(null);
    setMessage(null);
    setUserModalLoading(true);
    try {
      const user = await apiRequest<SuperUser>(`/api/superadmin/users/${userId}`);
      const draft: UserEditDraft = {
        id: user.id,
        email: user.email || "",
        status: user.status || "active",
        roles: Array.isArray(user.roles) ? [...user.roles] : [],
        memberships: Array.isArray(user.memberships) ? user.memberships.map((m) => ({ ...m })) : [],
        password: "",
      };
      setEditingUserInitial(cloneUserEditDraft(draft));
      setEditingUserDraft(cloneUserEditDraft(draft));
    } catch (err: any) {
      setError(err?.message || "Chargement utilisateur impossible.");
    } finally {
      setUserModalLoading(false);
    }
  };

  const closeUserEditor = () => {
    setEditingUserDraft(null);
    setEditingUserInitial(null);
    setUserModalSaving(false);
  };

  const abandonUserChanges = () => {
    if (!editingUserInitial) return;
    const reset = cloneUserEditDraft(editingUserInitial);
    reset.password = "";
    setEditingUserDraft(reset);
  };

  const saveUserChanges = async () => {
    if (!editingUserDraft) return;
    if (!editingUserDraft.email.trim()) {
      setError("L'email utilisateur est requis.");
      return;
    }
    setError(null);
    setMessage(null);
    setUserModalSaving(true);
    try {
      const payload: Record<string, any> = {
        email: editingUserDraft.email.trim(),
        status: editingUserDraft.status,
        roles: editingUserDraft.roles,
      };
      if (editingUserDraft.password.trim()) {
        payload.password = editingUserDraft.password.trim();
      }
      await apiRequest(`/api/superadmin/users/${editingUserDraft.id}`, "PATCH", payload);
      closeUserEditor();
      setMessage("Utilisateur mis à jour.");
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Modification utilisateur impossible.");
    } finally {
      setUserModalSaving(false);
    }
  };

  const openCaptiveEditor = async (captive: Captive) => {
    setError(null);
    setMessage(null);
    setEditingCaptiveSeedError(null);
    const draft: CaptiveEditDraft = {
      id: captive.id,
      code: captive.code || "",
      name: captive.name || "",
      status: captive.status || "active",
      active_members: Number(captive.active_members || 0),
      active_owners: Number(captive.active_owners || 0),
    };
    setEditingCaptiveInitial(cloneCaptiveEditDraft(draft));
    setEditingCaptiveDraft(cloneCaptiveEditDraft(draft));
    setCaptiveConfirmOpen(false);
    setEditingCaptiveSeedLoading(true);
    try {
      const captivePayload = await apiRequest<any>(
        `/api/superadmin/referential-templates?captive_id=${Number(captive.id)}`
      );
      let optionsPayload = captivePayload;
      try {
        const globalPayload = await apiRequest<any>("/api/superadmin/referential-templates?scope=all");
        optionsPayload = globalPayload;
      } catch {
        // Keep captive-specific templates as fallback if global referential is unavailable.
      }
      setCategoryTemplates(Array.isArray(optionsPayload?.categories) ? optionsPayload.categories : []);
      setBranchTemplates(Array.isArray(optionsPayload?.branches) ? optionsPayload.branches : []);
      setBranchCategoryTemplates(Array.isArray(optionsPayload?.branch_categories) ? optionsPayload.branch_categories : []);
      setProgramTemplates(Array.isArray(optionsPayload?.programs) ? optionsPayload.programs : []);
      setProgramBranchTemplates(Array.isArray(optionsPayload?.program_branches) ? optionsPayload.program_branches : []);
      setPolicyTemplates(Array.isArray(optionsPayload?.policies) ? optionsPayload.policies : []);
      setRiskTemplates(Array.isArray(optionsPayload?.risks) ? optionsPayload.risks : []);
      setReinsuranceTemplates(Array.isArray(optionsPayload?.reinsurance) ? optionsPayload.reinsurance : []);
      setCapitalTemplates(Array.isArray(optionsPayload?.capitals) ? optionsPayload.capitals : []);
      setPolicyVersionTemplates(Array.isArray(optionsPayload?.policy_versions) ? optionsPayload.policy_versions : []);
      const loadedSeed = buildSeedFromTemplates(captivePayload, today);
      setEditingCaptiveSeed(cloneSeed(loadedSeed));
      setEditingCaptiveSeedInitial(cloneSeed(loadedSeed));
    } catch {
      const fallback = createDefaultSeed(today);
      setCategoryTemplates([]);
      setBranchTemplates([]);
      setBranchCategoryTemplates([]);
      setProgramTemplates([]);
      setProgramBranchTemplates([]);
      setPolicyTemplates([]);
      setRiskTemplates([]);
      setReinsuranceTemplates([]);
      setCapitalTemplates([]);
      setPolicyVersionTemplates([]);
      setEditingCaptiveSeed(cloneSeed(fallback));
      setEditingCaptiveSeedInitial(cloneSeed(fallback));
      setEditingCaptiveSeedError("Impossible de charger le référentiel existant pour modification.");
    } finally {
      setEditingCaptiveSeedLoading(false);
    }
  };

  const closeCaptiveEditor = () => {
    setEditingCaptiveDraft(null);
    setEditingCaptiveInitial(null);
    setCaptiveModalSaving(false);
    setCaptiveConfirmOpen(false);
    setEditingCaptiveSeedLoading(false);
    setEditingCaptiveSeedError(null);
  };

  const abandonCaptiveChanges = () => {
    if (!editingCaptiveInitial) return;
    setEditingCaptiveDraft(cloneCaptiveEditDraft(editingCaptiveInitial));
    setEditingCaptiveSeed(cloneSeed(editingCaptiveSeedInitial));
    setCaptiveConfirmOpen(false);
    setEditingCaptiveSeedError(null);
  };

  const requestCaptiveSaveConfirmation = () => {
    if (!editingCaptiveDraft) return;
    if (!editingCaptiveDraft.code.trim() || !editingCaptiveDraft.name.trim()) {
      setError("Le code et le nom de la captive sont requis.");
      return;
    }
    const validationError = validateSeed(editingCaptiveSeed);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setCaptiveConfirmOpen(true);
  };

  const saveCaptiveChanges = async () => {
    if (!editingCaptiveDraft) return;
    if (!editingCaptiveDraft.code.trim() || !editingCaptiveDraft.name.trim()) {
      setError("Le code et le nom de la captive sont requis.");
      return;
    }
    const validationError = validateSeed(editingCaptiveSeed);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setMessage(null);
    setCaptiveModalSaving(true);
    try {
      const referentialSeed = {
        enabled: 1,
        category: {
          code: editingCaptiveSeed.categoryCode,
          name: editingCaptiveSeed.categoryName,
          description: editingCaptiveSeed.categoryDescription || null,
        },
        branch: {
          s2_code: editingCaptiveSeed.branchCode,
          name: editingCaptiveSeed.branchName,
          description: editingCaptiveSeed.branchDescription || null,
          branch_type: editingCaptiveSeed.branchType,
          is_active: editingCaptiveSeed.branchIsActive,
        },
        program: {
          code: editingCaptiveSeed.programCode,
          name: editingCaptiveSeed.programName,
          description: editingCaptiveSeed.programDescription || null,
          is_active: editingCaptiveSeed.programIsActive,
        },
        policy: {
          is_allowed: editingCaptiveSeed.policyEligibility === "PROHIBITED" ? 0 : editingCaptiveSeed.policyIsAllowed,
          restriction_level: editingCaptiveSeed.policyRestriction,
          fronting_required: editingCaptiveSeed.policyFrontingRequired,
          reinsurance_required: editingCaptiveSeed.policyReinsuranceRequired,
          comments: editingCaptiveSeed.policyComments || null,
          effective_from: editingCaptiveSeed.policyEffectiveFrom,
          effective_to: editingCaptiveSeed.policyEffectiveTo || null,
          eligibility_mode: editingCaptiveSeed.policyEligibility,
          approval_required: editingCaptiveSeed.policyApprovalRequired,
          approval_notes: editingCaptiveSeed.policyApprovalNotes || null,
        },
        risk: {
          max_limit_per_claim: editingCaptiveSeed.riskMaxLimitPerClaim,
          max_limit_per_year: editingCaptiveSeed.riskMaxLimitPerYear,
          default_deductible: editingCaptiveSeed.riskDefaultDeductible,
          volatility_level: editingCaptiveSeed.riskVolatility,
          capital_intensity: editingCaptiveSeed.riskCapital,
          requires_actuarial_model: editingCaptiveSeed.riskRequiresActuarialModel,
          net_retention_ratio: editingCaptiveSeed.riskNetRetentionRatio,
          target_loss_ratio: editingCaptiveSeed.riskTargetLossRatio,
        },
        reinsurance: {
          rule_type: editingCaptiveSeed.reinsuranceType,
          cession_rate: editingCaptiveSeed.reinsuranceCessionRate,
          retention_limit: editingCaptiveSeed.reinsuranceRetentionLimit,
          priority: editingCaptiveSeed.reinsurancePriority,
          effective_from: editingCaptiveSeed.reinsuranceEffectiveFrom,
          effective_to: editingCaptiveSeed.reinsuranceEffectiveTo || null,
        },
        capital: {
          capital_method: editingCaptiveSeed.capitalMethod,
          capital_charge_pct: editingCaptiveSeed.capitalChargePct,
          stress_scenario: editingCaptiveSeed.capitalStressScenario || null,
          effective_from: editingCaptiveSeed.capitalEffectiveFrom,
          effective_to: editingCaptiveSeed.capitalEffectiveTo || null,
        },
        policy_version: {
          version_label: editingCaptiveSeed.policyVersionLabel,
          changed_at: editingCaptiveSeed.policyVersionChangedAt || null,
          changed_by: editingCaptiveSeed.policyVersionChangedBy || null,
          change_notes: editingCaptiveSeed.policyVersionChangeNotes || null,
        },
      };
      await apiRequest(`/api/superadmin/captives/${editingCaptiveDraft.id}`, "PATCH", {
        code: editingCaptiveDraft.code.trim(),
        name: editingCaptiveDraft.name.trim(),
        status: editingCaptiveDraft.status,
        referential_seed: referentialSeed,
      });
      closeCaptiveEditor();
      setMessage("Captive mise à jour.");
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Modification captive impossible.");
    } finally {
      setCaptiveModalSaving(false);
    }
  };

  const openDeleteCaptiveModal = (captive: Captive) => {
    setError(null);
    setMessage(null);
    setDeleteTargetCaptive(captive);
    setDeleteAdminIdentifier(tokenSubject());
    setDeleteAdminPassword("");
  };

  const closeDeleteCaptiveModal = () => {
    setDeleteTargetCaptive(null);
    setDeleteAdminIdentifier("");
    setDeleteAdminPassword("");
    setDeleteModalDeleting(false);
  };

  const confirmDeleteCaptive = async () => {
    if (!deleteTargetCaptive) return;
    if (!deleteAdminIdentifier.trim() || !deleteAdminPassword.trim()) {
      setError("Identifiant et mot de passe du super administrateur requis.");
      return;
    }
    setError(null);
    setMessage(null);
    setDeleteModalDeleting(true);
    try {
      await apiRequest(`/api/superadmin/captives/${deleteTargetCaptive.id}`, "DELETE", {
        admin_identifier: deleteAdminIdentifier.trim(),
        admin_password: deleteAdminPassword,
      });
      if (Number(seedSourceCaptiveId) === Number(deleteTargetCaptive.id)) setSeedSourceCaptiveId("");
      if (editingCaptiveDraft && Number(editingCaptiveDraft.id) === Number(deleteTargetCaptive.id)) closeCaptiveEditor();
      closeDeleteCaptiveModal();
      setMessage("Captive supprimée.");
      await loadData();
    } catch (err: any) {
      const apiError = String(err?.message || "");
      if (apiError === "invalid_superadmin_identifier") {
        setError("Identifiant super administrateur invalide.");
      } else if (apiError === "invalid_superadmin_password") {
        setError("Mot de passe super administrateur invalide.");
      } else if (apiError === "missing_superadmin_credentials" || apiError === "validation_error") {
        setError("Identifiant et mot de passe super administrateur requis.");
      } else if (apiError === "superadmin_not_active") {
        setError("Le super administrateur utilisé pour valider est inactif.");
      } else {
        setError(apiError || "Suppression captive impossible.");
      }
    } finally {
      setDeleteModalDeleting(false);
    }
  };

  return (
    <RequireAuth>
      <div className="space-y-6 [&_select]:h-10">
        <PageTitle
          title="Superadministration"
          description="Gère les captives et les utilisateurs globaux via les sections du sous-menu."
        />

        {!canAccess ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Cette section est réservée aux comptes avec le rôle <code>super_admin</code>.
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}
        {message ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div>
        ) : null}

        {canAccess && section === "captives" ? (
          <div className="space-y-4">
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
              <Link
                href="/superadmin?section=captives&view=creation"
                className={`rounded-md px-3 py-1.5 text-sm ${
                  captivesView === "creation"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Création
              </Link>
              <Link
                href="/superadmin?section=captives&view=visualisation"
                className={`rounded-md px-3 py-1.5 text-sm ${
                  captivesView === "visualisation"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Visualisation
              </Link>
            </div>

            {captivesView === "creation" ? (
            <form onSubmit={createCaptive} className="rounded-xl border border-slate-300 bg-white p-5 space-y-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-800">Création de captive</h2>
              <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                Après le code et le nom, choisis si le référentiel doit partir d&apos;une captive existante ou être saisi
                manuellement bloc par bloc.
              </p>
              <input
                required
                type="text"
                placeholder="Code captive"
                value={newCaptiveCode}
                onChange={(e) => setNewCaptiveCode(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                required
                type="text"
                placeholder="Nom de captive"
                value={newCaptiveName}
                onChange={(e) => setNewCaptiveName(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={newCaptiveStatus}
                onChange={(e) => setNewCaptiveStatus(e.target.value as "active" | "disabled")}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="active">active</option>
                <option value="disabled">disabled</option>
              </select>

              {hasCaptiveIdentity && hasIdentityConflict ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {codeAlreadyExists && nameAlreadyExists
                    ? "Le code et le nom de captive existent déjà."
                    : codeAlreadyExists
                      ? "Ce code de captive existe déjà."
                      : "Ce nom de captive existe déjà."}
                </div>
              ) : null}

              {hasCaptiveIdentity && !hasIdentityConflict ? (
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm text-slate-700">Initialiser le référentiel avec une captive existante ?</p>
                  <div className="flex flex-wrap gap-2">
                    <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
                      <input
                        type="radio"
                        name="seed-init-mode"
                        checked={seedInitMode === "existing"}
                        onChange={() => {
                          setSeedInitMode("existing");
                          setSeedStep(0);
                          if (!seedSourceCaptiveId && captives.length) setSeedSourceCaptiveId(captives[0].id);
                        }}
                      />
                      Oui
                    </label>
                    <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
                      <input
                        type="radio"
                        name="seed-init-mode"
                        checked={seedInitMode === "manual"}
                        onChange={() => {
                          setSeedInitMode("manual");
                          setSeedStep(0);
                          setSeed(createDefaultSeed(today));
                          setSeedFormError(null);
                          if (!seedSourceCaptiveId && captives.length) setSeedSourceCaptiveId(captives[0].id);
                        }}
                      />
                      Non
                    </label>
                  </div>

                  {seedInitMode === "existing" ? (
                    captives.length > 0 ? (
                      <label className="block text-xs text-slate-600">
                        Captive source du référentiel
                        <select
                          value={seedSourceCaptiveId}
                          onChange={(e) => setSeedSourceCaptiveId(e.target.value ? Number(e.target.value) : "")}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          {captives.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.code} - {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Aucune captive existante disponible comme source.
                      </div>
                    )
                  ) : null}
                </div>
              ) : (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {hasIdentityConflict
                    ? "Modifie le code ou le nom de la captive pour poursuivre."
                    : "Renseigne d&apos;abord le code et le nom de la captive pour poursuivre."}
                </div>
              )}

              {canConfigureSeed ? (
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  {seedTemplatesLoading ? (
                    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
                      Chargement des codes existants...
                    </div>
                  ) : null}
                  {seedTemplatesError ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      {seedTemplatesError}
                    </div>
                  ) : null}
                  <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs text-slate-600">
                        Étape {seedStep + 1} / {SEED_BLOCK_TITLES.length}: <span className="font-semibold">{seedStepTitle}</span>
                      </p>
                      <div className="relative flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSeedStep((prev) => Math.max(0, prev - 1))}
                          disabled={!canGoPrevSeedStep}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Précédent
                        </button>
                        <button
                          type="button"
                          onClick={() => setSeedStep((prev) => Math.min(maxSeedStep, prev + 1))}
                          disabled={!canGoNextSeedStep}
                          className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Suivant
                        </button>
                        <button
                          type="button"
                          onClick={() => setSeedInfoOpen((prev) => !prev)}
                          aria-label={`Informations étape ${seedStep + 1}`}
                          title="Informations sur les champs"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          i
                        </button>
                        {seedInfoOpen ? (
                          <div className="absolute right-0 top-full z-10 mt-2 w-80 rounded-md border border-slate-200 bg-white p-3 shadow-lg">
                            <p className="mb-2 text-xs font-semibold text-slate-700">Aide - {seedStepTitle}</p>
                            <ul className="list-disc space-y-1 pl-4 text-xs text-slate-600">
                              {seedStepHelp.map((line) => (
                                <li key={`${seedStepTitle}-${line}`}>{line}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className={`rounded-md border border-slate-200 bg-white p-3 ${seedStep === 0 ? "" : "hidden"}`}>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Catégorie</h3>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-xs text-slate-600">
                        Code
                        <select
                          value={seed.categoryCode}
                          onChange={(e) => applyCategoryCode(e.target.value)}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          {categoryCodeOptions.length === 0 ? (
                            <option value="">Aucune catégorie liée à cette branche</option>
                          ) : null}
                          {categoryCodeOptions.map((item) => (
                            <option key={`cat-code-${item.value}`} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        Nom
                        <input
                          value={seed.categoryName}
                          onChange={(e) => setSeed((prev) => ({ ...prev, categoryName: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        Description
                        <input
                          value={seed.categoryDescription}
                          onChange={(e) => setSeed((prev) => ({ ...prev, categoryDescription: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                  </div>

                  <div className={`rounded-md border border-slate-200 bg-white p-3 ${seedStep === 1 ? "" : "hidden"}`}>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Branche</h3>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-xs text-slate-600">
                        Code S2
                        <select
                          value={seed.branchCode}
                          onChange={(e) => applyBranchCode(e.target.value)}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          {branchCodeOptions.length === 0 ? (
                            <option value="">Aucune branche liée à cette catégorie</option>
                          ) : null}
                          {branchCodeOptions.map((item) => (
                            <option key={`branch-code-${item.value}`} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        Nom
                        <input
                          value={seed.branchName}
                          onChange={(e) => setSeed((prev) => ({ ...prev, branchName: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        Type
                        <input
                          value={seed.branchType}
                          onChange={(e) => setSeed((prev) => ({ ...prev, branchType: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600 md:col-span-2">
                        Description
                        <input
                          value={seed.branchDescription}
                          onChange={(e) => setSeed((prev) => ({ ...prev, branchDescription: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        Active
                        <select
                          value={seed.branchIsActive}
                          onChange={(e) => setSeed((prev) => ({ ...prev, branchIsActive: Number(e.target.value) ? 1 : 0 }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value={1}>Oui</option>
                          <option value={0}>Non</option>
                        </select>
                      </label>
                    </div>
                  </div>

                  <div className={`rounded-md border border-slate-200 bg-white p-3 ${seedStep === 2 ? "" : "hidden"}`}>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Programme</h3>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-xs text-slate-600">
                        Code
                        <select
                          value={seed.programCode}
                          onChange={(e) => setSeed((prev) => ({ ...prev, programCode: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          {programCodeOptions.length === 0 ? (
                            <option value="">
                              {selectedBranchTemplate ? "Aucun programme lié à cette branche" : "Choisis d'abord une branche"}
                            </option>
                          ) : null}
                          {programCodeOptions.map((item) => (
                            <option key={`program-code-${item.value}`} value={item.value}>
                              {item.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        Nom
                        <input
                          value={seed.programName}
                          onChange={(e) => setSeed((prev) => ({ ...prev, programName: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        Actif
                        <select
                          value={seed.programIsActive}
                          onChange={(e) => setSeed((prev) => ({ ...prev, programIsActive: Number(e.target.value) ? 1 : 0 }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value={1}>Oui</option>
                          <option value={0}>Non</option>
                        </select>
                      </label>
                      <label className="text-xs text-slate-600 md:col-span-3">
                        Description
                        <input
                          value={seed.programDescription}
                          onChange={(e) => setSeed((prev) => ({ ...prev, programDescription: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 md:col-span-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                            Contenu du programme sélectionné
                          </div>
                          <button
                            type="button"
                            onClick={() => setProgramContentModalOpen(true)}
                            disabled={!selectedProgramTemplate}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Voir le contenu du programme
                          </button>
                        </div>
                        {!selectedProgramTemplate ? (
                          <p className="mt-2 text-xs text-slate-600">
                            Sélectionne un programme existant pour visualiser ses blocs référentiel.
                          </p>
                        ) : (
                          <div className="mt-2 space-y-2">
                            <p className="text-xs text-slate-700">
                              Programme: <span className="font-semibold">{selectedProgramTemplate.code}</span>{" "}
                              {selectedProgramTemplate.name ? `- ${selectedProgramTemplate.name}` : ""}
                            </p>
                            <div className="grid gap-2 sm:grid-cols-3">
                              <div className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
                                Branches: <span className="font-semibold">{selectedProgramContentCounts.branches}</span>
                              </div>
                              <div className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
                                Politiques: <span className="font-semibold">{selectedProgramContentCounts.policies}</span>
                              </div>
                              <div className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
                                Risques: <span className="font-semibold">{selectedProgramContentCounts.risks}</span>
                              </div>
                              <div className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
                                Réassurance: <span className="font-semibold">{selectedProgramContentCounts.reinsurance}</span>
                              </div>
                              <div className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
                                Capital: <span className="font-semibold">{selectedProgramContentCounts.capitals}</span>
                              </div>
                              <div className="rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
                                Versions: <span className="font-semibold">{selectedProgramContentCounts.versions}</span>
                              </div>
                            </div>
                            {selectedProgramContent.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {selectedProgramContent.slice(0, 8).map((row) => (
                                  <span
                                    key={`seed-program-branch-preview-${row.branch.id_branch}`}
                                    className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700"
                                  >
                                    {row.branch.s2_code} - {row.branch.name}
                                  </span>
                                ))}
                                {selectedProgramContent.length > 8 ? (
                                  <span className="rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-700">
                                    +{selectedProgramContent.length - 8} autres
                                  </span>
                                ) : null}
                              </div>
                            ) : (
                              <p className="text-xs text-slate-600">Aucune branche liée à ce programme.</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className={`rounded-md border border-slate-200 bg-white p-3 ${seedStep === 3 ? "" : "hidden"}`}>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Politique</h3>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-xs text-slate-600">
                        Autorisé
                        <select
                          value={seed.policyIsAllowed}
                          onChange={(e) => setSeed((prev) => ({ ...prev, policyIsAllowed: Number(e.target.value) ? 1 : 0 }))}
                          disabled={seed.policyEligibility === "PROHIBITED"}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500"
                        >
                          <option value={1}>Oui</option>
                          <option value={0}>Non</option>
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        Restriction
                        <select
                          value={seed.policyRestriction}
                          onChange={(e) =>
                            setSeed((prev) => ({
                              ...prev,
                              policyRestriction: e.target.value as (typeof RESTRICTION_OPTIONS)[number],
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          {RESTRICTION_OPTIONS.map((v) => (
                            <option key={v} value={v}>
                              {labelForCode(v)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        Éligibilité
                        <select
                          value={seed.policyEligibility}
                          onChange={(e) =>
                            setSeed((prev) => ({
                              ...prev,
                              policyEligibility: e.target.value as (typeof ELIGIBILITY_OPTIONS)[number],
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          {ELIGIBILITY_OPTIONS.map((v) => (
                            <option key={v} value={v}>
                              {labelForCode(v)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        Fronting requis
                        <select
                          value={seed.policyFrontingRequired}
                          onChange={(e) =>
                            setSeed((prev) => ({ ...prev, policyFrontingRequired: Number(e.target.value) ? 1 : 0 }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value={1}>Oui</option>
                          <option value={0}>Non</option>
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        Réassurance requise
                        <select
                          value={seed.policyReinsuranceRequired}
                          onChange={(e) =>
                            setSeed((prev) => ({ ...prev, policyReinsuranceRequired: Number(e.target.value) ? 1 : 0 }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value={1}>Oui</option>
                          <option value={0}>Non</option>
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        Validation requise
                        <select
                          value={seed.policyApprovalRequired}
                          onChange={(e) =>
                            setSeed((prev) => ({ ...prev, policyApprovalRequired: Number(e.target.value) ? 1 : 0 }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value={1}>Oui</option>
                          <option value={0}>Non</option>
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        Début
                        <input
                          type="date"
                          value={seed.policyEffectiveFrom}
                          onChange={(e) => setSeed((prev) => ({ ...prev, policyEffectiveFrom: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        Fin
                        <input
                          type="date"
                          value={seed.policyEffectiveTo}
                          onChange={(e) => setSeed((prev) => ({ ...prev, policyEffectiveTo: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600 md:col-span-3">
                        Commentaires
                        <input
                          value={seed.policyComments}
                          onChange={(e) => setSeed((prev) => ({ ...prev, policyComments: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600 md:col-span-3">
                        Notes validation
                        <input
                          value={seed.policyApprovalNotes}
                          onChange={(e) => setSeed((prev) => ({ ...prev, policyApprovalNotes: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                  </div>

                  <div className={`rounded-md border border-slate-200 bg-white p-3 ${seedStep === 4 ? "" : "hidden"}`}>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Risque</h3>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-xs text-slate-600">
                        Limite / sinistre
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatIntegerWithSpaces(seed.riskMaxLimitPerClaim)}
                          onChange={(e) =>
                            setSeed((prev) => ({
                              ...prev,
                              riskMaxLimitPerClaim: parseIntegerInput(e.target.value, { min: 0 }),
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        Limite / an
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatIntegerWithSpaces(seed.riskMaxLimitPerYear)}
                          onChange={(e) =>
                            setSeed((prev) => ({
                              ...prev,
                              riskMaxLimitPerYear: parseIntegerInput(e.target.value, { min: 0 }),
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        Franchise
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatIntegerWithSpaces(seed.riskDefaultDeductible)}
                          onChange={(e) =>
                            setSeed((prev) => ({
                              ...prev,
                              riskDefaultDeductible: parseIntegerInput(e.target.value, { min: 0 }),
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        Volatilité
                        <select
                          value={seed.riskVolatility}
                          onChange={(e) =>
                            setSeed((prev) => ({ ...prev, riskVolatility: e.target.value as (typeof VOLATILITY_OPTIONS)[number] }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          {VOLATILITY_OPTIONS.map((v) => (
                            <option key={v} value={v}>
                              {labelForCode(v)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        Intensité capital
                        <select
                          value={seed.riskCapital}
                          onChange={(e) =>
                            setSeed((prev) => ({
                              ...prev,
                              riskCapital: e.target.value as (typeof CAPITAL_INTENSITY_OPTIONS)[number],
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          {CAPITAL_INTENSITY_OPTIONS.map((v) => (
                            <option key={v} value={v}>
                              {labelForCode(v)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        Modèle actuariel
                        <select
                          value={seed.riskRequiresActuarialModel}
                          onChange={(e) =>
                            setSeed((prev) => ({ ...prev, riskRequiresActuarialModel: Number(e.target.value) ? 1 : 0 }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          <option value={1}>Oui</option>
                          <option value={0}>Non</option>
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        Rétention nette %
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatIntegerWithSpaces(seed.riskNetRetentionRatio)}
                          onChange={(e) =>
                            setSeed((prev) => ({
                              ...prev,
                              riskNetRetentionRatio: parseIntegerInput(e.target.value, { min: 0, max: 100 }),
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        Target loss ratio %
                        <input
                          type="text"
                          inputMode="numeric"
                          value={formatIntegerWithSpaces(seed.riskTargetLossRatio)}
                          onChange={(e) =>
                            setSeed((prev) => ({
                              ...prev,
                              riskTargetLossRatio: parseIntegerInput(e.target.value, { min: 0, max: 100 }),
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                  </div>

                  <div className={`rounded-md border border-slate-200 bg-white p-3 ${seedStep === 5 ? "" : "hidden"}`}>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Réassurance</h3>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-xs text-slate-600">
                        Type
                        <select
                          value={seed.reinsuranceType}
                          onChange={(e) =>
                            setSeed((prev) => ({
                              ...prev,
                              reinsuranceType: e.target.value as (typeof REINSURANCE_TYPE_OPTIONS)[number],
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          {REINSURANCE_TYPE_OPTIONS.map((v) => (
                            <option key={v} value={v}>
                              {labelForCode(v)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        Cession %
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={seed.reinsuranceCessionRate ?? ""}
                          disabled={seed.reinsuranceType === "FRONTING"}
                          onChange={(e) =>
                            setSeed((prev) => ({
                              ...prev,
                              reinsuranceCessionRate: e.target.value === "" ? null : Number(e.target.value),
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        Limite rétention
                        <input
                          type="number"
                          min={0}
                          value={seed.reinsuranceRetentionLimit ?? ""}
                          onChange={(e) =>
                            setSeed((prev) => ({
                              ...prev,
                              reinsuranceRetentionLimit: e.target.value === "" ? null : Number(e.target.value),
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        Priorité
                        <input
                          type="number"
                          min={1}
                          value={seed.reinsurancePriority}
                          onChange={(e) =>
                            setSeed((prev) => ({ ...prev, reinsurancePriority: Number(e.target.value) || 1 }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        Début
                        <input
                          type="date"
                          value={seed.reinsuranceEffectiveFrom}
                          onChange={(e) => setSeed((prev) => ({ ...prev, reinsuranceEffectiveFrom: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        Fin
                        <input
                          type="date"
                          value={seed.reinsuranceEffectiveTo}
                          onChange={(e) => setSeed((prev) => ({ ...prev, reinsuranceEffectiveTo: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                  </div>

                  <div className={`rounded-md border border-slate-200 bg-white p-3 ${seedStep === 6 ? "" : "hidden"}`}>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Capital</h3>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-xs text-slate-600">
                        Méthode
                        <select
                          value={seed.capitalMethod}
                          onChange={(e) =>
                            setSeed((prev) => ({ ...prev, capitalMethod: e.target.value as (typeof CAPITAL_METHOD_OPTIONS)[number] }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        >
                          {CAPITAL_METHOD_OPTIONS.map((v) => (
                            <option key={v} value={v}>
                              {labelForCode(v)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-slate-600">
                        Charge %
                        <input
                          type="number"
                          min={0}
                          max={100}
                          value={seed.capitalChargePct ?? ""}
                          onChange={(e) =>
                            setSeed((prev) => ({
                              ...prev,
                              capitalChargePct: e.target.value === "" ? null : Number(e.target.value),
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        Scénario stress
                        <input
                          value={seed.capitalStressScenario}
                          onChange={(e) => setSeed((prev) => ({ ...prev, capitalStressScenario: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        Début
                        <input
                          type="date"
                          value={seed.capitalEffectiveFrom}
                          onChange={(e) => setSeed((prev) => ({ ...prev, capitalEffectiveFrom: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        Fin
                        <input
                          type="date"
                          value={seed.capitalEffectiveTo}
                          onChange={(e) => setSeed((prev) => ({ ...prev, capitalEffectiveTo: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                  </div>

                  <div className={`rounded-md border border-slate-200 bg-white p-3 ${seedStep === 7 ? "" : "hidden"}`}>
                    <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Version de politique
                    </h3>
                    <div className="grid gap-3 md:grid-cols-3">
                      <label className="text-xs text-slate-600">
                        Version
                        <input
                          value={seed.policyVersionLabel}
                          onChange={(e) => setSeed((prev) => ({ ...prev, policyVersionLabel: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        Date
                        <input
                          type="date"
                          value={seed.policyVersionChangedAt}
                          onChange={(e) => setSeed((prev) => ({ ...prev, policyVersionChangedAt: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600">
                        Modifié par
                        <input
                          value={seed.policyVersionChangedBy}
                          onChange={(e) => setSeed((prev) => ({ ...prev, policyVersionChangedBy: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="text-xs text-slate-600 md:col-span-3">
                        Notes
                        <input
                          value={seed.policyVersionChangeNotes}
                          onChange={(e) => setSeed((prev) => ({ ...prev, policyVersionChangeNotes: e.target.value }))}
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setSeedStep((prev) => Math.max(0, prev - 1))}
                      disabled={!canGoPrevSeedStep}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Précédent
                    </button>
                    <button
                      type="button"
                      onClick={() => setSeedStep((prev) => Math.min(maxSeedStep, prev + 1))}
                      disabled={!canGoNextSeedStep}
                      className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Suivant
                    </button>
                  </div>
                </div>
              ) : null}

              {seedFormError ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{seedFormError}</div>
              ) : null}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={abandonCaptiveCreation}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Abandon
                </button>
                <button
                  disabled={!canConfigureSeed || (seedInitMode === "existing" && !seedSourceCaptiveId)}
                  className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Créer la captive
                </button>
              </div>
            </form>
            ) : null}
            {captivesView === "creation" && programContentModalOpen ? (
              <div className="fixed inset-0 z-[55] overflow-y-auto bg-black/40 p-4">
                <div className="flex min-h-full items-start justify-center py-2">
                  <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
                    <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">Contenu du programme</h3>
                        <p className="text-xs text-slate-600">
                          {selectedProgramTemplate ? `${selectedProgramTemplate.code} - ${selectedProgramTemplate.name}` : "Programme non sélectionné"}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setProgramContentModalOpen(false)}
                        className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                      >
                        Fermer
                      </button>
                    </div>
                    <div className="flex-1 space-y-3 overflow-y-auto p-4">
                      <div className="grid gap-2 sm:grid-cols-3">
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Branches liées: <span className="font-semibold">{selectedProgramContentCounts.branches}</span>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Politiques: <span className="font-semibold">{selectedProgramContentCounts.policies}</span> | Risques:{" "}
                          <span className="font-semibold">{selectedProgramContentCounts.risks}</span>
                        </div>
                        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                          Réassurances: <span className="font-semibold">{selectedProgramContentCounts.reinsurance}</span> | Capitals:{" "}
                          <span className="font-semibold">{selectedProgramContentCounts.capitals}</span> | Versions:{" "}
                          <span className="font-semibold">{selectedProgramContentCounts.versions}</span>
                        </div>
                      </div>

                      {selectedProgramTemplate ? (
                        selectedProgramContent.length > 0 ? (
                          <div className="space-y-3">
                            {selectedProgramContent.map((row) => (
                              <div
                                key={`seed-program-content-branch-${row.branch.id_branch}`}
                                className="rounded-md border border-slate-200 bg-slate-50 p-3"
                              >
                                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                                  <div className="text-sm font-semibold text-slate-800">
                                    {row.branch.s2_code} - {row.branch.name}
                                  </div>
                                  <div className="text-xs text-slate-600">
                                    Type: <span className="font-medium">{row.branch.branch_type || "-"}</span> | Active:{" "}
                                    <span className="font-medium">{Number(row.branch.is_active) ? "Oui" : "Non"}</span>
                                  </div>
                                </div>
                                <div className="grid gap-2 md:grid-cols-2">
                                  <div className="rounded border border-slate-200 bg-white p-2 text-xs text-slate-700">
                                    <p className="font-semibold text-slate-800">Politique</p>
                                    {row.policy ? (
                                      <p>
                                        Autorisé: {Number(row.policy.is_allowed) ? "Oui" : "Non"} | Restriction:{" "}
                                        {labelForCode(row.policy.restriction_level)} | Éligibilité:{" "}
                                        {labelForCode(row.policy.eligibility_mode)}
                                      </p>
                                    ) : (
                                      <p>Aucune politique liée.</p>
                                    )}
                                  </div>
                                  <div className="rounded border border-slate-200 bg-white p-2 text-xs text-slate-700">
                                    <p className="font-semibold text-slate-800">Risque</p>
                                    {row.risk ? (
                                      <p>
                                        Volatilité: {labelForCode(row.risk.volatility_level)} | Intensité capital:{" "}
                                        {labelForCode(row.risk.capital_intensity)}
                                      </p>
                                    ) : (
                                      <p>Aucun paramètre risque lié.</p>
                                    )}
                                  </div>
                                  <div className="rounded border border-slate-200 bg-white p-2 text-xs text-slate-700">
                                    <p className="font-semibold text-slate-800">Réassurance</p>
                                    {row.reinsurance ? (
                                      <p>
                                        Type: {labelForCode(row.reinsurance.rule_type)} | Cession:{" "}
                                        {row.reinsurance.cession_rate ?? "-"}%
                                      </p>
                                    ) : (
                                      <p>Aucune règle de réassurance liée.</p>
                                    )}
                                  </div>
                                  <div className="rounded border border-slate-200 bg-white p-2 text-xs text-slate-700">
                                    <p className="font-semibold text-slate-800">Capital</p>
                                    {row.capital ? (
                                      <p>
                                        Méthode: {labelForCode(row.capital.capital_method)} | Charge:{" "}
                                        {row.capital.capital_charge_pct ?? "-"}%
                                      </p>
                                    ) : (
                                      <p>Aucun paramètre capital lié.</p>
                                    )}
                                  </div>
                                </div>
                                <div className="mt-2 rounded border border-slate-200 bg-white p-2 text-xs text-slate-700">
                                  <p className="font-semibold text-slate-800">Versions de politique</p>
                                  {row.policyVersions.length > 0 ? (
                                    <p>{row.policyVersions.map((item) => item.version_label).join(", ")}</p>
                                  ) : (
                                    <p>Aucune version de politique liée.</p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            Aucune branche n&apos;est liée à ce programme dans le référentiel.
                          </div>
                        )
                      ) : (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                          Aucun programme sélectionné.
                        </div>
                      )}
                    </div>
                    <div className="flex justify-end border-t border-slate-200 px-4 py-3">
                      <button
                        type="button"
                        onClick={() => setProgramContentModalOpen(false)}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        Fermer
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {captivesView === "visualisation" ? (
            <div className="rounded-xl border border-slate-300 bg-white p-5 space-y-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-800">Visualisation des captives</h2>
              <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                La ligne en surbrillance sert de source pour la création par duplication d&apos;une autre captive.
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left">Code</th>
                      <th className="px-3 py-2 text-left">Nom</th>
                      <th className="px-3 py-2 text-left">Statut</th>
                      <th className="px-3 py-2 text-right">Membres actifs</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                          Chargement...
                        </td>
                      </tr>
                    ) : captives.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                          Aucune captive.
                        </td>
                      </tr>
                    ) : (
                      captives.map((c) => {
                        const isSource = Number(seedSourceCaptiveId) === Number(c.id);
                        return (
                          <tr
                            key={c.id}
                            className={`border-t border-slate-100 align-top ${
                              isSource ? "bg-blue-50" : "hover:bg-slate-50"
                            } cursor-pointer`}
                            role="button"
                            tabIndex={0}
                            onClick={() => openCaptiveEditor(c)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openCaptiveEditor(c);
                              }
                            }}
                          >
                            <td className="px-3 py-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium underline decoration-dotted underline-offset-2">{c.code}</span>
                                {isSource ? (
                                  <span className="rounded-full border border-blue-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">
                                    Source duplication
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-3 py-2">{c.name}</td>
                            <td className="px-3 py-2">{c.status}</td>
                            <td className="px-3 py-2 text-right">
                              {(c.active_members || 0).toString()} / owners {(c.active_owners || 0).toString()}
                            </td>
                            <td className="px-3 py-2 text-right">
                              <div className="flex justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSeedSourceCaptiveId(c.id);
                                  }}
                                  className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                                >
                                  Source
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openDeleteCaptiveModal(c);
                                  }}
                                  className="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                                >
                                  Supprimer
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {editingCaptiveDraft ? (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-black/35 p-4">
                  <div className="flex min-h-full items-start justify-center py-2">
                  <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <h3 className="text-sm font-semibold text-slate-900">Détail et modification captive</h3>
                    </div>
                    <div className="flex-1 space-y-4 overflow-y-auto p-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="text-xs text-slate-600">
                          Identifiant
                          <input
                            value={editingCaptiveDraft.id}
                            readOnly
                            className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
                          />
                        </label>
                        <label className="text-xs text-slate-600">
                          Statut
                          <select
                            value={editingCaptiveDraft.status}
                            onChange={(e) =>
                              setEditingCaptiveDraft((prev) =>
                                prev ? { ...prev, status: e.target.value as "active" | "disabled" } : prev
                              )
                            }
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                          >
                            <option value="active">active</option>
                            <option value="disabled">disabled</option>
                          </select>
                        </label>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="text-xs text-slate-600">
                          Code
                          <input
                            value={editingCaptiveDraft.code}
                            onChange={(e) =>
                              setEditingCaptiveDraft((prev) => (prev ? { ...prev, code: e.target.value } : prev))
                            }
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-600">
                          Nom
                          <input
                            value={editingCaptiveDraft.name}
                            onChange={(e) =>
                              setEditingCaptiveDraft((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                            }
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                          />
                        </label>
                      </div>
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                        Membres actifs: {editingCaptiveDraft.active_members.toString()} / owners{" "}
                        {editingCaptiveDraft.active_owners.toString()}
                      </div>
                      <div className="rounded-md border border-slate-200 p-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Blocs référentiel (8 étapes) - mode modification
                        </div>
                        {editingCaptiveSeedLoading ? (
                          <div className="text-sm text-slate-500">Chargement du référentiel...</div>
                        ) : (
                          <div className="space-y-3">
                            {editingCaptiveSeedError ? (
                              <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                                {editingCaptiveSeedError}
                              </div>
                            ) : null}

                            <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                              <div className="mb-2 text-xs font-semibold text-slate-700">1. Catégorie</div>
                              <div className="grid gap-2 md:grid-cols-3">
                                <select
                                  value={editingCaptiveSeed.categoryCode}
                                  onChange={(e) => applyEditCategoryCode(e.target.value)}
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                >
                                  {editingCategoryCodeOptions.length === 0 ? (
                                    <option value="">Aucune catégorie liée à cette branche</option>
                                  ) : null}
                                  {editingCategoryCodeOptions.map((item) => (
                                    <option key={`edit-cat-code-${item.value}`} value={item.value}>
                                      {item.label}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  value={editingCaptiveSeed.categoryName}
                                  onChange={(e) => setEditingCaptiveSeed((prev) => ({ ...prev, categoryName: e.target.value }))}
                                  placeholder="Nom catégorie"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                                <input
                                  value={editingCaptiveSeed.categoryDescription}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({ ...prev, categoryDescription: e.target.value }))
                                  }
                                  placeholder="Description"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                              </div>
                            </div>

                            <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                              <div className="mb-2 text-xs font-semibold text-slate-700">2. Branche</div>
                              <div className="grid gap-2 md:grid-cols-3">
                                <select
                                  value={editingCaptiveSeed.branchCode}
                                  onChange={(e) => applyEditBranchCode(e.target.value)}
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                >
                                  {editingBranchCodeOptions.length === 0 ? (
                                    <option value="">Aucune branche liée à cette catégorie</option>
                                  ) : null}
                                  {editingBranchCodeOptions.map((item) => (
                                    <option key={`edit-branch-code-${item.value}`} value={item.value}>
                                      {item.label}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  value={editingCaptiveSeed.branchName}
                                  onChange={(e) => setEditingCaptiveSeed((prev) => ({ ...prev, branchName: e.target.value }))}
                                  placeholder="Nom branche"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                                <input
                                  value={editingCaptiveSeed.branchType}
                                  onChange={(e) => setEditingCaptiveSeed((prev) => ({ ...prev, branchType: e.target.value }))}
                                  placeholder="Type branche"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                                <input
                                  value={editingCaptiveSeed.branchDescription}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({ ...prev, branchDescription: e.target.value }))
                                  }
                                  placeholder="Description"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm md:col-span-2"
                                />
                                <select
                                  value={editingCaptiveSeed.branchIsActive}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({ ...prev, branchIsActive: Number(e.target.value) ? 1 : 0 }))
                                  }
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                >
                                  <option value={1}>Oui</option>
                                  <option value={0}>Non</option>
                                </select>
                              </div>
                            </div>

                            <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                              <div className="mb-2 text-xs font-semibold text-slate-700">3. Programme</div>
                              <div className="grid gap-2 md:grid-cols-3">
                                <select
                                  value={editingCaptiveSeed.programCode}
                                  onChange={(e) => setEditingCaptiveSeed((prev) => ({ ...prev, programCode: e.target.value }))}
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                >
                                  {editingProgramCodeOptions.length === 0 ? (
                                    <option value="">
                                      {editingSelectedBranchTemplate ? "Aucun programme lié à cette branche" : "Choisis d'abord une branche"}
                                    </option>
                                  ) : null}
                                  {editingProgramCodeOptions.map((item) => (
                                    <option key={`edit-program-code-${item.value}`} value={item.value}>
                                      {item.label}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  value={editingCaptiveSeed.programName}
                                  onChange={(e) => setEditingCaptiveSeed((prev) => ({ ...prev, programName: e.target.value }))}
                                  placeholder="Nom programme"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                                <select
                                  value={editingCaptiveSeed.programIsActive}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({ ...prev, programIsActive: Number(e.target.value) ? 1 : 0 }))
                                  }
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                >
                                  <option value={1}>Oui</option>
                                  <option value={0}>Non</option>
                                </select>
                                <input
                                  value={editingCaptiveSeed.programDescription}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({ ...prev, programDescription: e.target.value }))
                                  }
                                  placeholder="Description"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm md:col-span-3"
                                />
                              </div>
                            </div>

                            <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                              <div className="mb-2 text-xs font-semibold text-slate-700">4. Politique</div>
                              <div className="grid gap-2 md:grid-cols-3">
                                <select
                                  value={editingCaptiveSeed.policyIsAllowed}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({ ...prev, policyIsAllowed: Number(e.target.value) ? 1 : 0 }))
                                  }
                                  disabled={editingCaptiveSeed.policyEligibility === "PROHIBITED"}
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100 disabled:text-slate-500"
                                >
                                  <option value={1}>Oui</option>
                                  <option value={0}>Non</option>
                                </select>
                                <select
                                  value={editingCaptiveSeed.policyRestriction}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      policyRestriction: e.target.value as SeedForm["policyRestriction"],
                                    }))
                                  }
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                >
                                  {RESTRICTION_OPTIONS.map((opt) => (
                                    <option key={`edit-policy-res-${opt}`} value={opt}>
                                      {labelForCode(opt)}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={editingCaptiveSeed.policyEligibility}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      policyEligibility: e.target.value as SeedForm["policyEligibility"],
                                    }))
                                  }
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                >
                                  {ELIGIBILITY_OPTIONS.map((opt) => (
                                    <option key={`edit-policy-elig-${opt}`} value={opt}>
                                      {labelForCode(opt)}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={editingCaptiveSeed.policyFrontingRequired}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      policyFrontingRequired: Number(e.target.value) ? 1 : 0,
                                    }))
                                  }
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                >
                                  <option value={1}>Oui</option>
                                  <option value={0}>Non</option>
                                </select>
                                <select
                                  value={editingCaptiveSeed.policyReinsuranceRequired}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      policyReinsuranceRequired: Number(e.target.value) ? 1 : 0,
                                    }))
                                  }
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                >
                                  <option value={1}>Oui</option>
                                  <option value={0}>Non</option>
                                </select>
                                <select
                                  value={editingCaptiveSeed.policyApprovalRequired}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      policyApprovalRequired: Number(e.target.value) ? 1 : 0,
                                    }))
                                  }
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                >
                                  <option value={1}>Oui</option>
                                  <option value={0}>Non</option>
                                </select>
                              </div>
                            </div>

                            <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                              <div className="mb-2 text-xs font-semibold text-slate-700">5. Risque</div>
                              <div className="grid gap-2 md:grid-cols-3">
                                <input
                                  value={formatIntegerWithSpaces(editingCaptiveSeed.riskMaxLimitPerClaim)}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      riskMaxLimitPerClaim: parseIntegerInput(e.target.value, { min: 0 }),
                                    }))
                                  }
                                  placeholder="Limite / sinistre"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                                <input
                                  value={formatIntegerWithSpaces(editingCaptiveSeed.riskMaxLimitPerYear)}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      riskMaxLimitPerYear: parseIntegerInput(e.target.value, { min: 0 }),
                                    }))
                                  }
                                  placeholder="Limite / an"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                                <input
                                  value={formatIntegerWithSpaces(editingCaptiveSeed.riskDefaultDeductible)}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      riskDefaultDeductible: parseIntegerInput(e.target.value, { min: 0 }),
                                    }))
                                  }
                                  placeholder="Franchise"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                                <select
                                  value={editingCaptiveSeed.riskVolatility}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      riskVolatility: e.target.value as SeedForm["riskVolatility"],
                                    }))
                                  }
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                >
                                  {VOLATILITY_OPTIONS.map((opt) => (
                                    <option key={`edit-risk-vol-${opt}`} value={opt}>
                                      {labelForCode(opt)}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={editingCaptiveSeed.riskCapital}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      riskCapital: e.target.value as SeedForm["riskCapital"],
                                    }))
                                  }
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                >
                                  {CAPITAL_INTENSITY_OPTIONS.map((opt) => (
                                    <option key={`edit-risk-capital-${opt}`} value={opt}>
                                      {labelForCode(opt)}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={editingCaptiveSeed.riskRequiresActuarialModel}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      riskRequiresActuarialModel: Number(e.target.value) ? 1 : 0,
                                    }))
                                  }
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                >
                                  <option value={1}>Oui</option>
                                  <option value={0}>Non</option>
                                </select>
                                <input
                                  value={formatIntegerWithSpaces(editingCaptiveSeed.riskNetRetentionRatio)}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      riskNetRetentionRatio: parseIntegerInput(e.target.value, { min: 0, max: 100 }),
                                    }))
                                  }
                                  placeholder="Rétention nette %"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                                <input
                                  value={formatIntegerWithSpaces(editingCaptiveSeed.riskTargetLossRatio)}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      riskTargetLossRatio: parseIntegerInput(e.target.value, { min: 0, max: 100 }),
                                    }))
                                  }
                                  placeholder="Target loss ratio %"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                              </div>
                            </div>

                            <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                              <div className="mb-2 text-xs font-semibold text-slate-700">6. Réassurance</div>
                              <div className="grid gap-2 md:grid-cols-3">
                                <select
                                  value={editingCaptiveSeed.reinsuranceType}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      reinsuranceType: e.target.value as SeedForm["reinsuranceType"],
                                    }))
                                  }
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                >
                                  {REINSURANCE_TYPE_OPTIONS.map((opt) => (
                                    <option key={`edit-reins-type-${opt}`} value={opt}>
                                      {labelForCode(opt)}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={editingCaptiveSeed.reinsuranceCessionRate ?? ""}
                                  disabled={editingCaptiveSeed.reinsuranceType === "FRONTING"}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      reinsuranceCessionRate: e.target.value === "" ? null : Number(e.target.value),
                                    }))
                                  }
                                  placeholder="Cession %"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm disabled:bg-slate-100 disabled:text-slate-500"
                                />
                                <input
                                  type="number"
                                  min={0}
                                  value={editingCaptiveSeed.reinsuranceRetentionLimit ?? ""}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      reinsuranceRetentionLimit: e.target.value === "" ? null : Number(e.target.value),
                                    }))
                                  }
                                  placeholder="Limite rétention"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                                <input
                                  type="number"
                                  min={1}
                                  value={editingCaptiveSeed.reinsurancePriority}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      reinsurancePriority: Number(e.target.value) || 1,
                                    }))
                                  }
                                  placeholder="Priorité"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                                <input
                                  type="date"
                                  value={editingCaptiveSeed.reinsuranceEffectiveFrom}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({ ...prev, reinsuranceEffectiveFrom: e.target.value }))
                                  }
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                                <input
                                  type="date"
                                  value={editingCaptiveSeed.reinsuranceEffectiveTo}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({ ...prev, reinsuranceEffectiveTo: e.target.value }))
                                  }
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                              </div>
                            </div>

                            <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                              <div className="mb-2 text-xs font-semibold text-slate-700">7. Capital</div>
                              <div className="grid gap-2 md:grid-cols-3">
                                <select
                                  value={editingCaptiveSeed.capitalMethod}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      capitalMethod: e.target.value as SeedForm["capitalMethod"],
                                    }))
                                  }
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                >
                                  {CAPITAL_METHOD_OPTIONS.map((opt) => (
                                    <option key={`edit-capital-method-${opt}`} value={opt}>
                                      {labelForCode(opt)}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={editingCaptiveSeed.capitalChargePct ?? ""}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({
                                      ...prev,
                                      capitalChargePct: e.target.value === "" ? null : Number(e.target.value),
                                    }))
                                  }
                                  placeholder="Charge %"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                                <input
                                  value={editingCaptiveSeed.capitalStressScenario}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({ ...prev, capitalStressScenario: e.target.value }))
                                  }
                                  placeholder="Scénario stress"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                                <input
                                  type="date"
                                  value={editingCaptiveSeed.capitalEffectiveFrom}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({ ...prev, capitalEffectiveFrom: e.target.value }))
                                  }
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                                <input
                                  type="date"
                                  value={editingCaptiveSeed.capitalEffectiveTo}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({ ...prev, capitalEffectiveTo: e.target.value }))
                                  }
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                              </div>
                            </div>

                            <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                              <div className="mb-2 text-xs font-semibold text-slate-700">8. Version de politique</div>
                              <div className="grid gap-2 md:grid-cols-3">
                                <input
                                  value={editingCaptiveSeed.policyVersionLabel}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({ ...prev, policyVersionLabel: e.target.value }))
                                  }
                                  placeholder="Version"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                                <input
                                  type="date"
                                  value={editingCaptiveSeed.policyVersionChangedAt}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({ ...prev, policyVersionChangedAt: e.target.value }))
                                  }
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                                <input
                                  value={editingCaptiveSeed.policyVersionChangedBy}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({ ...prev, policyVersionChangedBy: e.target.value }))
                                  }
                                  placeholder="Modifié par"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm"
                                />
                                <input
                                  value={editingCaptiveSeed.policyVersionChangeNotes}
                                  onChange={(e) =>
                                    setEditingCaptiveSeed((prev) => ({ ...prev, policyVersionChangeNotes: e.target.value }))
                                  }
                                  placeholder="Notes"
                                  className="rounded-md border border-slate-300 px-2 py-1 text-sm md:col-span-3"
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">
                      <button
                        type="button"
                        onClick={requestCaptiveSaveConfirmation}
                        className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
                      >
                        Valider
                      </button>
                      <button
                        type="button"
                        onClick={abandonCaptiveChanges}
                        className="rounded-md border border-amber-300 px-3 py-2 text-sm text-amber-800 hover:bg-amber-50"
                      >
                        Abandonner
                      </button>
                      <button
                        type="button"
                        onClick={closeCaptiveEditor}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        Retour
                      </button>
                    </div>
                  </div>
                  </div>
                </div>
              ) : null}

              {editingCaptiveDraft && captiveConfirmOpen ? (
                <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/45 p-4">
                  <div className="flex min-h-full items-start justify-center py-2">
                  <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
                    <h3 className="text-sm font-semibold text-slate-900">Confirmer la modification</h3>
                    <p className="mt-2 text-sm text-slate-600">
                      Confirmer la mise à jour de la captive {editingCaptiveDraft.code} ({editingCaptiveDraft.name}) ?
                    </p>
                    <div className="mt-4 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={saveCaptiveChanges}
                        disabled={captiveModalSaving}
                        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                      >
                        {captiveModalSaving ? "Validation..." : "Confirmer"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCaptiveConfirmOpen(false)}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                  </div>
                </div>
              ) : null}

              {deleteTargetCaptive ? (
                <div className="fixed inset-0 z-[70] overflow-y-auto bg-black/45 p-4">
                  <div className="flex min-h-full items-start justify-center py-2">
                  <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-lg flex-col rounded-xl border border-red-200 bg-white shadow-xl">
                    <div className="border-b border-red-100 px-4 py-3">
                      <h3 className="text-sm font-semibold text-red-800">Validation de suppression</h3>
                    </div>
                    <div className="flex-1 space-y-3 overflow-y-auto p-4">
                      <p className="text-sm text-slate-700">
                        Tu vas supprimer la captive <span className="font-semibold">{deleteTargetCaptive.code}</span> (
                        {deleteTargetCaptive.name}). Cette action supprime aussi son référentiel et ses rattachements.
                      </p>
                      <label className="block text-xs text-slate-600">
                        Identifiant super administrateur
                        <input
                          value={deleteAdminIdentifier}
                          onChange={(e) => setDeleteAdminIdentifier(e.target.value)}
                          placeholder="email ou identifiant"
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-slate-600">
                        Mot de passe super administrateur
                        <input
                          type="password"
                          value={deleteAdminPassword}
                          onChange={(e) => setDeleteAdminPassword(e.target.value)}
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>
                    </div>
                    <div className="flex justify-end gap-2 border-t border-red-100 px-4 py-3">
                      <button
                        type="button"
                        onClick={confirmDeleteCaptive}
                        disabled={deleteModalDeleting}
                        className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                      >
                        {deleteModalDeleting ? "Suppression..." : "Confirmer la suppression"}
                      </button>
                      <button
                        type="button"
                        onClick={closeDeleteCaptiveModal}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        Annuler
                      </button>
                    </div>
                  </div>
                  </div>
                </div>
              ) : null}
            </div>
            ) : null}
          </div>
        ) : null}

        {canAccess && section === "users" ? (
          <div className="space-y-4">
            <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
              <Link
                href="/superadmin?section=users&users_view=creation"
                className={`rounded-md px-3 py-1.5 text-sm ${
                  usersView === "creation"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Création
              </Link>
              <Link
                href="/superadmin?section=users&users_view=visualisation"
                className={`rounded-md px-3 py-1.5 text-sm ${
                  usersView === "visualisation"
                    ? "bg-slate-900 text-white"
                    : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                Visualisation
              </Link>
            </div>

            {usersView === "creation" ? (
            <form onSubmit={createUser} className="rounded-xl border border-slate-300 bg-white p-5 space-y-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-800">Création utilisateur + rattachement captive</h2>

              <input
                required
                type="email"
                placeholder="Email"
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                required
                type="password"
                placeholder="Mot de passe"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />

              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {ROLE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    Droit global: {opt.label}
                  </option>
                ))}
              </select>

              <select
                value={newUserStatus}
                onChange={(e) => setNewUserStatus(e.target.value as "active" | "disabled")}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="active">Compte actif</option>
                <option value="disabled">Compte désactivé</option>
              </select>

              <select
                required
                value={newUserCaptiveId}
                onChange={(e) => setNewUserCaptiveId(e.target.value ? Number(e.target.value) : "")}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Choisir une captive</option>
                {captives.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code})
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-2 gap-2">
                <select
                  value={newMembershipRole}
                  onChange={(e) => setNewMembershipRole(e.target.value as "owner" | "intervenant" | "manager" | "viewer")}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  {MEMBERSHIP_ROLES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      Rôle captive: {opt.label}
                    </option>
                  ))}
                </select>
                <select
                  value={newMembershipStatus}
                  onChange={(e) => setNewMembershipStatus(e.target.value as "active" | "disabled")}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="active">Membership actif</option>
                  <option value="disabled">Membership désactivé</option>
                </select>
              </div>

              <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={newIsOwner}
                  onChange={(e) => setNewIsOwner(e.target.checked)}
                />
                Propriétaire (owner)
              </label>

              <button className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
                Créer et rattacher
              </button>
            </form>
            ) : null}

            {usersView === "visualisation" ? (
            <div className="rounded-xl border border-slate-300 bg-white p-5 space-y-4 shadow-sm">
              <h2 className="text-base font-semibold text-slate-800">Visualisation utilisateurs</h2>
              <p className="text-xs text-slate-500">Cliquez sur une ligne pour ouvrir le mode modification.</p>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-3 py-2 text-left">Email</th>
                      <th className="px-3 py-2 text-left">Statut</th>
                      <th className="px-3 py-2 text-left">Droits globaux</th>
                      <th className="px-3 py-2 text-left">Rattachements captives</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                          Chargement...
                        </td>
                      </tr>
                    ) : users.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-3 py-4 text-center text-slate-500">
                          Aucun utilisateur.
                        </td>
                      </tr>
                    ) : (
                      users.map((u) => (
                        <tr
                          key={u.id}
                          className="cursor-pointer border-t border-slate-100 align-top hover:bg-slate-50"
                          role="button"
                          tabIndex={0}
                          onClick={() => openUserEditor(u.id)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openUserEditor(u.id);
                            }
                          }}
                        >
                          <td className="px-3 py-2 font-medium">{u.email}</td>
                          <td className="px-3 py-2">{u.status}</td>
                          <td className="px-3 py-2">{(u.roles || []).join(", ") || "-"}</td>
                          <td className="px-3 py-2">
                            {(u.memberships || []).length === 0 ? (
                              <span className="text-slate-500">Aucun</span>
                            ) : (
                              <div className="space-y-1">
                                {u.memberships.map((m) => (
                                  <div key={`${u.id}-${m.captive_id}`} className="text-xs text-slate-600">
                                    {m.captive_name || m.captive_code || m.captive_id}: {m.role}/{m.status}
                                    {m.is_owner ? " (owner)" : ""}
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {userModalLoading ? (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Chargement utilisateur...
                </div>
              ) : null}

              {editingUserDraft ? (
                <div className="fixed inset-0 z-50 overflow-y-auto bg-black/35 p-4">
                  <div className="flex min-h-full items-start justify-center py-2">
                  <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl">
                    <div className="border-b border-slate-200 px-4 py-3">
                      <h3 className="text-sm font-semibold text-slate-900">Modification utilisateur</h3>
                    </div>
                    <div className="flex-1 space-y-4 overflow-y-auto p-4">
                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="text-xs text-slate-600">
                          Email
                          <input
                            type="email"
                            value={editingUserDraft.email}
                            onChange={(e) => setEditingUserDraft((prev) => (prev ? { ...prev, email: e.target.value } : prev))}
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                          />
                        </label>
                        <label className="text-xs text-slate-600">
                          Statut
                          <select
                            value={editingUserDraft.status}
                            onChange={(e) =>
                              setEditingUserDraft((prev) =>
                                prev ? { ...prev, status: e.target.value as "active" | "disabled" } : prev
                              )
                            }
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                          >
                            <option value="active">active</option>
                            <option value="disabled">disabled</option>
                          </select>
                        </label>
                      </div>

                      <label className="block text-xs text-slate-600">
                        Nouveau mot de passe (laisser vide pour conserver l'actuel)
                        <input
                          type="password"
                          value={editingUserDraft.password}
                          onChange={(e) =>
                            setEditingUserDraft((prev) => (prev ? { ...prev, password: e.target.value } : prev))
                          }
                          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                        />
                      </label>

                      <div className="rounded-md border border-slate-200 p-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Droits globaux</div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {ROLE_OPTIONS.map((role) => {
                            const checked = editingUserDraft.roles.includes(role.value);
                            return (
                              <label key={`edit-role-${role.value}`} className="inline-flex items-center gap-2 text-sm text-slate-700">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) =>
                                    setEditingUserDraft((prev) => {
                                      if (!prev) return prev;
                                      const nextRoles = e.target.checked
                                        ? [...prev.roles, role.value]
                                        : prev.roles.filter((r) => r !== role.value);
                                      return { ...prev, roles: [...new Set(nextRoles)] };
                                    })
                                  }
                                />
                                {role.label}
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      <div className="rounded-md border border-slate-200 p-3">
                        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Rattachements captives (lecture seule)
                        </div>
                        {editingUserDraft.memberships.length === 0 ? (
                          <div className="text-sm text-slate-500">Aucun rattachement.</div>
                        ) : (
                          <div className="space-y-1">
                            {editingUserDraft.memberships.map((m) => (
                              <div key={`edit-membership-${editingUserDraft.id}-${m.captive_id}`} className="text-sm text-slate-700">
                                {m.captive_name || m.captive_code || m.captive_id}: {m.role}/{m.status}
                                {m.is_owner ? " (owner)" : ""}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">
                      <button
                        onClick={saveUserChanges}
                        disabled={userModalSaving}
                        className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                      >
                        {userModalSaving ? "Validation..." : "Valider"}
                      </button>
                      <button
                        onClick={abandonUserChanges}
                        className="rounded-md border border-amber-300 px-3 py-2 text-sm text-amber-800 hover:bg-amber-50"
                      >
                        Abandonner
                      </button>
                      <button
                        onClick={closeUserEditor}
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        Retour
                      </button>
                    </div>
                  </div>
                  </div>
                </div>
              ) : null}
            </div>
            ) : null}
          </div>
        ) : null}

      </div>
    </RequireAuth>
  );
}

export default function SuperadminPage() {
  return (
    <Suspense fallback={<div className="px-4 py-3 text-sm text-slate-500">Chargement...</div>}>
      <SuperadminContent />
    </Suspense>
  );
}
