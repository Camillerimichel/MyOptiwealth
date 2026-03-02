"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Fragment, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";
import {
  Branch,
  BranchPolicy,
  InsuranceProgram,
  apiRequest,
  fetchCaptiveBranches,
  fetchCaptivePolicies,
  fetchCaptivePrograms,
} from "@/lib/api";
import {
  CAPITAL_INTENSITY_OPTIONS,
  CAPITAL_METHOD_OPTIONS,
  ELIGIBILITY_MODE_OPTIONS,
  REINSURANCE_TYPE_OPTIONS,
  RESTRICTION_LEVEL_OPTIONS,
  VOLATILITY_LEVEL_OPTIONS,
  labelForCode,
} from "@/lib/codeLabels";

type Column = { key: string; label: string };

type FieldOption = { value: string | number; label: string };

type Field = {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "date" | "textarea";
  options?: FieldOption[];
  required?: boolean;
  min?: number;
  max?: number;
};

type CrudSectionProps = {
  title: string;
  description?: string;
  rows: any[];
  columns: Column[];
  rightAlignColumns?: string[];
  centerAlignColumns?: string[];
  endpoint: string;
  idKey?: string;
  createTemplate: Record<string, any>;
  editableKeys?: string[];
  deleteWithBody?: boolean;
  deleteBodyKeys?: string[];
  fields: Field[];
  filterFields?: Field[];
  exportUrl?: string;
  serverMode?: boolean;
  validateExtra?: (data: Record<string, any>) => string | null;
  onChanged: () => void;
  valueResolvers?: Record<string, (row: any) => ReactNode>;
  groupByKey?: string;
  groupByLabel?: string;
};

const SECTION_DEFAULT = "branches";

const sectionMeta = {
  branches: {
    title: "Branches",
    description: "Référentiel réglementaire Solvabilité II.",
  },
  categories: {
    title: "Catégories",
    description: "Catégories métier (fintech).",
  },
  "branch-categories": {
    title: "Branches ↔ Catégories",
    description: "Mapping N–N entre branches et catégories.",
  },
  policies: {
    title: "Politiques d’éligibilité",
    description: "Autorisation, restrictions et validations par branche.",
  },
  "risk-parameters": {
    title: "Paramètres de risque",
    description: "Limites, volatilité, capital.",
  },
  reinsurance: {
    title: "Réassurance & fronting",
    description: "Règles par branche.",
  },
  programs: {
    title: "Programmes",
    description: "Programmes captive multi-branches.",
  },
  "program-branches": {
    title: "Programmes ↔ Branches",
    description: "Mapping N–N programmes / branches.",
  },
  capital: {
    title: "Capital & stress",
    description: "Paramètres SCR light par branche.",
  },
  "policy-versions": {
    title: "Versions de politique",
    description: "Historique des changements de politiques.",
  },
  audit: {
    title: "Journal d’audit",
    description: "Traçabilité des changements (admin uniquement).",
  },
} as const;

type SectionKey = keyof typeof sectionMeta;

function pickKeys(row: any, keys?: string[]) {
  if (!keys) return row;
  const out: Record<string, any> = {};
  for (const k of keys) out[k] = row[k] ?? "";
  return out;
}

function normalizePayload(payload: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v === "") out[k] = null;
    else out[k] = v;
  }
  return out;
}

function formatNumberNoDecimals(value: any) {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(String(value).replace(/\s/g, "").replace(",", "."));
  if (Number.isNaN(n)) return String(value);
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n).replace(/\u202f/g, " ");
}

function isNumericLike(value: any) {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  const cleaned = value.replace(/\s/g, "").replace(",", ".");
  if (cleaned === "") return false;
  return !Number.isNaN(Number(cleaned));
}

function isValidDate(value: string) {
  return !Number.isNaN(Date.parse(value));
}

function validateFields(data: Record<string, any>, fields: Field[]) {
  for (const field of fields) {
    const v = data[field.key];
    if (field.required && (v === null || v === undefined || v === "")) {
      return `Champ requis: ${field.label}`;
    }
    if (v !== null && v !== undefined && v !== "") {
      if (field.type === "number") {
        if (typeof v !== "number" || Number.isNaN(v)) return `Valeur numérique invalide: ${field.label}`;
        if (field.min !== undefined && v < field.min) return `${field.label} doit être ≥ ${field.min}`;
        if (field.max !== undefined && v > field.max) return `${field.label} doit être ≤ ${field.max}`;
      }
      if (field.type === "date" && typeof v === "string" && !isValidDate(v)) {
        return `Date invalide: ${field.label}`;
      }
    }
  }
  return null;
}

