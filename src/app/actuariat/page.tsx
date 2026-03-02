"use client";

import { Fragment, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";
import InfoHint from "@/components/InfoHint";

type ApiPayload = {
  ok: boolean;
  orsa_sets: any[];
  scenarios: any[];
  recent_runs: any[];
  engine_catalog?: any[];
  recent_run_engine_details?: any[];
  stress_parameters: any[];
  selected: any | null;
};

type S2EngineConfigPayload = {
  ok: boolean;
  scenario_id: number;
  scenario_code?: string | null;
  source: "defaults" | "simulation_parameters";
  config: any;
  parameter_row?: { id: number; effective_from: string | null; updated_at: string | null } | null;
};

type S2RealSnapshotPayload = {
  ok: boolean;
  scenario_code?: string | null;
  preview_only?: boolean;
  snapshot: any;
  inputs_non_life: any[];
  calc_scope: any;
  engine_config: any;
  saved?: { id: number; created_at?: string | null; updated_at?: string | null; overwritten?: boolean } | null;
};

type S2RealListPayload = {
  ok: boolean;
  year: number;
  rows: any[];
};

type S2RealBatchPayload = {
  ok: boolean;
  year: number;
  generated_count: number;
  failed_count: number;
  results: Array<{ snapshot_date: string; ok: boolean; error?: string; overwritten?: boolean; scr_total?: number; solvency_ratio_pct?: number | null }>;
};

const sectionOptions = [
  { key: "overview", label: "Overview" },
  { key: "orsa", label: "ORSA" },
  { key: "s2", label: "S2" },
  { key: "fronting", label: "Fronting" },
  { key: "cat", label: "CAT" },
  { key: "alm", label: "ALM / Fonds propres" },
  { key: "finance", label: "Finance ALM / Actifs" },
] as const;

async function fetchWithToken<T>(url: string): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("captiva_token") : null;
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({})))?.error || "Erreur API";
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

async function fetchJsonWithToken<T>(url: string, init: RequestInit): Promise<T> {
  const token = typeof window !== "undefined" ? localStorage.getItem("captiva_token") : null;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({})))?.error || "Erreur API";
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

function n(v: any) {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

function fmtEur(v: any) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  })
    .format(n(v))
    .replace(/\u202f/g, " ");
}

function fmtNum(v: any, d = 0) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d })
    .format(n(v))
    .replace(/\u202f/g, " ");
}

function fmtPct(v: any, d = 2) {
  return `${fmtNum(v, d)} %`;
}

