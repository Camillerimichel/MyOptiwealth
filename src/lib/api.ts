type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function readApiError(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const code = payload?.error;
    const message = payload?.message;
    if (typeof code === "string" && code) {
      return { code, message: code };
    }
    if (typeof message === "string" && message) {
      return { code: null, message };
    }
  }

  const rawText = await res.text().catch(() => "");
  const text = stripHtml(rawText);
  if (text) {
    return { code: null, message: text.slice(0, 220) };
  }
  return { code: null, message: `Erreur API (${res.status})` };
}

async function fetchWithToken<T>(url: string, method: HttpMethod = "GET", body?: any) {
  const token = typeof window !== "undefined" ? localStorage.getItem("captiva_token") : null;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const { code, message } = await readApiError(res);
    if (res.status === 401 && (code === "invalid_token" || code === "missing_token" || code === "invalid_token_scope")) {
      if (typeof window !== "undefined") {
        localStorage.removeItem("captiva_token");
        if (window.location.pathname !== "/login") {
          window.location.href = "/login";
        }
      }
    }
    const err = new Error(message);
    (err as Error & { code?: string | null; status?: number }).code = code;
    (err as Error & { code?: string | null; status?: number }).status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export async function login(email: string, password: string, captiveId?: number | null) {
  const body: Record<string, any> = { email, password };
  if (captiveId) body.captive_id = captiveId;
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    const msg = payload?.error || "Erreur de connexion";
    const err: any = new Error(msg);
    err.code = payload?.error || "login_failed";
    err.payload = payload;
    throw err;
  }
  return res.json() as Promise<{ token: string; roles: string[]; captive?: { id: number; code: string; name: string } }>;
}

export type Programme = {
  id: number;
  ligne_risque: string;
  statut: string;
  montant_garanti: string;
  franchise: string;
  devise: string;
  description?: string | null;
};

export type Sinistre = {
  id: number;
  programme_id: number;
  ligne_risque?: string;
  statut: string;
  montant_estime: string;
  montant_paye: string;
  devise: string;
  description?: string | null;
  lignes_count?: number;
  lignes?: SinistreLigne[];
};

export type SinistreLigne = {
  id: number;
  sinistre_id: number;
  id_branch: number;
  statut: string;
  montant_estime: string;
  montant_paye: string;
  montant_recours: string;
  montant_franchise: string;
  description?: string | null;
  branch_s2_code?: string | null;
  branch_name?: string | null;
};

export type PaginatedResponse<T> = {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
};

export async function fetchProgrammes() {
  return fetchWithToken<Programme[]>("/api/programmes");
}

export async function fetchSinistres() {
  return fetchWithToken<PaginatedResponse<Sinistre>>("/api/sinistres");
}


export type Branch = {
  id_branch: number;
  s2_code: string;
  name: string;
  description?: string | null;
  branch_type: string;
  is_active: number;
  category_code?: string | null;
  category_name?: string | null;
};

export type BranchPolicy = {
  id_policy: number;
  id_branch: number;
  is_allowed: number;
  restriction_level: string;
  fronting_required: number;
  reinsurance_required: number;
  comments?: string | null;
  effective_from: string;
  effective_to?: string | null;
  eligibility_mode: string;
  approval_required: number;
  approval_notes?: string | null;
  branch_name?: string | null;
  s2_code?: string | null;
};

export type BranchRiskParameters = {
  id_parameters: number;
  id_branch: number;
  max_limit_per_claim?: string | null;
  max_limit_per_year?: string | null;
  default_deductible?: string | null;
  volatility_level: string;
  capital_intensity: string;
  requires_actuarial_model: number;
  net_retention_ratio?: string | null;
  target_loss_ratio?: string | null;
  branch_name?: string | null;
  s2_code?: string | null;
};

export type BranchReinsuranceRule = {
  id_rule: number;
  id_branch: number;
  rule_type: string;
  cession_rate?: string | null;
  retention_limit?: string | null;
  priority: number;
  effective_from: string;
  effective_to?: string | null;
  branch_name?: string | null;
  s2_code?: string | null;
};

export type InsuranceProgram = {
  id_program: number;
  code: string;
  name: string;
  description?: string | null;
  is_active: number;
  created_at: string;
};

export type ProgramBranch = {
  id_program: number;
  id_branch: number;
  program_code?: string | null;
  program_name?: string | null;
  s2_code?: string | null;
  branch_name?: string | null;
};

export type BranchCapitalParameters = {
  id_capital: number;
  id_branch: number;
  capital_method: string;
  capital_charge_pct?: string | null;
  stress_scenario?: string | null;
  effective_from: string;
  effective_to?: string | null;
  branch_name?: string | null;
  s2_code?: string | null;
};

export async function fetchCaptiveBranches() {
  const res = await fetchWithToken<{ data: Branch[] }>("/api/captive/branches?page=1&limit=1000");
  return res.data;
}

export async function fetchCaptivePolicies() {
  const res = await fetchWithToken<{ data: BranchPolicy[] }>("/api/captive/policies?page=1&limit=1000");
  return res.data;
}

export async function fetchCaptiveRiskParameters() {
  const res = await fetchWithToken<{ data: BranchRiskParameters[] }>("/api/captive/risk-parameters");
  return res.data;
}

export async function fetchCaptiveReinsuranceRules() {
  const res = await fetchWithToken<{ data: BranchReinsuranceRule[] }>("/api/captive/reinsurance-rules");
  return res.data;
}

export async function fetchCaptivePrograms() {
  const res = await fetchWithToken<{ data: InsuranceProgram[] }>("/api/captive/programs?page=1&limit=1000");
  return res.data;
}

export async function fetchCaptiveProgramBranches() {
  const res = await fetchWithToken<{ data: ProgramBranch[] }>("/api/captive/program-branches");
  return res.data;
}

export async function fetchCaptiveCapitalParameters() {
  const res = await fetchWithToken<{ data: BranchCapitalParameters[] }>("/api/captive/capital-parameters");
  return res.data;
}


export async function apiRequest<T>(url: string, method: HttpMethod = "GET", body?: any) {
  return fetchWithToken<T>(url, method, body);
}