function FieldInput({ field, value, onChange, className = "" }: { field: Field; value: any; onChange: (v: any) => void; className?: string }) {
  if (field.type === "textarea") {
    return (
      <textarea
        className={`w-full rounded-md border border-slate-200 p-2 text-sm ${className}`}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
      />
    );
  }
  if (field.type === "select") {
    return (
      <select
        className={`w-full rounded-md border border-slate-200 p-2 text-sm ${className}`}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">—</option>
        {(field.options || []).map((opt) => (
          <option key={`${field.key}-${opt.value}`} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      className={`w-full rounded-md border border-slate-200 p-2 text-sm ${className}`}
      type={field.type}
      value={value ?? ""}
      onChange={(e) => {
        if (field.type === "number") {
          const v = e.target.value;
          onChange(v === "" ? "" : Number(v));
        } else {
          onChange(e.target.value);
        }
      }}
    />
  );
}

function CrudSection({
  title,
  description,
  rows,
  columns,
  rightAlignColumns,
  centerAlignColumns,
  endpoint,
  idKey,
  createTemplate,
  editableKeys,
  deleteWithBody,
  deleteBodyKeys,
  fields,
  filterFields,
  exportUrl,
  serverMode,
  validateExtra,
  onChanged,
  valueResolvers,
  groupByKey,
  groupByLabel,
}: CrudSectionProps) {
  const rightAlignSet = useMemo(() => new Set(rightAlignColumns || []), [rightAlignColumns]);
  const centerAlignSet = useMemo(() => new Set(centerAlignColumns || []), [centerAlignColumns]);
  const [createData, setCreateData] = useState<Record<string, any>>(createTemplate);
  const [editRow, setEditRow] = useState<any | null>(null);
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [formError, setFormError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [serverRows, setServerRows] = useState<any[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverLoading, setServerLoading] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCreateData(createTemplate);
  }, [createTemplate]);

  const filtered = useMemo(() => {
    const byQuery = query.trim()
      ? rows.filter((row) => columns.some((c) => String(row[c.key] ?? "").toLowerCase().includes(query.toLowerCase())))
      : rows;
    if (!filterFields || filterFields.length === 0) return byQuery;
    return byQuery.filter((row) => {
      for (const field of filterFields) {
        const v = filters[field.key];
        if (v === undefined || v === null || v === "") continue;
        if (String(row[field.key] ?? "") !== String(v)) return false;
      }
      return true;
    });
  }, [rows, query, columns, filterFields, filters]);

  const filterExtras = useMemo(() => {
    if (!filterFields || filterFields.length === 0) return [];
    return filterFields.filter((f) => !columns.some((c) => c.key === f.key));
  }, [filterFields, columns]);

  const total = serverMode ? serverTotal : filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const paged = serverMode ? serverRows : filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);
  const displayRows = useMemo(() => {
    if (!groupByKey) return paged;
    return [...paged].sort((a, b) => {
      const aGroup = String(a[groupByKey] ?? "");
      const bGroup = String(b[groupByKey] ?? "");
      const byGroup = aGroup.localeCompare(bGroup, "fr", { sensitivity: "base", numeric: true });
      if (byGroup !== 0) return byGroup;
      const aSecondary = String(a[columns[1]?.key] ?? "");
      const bSecondary = String(b[columns[1]?.key] ?? "");
      return aSecondary.localeCompare(bSecondary, "fr", { sensitivity: "base", numeric: true });
    });
  }, [paged, groupByKey, columns]);
  const groupedColumnKey = columns[1]?.key;

  useEffect(() => {
    if (!groupByKey) return;
    const groups = Array.from(new Set(displayRows.map((row) => String(row[groupByKey] ?? "Sans programme"))));
    setCollapsedGroups((prev) => {
      const next = { ...prev };
      for (const group of groups) {
        if (!(group in next)) next[group] = true;
      }
      return next;
    });
  }, [groupByKey, displayRows]);

  useEffect(() => {
    if (page !== pageSafe) setPage(pageSafe);
  }, [page, pageSafe]);

  const loadServer = useCallback(async () => {
    if (!serverMode) return;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    params.set("page", String(pageSafe));
    params.set("limit", String(pageSize));
    if (filterFields) {
      for (const field of filterFields) {
        const v = filters[field.key];
        if (v !== undefined && v !== null && v !== "") {
          params.set(field.key, String(v));
        }
      }
    }
    setServerLoading(true);
    try {
      const res = await apiRequest<{ data: any[]; pagination?: { total: number } }>(
        `${endpoint}?${params.toString()}`
      );
      setServerRows(res.data || []);
      setServerTotal(res.pagination?.total ?? (res.data ? res.data.length : 0));
    } finally {
      setServerLoading(false);
    }
  }, [serverMode, endpoint, query, pageSafe, pageSize, filterFields, filters]);

  useEffect(() => {
    loadServer();
  }, [loadServer]);

  const runValidation = (data: Record<string, any>) => {
    const err = validateFields(data, fields);
    if (err) return err;
    if (validateExtra) return validateExtra(data);
    return null;
  };

  const onCreate = async () => {
    const err = runValidation(createData);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    await apiRequest(endpoint, "POST", normalizePayload(createData));
    setCreateData(createTemplate);
    onChanged();
    if (serverMode) loadServer();
  };

  const onStartEdit = (row: any) => {
    if (!idKey) return;
    setEditRow(row);
    setEditData(pickKeys(row, editableKeys));
  };

  const onSaveEdit = async () => {
    if (!idKey || !editRow) return;
    const err = runValidation(editData);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    await apiRequest(`${endpoint}/${editRow[idKey]}`, "PATCH", normalizePayload(editData));
    setEditRow(null);
    setEditData({});
    onChanged();
    if (serverMode) loadServer();
  };

  const onDelete = async (row: any) => {
    if (!confirm(`Supprimer cet élément dans ${title} ?`)) return;
    const confirmText = window.prompt("Pour confirmer, tapez SUPPRIMER");
    if (confirmText !== "SUPPRIMER") return;
    if (deleteWithBody && deleteBodyKeys?.length) {
      const payload: Record<string, any> = {};
      for (const k of deleteBodyKeys) payload[k] = row[k];
      await apiRequest(endpoint, "DELETE", payload);
    } else if (idKey) {
      await apiRequest(`${endpoint}/${row[idKey]}`, "DELETE");
    }
    onChanged();
    if (serverMode) loadServer();
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-slate-600">{description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowCreate((s) => !s)}
            className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            {showCreate ? "Masquer l’ajout" : "Afficher l’ajout"}
          </button>
          {exportUrl && (
            <a
              href={exportUrl}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Export CSV
            </a>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-end gap-3">
            {fields.map((field) => (
              <label key={`create-${title}-${field.key}`} className="text-[11px] text-slate-600">
                {field.label}
                <FieldInput
                  field={field}
                  value={createData[field.key]}
                  onChange={(v) => setCreateData((prev) => ({ ...prev, [field.key]: v }))}
                  className="py-1.5"
                />
              </label>
            ))}
            <div className="flex items-center gap-2 pb-1">
              <button
                onClick={onCreate}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Ajouter
              </button>
              <button
                onClick={() => {
                  setFormError(null);
                  setCreateData(createTemplate);
                }}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Réinitialiser
              </button>
            </div>
          </div>
          {formError && <div className="mt-2 text-xs text-red-600">{formError}</div>}
        </div>
      )}

      {editRow && idKey && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-sm font-semibold text-amber-900">Modifier l’élément #{editRow[idKey]}</div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {fields.map((field) => (
              <label key={`edit-${title}-${field.key}`} className="text-xs text-amber-900">
                {field.label}
                <FieldInput
                  field={field}
                  value={editData[field.key]}
                  onChange={(v) => setEditData((prev) => ({ ...prev, [field.key]: v }))}
                />
              </label>
            ))}
          </div>
          {formError && <div className="mt-2 text-xs text-red-700">{formError}</div>}
          <div className="mt-3 flex gap-2">
            <button
              onClick={onSaveEdit}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Enregistrer
            </button>
            <button
              onClick={() => {
                setFormError(null);
                setEditRow(null);
                setEditData({});
              }}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div className="text-xs text-slate-600">
          {total === 0 ? "0 résultat" : `${total} résultat${total > 1 ? "s" : ""}`}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
            placeholder="Rechercher…"
            value={query}
            onChange={(e) => {
              setPage(1);
              setQuery(e.target.value);
            }}
          />
          <select
            className="rounded-md border border-slate-200 px-3 py-2 text-sm"
            value={pageSize}
            onChange={(e) => {
              setPage(1);
              setPageSize(Number(e.target.value));
            }}
          >
            {[10, 25, 50, 100].map((s) => (
              <option key={`pagesize-${s}`} value={s}>
                {s} / page
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={() => setPage(Math.max(1, pageSafe - 1))}
              disabled={pageSafe <= 1}
              className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-50"
            >
              Préc.
            </button>
            <span className="text-slate-600">
              {pageSafe} / {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages, pageSafe + 1))}
              disabled={pageSafe >= totalPages}
              className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-50"
            >
              Suiv.
            </button>
          </div>
        </div>
      </div>

      {serverLoading && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          Chargement des données…
        </div>
      )}

      {filterFields && filterFields.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-wrap items-end gap-3">
            {filterFields.map((field) => (
              <label key={`filter-inline-${field.key}`} className="text-[11px] text-slate-600">
                {field.label}
                <FieldInput
                  field={field}
                  value={filters[field.key] ?? ""}
                  onChange={(v) => {
                    setPage(1);
                    setFilters((prev) => ({ ...prev, [field.key]: v }));
                  }}
                  className="py-1.5"
                />
              </label>
            ))}
            <button
              onClick={() => setFilters({})}
              className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
            >
              Réinitialiser
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={`px-4 py-2 font-medium ${
                    centerAlignSet.has(c.key) ? "text-center" : rightAlignSet.has(c.key) ? "text-right" : "text-left"
                  }`}
                >
                  {c.label}
                </th>
              ))}
              <th className="px-4 py-2 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {displayRows.map((row, idx) => {
              const fallbackKey = columns.map((c) => String(row[c.key] ?? "")).join("|");
              const rawKey = idKey ? row[idKey] : fallbackKey;
              const rowKey = rawKey !== undefined && rawKey !== null && rawKey !== "" ? `${rawKey}-${idx}` : `row-${idx}`;
              const currentGroup = groupByKey ? String(row[groupByKey] ?? "Sans programme") : null;
              const previousGroup =
                groupByKey && idx > 0 ? String(displayRows[idx - 1]?.[groupByKey] ?? "Sans programme") : null;
              const hasGroupBreak = Boolean(groupByKey && currentGroup !== previousGroup);
              const isGroupCollapsed = Boolean(groupByKey && currentGroup && collapsedGroups[currentGroup]);
              if (isGroupCollapsed && !hasGroupBreak) return null;
              return (
                <Fragment key={rowKey}>
                  {hasGroupBreak ? (
                    <tr key={`group-${currentGroup}-${idx}`} className="bg-slate-50">
                      <td colSpan={columns.length + 1} className="px-4 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-700">
                        <button
                          type="button"
                          onClick={() => {
                            if (!currentGroup) return;
                            setCollapsedGroups((prev) => ({ ...prev, [currentGroup]: !prev[currentGroup] }));
                          }}
                          className="flex w-full items-center gap-2 py-1 text-left hover:text-slate-900"
                        >
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 bg-white text-[10px]">
                            {isGroupCollapsed ? "+" : "-"}
                          </span>
                          <span>{groupByLabel || "Groupe"}: {currentGroup}</span>
                        </button>
                      </td>
                    </tr>
                  ) : null}
                  {!isGroupCollapsed ? (
                  <tr>
                    {columns.map((c) => {
                      const value = row[c.key];
                      const boolKeys = new Set(["is_active", "fronting_required", "reinsurance_required", "approval_required"]);
                      const computedDisplay = valueResolvers?.[c.key]
                        ? valueResolvers[c.key](row)
                        : boolKeys.has(c.key) && (value === 1 || value === 0)
                        ? value === 1
                          ? "Oui"
                          : "Non"
                        : value ?? "—";
                      const isRepeatedGroupCell = Boolean(groupByKey && c.key === groupByKey);
                      const display = isRepeatedGroupCell ? "" : computedDisplay;
                      const cellClass = boolKeys.has(c.key)
                        ? "px-4 py-2 text-center"
                        : rightAlignSet.has(c.key) || isNumericLike(value)
                        ? "px-4 py-2 text-right tabular-nums"
                        : "px-4 py-2";
                      const indentedCellClass =
                        groupByKey && c.key === groupedColumnKey ? `${cellClass} pl-10` : cellClass;
                      return (
                        <td key={c.key} className={indentedCellClass}>
                          {display}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        {idKey && (
                          <button
                            onClick={() => onStartEdit(row)}
                            className="inline-flex items-center justify-center rounded-md border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50"
                            aria-label="Éditer"
                            title="Éditer"
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                              <path
                                d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        )}
                      <button
                        onClick={() => onDelete(row)}
                        className="inline-flex items-center justify-center rounded-md border border-red-200 p-1.5 text-red-700 hover:bg-red-50"
                        aria-label="Supprimer"
                        title="Supprimer"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                          <path
                            d="M4 7h16M9 7V5h6v2m-7 3v8m4-8v8m4-8v8M6 7l1 13h10l1-13"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      </div>
                    </td>
                  </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function useCategoryOptions() {
  const [categories, setCategories] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const res = await apiRequest<{ data: any[] }>("/api/captive/categories?page=1&limit=1000");
      setCategories(res.data || []);
      setError(null);
    } catch (e: any) {
      setCategories([]);
      setError(e?.message || "Erreur de chargement");
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const options = useMemo<FieldOption[]>(
    () => categories.map((c) => ({ value: c.id_category, label: `${c.code} ${c.name}` })),
    [categories]
  );

  return { categories, options, error, reload };
}

function useBranchOptions() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const res = await fetchCaptiveBranches();
      setBranches(res || []);
      setError(null);
    } catch (e: any) {
      setBranches([]);
      setError(e?.message || "Erreur de chargement");
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const options = useMemo<FieldOption[]>(
    () => branches.map((b) => ({ value: b.id_branch, label: `${b.s2_code} ${b.name}` })),
    [branches]
  );

  return { branches, options, error, reload };
}

function useProgramOptions() {
  const [programs, setPrograms] = useState<InsuranceProgram[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const res = await fetchCaptivePrograms();
      setPrograms(res || []);
      setError(null);
    } catch (e: any) {
      setPrograms([]);
      setError(e?.message || "Erreur de chargement");
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const options = useMemo<FieldOption[]>(
    () => programs.map((p) => ({ value: p.id_program, label: `${p.code} ${p.name}` })),
    [programs]
  );

  return { programs, options, error, reload };
}

function usePolicyOptions() {
  const [policies, setPolicies] = useState<BranchPolicy[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const res = await fetchCaptivePolicies();
      setPolicies(res || []);
      setError(null);
    } catch (e: any) {
      setPolicies([]);
      setError(e?.message || "Erreur de chargement");
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const options = useMemo<FieldOption[]>(
    () => policies.map((p) => ({ value: p.id_policy, label: `#${p.id_policy} ${p.branch_name || ""}` })),
    [policies]
  );

  return { policies, options, error, reload };
}

function OptionErrors({ errors }: { errors: Array<string | null> }) {
  const visible = errors.filter(Boolean) as string[];
  if (!visible.length) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      {visible.join(" • ")}
    </div>
  );
}

function BranchesSection() {
  const { options: categoryOptions, error: categoryError, reload: reloadCategories } = useCategoryOptions();

  return (
    <section className="space-y-4">
      <OptionErrors errors={[categoryError]} />
      <CrudSection
        title={sectionMeta.branches.title}
        description={sectionMeta.branches.description}
        rows={[]}
        columns={[
          { key: "s2_code", label: "S2" },
          { key: "name", label: "Branche" },
          { key: "branch_type", label: "Type" },
          { key: "is_active", label: "Active" },
        ]}
        endpoint="/api/captive/branches"
        serverMode
        idKey="id_branch"
        exportUrl="/api/export/captive-branches.csv"
        createTemplate={{ s2_code: "19", name: "Nouvelle branche", description: "", branch_type: "NON_VIE", is_active: 1 }}
        editableKeys={["s2_code", "name", "description", "branch_type", "is_active"]}
        fields={[
          { key: "s2_code", label: "Code S2", type: "text", required: true },
          { key: "name", label: "Nom", type: "text", required: true },
          { key: "description", label: "Description", type: "textarea" },
          { key: "branch_type", label: "Type", type: "text", required: true },
          {
            key: "is_active",
            label: "Active",
            type: "select",
            required: true,
            options: [
              { value: 1, label: "Oui" },
              { value: 0, label: "Non" },
            ],
          },
        ]}
        filterFields={[
          {
            key: "is_active",
            label: "Active",
            type: "select",
            options: [
              { value: 1, label: "Oui" },
              { value: 0, label: "Non" },
            ],
          },
          { key: "id_category", label: "Catégorie", type: "select", options: categoryOptions },
        ]}
        onChanged={reloadCategories}
      />
    </section>
  );
}

function CategoriesSection() {
  return (
    <section className="space-y-4">
      <CrudSection
        title={sectionMeta.categories.title}
        description={sectionMeta.categories.description}
        rows={[]}
        columns={[
          { key: "code", label: "Code" },
          { key: "name", label: "Nom" },
        ]}
        endpoint="/api/captive/categories"
        serverMode
        idKey="id_category"
        exportUrl="/api/export/captive-categories.csv"
        createTemplate={{ code: "RISK", name: "Risques divers", description: "" }}
        editableKeys={["code", "name", "description"]}
        fields={[
          { key: "code", label: "Code", type: "text", required: true },
          { key: "name", label: "Nom", type: "text", required: true },
          { key: "description", label: "Description", type: "textarea" },
        ]}
        onChanged={() => {}}
      />
    </section>
  );
}

function BranchCategoriesSection() {
  const { options: branchOptions, error: branchError, reload: reloadBranches } = useBranchOptions();
  const { options: categoryOptions, error: categoryError, reload: reloadCategories } = useCategoryOptions();
  const defaultBranch = branchOptions[0]?.value ?? "";
  const defaultCategory = categoryOptions[0]?.value ?? "";

  const reloadOptions = useCallback(() => {
    reloadBranches();
    reloadCategories();
  }, [reloadBranches, reloadCategories]);

  return (
    <section className="space-y-4">
      <OptionErrors errors={[branchError, categoryError]} />
      <CrudSection
        title={sectionMeta["branch-categories"].title}
        description={sectionMeta["branch-categories"].description}
        rows={[]}
        columns={[
          { key: "branch_name", label: "Branche" },
          { key: "category_name", label: "Catégorie" },
        ]}
        endpoint="/api/captive/branch-category-map"
        serverMode
        exportUrl="/api/export/captive-branch-category-map.csv"
        createTemplate={{ id_branch: defaultBranch, id_category: defaultCategory }}
        deleteWithBody
        deleteBodyKeys={["id_branch", "id_category"]}
        fields={[
          { key: "id_branch", label: "Branche", type: "select", required: true, options: branchOptions },
          { key: "id_category", label: "Catégorie", type: "select", required: true, options: categoryOptions },
        ]}
        filterFields={[
          { key: "id_branch", label: "Branche", type: "select", options: branchOptions },
          { key: "id_category", label: "Catégorie", type: "select", options: categoryOptions },
        ]}
        onChanged={reloadOptions}
      />
    </section>
  );
}

function PoliciesSection() {
  const { options: branchOptions, error: branchError, reload: reloadBranches } = useBranchOptions();
  const defaultBranch = branchOptions[0]?.value ?? "";
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  return (
    <section className="space-y-4">
      <OptionErrors errors={[branchError]} />
      <CrudSection
        title={sectionMeta.policies.title}
        description={sectionMeta.policies.description}
        rows={[]}
        columns={[
          { key: "branch_name", label: "Branche" },
          { key: "eligibility_mode", label: "Mode" },
          { key: "restriction_level", label: "Restriction" },
          { key: "fronting_required", label: "Fronting" },
          { key: "reinsurance_required", label: "Réassurance" },
          { key: "approval_required", label: "Validation" },
        ]}
        endpoint="/api/captive/policies"
        serverMode
        idKey="id_policy"
        exportUrl="/api/export/captive-policies.csv"
        createTemplate={{
          id_branch: defaultBranch,
          is_allowed: 1,
          restriction_level: "NONE",
          fronting_required: 0,
          reinsurance_required: 0,
          comments: "Autorisée",
          effective_from: today,
          effective_to: "",
          eligibility_mode: "ALLOWED",
          approval_required: 0,
          approval_notes: "",
        }}
        editableKeys={[
          "id_branch",
          "is_allowed",
          "restriction_level",
          "fronting_required",
          "reinsurance_required",
          "comments",
          "effective_from",
          "effective_to",
          "eligibility_mode",
          "approval_required",
          "approval_notes",
        ]}
        fields={[
          { key: "id_branch", label: "Branche", type: "select", required: true, options: branchOptions },
          {
            key: "is_allowed",
            label: "Autorisé",
            type: "select",
            required: true,
            options: [
              { value: 1, label: "Oui" },
              { value: 0, label: "Non" },
            ],
          },
          {
            key: "restriction_level",
            label: "Restriction",
            type: "select",
            required: true,
            options: RESTRICTION_LEVEL_OPTIONS,
          },
          {
            key: "fronting_required",
            label: "Fronting",
            type: "select",
            required: true,
            options: [
              { value: 1, label: "Oui" },
              { value: 0, label: "Non" },
            ],
          },
          {
            key: "reinsurance_required",
            label: "Réassurance",
            type: "select",
            required: true,
            options: [
              { value: 1, label: "Oui" },
              { value: 0, label: "Non" },
            ],
          },
          {
            key: "eligibility_mode",
            label: "Mode",
            type: "select",
            required: true,
            options: ELIGIBILITY_MODE_OPTIONS,
          },
          {
            key: "approval_required",
            label: "Validation",
            type: "select",
            required: true,
            options: [
              { value: 1, label: "Oui" },
              { value: 0, label: "Non" },
            ],
          },
          { key: "comments", label: "Commentaires", type: "textarea" },
          { key: "approval_notes", label: "Notes", type: "textarea" },
          { key: "effective_from", label: "Début", type: "date", required: true },
          { key: "effective_to", label: "Fin", type: "date" },
        ]}
        filterFields={[
          { key: "id_branch", label: "Branche", type: "select", options: branchOptions },
          {
            key: "eligibility_mode",
            label: "Mode",
            type: "select",
            options: ELIGIBILITY_MODE_OPTIONS,
          },
          {
            key: "restriction_level",
            label: "Restriction",
            type: "select",
            options: RESTRICTION_LEVEL_OPTIONS,
          },
          {
            key: "fronting_required",
            label: "Fronting",
            type: "select",
            options: [
              { value: 1, label: "Oui" },
              { value: 0, label: "Non" },
            ],
          },
          {
            key: "reinsurance_required",
            label: "Réassurance",
            type: "select",
            options: [
              { value: 1, label: "Oui" },
              { value: 0, label: "Non" },
            ],
          },
          {
            key: "approval_required",
            label: "Validation",
            type: "select",
            options: [
              { value: 1, label: "Oui" },
              { value: 0, label: "Non" },
            ],
          },
        ]}
        validateExtra={(data) => {
          if (data.effective_from && data.effective_to && data.effective_to < data.effective_from) {
            return "La date de fin doit être postérieure à la date de début";
          }
          if (data.eligibility_mode === "PROHIBITED" && Number(data.is_allowed) !== 0) {
            return "Une branche interdite doit être marquée comme non autorisée";
          }
          return null;
        }}
        valueResolvers={{
          eligibility_mode: (row) => labelForCode(row.eligibility_mode),
          restriction_level: (row) => labelForCode(row.restriction_level),
        }}
        onChanged={reloadBranches}
      />
    </section>
  );
}

function RiskParametersSection() {
  const { options: branchOptions, error: branchError, reload: reloadBranches } = useBranchOptions();
  const defaultBranch = branchOptions[0]?.value ?? "";

  return (
    <section className="space-y-4">
      <OptionErrors errors={[branchError]} />
      <CrudSection
        title={sectionMeta["risk-parameters"].title}
        description={sectionMeta["risk-parameters"].description}
        rows={[]}
        columns={[
          { key: "branch_name", label: "Branche" },
          { key: "max_limit_per_claim", label: "Limite sinistre" },
          { key: "max_limit_per_year", label: "Limite annuelle" },
          { key: "volatility_level", label: "Volatilité" },
        ]}
        rightAlignColumns={["max_limit_per_claim", "max_limit_per_year"]}
        endpoint="/api/captive/risk-parameters"
        serverMode
        idKey="id_parameters"
        exportUrl="/api/export/captive-risk-parameters.csv"
        createTemplate={{
          id_branch: defaultBranch,
          max_limit_per_claim: 1000000,
          max_limit_per_year: 5000000,
          default_deductible: 25000,
          volatility_level: "MEDIUM",
          capital_intensity: "MEDIUM",
          requires_actuarial_model: 1,
          net_retention_ratio: 30.0,
          target_loss_ratio: 55.0,
        }}
        editableKeys={[
          "id_branch",
          "max_limit_per_claim",
          "max_limit_per_year",
          "default_deductible",
          "volatility_level",
          "capital_intensity",
          "requires_actuarial_model",
          "net_retention_ratio",
          "target_loss_ratio",
        ]}
        fields={[
          { key: "id_branch", label: "Branche", type: "select", required: true, options: branchOptions },
          { key: "max_limit_per_claim", label: "Limite sinistre", type: "number", min: 0 },
          { key: "max_limit_per_year", label: "Limite annuelle", type: "number", min: 0 },
          { key: "default_deductible", label: "Franchise", type: "number", min: 0 },
          {
            key: "volatility_level",
            label: "Volatilité",
            type: "select",
            required: true,
            options: VOLATILITY_LEVEL_OPTIONS,
          },
          {
            key: "capital_intensity",
            label: "Capital",
            type: "select",
            required: true,
            options: CAPITAL_INTENSITY_OPTIONS,
          },
          {
            key: "requires_actuarial_model",
            label: "Modèle actuariel",
            type: "select",
            required: true,
            options: [
              { value: 1, label: "Oui" },
              { value: 0, label: "Non" },
            ],
          },
          { key: "net_retention_ratio", label: "Rétention %", type: "number", min: 0, max: 100 },
          { key: "target_loss_ratio", label: "Loss ratio %", type: "number", min: 0, max: 100 },
        ]}
        valueResolvers={{
          max_limit_per_claim: (row) => formatNumberNoDecimals(row.max_limit_per_claim),
          max_limit_per_year: (row) => formatNumberNoDecimals(row.max_limit_per_year),
          volatility_level: (row) => labelForCode(row.volatility_level),
          capital_intensity: (row) => labelForCode(row.capital_intensity),
        }}
        filterFields={[
          { key: "id_branch", label: "Branche", type: "select", options: branchOptions },
          {
            key: "volatility_level",
            label: "Volatilité",
            type: "select",
            options: VOLATILITY_LEVEL_OPTIONS,
          },
          {
            key: "capital_intensity",
            label: "Capital",
            type: "select",
            options: CAPITAL_INTENSITY_OPTIONS,
          },
        ]}
        validateExtra={(data) => {
          if (data.max_limit_per_claim && data.max_limit_per_year && data.max_limit_per_claim > data.max_limit_per_year) {
            return "La limite par sinistre ne peut pas dépasser la limite annuelle";
          }
          return null;
        }}
        onChanged={reloadBranches}
      />
    </section>
  );
}

function ReinsuranceSection() {
  const { options: branchOptions, error: branchError, reload: reloadBranches } = useBranchOptions();
  const defaultBranch = branchOptions[0]?.value ?? "";
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  return (
    <section className="space-y-4">
      <OptionErrors errors={[branchError]} />
      <CrudSection
        title={sectionMeta.reinsurance.title}
        description={sectionMeta.reinsurance.description}
        rows={[]}
        columns={[
          { key: "branch_name", label: "Branche" },
          { key: "rule_type", label: "Type" },
          { key: "cession_rate", label: "Cession" },
          { key: "retention_limit", label: "Rétention" },
        ]}
        rightAlignColumns={["cession_rate", "retention_limit"]}
        endpoint="/api/captive/reinsurance-rules"
        serverMode
        idKey="id_rule"
        exportUrl="/api/export/captive-reinsurance-rules.csv"
        createTemplate={{
          id_branch: defaultBranch,
          rule_type: "FRONTING",
          cession_rate: 100,
          retention_limit: 0,
          priority: 1,
          effective_from: today,
          effective_to: "",
        }}
        editableKeys={[
          "id_branch",
          "rule_type",
          "cession_rate",
          "retention_limit",
          "priority",
          "effective_from",
          "effective_to",
        ]}
        fields={[
          { key: "id_branch", label: "Branche", type: "select", required: true, options: branchOptions },
          {
            key: "rule_type",
            label: "Type",
            type: "select",
            required: true,
            options: REINSURANCE_TYPE_OPTIONS,
          },
          { key: "cession_rate", label: "Cession %", type: "number", min: 0, max: 100 },
          { key: "retention_limit", label: "Rétention", type: "number", min: 0 },
          { key: "priority", label: "Priorité", type: "number", min: 1 },
          { key: "effective_from", label: "Début", type: "date", required: true },
          { key: "effective_to", label: "Fin", type: "date" },
        ]}
        filterFields={[
          { key: "id_branch", label: "Branche", type: "select", options: branchOptions },
          {
            key: "rule_type",
            label: "Type",
            type: "select",
            options: REINSURANCE_TYPE_OPTIONS,
          },
        ]}
        valueResolvers={{
          rule_type: (row) => labelForCode(row.rule_type),
          cession_rate: (row) => formatNumberNoDecimals(row.cession_rate),
          retention_limit: (row) => formatNumberNoDecimals(row.retention_limit),
        }}
        validateExtra={(data) => {
          if (data.effective_from && data.effective_to && data.effective_to < data.effective_from) {
            return "La date de fin doit être postérieure à la date de début";
          }
          if (data.rule_type === "FRONTING") {
            if (data.cession_rate !== null && data.cession_rate !== undefined && Number(data.cession_rate) !== 100) {
              return "Un fronting doit être à 100% de cession";
            }
          }
          return null;
        }}
        onChanged={reloadBranches}
      />
    </section>
  );
}

function ProgramsSection() {
  return (
    <section className="space-y-4">
      <CrudSection
        title={sectionMeta.programs.title}
        description={sectionMeta.programs.description}
        rows={[]}
        columns={[
          { key: "code", label: "Code" },
          { key: "name", label: "Nom" },
          { key: "is_active", label: "Actif" },
        ]}
        centerAlignColumns={["is_active"]}
        endpoint="/api/captive/programs"
        serverMode
        idKey="id_program"
        exportUrl="/api/export/captive-programs.csv"
        createTemplate={{ code: "PRG999", name: "Programme test", description: "", is_active: 1 }}
        editableKeys={["code", "name", "description", "is_active"]}
        fields={[
          { key: "code", label: "Code", type: "text", required: true },
          { key: "name", label: "Nom", type: "text", required: true },
          { key: "description", label: "Description", type: "textarea" },
          {
            key: "is_active",
            label: "Actif",
            type: "select",
            required: true,
            options: [
              { value: 1, label: "Oui" },
              { value: 0, label: "Non" },
            ],
          },
        ]}
        filterFields={[
          {
            key: "is_active",
            label: "Actif",
            type: "select",
            options: [
              { value: 1, label: "Oui" },
              { value: 0, label: "Non" },
            ],
          },
        ]}
        onChanged={() => {}}
      />
    </section>
  );
}

function ProgramBranchesSection() {
  const { options: branchOptions, error: branchError, reload: reloadBranches } = useBranchOptions();
  const { options: programOptions, error: programError, reload: reloadPrograms } = useProgramOptions();
  const defaultBranch = branchOptions[0]?.value ?? "";
  const defaultProgram = programOptions[0]?.value ?? "";

  const reloadOptions = useCallback(() => {
    reloadBranches();
    reloadPrograms();
  }, [reloadBranches, reloadPrograms]);

  return (
    <section className="space-y-4">
      <OptionErrors errors={[branchError, programError]} />
      <CrudSection
        title={sectionMeta["program-branches"].title}
        description={sectionMeta["program-branches"].description}
        rows={[]}
        columns={[
          { key: "program_name", label: "Programme" },
          { key: "branch_name", label: "Branche" },
        ]}
        endpoint="/api/captive/program-branches"
        serverMode
        exportUrl="/api/export/captive-program-branches.csv"
        createTemplate={{ id_program: defaultProgram, id_branch: defaultBranch }}
        deleteWithBody
        deleteBodyKeys={["id_program", "id_branch"]}
        fields={[
          { key: "id_program", label: "Programme", type: "select", required: true, options: programOptions },
          { key: "id_branch", label: "Branche", type: "select", required: true, options: branchOptions },
        ]}
        filterFields={[
          { key: "id_program", label: "Programme", type: "select", options: programOptions },
          { key: "id_branch", label: "Branche", type: "select", options: branchOptions },
        ]}
        groupByKey="program_name"
        groupByLabel="Programme"
        onChanged={reloadOptions}
      />
    </section>
  );
}

function CapitalSection() {
  const { options: branchOptions, error: branchError, reload: reloadBranches } = useBranchOptions();
  const defaultBranch = branchOptions[0]?.value ?? "";
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  return (
    <section className="space-y-4">
      <OptionErrors errors={[branchError]} />
      <CrudSection
        title={sectionMeta.capital.title}
        description={sectionMeta.capital.description}
        rows={[]}
        columns={[
          { key: "branch_name", label: "Branche" },
          { key: "capital_method", label: "Méthode" },
          { key: "capital_charge_pct", label: "Charge %" },
        ]}
        rightAlignColumns={["capital_charge_pct"]}
        endpoint="/api/captive/capital-parameters"
        serverMode
        idKey="id_capital"
        exportUrl="/api/export/captive-capital-parameters.csv"
        createTemplate={{
          id_branch: defaultBranch,
          capital_method: "STANDARD_FORMULA",
          capital_charge_pct: 18,
          stress_scenario: "Stress 1 an",
          effective_from: today,
          effective_to: "",
        }}
        editableKeys={["id_branch", "capital_method", "capital_charge_pct", "stress_scenario", "effective_from", "effective_to"]}
        fields={[
          { key: "id_branch", label: "Branche", type: "select", required: true, options: branchOptions },
          {
            key: "capital_method",
            label: "Méthode",
            type: "select",
            required: true,
            options: CAPITAL_METHOD_OPTIONS,
          },
          { key: "capital_charge_pct", label: "Charge %", type: "number", min: 0, max: 100 },
          { key: "stress_scenario", label: "Scénario", type: "text" },
          { key: "effective_from", label: "Début", type: "date", required: true },
          { key: "effective_to", label: "Fin", type: "date" },
        ]}
        filterFields={[
          { key: "id_branch", label: "Branche", type: "select", options: branchOptions },
          {
            key: "capital_method",
            label: "Méthode",
            type: "select",
            options: CAPITAL_METHOD_OPTIONS,
          },
        ]}
        valueResolvers={{ capital_method: (row) => labelForCode(row.capital_method) }}
        validateExtra={(data) => {
          if (data.effective_from && data.effective_to && data.effective_to < data.effective_from) {
            return "La date de fin doit être postérieure à la date de début";
          }
          return null;
        }}
        onChanged={reloadBranches}
      />
    </section>
  );
}

function PolicyVersionsSection() {
  const { options: policyOptions, error: policyError, reload: reloadPolicies } = usePolicyOptions();
  const defaultPolicy = policyOptions[0]?.value ?? "";
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);

  return (
    <section className="space-y-4">
      <OptionErrors errors={[policyError]} />
      <CrudSection
        title={sectionMeta["policy-versions"].title}
        description={sectionMeta["policy-versions"].description}
        rows={[]}
        columns={[
          { key: "version_label", label: "Version" },
          { key: "changed_by", label: "Modifié par" },
        ]}
        endpoint="/api/captive/policy-versions"
        serverMode
        idKey="id_version"
        exportUrl="/api/export/captive-policy-versions.csv"
        createTemplate={{
          id_policy: defaultPolicy,
          version_label: "v2",
          changed_at: today,
          changed_by: "admin",
          change_notes: "Mise à jour",
        }}
        editableKeys={["id_policy", "version_label", "changed_at", "changed_by", "change_notes"]}
        fields={[
          { key: "id_policy", label: "Policy", type: "select", required: true, options: policyOptions },
          { key: "version_label", label: "Version", type: "text", required: true },
          { key: "changed_at", label: "Date", type: "date" },
          { key: "changed_by", label: "Modifié par", type: "text" },
          { key: "change_notes", label: "Notes", type: "textarea" },
        ]}
        filterFields={[{ key: "id_policy", label: "Policy", type: "select", options: policyOptions }]}
        onChanged={reloadPolicies}
      />
    </section>
  );
}

function AuditSection() {
  const [auditRows, setAuditRows] = useState<any[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditQuery, setAuditQuery] = useState("");
  const [auditEntity, setAuditEntity] = useState("");
  const [auditAction, setAuditAction] = useState("");
  const [auditPage, setAuditPage] = useState(1);
  const [auditPageSize, setAuditPageSize] = useState(25);

  const loadAudit = useCallback(async () => {
    try {
      const rows = await apiRequest<any[]>("/api/audit");
      setAuditRows(rows);
      setAuditError(null);
    } catch (e: any) {
      setAuditRows([]);
      setAuditError(e?.message || "Accès audit refusé");
    }
  }, []);

  useEffect(() => {
    loadAudit();
  }, [loadAudit]);

  const auditEntities = useMemo(() => {
    const set = new Set<string>();
    for (const r of auditRows) {
      if (r?.entity) set.add(r.entity);
    }
    return Array.from(set).sort();
  }, [auditRows]);

  const auditActions = useMemo(() => {
    const set = new Set<string>();
    for (const r of auditRows) {
      if (r?.action) set.add(r.action);
    }
    return Array.from(set).sort();
  }, [auditRows]);

  const auditFiltered = useMemo(() => {
    const q = auditQuery.toLowerCase();
    return auditRows.filter((r) => {
      if (auditEntity && r.entity !== auditEntity) return false;
      if (auditAction && r.action !== auditAction) return false;
      if (!q) return true;
      const hay = `${r.entity || ""} ${r.action || ""} ${r.user_email || ""} ${r.entity_id || ""} ${r.payload || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [auditRows, auditQuery, auditEntity, auditAction]);

  const auditTotal = auditFiltered.length;
  const auditPages = Math.max(1, Math.ceil(auditTotal / auditPageSize));
  const auditPageSafe = Math.min(auditPage, auditPages);
  const auditPaged = auditFiltered.slice((auditPageSafe - 1) * auditPageSize, auditPageSafe * auditPageSize);

  useEffect(() => {
    if (auditPage !== auditPageSafe) setAuditPage(auditPageSafe);
  }, [auditPage, auditPageSafe]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{sectionMeta.audit.title}</h2>
          <p className="text-sm text-slate-600">{sectionMeta.audit.description}</p>
        </div>
      </div>

      {auditError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {auditError}
        </div>
      )}

      {!auditError && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <div className="text-xs text-slate-600">
              {auditTotal === 0 ? "0 résultat" : `${auditTotal} résultat${auditTotal > 1 ? "s" : ""}`}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                value={auditEntity}
                onChange={(e) => {
                  setAuditPage(1);
                  setAuditEntity(e.target.value);
                }}
              >
                <option value="">Toutes entités</option>
                {auditEntities.map((e) => (
                  <option key={`entity-${e}`} value={e}>
                    {e}
                  </option>
                ))}
              </select>
              <select
                className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                value={auditAction}
                onChange={(e) => {
                  setAuditPage(1);
                  setAuditAction(e.target.value);
                }}
              >
                <option value="">Toutes actions</option>
                {auditActions.map((a) => (
                  <option key={`action-${a}`} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <input
                className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                placeholder="Rechercher…"
                value={auditQuery}
                onChange={(e) => {
                  setAuditPage(1);
                  setAuditQuery(e.target.value);
                }}
              />
              <select
                className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                value={auditPageSize}
                onChange={(e) => {
                  setAuditPage(1);
                  setAuditPageSize(Number(e.target.value));
                }}
              >
                {[10, 25, 50, 100].map((s) => (
                  <option key={`audit-pagesize-${s}`} value={s}>
                    {s} / page
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => setAuditPage(Math.max(1, auditPageSafe - 1))}
                  disabled={auditPageSafe <= 1}
                  className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-50"
                >
                  Préc.
                </button>
                <span className="text-slate-600">
                  {auditPageSafe} / {auditPages}
                </span>
                <button
                  onClick={() => setAuditPage(Math.min(auditPages, auditPageSafe + 1))}
                  disabled={auditPageSafe >= auditPages}
                  className="rounded-md border border-slate-200 px-2 py-1 disabled:opacity-50"
                >
                  Suiv.
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Date</th>
                  <th className="px-4 py-2 text-left font-medium">Utilisateur</th>
                  <th className="px-4 py-2 text-left font-medium">Entité</th>
                  <th className="px-4 py-2 text-left font-medium">ID</th>
                  <th className="px-4 py-2 text-left font-medium">Action</th>
                  <th className="px-4 py-2 text-left font-medium">Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auditPaged.map((row, idx) => (
                  <tr key={row.id || idx}>
                    <td className="px-4 py-2 text-slate-600">{row.created_at}</td>
                    <td className="px-4 py-2">{row.user_email || "—"}</td>
                    <td className="px-4 py-2">{row.entity}</td>
                    <td className="px-4 py-2">{row.entity_id ?? "—"}</td>
                    <td className="px-4 py-2">{row.action}</td>
                    <td className="px-4 py-2 text-xs text-slate-600">
                      {row.payload ? String(row.payload).slice(0, 200) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function CaptivePage() {
  const searchParams = useSearchParams();
  const sectionParam = searchParams.get("section") || SECTION_DEFAULT;
  const activeSection = (sectionParam in sectionMeta ? sectionParam : SECTION_DEFAULT) as SectionKey;

  const activeContent = useMemo(() => {
    switch (activeSection) {
      case "branches":
        return <BranchesSection />;
      case "categories":
        return <CategoriesSection />;
      case "branch-categories":
        return <BranchCategoriesSection />;
      case "policies":
        return <PoliciesSection />;
      case "risk-parameters":
        return <RiskParametersSection />;
      case "reinsurance":
        return <ReinsuranceSection />;
      case "programs":
        return <ProgramsSection />;
      case "program-branches":
        return <ProgramBranchesSection />;
      case "capital":
        return <CapitalSection />;
      case "policy-versions":
        return <PolicyVersionsSection />;
      case "audit":
        return <AuditSection />;
      default:
        return <BranchesSection />;
    }
  }, [activeSection]);

  return (
    <RequireAuth>
      <div className="space-y-8">
        <PageTitle
          title="Référentiel Captive"
          description="Navigation par blocs. Sélectionnez une section dans le menu pour afficher le module correspondant."
        />

        {activeContent}
      </div>
    </RequireAuth>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">Chargement…</div>
      }
    >
      <CaptivePage />
    </Suspense>
  );
}