function fmtDateIsoToFr(v: any) {
  const s = String(v || "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s || "—";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function downloadTextFile(filename: string, content: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([content ?? ""], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function copyTextToClipboard(content: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(content);
    return;
  }
  if (typeof document !== "undefined") {
    const ta = document.createElement("textarea");
    ta.value = content;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

function renderCellValue(v: any) {
  if (v == null) return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function normalizeEngineParamRows(schema: any): { key: string; label: string; type: string; source?: string; description?: string }[] {
  if (!schema) return [];
  const arr = Array.isArray(schema)
    ? schema
    : Array.isArray(schema?.parameters)
      ? schema.parameters
      : [];
  return arr
    .map((p: any) => ({
      key: String(p?.key || p?.name || ""),
      label: String(p?.label || p?.title || p?.key || p?.name || ""),
      type: String(p?.type || "—"),
      source: p?.source ? String(p.source) : "",
      description: p?.description ? String(p.description) : "",
    }))
    .filter((p: { key: string; label: string }) => p.key || p.label);
}

function engineHasPlaceholderWarning(detail: any): boolean {
  const warnings = Array.isArray(detail?.warnings_json) ? detail.warnings_json : [];
  return warnings.some((w: any) => String(w || "").toLowerCase() === "placeholder_methodology");
}

function extractScriptDependencies(source: string) {
  const text = String(source || "");
  const imports = new Set<string>();
  const importRegex = /\bimport\s+(?:[^'"]+from\s+)?["']([^"']+)["']/g;
  const requireRegex = /\brequire\(\s*["']([^"']+)["']\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = importRegex.exec(text))) imports.add(m[1]);
  while ((m = requireRegex.exec(text))) imports.add(m[1]);
  const all = Array.from(imports);
  const local = all.filter((p) => p.startsWith(".") || p.startsWith("/")).sort();
  const external = all.filter((p) => !p.startsWith(".") && !p.startsWith("/")).sort();
  return { local, external, all };
}

function resolveLocalImportPath(baseScriptName: string, importPath: string) {
  const base = String(baseScriptName || "").trim();
  const dep = String(importPath || "").trim();
  if (!base || !dep || (!dep.startsWith(".") && !dep.startsWith("/"))) return "";
  const baseParts = base.split("/").filter(Boolean);
  if (baseParts.length) baseParts.pop();
  const depParts = dep.split("/");
  const stack = dep.startsWith("/") ? [] : [...baseParts];
  for (const part of depParts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (stack.length) stack.pop();
      continue;
    }
    stack.push(part);
  }
  const resolved = stack.join("/");
  if (!resolved) return "";
  const hasExt = /\.[a-z0-9]+$/i.test(resolved);
  return hasExt ? resolved : `${resolved}.js`;
}

async function sha256Hex(input: string) {
  if (typeof window === "undefined" || !window.crypto?.subtle) return "";
  const data = new TextEncoder().encode(String(input || ""));
  const hash = await window.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function BlockTitle({ title, help, helpAlign = "left" }: { title: string; help: string; helpAlign?: "left" | "right" }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <div className="rounded-md bg-slate-200 px-2 py-1 text-sm font-bold text-slate-900">{title}</div>
      <InfoHint text={help} align={helpAlign} />
    </div>
  );
}

function EngineDetailRunModal({
  detail,
  onClose,
}: {
  detail: any;
  onClose: () => void;
}) {
  const [scriptOpen, setScriptOpen] = useState(false);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const [scriptContent, setScriptContent] = useState<string>("");
  const [scriptLoadedName, setScriptLoadedName] = useState<string>("");
  const [scriptSha256, setScriptSha256] = useState<string>("");
  const [depModal, setDepModal] = useState<{
    kind: "local" | "external";
    dep: string;
    resolvedPath?: string;
    loading?: boolean;
    error?: string | null;
    content?: string;
    sha256?: string;
  } | null>(null);
  if (!detail) return null;
  const placeholder = engineHasPlaceholderWarning(detail);
  const scriptDeps = useMemo(() => extractScriptDependencies(scriptContent), [scriptContent]);

  useEffect(() => {
    let cancelled = false;
    if (!scriptContent) {
      setScriptSha256("");
      return;
    }
    sha256Hex(scriptContent)
      .then((h) => {
        if (!cancelled) setScriptSha256(h);
      })
      .catch(() => {
        if (!cancelled) setScriptSha256("");
      });
    return () => {
      cancelled = true;
    };
  }, [scriptContent]);

  useEffect(() => {
    let cancelled = false;
    if (!depModal?.content) {
      if (depModal && depModal.sha256) setDepModal((prev) => (prev ? { ...prev, sha256: "" } : prev));
      return;
    }
    sha256Hex(depModal.content)
      .then((h) => {
        if (!cancelled) {
          setDepModal((prev) => (prev ? { ...prev, sha256: h } : prev));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDepModal((prev) => (prev ? { ...prev, sha256: "" } : prev));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [depModal?.content]);

  async function openScriptReadonly() {
    const scriptName = String(detail?.script_name || "").trim();
    if (!scriptName) return;
    setScriptOpen(true);
    if (scriptLoadedName === scriptName && scriptContent) return;
    try {
      setScriptLoading(true);
      setScriptError(null);
      const qs = new URLSearchParams({ script_name: scriptName });
      const res = await fetchWithToken<any>(`/api/actuariat/engine-script?${qs.toString()}`);
      setScriptContent(String(res?.content || ""));
      setScriptLoadedName(scriptName);
    } catch (e: any) {
      setScriptError(e?.message || "Erreur de lecture du script");
    } finally {
      setScriptLoading(false);
    }
  }

  async function openDependencyDetail(kind: "local" | "external", dep: string) {
    const trimmed = String(dep || "").trim();
    if (!trimmed) return;
    if (kind === "external") {
      setDepModal({
        kind,
        dep: trimmed,
        loading: false,
        error: null,
        content: "",
        sha256: "",
      });
      return;
    }
    const resolvedPath = resolveLocalImportPath(String(detail?.script_name || ""), trimmed);
    setDepModal({
      kind,
      dep: trimmed,
      resolvedPath,
      loading: true,
      error: null,
      content: "",
      sha256: "",
    });
    if (!resolvedPath) {
      setDepModal({
        kind,
        dep: trimmed,
        resolvedPath,
        loading: false,
        error: "Impossible de résoudre le chemin du fichier importé.",
        content: "",
        sha256: "",
      });
      return;
    }
    try {
      const qs = new URLSearchParams({ script_name: resolvedPath });
      const res = await fetchWithToken<any>(`/api/actuariat/engine-script?${qs.toString()}`);
      setDepModal({
        kind,
        dep: trimmed,
        resolvedPath,
        loading: false,
        error: null,
        content: String(res?.content || ""),
        sha256: "",
      });
    } catch (e: any) {
      setDepModal({
        kind,
        dep: trimmed,
        resolvedPath,
        loading: false,
        error: e?.message || "Erreur de lecture de la dépendance locale",
        content: "",
        sha256: "",
      });
    }
  }

  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <span>Détail moteur de calcul - Run {detail.run_id}</span>
              {placeholder ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  placeholder
                </span>
              ) : null}
            </div>
            <div className="text-sm text-slate-600">{detail.engine_title || detail.catalog_title || detail.engine_version}</div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800">
            Fermer
          </button>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 text-sm font-semibold text-slate-900">Identification</div>
            <div className="space-y-1 text-sm text-slate-700">
              <div><span className="font-medium">Famille :</span> {detail.engine_family || "—"}</div>
              <div><span className="font-medium">Code :</span> {detail.engine_code || "—"}</div>
              <div><span className="font-medium">Version :</span> {detail.engine_version || "—"}</div>
              <div><span className="font-medium">Titre :</span> {detail.catalog_title || detail.engine_title || "—"}</div>
              <div><span className="font-medium">Statut catalogue :</span> {detail.catalog_status || "—"}</div>
              <div><span className="font-medium">Script :</span> {detail.script_name || "—"}</div>
              <div><span className="font-medium">Repo path :</span> {detail.repo_path || "—"}</div>
            </div>
            {detail.script_name ? (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={openScriptReadonly}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50"
                >
                  {scriptLoading ? "Chargement du script..." : "Ouvrir le script (lecture seule)"}
                </button>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 text-sm font-semibold text-slate-900">Exécution du run</div>
            <div className="space-y-1 text-sm text-slate-700">
              <div><span className="font-medium">Run :</span> {detail.run_id}</div>
              <div><span className="font-medium">Durée :</span> {detail.execution_stats_json?.duration_ms != null ? `${fmtNum(detail.execution_stats_json.duration_ms, 0)} ms` : "—"}</div>
              <div><span className="font-medium">Statut :</span> {detail.execution_stats_json?.run_status || "—"}</div>
              <div><span className="font-medium">Début :</span> {detail.execution_stats_json?.started_at ? String(detail.execution_stats_json.started_at).replace("T", " ").slice(0, 19) : "—"}</div>
              <div><span className="font-medium">Fin :</span> {detail.execution_stats_json?.ended_at ? String(detail.execution_stats_json.ended_at).replace("T", " ").slice(0, 19) : "—"}</div>
            </div>
          </div>

          {scriptOpen ? (
            <div className="rounded-lg border border-slate-200 bg-white p-3 lg:col-span-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-900">Script source (lecture seule)</div>
                <button
                  type="button"
                  onClick={() => setScriptOpen(false)}
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
                >
                  Fermer
                </button>
              </div>
              <div className="mb-2 text-xs text-slate-500">{detail.script_name || "—"}</div>
              {scriptLoading ? <div className="text-sm text-slate-600">Chargement du script...</div> : null}
              {scriptError ? <div className="text-sm text-red-700">{scriptError}</div> : null}
              {!scriptLoading && !scriptError && scriptContent ? (
                <div className="mb-3 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <div className="mb-1 text-xs font-semibold text-slate-700">Traçabilité (hash)</div>
                    <div className="break-all font-mono text-[11px] text-slate-700">{scriptSha256 || "Calcul en cours..."}</div>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                    <div className="mb-1 text-xs font-semibold text-slate-700">Dépendances de code (extraites)</div>
                    <div className="space-y-2 text-[11px] text-slate-700">
                      <div>
                        <div className="font-semibold">Imports locaux</div>
                        {scriptDeps.local.length ? (
                          <div className="mt-1 space-y-0.5">
                            {scriptDeps.local.map((dep) => (
                              <button
                                key={`local-${dep}`}
                                type="button"
                                onClick={() => openDependencyDetail("local", dep)}
                                className="block w-full text-left font-mono text-blue-700 hover:underline"
                              >
                                {dep}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="text-slate-500">Aucun import local détecté.</div>
                        )}
                      </div>
                      <div>
                        <div className="font-semibold">Imports externes</div>
                        {scriptDeps.external.length ? (
                          <div className="mt-1 space-y-0.5">
                            {scriptDeps.external.map((dep) => (
                              <button
                                key={`ext-${dep}`}
                                type="button"
                                onClick={() => openDependencyDetail("external", dep)}
                                className="block w-full text-left font-mono text-blue-700 hover:underline"
                              >
                                {dep}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="text-slate-500">Aucun import externe détecté.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
              {!scriptLoading && !scriptError ? (
                <pre className="max-h-[26rem] overflow-auto rounded-md bg-slate-50 p-3 text-[11px] text-slate-800">
                  {scriptContent || "Contenu vide."}
                </pre>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-lg border border-slate-200 bg-white p-3 lg:col-span-2">
            <div className="mb-2 text-sm font-semibold text-slate-900">Méthodologie / portée</div>
            <div className="space-y-2 text-sm text-slate-700">
              <div>{detail.catalog_description || "—"}</div>
              <div><span className="font-medium">Scope :</span> {detail.methodology_scope || "—"}</div>
              <div><span className="font-medium">Limites :</span> {detail.limitations || "—"}</div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-2 text-sm font-semibold text-slate-900">Modules activés</div>
            <div className="flex flex-wrap gap-2">
              {((Array.isArray(detail.modules_json) ? detail.modules_json : [])
                .concat(Array.isArray(detail.catalog_modules_json) ? detail.catalog_modules_json : []))
                .filter((v: any, i: number, arr: any[]) => v && arr.indexOf(v) === i)
                .map((m: any) => (
                  <span key={String(m)} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                    {String(m)}
                  </span>
                ))}
              {!(((Array.isArray(detail.modules_json) ? detail.modules_json : [])
                .concat(Array.isArray(detail.catalog_modules_json) ? detail.catalog_modules_json : [])).length) ? (
                <span className="text-sm text-slate-500">Aucun module documenté.</span>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-2 text-sm font-semibold text-slate-900">Avertissements</div>
            <div className="space-y-1 text-sm text-slate-700">
              {Array.isArray(detail.warnings_json) && detail.warnings_json.length ? (
                detail.warnings_json.map((w: any, idx: number) => <div key={idx}>• {String(w)}</div>)
              ) : (
                <div className="text-slate-500">Aucun avertissement documenté.</div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3 lg:col-span-2">
            <div className="mb-2 text-sm font-semibold text-slate-900">Paramètres clés (référentiel moteur)</div>
            {normalizeEngineParamRows(detail.parameters_schema_json).length ? (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-2 py-1 text-left font-bold">Paramètre</th>
                      <th className="px-2 py-1 text-left font-bold">Type</th>
                      <th className="px-2 py-1 text-left font-bold">Source</th>
                      <th className="px-2 py-1 text-left font-bold">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {normalizeEngineParamRows(detail.parameters_schema_json).map((p, idx) => (
                      <tr key={`${p.key}-${idx}`} className="border-t border-slate-100">
                        <td className="px-2 py-1 text-slate-800">
                          <div className="font-medium">{p.label}</div>
                          {p.key !== p.label ? <div className="text-xs text-slate-500">{p.key}</div> : null}
                        </td>
                        <td className="px-2 py-1 text-slate-800">{p.type || "—"}</td>
                        <td className="px-2 py-1 text-slate-800">{p.source || "—"}</td>
                        <td className="px-2 py-1 text-slate-700">{p.description || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-sm text-slate-500">Aucun paramètre clé documenté dans le référentiel moteur.</div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3 lg:col-span-2">
            <div className="mb-2 text-sm font-semibold text-slate-900">Configuration / dépendances (snapshot du run)</div>
            <div className="grid gap-3 lg:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-500">Configuration</div>
                <pre className="max-h-52 overflow-auto rounded-md bg-slate-50 p-2 text-[11px] text-slate-700">
                  {JSON.stringify(detail.engine_config_json || {}, null, 2)}
                </pre>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold text-slate-500">Dépendances de données</div>
                <pre className="max-h-52 overflow-auto rounded-md bg-slate-50 p-2 text-[11px] text-slate-700">
                  {JSON.stringify(detail.data_dependencies_json || {}, null, 2)}
                </pre>
              </div>
            </div>
          </div>

        </div>

        {depModal ? (
          <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-900/45 p-4" onClick={() => setDepModal(null)}>
            <div
              className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <div className="text-base font-semibold text-slate-900">
                    Dépendance {depModal.kind === "local" ? "locale" : "externe"}
                  </div>
                  <div className="font-mono text-xs text-slate-600">{depModal.dep}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setDepModal(null)}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800"
                >
                  Fermer
                </button>
              </div>

              {depModal.kind === "external" ? (
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    <div><span className="font-medium">Type :</span> Import externe (module/package)</div>
                    <div><span className="font-medium">Module :</span> <span className="font-mono">{depModal.dep}</span></div>
                    <div><span className="font-medium">Rôle :</span> Dépendance fournie par Node.js ou par un package npm, utilisée par le moteur de calcul.</div>
                    <div><span className="font-medium">Traçabilité :</span> Pour audit complet, compléter avec la version package (package-lock / node_modules) si nécessaire.</div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                    <div><span className="font-medium">Type :</span> Import local (fichier du dépôt)</div>
                    <div><span className="font-medium">Chemin importé :</span> <span className="font-mono">{depModal.dep}</span></div>
                    <div><span className="font-medium">Chemin résolu :</span> <span className="font-mono">{depModal.resolvedPath || "—"}</span></div>
                    <div><span className="font-medium">Rôle :</span> Fichier local appelé par le moteur ; son contenu influence directement le comportement du calcul.</div>
                  </div>
                  {depModal.loading ? <div className="text-sm text-slate-600">Chargement du fichier dépendance...</div> : null}
                  {depModal.error ? <div className="text-sm text-red-700">{depModal.error}</div> : null}
                  {!depModal.loading && !depModal.error ? (
                    <>
                      <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
                        <div className="mb-1 text-xs font-semibold text-slate-700">Traçabilité (hash SHA-256)</div>
                        <div className="break-all font-mono text-[11px] text-slate-700">{depModal.sha256 || "Calcul en cours..."}</div>
                      </div>
                      <pre className="max-h-[26rem] overflow-auto rounded-md bg-slate-50 p-3 text-[11px] text-slate-800">
                        {depModal.content || "Contenu vide."}
                      </pre>
                    </>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function HeaderHoverHelp({ label, help, align = "left" }: { label: string; help?: string; align?: "left" | "right" | "center" }) {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const [side, setSide] = useState<"left" | "right">("left");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function recompute() {
      if (!rootRef.current || typeof window === "undefined") return;
      const rect = rootRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      setSide(centerX > window.innerWidth / 2 ? "right" : "left");
    }
    recompute();
    window.addEventListener("resize", recompute);
    return () => window.removeEventListener("resize", recompute);
  }, []);

  if (!help) return <span>{label}</span>;

  return (
    <span
      ref={rootRef}
      className={`relative inline-flex ${align === "right" ? "justify-end" : align === "center" ? "justify-center" : ""} cursor-help`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      tabIndex={0}
    >
      <span>{label}</span>
      {open ? (
        <span
          role="tooltip"
          className={`pointer-events-none absolute top-full mt-1 z-[1000] w-[min(30rem,calc(100vw-2rem))] rounded-md border border-slate-200 bg-white p-3 text-left whitespace-pre-line normal-case tracking-normal text-[12px] font-normal leading-relaxed text-slate-700 shadow-xl ${
            side === "right" ? "right-0" : "left-0"
          }`}
        >
          {help}
        </span>
      ) : null}
    </span>
  );
}

function defaultHeaderHoverHelpForColumn(key: string, label: string) {
  const k = String(key || "").toLowerCase();
  const l = String(label || "");
  const byKey: Record<string, string> = {
    stress: "Stress : scénario de test (BASE / ADVERSE / SEVERE).\n\nReprésente le niveau de dégradation simulé appliqué aux hypothèses.",
    run: "Run : identifiant d’exécution technique.\n\nReprésente une instance de calcul (simulation, ORSA, S2, ALM, stress).",
    run_id: "Run : identifiant d’exécution technique.\n\nReprésente une instance de calcul (simulation, ORSA, S2, ALM, stress).",
    gwp: "GWP (Gross Written Premium) = primes brutes émises.\n\nReprésente le volume de primes avant cessions (réassurance/fronting).",
    claims: "Claims incurred = charge de sinistres.\n\nReprésente le coût des sinistres retenu dans le scénario (survenance / estimation).",
    scr: "SCR total (Solvency Capital Requirement) = capital de solvabilité requis.\n\nReprésente le capital nécessaire pour couvrir les risques selon le calcul S2 simulé.",
    solv: "Solvency = ratio de solvabilité.\n\nReprésente la couverture des risques par les fonds propres éligibles (Own funds / SCR).",
    delta_scr: "Δ SCR vs BASE = écart de SCR par rapport au scénario BASE.\n\nReprésente l’impact du stress sur le capital requis.",
    delta_solv: "Δ Solvency vs BASE = écart de ratio de solvabilité par rapport au scénario BASE.\n\nReprésente la dégradation (ou amélioration) du ratio sous stress.",
    engine: "Engine = version du moteur de calcul.\n\nReprésente la logique/implémentation utilisée pour produire ce résultat (traçabilité).",
    assumptions: "Hypothèses (résumé) = synthèse des multiplicateurs de stress.\n\nReprésente les paramètres clés qui expliquent le résultat du run.",
    s2_code: "S2 = code de branche Solvabilité II.\n\nReprésente la classification réglementaire de la branche d’assurance.",
    branch: "Branche = branche d’assurance / segment métier.\n\nReprésente le périmètre de risque analysé dans la ligne.",
    premium: "Premium volume = volume de primes.\n\nReprésente la base de risque prime utilisée dans le calcul S2 simplifié.",
    reserve: "Reserve volume = volume de réserves.\n\nReprésente la base de risque réserve (RBNS + IBNR) dans le calcul S2 simplifié.",
    cat: "CAT exposure = exposition catastrophe.\n\nReprésente la part de risque CAT (souvent Property) injectée dans les calculs.",
    cpty: "Counterparty / Expo contrepartie = exposition à une contrepartie.\n\nReprésente le risque lié aux réassureurs / fronting insurers.",
    sigma_p: "σ premium = paramètre de volatilité du module prime.\n\nReprésente la sensibilité du risque de prime dans le calcul S2 simplifié.",
    sigma_r: "σ reserve = paramètre de volatilité du module réserve.\n\nReprésente la sensibilité du risque de réserve dans le calcul S2 simplifié.",
    primary: "Fronting A = assureur de fronting principal.\n\nReprésente la contrepartie porteuse principale du programme de fronting.",
    secondary: "Fronting B = assureur de fronting secondaire.\n\nReprésente la contrepartie secondaire en co-fronting.",
    retro: "Rétro % = quote-part rétrocédée à la captive.\n\nReprésente la part du risque/fronting que la captive reprend économiquement.",
    fee: "Fee % = commission de fronting.\n\nReprésente le coût de portage facturé par l’assureur de fronting.",
    claims_fee: "Claims fee % = frais de gestion des sinistres.\n\nReprésente la part de coût liée au traitement des sinistres par le porteur.",
    gross: "Prime brute = prime avant frais de fronting et rétrocession.\n\nReprésente le volume initial du programme fronté.",
    net_captive: "Prime nette captive = prime revenant à la captive après frais.\n\nReprésente le volume économique réellement capté par la captive.",
    fronting_cost: "Coût fronting = frais de fronting + frais de gestion sinistres.\n\nReprésente le coût total du montage de portage.",
    insurer: "Assureur = contrepartie d’assurance/fronting/réassurance.\n\nReprésente l’entité portant une quote-part du programme.",
    role: "Rôle = fonction de la contrepartie dans le montage.\n\nReprésente par exemple le rôle principal/secondaire en co-fronting.",
    share: "Quote-part = pourcentage alloué.\n\nReprésente la part du programme attribuée à la contrepartie.",
    geo: "Zone = code géographique de concentration CAT.\n\nReprésente l’unité de découpage des expositions Property.",
    region: "Région = libellé de zone géographique.\n\nReprésente la zone de concentration pour l’analyse CAT.",
    gwp_share: "Part GWP = part des primes Property de la zone.\n\nReprésente le poids commercial de la zone dans le portefeuille Property.",
    si: "Somme assurée = capital assuré exposé.\n\nReprésente la base d’exposition potentielle en cas d’événement CAT.",
    cat_events: "CAT events = nombre d’événements CAT rattachés à la zone.\n\nReprésente l’activité catastrophe observée/simulée sur la zone.",
    weighted: "Expo pondérée = exposition CAT pondérée.\n\nReprésente l’exposition corrigée par un poids/vulnérabilité CAT.",
    hhi: "HHI contrib. = contribution à l’indice de concentration HHI.\n\nReprésente le poids de la zone dans la concentration globale.",
    asset: "Classe d’actifs = catégorie financière (cash, obligations, divers…).\n\nReprésente la poche d’allocation ou d’inventaire analysée.",
    bucket: "Bucket = tranche de duration / maturité.\n\nReprésente une classe temporelle pour analyser l’adossement actif-passif.",
    weight: "Poids = part relative en pourcentage.\n\nReprésente la contribution d’une ligne au total du portefeuille ou de l’allocation.",
    allocated: "Fonds propres alloués = montant de capital affecté.\n\nReprésente la part du capital proxy attribuée à une poche/ligne.",
    duration: "Duration = duration modifiée (ou moyenne selon le tableau).\n\nReprésente la sensibilité aux taux et le profil de maturité financière.",
    liquidity: "Liquidité = horizon de liquidité.\n\nReprésente le délai estimé de mobilisation d’une poche d’actifs.",
    hold_base: "Hold base = horizon de détention indicatif en scénario base.\n\nReprésente la durée estimée de mobilisation des fonds propres.",
    hold_stress: "Hold stress = horizon de détention indicatif en stress.\n\nReprésente la durée de mobilisation sous scénario dégradé.",
    type: "Type = type de run / type d’objet.\n\nReprésente la nature du calcul (base, stress, daily snapshot, etc.).",
    status: "Statut = état d’exécution ou de disponibilité.\n\nReprésente l’avancement/issue du run ou du set.",
    period: "Période = intervalle de dates couvert par le run.\n\nReprésente la fenêtre temporelle des snapshots/calculs.",
    snapshots: "Snapshots = nombre de photographies journalières.\n\nReprésente le volume de points de calcul sur la période.",
    avg_dur_gap: "Avg duration gap = écart moyen de duration actifs-passifs.\n\nReprésente le désalignement moyen de duration sur la période.",
    max_liq30: "Max besoin 30j = besoin de liquidité maximum sur 30 jours.\n\nReprésente le pic de pression de liquidité court terme.",
    deficit_days: "Jours déficit = nombre de jours en déficit de liquidité.\n\nReprésente la fréquence des jours de tension.",
    liq_alert: "Alerte liq = statut de tension de liquidité.\n\nReprésente une lecture synthétique du niveau de gap de liquidité selon les seuils paramétrés.",
    dur_alert: "Alerte duration = statut de désalignement de duration.\n\nReprésente une lecture synthétique de l’écart de duration selon les seuils paramétrés.",
    date: "Date = date du snapshot / observation.\n\nReprésente le jour de référence des données affichées.",
    assets: "Actifs = montant d’actifs (souvent en valeur de marché).\n\nReprésente le stock d’actifs retenu dans le périmètre du tableau.",
    cash: "Cash = trésorerie disponible.\n\nReprésente la liquidité immédiate (ou quasi immédiate) du périmètre analysé.",
    outflows: "Outflows = sorties de cash / décaissements.\n\nReprésente les usages de liquidité (sinistres, frais, etc.).",
    dgap: "Duration gap = écart de duration actifs - passifs.\n\nReprésente le désalignement de maturité/sensibilité taux.",
    liq_d1: "Gap liq D1 = gap de liquidité à 1 jour.\n\nReprésente sources - usages sur l’horizon 1 jour.",
    liq_d7: "Gap liq D7 = gap de liquidité à 7 jours.\n\nReprésente sources - usages sur l’horizon 7 jours.",
    liq_d30: "Gap liq D30 = gap de liquidité à 30 jours.\n\nReprésente sources - usages sur l’horizon 30 jours.",
    horizon: "Horizon = tranche de temps d’analyse (D1, D7, D30, etc.).\n\nReprésente la fenêtre temporelle du ladder de liquidité.",
    sources: "Sources = ressources de liquidité mobilisables.\n\nReprésente le cash et/ou les actifs mobilisables sur l’horizon.",
    uses: "Usages = besoins de liquidité / décaissements.\n\nReprésente les sorties de cash à financer sur l’horizon.",
    gap: "Gap = écart entre ressources et besoins.\n\nReprésente Sources - Usages (négatif = tension).",
    cum_gap: "Gap cumulé = somme progressive des gaps.\n\nReprésente l’accumulation de tension ou de surplus sur les horizons.",
    liabs: "Passifs proxy = passifs/liquidité passif simulés.\n\nReprésente la charge passif estimée affectée à la tranche de duration.",
    liq_days: "Liq (j) = horizon de liquidité pondéré en jours.\n\nReprésente le délai moyen de mobilisation de la classe d’actifs.",
    strata: "Strate = strate ALM de pilotage.\n\nReprésente une couche fonctionnelle de gestion (liquidité, portage, etc.).",
    inflows: "Inflows = entrées de cash.\n\nReprésente les encaissements (primes, recoveries, etc.) sur le périmètre.",
    net: "Net = solde net de cash.\n\nReprésente Inflows - Outflows sur la ligne.",
    buffer: "Buffer = réserve de liquidité.\n\nReprésente la capacité disponible pour absorber les sorties de cash.",
  };
  if (byKey[k]) return byKey[k];
  return `${l} : libellé de colonne du tableau.\n\nReprésente la donnée affichée pour cette ligne dans le contexte du bloc.`;
}

function stressCodeLabel(key: string) {
  const k = String(key || "").toUpperCase();
  if (k.includes("ADVERSE")) return "Adverse";
  if (k.includes("SEVERE")) return "Severe";
  if (k.includes("BASE")) return "Base";
  return key;
}

function summarizeStressProfile(profile: any) {
  if (!profile || typeof profile !== "object") return null;
  const p = profile.portfolio || {};
  const c = profile.claims || {};
  const s2 = profile.s2 || {};
  const own = profile.own_funds || {};
  const branches = profile.branches || {};
  return {
    gwp_mult: p.gwp_mult,
    incurred_mult: c.incurred_mult,
    cat_mult: c.property_cat_loss_mult,
    s2_nonlife_mult: s2.nonlife_mult,
    s2_cat_mult: s2.cat_exposure_mult,
    own_funds_mult: own.mult,
    branch_keys: Object.keys(branches),
    branches,
  };
}

function BranchStressSummary({ branches }: { branches: Record<string, any> }) {
  const rows = Object.entries(branches || {});
  if (!rows.length) return <div className="text-xs text-slate-500">Aucun stress spécifique par branche.</div>;
  return (
    <div className="space-y-2">
      {rows.map(([code, cfg]) => {
        const portfolio = cfg?.portfolio || {};
        const claims = cfg?.claims || {};
        const s2 = cfg?.s2 || {};
        const chips = [
          portfolio.gwp_mult != null ? `GWP x${fmtNum(portfolio.gwp_mult, 3)}` : null,
          claims.paid_mult != null ? `Paid x${fmtNum(claims.paid_mult, 3)}` : null,
          claims.incurred_mult != null ? `Incurred x${fmtNum(claims.incurred_mult, 3)}` : null,
          claims.rbns_mult != null ? `RBNS x${fmtNum(claims.rbns_mult, 3)}` : null,
          claims.ibnr_mult != null ? `IBNR x${fmtNum(claims.ibnr_mult, 3)}` : null,
          claims.property_cat_loss_mult != null ? `CAT x${fmtNum(claims.property_cat_loss_mult, 3)}` : null,
          s2.cat_exposure_mult != null ? `S2 CAT x${fmtNum(s2.cat_exposure_mult, 3)}` : null,
          s2.counterparty_mult != null ? `S2 Cpty x${fmtNum(s2.counterparty_mult, 3)}` : null,
        ].filter(Boolean);
        return (
          <div key={code} className="rounded-md border border-slate-200 bg-white p-2">
            <div className="text-xs font-semibold text-slate-700">Branche S2 {code}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {chips.map((chip) => (
                <span key={chip as string} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
                  {chip}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Kpi({
  label,
  value,
  sub,
  help,
  className = "",
  onClick,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  help?: string;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${onClick ? "cursor-pointer hover:border-slate-300" : ""} ${className}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-slate-500">
        <span>{label}</span>
        {help ? <InfoHint text={help} /> : null}
      </div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

function StatusChip({ label, tone }: { label: string; tone: "green" | "orange" | "red" | "slate" }) {
  const cls =
    tone === "green"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : tone === "orange"
      ? "bg-amber-100 text-amber-800 border-amber-200"
      : tone === "red"
      ? "bg-rose-100 text-rose-800 border-rose-200"
      : "bg-slate-100 text-slate-700 border-slate-200";
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>{label}</span>;
}

function TextInput({
  value,
  onChange,
  type = "text",
  className = "",
}: {
  value: any;
  onChange: (v: string) => void;
  type?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      step={type === "number" ? "0.01" : undefined}
      className={`w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-900 ${className}`}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function NumberField({
  label,
  value,
  onChange,
  help,
}: {
  label: string;
  value: any;
  onChange: (v: string) => void;
  help?: string;
}) {
  const displayValue = (() => {
    const raw = value ?? "";
    const s = String(raw).replace(/\s+/g, "");
    const normalized = s.replace(",", ".");
    if (normalized === "" || normalized === "-" || normalized === "." || normalized === "-.") return String(raw);
    const n = Number(normalized);
    if (!Number.isFinite(n)) return String(raw);
    const [intPart, decPart] = normalized.split(".");
    const sign = intPart.startsWith("-") ? "-" : "";
    const digits = intPart.replace("-", "");
    const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
    return decPart !== undefined ? `${sign}${grouped},${decPart}` : `${sign}${grouped}`;
  })();

  return (
    <label className="space-y-1">
      <div className="flex items-center gap-2 text-xs text-slate-600">
        <span>{label}</span>
        {help ? <InfoHint text={help} /> : null}
      </div>
      <TextInput
        type="text"
        value={displayValue}
        onChange={(v) => onChange(String(v).replace(/\s+/g, "").replace(",", "."))}
      />
    </label>
  );
}

function colorForSeries(name: string) {
  const n = String(name || "").toUpperCase();
  if (n.includes("SEVERE")) return "#b91c1c";
  if (n.includes("ADVERSE")) return "#ea580c";
  return "#0f172a";
}

function SimpleLineChart({
  title,
  help,
  rows,
  valueKey,
  valueLabel,
  yTickDecimals = 0,
  helpAlign = "left",
  collapsible = false,
  open = true,
  onToggle,
}: {
  title: string;
  help: string;
  rows: any[];
  valueKey: string;
  valueLabel: string;
  yTickDecimals?: number;
  helpAlign?: "left" | "right";
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const width = 900;
  const height = 220;
  const pad = 28;
  const chartWrapRef = useRef<HTMLDivElement | null>(null);
  const [hoverPoint, setHoverPoint] = useState<null | { x: number; y: number; date: string; series: string; value: number }>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const r of rows || []) {
      const key = String(r.series || "BASE");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    }
    return [...map.entries()];
  }, [rows]);

  const uniqueDates = useMemo(
    () =>
      Array.from(
        new Set((rows || []).map((r) => String(r?.date || "").slice(0, 10)).filter(Boolean))
      ).sort(),
    [rows]
  );
  const xIndexByDate = useMemo(
    () => Object.fromEntries(uniqueDates.map((d, i) => [d, i])),
    [uniqueDates]
  );

  const all = rows || [];
  const vals = all.map((r) => Number(r[valueKey] || 0)).filter((v) => Number.isFinite(v));
  const minV = vals.length ? Math.min(...vals) : 0;
  const maxV = vals.length ? Math.max(...vals) : 1;
  const span = maxV - minV || 1;
  const countMax = Math.max(1, uniqueDates.length, ...grouped.map(([, arr]) => arr.length));

  const xForDate = (date: string) => {
    const idx = Number(xIndexByDate[String(date || "").slice(0, 10)] ?? 0);
    return pad + (idx / Math.max(1, countMax - 1)) * (width - pad * 2);
  };
  const yForValue = (v: number) => height - pad - ((Number(v || 0) - minV) / span) * (height - pad * 2);

  const pathFor = (arr: any[]) =>
    arr
      .map((r, idx) => {
        const x = xForDate(String(r.date || ""));
        const y = yForValue(Number(r[valueKey] || 0));
        return `${idx === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

  const monthMarkers = useMemo(() => {
    const markers: { date: string; label: string; x: number }[] = [];
    let prevMonth = "";
    for (const d of uniqueDates) {
      const monthKey = d.slice(0, 7);
      if (monthKey !== prevMonth) {
        prevMonth = monthKey;
        const [y, m] = d.split("-");
        const monthLabels = ["jan", "fev", "mar", "avr", "mai", "jun", "jul", "aou", "sep", "oct", "nov", "dec"];
        const mm = Number(m || 1);
        markers.push({ date: d, label: `${monthLabels[Math.max(0, Math.min(11, mm - 1))]}/${String(y || "").slice(2, 4)}`, x: xForDate(d) });
      }
    }
    return markers;
  }, [uniqueDates]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <BlockTitle title={title} help={help} helpAlign={helpAlign} />
        {collapsible ? (
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700"
          >
            {open ? "Masquer" : "Afficher"}
          </button>
        ) : null}
      </div>
      {open ? (
      <>
      <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-600">
        {grouped.map(([name]) => (
          <div key={name} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorForSeries(name) }} />
            <span>{name}</span>
          </div>
        ))}
        <span className="ml-auto text-slate-500">
          {valueLabel} min {fmtNum(minV, 2)} | max {fmtNum(maxV, 2)}
        </span>
      </div>
      <div ref={chartWrapRef} className="relative overflow-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-56 min-w-[700px] w-full">
          <rect x="0" y="0" width={width} height={height} fill="white" />
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const y = height - pad - t * (height - pad * 2);
            return (
              <g key={t}>
                <line x1={pad} y1={y} x2={width - pad} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                <text x={4} y={y + 4} fontSize="10" fill="#64748b">
                  {fmtNum(minV + t * span, yTickDecimals)}
                </text>
              </g>
            );
          })}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const x = pad + t * (width - pad * 2);
            return <line key={`x-${t}`} x1={x} y1={pad} x2={x} y2={height - pad} stroke="#f1f5f9" strokeWidth="1" />;
          })}
          {monthMarkers.map((m) => (
            <g key={`m-${m.date}`}>
              <line x1={m.x} y1={pad} x2={m.x} y2={height - pad} stroke="#cbd5e1" strokeWidth="1" strokeDasharray="2 3" />
              <text x={m.x} y={height - 6} textAnchor="middle" fontSize="10" fill="#64748b">
                {m.label}
              </text>
            </g>
          ))}
          {grouped.map(([name, arr]) => (
            <g key={name}>
              <path d={pathFor(arr)} fill="none" stroke={colorForSeries(name)} strokeWidth="2.2" />
              {arr.map((r: any, idx: number) => {
                const x = xForDate(String(r.date || ""));
                const value = Number(r[valueKey] || 0);
                const y = yForValue(value);
                return (
                  <circle
                    key={`${name}-${idx}-${r.date}`}
                    cx={x}
                    cy={y}
                    r={4}
                    fill={colorForSeries(name)}
                    fillOpacity="0.001"
                    stroke="transparent"
                    onMouseEnter={() => setHoverPoint({ x, y, date: String(r.date || ""), series: String(name), value })}
                    onMouseMove={() => setHoverPoint({ x, y, date: String(r.date || ""), series: String(name), value })}
                    onMouseLeave={() => setHoverPoint((hp) => (hp?.series === name && hp?.date === String(r.date || "") ? null : hp))}
                  />
                );
              })}
            </g>
          ))}
        </svg>
        {hoverPoint ? (
          <div
            className={`pointer-events-none absolute z-20 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 shadow-lg ${
              hoverPoint.x > width / 2 ? "translate-x-[-100%]" : ""
            }`}
            style={{
              left: `${(hoverPoint.x / width) * 100}%`,
              top: `${Math.max(0, (hoverPoint.y / height) * 100 - 12)}%`,
            }}
          >
            <div className="font-semibold text-slate-900">{hoverPoint.series}</div>
            <div>Date : {hoverPoint.date}</div>
            <div>
              {valueLabel} : {valueLabel.toLowerCase().includes("mv") || valueKey.toLowerCase().includes("amount") ? fmtEur(hoverPoint.value) : fmtNum(hoverPoint.value, yTickDecimals || 2)}
            </div>
          </div>
        ) : null}
      </div>
      </>
      ) : null}
    </div>
  );
}

function StackedLadderChart({
  title,
  help,
  rows,
}: {
  title: string;
  help: string;
  rows: { label: string; sources: number; uses: number }[];
}) {
  const width = 900;
  const height = 240;
  const pad = 30;
  const maxV = Math.max(1, ...rows.map((r) => Math.max(Math.abs(n(r.sources)), Math.abs(n(r.uses)))));
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const barGroupW = rows.length ? innerW / rows.length : innerW;
  const barW = Math.max(14, Math.min(48, barGroupW * 0.35));
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <BlockTitle title={title} help={help} />
      <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-600">
        <div className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-500" />Sources</div>
        <div className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500" />Usages</div>
      </div>
      <div className="overflow-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-60 min-w-[700px] w-full">
          <rect x="0" y="0" width={width} height={height} fill="white" />
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const y = pad + t * innerH;
            return <line key={t} x1={pad} y1={y} x2={width - pad} y2={y} stroke="#e2e8f0" strokeWidth="1" />;
          })}
          {rows.map((r, i) => {
            const cx = pad + i * barGroupW + barGroupW / 2;
            const srcH = (Math.abs(n(r.sources)) / maxV) * (innerH * 0.8);
            const useH = (Math.abs(n(r.uses)) / maxV) * (innerH * 0.8);
            const baseY = height - pad;
            return (
              <g key={`${r.label}-${i}`}>
                <rect x={cx - barW - 2} y={baseY - srcH} width={barW} height={srcH} fill="#10b981" rx="3" />
                <rect x={cx + 2} y={baseY - useH} width={barW} height={useH} fill="#f43f5e" rx="3" />
                <text x={cx} y={height - 8} textAnchor="middle" fontSize="10" fill="#64748b">{r.label}</text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function StackedAreaTimeSeriesChart({
  title,
  help,
  rows,
  collapsible = false,
  open = true,
  onToggle,
}: {
  title: string;
  help: string;
  rows: { date: string; series: string; value: number }[];
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  const width = 980;
  const height = 260;
  const pad = 34;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const palette = ["#0f172a", "#2563eb", "#0ea5e9", "#14b8a6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#64748b"];

  const prepared = useMemo(() => {
    const byDate = new Map<string, Map<string, number>>();
    const seriesSet = new Set<string>();
    for (const r of rows || []) {
      const date = String(r.date || "");
      const series = String(r.series || "Série");
      if (!date) continue;
      if (!byDate.has(date)) byDate.set(date, new Map());
      byDate.get(date)!.set(series, n(r.value));
      seriesSet.add(series);
    }
    const dates = [...byDate.keys()].sort((a, b) => a.localeCompare(b));
    const seriesNames = [...seriesSet].sort((a, b) => a.localeCompare(b, "fr"));
    const stacks = new Map<string, { x: number; top: number; bottom: number }[]>();
    seriesNames.forEach((s) => stacks.set(s, []));
    let maxTotal = 1;
    dates.forEach((date, idx) => {
      const x = pad + (idx / Math.max(1, dates.length - 1)) * innerW;
      let cum = 0;
      const values = byDate.get(date)!;
      const total = seriesNames.reduce((acc, s) => acc + n(values.get(s)), 0);
      maxTotal = Math.max(maxTotal, total);
      for (const s of seriesNames) {
        const v = n(values.get(s));
        const bottom = cum;
        cum += v;
        stacks.get(s)!.push({ x, top: cum, bottom });
      }
    });
    return { dates, seriesNames, stacks, maxTotal };
  }, [rows]);

  const yPx = (v: number) => height - pad - (v / Math.max(1, prepared.maxTotal)) * innerH;
  const colorFor = (idx: number) => palette[idx % palette.length];
  const areaPath = (pts: { x: number; top: number; bottom: number }[]) => {
    if (!pts.length) return "";
    const topPath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${yPx(p.top).toFixed(2)}`).join(" ");
    const bottomPath = pts
      .slice()
      .reverse()
      .map((p) => `L${p.x.toFixed(2)},${yPx(p.bottom).toFixed(2)}`)
      .join(" ");
    return `${topPath} ${bottomPath} Z`;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <BlockTitle title={title} help={help} />
        {collapsible ? (
          <button
            type="button"
            onClick={onToggle}
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700"
          >
            {open ? "Masquer" : "Afficher"}
          </button>
        ) : null}
      </div>
      {open ? (
        <>
      <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-600">
        {prepared.seriesNames.map((s, idx) => (
          <div key={s} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorFor(idx) }} />
            <span>{s}</span>
          </div>
        ))}
        <span className="ml-auto text-slate-500">MV totale max {fmtEur(prepared.maxTotal)}</span>
      </div>
      <div className="overflow-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-64 min-w-[760px] w-full">
          <rect x="0" y="0" width={width} height={height} fill="white" />
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const y = pad + t * innerH;
            return (
              <g key={`y-${t}`}>
                <line x1={pad} y1={y} x2={width - pad} y2={y} stroke="#e2e8f0" strokeWidth="1" />
                <text x={4} y={y + 4} fontSize="10" fill="#64748b">
                  {fmtNum((1 - t) * prepared.maxTotal, 0)}
                </text>
              </g>
            );
          })}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const x = pad + t * innerW;
            return <line key={`x-${t}`} x1={x} y1={pad} x2={x} y2={height - pad} stroke="#f1f5f9" strokeWidth="1" />;
          })}
          {prepared.seriesNames.map((s, idx) => {
            const pts = prepared.stacks.get(s) || [];
            const d = areaPath(pts);
            if (!d) return null;
            const c = colorFor(idx);
            return <path key={s} d={d} fill={c} fillOpacity={0.18} stroke={c} strokeWidth="1.4" />;
          })}
          <text x={pad} y={height - 6} fontSize="10" fill="#64748b">{prepared.dates[0] || ""}</text>
          <text x={width - pad - 72} y={height - 6} fontSize="10" fill="#64748b">{prepared.dates[prepared.dates.length - 1] || ""}</text>
        </svg>
      </div>
        </>
      ) : null}
    </div>
  );
}

function SimpleTable({
  columns,
  rows,
  title,
  help,
  rowClassName,
  cellClassName,
  collapsible = false,
  open = true,
  onToggle,
}: {
  columns: { key: string; label: string; align?: "right" | "center"; nowrap?: boolean; labelHelp?: string; headerHoverHelp?: string; cellRenderer?: (row: any) => ReactNode }[];
  rows: any[];
  title?: string;
  help?: string;
  rowClassName?: (row: any, idx: number) => string;
  cellClassName?: (row: any, idx: number) => string;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-0 shadow-sm">
      {title ? (
        <div className="border-b border-slate-200 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="rounded-md bg-slate-200 px-2 py-1 text-sm font-bold text-slate-900">{title}</div>
              {help ? <InfoHint text={help} /> : null}
            </div>
            {collapsible ? (
              <button
                type="button"
                onClick={onToggle}
                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700"
              >
                {open ? "Masquer" : "Afficher"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {open ? (
      <div className="overflow-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-slate-600">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`px-3 py-2 text-left font-bold ${c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""} ${c.nowrap ? "whitespace-nowrap" : ""} ${c.headerHoverHelp ? "cursor-help" : ""}`}
              >
                  <span className={`inline-flex items-center gap-1 ${c.align === "right" ? "justify-end" : ""}`}>
                  <HeaderHoverHelp
                    label={c.label}
                    help={c.labelHelp || c.headerHoverHelp || defaultHeaderHoverHelpForColumn(c.key, c.label)}
                    align={c.align === "center" ? "center" : c.align === "right" ? "right" : "left"}
                  />
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, idx) => (
              <tr key={idx} className={`border-t border-slate-100 ${rowClassName ? rowClassName(r, idx) : ""}`}>
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={`px-3 py-2 align-top text-slate-800 ${c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : ""} ${c.nowrap ? "whitespace-nowrap tabular-nums" : ""} ${cellClassName ? cellClassName(r, idx) : ""}`}
                  >
                    {c.cellRenderer ? c.cellRenderer(r) : renderCellValue(r[c.key])}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-slate-500">
                Aucune donnée
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>
      ) : null}
    </div>
  );
}

function ActuariatPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const section = (searchParams.get("section") || "overview").toLowerCase();
  const orsaSetIdParam = searchParams.get("orsa_set_id");
  const globalRunIdParam = searchParams.get("run_id") || searchParams.get("focus_run_id");
  const requestedGlobalRunId = Number(globalRunIdParam || 0);

  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [almData, setAlmData] = useState<any | null>(null);
  const [almLoading, setAlmLoading] = useState(false);
  const [almError, setAlmError] = useState<string | null>(null);
  const [almSaving, setAlmSaving] = useState(false);
  const [almMessage, setAlmMessage] = useState<string | null>(null);
  const [almAllocDraft, setAlmAllocDraft] = useState<any[]>([]);
  const [almBranchDraft, setAlmBranchDraft] = useState<any[]>([]);
  const [almStressDraft, setAlmStressDraft] = useState<any[]>([]);
  const [almStressAssetDraft, setAlmStressAssetDraft] = useState<any[]>([]);
  const [almAlertThresholdsDraft, setAlmAlertThresholdsDraft] = useState<any>({
    liq_alert_tension_threshold_eur: 0,
    liq_alert_vigilance_threshold_eur: 500000,
    duration_alert_vigilance_abs_years: 3,
    duration_alert_tension_abs_years: 5,
  });
  const [almDrillRunId, setAlmDrillRunId] = useState<string>("");
  const [almDrillDate, setAlmDrillDate] = useState<string>("");
  const [almFinanceDate, setAlmFinanceDate] = useState<string>("");
  const [almFinanceAssetCode, setAlmFinanceAssetCode] = useState<string>("");
  const [almFinanceStrataCode, setAlmFinanceStrataCode] = useState<string>("");
  const [almFinanceCounterpartyId, setAlmFinanceCounterpartyId] = useState<string>("");
  const [almFinancePositionId, setAlmFinancePositionId] = useState<string>("");
  const [almFinanceExpandedMonths, setAlmFinanceExpandedMonths] = useState<Record<string, boolean>>({});
  const [almFinanceHistoryMvOpen, setAlmFinanceHistoryMvOpen] = useState(false);
  const [almFinanceHistoryDurationOpen, setAlmFinanceHistoryDurationOpen] = useState(false);
  const [almFinanceHistoryTableOpen, setAlmFinanceHistoryTableOpen] = useState(false);
  const [almFinancePositionsOpen, setAlmFinancePositionsOpen] = useState(false);
  const [almFinancePortfolioOpen, setAlmFinancePortfolioOpen] = useState(false);
  const [almFinancePositionBlocksOpen, setAlmFinancePositionBlocksOpen] = useState(false);
  const [almConfigVisible, setAlmConfigVisible] = useState(false);
  const [almStressVisible, setAlmStressVisible] = useState(false);
  const [almBlocksOpen, setAlmBlocksOpen] = useState<Record<string, boolean>>({
    proxyByAsset: false,
    proxyByBucket: false,
    runsDaily: false,
    stressComparison: false,
    chartCash: false,
    chartDurationGap: false,
    chartLiquidityNeed: false,
    chartOutflows: false,
    drilldown: false,
    drillLiqLadder: false,
    drillDurationLadder: false,
    drillAssetSnapshot: false,
    drillStrataSnapshot: false,
  });
  const [selectedRecentRunEngine, setSelectedRecentRunEngine] = useState<any | null>(null);
  const [editingEngineCatalog, setEditingEngineCatalog] = useState<any | null>(null);
  const [engineCatalogDraft, setEngineCatalogDraft] = useState<any | null>(null);
  const [engineCatalogSaving, setEngineCatalogSaving] = useState(false);
  const [engineScriptEditor, setEngineScriptEditor] = useState<{
    scriptName: string;
    content: string;
    loading: boolean;
    saving: boolean;
    error: string | null;
    message: string | null;
  } | null>(null);
  const [s2EngineConfigDraft, setS2EngineConfigDraft] = useState<any | null>(null);
  const [s2EngineConfigMeta, setS2EngineConfigMeta] = useState<any | null>(null);
  const [s2EngineConfigLoading, setS2EngineConfigLoading] = useState(false);
  const [s2EngineConfigSaving, setS2EngineConfigSaving] = useState(false);
  const [s2EngineConfigRerunning, setS2EngineConfigRerunning] = useState(false);
  const [s2EngineConfigMessage, setS2EngineConfigMessage] = useState<string | null>(null);
  const [s2EngineConfigError, setS2EngineConfigError] = useState<string | null>(null);
  const [s2EngineConfigOpen, setS2EngineConfigOpen] = useState(false);
  const [s2WorkingRunId, setS2WorkingRunId] = useState<number | null>(null);
  const [s2RealOpen, setS2RealOpen] = useState(false);
  const [s2RealDate, setS2RealDate] = useState<string>("");
  const [s2RealOwnFundsMode, setS2RealOwnFundsMode] = useState<"auto" | "proxy" | "manual">("auto");
  const [s2RealOwnFundsManual, setS2RealOwnFundsManual] = useState<string>("");
  const [s2RealBatchYear, setS2RealBatchYear] = useState<string>("");
  const [s2RealOverwrite, setS2RealOverwrite] = useState(false);
  const [s2RealLoading, setS2RealLoading] = useState(false);
  const [s2RealSaving, setS2RealSaving] = useState(false);
  const [s2RealBatchRunning, setS2RealBatchRunning] = useState(false);
  const [s2RealError, setS2RealError] = useState<string | null>(null);
  const [s2RealMessage, setS2RealMessage] = useState<string | null>(null);
  const [s2RealPreview, setS2RealPreview] = useState<S2RealSnapshotPayload | null>(null);
  const [s2RealHistory, setS2RealHistory] = useState<any[]>([]);
  const [s2RealHistoryLoading, setS2RealHistoryLoading] = useState(false);
  const [s2RealBatchResult, setS2RealBatchResult] = useState<S2RealBatchPayload | null>(null);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const qs = new URLSearchParams();
      if (orsaSetIdParam) qs.set("orsa_set_id", orsaSetIdParam);
      const res = await fetchWithToken<ApiPayload>(`/api/actuariat/simulation${qs.toString() ? `?${qs.toString()}` : ""}`);
      setData(res);
    } catch (e: any) {
      setError(e.message || "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [orsaSetIdParam]);

  async function loadAlm() {
    try {
      setAlmLoading(true);
      setAlmError(null);
      setAlmMessage(null);
      const qs = new URLSearchParams();
      if (orsaSetIdParam) qs.set("orsa_set_id", orsaSetIdParam);
      if (Number.isFinite(requestedGlobalRunId) && requestedGlobalRunId > 0) qs.set("run_id", String(requestedGlobalRunId));
      if (almDrillRunId) qs.set("alm_v3_run_id", almDrillRunId);
      if (almDrillDate) qs.set("alm_v3_date", almDrillDate);
      if (almFinanceDate) qs.set("finance_business_date", almFinanceDate);
      if (almFinanceAssetCode) qs.set("finance_asset_code", almFinanceAssetCode);
      if (almFinanceStrataCode) qs.set("finance_strata_code", almFinanceStrataCode);
      if (almFinanceCounterpartyId) qs.set("finance_counterparty_id", almFinanceCounterpartyId);
      if (almFinancePositionId) qs.set("finance_position_id", almFinancePositionId);
      const res = await fetchWithToken<any>(`/api/actuariat/alm-proxy${qs.toString() ? `?${qs.toString()}` : ""}`);
      setAlmData(res);
      setAlmAllocDraft((Array.isArray(res?.asset_allocations) ? res.asset_allocations : []).map((r: any) => ({ ...r })));
      setAlmBranchDraft((Array.isArray(res?.branch_assumptions) ? res.branch_assumptions : []).map((r: any) => ({ ...r })));
      setAlmStressDraft((Array.isArray(res?.alm_v3_stress_configs) ? res.alm_v3_stress_configs : []).map((r: any) => ({ ...r })));
      setAlmStressAssetDraft((Array.isArray(res?.alm_v3_stress_asset_shocks) ? res.alm_v3_stress_asset_shocks : []).map((r: any) => ({ ...r })));
      setAlmAlertThresholdsDraft({ ...(res?.alm_v3_alert_thresholds || {}) });
      if (!almDrillRunId && res?.alm_v3_drilldown?.selected_run_id) setAlmDrillRunId(String(res.alm_v3_drilldown.selected_run_id));
      if (!almDrillDate && res?.alm_v3_drilldown?.selected_date) setAlmDrillDate(String(res.alm_v3_drilldown.selected_date));
      if (!almFinanceDate && res?.alm_v3_finance?.selected_date) setAlmFinanceDate(String(res.alm_v3_finance.selected_date));
      if (!almFinancePositionId && res?.alm_v3_finance?.selected_position_id) setAlmFinancePositionId(String(res.alm_v3_finance.selected_position_id));
    } catch (e: any) {
      setAlmError(e.message || "Erreur de chargement ALM");
    } finally {
      setAlmLoading(false);
    }
  }

  useEffect(() => {
    if (section === "alm" || section === "finance") loadAlm();
  }, [section, orsaSetIdParam, requestedGlobalRunId]);

  useEffect(() => {
    if (section === "finance") loadAlm();
  }, [section, almFinanceDate, almFinanceAssetCode, almFinanceStrataCode, almFinanceCounterpartyId, almFinancePositionId]);

  const toggleAlmBlock = (key: string) => {
    setAlmBlocksOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  async function loadS2EngineConfig() {
    const scenarioId = Number(selected?.set?.scenario_id || 0);
    if (!scenarioId) return;
    try {
      setS2EngineConfigLoading(true);
      setS2EngineConfigError(null);
      setS2EngineConfigMessage(null);
      const res = await fetchWithToken<S2EngineConfigPayload>(`/api/actuariat/s2-engine-config?scenario_id=${scenarioId}`);
      setS2EngineConfigDraft(structuredClone(res.config || {}));
      setS2EngineConfigMeta({
        scenario_id: res.scenario_id,
        scenario_code: res.scenario_code || null,
        source: res.source,
        parameter_row: res.parameter_row || null,
      });
    } catch (e: any) {
      setS2EngineConfigError(e?.message || "Erreur de chargement du paramétrage S2");
      setS2EngineConfigDraft(null);
      setS2EngineConfigMeta(null);
    } finally {
      setS2EngineConfigLoading(false);
    }
  }

  async function saveS2EngineConfig() {
    const scenarioId = Number(selected?.set?.scenario_id || 0);
    if (!scenarioId || !s2EngineConfigDraft) return false;
    try {
      setS2EngineConfigSaving(true);
      setS2EngineConfigError(null);
      setS2EngineConfigMessage(null);
      const res = await fetchJsonWithToken<S2EngineConfigPayload>("/api/actuariat/s2-engine-config", {
        method: "PUT",
        body: JSON.stringify({ scenario_id: scenarioId, config: s2EngineConfigDraft }),
      });
      setS2EngineConfigDraft(structuredClone(res.config || {}));
      setS2EngineConfigMeta({
        scenario_id: res.scenario_id,
        scenario_code: res.scenario_code || null,
        source: res.source,
        parameter_row: res.parameter_row || null,
      });
      setS2EngineConfigMessage("Paramétrage S2 placeholder enregistré.");
      return true;
    } catch (e: any) {
      setS2EngineConfigError(e?.message || "Erreur d'enregistrement du paramétrage S2");
      return false;
    } finally {
      setS2EngineConfigSaving(false);
    }
  }

  async function rerunS2WorkingRun() {
    const scenarioId = Number(selected?.set?.scenario_id || 0);
    const runId = Number(s2WorkingRunId || 0);
    const snapshotDate = String(selected?.summary?.snapshot_date || "");
    if (!scenarioId || !runId || !snapshotDate) return;
    try {
      setS2EngineConfigRerunning(true);
      setS2EngineConfigError(null);
      setS2EngineConfigMessage(null);
      const res = await fetchJsonWithToken<any>("/api/actuariat/s2-engine-config/rerun", {
        method: "POST",
        body: JSON.stringify({ scenario_id: scenarioId, run_id: runId, snapshot_date: snapshotDate }),
      });
      const ratio = Number(res?.s2_result?.solvency_ratio_pct || 0);
      const scr = Number(res?.s2_result?.scr_total || 0);
      setS2EngineConfigMessage(
        `Recalcul S2 lancé sur run ${runId} (${snapshotDate}) via ${res?.rerun_script || "script"} - SCR ${fmtEur(scr)} | Solvency ${fmtPct(ratio)}`
      );
      await load();
    } catch (e: any) {
      setS2EngineConfigError(e?.message || "Erreur de relance S2");
    } finally {
      setS2EngineConfigRerunning(false);
    }
  }

  async function saveAndRerunS2WorkingRun() {
    const ok = await saveS2EngineConfig();
    if (!ok) return;
    await rerunS2WorkingRun();
  }

  const selected = data?.selected || null;
  const comparison = selected?.comparison || [];
  const members = selected?.members || [];
  const byStress = useMemo(() => Object.fromEntries(comparison.map((r: any) => [r.stress_code, r])), [comparison]);
  const base = byStress.BASE || comparison[0] || null;
  const globalSelectedRunId = Number(globalRunIdParam || 0);
  const selectedRun =
    Number.isFinite(globalSelectedRunId) && globalSelectedRunId > 0
      ? comparison.find((r: any) => Number(r.run_id) === globalSelectedRunId) || null
      : null;
  const effectiveSelectedRun = selectedRun || base;
  const effectiveSelectedRunId = Number(effectiveSelectedRun?.run_id || 0);
  const runStorageKey = selected?.set?.id ? `actuariat_run_id_${selected.set.id}` : "";

  useEffect(() => {
    if (!runStorageKey || !effectiveSelectedRunId || typeof window === "undefined") return;
    localStorage.setItem(runStorageKey, String(effectiveSelectedRunId));
  }, [runStorageKey, effectiveSelectedRunId]);

  useEffect(() => {
    if (globalRunIdParam || !runStorageKey || typeof window === "undefined") return;
    if (!comparison.length) return;
    const persisted = Number(localStorage.getItem(runStorageKey) || 0);
    if (!persisted || !comparison.some((r: any) => Number(r.run_id) === persisted)) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("run_id", String(persisted));
    params.delete("focus_run_id");
    router.push(`/actuariat?${params.toString()}`);
  }, [globalRunIdParam, runStorageKey, comparison, searchParams, router]);

  const frontingSummaryByRun = useMemo(() => {
    const rows = selected?.fronting_summary_by_run || [];
    return Object.fromEntries(rows.map((r: any) => [Number(r.run_id), r]));
  }, [selected]);
  const overviewComparisonRunIds = useMemo(() => new Set(comparison.map((r: any) => Number(r.run_id))), [comparison]);
  const recentRunEngineByRunId = useMemo(() => {
    const rows = Array.isArray(data?.recent_run_engine_details) ? data.recent_run_engine_details : [];
    return Object.fromEntries(rows.map((r: any) => [Number(r.run_id), r]));
  }, [data?.recent_run_engine_details]);
  const selectedRunEngineByRunId = useMemo(() => {
    const rows = Array.isArray(selected?.run_engine_details) ? selected.run_engine_details : [];
    return Object.fromEntries(rows.map((r: any) => [Number(r.run_id), r]));
  }, [selected?.run_engine_details]);
  const s2WorkingRun = useMemo(
    () => (selected?.s2_results || []).find((r: any) => Number(r.run_id) === Number(s2WorkingRunId)) || null,
    [selected?.s2_results, s2WorkingRunId]
  );

  useEffect(() => {
    const rows = Array.isArray(selected?.s2_results) ? selected.s2_results : [];
    if (!rows.length) {
      setS2WorkingRunId(null);
      return;
    }
    const preferred =
      Number.isFinite(globalSelectedRunId) && globalSelectedRunId > 0
        ? globalSelectedRunId
        : Number(selected?.set?.base_run_id || 0);
    const fallback = Number(rows[0]?.run_id || 0);
    const currentOk = rows.some((r: any) => Number(r.run_id) === Number(s2WorkingRunId));
    if (!currentOk) {
      const nextId = rows.some((r: any) => Number(r.run_id) === preferred) ? preferred : fallback;
      setS2WorkingRunId(nextId || null);
    }
  }, [selected?.s2_results, selected?.set?.base_run_id, globalSelectedRunId]);

  useEffect(() => {
    if (section === "s2" && selected?.set?.scenario_id) {
      loadS2EngineConfig();
    }
  }, [section, selected?.set?.scenario_id]);

  useEffect(() => {
    if (section !== "s2") return;
    if (!s2RealDate) {
      const fallback = String(selected?.summary?.snapshot_date || "").slice(0, 10);
      if (fallback) setS2RealDate(fallback);
    }
    if (!s2RealBatchYear) {
      const y = String(selected?.summary?.snapshot_date || "").slice(0, 4);
      if (/^\d{4}$/.test(y)) setS2RealBatchYear(y);
    }
  }, [section, selected?.summary?.snapshot_date, s2RealDate, s2RealBatchYear]);

  useEffect(() => {
    if (section !== "s2") return;
    const y = Number(String(s2RealDate || "").slice(0, 4));
    if (!Number.isFinite(y) || y < 2000 || y > 2100) return;
    let cancelled = false;
    setS2RealHistoryLoading(true);
    fetchWithToken<S2RealListPayload>(`/api/actuariat/s2-real/list?year=${y}`)
      .then((res) => {
        if (cancelled) return;
        setS2RealHistory(Array.isArray(res?.rows) ? res.rows : []);
      })
      .catch(() => {
        if (cancelled) return;
        setS2RealHistory([]);
      })
      .finally(() => {
        if (!cancelled) setS2RealHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [section, s2RealDate]);

  const selectS2WorkingRun = async (run: any) => {
    const nextRunId = Number(run?.run_id || 0) || null;
    setS2WorkingRunId(nextRunId);
    if (nextRunId) onSelectRun(nextRunId);
    setS2EngineConfigOpen(true);
    if (selected?.set?.scenario_id) {
      await loadS2EngineConfig();
    }
  };

  async function calculateS2RealPreview() {
    const scenarioId = Number(selected?.set?.scenario_id || 0);
    if (!scenarioId || !s2RealDate) return;
    try {
      setS2RealLoading(true);
      setS2RealError(null);
      setS2RealMessage(null);
      const res = await fetchJsonWithToken<S2RealSnapshotPayload>("/api/actuariat/s2-real/calculate", {
        method: "POST",
        body: JSON.stringify({
          scenario_id: scenarioId,
          reference_run_id: s2WorkingRunId || null,
          snapshot_date: s2RealDate,
          own_funds_mode: s2RealOwnFundsMode,
          own_funds_manual_input_eur:
            s2RealOwnFundsMode === "manual" && s2RealOwnFundsManual !== "" ? Number(s2RealOwnFundsManual) : null,
        }),
      });
      setS2RealPreview(res);
      setS2RealMessage("Prévisualisation S2 réel calculée.");
    } catch (e: any) {
      setS2RealError(e?.message || "Erreur de calcul S2 réel");
      setS2RealPreview(null);
    } finally {
      setS2RealLoading(false);
    }
  }

  async function saveS2RealSnapshotUi() {
    const scenarioId = Number(selected?.set?.scenario_id || 0);
    if (!scenarioId || !s2RealDate) return;
    try {
      setS2RealSaving(true);
      setS2RealError(null);
      setS2RealMessage(null);
      const res = await fetchJsonWithToken<S2RealSnapshotPayload>("/api/actuariat/s2-real/save", {
        method: "POST",
        body: JSON.stringify({
          scenario_id: scenarioId,
          reference_run_id: s2WorkingRunId || null,
          snapshot_date: s2RealDate,
          own_funds_mode: s2RealOwnFundsMode,
          own_funds_manual_input_eur:
            s2RealOwnFundsMode === "manual" && s2RealOwnFundsManual !== "" ? Number(s2RealOwnFundsManual) : null,
          overwrite: s2RealOverwrite,
        }),
      });
      setS2RealPreview(res);
      setS2RealMessage(
        `Snapshot S2 réel enregistré (${res?.snapshot?.snapshot_date || s2RealDate})${res?.saved?.overwritten ? " - écrasé" : ""}.`
      );
      const y = Number(String(s2RealDate || "").slice(0, 4));
      if (Number.isFinite(y)) {
        const list = await fetchWithToken<S2RealListPayload>(`/api/actuariat/s2-real/list?year=${y}`);
        setS2RealHistory(Array.isArray(list?.rows) ? list.rows : []);
      }
    } catch (e: any) {
      const code = String(e?.message || "");
      setS2RealError(
        code === "s2_real_snapshot_exists"
          ? "Un snapshot réel existe déjà à cette date (cocher 'Écraser' pour remplacer)."
          : code || "Erreur d'enregistrement S2 réel"
      );
    } finally {
      setS2RealSaving(false);
    }
  }

  async function generateS2RealMonthlyBatch() {
    const scenarioId = Number(selected?.set?.scenario_id || 0);
    const year = Number(s2RealBatchYear || 0);
    if (!scenarioId || !Number.isFinite(year)) return;
    try {
      setS2RealBatchRunning(true);
      setS2RealError(null);
      setS2RealMessage(null);
      setS2RealBatchResult(null);
      const res = await fetchJsonWithToken<S2RealBatchPayload>("/api/actuariat/s2-real/generate-monthly", {
        method: "POST",
        body: JSON.stringify({
          scenario_id: scenarioId,
          year,
          reference_run_id: s2WorkingRunId || null,
          own_funds_mode: s2RealOwnFundsMode,
          own_funds_manual_input_eur:
            s2RealOwnFundsMode === "manual" && s2RealOwnFundsManual !== "" ? Number(s2RealOwnFundsManual) : null,
          overwrite: s2RealOverwrite,
        }),
      });
      setS2RealBatchResult(res);
      setS2RealMessage(`Batch mensuel terminé : ${res.generated_count} mois générés, ${res.failed_count} en échec.`);
      const list = await fetchWithToken<S2RealListPayload>(`/api/actuariat/s2-real/list?year=${year}`);
      setS2RealHistory(Array.isArray(list?.rows) ? list.rows : []);
    } catch (e: any) {
      setS2RealError(e?.message || "Erreur de génération mensuelle S2 réel");
    } finally {
      setS2RealBatchRunning(false);
    }
  }

  const openEngineDetailForRun = (runId: any) => {
    const rid = Number(runId);
    const detail = recentRunEngineByRunId[rid] || selectedRunEngineByRunId[rid] || null;
    if (detail) setSelectedRecentRunEngine(detail);
  };

  async function saveEngineCatalogDraft() {
    if (!engineCatalogDraft?.id) return;
    try {
      setEngineCatalogSaving(true);
      const res = await fetchJsonWithToken<any>(`/api/actuariat/engine-catalog/${engineCatalogDraft.id}`, {
        method: "PUT",
        body: JSON.stringify({
          title: engineCatalogDraft.title,
          description: engineCatalogDraft.description,
          methodology_scope: engineCatalogDraft.methodology_scope,
          limitations: engineCatalogDraft.limitations,
          script_name: engineCatalogDraft.script_name,
          repo_path: engineCatalogDraft.repo_path,
          status: engineCatalogDraft.status,
          modules_json: String(engineCatalogDraft.modules_text || "")
            .split(",")
            .map((s: string) => s.trim())
            .filter(Boolean),
        }),
      });
      setEditingEngineCatalog(res.engine_catalog);
      setEngineCatalogDraft({
        ...res.engine_catalog,
        modules_text: Array.isArray(res.engine_catalog?.modules_json) ? res.engine_catalog.modules_json.join(", ") : "",
      });
      await load();
    } catch (e: any) {
      alert(e?.message || "Erreur de sauvegarde du référentiel moteur");
    } finally {
      setEngineCatalogSaving(false);
    }
  }

  async function openEngineCatalogScriptEditor() {
    const scriptName = String(engineCatalogDraft?.script_name || "").trim();
    if (!scriptName) {
      alert("Aucun script source renseigné.");
      return;
    }
    setEngineScriptEditor({
      scriptName,
      content: "",
      loading: true,
      saving: false,
      error: null,
      message: null,
    });
    try {
      const qs = new URLSearchParams({ script_name: scriptName });
      const res = await fetchWithToken<any>(`/api/actuariat/engine-script?${qs.toString()}`);
      setEngineScriptEditor({
        scriptName,
        content: String(res?.content || ""),
        loading: false,
        saving: false,
        error: null,
        message: null,
      });
    } catch (e: any) {
      setEngineScriptEditor({
        scriptName,
        content: "",
        loading: false,
        saving: false,
        error: e?.message || "Erreur de lecture du script",
        message: null,
      });
    }
  }

  async function saveEngineCatalogScriptEditor() {
    if (!engineScriptEditor?.scriptName) return;
    try {
      setEngineScriptEditor((s) => (s ? { ...s, saving: true, error: null, message: null } : s));
      await fetchJsonWithToken<any>("/api/actuariat/engine-script", {
        method: "PUT",
        body: JSON.stringify({
          script_name: engineScriptEditor.scriptName,
          content: engineScriptEditor.content,
        }),
      });
      setEngineScriptEditor((s) =>
        s ? { ...s, saving: false, message: "Script enregistré avec succès." } : s
      );
    } catch (e: any) {
      setEngineScriptEditor((s) =>
        s ? { ...s, saving: false, error: e?.message || "Erreur d'enregistrement du script" } : s
      );
    }
  }

  const onSelectSet = (setId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (setId) params.set("orsa_set_id", setId);
    else params.delete("orsa_set_id");
    router.push(`/actuariat?${params.toString()}`);
  };

  const onSelectRun = (runId: string | number) => {
    const params = new URLSearchParams(searchParams.toString());
    const nRunId = Number(runId || 0);
    if (Number.isFinite(nRunId) && nRunId > 0) params.set("run_id", String(nRunId));
    else params.delete("run_id");
    params.delete("focus_run_id");
    router.push(`/actuariat?${params.toString()}`);
  };

  const onSelectSection = (nextSection: string, extraParams?: Record<string, string | number | null | undefined>) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("section", nextSection);
    if (extraParams) {
      for (const [k, v] of Object.entries(extraParams)) {
        if (v === null || v === undefined || v === "") params.delete(k);
        else params.set(k, String(v));
      }
    }
    router.push(`/actuariat?${params.toString()}`);
  };

  const overviewRows = comparison.map((r: any) => ({
    stress: r.stress_code,
    run: r.run_id,
    gwp: fmtEur(r.gwp_total),
    claims: fmtEur(r.claims_incurred_total),
    scr: fmtEur(r.scr_total),
    solv: fmtPct(r.solvency_ratio_pct),
    cat: fmtEur(r.property_cat_exposure_s2),
    fronting: fmtEur(frontingSummaryByRun[Number(r.run_id)]?.fronting_total_cost || 0),
    __run_id: r.run_id,
  }));

  const catRows = ((selected?.cat_concentration_by_run || []) as any[])
    .filter((r: any) => Number(r.run_id) === Number(effectiveSelectedRunId || selected?.set?.base_run_id))
    .map((r: any) => ({
    geo: r.geo_code,
    region: r.region_name || "—",
    gwp: fmtEur(r.property_gwp_gross),
    gwp_share: fmtPct(n(r.property_gwp_share_pct) * 100),
    si: fmtEur(r.property_sum_insured),
    cat_events: r.cat_event_count,
    weighted: fmtEur(r.weighted_cat_exposure),
    hhi: fmtNum(r.hhi_contribution, 6),
  }));

  const s2InputRows = (selected?.s2_inputs_base_run || []).map((r: any) => ({
    s2_code: r.s2_code,
    branch: r.branch_label || "—",
    premium: fmtEur(r.premium_volume),
    reserve: fmtEur(r.reserve_volume),
    cat: fmtEur(r.cat_exposure),
    cpty: fmtEur(r.counterparty_exposure),
    sigma_p: fmtNum(r.sigma_premium, 3),
    sigma_r: fmtNum(r.sigma_reserve, 3),
  }));
  const captiveActiveBranchCodes = useMemo(() => {
    const active = new Set<string>();
    for (const r of selected?.s2_inputs_base_run || []) {
      const code = String(r?.s2_code || "").trim().toUpperCase();
      if (!code) continue;
      const hasExposure =
        Math.abs(n(r?.premium_volume)) > 0 ||
        Math.abs(n(r?.reserve_volume)) > 0 ||
        Math.abs(n(r?.cat_exposure)) > 0 ||
        Math.abs(n(r?.counterparty_exposure)) > 0;
      if (hasExposure) active.add(code);
    }
    return active;
  }, [selected?.s2_inputs_base_run]);
  const almBranchDraftVisible = useMemo(() => {
    if (!almBranchDraft.length) return [] as any[];
    const withSourceIndex = almBranchDraft.map((r: any, sourceIndex: number) => ({ ...r, __sourceIndex: sourceIndex }));
    if (!captiveActiveBranchCodes.size) return withSourceIndex;
    const filtered = withSourceIndex.filter((r: any) => captiveActiveBranchCodes.has(String(r?.s2_code || "").trim().toUpperCase()));
    return filtered.length ? filtered : withSourceIndex;
  }, [almBranchDraft, captiveActiveBranchCodes]);

  const frontingPrograms = selected?.fronting_programs || [];
  const frontingAdjustments = selected?.fronting_adjustments || [];
  const frontingAllocations = selected?.fronting_allocations || [];
  const frontingCounterparties = selected?.fronting_counterparties || [];
  const stressParamCards = useMemo(() => {
    const filtered = (data?.stress_parameters || []).filter((p: any) => {
      if (!selected?.set?.scenario_id) return true;
      return Number(p.scenario_id) === Number(selected.set.scenario_id);
    });

    // Keep only the latest parameter version per scenario/key (historical rows may coexist).
    const latestByKey = new Map<string, any>();
    for (const p of filtered) {
      const dedupeKey = `${Number(p.scenario_id)}::${String(p.parameter_key || "")}`;
      const current = latestByKey.get(dedupeKey);
      const pTs = new Date(p.updated_at || 0).getTime();
      const cTs = current ? new Date(current.updated_at || 0).getTime() : -1;
      if (!current || pTs >= cTs) latestByKey.set(dedupeKey, p);
    }

    return Array.from(latestByKey.values())
      .sort((a: any, b: any) => String(a.parameter_key || "").localeCompare(String(b.parameter_key || "")))
      .map((p: any) => ({
        ...p,
        summary: summarizeStressProfile(p.value_json),
      }));
  }, [data?.stress_parameters, selected?.set?.scenario_id]);
  const almDurations = Array.isArray(almData?.duration_buckets) ? almData.duration_buckets : [];
  const almResult = almData?.result || null;
  const almV3RunSummaries = Array.isArray(almData?.alm_v3_run_summaries) ? almData.alm_v3_run_summaries : [];
  const almV3StressComparison = Array.isArray(almData?.alm_v3_stress_comparison) ? almData.alm_v3_stress_comparison : [];
  const almV3TimeSeries = Array.isArray(almData?.alm_v3_time_series) ? almData.alm_v3_time_series : [];
  const almV3StressConfigs = Array.isArray(almData?.alm_v3_stress_configs) ? almData.alm_v3_stress_configs : [];
  const almV3StressAssetShocks = Array.isArray(almData?.alm_v3_stress_asset_shocks) ? almData.alm_v3_stress_asset_shocks : [];
  const almV3Drilldown = almData?.alm_v3_drilldown || null;
  const almV3RerunResult = almData?.rerun_result || null;
  const almAlertThresholds = almData?.alm_v3_alert_thresholds || almAlertThresholdsDraft;
  const almV3Finance = almData?.alm_v3_finance || null;

  const almResultAssetClasses = Array.isArray(almData?.result_asset_classes) ? almData.result_asset_classes : [];
  const almResultDurationBuckets = Array.isArray(almData?.result_duration_buckets) ? almData.result_duration_buckets : [];
  const almAssetRowsDisplay = almResultAssetClasses.map((r: any) => ({
    asset: r.asset_label,
    bucket: r.duration_bucket_label || r.duration_bucket_code || "—",
    weight: fmtPct(r.target_weight_pct, 2),
    duration: `${fmtNum(r.duration_years, 2)} ans`,
    liquidity: `${fmtNum(r.liquidity_horizon_days, 0)} j`,
    allocated: fmtEur(r.allocated_own_funds_amount),
    hold_base: `${fmtNum(r.indicative_holding_years_base, 2)} ans`,
    hold_stress: `${fmtNum(r.indicative_holding_years_stress, 2)} ans`,
  }));
  const almBucketRowsDisplay = almResultDurationBuckets.map((r: any) => ({
    bucket: r.bucket_label,
    weight: fmtPct(r.target_weight_pct, 2),
    allocated: fmtEur(r.allocated_own_funds_amount),
    duration: `${fmtNum(r.avg_duration_years, 2)} ans`,
  }));
  const almV3RunSummaryRows = almV3RunSummaries.map((r: any) => ({
    run: r.run_code,
    type: r.run_type,
    status: r.status,
    period: `${String(r.date_min || "").slice(0, 10)} → ${String(r.date_max || "").slice(0, 10)}`,
    snapshots: fmtNum(r.snapshots_count, 0),
    avg_dur_gap: fmtNum(r.avg_duration_gap, 3),
    max_liq30: fmtEur(r.max_liquidity_need_30d),
    deficit_days: fmtNum(r.deficit_days, 0),
  }));
  const almV3StressRows = almV3StressComparison.map((r: any) => {
    const code = String(r.run_code || "");
    const stress = code.includes("__SEVERE")
      ? "SEVERE"
      : code.includes("__ADVERSE")
      ? "ADVERSE"
      : "BASE";
    const liq = r.liquidity_ladder || {};
    const minLiqGap = Math.min(n(liq.D1?.net_liquidity_gap_amount), n(liq.D7?.net_liquidity_gap_amount), n(liq.D30?.net_liquidity_gap_amount));
    const liqTension = n(almAlertThresholds?.liq_alert_tension_threshold_eur ?? 0);
    const liqVigilance = n(almAlertThresholds?.liq_alert_vigilance_threshold_eur ?? 500000);
    const liqAlert = minLiqGap < liqTension ? "Tension" : minLiqGap < liqVigilance ? "Vigilance" : "Confort";
    const durAbs = Math.abs(n(r.duration_gap));
    const durVigilance = n(almAlertThresholds?.duration_alert_vigilance_abs_years ?? 3);
    const durTension = n(almAlertThresholds?.duration_alert_tension_abs_years ?? 5);
    const durAlert = durAbs > durTension ? "Écart fort" : durAbs > durVigilance ? "À surveiller" : "Acceptable";
    return {
      stress,
      run: r.run_code,
      status: r.status || "—",
      liq_alert: liqAlert,
      dur_alert: durAlert,
      date: String(r.business_date || "").slice(0, 10),
      assets: fmtEur(r.total_assets_mv),
      cash: fmtEur(r.total_cash_base_ccy),
      outflows: fmtEur(r.total_liability_outflows),
      dgap: fmtNum(r.duration_gap, 3),
      liq_d1: fmtEur(liq.D1?.net_liquidity_gap_amount || 0),
      liq_d7: fmtEur(liq.D7?.net_liquidity_gap_amount || 0),
      liq_d30: fmtEur(liq.D30?.net_liquidity_gap_amount || 0),
    };
  });
  const almSeriesRows = almV3TimeSeries.map((r: any) => {
    const code = String(r.run_code || "");
    const series = code.includes("__SEVERE") ? "SEVERE" : code.includes("__ADVERSE") ? "ADVERSE" : "BASE";
    return {
      series,
      date: String(r.business_date || "").slice(0, 10),
      total_cash_base_ccy: n(r.total_cash_base_ccy),
      liquidity_buffer_available: n(r.liquidity_buffer_available),
      liquidity_need_30d: n(r.liquidity_need_30d),
      total_liability_outflows: n(r.total_liability_outflows),
      duration_gap: n(r.duration_gap),
    };
  });
  const almFinancePositions = Array.isArray(almV3Finance?.positions) ? almV3Finance.positions : [];
  const almFinancePositionsHistorySeries = Array.isArray(almV3Finance?.positions_history_series) ? almV3Finance.positions_history_series : [];
  const almFinancePositionDetail = almV3Finance?.position_detail || null;
  const almFinanceInstrumentLabel = almFinancePositionDetail?.position
    ? `${almFinancePositionDetail.position.instrument_name || "Instrument"} (${almFinancePositionDetail.position.instrument_code || "—"})`
    : "Instrument non sélectionné";
  const almFinanceHistorySource = [...(Array.isArray(almFinancePositionDetail?.history) ? almFinancePositionDetail.history : [])].sort(
    (a: any, b: any) => String(a?.business_date || "").localeCompare(String(b?.business_date || ""))
  );
  const almFinanceHistoryRows = useMemo(() => almFinanceHistorySource.map((r: any) => ({
    date: String(r.business_date || "").slice(0, 10),
    mv: fmtEur(r.market_value_amount),
    bv: fmtEur(r.book_value_amount),
    pnl: fmtEur(r.unrealized_pnl_amount),
    dur: fmtNum(r.modified_duration_years, 3),
    ytm: `${fmtNum(r.ytm_pct, 3)} %`,
    px: fmtNum(r.clean_price_pct ?? r.dirty_price_pct, 3),
  })), [almFinanceHistorySource]);
  const almFinanceChartRows = useMemo(() => almFinanceHistorySource.map((r: any) => ({
    series: "Position sélectionnée",
    date: String(r.business_date || "").slice(0, 10),
    market_value_amount: n(r.market_value_amount),
    modified_duration_years: n(r.modified_duration_years),
  })), [almFinanceHistorySource]);
  const almFinancePortfolioStackedRows = (almFinancePositionsHistorySeries || []).map((r: any) => ({
    date: String(r.date || "").slice(0, 10),
    series: `${r.instrument_code || `POS-${r.position_id}`} | ${r.instrument_name || `Position ${r.position_id}`}`,
    value: n(r.market_value_amount),
  }));
  const almFinanceHistoryMonthGroups = useMemo(() => {
    const groups = new Map<string, any[]>();
    for (const r of almFinanceHistoryRows) {
      const monthKey = String(r.date || "").slice(0, 7);
      if (!groups.has(monthKey)) groups.set(monthKey, []);
      groups.get(monthKey)!.push(r);
    }
    return Array.from(groups.entries()).map(([monthKey, rows]) => ({ monthKey, rows }));
  }, [almFinanceHistoryRows]);
  const almFinanceLatestMonthKey = useMemo(
    () => (almFinanceHistoryMonthGroups.length ? almFinanceHistoryMonthGroups[almFinanceHistoryMonthGroups.length - 1].monthKey : ""),
    [almFinanceHistoryMonthGroups]
  );

  const resetAlmFinanceFilters = () => {
    setAlmFinanceDate("");
    setAlmFinanceAssetCode("");
    setAlmFinanceStrataCode("");
    setAlmFinanceCounterpartyId("");
    setAlmFinancePositionId("");
  };
  useEffect(() => {
    setAlmFinanceExpandedMonths(almFinanceLatestMonthKey ? { [almFinanceLatestMonthKey]: true } : {});
  }, [almFinancePositionId, almFinanceLatestMonthKey]);
  useEffect(() => {
    setAlmFinanceHistoryMvOpen(false);
    setAlmFinanceHistoryDurationOpen(false);
    setAlmFinanceHistoryTableOpen(false);
  }, [almFinancePositionId]);
  const almDrillDurationRows = (almV3Drilldown?.duration_ladder || []).map((r: any) => ({
    bucket: r.bucket_label || r.bucket_code || "—",
    assets: fmtEur(r.assets_amount),
    liabs: fmtEur(r.liability_outflows_amount),
    gap: fmtEur(r.net_gap_amount),
    cum_gap: fmtEur(r.cumulative_gap_amount),
  }));
  const almDrillLiquidityRows = (almV3Drilldown?.liquidity_ladder || []).map((r: any) => ({
    horizon: `${r.horizon_code} (${fmtNum(r.horizon_days, 0)}j)`,
    sources: fmtEur(r.liquidity_sources_amount),
    uses: fmtEur(r.liquidity_uses_amount),
    gap: fmtEur(r.net_liquidity_gap_amount),
    cum_gap: fmtEur(r.cumulative_liquidity_gap_amount),
  }));
  const almDrillAssetRows = (almV3Drilldown?.asset_classes || []).map((r: any) => ({
    asset: r.asset_label || r.asset_code,
    mv: fmtEur(r.market_value_amount),
    bv: fmtEur(r.book_value_amount),
    share: fmtPct(r.share_of_assets_pct, 2),
    duration: fmtNum(r.duration_weighted_years, 3),
    liq_days: fmtNum(r.liquidity_horizon_days_weighted, 0),
  }));
  const almDrillStrataRows = (almV3Drilldown?.strata || []).map((r: any) => ({
    strata: r.strata_label || r.strata_code,
    assets: fmtEur(r.assets_mv),
    cash: fmtEur(r.cash_balance),
    inflows: fmtEur(r.inflows_amount),
    outflows: fmtEur(r.outflows_amount),
    net: fmtEur(r.net_cashflow_amount),
    buffer: fmtEur(r.liquidity_buffer),
  }));

  const saveAlmConfig = async () => {
    try {
      setAlmSaving(true);
      setAlmMessage(null);
      setAlmError(null);
      await fetchJsonWithToken("/api/actuariat/alm-proxy/config", {
        method: "PUT",
        body: JSON.stringify({
          orsa_set_id: selected?.set?.id || almData?.selected_set?.id || null,
          asset_allocations: almAllocDraft.map((r: any) => ({
            allocation_id: r.allocation_id,
            target_weight_pct: r.target_weight_pct,
            duration_years_override: r.duration_years_override,
            liquidity_horizon_days_override: r.liquidity_horizon_days_override,
            bucket_code: r.bucket_code || null,
            comment_text: r.comment_text || null,
          })),
          branch_assumptions: almBranchDraft.map((r: any) => ({
            id: r.id,
            holding_years_base: r.holding_years_base,
            holding_years_stress: r.holding_years_stress,
            capital_lock_factor: r.capital_lock_factor,
            liquidity_need_pct: r.liquidity_need_pct,
            weighting_mode: r.weighting_mode || "incurred_reserve",
            notes: r.notes || null,
          })),
        }),
      });
      setAlmMessage("Paramétrages ALM enregistrés.");
      await loadAlm();
    } catch (e: any) {
      setAlmError(e.message || "Erreur de sauvegarde ALM");
    } finally {
      setAlmSaving(false);
    }
  };

  const recomputeAlm = async () => {
    try {
      setAlmSaving(true);
      setAlmMessage(null);
      setAlmError(null);
      const res = await fetchJsonWithToken<any>("/api/actuariat/alm-proxy/recompute", {
        method: "POST",
        body: JSON.stringify({
          orsa_set_id: selected?.set?.id || almData?.selected_set?.id || null,
          run_id: Number.isFinite(requestedGlobalRunId) && requestedGlobalRunId > 0 ? requestedGlobalRunId : null,
        }),
      });
      setAlmData(res);
      setAlmAllocDraft((Array.isArray(res?.asset_allocations) ? res.asset_allocations : []).map((r: any) => ({ ...r })));
      setAlmBranchDraft((Array.isArray(res?.branch_assumptions) ? res.branch_assumptions : []).map((r: any) => ({ ...r })));
      setAlmStressDraft((Array.isArray(res?.alm_v3_stress_configs) ? res.alm_v3_stress_configs : []).map((r: any) => ({ ...r })));
      setAlmStressAssetDraft((Array.isArray(res?.alm_v3_stress_asset_shocks) ? res.alm_v3_stress_asset_shocks : []).map((r: any) => ({ ...r })));
      setAlmAlertThresholdsDraft({ ...(res?.alm_v3_alert_thresholds || {}) });
      setAlmMessage("Recalcul ALM effectué.");
    } catch (e: any) {
      setAlmError(e.message || "Erreur de recalcul ALM");
    } finally {
      setAlmSaving(false);
    }
  };

  const saveAlmStressConfig = async () => {
    try {
      setAlmSaving(true);
      setAlmMessage(null);
      setAlmError(null);
      await fetchJsonWithToken("/api/actuariat/alm-proxy/stress-config", {
        method: "PUT",
        body: JSON.stringify({
          orsa_set_id: selected?.set?.id || almData?.selected_set?.id || null,
          alert_thresholds: almAlertThresholdsDraft,
          stress_configs: almStressDraft.map((r: any) => ({
            id: r.id,
            inflow_mult: r.inflow_mult,
            outflow_mult: r.outflow_mult,
            liquidity_source_mult_d1: r.liquidity_source_mult_d1,
            liquidity_source_mult_d7: r.liquidity_source_mult_d7,
            liquidity_source_mult_d30: r.liquidity_source_mult_d30,
            liquidity_use_mult_d1: r.liquidity_use_mult_d1,
            liquidity_use_mult_d7: r.liquidity_use_mult_d7,
            liquidity_use_mult_d30: r.liquidity_use_mult_d30,
            cash_floor_pct_assets: r.cash_floor_pct_assets,
            allow_negative_cash: r.allow_negative_cash,
            allow_negative_liquidity_buffer: r.allow_negative_liquidity_buffer,
            duration_asset_shift_years: r.duration_asset_shift_years,
            duration_liability_mult: r.duration_liability_mult,
            own_funds_mult: r.own_funds_mult,
            s2_mult: r.s2_mult,
            cat_mult: r.cat_mult,
          })),
          asset_shocks: almStressAssetDraft.map((r: any) => ({
            id: r.id,
            mv_mult: r.mv_mult,
            duration_shift_years: r.duration_shift_years,
            liquidity_source_mult_d1: r.liquidity_source_mult_d1,
            liquidity_source_mult_d7: r.liquidity_source_mult_d7,
            liquidity_source_mult_d30: r.liquidity_source_mult_d30,
            active: r.active,
          })),
        }),
      });
      setAlmMessage("Stress ALM V3 enregistrés.");
      await loadAlm();
    } catch (e: any) {
      setAlmError(e.message || "Erreur de sauvegarde des stress ALM V3");
    } finally {
      setAlmSaving(false);
    }
  };

  const copyAlmRerunSummary = async () => {
    if (!almV3RerunResult?.summary?.generated_stress_runs?.length) return;
    const lines = [
      `Rejouement stress ALM V3`,
      `Base run: ${almV3RerunResult.base_run_id ?? "—"}`,
      `Durée: ${fmtNum((n(almV3RerunResult.elapsed_ms) || 0) / 1000, 2)} s`,
      ...almV3RerunResult.summary.generated_stress_runs.map(
        (r: any) =>
          `${r.stress_code} | run ${r.run_id} | ${r.run_code || r.run_label || "—"} | status ${r.run_status || "—"} | snapshots ${r.snapshots} | min gap liq ${fmtEur(r.min_liquidity_gap)} | avg duration gap ${fmtNum(r.avg_duration_gap, 3)}`
      ),
    ];
    try {
      await copyTextToClipboard(lines.join("\n"));
      setAlmMessage("Résumé du rejouement copié dans le presse-papiers.");
    } catch {
      setAlmError("Impossible de copier le résumé.");
    }
  };

  const rerunAlmV3Stress = async () => {
    try {
      setAlmSaving(true);
      setAlmMessage(null);
      setAlmError(null);
      const res = await fetchJsonWithToken<any>("/api/actuariat/alm-proxy/rerun-v3-stress", {
        method: "POST",
        body: JSON.stringify({
          orsa_set_id: selected?.set?.id || almData?.selected_set?.id || null,
          base_run_id: (almData?.alm_v3_runs || []).find((r: any) => r.run_type === "daily_snapshot")?.id || null,
          alm_v3_run_id: almDrillRunId || null,
          alm_v3_date: almDrillDate || null,
          run_id: Number.isFinite(requestedGlobalRunId) && requestedGlobalRunId > 0 ? requestedGlobalRunId : null,
        }),
      });
      setAlmData(res);
      setAlmStressDraft((Array.isArray(res?.alm_v3_stress_configs) ? res.alm_v3_stress_configs : []).map((r: any) => ({ ...r })));
      setAlmStressAssetDraft((Array.isArray(res?.alm_v3_stress_asset_shocks) ? res.alm_v3_stress_asset_shocks : []).map((r: any) => ({ ...r })));
      setAlmAlertThresholdsDraft({ ...(res?.alm_v3_alert_thresholds || {}) });
      setAlmMessage("Stress ALM V3 rejoués.");
    } catch (e: any) {
      setAlmError(e.message || "Erreur de rejouement des stress ALM V3");
    } finally {
      setAlmSaving(false);
    }
  };

  return (
    <RequireAuth>
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 to-slate-700 p-5 text-white shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Pilotage et analyses</div>
              <h1 className="mt-1 text-2xl font-semibold">Simulation captive, ORSA, S2, Fronting, CAT</h1>
              <p className="mt-1 text-sm text-slate-200">
                Visualisation des paramétrages et résultats de tests quasi réels directement dans le site.
              </p>
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-200">
                <span>Aide sur les acronymes et indicateurs</span>
                <InfoHint text="ORSA = Own Risk and Solvency Assessment (évaluation interne des risques et de la solvabilité). S2 = Solvabilité II. SCR = Solvency Capital Requirement (capital de solvabilité requis). MCR = Minimum Capital Requirement (capital minimum réglementaire). GWP = Gross Written Premium (primes émises brutes). CAT = catastrophe. RBNS = Reserved But Not Settled (provisions sur sinistres connus non réglés). IBNR = Incurred But Not Reported (provisions pour sinistres survenus non encore déclarés)." />
              </div>
            </div>
            <div className="flex min-w-[280px] flex-col gap-1">
              <label className="text-xs text-slate-300">Set ORSA</label>
              <select
                className="rounded-md border border-slate-400/30 bg-white/95 px-3 py-2 text-sm text-slate-900"
                value={selected?.set?.id || ""}
                onChange={(e) => onSelectSet(e.target.value)}
              >
                {(data?.orsa_sets || []).map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.code} ({String(s.snapshot_date).slice(0, 10)})
                  </option>
                ))}
              </select>
              <label className="mt-2 text-xs text-slate-300">Run</label>
              <select
                className="rounded-md border border-slate-400/30 bg-white/95 px-3 py-2 text-sm text-slate-900"
                value={effectiveSelectedRunId || ""}
                onChange={(e) => onSelectRun(e.target.value)}
              >
                {comparison.map((r: any) => (
                  <option key={r.run_id} value={r.run_id}>
                    {r.stress_code} | Run {r.run_id}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {sectionOptions.map((s) => (
              <button
                key={s.key}
                onClick={() => onSelectSection(s.key)}
                className={`rounded-full px-3 py-1.5 text-sm transition ${
                  section === s.key ? "bg-white text-slate-900" : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {loading ? <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">Chargement…</div> : null}
        {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div> : null}

        {!loading && !error && !selected ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">
            Aucun set ORSA disponible pour cette captive.
          </div>
        ) : null}

        {!loading && !error && selected ? (
          <>
            {section === "overview" ? (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <Kpi
                    label="SCR BASE"
                    value={fmtEur(effectiveSelectedRun?.scr_total)}
                    sub={
                      selectedRun
                        ? `Run ${effectiveSelectedRun?.run_id} • Méthode ${effectiveSelectedRun?.methodology_version || "—"}`
                        : `Méthode ${base?.methodology_version || "—"}`
                    }
                    help={"Rôle du bloc : donner le niveau de capital requis (SCR) du scénario de référence BASE.\n\nLecture : c'est le point de départ de la lecture solvabilité; comparer ensuite à ADVERSE/SEVERE dans les tableaux de comparaison.\n\nLeviers : facteurs S2 (primes, réserves, CAT, contrepartie), réassurance/fronting et hypothèses ORSA."}
                  />
                  <Kpi
                    label="Solvabilité BASE"
                    value={fmtPct(effectiveSelectedRun?.solvency_ratio_pct)}
                    sub={`Own funds ${fmtEur(effectiveSelectedRun?.own_funds_eligible)}`}
                    help={"Rôle du bloc : résumer la marge de couverture des risques du scénario BASE.\n\nLecture : plus le ratio est élevé, plus la marge de sécurité est confortable. Lire ce ratio avec le montant d'Own funds pour éviter une lecture isolée.\n\nLeviers : fonds propres éligibles (own funds), niveau de SCR, réassurance/fronting et structure du portefeuille."}
                  />
                  <Kpi
                    label="Coût fronting BASE"
                    value={fmtEur(frontingSummaryByRun[Number(effectiveSelectedRun?.run_id)]?.fronting_total_cost || 0)}
                    sub="Frais fronting + gestion sinistres"
                    help={"Rôle du bloc : isoler le coût de portage du fronting dans la lecture économique du scénario BASE.\n\nLecture : à comparer au volume de primes et au SCR pour mesurer le poids du montage de fronting dans l'économie globale.\n\nLeviers : paramètres de fronting (fees, claims fee, rétrocession) et choix de co-fronting A/B."}
                  />
                </div>

                <SimpleTable
                  title="Comparaison des stress ORSA"
                  help={"Rôle du bloc : tableau de synthèse exécutive pour comparer rapidement les scénarios ORSA sur les principaux indicateurs métier et solvabilité.\n\nLecture : suivre la chaîne logique GWP -> sinistres -> SCR -> solvabilité, puis lire CAT Property S2 et coût de fronting pour expliquer les écarts.\n\nLeviers : hypothèses ORSA, réassurance/fronting, concentration CAT, composition du portefeuille."}
                  columns={[
                    { key: "stress", label: "Stress", headerHoverHelp: "Stress : scénario de test (BASE, ADVERSE, SEVERE).\n\nReprésente le niveau de dégradation simulé appliqué au portefeuille." },
                    { key: "run", label: "Run", align: "right", headerHoverHelp: "Run : identifiant d’exécution technique de la simulation.\n\nPermet de tracer précisément quel calcul a produit la ligne." },
                    { key: "gwp", label: "GWP", align: "right", headerHoverHelp: "GWP (Gross Written Premium) = primes brutes émises.\n\nReprésente le volume de primes avant réassurance/fronting et sert de base de lecture du portefeuille." },
                    { key: "claims", label: "Claims incurred", align: "right", headerHoverHelp: "Claims incurred = charge de sinistres (sinistres survenus/coût estimé).\n\nReprésente le coût total des sinistres pris en compte dans le scénario." },
                    { key: "scr", label: "SCR total", align: "right", headerHoverHelp: "SCR total (Solvency Capital Requirement) = capital de solvabilité requis.\n\nReprésente le capital nécessaire pour couvrir les risques selon le calcul S2 simplifié." },
                    { key: "solv", label: "Solvency", align: "right", headerHoverHelp: "Solvency = ratio de solvabilité (fonds propres éligibles / SCR).\n\nReprésente la marge de couverture des risques : plus il est élevé, plus la situation est confortable." },
                    { key: "cat", label: "CAT Property S2", align: "right", headerHoverHelp: "CAT Property S2 = exposition catastrophe Property utilisée dans le calcul Solvabilité II simplifié.\n\nReprésente la composante CAT du risque Property." },
                    { key: "fronting", label: "Coût fronting", align: "right", headerHoverHelp: "Coût fronting = frais de portage (fronting) + frais de gestion sinistres refacturés.\n\nReprésente le coût du montage de fronting pour la captive." },
                    {
                      key: "goto_s2",
                      label: "Lien",
                      cellRenderer: (row) => (
                        <button
                          type="button"
                          onClick={() => onSelectSection("s2")}
                          className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                        >
                          Voir S2
                        </button>
                      ),
                    },
                  ]}
                  rows={overviewRows}
                  rowClassName={(r) =>
                    Number(r.__run_id) === Number(effectiveSelectedRun?.run_id)
                      ? "bg-blue-50/70"
                      : Number(r.__run_id) === Number(base?.run_id)
                      ? "bg-slate-100/70"
                      : ""
                  }
                />

                <div className="space-y-4">
                  <SimpleTable
                    title="Sets ORSA disponibles"
                    help={"Rôle du bloc : inventaire des jeux ORSA disponibles pour choisir la bonne base d'analyse.\n\nLecture : vérifier le scénario de référence, la date de snapshot et le statut avant de comparer des résultats.\n\nLeviers : création / recalcul de sets ORSA et sélection du set en haut de page."}
                    columns={[
                      { key: "code", label: "Set ORSA", headerHoverHelp: "Set ORSA = jeu de scénarios ORSA regroupés pour une même analyse.\n\nReprésente le package de comparaison (BASE/ADVERSE/SEVERE)." },
                      { key: "scenario", label: "Scénario", headerHoverHelp: "Scénario = scénario de simulation de référence auquel le set ORSA est rattaché.\n\nReprésente le contexte métier/portefeuille utilisé." },
                      { key: "snapshot", label: "Snapshot", headerHoverHelp: "Snapshot = date de photographie des résultats.\n\nReprésente la date de référence des agrégats affichés dans le set ORSA." },
                      { key: "status", label: "Statut", headerHoverHelp: "Statut = état du set ORSA (actif, généré, etc.).\n\nReprésente la disponibilité opérationnelle du jeu de tests." },
                    ]}
                    rows={(data?.orsa_sets || []).map((s: any) => ({
                      code: s.code,
                      scenario: s.scenario_code,
                      snapshot: String(s.snapshot_date).slice(0, 10),
                      status: s.status,
                      __isCurrentOrsaSet: Number(s.id) === Number(selected?.set?.id),
                    }))}
                    rowClassName={(r) => (r.__isCurrentOrsaSet ? "bg-slate-100/80" : "")}
                  />
                  <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:content-none">
                      <div className="text-sm font-medium text-slate-900">Runs récents de simulation</div>
                      <span className="text-xs font-medium text-slate-500">Afficher / Masquer</span>
                    </summary>
                    <div className="border-t border-slate-200 p-0">
                      <SimpleTable
                          help={"Rôle du bloc : journal technique récent pour comprendre ce qui a été recalculé et avec quelle version de moteur.\n\nLecture : utile pour diagnostiquer une différence de résultat (run récent, statut, engine version).\n\nLeviers : relancer les scripts de simulation/recalcul et contrôler la version de logique (engine)." }
                          columns={[
                            { key: "run_id", label: "Run", align: "right", headerHoverHelp: "Run = identifiant d’exécution technique.\n\nReprésente une instance de calcul (simulation, ORSA, stress, recalcul)." },
                            { key: "label", label: "Label", headerHoverHelp: "Label = libellé métier/technique du run.\n\nReprésente le type de traitement lancé et souvent son périmètre." },
                            { key: "status", label: "Statut", headerHoverHelp: "Statut = état d’exécution du run (running, completed, failed, etc.).\n\nReprésente l’issue du traitement." },
                            {
                              key: "engine",
                              label: "Engine",
                              headerHoverHelp: "Engine = version de la logique de calcul utilisée.\n\nReprésente la version du moteur qui a produit le résultat (traçabilité des écarts).",
                              cellRenderer: (row) => <span>{row.engine || "—"}</span>,
                            },
                            {
                              key: "engine_action",
                              label: "Détail moteur",
                              headerHoverHelp: "Détail moteur = ouvre une fiche structurée du moteur de calcul utilisé par le run.\n\nReprésente la traçabilité méthodologique (version, modules, limites, configuration).",
                              cellRenderer: (row) => {
                                const detail = recentRunEngineByRunId[Number(row.run_id)];
                                if (!detail) return <span className="text-slate-400">—</span>;
                                return (
                                  <div className="inline-flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => openEngineDetailForRun(row.run_id)}
                                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-slate-50"
                                    >
                                      Voir moteur
                                    </button>
                                    {engineHasPlaceholderWarning(detail) ? (
                                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                                        placeholder
                                      </span>
                                    ) : null}
                                  </div>
                                );
                              },
                            },
                          ]}
                          rows={(data?.recent_runs || []).slice(0, 8).map((r: any) => ({
                            run_id: r.id,
                            label: r.run_label,
                            status: r.status,
                            engine: r.engine_version || "—",
                            __isUsedInOverviewComparison: overviewComparisonRunIds.has(Number(r.id)),
                          }))}
                          rowClassName={(r) => (r.__isUsedInOverviewComparison ? "bg-slate-100/80" : "")}
                        />
                    </div>
                  </details>

                  <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:content-none">
                      <div className="text-sm font-medium text-slate-900">Référentiel des moteurs de calcul (catalogue)</div>
                      <span className="text-xs font-medium text-slate-500">Afficher / Masquer</span>
                    </summary>
                    <div className="border-t border-slate-200 p-4">
                      <SimpleTable
                        title="Catalogue moteurs"
                        help={"Rôle du bloc : documenter les moteurs de calcul disponibles et leurs versions (référentiel de méthode).\n\nLecture : utile pour comprendre ce que signifie une valeur Engine dans les runs récents et pour tracer les limites d'une version.\n\nLeviers : éditer titre, description, scope, limites et modules du moteur pour améliorer la traçabilité."}
                        columns={[
                          { key: "family", label: "Famille", nowrap: true },
                          { key: "code", label: "Code", nowrap: true },
                          { key: "version", label: "Version", nowrap: true },
                          { key: "title", label: "Titre" },
                          { key: "script_name", label: "Script", nowrap: true },
                          { key: "repo_path", label: "Repo path", nowrap: true },
                          { key: "status", label: "Statut", nowrap: true },
                          {
                            key: "action",
                            label: "Action",
                            nowrap: true,
                            cellRenderer: (row) => (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingEngineCatalog(row.__raw);
                                  setEngineCatalogDraft({
                                    ...row.__raw,
                                    modules_text: Array.isArray(row.__raw?.modules_json) ? row.__raw.modules_json.join(", ") : "",
                                  });
                                }}
                                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-slate-50"
                              >
                                Éditer
                              </button>
                            ),
                          },
                        ]}
                        rows={(Array.isArray(data?.engine_catalog) ? data.engine_catalog : []).map((e: any) => ({
                          family: e.engine_family,
                          code: e.engine_code,
                          version: e.engine_version,
                          title: e.title,
                          script_name: e.script_name || "—",
                          repo_path: e.repo_path || "—",
                          status: e.status,
                          __raw: e,
                        }))}
                      />
                    </div>
                  </details>
                </div>

                {selectedRecentRunEngine ? <EngineDetailRunModal detail={selectedRecentRunEngine} onClose={() => setSelectedRecentRunEngine(null)} /> : null}

                {editingEngineCatalog && engineCatalogDraft ? (
                  <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-slate-900/40 p-4" onClick={() => { setEditingEngineCatalog(null); setEngineCatalogDraft(null); }}>
                    <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold text-slate-900">Éditer le référentiel moteur</div>
                          <div className="text-sm text-slate-600">{editingEngineCatalog.engine_code} · {editingEngineCatalog.engine_version}</div>
                        </div>
                        <button type="button" onClick={() => { setEditingEngineCatalog(null); setEngineCatalogDraft(null); }} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800">
                          Fermer
                        </button>
                      </div>
                      <div className="grid gap-3">
                        <label className="grid gap-1 text-sm">
                          <span className="font-medium text-slate-800">Titre</span>
                          <input className="rounded-md border border-slate-300 px-3 py-2" value={engineCatalogDraft.title || ""} onChange={(e) => setEngineCatalogDraft((d: any) => ({ ...d, title: e.target.value }))} />
                        </label>
                        <label className="grid gap-1 text-sm">
                          <span className="font-medium text-slate-800">Statut</span>
                          <select className="rounded-md border border-slate-300 px-3 py-2" value={engineCatalogDraft.status || "active"} onChange={(e) => setEngineCatalogDraft((d: any) => ({ ...d, status: e.target.value }))}>
                            <option value="active">active</option>
                            <option value="deprecated">deprecated</option>
                          </select>
                        </label>
                        <label className="grid gap-1 text-sm">
                          <span className="font-medium text-slate-800">Description</span>
                          <textarea className="min-h-20 rounded-md border border-slate-300 px-3 py-2" value={engineCatalogDraft.description || ""} onChange={(e) => setEngineCatalogDraft((d: any) => ({ ...d, description: e.target.value }))} />
                        </label>
                        <label className="grid gap-1 text-sm">
                          <span className="font-medium text-slate-800">Portée méthodologique (scope)</span>
                          <textarea className="min-h-20 rounded-md border border-slate-300 px-3 py-2" value={engineCatalogDraft.methodology_scope || ""} onChange={(e) => setEngineCatalogDraft((d: any) => ({ ...d, methodology_scope: e.target.value }))} />
                        </label>
                        <label className="grid gap-1 text-sm">
                          <span className="font-medium text-slate-800">Limites / hypothèses</span>
                          <textarea className="min-h-20 rounded-md border border-slate-300 px-3 py-2" value={engineCatalogDraft.limitations || ""} onChange={(e) => setEngineCatalogDraft((d: any) => ({ ...d, limitations: e.target.value }))} />
                        </label>
                        <label className="grid gap-1 text-sm">
                          <span className="flex items-center justify-between gap-2">
                            <span className="font-medium text-slate-800">Script source</span>
                            <button
                              type="button"
                              onClick={openEngineCatalogScriptEditor}
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-slate-50"
                            >
                              Éditer
                            </button>
                          </span>
                          <input className="rounded-md border border-slate-300 px-3 py-2" value={engineCatalogDraft.script_name || ""} onChange={(e) => setEngineCatalogDraft((d: any) => ({ ...d, script_name: e.target.value }))} />
                        </label>
                        <label className="grid gap-1 text-sm">
                          <span className="font-medium text-slate-800">Repo path</span>
                          <input className="rounded-md border border-slate-300 px-3 py-2" value={engineCatalogDraft.repo_path || ""} onChange={(e) => setEngineCatalogDraft((d: any) => ({ ...d, repo_path: e.target.value }))} />
                        </label>
                        <label className="grid gap-1 text-sm">
                          <span className="font-medium text-slate-800">Modules (séparés par virgule)</span>
                          <input className="rounded-md border border-slate-300 px-3 py-2" value={engineCatalogDraft.modules_text || ""} onChange={(e) => setEngineCatalogDraft((d: any) => ({ ...d, modules_text: e.target.value }))} />
                        </label>
                      </div>
                      <div className="mt-4 flex justify-end gap-2">
                        <button type="button" onClick={() => { setEditingEngineCatalog(null); setEngineCatalogDraft(null); }} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800">
                          Annuler
                        </button>
                        <button type="button" onClick={saveEngineCatalogDraft} disabled={engineCatalogSaving} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                          {engineCatalogSaving ? "Enregistrement..." : "Enregistrer"}
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {engineScriptEditor ? (
                  <div
                    className="fixed inset-0 z-[1300] flex items-center justify-center bg-slate-900/45 p-4"
                    onClick={() => setEngineScriptEditor(null)}
                  >
                    <div
                      className="max-h-[90vh] w-full max-w-5xl overflow-auto rounded-xl border border-slate-200 bg-white p-4 shadow-2xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-base font-semibold text-slate-900">Éditer le script source moteur</div>
                          <div className="font-mono text-xs text-slate-600">{engineScriptEditor.scriptName}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEngineScriptEditor(null)}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800"
                        >
                          Fermer
                        </button>
                      </div>
                      {engineScriptEditor.loading ? <div className="text-sm text-slate-600">Chargement du script...</div> : null}
                      {engineScriptEditor.error ? <div className="mb-2 text-sm text-red-700">{engineScriptEditor.error}</div> : null}
                      {engineScriptEditor.message ? <div className="mb-2 text-sm text-emerald-700">{engineScriptEditor.message}</div> : null}
                      {!engineScriptEditor.loading ? (
                        <>
                          <textarea
                            className="min-h-[26rem] w-full rounded-md border border-slate-300 bg-slate-50 p-3 font-mono text-[12px] text-slate-800"
                            value={engineScriptEditor.content}
                            onChange={(e) =>
                              setEngineScriptEditor((s) => (s ? { ...s, content: e.target.value, message: null } : s))
                            }
                            spellCheck={false}
                          />
                          <div className="mt-3 flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEngineScriptEditor(null)}
                              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                            >
                              Annuler
                            </button>
                            <button
                              type="button"
                              onClick={saveEngineCatalogScriptEditor}
                              disabled={engineScriptEditor.saving}
                              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                            >
                              {engineScriptEditor.saving ? "Enregistrement..." : "Enregistrer le script"}
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {section === "orsa" ? (
              <div className="space-y-4">
                <SimpleTable
                  title="Hypothèses ORSA (résumé)"
                  help={"Rôle du bloc : résumer, par run ORSA, les multiplicateurs de stress qui expliquent les résultats observés.\n\nLecture : lire les multiplicateurs comme des leviers de simulation (x1,20 = +20 %, x0,90 = -10 %). Comparer ADVERSE et SEVERE pour vérifier la cohérence de gradation.\n\nLeviers : paramètres ORSA stockés (simulation_parameters) et profils de stress par branche."}
                  columns={[
                    { key: "stress", label: "Stress" },
                    { key: "run", label: "Run", align: "right" },
                    {
                      key: "engine",
                      label: "Engine",
                      cellRenderer: (row) => {
                        const detail = selectedRunEngineByRunId[Number(row.run)];
                        if (!detail) return <span className="text-slate-400">—</span>;
                        return (
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => openEngineDetailForRun(row.run)}
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800 hover:bg-slate-50"
                            >
                              Voir moteur
                            </button>
                            {engineHasPlaceholderWarning(detail) ? (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                                placeholder
                              </span>
                            ) : null}
                          </div>
                        );
                      },
                    },
                    { key: "assumptions", label: "Hypothèses (résumé)" },
                  ]}
                  rows={members.map((m: any) => ({
                    stress: m.stress_code,
                    run: m.run_id,
                    engine: m.engine_version || "—",
                    assumptions: (() => {
                      const s = summarizeStressProfile(m.assumption_json);
                      if (!s) return "—";
                      const parts = [
                        s.gwp_mult != null ? `GWP x${fmtNum(s.gwp_mult, 3)}` : null,
                        s.incurred_mult != null ? `Claims x${fmtNum(s.incurred_mult, 3)}` : null,
                        s.cat_mult != null ? `CAT x${fmtNum(s.cat_mult, 3)}` : null,
                        s.s2_nonlife_mult != null ? `S2 non-life x${fmtNum(s.s2_nonlife_mult, 3)}` : null,
                        s.own_funds_mult != null ? `Own funds x${fmtNum(s.own_funds_mult, 3)}` : null,
                        s.branch_keys?.length ? `${s.branch_keys.length} branches stressées` : null,
                      ].filter(Boolean);
                      return parts.join(" | ") || "—";
                    })(),
                  }))}
                />

                <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:content-none">
                    <div className="rounded-md bg-slate-200 px-2 py-1 text-sm font-bold text-slate-900">Paramétrages des stress ORSA (ADVERSE / SEVERE)</div>
                    <span className="text-xs font-medium text-slate-500">Afficher / Masquer</span>
                  </summary>
                  <div className="border-t border-slate-200 p-4">
                    <div className="mb-2">
                      <div className="flex items-center gap-2">
                      <div className="rounded-md bg-slate-200 px-2 py-1 text-sm font-bold text-slate-900">Paramétrages des stress ORSA (ADVERSE / SEVERE)</div>
                      <InfoHint text={"Rôle du bloc : afficher et documenter les paramètres de stress ORSA enregistrés (source de vérité des scénarios).\n\nLecture : vérifier que la hiérarchie des stress est logique (SEVERE plus dur qu'ADVERSE) et que les branches capital-intensives sont bien traitées.\n\nLeviers : modifier les paramètres ORSA (simulation_parameters), puis regénérer les runs ORSA et recalculs dérivés (S2 / ALM)."} />
                      <InfoHint
                        icon="?"
                        heading="Mode d'emploi - Paramétrages ORSA"
                        text={
                          "Point clé avant lecture : ce bloc affiche des paramètres d'entrée (hypothèses de stress), pas les résultats calculés. Les résultats ORSA (BASE / ADVERSE / SEVERE) sont présentés plus bas et reflètent l'effet final après calculs S2, réassurance/fronting et interactions de branches.\n\nRôle de ce mode d'emploi : vous aider à savoir quel paramètre modifier selon l'effet recherché sur les scénarios ORSA.\n\nOù modifier les paramètres : dans cette page (bloc Paramétrages des stress ORSA), les valeurs affichées sont la référence. Les modifications sont enregistrées via l'API ALM/actuariat puis stockées dans la table simulation_parameters (clés orsa_stress_adverse / orsa_stress_severe). Si besoin d'intervention technique, les scripts de génération ORSA relisent ces paramètres avant recalcul.\n\nComment l'utiliser : commencez par comparer BASE / ADVERSE / SEVERE dans les tableaux ORSA et Overview, puis modifiez un seul levier à la fois avant de regénérer les runs.\n\nSi vous voulez dégrader/améliorer le volume de primes : ajustez GWP (gwp_mult).\n\nSi vous voulez durcir/assouplir la sinistralité globale : ajustez Claims incurred (incurred_mult).\n\nSi vous voulez tester un choc catastrophe Property : ajustez CAT Property (cat_mult), puis contrôlez l'onglet CAT et l'impact SCR / solvabilité.\n\nSi vous voulez simuler une variation de capital disponible : ajustez Own funds (own_funds_mult). Cela agit directement sur le ratio de solvabilité.\n\nSi vous voulez cibler une branche (Motor, PI, Medical, Property) : utilisez les stress spécifiques par branche. C'est le bon levier pour tester une concentration de risque plutôt qu'un choc global.\n\nMéthode recommandée : 1) modifier un paramètre, 2) relancer les runs ORSA, 3) relire ORSA -> S2 -> ALM, 4) documenter l'effet observé.\n\nPoint de vigilance : gardez une hiérarchie cohérente entre ADVERSE et SEVERE (SEVERE doit rester plus contraignant que ADVERSE sur les leviers principaux)."
                        }
                      />
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Le scénario BASE correspond au portefeuille de référence et n’est pas paramétré ici.
                    </div>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                    {stressParamCards.map((p: any) => {
                      const s = p.summary;
                      return (
                        <div key={`${p.scenario_id}-${p.parameter_key}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                              <span>{stressCodeLabel(p.parameter_key)}</span>
                              <InfoHint text={"Rôle du bloc : expliquer ce que pilote ce profil de stress ORSA (Adverse ou Severe).\n\nLecture : ce profil impacte primes, sinistres, CAT, contrepartie et fonds propres; il faut le relier aux résultats ORSA observés plus haut.\n\nLeviers : ajuster ce profil de stress, puis relancer les runs ORSA pour mesurer l'effet."} />
                            </div>
                            <div className="text-[11px] text-slate-500">{p.parameter_key}</div>
                          </div>
                          {s ? (
                            <>
                              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                <div className="rounded-md bg-white p-2 text-xs text-slate-700">GWP: x{fmtNum(s.gwp_mult, 3)}</div>
                                <div className="rounded-md bg-white p-2 text-xs text-slate-700">Claims incurred: x{fmtNum(s.incurred_mult, 3)}</div>
                                <div className="rounded-md bg-white p-2 text-xs text-slate-700">CAT Property: x{fmtNum(s.cat_mult, 3)}</div>
                                <div className="rounded-md bg-white p-2 text-xs text-slate-700">Own funds: x{fmtNum(s.own_funds_mult, 3)}</div>
                              </div>
                              <div className="mt-3">
                                <div className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Stress spécifiques par branche</div>
                                <BranchStressSummary branches={s.branches} />
                              </div>
                              <details className="mt-3 rounded-md border border-slate-200 bg-white p-2">
                                <summary className="cursor-pointer text-xs font-medium text-slate-700">Afficher le JSON brut</summary>
                                <pre className="mt-2 overflow-auto whitespace-pre-wrap text-[11px] text-slate-700">
                                  {JSON.stringify(p.value_json, null, 2)}
                                </pre>
                              </details>
                            </>
                          ) : (
                            <div className="mt-2 text-xs text-slate-500">Format de paramètre non reconnu.</div>
                          )}
                        </div>
                      );
                    })}
                    </div>
                  </div>
                </details>

                <SimpleTable
                  title="Résultats ORSA par stress"
                  help={"Rôle du bloc : comparer les résultats ORSA des scénarios BASE / ADVERSE / SEVERE sur les indicateurs clés de pilotage.\n\nLecture : lire d'abord SCR total et Solvency, puis les écarts Δ vs BASE pour mesurer l'ampleur du stress. Une baisse forte du ratio de solvabilité signale une vulnérabilité.\n\nLeviers : hypothèses ORSA (sinistralité, CAT, contrepartie, own funds), réassurance/fronting, composition du portefeuille."}
                  columns={[
                    { key: "stress", label: "Stress" },
                    { key: "run", label: "Run", align: "right" },
                    { key: "gwp", label: "GWP", align: "right" },
                    { key: "claims", label: "Claims incurred", align: "right" },
                    { key: "scr", label: "SCR total", align: "right" },
                    { key: "solv", label: "Solvency", align: "right" },
                    { key: "delta_scr", label: "Δ SCR vs BASE", align: "right" },
                    { key: "delta_solv", label: "Δ Solvency vs BASE", align: "right" },
                  ]}
                  rows={comparison.map((r: any) => {
                    const d = (selected.summary?.deltas_vs_base || []).find((x: any) => Number(x.run_id) === Number(r.run_id));
                    return {
                      stress: r.stress_code,
                      run: r.run_id,
                      gwp: fmtEur(r.gwp_total),
                      claims: fmtEur(r.claims_incurred_total),
                      scr: fmtEur(r.scr_total),
                      solv: fmtPct(r.solvency_ratio_pct),
                      delta_scr: d ? fmtEur(d.delta_scr_total) : "—",
                      delta_solv: d ? fmtPct(d.delta_solvency_ratio_pct) : "—",
                    };
                  })}
                />

                <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:content-none">
                    <div className="rounded-md bg-slate-200 px-2 py-1 text-sm font-bold text-slate-900">Résultats ORSA calculés (BASE / ADVERSE / SEVERE)</div>
                    <span className="text-xs font-medium text-slate-500">Afficher / Masquer</span>
                  </summary>
                  <div className="border-t border-slate-200 p-4">
                    <div className="mb-3 flex items-center gap-2">
                    <div className="rounded-md bg-slate-200 px-2 py-1 text-sm font-bold text-slate-900">Résultats ORSA calculés (BASE / ADVERSE / SEVERE)</div>
                    <InfoHint
                      text={
                        "Rôle du bloc : mettre en perspective, scénario par scénario, les résultats ORSA calculés avec le contexte d'hypothèses qui les a produits.\n\nLecture : lire chaque carte comme une fiche de scénario (BASE / ADVERSE / SEVERE) puis comparer les différences avec le tableau de résultats au-dessus. Les multiplicateurs et stress par branche aident à expliquer les écarts observés sur SCR et solvabilité.\n\nPourquoi ces cartes diffèrent du bloc Paramétrages des stress plus bas : ici on affiche les hypothèses embarquées dans les runs du set ORSA sélectionné (tracées avec leurs runs), alors que le bloc de paramétrage plus bas affiche la configuration de référence modifiable.\n\nLeviers : modifier les paramètres de stress ORSA plus bas, relancer les runs ORSA, puis revenir ici pour vérifier que les cartes reflètent bien la nouvelle configuration."
                      }
                    />
                  </div>
                  <div className="mb-4 text-xs text-slate-500">
                    Cette zone regroupe les cartes par scénario du set ORSA sélectionné (avec leur run). Elle complète le tableau de synthèse
                    {" "}
                    <span className="font-medium text-slate-700">Résultats ORSA par stress</span>
                    {" "}
                    et aide à relier résultats observés et hypothèses embarquées.
                  </div>

                    <div className="grid gap-4 lg:grid-cols-2">
                    {members
                      .filter((m: any) => !!m.assumption_json)
                      .map((m: any) => {
                        const s = summarizeStressProfile(m.assumption_json);
                        return (
                          <div key={`assump-${m.run_id}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                                <span>{m.stress_code} (run {m.run_id})</span>
                                <InfoHint text={"Rôle du bloc : détailler les hypothèses de stress du run ORSA sélectionné (globales et par branche).\n\nLecture : vérifier la cohérence entre les multiplicateurs globaux et les stress spécifiques par branche; cela explique les écarts de SCR et de solvabilité.\n\nLeviers : paramétrages ORSA (globaux et par branche) puis relance des runs ORSA."} />
                              </div>
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{m.engine_version || "—"}</span>
                            </div>
                            {s ? (
                              <>
                                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                  <div className="rounded-md bg-slate-50 p-2 text-xs text-slate-700">GWP: x{fmtNum(s.gwp_mult, 3)}</div>
                                  <div className="rounded-md bg-slate-50 p-2 text-xs text-slate-700">Claims incurred: x{fmtNum(s.incurred_mult, 3)}</div>
                                  <div className="rounded-md bg-slate-50 p-2 text-xs text-slate-700">CAT Property: x{fmtNum(s.cat_mult, 3)}</div>
                                  <div className="rounded-md bg-slate-50 p-2 text-xs text-slate-700">Own funds: x{fmtNum(s.own_funds_mult, 3)}</div>
                                </div>
                                <div className="mt-3">
                                  <div className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Impacts par branche</div>
                                  <BranchStressSummary branches={s.branches} />
                                </div>
                                <details className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2">
                                  <summary className="cursor-pointer text-xs font-medium text-slate-700">Voir JSON brut</summary>
                                  <pre className="mt-2 overflow-auto whitespace-pre-wrap text-[11px] text-slate-700">
                                    {JSON.stringify(m.assumption_json, null, 2)}
                                  </pre>
                                </details>
                              </>
                            ) : (
                              <div className="mt-2 text-xs text-slate-500">Aucune hypothèse structurée disponible.</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </details>
              </div>
            ) : null}

            {section === "s2" ? (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  {(selected.s2_results || []).map((r: any) => (
                    <Kpi
                      key={r.run_id}
                      label={`Run ${r.run_id}`}
                      value={fmtEur(r.scr_total)}
                      className={
                        Number(effectiveSelectedRunId) === Number(r.run_id)
                          ? "!bg-slate-200 border-sky-300 ring-1 ring-sky-200"
                          : ""
                      }
                      onClick={() => void selectS2WorkingRun(r)}
                      sub={
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {Number(effectiveSelectedRunId) === Number(r.run_id) ? <StatusChip label="Run choisi" tone="slate" /> : null}
                          <span>{`Solvency ${fmtPct(r.solvency_ratio_pct)} | ${r.methodology_version || "—"}`}</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectSection("overview", { run_id: r.run_id });
                            }}
                            className="rounded-md border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Voir dans Overview
                          </button>
                        </span>
                      }
                      help={"Rôle du bloc : afficher, pour chaque run, le résultat Solvabilité II synthétique (SCR total + ratio de solvabilité).\n\nLecture : SCR plus élevé = besoin de capital plus important. Le ratio de solvabilité baisse si le SCR augmente plus vite que les fonds propres éligibles.\n\nLeviers : structure du portefeuille, sinistralité/réserves, CAT, contrepartie (réassurance/fronting), réassurance et paramètres de stress ORSA."}
                    />
                  ))}
                </div>

                <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:content-none">
                    <div className="rounded-md bg-slate-200 px-2 py-1 text-sm font-bold text-slate-900">Inputs S2 par branche (run de base)</div>
                    <span className="text-xs font-medium text-slate-500">Afficher / Masquer</span>
                  </summary>
                  <div className="border-t border-slate-200 p-4">
                    <SimpleTable
                      title="Inputs S2 par branche (run de base)"
                      help={"Rôle du bloc : expliquer d'où vient le SCR en montrant les volumes de risque S2 par branche sur le run de base.\n\nLecture : Premium/Reserve/CAT/Counterparty indiquent quelles branches consomment le capital. Les sigmas (σ) donnent une idée de la sensibilité du module premium/réserve.\n\nLeviers : mix de portefeuille, politique de réassurance/fronting, qualité des réserves, concentration CAT et contreparties."}
                      columns={[
                        { key: "s2_code", label: "S2" },
                        { key: "branch", label: "Branche" },
                        { key: "premium", label: "Premium vol.", align: "right" },
                        { key: "reserve", label: "Reserve vol.", align: "right" },
                        { key: "cat", label: "CAT exposure", align: "right" },
                        { key: "cpty", label: "Counterparty", align: "right" },
                        { key: "sigma_p", label: "σ premium", align: "right" },
                        { key: "sigma_r", label: "σ reserve", align: "right" },
                      ]}
                      rows={s2InputRows}
                    />
                  </div>
                </details>

                <details
                  className="rounded-xl border border-slate-200 bg-white shadow-sm"
                  open={s2RealOpen}
                  onToggle={(e) => setS2RealOpen((e.currentTarget as HTMLDetailsElement).open)}
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:content-none">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                      <span>Analyse S2 sur données réelles (date d&apos;arrêté)</span>
                      <InfoHint text={"Calcule un snapshot S2 'réel' à une date donnée (as-of) à partir des encaissements primes, sinistres/règlements/réserves connus à date. Le run S2 sélectionné sert de référence de méthodologie (profil placeholder et traçabilité)."} />
                    </div>
                    <span className="text-xs font-medium text-slate-500">Afficher / Masquer</span>
                  </summary>
                  <div className="border-t border-slate-200 p-4">
                    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                        Run de référence {s2WorkingRun ? `#${s2WorkingRun.run_id}` : "—"}
                      </span>
                      {s2WorkingRun?.methodology_version ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{s2WorkingRun.methodology_version}</span>
                      ) : null}
                      <span>Scénario {selected?.set?.scenario_code || "—"}</span>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <label className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-slate-600">
                          <span>Date d&apos;analyse</span>
                          <InfoHint text={"Date d'arrêté (as-of) du calcul S2 réel. Les données transactionnelles sont prises jusqu'à cette date."} />
                        </div>
                        <TextInput type="date" value={s2RealDate} onChange={setS2RealDate} />
                      </label>

                      <label className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-slate-600">
                          <span>Mode fonds propres</span>
                          <InfoHint text={"Auto = manuel si saisi sinon proxy. Proxy = valeur issue du paramétrage moteur S2. Manuel = valeur saisie ci-dessous."} />
                        </div>
                        <select
                          value={s2RealOwnFundsMode}
                          onChange={(e) => setS2RealOwnFundsMode(e.target.value as any)}
                          className="h-[34px] w-full rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-900"
                        >
                          <option value="auto">Auto (manuel &gt; proxy)</option>
                          <option value="proxy">Proxy</option>
                          <option value="manual">Manuel</option>
                        </select>
                      </label>

                      <NumberField
                        label="Own funds manuel (€)"
                        value={s2RealOwnFundsManual}
                        onChange={setS2RealOwnFundsManual}
                        help="Utilisé si Mode fonds propres = Manuel (ou Auto si une valeur est saisie)."
                      />

                      <label className="flex items-end">
                        <span className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                          <input
                            type="checkbox"
                            checked={s2RealOverwrite}
                            onChange={(e) => setS2RealOverwrite(e.target.checked)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          Écraser snapshot réel existant
                        </span>
                      </label>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={calculateS2RealPreview}
                        disabled={s2RealLoading || s2RealSaving || !selected?.set?.scenario_id || !s2RealDate}
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {s2RealLoading ? "Calcul…" : "Calculer (prévisualisation)"}
                      </button>
                      <button
                        type="button"
                        onClick={saveS2RealSnapshotUi}
                        disabled={s2RealLoading || s2RealSaving || !selected?.set?.scenario_id || !s2RealDate}
                        className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                      >
                        {s2RealSaving ? "Enregistrement…" : "Calculer + enregistrer snapshot réel"}
                      </button>
                      <span className="text-xs text-slate-500">
                        Seed mensuel : recalculé à la date de départ (pas de saisie manuelle du seed).
                      </span>
                    </div>

                    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-slate-600">Remplissage mensuel (fins de mois)</div>
                      <div className="flex flex-wrap items-end gap-3">
                        <label className="space-y-1">
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                            <span>Année batch</span>
                            <InfoHint text={"Génère un snapshot S2 réel pour chaque fin de mois de l'année choisie (31/01, 28/02, ...)."} />
                          </div>
                          <TextInput type="text" value={s2RealBatchYear} onChange={setS2RealBatchYear} className="w-28" />
                        </label>
                        <button
                          type="button"
                          onClick={generateS2RealMonthlyBatch}
                          disabled={
                            s2RealLoading ||
                            s2RealSaving ||
                            s2RealBatchRunning ||
                            !selected?.set?.scenario_id ||
                            !/^\d{4}$/.test(String(s2RealBatchYear || ""))
                          }
                          className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
                        >
                          {s2RealBatchRunning ? "Génération mensuelle…" : "Générer fins de mois (année)"}
                        </button>
                        <span className="text-xs text-slate-500">
                          Utilise le run de référence courant ({s2WorkingRun ? `#${s2WorkingRun.run_id}` : "—"}) et les paramètres de fonds propres ci-dessus.
                        </span>
                      </div>
                    </div>

                    {s2RealError ? <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{s2RealError}</div> : null}
                    {s2RealMessage ? <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{s2RealMessage}</div> : null}

                    {s2RealBatchResult ? (
                      <div className="mt-4">
                        <SimpleTable
                          title={`Résultat batch mensuel ${s2RealBatchResult.year}`}
                          columns={[
                            { key: "date", label: "Date" },
                            { key: "status", label: "Statut" },
                            { key: "scr", label: "SCR", align: "right" },
                            { key: "solv", label: "Solvency", align: "right" },
                          ]}
                          rows={[...(s2RealBatchResult.results || [])]
                            .sort((a: any, b: any) => String(b?.snapshot_date || "").localeCompare(String(a?.snapshot_date || "")))
                            .map((r) => ({
                            date: fmtDateIsoToFr(r.snapshot_date),
                            status: r.ok ? (r.overwritten ? "OK (écrasé)" : "OK") : r.error || "Erreur",
                            scr: r.ok ? fmtEur(r.scr_total) : "—",
                            solv: r.ok ? fmtPct(r.solvency_ratio_pct) : "—",
                          }))}
                        />
                      </div>
                    ) : null}

                    {s2RealPreview?.snapshot ? (
                      <div className="mt-4 space-y-4">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <Kpi label="SCR réel (as-of)" value={fmtEur(s2RealPreview.snapshot.scr_total)} />
                          <Kpi label="MCR" value={fmtEur(s2RealPreview.snapshot.mcr)} />
                          <Kpi label="Own funds" value={fmtEur(s2RealPreview.snapshot.own_funds_eligible)} sub={`Source ${s2RealPreview.snapshot.own_funds_source_used || "—"}`} />
                          <Kpi
                            label="Ratio solvabilité"
                            value={fmtPct(s2RealPreview.snapshot.solvency_ratio_pct)}
                            sub={
                              <span className="inline-flex items-center gap-2">
                                <StatusChip
                                  label={
                                    n(s2RealPreview.snapshot.solvency_ratio_pct) < 100
                                      ? "Critique"
                                      : n(s2RealPreview.snapshot.solvency_ratio_pct) < 120
                                      ? "Vigilance"
                                      : "OK"
                                  }
                                  tone={
                                    n(s2RealPreview.snapshot.solvency_ratio_pct) < 100
                                      ? "red"
                                      : n(s2RealPreview.snapshot.solvency_ratio_pct) < 120
                                      ? "orange"
                                      : "green"
                                  }
                                />
                                <span>{s2RealPreview.snapshot.methodology_version || "—"}</span>
                              </span>
                            }
                          />
                        </div>

                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                          <div className="font-medium text-slate-700">Traçabilité calcul (MVP)</div>
                          <div className="mt-1">
                            Périmètre : primes encaissées YTD, réserves = estimé - réglé à date, mapping branche via programme, contrepartie/réassurance/fronting via run de référence si disponible.
                          </div>
                          <div className="mt-1">
                            Profil placeholder retenu : <span className="font-medium text-slate-800">{String(s2RealPreview?.calc_scope?.selected_placeholder_profile || "—")}</span>
                          </div>
                        </div>

                        <SimpleTable
                          title="Inputs S2 réels par branche (prévisualisation)"
                          help={"Prévisualisation des inputs S2 calculés sur données réelles à la date d'arrêté. Ces lignes seront enregistrées avec le snapshot réel si vous confirmez."}
                          columns={[
                            { key: "s2_code", label: "S2" },
                            { key: "branch_label", label: "Branche" },
                            { key: "premium_volume", label: "Premium vol. (réel)", align: "right" },
                            { key: "reserve_volume", label: "Reserve vol. (réel)", align: "right" },
                            { key: "cat_exposure", label: "CAT", align: "right" },
                            { key: "counterparty_exposure", label: "Counterparty", align: "right" },
                            { key: "sigma_premium", label: "σ premium", align: "right" },
                            { key: "sigma_reserve", label: "σ reserve", align: "right" },
                          ]}
                          rows={(s2RealPreview.inputs_non_life || []).map((r: any) => ({
                            s2_code: r.s2_code,
                            branch_label: r.branch_label,
                            premium_volume: fmtEur(r.premium_volume),
                            reserve_volume: fmtEur(r.reserve_volume),
                            cat_exposure: fmtEur(r.cat_exposure),
                            counterparty_exposure: fmtEur(r.counterparty_exposure),
                            sigma_premium: fmtNum(r.sigma_premium, 3),
                            sigma_reserve: fmtNum(r.sigma_reserve, 3),
                          }))}
                        />
                      </div>
                    ) : null}

                    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="rounded-md bg-slate-200 px-2 py-1 text-sm font-bold text-slate-900">Snapshots S2 réels enregistrés (année de la date choisie)</div>
                        {s2RealHistoryLoading ? <span className="text-xs text-slate-500">Chargement…</span> : null}
                      </div>
                      <SimpleTable
                        title="Historique snapshots S2 réels"
                        columns={[
                          { key: "snapshot_date", label: "Date" },
                          { key: "run", label: "Run ref", align: "right" },
                          { key: "scr", label: "SCR", align: "right" },
                          { key: "ratio", label: "Solvency", align: "right" },
                          { key: "own_funds", label: "Own funds", align: "right" },
                          { key: "status", label: "Statut" },
                        ]}
                        rows={(s2RealHistory || []).map((r: any) => ({
                          snapshot_date: r.snapshot_date ? fmtDateIsoToFr(r.snapshot_date) : "—",
                          run: r.reference_run_id || "—",
                          scr: fmtEur(r.scr_total),
                          ratio: fmtPct(r.solvency_ratio_pct),
                          own_funds: fmtEur(r.own_funds_eligible),
                          status: r.status || "—",
                        }))}
                      />
                    </div>
                  </div>
                </details>

                <details
                  className="rounded-xl border border-slate-200 bg-white shadow-sm"
                  open={s2EngineConfigOpen}
                  onToggle={(e) => setS2EngineConfigOpen((e.currentTarget as HTMLDetailsElement).open)}
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:content-none">
                    <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                      <span className="rounded-md bg-slate-200 px-2 py-1 text-sm font-bold text-slate-900">Paramétrage moteur S2 (placeholder)</span>
                      <InfoHint text={"Ce bloc permet de paramétrer les hypothèses du moteur S2 simplifié : fonds propres éligibles de base, MCR et coefficients placeholder (charges CAT/contrepartie/non-vie/opérationnel). Ces paramètres s'appliquent aux prochains reruns/recalculs du scénario sélectionné."} />
                    </div>
                    <span className="text-xs font-medium text-slate-500">Afficher / Masquer</span>
                  </summary>
                  <div className="border-t border-slate-200 p-4">
                    <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                        Run de travail S2 {s2WorkingRun ? `#${s2WorkingRun.run_id}` : "—"}
                      </span>
                      {s2WorkingRun?.methodology_version ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{s2WorkingRun.methodology_version}</span>
                      ) : null}
                      <span>Scénario {selected?.set?.scenario_code || s2EngineConfigMeta?.scenario_code || "—"}</span>
                      {s2EngineConfigMeta?.source ? <span className="rounded-full bg-slate-100 px-2 py-0.5">{s2EngineConfigMeta.source}</span> : null}
                    </div>
                    {s2EngineConfigLoading ? <div className="text-sm text-slate-600">Chargement du paramétrage…</div> : null}
                    {s2EngineConfigError ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{s2EngineConfigError}</div> : null}
                    {s2EngineConfigMessage ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{s2EngineConfigMessage}</div> : null}

                    {s2EngineConfigDraft ? (
                      <div className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <NumberField
                            label="Own funds base (€)"
                            value={s2EngineConfigDraft?.own_funds_eligible_base_eur}
                            onChange={(v) => setS2EngineConfigDraft((d: any) => ({ ...d, own_funds_eligible_base_eur: v }))}
                            help="Stock de fonds propres éligibles utilisé par défaut par le moteur placeholder avant stress ORSA."
                          />
                          <NumberField
                            label="MCR (€)"
                            value={s2EngineConfigDraft?.mcr_eur}
                            onChange={(v) => setS2EngineConfigDraft((d: any) => ({ ...d, mcr_eur: v }))}
                            help="Minimum Capital Requirement utilisé par le moteur placeholder."
                          />
                        </div>

                        {[
                          ["claims_v1", "Claims V1"],
                          ["reinsurance_v1", "Réassurance V1"],
                          ["cat_xol_v2", "CAT / XoL V2"],
                          ["fronting_v2", "Fronting V2"],
                        ].map(([key, title]) => (
                          <div key={key} className="rounded-lg border border-slate-200 p-3">
                            <div className="mb-2 text-xs font-medium uppercase tracking-[0.12em] text-slate-500">{title}</div>
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                              <NumberField
                                label="CAT factor"
                                value={s2EngineConfigDraft?.[key]?.cat_charge_factor}
                                onChange={(v) =>
                                  setS2EngineConfigDraft((d: any) => ({ ...d, [key]: { ...(d?.[key] || {}), cat_charge_factor: v } }))
                                }
                                help="Coefficient appliqué à l'exposition CAT dans la charge placeholder."
                              />
                              {"counterparty_charge_factor" in (s2EngineConfigDraft?.[key] || {}) ? (
                                <NumberField
                                  label="Counterparty factor"
                                  value={s2EngineConfigDraft?.[key]?.counterparty_charge_factor}
                                  onChange={(v) =>
                                    setS2EngineConfigDraft((d: any) => ({
                                      ...d,
                                      [key]: { ...(d?.[key] || {}), counterparty_charge_factor: v },
                                    }))
                                  }
                                  help="Coefficient appliqué à l'exposition contrepartie (réassurance/fronting)."
                                />
                              ) : null}
                              <NumberField
                                label="Non-life multiplier"
                                value={s2EngineConfigDraft?.[key]?.nonlife_multiplier}
                                onChange={(v) =>
                                  setS2EngineConfigDraft((d: any) => ({ ...d, [key]: { ...(d?.[key] || {}), nonlife_multiplier: v } }))
                                }
                                help="Multiplicateur global appliqué à la composante non-vie du SCR placeholder."
                              />
                              {"operational_fixed_eur" in (s2EngineConfigDraft?.[key] || {}) ? (
                                <NumberField
                                  label="Operational fixed (€)"
                                  value={s2EngineConfigDraft?.[key]?.operational_fixed_eur}
                                  onChange={(v) =>
                                    setS2EngineConfigDraft((d: any) => ({ ...d, [key]: { ...(d?.[key] || {}), operational_fixed_eur: v } }))
                                  }
                                  help="Charge opérationnelle fixe placeholder pour l'étape."
                                />
                              ) : (
                                <>
                                  <NumberField
                                    label="Operational min (€)"
                                    value={s2EngineConfigDraft?.[key]?.operational_min_eur}
                                    onChange={(v) =>
                                      setS2EngineConfigDraft((d: any) => ({ ...d, [key]: { ...(d?.[key] || {}), operational_min_eur: v } }))
                                    }
                                    help="Minimum de charge opérationnelle placeholder."
                                  />
                                  <NumberField
                                    label="Op. per claim (€)"
                                    value={s2EngineConfigDraft?.[key]?.operational_per_claim_eur}
                                    onChange={(v) =>
                                      setS2EngineConfigDraft((d: any) => ({
                                        ...d,
                                        [key]: { ...(d?.[key] || {}), operational_per_claim_eur: v },
                                      }))
                                    }
                                    help="Charge opérationnelle placeholder par sinistre pour claims_v1."
                                  />
                                </>
                              )}
                            </div>
                          </div>
                        ))}

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={saveS2EngineConfig}
                            disabled={s2EngineConfigSaving || s2EngineConfigRerunning}
                            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                          >
                            {s2EngineConfigSaving ? "Enregistrement…" : "Enregistrer le paramétrage S2"}
                          </button>
                          <button
                            type="button"
                            onClick={saveAndRerunS2WorkingRun}
                            disabled={s2EngineConfigSaving || s2EngineConfigRerunning || !s2WorkingRunId}
                            className="rounded-md bg-indigo-700 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
                          >
                            {s2EngineConfigRerunning ? "Relance S2…" : "Enregistrer + relancer S2 (run de travail)"}
                          </button>
                          <button
                            type="button"
                            onClick={loadS2EngineConfig}
                            disabled={s2EngineConfigLoading || s2EngineConfigSaving || s2EngineConfigRerunning}
                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                          >
                            Recharger
                          </button>
                          {s2EngineConfigMeta?.parameter_row?.updated_at ? (
                            <span className="text-xs text-slate-500">
                              Dernière mise à jour: {String(s2EngineConfigMeta.parameter_row.updated_at).slice(0, 19).replace("T", " ")}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </details>
              </div>
            ) : null}

            {section === "fronting" ? (
              <div className="space-y-4">
                <SimpleTable
                  title="Programmes de fronting"
                  help={"Rôle du bloc : décrire la structure contractuelle du fronting par run et par branche (assureurs porteurs, rétrocession, frais).\n\nLecture : regarder d'abord Rétro %, Fee % et Claims fee % pour comprendre ce que la captive récupère réellement du business fronté.\n\nLeviers : paramètres de fronting (rétrocession, commission de fronting, claims handling fee) et répartition co-fronting A/B."}
                  columns={[
                    { key: "run", label: "Run", align: "right" },
                    { key: "branch", label: "Branche" },
                    { key: "primary", label: "Fronting A" },
                    { key: "secondary", label: "Fronting B" },
                    { key: "retro", label: "Rétro %", align: "right" },
                    { key: "fee", label: "Fee %", align: "right" },
                    { key: "claims_fee", label: "Claims fee %", align: "right" },
                  ]}
                  rows={frontingPrograms.map((fp: any) => ({
                    run: fp.run_id,
                    branch: `${fp.s2_code} - ${fp.branch_label || ""}`,
                    primary: fp.primary_insurer_name,
                    secondary: fp.secondary_insurer_name || "—",
                    retro: fmtPct(fp.retrocession_to_captive_pct, 2),
                    fee: fmtPct(fp.fronting_fee_pct, 2),
                    claims_fee: fmtPct(fp.claims_handling_fee_pct, 2),
                  }))}
                  rowClassName={(r) => (Number(r.run) === Number(effectiveSelectedRunId) ? "bg-slate-200" : "")}
                />

                <SimpleTable
                  title="Résultats économiques du fronting"
                  help={"Rôle du bloc : mesurer l'impact économique du fronting sur la captive (prime nette après frais) et l'exposition de contrepartie associée.\n\nLecture : comparer Prime brute vs Prime nette captive pour estimer le coût économique du portage. L'exposition contrepartie éclaire l'impact potentiel sur le module S2 contrepartie.\n\nLeviers : taux de fronting, frais, rétrocession vers la captive, choix/répartition des assureurs de fronting."}
                  columns={[
                    { key: "run", label: "Run", align: "right" },
                    { key: "branch", label: "Branche" },
                    { key: "gross", label: "Prime brute", align: "right" },
                    { key: "net_captive", label: "Prime nette captive", align: "right" },
                    { key: "fronting_cost", label: "Coût fronting", align: "right" },
                    { key: "cpty", label: "Expo contrepartie", align: "right" },
                  ]}
                  rows={frontingAdjustments.map((fa: any) => ({
                    run: fa.run_id,
                    branch: `${fa.s2_code} - ${fa.branch_label || ""}`,
                    gross: fmtEur(fa.gross_premium),
                    net_captive: fmtEur(fa.premium_net_to_captive_after_fees),
                    fronting_cost: fmtEur(n(fa.fronting_fee_amount) + n(fa.claims_handling_fee_amount)),
                    cpty: fmtEur(fa.estimated_counterparty_exposure),
                  }))}
                  rowClassName={(r) => (Number(r.run) === Number(effectiveSelectedRunId) ? "bg-slate-200" : "")}
                />

                <SimpleTable
                  title="Répartition co-fronting par assureur"
                  help={"Rôle du bloc : ventiler le fronting entre les assureurs A/B pour analyser concentration et coût par contrepartie.\n\nLecture : lire la quote-part avec les montants de fees et l'exposition allouée pour voir quel assureur concentre le risque et les coûts.\n\nLeviers : partage A/B (co-fronting), choix de l'assureur principal/secondaire et paramètres de fronting du programme."}
                  columns={[
                    { key: "run", label: "Run", align: "right" },
                    { key: "insurer", label: "Assureur" },
                    { key: "role", label: "Rôle" },
                    { key: "share", label: "Quote-part", align: "right" },
                    { key: "fee", label: "Fee alloc", align: "right" },
                    { key: "claims_fee", label: "Claims fee alloc", align: "right" },
                    { key: "cpty", label: "Expo cpty alloc", align: "right" },
                  ]}
                  rows={frontingAllocations.map((a: any) => ({
                    run: a.run_id,
                    insurer: a.insurer_name,
                    role: a.role_code,
                    share: fmtPct(a.share_pct, 2),
                    fee: fmtEur(a.fronting_fee_alloc),
                    claims_fee: fmtEur(a.claims_handling_fee_alloc),
                    cpty: fmtEur(a.counterparty_exposure_alloc),
                  }))}
                  rowClassName={(r) => (Number(r.run) === Number(effectiveSelectedRunId) ? "bg-slate-200" : "")}
                />
              </div>
            ) : null}

            {section === "cat" ? (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  <Kpi
                    label="Run de base"
                    value={String(selected.set.base_run_id)}
                    sub={`Snapshot ${String(selected.set.snapshot_date).slice(0, 10)} | SCR ${fmtEur(base?.scr_total)} | Solvency ${fmtPct(base?.solvency_ratio_pct)}`}
                    help={"Rôle du bloc : rappeler le run de référence du set ORSA (base) même si un autre run est sélectionné pour l'analyse CAT.\n\nLecture : ce repère permet de comparer visuellement la base réglementaire et le run de travail affiché dans les tableaux.\n\nLeviers : changer le set ORSA ou la sélection de run en haut de page."}
                  />
                  <Kpi
                    label="Run analysé"
                    value={String(effectiveSelectedRun?.run_id || selected.set.base_run_id)}
                    sub={`${effectiveSelectedRun?.stress_code || "BASE"}`}
                    className="!bg-slate-200 border-sky-300 ring-1 ring-sky-200"
                    help={"Rôle du bloc : identifier le run actuellement utilisé pour les tableaux CAT de cet onglet."}
                  />
                  <Kpi label="Zones CAT" value={String(catRows.length)} help={"Rôle du bloc : indiquer la granularité géographique retenue pour mesurer la concentration CAT Property.\n\nLecture : plus il y a de zones, plus l'analyse est fine; moins il y en a, plus la lecture est agrégée.\n\nLeviers : paramétrage du découpage géographique et mapping des expositions Property vers les zones."} />
                  <Kpi label="HHI Property (ORSA)" value={fmtNum(n(effectiveSelectedRun?.property_geo_hhi), 6)} help={"Rôle du bloc : mesurer la concentration géographique du portefeuille Property (indice HHI).\n\nLecture : plus le HHI est élevé, plus le portefeuille est concentré sur peu de zones, donc potentiellement plus vulnérable à un choc CAT localisé.\n\nLeviers : diversification géographique du portefeuille, souscription Property, limites et réassurance CAT."} />
                  <Kpi label="CAT Property S2 (run)" value={fmtEur(effectiveSelectedRun?.property_cat_exposure_s2)} help={"Rôle du bloc : montrer l'exposition CAT Property du run sélectionné injectée dans S2.\n\nLecture : une hausse de cette exposition tend à augmenter le besoin en capital S2 sur la composante CAT.\n\nLeviers : concentration géographique, sommes assurées, modélisation CAT, réassurance (XoL/Stop Loss), sélection des risques."} />
                </div>
                <SimpleTable
                  title="Concentration CAT géographique (Property)"
                  help={"Rôle du bloc : détailler la concentration CAT Property zone par zone pour identifier les poches de risque.\n\nLecture : comparer Part GWP, Somme assurée, Expo pondérée et HHI contrib. pour repérer les zones dominantes. Une zone avec forte expo pondérée et forte contribution HHI est prioritaire.\n\nLeviers : politique de souscription géographique, plafonds/agrégats par zone, réassurance CAT et diversification du portefeuille.\n\nAbrégés : GWP = primes brutes, HHI = indice de concentration."}
                  columns={[
                    { key: "geo", label: "Zone" },
                    { key: "region", label: "Région" },
                    { key: "gwp", label: "GWP Property", align: "right" },
                    { key: "gwp_share", label: "Part GWP", align: "right" },
                    { key: "si", label: "Somme assurée", align: "right" },
                    { key: "cat_events", label: "CAT events", align: "right" },
                    { key: "weighted", label: "Expo pondérée", align: "right" },
                    { key: "hhi", label: "HHI contrib.", align: "right" },
                  ]}
                  rows={catRows}
                />
              </div>
            ) : null}

            {section === "alm" ? (
              <div className="space-y-4">
                {almLoading ? <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">Chargement ALM…</div> : null}
                {almError ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{almError}</div> : null}
                {almMessage ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">{almMessage}</div> : null}

                {!almLoading && almData?.selected_set ? (
                  <>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      <Kpi label="SCR peak ORSA" value={fmtEur(almResult?.scr_peak_orsa)} sub={`Run ${almData?.selected_run_id || effectiveSelectedRunId || selected?.set?.base_run_id || "—"} | Base SCR ${fmtEur(almResult?.scr_base)}`} help={"Rôle du bloc : fixe l'assiette de fonds propres à piloter de façon prudente (peak SCR = pire SCR observé dans le set ORSA).\n\nLecture : plus l'écart entre Base SCR et Peak SCR est grand, plus le stress pèse sur la politique ALM.\n\nLeviers : paramètres ORSA (sinistralité, CAT, contrepartie, fronting, réassurance) et structure du portefeuille."} />
                      <Kpi label="Durée détention pondérée" value={`${fmtNum(almResult?.weighted_holding_years_base, 2)} ans`} sub={`Stress ${fmtNum(almResult?.weighted_holding_years_stress, 2)} ans`} help={"Rôle du bloc : estime combien de temps les fonds propres doivent rester mobilisés (proxy) selon les branches et leur profil de risque.\n\nLecture : la valeur Stress doit être supérieure ou égale à la Base dans un scénario prudent. Plus elle est longue, plus l'allocation doit être stable/liquide à horizon long.\n\nLeviers : hypothèses de détention par branche (base/stress, lock factor, liquidité %)."} />
                      <Kpi label="Duration actifs pondérée" value={`${fmtNum(almResult?.weighted_asset_duration_years, 2)} ans`} sub={`Besoin liquidité court terme ${fmtEur(almResult?.short_liquidity_need_amount)}`} help={"Rôle du bloc : compare la structure de duration des actifs à un besoin de liquidité court terme dérivé du portefeuille.\n\nLecture : duration élevée + besoin de liquidité élevé = risque de désalignement si les actifs sont peu mobilisables.\n\nLeviers : allocation d'actifs (poids), durations par classe, horizons de liquidité et stress ALM V3."} />
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <BlockTitle
                          title="Paramétrages ALM V2 (éditables)"
                          help={"Rôle du bloc : paramétrer le modèle proxy ALM (allocation cible + hypothèses de détention des fonds propres par branche).\n\nLecture : ces paramètres n'affichent pas un résultat, ils expliquent pourquoi les résultats ALM changent plus bas (durée, liquidité, gaps).\n\nLeviers : modifier les poids, durations, horizons de liquidité et hypothèses de branche, puis cliquer sur Recalculer."}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => setAlmConfigVisible((v) => !v)}
                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                          >
                            {almConfigVisible ? "Masquer" : "Afficher"}
                          </button>
                          <button
                            onClick={saveAlmConfig}
                            disabled={almSaving}
                            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                          >
                            Enregistrer
                          </button>
                          <button
                            onClick={recomputeAlm}
                            disabled={almSaving}
                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 disabled:opacity-50"
                          >
                            Recalculer
                          </button>
                        </div>
                      </div>

                      {almConfigVisible ? (
                        <div className="mt-4 space-y-4">
                        <div className="space-y-2">
                          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Allocation d’actifs</div>
                          <div className="overflow-auto rounded-lg border border-slate-200">
                            <table className="min-w-full text-sm">
                              <thead className="bg-slate-50 text-slate-600">
                                <tr>
                                  <th className="px-2 py-2 text-left"><HeaderHoverHelp label="Classe d’actifs" help={defaultHeaderHoverHelpForColumn("asset", "Classe d’actifs")} /></th>
                                  <th className="px-2 py-2 text-left"><HeaderHoverHelp label="Bucket duration" help={defaultHeaderHoverHelpForColumn("bucket", "Bucket duration")} /></th>
                                  <th className="px-2 py-2 text-right"><HeaderHoverHelp label="Poids %" help={defaultHeaderHoverHelpForColumn("weight", "Poids %")} align="right" /></th>
                                  <th className="px-2 py-2 text-right"><HeaderHoverHelp label="Duration (ans)" help={defaultHeaderHoverHelpForColumn("duration", "Duration (ans)")} align="right" /></th>
                                  <th className="px-2 py-2 text-right"><HeaderHoverHelp label="Liquidité (j)" help={defaultHeaderHoverHelpForColumn("liquidity", "Liquidité (j)")} align="right" /></th>
                                </tr>
                              </thead>
                              <tbody>
                                {almAllocDraft.map((r: any, idx: number) => (
                                  <tr key={r.allocation_id || idx} className="border-t border-slate-100">
                                    <td className="px-2 py-2 align-top">
                                      <div className="font-medium text-slate-900">{r.label}</div>
                                      <div className="text-xs text-slate-500">{r.asset_code}</div>
                                    </td>
                                    <td className="px-2 py-2 align-top">
                                      <select
                                        className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                                        value={r.bucket_code || ""}
                                        onChange={(e) =>
                                          setAlmAllocDraft((prev) =>
                                            prev.map((x, i) =>
                                              i === idx
                                                ? {
                                                    ...x,
                                                    bucket_code: e.target.value || null,
                                                  }
                                                : x
                                            )
                                          )
                                        }
                                      >
                                        <option value="">—</option>
                                        {almDurations.map((b: any) => (
                                          <option key={b.id} value={b.bucket_code}>
                                            {b.label}
                                          </option>
                                        ))}
                                      </select>
                                    </td>
                                    <td className="px-2 py-2 align-top">
                                      <TextInput
                                        type="number"
                                        value={r.target_weight_pct}
                                        onChange={(v) =>
                                          setAlmAllocDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, target_weight_pct: v } : x)))
                                        }
                                        className="text-right"
                                      />
                                    </td>
                                    <td className="px-2 py-2 align-top">
                                      <TextInput
                                        type="number"
                                        value={r.duration_years_override ?? r.default_duration_years}
                                        onChange={(v) =>
                                          setAlmAllocDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, duration_years_override: v } : x)))
                                        }
                                        className="text-right"
                                      />
                                    </td>
                                    <td className="px-2 py-2 align-top">
                                      <TextInput
                                        type="number"
                                        value={r.liquidity_horizon_days_override ?? r.liquidity_horizon_days}
                                        onChange={(v) =>
                                          setAlmAllocDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, liquidity_horizon_days_override: v } : x)))
                                        }
                                        className="text-right"
                                      />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Hypothèses de détention par branche</div>
                          <div className="overflow-auto rounded-lg border border-slate-200">
                            <table className="min-w-full text-sm">
                              <thead className="bg-slate-50 text-slate-600">
                                <tr>
                                  <th className="px-2 py-2 text-left"><HeaderHoverHelp label="Branche" help={defaultHeaderHoverHelpForColumn("branch", "Branche")} /></th>
                                  <th className="px-2 py-2 text-right"><HeaderHoverHelp label="Base (ans)" help={defaultHeaderHoverHelpForColumn("hold_base", "Base (ans)")} align="right" /></th>
                                  <th className="px-2 py-2 text-right"><HeaderHoverHelp label="Stress (ans)" help={defaultHeaderHoverHelpForColumn("hold_stress", "Stress (ans)")} align="right" /></th>
                                  <th className="px-2 py-2 text-right"><HeaderHoverHelp label="Lock factor" help={"Lock factor = facteur de verrouillage du capital.\n\nReprésente la part des fonds propres considérée comme moins mobilisable rapidement pour cette branche."} align="right" /></th>
                                  <th className="px-2 py-2 text-right"><HeaderHoverHelp label="Liquidité %" help={"Liquidité % = part de besoin de liquidité associée à la branche.\n\nReprésente l'intensité de pression de liquidité retenue pour calibrer la détention des fonds propres."} align="right" /></th>
                                </tr>
                              </thead>
                              <tbody>
                                {almBranchDraftVisible.map((r: any, idx: number) => (
                                  <tr key={r.id || idx} className="border-t border-slate-100">
                                    <td className="px-2 py-2 align-top">
                                      <div className="font-medium text-slate-900">{r.branch_label}</div>
                                      <div className="text-xs text-slate-500">S2 {r.s2_code}</div>
                                    </td>
                                    <td className="px-2 py-2 align-top">
                                      <TextInput
                                        type="number"
                                        value={r.holding_years_base}
                                        onChange={(v) =>
                                          setAlmBranchDraft((prev) => prev.map((x, i) => (i === r.__sourceIndex ? { ...x, holding_years_base: v } : x)))
                                        }
                                        className="text-right"
                                      />
                                    </td>
                                    <td className="px-2 py-2 align-top">
                                      <TextInput
                                        type="number"
                                        value={r.holding_years_stress}
                                        onChange={(v) =>
                                          setAlmBranchDraft((prev) => prev.map((x, i) => (i === r.__sourceIndex ? { ...x, holding_years_stress: v } : x)))
                                        }
                                        className="text-right"
                                      />
                                    </td>
                                    <td className="px-2 py-2 align-top">
                                      <TextInput
                                        type="number"
                                        value={r.capital_lock_factor}
                                        onChange={(v) =>
                                          setAlmBranchDraft((prev) => prev.map((x, i) => (i === r.__sourceIndex ? { ...x, capital_lock_factor: v } : x)))
                                        }
                                        className="text-right"
                                      />
                                    </td>
                                    <td className="px-2 py-2 align-top">
                                      <TextInput
                                        type="number"
                                        value={r.liquidity_need_pct}
                                        onChange={(v) =>
                                          setAlmBranchDraft((prev) => prev.map((x, i) => (i === r.__sourceIndex ? { ...x, liquidity_need_pct: v } : x)))
                                        }
                                        className="text-right"
                                      />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <BlockTitle
                          title="Stress ALM V3 (paramétrables)"
                          help={"Rôle du bloc : définir la mécanique des stress ALM journaliers (flux, liquidité, duration, chocs d'actifs) pour ADVERSE et SEVERE.\n\nLecture : plus les multiplicateurs dégradent les sources de liquidité et augmentent les usages, plus les gaps se tendent.\n\nLeviers : multiplicateurs globaux, seuils d'alerte, chocs par classe d'actifs puis Rejouer stress ALM V3."}
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => setAlmStressVisible((v) => !v)}
                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                          >
                            {almStressVisible ? "Masquer" : "Afficher"}
                          </button>
                          <button
                            onClick={saveAlmStressConfig}
                            disabled={almSaving}
                            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                          >
                            Enregistrer stress ALM V3
                          </button>
                          <button
                            onClick={rerunAlmV3Stress}
                            disabled={almSaving}
                            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 disabled:opacity-50"
                          >
                            Rejouer stress ALM V3
                          </button>
                        </div>
                      </div>
                      {almStressVisible ? (
                        <>
                      <div className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 md:grid-cols-4">
                        <div>
                          <div className="mb-1 text-xs font-medium text-slate-600">Seuil liq tension (EUR)</div>
                          <TextInput
                            type="number"
                            value={almAlertThresholdsDraft.liq_alert_tension_threshold_eur}
                            onChange={(v) => setAlmAlertThresholdsDraft((p: any) => ({ ...p, liq_alert_tension_threshold_eur: v }))}
                            className="text-right"
                          />
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-medium text-slate-600">Seuil liq vigilance (EUR)</div>
                          <TextInput
                            type="number"
                            value={almAlertThresholdsDraft.liq_alert_vigilance_threshold_eur}
                            onChange={(v) => setAlmAlertThresholdsDraft((p: any) => ({ ...p, liq_alert_vigilance_threshold_eur: v }))}
                            className="text-right"
                          />
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-medium text-slate-600">Seuil duration vigilance (ans)</div>
                          <TextInput
                            type="number"
                            value={almAlertThresholdsDraft.duration_alert_vigilance_abs_years}
                            onChange={(v) => setAlmAlertThresholdsDraft((p: any) => ({ ...p, duration_alert_vigilance_abs_years: v }))}
                            className="text-right"
                          />
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-medium text-slate-600">Seuil duration tension (ans)</div>
                          <TextInput
                            type="number"
                            value={almAlertThresholdsDraft.duration_alert_tension_abs_years}
                            onChange={(v) => setAlmAlertThresholdsDraft((p: any) => ({ ...p, duration_alert_tension_abs_years: v }))}
                            className="text-right"
                          />
                        </div>
                      </div>
                      {almV3RerunResult?.ok ? (
                        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
                            <span>Rejouement stress ALM V3</span>
                            <InfoHint text={"Rôle du bloc : confirmer ce qui a été recalculé après un clic sur « Rejouer stress ALM V3 ».\n\nLecture : vérifier le statut, les alertes liquidité/duration, puis comparer les runs touchés aux attentes du comité.\n\nLeviers : ajuster les stress ALM V3 (globaux et par classe d'actifs), relancer, puis recopier le résumé pour partage."} />
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={copyAlmRerunSummary}
                              className="rounded-md border border-emerald-300 bg-white px-2 py-1 text-xs font-medium text-emerald-800"
                            >
                              Copier le résumé
                            </button>
                          </div>
                          <div className="mt-2 grid gap-2 md:grid-cols-3">
                            <div className="rounded-md bg-white p-2 text-xs text-slate-700">Base run : {almV3RerunResult.base_run_id ?? "—"}</div>
                            <div className="rounded-md bg-white p-2 text-xs text-slate-700">Durée : {fmtNum((n(almV3RerunResult.elapsed_ms) || 0) / 1000, 2)} s</div>
                            <div className="rounded-md bg-white p-2 text-xs text-slate-700">
                              Runs touchés : {fmtNum((almV3RerunResult.summary?.generated_stress_runs || []).length, 0)}
                            </div>
                          </div>
                          {(almV3RerunResult.summary?.generated_stress_runs || []).length ? (
                            <div className="mt-3 overflow-auto rounded-lg border border-slate-200 bg-white">
                              <div className="border-b border-slate-200 px-3 py-2 text-sm font-medium text-slate-900">Synthèse du dernier rejouement</div>
                              <table className="min-w-full text-sm">
                                <thead className="bg-slate-50 text-slate-600">
                                  <tr>
                                    <th className="px-3 py-2 text-left"><HeaderHoverHelp label="Stress" help={defaultHeaderHoverHelpForColumn("stress", "Stress")} /></th>
                                    <th className="px-3 py-2 text-left"><HeaderHoverHelp label="Statut" help={defaultHeaderHoverHelpForColumn("status", "Statut")} /></th>
                                    <th className="px-3 py-2 text-left"><HeaderHoverHelp label="Alerte liq" help={defaultHeaderHoverHelpForColumn("liq_alert", "Alerte liq")} /></th>
                                    <th className="px-3 py-2 text-left"><HeaderHoverHelp label="Alerte duration" help={defaultHeaderHoverHelpForColumn("dur_alert", "Alerte duration")} /></th>
                                    <th className="px-3 py-2 text-right"><HeaderHoverHelp label="Run" help={defaultHeaderHoverHelpForColumn("run", "Run")} align="right" /></th>
                                    <th className="px-3 py-2 text-left"><HeaderHoverHelp label="Run code" help={"Run code = identifiant lisible du run ALM stressé.\n\nReprésente le nom technique/fonctionnel du run généré lors du rejouement."} /></th>
                                    <th className="px-3 py-2 text-right"><HeaderHoverHelp label="Snapshots" help={defaultHeaderHoverHelpForColumn("snapshots", "Snapshots")} align="right" /></th>
                                    <th className="px-3 py-2 text-right"><HeaderHoverHelp label="Min gap liq" help={"Min gap liq = plus faible gap de liquidité observé sur le run.\n\nReprésente le point de tension maximal (plus négatif = plus critique)."} align="right" /></th>
                                    <th className="px-3 py-2 text-right"><HeaderHoverHelp label="Avg duration gap" help={defaultHeaderHoverHelpForColumn("avg_dur_gap", "Avg duration gap")} align="right" /></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(almV3RerunResult.summary.generated_stress_runs || []).map((r: any, idx: number) => {
                                    const minGap = n(r.min_liquidity_gap);
                                    const avgDurGap = n(r.avg_duration_gap);
                                    const liqTension = n(almAlertThresholds?.liq_alert_tension_threshold_eur ?? 0);
                                    const liqVigilance = n(almAlertThresholds?.liq_alert_vigilance_threshold_eur ?? 500000);
                                    const liqTone = minGap < liqTension ? "red" : minGap < liqVigilance ? "orange" : "green";
                                    const durAbs = Math.abs(avgDurGap);
                                    const durVigilance = n(almAlertThresholds?.duration_alert_vigilance_abs_years ?? 3);
                                    const durTension = n(almAlertThresholds?.duration_alert_tension_abs_years ?? 5);
                                    const durTone = durAbs > durTension ? "red" : durAbs > durVigilance ? "orange" : "green";
                                    return (
                                      <tr key={`${r.run_id}-${idx}`} className="border-t border-slate-100">
                                        <td className="px-3 py-2">{r.stress_code}</td>
                                        <td className="px-3 py-2">
                                          <StatusChip
                                            label={String(r.run_status || "—")}
                                            tone={String(r.run_status || "").toLowerCase() === "completed" ? "green" : String(r.run_status || "").toLowerCase() === "running" ? "orange" : "slate"}
                                          />
                                        </td>
                                        <td className="px-3 py-2">
                                          <StatusChip label={liqTone === "green" ? "Confort" : liqTone === "orange" ? "Vigilance" : "Tension"} tone={liqTone as any} />
                                        </td>
                                        <td className="px-3 py-2">
                                          <StatusChip label={durTone === "green" ? "Acceptable" : durTone === "orange" ? "À surveiller" : "Écart fort"} tone={durTone as any} />
                                        </td>
                                        <td className="px-3 py-2 text-right">{fmtNum(r.run_id, 0)}</td>
                                        <td className="px-3 py-2">{r.run_code || r.run_label || "—"}</td>
                                        <td className="px-3 py-2 text-right">{fmtNum(r.snapshots, 0)}</td>
                                        <td className="px-3 py-2 text-right">{fmtEur(minGap)}</td>
                                        <td className="px-3 py-2 text-right">{fmtNum(avgDurGap, 3)}</td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          ) : null}
                          <details className="mt-3 rounded-md border border-slate-200 bg-white p-2">
                            <summary className="cursor-pointer text-xs font-medium text-slate-700">
                              Journal d’exécution (stdout / stderr)
                            </summary>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => downloadTextFile(`alm_v3_rerun_stdout_${Date.now()}.txt`, String(almV3RerunResult.stdout || ""))}
                                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700"
                              >
                                Télécharger stdout (.txt)
                              </button>
                              <button
                                type="button"
                                onClick={() => downloadTextFile(`alm_v3_rerun_stderr_${Date.now()}.txt`, String(almV3RerunResult.stderr || ""))}
                                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700"
                              >
                                Télécharger stderr (.txt)
                              </button>
                            </div>
                            <div className="mt-2 grid gap-3 lg:grid-cols-2">
                              <div>
                                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">stdout</div>
                                <pre className="max-h-64 overflow-auto rounded-md bg-slate-50 p-2 text-[11px] text-slate-700 whitespace-pre-wrap">
                                  {String(almV3RerunResult.stdout || "").trim() || "—"}
                                </pre>
                              </div>
                              <div>
                                <div className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">stderr</div>
                                <pre className="max-h-64 overflow-auto rounded-md bg-slate-50 p-2 text-[11px] text-slate-700 whitespace-pre-wrap">
                                  {String(almV3RerunResult.stderr || "").trim() || "—"}
                                </pre>
                              </div>
                            </div>
                          </details>
                        </div>
                      ) : null}
                      <div className="mt-3 space-y-4">
                        <div className="overflow-auto rounded-lg border border-slate-200">
                          <table className="min-w-full text-sm">
                            <thead className="bg-slate-50 text-slate-600">
                              <tr>
                                <th className="px-2 py-2 text-left"><HeaderHoverHelp label="Stress" help={defaultHeaderHoverHelpForColumn("stress", "Stress")} /></th>
                                <th className="px-2 py-2 text-right"><HeaderHoverHelp label="Inflows x" help={defaultHeaderHoverHelpForColumn("inflows", "Inflows x")} align="right" /></th>
                                <th className="px-2 py-2 text-right"><HeaderHoverHelp label="Outflows x" help={defaultHeaderHoverHelpForColumn("outflows", "Outflows x")} align="right" /></th>
                                <th className="px-2 py-2 text-right"><HeaderHoverHelp label="Src D1/D7/D30" help={"Src D1/D7/D30 = multiplicateurs des sources de liquidité à 1, 7 et 30 jours.\n\nReprésente la dégradation (ou amélioration) de la mobilisation des ressources par horizon."} align="right" /></th>
                                <th className="px-2 py-2 text-right"><HeaderHoverHelp label="Uses D1/D7/D30" help={"Uses D1/D7/D30 = multiplicateurs des usages (décaissements) à 1, 7 et 30 jours.\n\nReprésente l'intensification des besoins de liquidité par horizon."} align="right" /></th>
                                <th className="px-2 py-2 text-right"><HeaderHoverHelp label="ΔDur actifs" help={"ΔDur actifs = décalage appliqué à la duration des actifs sous stress.\n\nReprésente le shift de duration utilisé dans le moteur ALM V3 pour ce scénario."} align="right" /></th>
                                <th className="px-2 py-2 text-right"><HeaderHoverHelp label="Dur passif x" help={"Dur passif x = multiplicateur de duration passif proxy.\n\nReprésente l'allongement/raccourcissement de la duration des passifs simulés sous stress."} align="right" /></th>
                              </tr>
                            </thead>
                            <tbody>
                              {almStressDraft.map((r: any, idx: number) => (
                                <tr key={r.id || idx} className="border-t border-slate-100">
                                  <td className="px-2 py-2 align-top">
                                    <div className="font-medium text-slate-900">{r.label || r.stress_code}</div>
                                    <div className="mt-1 flex gap-3 text-xs text-slate-600">
                                      <label className="inline-flex items-center gap-1">
                                        <input
                                          type="checkbox"
                                          checked={!!Number(r.allow_negative_cash ?? 1)}
                                          onChange={(e) => setAlmStressDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, allow_negative_cash: e.target.checked ? 1 : 0 } : x)))}
                                        />
                                        cash négatif
                                      </label>
                                      <label className="inline-flex items-center gap-1">
                                        <input
                                          type="checkbox"
                                          checked={!!Number(r.allow_negative_liquidity_buffer ?? 1)}
                                          onChange={(e) =>
                                            setAlmStressDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, allow_negative_liquidity_buffer: e.target.checked ? 1 : 0 } : x)))
                                          }
                                        />
                                        buffer négatif
                                      </label>
                                    </div>
                                  </td>
                                  <td className="px-2 py-2 align-top"><TextInput type="number" value={r.inflow_mult} onChange={(v) => setAlmStressDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, inflow_mult: v } : x)))} className="text-right" /></td>
                                  <td className="px-2 py-2 align-top"><TextInput type="number" value={r.outflow_mult} onChange={(v) => setAlmStressDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, outflow_mult: v } : x)))} className="text-right" /></td>
                                  <td className="px-2 py-2 align-top">
                                    <div className="grid gap-1">
                                      <TextInput type="number" value={r.liquidity_source_mult_d1} onChange={(v) => setAlmStressDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, liquidity_source_mult_d1: v } : x)))} className="text-right" />
                                      <TextInput type="number" value={r.liquidity_source_mult_d7} onChange={(v) => setAlmStressDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, liquidity_source_mult_d7: v } : x)))} className="text-right" />
                                      <TextInput type="number" value={r.liquidity_source_mult_d30} onChange={(v) => setAlmStressDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, liquidity_source_mult_d30: v } : x)))} className="text-right" />
                                    </div>
                                  </td>
                                  <td className="px-2 py-2 align-top">
                                    <div className="grid gap-1">
                                      <TextInput type="number" value={r.liquidity_use_mult_d1} onChange={(v) => setAlmStressDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, liquidity_use_mult_d1: v } : x)))} className="text-right" />
                                      <TextInput type="number" value={r.liquidity_use_mult_d7} onChange={(v) => setAlmStressDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, liquidity_use_mult_d7: v } : x)))} className="text-right" />
                                      <TextInput type="number" value={r.liquidity_use_mult_d30} onChange={(v) => setAlmStressDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, liquidity_use_mult_d30: v } : x)))} className="text-right" />
                                    </div>
                                  </td>
                                  <td className="px-2 py-2 align-top"><TextInput type="number" value={r.duration_asset_shift_years} onChange={(v) => setAlmStressDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, duration_asset_shift_years: v } : x)))} className="text-right" /></td>
                                  <td className="px-2 py-2 align-top"><TextInput type="number" value={r.duration_liability_mult} onChange={(v) => setAlmStressDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, duration_liability_mult: v } : x)))} className="text-right" /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="space-y-2">
                          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Chocs par classe d’actifs (éditables)</div>
                          <div className="overflow-auto rounded-lg border border-slate-200">
                            <table className="min-w-full text-sm">
                              <thead className="bg-slate-50 text-slate-600">
                                <tr>
                                  <th className="px-2 py-2 text-left"><HeaderHoverHelp label="Stress" help={defaultHeaderHoverHelpForColumn("stress", "Stress")} /></th>
                                  <th className="px-2 py-2 text-left"><HeaderHoverHelp label="Classe d’actifs" help={defaultHeaderHoverHelpForColumn("asset", "Classe d’actifs")} /></th>
                                  <th className="px-2 py-2 text-right"><HeaderHoverHelp label="MV x" help={"MV x = multiplicateur de valeur de marché.\n\nReprésente le choc de valorisation appliqué à la classe d'actifs dans ce stress."} align="right" /></th>
                                  <th className="px-2 py-2 text-right"><HeaderHoverHelp label="Δ Duration" help={defaultHeaderHoverHelpForColumn("duration", "Δ Duration")} align="right" /></th>
                                  <th className="px-2 py-2 text-right"><HeaderHoverHelp label="Src liq D1" help={"Src liq D1 = multiplicateur de source de liquidité à 1 jour pour la classe d'actifs.\n\nReprésente la part mobilisable sous stress sur horizon 1 jour."} align="right" /></th>
                                  <th className="px-2 py-2 text-right"><HeaderHoverHelp label="Src liq D7" help={"Src liq D7 = multiplicateur de source de liquidité à 7 jours pour la classe d'actifs.\n\nReprésente la part mobilisable sous stress sur horizon 7 jours."} align="right" /></th>
                                  <th className="px-2 py-2 text-right"><HeaderHoverHelp label="Src liq D30" help={"Src liq D30 = multiplicateur de source de liquidité à 30 jours pour la classe d'actifs.\n\nReprésente la part mobilisable sous stress sur horizon 30 jours."} align="right" /></th>
                                  <th className="px-2 py-2 text-center"><HeaderHoverHelp label="Actif" help={"Actif = activation du choc de classe d'actifs dans le scénario de stress.\n\nReprésente si la ligne de choc est appliquée (coché) ou ignorée (décoché)."} align="center" /></th>
                                </tr>
                              </thead>
                              <tbody>
                                {almStressAssetDraft.map((r: any, idx: number) => {
                                  const cfg = almV3StressConfigs.find((c: any) => Number(c.id) === Number(r.stress_scenario_id));
                                  return (
                                    <tr key={r.id || idx} className="border-t border-slate-100">
                                      <td className="px-2 py-2 align-top">
                                        <div className="font-medium text-slate-900">{cfg?.stress_code || r.stress_scenario_id}</div>
                                      </td>
                                      <td className="px-2 py-2 align-top">
                                        <div className="font-medium text-slate-900">{r.asset_code}</div>
                                      </td>
                                      <td className="px-2 py-2 align-top"><TextInput type="number" value={r.mv_mult} onChange={(v) => setAlmStressAssetDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, mv_mult: v } : x)))} className="text-right" /></td>
                                      <td className="px-2 py-2 align-top"><TextInput type="number" value={r.duration_shift_years} onChange={(v) => setAlmStressAssetDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, duration_shift_years: v } : x)))} className="text-right" /></td>
                                      <td className="px-2 py-2 align-top"><TextInput type="number" value={r.liquidity_source_mult_d1 ?? ""} onChange={(v) => setAlmStressAssetDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, liquidity_source_mult_d1: v } : x)))} className="text-right" /></td>
                                      <td className="px-2 py-2 align-top"><TextInput type="number" value={r.liquidity_source_mult_d7 ?? ""} onChange={(v) => setAlmStressAssetDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, liquidity_source_mult_d7: v } : x)))} className="text-right" /></td>
                                      <td className="px-2 py-2 align-top"><TextInput type="number" value={r.liquidity_source_mult_d30 ?? ""} onChange={(v) => setAlmStressAssetDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, liquidity_source_mult_d30: v } : x)))} className="text-right" /></td>
                                      <td className="px-2 py-2 align-top text-center">
                                        <input
                                          type="checkbox"
                                          checked={r.active !== 0 && r.active !== false}
                                          onChange={(e) => setAlmStressAssetDraft((prev) => prev.map((x, i) => (i === idx ? { ...x, active: e.target.checked ? 1 : 0 } : x)))}
                                        />
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                        </>
                      ) : null}
                    </div>

                    <div className="space-y-4">
                      <SimpleTable
                        title="Résultat proxy par classe d’actifs"
                        help={"Rôle du bloc : montre comment les fonds propres (assiette = peak SCR ORSA) sont répartis par classe d'actifs dans le proxy ALM.\n\nLecture : regarder le poids, la duration et l'horizon de détention stress pour voir si la structure est cohérente avec l'objectif (liquidité vs portage).\n\nLeviers : bloc « Paramétrages ALM V2 » (poids, duration, liquidité) et hypothèses de branche."}
                        collapsible
                        open={almBlocksOpen.proxyByAsset}
                        onToggle={() => toggleAlmBlock("proxyByAsset")}
                        columns={[
                          { key: "asset", label: "Classe d’actifs" },
                          { key: "bucket", label: "Bucket duration" },
                          { key: "weight", label: "Poids", align: "right" },
                          { key: "duration", label: "Duration", align: "right" },
                          { key: "liquidity", label: "Liquidité", align: "right" },
                          { key: "allocated", label: "Fonds propres alloués", align: "right" },
                          { key: "hold_base", label: "Détention base", align: "right" },
                          { key: "hold_stress", label: "Détention stress", align: "right" },
                        ]}
                        rows={almAssetRowsDisplay}
                      />
                      <SimpleTable
                        title="Résultat proxy par bucket de duration"
                        help={"Rôle du bloc : traduit l'allocation ALM en tranches de duration pour vérifier le profil de maturité global.\n\nLecture : une concentration excessive sur une tranche peut créer un mismatch avec le passif (trop court ou trop long).\n\nLeviers : changer les buckets de duration dans l'allocation d'actifs et les durations par classe."}
                        collapsible
                        open={almBlocksOpen.proxyByBucket}
                        onToggle={() => toggleAlmBlock("proxyByBucket")}
                        columns={[
                          { key: "bucket", label: "Bucket" },
                          { key: "weight", label: "Poids", align: "right" },
                          { key: "allocated", label: "Fonds propres alloués", align: "right" },
                          { key: "duration", label: "Duration moyenne", align: "right" },
                        ]}
                        rows={almBucketRowsDisplay}
                      />

                      <SimpleTable
                        title="Runs ALM V3 (journaliers)"
                        help={"Rôle du bloc : vue d'ensemble des runs ALM V3 (base et stress) pour comparer rapidement les résultats journaliers agrégés.\n\nLecture : surveiller surtout Avg duration gap, Max besoin 30j et jours de déficit; des écarts forts entre BASE et stress indiquent une structure fragile.\n\nLeviers : stress ALM V3, allocation d'actifs, liquidité des poches, et hypothèses de flux passifs."}
                        collapsible
                        open={almBlocksOpen.runsDaily}
                        onToggle={() => toggleAlmBlock("runsDaily")}
                        columns={[
                          { key: "run", label: "Run" },
                          { key: "type", label: "Type" },
                          { key: "status", label: "Statut" },
                          { key: "period", label: "Période" },
                          { key: "snapshots", label: "Snapshots", align: "right" },
                          { key: "avg_dur_gap", label: "Avg duration gap", align: "right" },
                          { key: "max_liq30", label: "Max besoin 30j", align: "right" },
                          { key: "deficit_days", label: "Jours déficit", align: "right" },
                        ]}
                        rows={almV3RunSummaryRows}
                      />

                        <SimpleTable
                          title="Comparaison ALM stress (fin de période)"
                          help={"Rôle du bloc : comparer, en fin de période, la résistance ALM des scénarios BASE / ADVERSE / SEVERE.\n\nLecture : Gap liq D1/D7/D30 = sources - usages (négatif = tension). Le statut/alertes aident à prioriser l'analyse.\n\nLeviers : stress de liquidité (sources/usages), chocs d'actifs, allocation d'actifs et seuils d'alerte paramétrables."}
                          collapsible
                          open={almBlocksOpen.stressComparison}
                          onToggle={() => toggleAlmBlock("stressComparison")}
                          columns={[
                          { key: "stress", label: "Stress", nowrap: true },
                          { key: "status", label: "Statut", nowrap: true },
                          { key: "liq_alert", label: "Alerte liq", nowrap: true },
                          { key: "dur_alert", label: "Alerte duration", nowrap: true },
                          { key: "run", label: "Run", nowrap: true },
                          { key: "date", label: "Date", nowrap: true },
                          { key: "assets", label: "Actifs MV", align: "right", nowrap: true },
                          { key: "cash", label: "Cash", align: "right", nowrap: true },
                          { key: "outflows", label: "Outflows passifs", align: "right", nowrap: true },
                          { key: "dgap", label: "Duration gap", align: "right", nowrap: true },
                          { key: "liq_d1", label: "Gap liq D1", align: "right", nowrap: true },
                          { key: "liq_d7", label: "Gap liq D7", align: "right", nowrap: true },
                          { key: "liq_d30", label: "Gap liq D30", align: "right", nowrap: true },
                        ]}
                        rows={almV3StressRows}
                      />

                      <SimpleLineChart
                        title="ALM V3 - Cash journalier"
                        help={"Rôle du bloc : suivre la trajectoire de trésorerie journalière par scénario.\n\nLecture : une baisse rapide ou une divergence forte en stress signale une dépendance aux encaissements ou une pression de décaissements.\n\nLeviers : flux passifs (primes/sinistres/fronting/réassurance), stress de liquidité, poche CASH et actifs rapidement mobilisables."}
                        rows={almSeriesRows}
                        valueKey="total_cash_base_ccy"
                        valueLabel="Cash"
                        collapsible
                        open={almBlocksOpen.chartCash}
                        onToggle={() => toggleAlmBlock("chartCash")}
                      />

                      <SimpleLineChart
                        title="ALM V3 - Gap de duration journalier"
                        help={"Rôle du bloc : visualiser l'écart de duration actif-passif dans le temps.\n\nLecture : gap trop négatif = actifs trop courts vs passif proxy; gap trop positif = actifs trop longs et risque de liquidité/taux selon le contexte.\n\nLeviers : durations des classes d'actifs, poids d'allocation, hypothèses de duration passif (stress ALM/ORSA)." }
                        rows={almSeriesRows}
                        valueKey="duration_gap"
                        valueLabel="Duration gap"
                        collapsible
                        open={almBlocksOpen.chartDurationGap}
                        onToggle={() => toggleAlmBlock("chartDurationGap")}
                      />

                      <SimpleLineChart
                        title="ALM V3 - Besoin de liquidité 30 jours"
                        help={"Rôle du bloc : mesurer la pression de liquidité court terme (30 jours) par scénario.\n\nLecture : comparer le besoin à 30 jours au buffer de liquidité et aux sources mobilisables. Une hausse en stress doit rester finançable.\n\nLeviers : multiplicateurs d'usages (D30), profil de décaissement passif, réassurance/fronting, réserves de trésorerie."}
                        rows={almSeriesRows}
                        valueKey="liquidity_need_30d"
                        valueLabel="Besoin 30j"
                        collapsible
                        open={almBlocksOpen.chartLiquidityNeed}
                        onToggle={() => toggleAlmBlock("chartLiquidityNeed")}
                      />

                      <SimpleLineChart
                        title="ALM V3 - Outflows passifs journaliers"
                        help={"Rôle du bloc : montrer les sorties de cash passif quotidiennes injectées dans l'ALM.\n\nLecture : pics = journées de tension opérationnelle; le niveau moyen aide à calibrer la trésorerie et les poches liquides.\n\nLeviers : hypothèses de flux passifs, calendrier de règlements, réassurance, fronting et paramètres de stress d'outflows."}
                        rows={almSeriesRows}
                        valueKey="total_liability_outflows"
                        valueLabel="Outflows"
                        collapsible
                        open={almBlocksOpen.chartOutflows}
                        onToggle={() => toggleAlmBlock("chartOutflows")}
                      />

                      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                          <BlockTitle
                            title="Drill-down journalier ALM V3"
                            help={"Rôle du bloc : choisir précisément le run et la date à analyser en détail.\n\nLecture : utiliser ce bloc pour expliquer un pic, une alerte ou un écart observé dans les tableaux/graphes de synthèse.\n\nLeviers : changer run (BASE/ADVERSE/SEVERE) et date pour naviguer vers la journée à investiguer."}
                          />
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <button
                              type="button"
                              onClick={() => toggleAlmBlock("drilldown")}
                              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                            >
                              {almBlocksOpen.drilldown ? "Masquer" : "Afficher"}
                            </button>
                            <select className="rounded-md border border-slate-300 px-3 py-2 text-sm" value={almDrillRunId} onChange={(e) => setAlmDrillRunId(e.target.value)}>
                              {(almData?.alm_v3_runs || []).map((r: any) => (
                                <option key={r.id} value={r.id}>
                                  {r.run_code}
                                </option>
                              ))}
                            </select>
                            <input className="rounded-md border border-slate-300 px-3 py-2 text-sm" type="date" value={almDrillDate} onChange={(e) => setAlmDrillDate(e.target.value)} />
                            <button onClick={() => loadAlm()} disabled={almLoading} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 disabled:opacity-50">
                              Charger le détail
                            </button>
                          </div>
                        </div>
                        {almBlocksOpen.drilldown ? (
                          <>
                        {almV3Drilldown?.snapshot ? (
                          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <Kpi label="Date" value={String(almV3Drilldown.selected_date)} sub={`Run ${almV3Drilldown.selected_run_id}`} help={"Rôle du bloc : rappelle la date et le run du snapshot affiché ci-dessous.\n\nLecture : vérifier cette référence avant d'interpréter les ladders et snapshots détaillés.\n\nLeviers : changer la date ou le run dans le bloc de sélection."} />
                            <Kpi label="Actifs MV" value={fmtEur(almV3Drilldown.snapshot.total_assets_mv)} sub={`Cash ${fmtEur(almV3Drilldown.snapshot.total_cash_base_ccy)}`} help={"Rôle du bloc : photographie du stock d'actifs et de trésorerie au jour sélectionné.\n\nLecture : comparer le cash au total des actifs pour juger la part immédiatement mobilisable.\n\nLeviers : allocation d'actifs, poche CASH, flux entrants/sortants et stress de valorisation."} />
                            <Kpi label="Gap duration" value={fmtNum(almV3Drilldown.snapshot.duration_gap, 3)} sub={`Actifs ${fmtNum(almV3Drilldown.snapshot.duration_assets_weighted, 3)} / Passif ${fmtNum(almV3Drilldown.snapshot.duration_liabilities_proxy, 3)}`} help={"Rôle du bloc : mesure le désalignement de duration actif-passif ce jour-là.\n\nLecture : proche de 0 = meilleur adossement (proxy). Très négatif = actifs trop courts; très positif = actifs trop longs.\n\nLeviers : durations et poids d'actifs, stress de duration, hypothèse de passif proxy."} />
                            <Kpi label="Besoin liq 30j" value={fmtEur(almV3Drilldown.snapshot.liquidity_need_30d)} sub={`Buffer ${fmtEur(almV3Drilldown.snapshot.liquidity_buffer_available)}`} help={"Rôle du bloc : compare le besoin de cash à 30 jours au buffer disponible.\n\nLecture : si le besoin dépasse durablement le buffer, la structure de liquidité est tendue.\n\nLeviers : sources de liquidité (cash/actifs courts), usages stressés, calendrier de décaissements et réassurance/fronting."} />
                          </div>
                        ) : (
                          <div className="mt-3 text-sm text-slate-500">Aucun snapshot disponible pour cette sélection.</div>
                        )}
                        <div className="mt-4 grid gap-4 xl:grid-cols-2">
                          <StackedLadderChart
                            title="Graphique empilé - Ladder de liquidité (sources vs usages)"
                            help={"Rôle du bloc : visualisation rapide de la pression de liquidité par horizon (D1/D7/D30).\n\nLecture : comparer la hauteur Sources vs Usages; un horizon où Usages > Sources appelle une analyse détaillée du ladder.\n\nLeviers : stress de sources/usages par horizon, allocation plus liquide, calendrier de flux."}
                            rows={(almV3Drilldown?.liquidity_ladder || []).map((r: any) => ({
                              label: String(r.horizon_code || `H${r.horizon_days}`),
                              sources: n(r.liquidity_sources_amount),
                              uses: n(r.liquidity_uses_amount),
                            }))}
                          />
                        </div>
                        <div className="mt-4 grid gap-4 xl:grid-cols-2">
                          <SimpleTable
                            title="Ladder de liquidité (date sélectionnée)"
                            help={"Rôle du bloc : détail chiffré du ladder de liquidité.\n\nLecture : Gap = sources - usages; Gap cumulé montre si la tension s'aggrave en allant de D1 vers D30.\n\nLeviers : mêmes leviers que le graphique de liquidité, avec lecture plus fine pour calibrer les seuils."}
                            collapsible
                            open={almBlocksOpen.drillLiqLadder}
                            onToggle={() => toggleAlmBlock("drillLiqLadder")}
                            columns={[
                              { key: "horizon", label: "Horizon" },
                              { key: "sources", label: "Sources", align: "right" },
                              { key: "uses", label: "Usages", align: "right" },
                              { key: "gap", label: "Gap", align: "right" },
                              { key: "cum_gap", label: "Gap cumulé", align: "right" },
                            ]}
                            rows={almDrillLiquidityRows}
                          />
                          <SimpleTable
                            title="Ladder de duration (date sélectionnée)"
                            help={"Rôle du bloc : détail de l'adossement de duration par tranche (bucket).\n\nLecture : un gap négatif sur les buckets longs signale souvent un manque d'actifs longs pour couvrir un passif plus long.\n\nLeviers : réallocation par buckets, durations des classes d'actifs et hypothèses de passif proxy."}
                            collapsible
                            open={almBlocksOpen.drillDurationLadder}
                            onToggle={() => toggleAlmBlock("drillDurationLadder")}
                            columns={[
                              { key: "bucket", label: "Bucket" },
                              { key: "assets", label: "Actifs", align: "right" },
                              { key: "liabs", label: "Passifs proxy", align: "right" },
                              { key: "gap", label: "Gap", align: "right" },
                              { key: "cum_gap", label: "Gap cumulé", align: "right" },
                            ]}
                            rows={almDrillDurationRows}
                          />
                        </div>
                        <div className="mt-4 grid gap-4 xl:grid-cols-2">
                          <SimpleTable
                            title="Snapshot par classe d’actifs (date sélectionnée)"
                            help={"Rôle du bloc : décomposer le stock d'actifs du jour par classe pour comprendre d'où viennent duration et liquidité.\n\nLecture : regarder les poids et durations pour identifier les classes qui tirent le profil ALM; comparer au besoin de liquidité.\n\nLeviers : allocation d'actifs, durations/haircuts et activation des classes dans les stress."}
                            collapsible
                            open={almBlocksOpen.drillAssetSnapshot}
                            onToggle={() => toggleAlmBlock("drillAssetSnapshot")}
                            columns={[
                              { key: "asset", label: "Classe d’actifs" },
                              { key: "mv", label: "MV", align: "right" },
                              { key: "bv", label: "BV", align: "right" },
                              { key: "share", label: "Poids", align: "right" },
                              { key: "duration", label: "Duration", align: "right" },
                              { key: "liq_days", label: "Liq (j)", align: "right" },
                            ]}
                            rows={almDrillAssetRows}
                          />
                          <SimpleTable
                            title="Snapshot par strate ALM (date sélectionnée)"
                            help={"Rôle du bloc : montrer la contribution de chaque strate ALM à la liquidité et au buffer.\n\nLecture : repérer quelle strate porte le cash, les décaissements ou les tensions. Le buffer aide à identifier où se concentre la capacité de résistance.\n\nLeviers : mapping des comptes/flux vers les strates, allocation par strate, politique de cash et stress de liquidité."}
                            collapsible
                            open={almBlocksOpen.drillStrataSnapshot}
                            onToggle={() => toggleAlmBlock("drillStrataSnapshot")}
                            columns={[
                              { key: "strata", label: "Strate", nowrap: true },
                              { key: "assets", label: "Actifs", align: "right", nowrap: true },
                              { key: "cash", label: "Cash", align: "right", nowrap: true },
                              { key: "inflows", label: "Inflows", align: "right", nowrap: true },
                              { key: "outflows", label: "Outflows", align: "right", nowrap: true },
                              { key: "net", label: "Net", align: "right", nowrap: true },
                              { key: "buffer", label: "Buffer", align: "right", nowrap: true },
                            ]}
                            rows={almDrillStrataRows}
                          />
                        </div>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {section === "finance" ? (
              <div className="space-y-4">
                {almLoading ? <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">Chargement ALM / Finance…</div> : null}
                {almError ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{almError}</div> : null}
                {!almLoading && !almError ? (
                  <>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <Kpi label="Date sélectionnée" value={fmtDateIsoToFr(almV3Finance?.selected_date || "—")} sub={String(almV3Finance?.selected_date || "—")} help={"Rôle du bloc : date de snapshot des valorisations affichées dans la section Finance ALM.\n\nLecture : toutes les lignes du tableau positions utilisent cette date, sauf l'historique qui montre la série temporelle de la position sélectionnée.\n\nLeviers : filtre « Date de valorisation »."} />
                      <Kpi label="Positions" value={fmtNum(almV3Finance?.kpis?.positions_count, 0)} sub={`${fmtNum(almV3Finance?.kpis?.asset_classes_count, 0)} classes | ${fmtNum(almV3Finance?.kpis?.counterparties_count, 0)} contreparties`} help={"Rôle du bloc : mesurer le périmètre effectivement analysé après filtres.\n\nLecture : une forte baisse du nombre de positions signifie souvent qu'un filtre isole une poche spécifique (utile pour diagnostic de concentration).\n\nLeviers : filtres classe/strate/contrepartie/date."} />
                      <Kpi label="Valeur de marché (MV)" value={fmtEur(almV3Finance?.kpis?.market_value_total)} sub={`BV ${fmtEur(almV3Finance?.kpis?.book_value_total)}`} help={"Rôle du bloc : comparer valeur de marché (MV) et valeur comptable (BV) du périmètre filtré.\n\nLecture : l'écart MV vs BV donne un signal de plus/moins-value latente globale.\n\nLeviers : composition du portefeuille, prix de marché simulés, chocs ALM par classe d'actifs."} />
                      <Kpi label="Duration modifiée pondérée" value={`${fmtNum(almV3Finance?.kpis?.weighted_modified_duration_years, 3)} ans`} sub={`P&L latent ${fmtEur(almV3Finance?.kpis?.unrealized_pnl_total)}`} help={"Rôle du bloc : résumer la sensibilité taux du portefeuille filtré et son résultat latent.\n\nLecture : duration plus élevée = sensibilité plus forte aux variations de taux; lire en parallèle avec la composition par classes et la MV.\n\nLeviers : allocation par actifs, durations des instruments, chocs de marché ALM V3."} />
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                        <BlockTitle
                          title="Finance ALM / Actifs (V1)"
                          help={"Rôle du bloc : point d'entrée pour analyser les actifs ALM position par position.\n\nLecture : utiliser les filtres pour isoler une classe, une strate ou une contrepartie, puis cliquer une ligne pour ouvrir le détail.\n\nLeviers : filtres (date, classe, strate, contrepartie) et, indirectement, seed/inventaire d'actifs ALM V3."}
                        />
                        <button
                          onClick={() => loadAlm()}
                          disabled={almLoading}
                          className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 disabled:opacity-50"
                        >
                          Rafraîchir
                        </button>
                      </div>
                      <div className="mt-3 grid gap-2 md:grid-cols-5">
                        <div>
                          <div className="mb-1 text-xs font-medium text-slate-600">Date de valorisation</div>
                          <select className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm" value={almFinanceDate} onChange={(e) => setAlmFinanceDate(e.target.value)}>
                            <option value="">Auto</option>
                            {(almV3Finance?.dates || []).map((d: string) => (
                              <option key={d} value={d}>{fmtDateIsoToFr(d)} ({d})</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-medium text-slate-600">Classe d’actifs</div>
                          <select className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm" value={almFinanceAssetCode} onChange={(e) => setAlmFinanceAssetCode(e.target.value)}>
                            <option value="">Toutes</option>
                            {(almV3Finance?.options?.asset_classes || []).map((x: any) => (
                              <option key={x.asset_code} value={x.asset_code}>{x.asset_code} - {x.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-medium text-slate-600">Strate ALM</div>
                          <select className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm" value={almFinanceStrataCode} onChange={(e) => setAlmFinanceStrataCode(e.target.value)}>
                            <option value="">Toutes</option>
                            {(almV3Finance?.options?.strata || []).map((x: any) => (
                              <option key={x.strata_code} value={x.strata_code}>{x.strata_code} - {x.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <div className="mb-1 text-xs font-medium text-slate-600">Contrepartie</div>
                          <select className="w-full rounded-md border border-slate-300 px-2 py-2 text-sm" value={almFinanceCounterpartyId} onChange={(e) => setAlmFinanceCounterpartyId(e.target.value)}>
                            <option value="">Toutes</option>
                            {(almV3Finance?.options?.counterparties || []).map((x: any) => (
                              <option key={x.id} value={x.id}>{x.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-end gap-2">
                          <button
                            onClick={() => loadAlm()}
                            className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                          >
                            Appliquer
                          </button>
                          <button
                            onClick={resetAlmFinanceFilters}
                            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700"
                          >
                            Réinitialiser
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-0 shadow-sm">
                      <div className="border-b border-slate-200 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="rounded-md bg-slate-200 px-2 py-1 text-sm font-bold text-slate-900">Positions ALM (snapshot date)</div>
                            <InfoHint text={"Rôle du bloc : liste des positions au snapshot sélectionné pour analyser la structure du portefeuille actif.\n\nLecture : comparer MV, duration, YTM et contreparties pour repérer les positions dominantes ou sensibles. Cliquer une ligne pour ouvrir le détail.\n\nLeviers : filtres de la vue Finance ALM, seed/inventaire d'actifs et chocs de valorisation.\n\nAbrégés : MV = valeur de marché, BV = valeur comptable, P&L latent = résultat latent non réalisé, Duration = duration modifiée, YTM = rendement actuariel à maturité."} />
                          </div>
                          <button
                            type="button"
                            onClick={() => setAlmFinancePositionsOpen((v) => !v)}
                            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700"
                          >
                            {almFinancePositionsOpen ? "Masquer" : "Afficher"}
                          </button>
                        </div>
                      </div>
                      {almFinancePositionsOpen ? (
                      <div className="overflow-auto">
                        <table className="min-w-[1400px] w-full text-sm">
                          <thead className="bg-slate-50 text-black">
                            <tr>
                              <th className="px-3 py-2 text-left whitespace-nowrap min-w-[260px]">
                                <HeaderHoverHelp
                                  label="Position / Instrument"
                                  help={"Position / Instrument = ligne d’inventaire ALM + instrument financier associé.\n\nReprésente l’objet investi (titre/placement) et son identifiant de position dans le portefeuille actif."}
                                />
                              </th>
                              <th className="px-3 py-2 text-left whitespace-nowrap min-w-[110px]">
                                <HeaderHoverHelp label="Classe" help={defaultHeaderHoverHelpForColumn("asset", "Classe")} />
                              </th>
                              <th className="px-3 py-2 text-left whitespace-nowrap min-w-[140px]">
                                <HeaderHoverHelp label="Strate" help={defaultHeaderHoverHelpForColumn("strata", "Strate")} />
                              </th>
                              <th className="px-3 py-2 text-left whitespace-nowrap min-w-[220px]">
                                <HeaderHoverHelp label="Contrepartie" help={defaultHeaderHoverHelpForColumn("insurer", "Contrepartie")} />
                              </th>
                              <th className="px-3 py-2 text-right whitespace-nowrap min-w-[130px]">
                                <HeaderHoverHelp label="MV" help={defaultHeaderHoverHelpForColumn("mv", "MV")} align="right" />
                              </th>
                              <th className="px-3 py-2 text-right whitespace-nowrap min-w-[130px]">
                                <HeaderHoverHelp label="BV" help={defaultHeaderHoverHelpForColumn("bv", "BV")} align="right" />
                              </th>
                              <th className="px-3 py-2 text-right whitespace-nowrap min-w-[140px]">
                                <HeaderHoverHelp label="P&L latent" help={defaultHeaderHoverHelpForColumn("pnl", "P&L latent")} align="right" />
                              </th>
                              <th className="px-3 py-2 text-right whitespace-nowrap min-w-[100px]">
                                <HeaderHoverHelp label="Duration" help={defaultHeaderHoverHelpForColumn("duration", "Duration")} align="right" />
                              </th>
                              <th className="px-3 py-2 text-right whitespace-nowrap min-w-[90px]">
                                <HeaderHoverHelp label="YTM" help={defaultHeaderHoverHelpForColumn("ytm", "YTM")} align="right" />
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {almFinancePositions.length ? (
                              almFinancePositions.map((r: any) => (
                                <tr
                                  key={r.position_id}
                                  className={`border-t border-slate-100 cursor-pointer hover:bg-slate-50 ${String(almV3Finance?.selected_position_id || "") === String(r.position_id) ? "bg-slate-50" : ""}`}
                                  onClick={() => {
                                    setAlmFinancePositionId(String(r.position_id));
                                  }}
                                >
                                  <td className="px-3 py-2 text-black min-w-[260px]">
                                    <div className="font-medium text-black">{r.instrument_name}</div>
                                    <div className="text-xs text-black whitespace-nowrap">{r.instrument_code} | Pos {r.position_id}</div>
                                  </td>
                                  <td className="px-3 py-2 text-black whitespace-nowrap">{r.asset_code}</td>
                                  <td className="px-3 py-2 text-black whitespace-nowrap">{r.strata_label || r.strata_code || "—"}</td>
                                  <td className="px-3 py-2 text-black min-w-[220px]">{r.counterparty_name || "—"}</td>
                                  <td className="px-3 py-2 text-right text-black whitespace-nowrap tabular-nums">{fmtEur(r.market_value_amount)}</td>
                                  <td className="px-3 py-2 text-right text-black whitespace-nowrap tabular-nums">{fmtEur(r.book_value_amount)}</td>
                                  <td className="px-3 py-2 text-right text-black whitespace-nowrap tabular-nums">{fmtEur(r.unrealized_pnl_amount)}</td>
                                  <td className="px-3 py-2 text-right text-black whitespace-nowrap tabular-nums">{fmtNum(r.modified_duration_years, 3)}</td>
                                  <td className="px-3 py-2 text-right text-black whitespace-nowrap tabular-nums">{fmtNum(r.ytm_pct, 3)} %</td>
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td colSpan={9} className="px-3 py-6 text-center text-black">
                                  <div>Aucune position pour ces filtres.</div>
                                  <div className="mt-1 text-xs text-black">
                                    Date={almFinanceDate || almV3Finance?.selected_date || "auto"} | Classe={almFinanceAssetCode || "toutes"} | Strate={almFinanceStrataCode || "toutes"} | Contrepartie={almFinanceCounterpartyId || "toutes"}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                      ) : null}
                    </div>

                    <StackedAreaTimeSeriesChart
                      title="Évolution globale des positions ALM (MV empilée)"
                      help={"Rôle du bloc : visualiser en une vue l'évolution du portefeuille actif et la contribution de chaque position dans le temps.\n\nLecture : la hauteur totale = MV globale; l'épaisseur de chaque couche = poids relatif de la position. Chercher les changements de composition et les ruptures.\n\nLeviers : sélection des filtres, valorisations simulées (marché), achats/ventes si ajoutés plus tard dans l'inventaire ALM."}
                      rows={almFinancePortfolioStackedRows}
                      collapsible
                      open={almFinancePortfolioOpen}
                      onToggle={() => setAlmFinancePortfolioOpen((v) => !v)}
                    />

                    {almFinancePositionDetail?.position ? (
                      <>
                        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                          <div className="flex items-center justify-between gap-2">
                            <BlockTitle
                              title="Détail de la position sélectionnée / Lots de la position"
                              help={"Rôle du bloc : fiche descriptive de la position et détail des lots composant la position (dates, quantités, nominal, coût).\n\nLecture : utile pour comprendre la nature du risque, la structure des lots et expliquer BV/MV/P&L.\n\nLeviers : inventaire d'actifs ALM (instrument/position/lots) et référentiels (contrepartie, classe, rating)."}
                            />
                            <button
                              type="button"
                              onClick={() => setAlmFinancePositionBlocksOpen((v) => !v)}
                              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700"
                            >
                              {almFinancePositionBlocksOpen ? "Masquer" : "Afficher"}
                            </button>
                          </div>
                          {almFinancePositionBlocksOpen ? (
                            <div className="mt-3 grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
                              <SimpleTable
                                title="Détail de la position sélectionnée"
                                help={"Rôle du bloc : fiche descriptive de la position sélectionnée (instrument, classe, contrepartie, dates, statut).\n\nLecture : utile pour comprendre la nature du risque avant de lire les lots et l'historique de valorisation.\n\nLeviers : inventaire d'actifs ALM (instrument/position) et référentiels (contrepartie, classe, rating).\n\nAbrégés : ISIN = identifiant international du titre, ALM = pilotage actif-passif."}
                                columns={[{ key: "k", label: "Champ" }, { key: "v", label: "Valeur" }]}
                                rows={[
                                  ["Position", almFinancePositionDetail.position.position_id],
                                  ["Instrument", almFinancePositionDetail.position.instrument_name],
                                  ["Code instrument", almFinancePositionDetail.position.instrument_code],
                                  ["Type instrument", almFinancePositionDetail.position.instrument_type],
                                  ["Classe d’actifs", `${almFinancePositionDetail.position.asset_code} - ${almFinancePositionDetail.position.asset_label}`],
                                  ["Strate ALM", almFinancePositionDetail.position.strata_label || almFinancePositionDetail.position.strata_code || "—"],
                                  ["Contrepartie", almFinancePositionDetail.position.counterparty_name || "—"],
                                  ["Rating", almFinancePositionDetail.position.rating_value || "—"],
                                  ["Devise", almFinancePositionDetail.position.currency || "EUR"],
                                  ["ISIN", almFinancePositionDetail.position.isin || "—"],
                                  ["Ticker", almFinancePositionDetail.position.ticker || "—"],
                                  ["Coupon", almFinancePositionDetail.position.coupon_rate_pct == null ? "—" : `${fmtNum(almFinancePositionDetail.position.coupon_rate_pct, 4)} %`],
                                  ["Maturité", almFinancePositionDetail.position.maturity_date ? String(almFinancePositionDetail.position.maturity_date).slice(0, 10) : "—"],
                                  ["Statut", almFinancePositionDetail.position.position_status || "—"],
                                  ["Ouverte le", almFinancePositionDetail.position.opened_on ? String(almFinancePositionDetail.position.opened_on).slice(0, 10) : "—"],
                                  ["Clôturée le", almFinancePositionDetail.position.closed_on ? String(almFinancePositionDetail.position.closed_on).slice(0, 10) : "—"],
                                ].map(([k, v]) => ({ k, v }))}
                              />
                              <SimpleTable
                                title="Lots de la position"
                                help={"Rôle du bloc : détail des lots composant la position (dates, quantités, nominal, coût).\n\nLecture : permet d'expliquer la BV, les plus/moins-values latentes et l'ancienneté de détention.\n\nLeviers : inventaire des lots (acquisitions/cessions), quantité, coût et nominal de chaque lot."}
                                columns={[
                                  { key: "lot", label: "Lot", nowrap: true },
                                  { key: "trade", label: "Trade date", nowrap: true },
                                  { key: "settle", label: "Settlement", nowrap: true },
                                  { key: "qty", label: "Quantité", align: "right", nowrap: true },
                                  {
                                    key: "nominal",
                                    label: "Nominal",
                                    align: "right",
                                    nowrap: true,
                                    labelHelp:
                                      "Nominal = montant facial / principal du lot (face value). Ce n’est ni la BV (Book Value, valeur comptable), ni la MV (Market Value, valeur de marché).",
                                  },
                                  { key: "cost", label: "Coût unitaire", align: "right", nowrap: true },
                                ]}
                                rows={(almFinancePositionDetail.lots || []).map((l: any) => ({
                                  lot: l.lot_code || `Lot ${l.id}`,
                                  trade: String(l.trade_date || "").slice(0, 10),
                                  settle: l.settlement_date ? String(l.settlement_date).slice(0, 10) : "—",
                                  qty: fmtNum(l.quantity, 4),
                                  nominal: l.nominal_amount == null ? "—" : fmtEur(l.nominal_amount),
                                  cost: l.unit_cost == null ? "—" : fmtNum(l.unit_cost, 6),
                                }))}
                              />
                            </div>
                          ) : null}
                        </div>

                        <SimpleLineChart
                          title={`Historique de valorisation - MV | ${almFinanceInstrumentLabel}`}
                          help={"Rôle du bloc : suivre la trajectoire de valeur de marché de la position sélectionnée.\n\nLecture : repérer tendance, volatilité et ruptures de niveau; comparer ensuite au P&L latent et à la duration.\n\nLeviers : prix de marché simulés, chocs ALM par classe d'actifs, composition des lots."}
                          rows={almFinanceChartRows}
                          valueKey="market_value_amount"
                          valueLabel="MV"
                          helpAlign="right"
                          collapsible
                          open={almFinanceHistoryMvOpen}
                          onToggle={() => setAlmFinanceHistoryMvOpen((v) => !v)}
                        />
                        <SimpleLineChart
                          title={`Historique de valorisation - Duration modifiée | ${almFinanceInstrumentLabel}`}
                          help={"Rôle du bloc : suivre la sensibilité taux de la position dans le temps.\n\nLecture : une duration qui monte augmente la sensibilité aux taux; utile pour expliquer un gap de duration ALM.\n\nLeviers : paramètres de valorisation/duration, maturité de l'instrument, chocs ALM par classe d'actifs."}
                          rows={almFinanceChartRows}
                          valueKey="modified_duration_years"
                          valueLabel="Duration"
                          yTickDecimals={2}
                          helpAlign="right"
                          collapsible
                          open={almFinanceHistoryDurationOpen}
                          onToggle={() => setAlmFinanceHistoryDurationOpen((v) => !v)}
                        />
                        <div className="rounded-xl border border-slate-200 bg-white p-0 shadow-sm">
                          <div className="border-b border-slate-200 px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <div className="rounded-md bg-slate-200 px-2 py-1 text-sm font-bold text-slate-900">{`Historique de valorisation (table) | ${almFinanceInstrumentLabel}`}</div>
                                <InfoHint align="right" text={"Rôle du bloc : table de détail pour auditer les chiffres des graphes (MV, BV, P&L, duration, YTM, prix) jour par jour.\n\nLecture : les lignes sont regroupées par mois (chevrons). Ouvrir un mois pour vérifier les valeurs exactes affichées sur les courbes.\n\nLeviers : mêmes leviers que les graphes de valorisation/duration (marché, chocs, paramètres instrument).\n\nAbrégés : MV = valeur de marché, BV = valeur comptable, P&L = résultat latent, YTM = rendement actuariel à maturité."} />
                              </div>
                              <button
                                type="button"
                                onClick={() => setAlmFinanceHistoryTableOpen((v) => !v)}
                                className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700"
                              >
                                {almFinanceHistoryTableOpen ? "Masquer" : "Afficher"}
                              </button>
                            </div>
                          </div>
                          {almFinanceHistoryTableOpen ? (
                          <div className="overflow-auto">
                            <table className="min-w-full text-sm">
                              <thead className="bg-slate-50 text-slate-600">
                                <tr>
                                  <th className="px-3 py-2 text-left font-bold whitespace-nowrap">
                                    <HeaderHoverHelp label="Date" help={"Date = jour de valorisation du snapshot.\n\nReprésente la date à laquelle les mesures (MV, BV, P&L, duration, YTM, prix) ont été calculées pour cette position."} />
                                  </th>
                                  <th className="px-3 py-2 text-right font-bold whitespace-nowrap">
                                    <HeaderHoverHelp label="MV" help={"MV (Market Value) = valeur de marché de la position à la date.\n\nReprésente la valeur estimée de vente/valorisation selon le prix de marché (simulé) du jour."} align="right" />
                                  </th>
                                  <th className="px-3 py-2 text-right font-bold whitespace-nowrap">
                                    <HeaderHoverHelp label="BV" help={"BV (Book Value) = valeur comptable de la position à la date.\n\nReprésente la valeur comptable retenue, utile pour comparer à la MV."} align="right" />
                                  </th>
                                  <th className="px-3 py-2 text-right font-bold whitespace-nowrap">
                                    <HeaderHoverHelp label="P&L latent" help={"P&L latent = résultat latent non réalisé.\n\nReprésente l'écart entre MV et BV à la date de valorisation."} align="right" />
                                  </th>
                                  <th className="px-3 py-2 text-right font-bold whitespace-nowrap">
                                    <HeaderHoverHelp label="Duration" help={"Duration = duration modifiée de la position.\n\nReprésente la sensibilité de la position aux variations de taux."} align="right" />
                                  </th>
                                  <th className="px-3 py-2 text-right font-bold whitespace-nowrap">
                                    <HeaderHoverHelp label="YTM" help={"YTM (Yield To Maturity) = rendement actuariel à maturité.\n\nReprésente le rendement annualisé implicite de l'instrument à la date."} align="right" />
                                  </th>
                                  <th className="px-3 py-2 text-right font-bold whitespace-nowrap">
                                    <HeaderHoverHelp label="Prix" help={"Prix = prix unitaire de valorisation utilisé au snapshot.\n\nReprésente le prix de marché (ou proxy) utilisé pour calculer la MV."} align="right" />
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {almFinanceHistoryMonthGroups.length ? (
                                  almFinanceHistoryMonthGroups.map((g) => {
                                    const [yy, mm] = g.monthKey.split("-");
                                    const monthName = [
                                      "Janvier","Fevrier","Mars","Avril","Mai","Juin","Juillet","Aout","Septembre","Octobre","Novembre","Decembre",
                                    ][Math.max(0, Math.min(11, Number(mm || 1) - 1))];
                                    const open = !!almFinanceExpandedMonths[g.monthKey];
                                    return (
                                      <Fragment key={g.monthKey}>
                                        <tr className="border-t border-slate-200 bg-slate-100">
                                          <td colSpan={7} className="px-3 py-2">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setAlmFinanceExpandedMonths((prev) => ({ ...prev, [g.monthKey]: !prev[g.monthKey] }))
                                              }
                                              className="inline-flex items-center gap-2 text-sm font-medium text-slate-800 hover:text-slate-900"
                                            >
                                              <span className="font-mono text-xs">{open ? "▼" : "▶"}</span>
                                              <span>{monthName} {yy}</span>
                                              <span className="text-xs font-normal text-slate-500">({fmtNum(g.rows.length, 0)} lignes)</span>
                                            </button>
                                          </td>
                                        </tr>
                                        {open
                                          ? g.rows.map((r: any, idx: number) => (
                                              <tr key={`${g.monthKey}-${idx}-${r.date}`} className="border-t border-slate-100">
                                                <td className="px-3 py-2 whitespace-nowrap text-slate-800">{r.date}</td>
                                                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-slate-800">{r.mv}</td>
                                                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-slate-800">{r.bv}</td>
                                                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-slate-800">{r.pnl}</td>
                                                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-slate-800">{r.dur}</td>
                                                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-slate-800">{r.ytm}</td>
                                                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums text-slate-800">{r.px}</td>
                                              </tr>
                                            ))
                                          : null}
                                      </Fragment>
                                    );
                                  })
                                ) : (
                                  <tr>
                                    <td colSpan={7} className="px-3 py-6 text-center text-slate-500">
                                      Aucun historique de valorisation disponible.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}

            {section === "overview" ? (
              <details className="rounded-xl border border-slate-200 bg-white shadow-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:content-none">
                  <div className="rounded-md bg-slate-200 px-2 py-1 text-sm font-bold text-slate-900">Paramétrages des stress ORSA (ADVERSE / SEVERE)</div>
                  <span className="text-xs font-medium text-slate-500">Afficher / Masquer</span>
                </summary>
                <div className="border-t border-slate-200 p-4">
                  <div className="mb-2">
                    <div className="flex items-center gap-2">
                      <div className="rounded-md bg-slate-200 px-2 py-1 text-sm font-bold text-slate-900">Paramétrages des stress ORSA (ADVERSE / SEVERE)</div>
                      <InfoHint text={"Rôle du bloc : afficher et documenter les paramètres de stress ORSA enregistrés (source de vérité des scénarios).\n\nLecture : vérifier que la hiérarchie des stress est logique (SEVERE plus dur qu'ADVERSE) et que les branches capital-intensives sont bien traitées.\n\nLeviers : modifier les paramètres ORSA (simulation_parameters), puis regénérer les runs ORSA et recalculs dérivés (S2 / ALM)."} />
                      <InfoHint
                        icon="?"
                        heading="Mode d'emploi - Paramétrages ORSA"
                        text={
                          "Point clé avant lecture : ce bloc affiche des paramètres d'entrée (hypothèses de stress), pas les résultats calculés. Les résultats ORSA (BASE / ADVERSE / SEVERE) sont présentés plus haut et reflètent l'effet final après calculs S2, réassurance/fronting et interactions de branches.\n\nRôle de ce mode d'emploi : vous aider à savoir quel paramètre modifier selon l'effet recherché sur les scénarios ORSA.\n\nOù modifier les paramètres : dans cette page (bloc Paramétrages des stress ORSA), les valeurs affichées sont la référence. Les modifications sont enregistrées via l'API ALM/actuariat puis stockées dans la table simulation_parameters (clés orsa_stress_adverse / orsa_stress_severe). Si besoin d'intervention technique, les scripts de génération ORSA relisent ces paramètres avant recalcul.\n\nComment l'utiliser : commencez par comparer BASE / ADVERSE / SEVERE dans les tableaux ORSA et Overview, puis modifiez un seul levier à la fois avant de regénérer les runs.\n\nSi vous voulez dégrader/améliorer le volume de primes : ajustez GWP (gwp_mult).\n\nSi vous voulez durcir/assouplir la sinistralité globale : ajustez Claims incurred (incurred_mult).\n\nSi vous voulez tester un choc catastrophe Property : ajustez CAT Property (cat_mult), puis contrôlez l'onglet CAT et l'impact SCR / solvabilité.\n\nSi vous voulez simuler une variation de capital disponible : ajustez Own funds (own_funds_mult). Cela agit directement sur le ratio de solvabilité.\n\nSi vous voulez cibler une branche (Motor, PI, Medical, Property) : utilisez les stress spécifiques par branche. C'est le bon levier pour tester une concentration de risque plutôt qu'un choc global.\n\nMéthode recommandée : 1) modifier un paramètre, 2) relancer les runs ORSA, 3) relire ORSA -> S2 -> ALM, 4) documenter l'effet observé.\n\nPoint de vigilance : gardez une hiérarchie cohérente entre ADVERSE et SEVERE (SEVERE doit rester plus contraignant que ADVERSE sur les leviers principaux)."
                        }
                      />
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Le scénario BASE correspond au portefeuille de référence et n’est pas paramétré ici.
                    </div>
                  </div>
                  <div className="grid gap-3 lg:grid-cols-2">
                  {stressParamCards.map((p: any) => {
                    const s = p.summary;
                    return (
                      <div key={`${p.scenario_id}-${p.parameter_key}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                            <span>{stressCodeLabel(p.parameter_key)}</span>
                            <InfoHint text={"Rôle du bloc : expliquer ce que pilote ce profil de stress ORSA (Adverse ou Severe).\n\nLecture : ce profil impacte primes, sinistres, CAT, contrepartie et fonds propres; il faut le relier aux résultats ORSA observés plus haut.\n\nLeviers : ajuster ce profil de stress, puis relancer les runs ORSA pour mesurer l'effet."} />
                          </div>
                          <div className="text-[11px] text-slate-500">{p.parameter_key}</div>
                        </div>
                        {s ? (
                          <>
                            <div className="mt-2 grid gap-2 sm:grid-cols-2">
                              <div className="rounded-md bg-white p-2 text-xs text-slate-700">GWP: x{fmtNum(s.gwp_mult, 3)}</div>
                              <div className="rounded-md bg-white p-2 text-xs text-slate-700">Claims incurred: x{fmtNum(s.incurred_mult, 3)}</div>
                              <div className="rounded-md bg-white p-2 text-xs text-slate-700">CAT Property: x{fmtNum(s.cat_mult, 3)}</div>
                              <div className="rounded-md bg-white p-2 text-xs text-slate-700">Own funds: x{fmtNum(s.own_funds_mult, 3)}</div>
                            </div>
                            <div className="mt-3">
                              <div className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-slate-500">Stress spécifiques par branche</div>
                              <BranchStressSummary branches={s.branches} />
                            </div>
                            <details className="mt-3 rounded-md border border-slate-200 bg-white p-2">
                              <summary className="cursor-pointer text-xs font-medium text-slate-700">Afficher le JSON brut</summary>
                              <pre className="mt-2 overflow-auto whitespace-pre-wrap text-[11px] text-slate-700">
                                {JSON.stringify(p.value_json, null, 2)}
                              </pre>
                            </details>
                          </>
                        ) : (
                          <div className="mt-2 text-xs text-slate-500">Format de paramètre non reconnu.</div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </div>
              </details>
            ) : null}

            {section !== "overview" && selectedRecentRunEngine ? (
              <EngineDetailRunModal detail={selectedRecentRunEngine} onClose={() => setSelectedRecentRunEngine(null)} />
            ) : null}
          </>
        ) : null}
      </div>
    </RequireAuth>
  );
}

export default function ActuariatPage() {
  return (
    <Suspense fallback={<div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-600">Chargement…</div>}>
      <ActuariatPageContent />
    </Suspense>
  );
}
