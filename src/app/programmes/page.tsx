"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";
import InfoHint from "@/components/InfoHint";
import { apiRequest } from "@/lib/api";
import {
  CARRIER_ROLE_OPTIONS,
  COVERAGE_TYPE_OPTIONS,
  DEDUCTIBLE_UNIT_OPTIONS,
  DOCUMENT_TYPE_OPTIONS,
  LAYER_TYPE_OPTIONS,
  labelForCode,
} from "@/lib/codeLabels";

type Column = { key: string; label: string };

type FieldOption = { value: string | number; label: string };

type Field = {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "date" | "textarea" | "file";
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
  createFields?: Field[];
  createFieldLabelClassNames?: Record<string, string>;
  createActionsClassName?: string;
  filterFields?: Field[];
  fixedFilters?: Record<string, any>;
  exportUrl?: string;
  serverMode?: boolean;
  validateExtra?: (data: Record<string, any>) => string | null;
  onChanged: () => void;
  valueResolvers?: Record<string, (row: any) => ReactNode>;
  onCreateOverride?: (data: Record<string, any>) => Promise<void>;
  extraActions?: (row: any) => ReactNode;
  highlightRowWhen?: (row: any) => boolean;
  columnClassNames?: Record<string, string>;
  actionColumnClassName?: string;
};

const SECTION_DEFAULT = "programmes";
const PRICING_METHOD_OPTIONS: FieldOption[] = [
  { value: "FIXED_PREMIUM", label: "Prime fixe" },
  { value: "RATE_ON_LIMIT", label: "Taux sur limite" },
  { value: "RATE_ON_TURNOVER", label: "Taux sur CA" },
  { value: "RATE_ON_PAYROLL", label: "Taux sur masse salariale" },
  { value: "CUSTOM", label: "Personnalisé" },
];

const sectionMeta = {
  programmes: {
    title: "Contrats",
    description: "Fiches contrats, avec rattachement obligatoire à une branche S2.",
  },
  layers: {
    title: "Sous-contrats / Tranches",
    description: "Structure en couches du programme.",
  },
  pricing: {
    title: "Tarification",
    description: "Paramètres de prime et de taux applicables au contrat.",
  },
  coverages: {
    title: "Garanties",
    description: "Natures de garanties et limites associées.",
  },
  deductibles: {
    title: "Franchises",
    description: "Franchises par ligne ou garantie.",
  },
  exclusions: {
    title: "Exclusions",
    description: "Exclusions contractuelles.",
  },
  conditions: {
    title: "Conditions particulières",
    description: "Clauses spécifiques par programme.",
  },
  fronting: {
    title: "Assureur(s) de fronting",
    description: "Assureurs de fronting par programme.",
  },
  reinsurance: {
    title: "Réassureur(s)",
    description: "Réassureurs par programme.",
  },
  carriers: {
    title: "Assureur(s) de portage",
    description: "Assureurs de portage, rôles et quotes-parts.",
  },
  documents: {
    title: "Documents & pièces",
    description: "Polices, annexes et attestations.",
  },
  versions: {
    title: "Historique & validations",
    description: "Versions et validations des programmes.",
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

function isValidDate(value: string) {
  return !Number.isNaN(Date.parse(value));
}

function formatDateYMD(value: any) {
  if (!value) return "—";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "—";
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
    const frMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (frMatch) return `${frMatch[3]}-${frMatch[2]}-${frMatch[1]}`;
  }
  return String(value);
}

function formatNumberNoDecimals(value: any) {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(String(value).replace(/\s/g, "").replace(",", "."));
  if (Number.isNaN(n)) return String(value);
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n).replace(/\u202f/g, " ");
}

function formatPercentValue(value: any) {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(String(value).replace(/\s/g, "").replace(",", "."));
  if (Number.isNaN(n)) return String(value);
  return `${new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 4 }).format(n)} %`;
}

function validateFields(data: Record<string, any>, fields: Field[]) {
  for (const field of fields) {
    const v = data[field.key];
    if (field.required && (v === null || v === undefined || v === "")) {
      return `Champ requis: ${field.label}`;
    }
    if (field.type === "file" && field.required && !(v instanceof File)) {
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
  const isCurrencyField = field.key === "devise" || field.key === "currency";
  const widthClass = isCurrencyField ? "w-24" : "w-full";

  if (field.type === "textarea") {
    return (
      <textarea
        className={`mt-1 block w-full rounded-md border border-slate-200 p-2 text-sm ${className}`}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
      />
    );
  }
  if (field.type === "file") {
    return (
      <input
        className={`mt-1 block w-full rounded-md border border-slate-200 p-2 text-sm ${className}`}
        type="file"
        onChange={(e) => onChange(e.target.files?.[0] || null)}
      />
    );
  }
  if (field.type === "select") {
    return (
      <select
        className={`mt-1 block h-10 ${widthClass} rounded-md border border-slate-200 px-3 text-sm ${className}`}
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
      className={`mt-1 block h-10 ${widthClass} rounded-md border border-slate-200 px-3 text-sm ${className}`}
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
  createFields,
  createFieldLabelClassNames,
  createActionsClassName,
  filterFields,
  fixedFilters,
  exportUrl,
  serverMode,
  validateExtra,
  onChanged,
  valueResolvers,
  onCreateOverride,
  extraActions,
  highlightRowWhen,
  columnClassNames,
  actionColumnClassName,
}: CrudSectionProps) {
  const rightAlignSet = useMemo(() => new Set(rightAlignColumns || []), [rightAlignColumns]);
  const centerAlignSet = useMemo(() => new Set(centerAlignColumns || []), [centerAlignColumns]);
  const [createData, setCreateData] = useState<Record<string, any>>(createTemplate);
  const [editRow, setEditRow] = useState<any | null>(null);
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [formError, setFormError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, any>>({});
  const [serverRows, setServerRows] = useState<any[]>([]);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverLoading, setServerLoading] = useState(false);
  const [sectionView, setSectionView] = useState<"creation" | "visualisation">("visualisation");
  const [actionMessage, setActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [createKey, setCreateKey] = useState(0);
  const createFormFields = createFields || fields;

  useEffect(() => {
    setCreateData(createTemplate);
  }, [createTemplate]);

  const filtered = useMemo(() => {
    const byQuery = query.trim()
      ? rows.filter((row) => columns.some((c) => String(row[c.key] ?? "").toLowerCase().includes(query.toLowerCase())))
      : rows;
    const withFixed = fixedFilters
      ? byQuery.filter((row) => {
          for (const [key, value] of Object.entries(fixedFilters)) {
            if (value === undefined || value === null || value === "") continue;
            if (String(row[key] ?? "") !== String(value)) return false;
          }
          return true;
        })
      : byQuery;
    if (!filterFields || filterFields.length === 0) return withFixed;
    return withFixed.filter((row) => {
      for (const field of filterFields) {
        const v = filters[field.key];
        if (v === undefined || v === null || v === "") continue;
        if (String(row[field.key] ?? "") !== String(v)) return false;
      }
      return true;
    });
  }, [rows, query, columns, filterFields, filters]);

  const total = serverMode ? serverTotal : filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const paged = serverMode ? serverRows : filtered.slice((pageSafe - 1) * pageSize, pageSafe * pageSize);

  useEffect(() => {
    if (page !== pageSafe) setPage(pageSafe);
  }, [page, pageSafe]);

  const loadServer = useCallback(async () => {
    if (!serverMode) return;
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    params.set("page", String(pageSafe));
    params.set("limit", String(pageSize));
    if (fixedFilters) {
      for (const [key, value] of Object.entries(fixedFilters)) {
        if (value !== undefined && value !== null && value !== "") {
          params.set(key, String(value));
        }
      }
    }
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

  const runCreateValidation = (data: Record<string, any>) => {
    const err = validateFields(data, createFormFields);
    if (err) return err;
    if (validateExtra) return validateExtra(data);
    return null;
  };

  const onCreate = async () => {
    const err = runCreateValidation(createData);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setActionMessage(null);
    try {
      if (onCreateOverride) {
        await onCreateOverride(createData);
      } else {
        await apiRequest(endpoint, "POST", normalizePayload(createData));
      }
      setCreateData(createTemplate);
      setActionMessage({ type: "success", text: "Création effectuée." });
      onChanged();
      if (serverMode) loadServer();
    } catch (errCreate) {
      const message = errCreate instanceof Error ? errCreate.message : "Erreur lors de la création.";
      setActionMessage({ type: "error", text: message });
    }
  };

  const onStartEdit = (row: any) => {
    if (!idKey) return;
    setFormError(null);
    setActionMessage(null);
    setEditRow(row);
    const raw = pickKeys(row, editableKeys);
    const normalized: Record<string, any> = { ...raw };
    for (const field of fields) {
      if (field.type !== "number") continue;
      const v = raw[field.key];
      if (v === null || v === undefined || v === "") {
        normalized[field.key] = "";
        continue;
      }
      if (typeof v === "number") {
        normalized[field.key] = v;
        continue;
      }
      if (typeof v === "string") {
        const cleaned = v.replace(/\s/g, "").replace(",", ".");
        const parsed = Number(cleaned);
        normalized[field.key] = Number.isNaN(parsed) ? "" : parsed;
      }
    }
    for (const field of fields) {
      if (field.type !== "date") continue;
      const v = raw[field.key];
      if (v === null || v === undefined || v === "") {
        normalized[field.key] = "";
        continue;
      }
      if (typeof v === "string") {
        const trimmed = v.trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
          normalized[field.key] = trimmed;
          continue;
        }
        const frMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
        if (frMatch) {
          normalized[field.key] = `${frMatch[3]}-${frMatch[2]}-${frMatch[1]}`;
          continue;
        }
        if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) {
          normalized[field.key] = trimmed.slice(0, 10);
          continue;
        }
      }
    }
    setEditData(normalized);
  };

  const onSaveEdit = async () => {
    if (!idKey || !editRow) return;
    const err = runValidation(editData);
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setActionMessage(null);
    try {
      await apiRequest(`${endpoint}/${editRow[idKey]}`, "PATCH", normalizePayload(editData));
      setEditRow(null);
      setEditData({});
      setFormError(null);
      setActionMessage({ type: "success", text: "Modification enregistrée." });
      onChanged();
      if (serverMode) loadServer();
    } catch (errUpdate) {
      const message = errUpdate instanceof Error ? errUpdate.message : "Erreur lors de la modification.";
      setActionMessage({ type: "error", text: message });
    }
  };

  const onDelete = async (row: any) => {
    if (!confirm(`Supprimer cet élément dans ${title} ?`)) return;
    const confirmText = window.prompt("Pour confirmer, tapez SUPPRIMER");
    if (confirmText?.trim().toUpperCase() !== "SUPPRIMER") return;
    setActionMessage(null);
    try {
      if (deleteWithBody && deleteBodyKeys?.length) {
        const payload: Record<string, any> = {};
        for (const k of deleteBodyKeys) payload[k] = row[k];
        await apiRequest(endpoint, "DELETE", payload);
      } else if (idKey) {
        await apiRequest(`${endpoint}/${row[idKey]}`, "DELETE");
      }
      setActionMessage({ type: "success", text: "Suppression effectuée." });
      onChanged();
      if (serverMode) loadServer();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erreur lors de la suppression.";
      setActionMessage({ type: "error", text: message });
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-slate-600">{description}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-300 bg-white p-1 shadow-sm">
            <button
              type="button"
              onClick={() => setSectionView("creation")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                sectionView === "creation" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Création
            </button>
            <button
              type="button"
              onClick={() => setSectionView("visualisation")}
              className={`rounded-md px-3 py-1.5 text-sm ${
                sectionView === "visualisation" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              Visualisation
            </button>
          </div>
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

      {actionMessage && (
        <div
          className={`rounded-xl border p-3 text-sm ${
            actionMessage.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-rose-200 bg-rose-50 text-rose-900"
          }`}
        >
          {actionMessage.text}
        </div>
      )}

      {sectionView === "creation" && (
        <div key={createKey} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-end gap-3">
            {createFormFields.map((field) => (
              <label
                key={`create-${title}-${field.key}`}
                className={`text-[11px] text-slate-600 ${createFieldLabelClassNames?.[field.key] || ""}`}
              >
                {field.label}
                <FieldInput
                  field={field}
                  value={createData[field.key]}
                  onChange={(v) => setCreateData((prev) => ({ ...prev, [field.key]: v }))}
                  className="py-1.5"
                />
              </label>
            ))}
            <div className={`flex items-center gap-2 pb-1 ${createActionsClassName || ""}`}>
              <button
                onClick={onCreate}
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Ajouter
              </button>
              <button
                onClick={() => {
                  setFormError(null);
                  setActionMessage(null);
                  setCreateData(createTemplate);
                  setCreateKey((k) => k + 1);
                }}
                className="h-10 rounded-md border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50"
              >
                Réinitialiser
              </button>
            </div>
          </div>
          {formError && <div className="mt-2 text-xs text-red-600">{formError}</div>}
        </div>
      )}

      {sectionView === "visualisation" && (
        <>
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
                className="h-10 rounded-md border border-slate-200 px-3 text-sm"
                placeholder="Rechercher…"
                value={query}
                onChange={(e) => {
                  setPage(1);
                  setQuery(e.target.value);
                }}
              />
              <select
                className="h-10 rounded-md border border-slate-200 px-3 text-sm"
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
                  className="mt-1 h-10 rounded-md border border-slate-200 px-3 text-sm text-slate-700 hover:bg-slate-50"
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
                      } ${columnClassNames?.[c.key] || ""}`}
                    >
                      {c.label}
                    </th>
                  ))}
                  <th className={`px-4 py-2 text-left font-medium ${actionColumnClassName || ""}`}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paged.map((row, idx) => (
                  <tr
                    key={row[idKey || columns[0].key] || idx}
                    className={highlightRowWhen?.(row) ? "bg-amber-50/80" : undefined}
                  >
                    {columns.map((c) => {
                      const display = valueResolvers?.[c.key]
                        ? valueResolvers[c.key](row)
                        : row[c.key] ?? "—";
                      return (
                        <td
                          key={c.key}
                          className={`px-4 py-2 ${
                            centerAlignSet.has(c.key)
                              ? "text-center"
                              : rightAlignSet.has(c.key)
                              ? "text-right tabular-nums"
                              : ""
                          } ${columnClassNames?.[c.key] || ""}`}
                        >
                          {display}
                        </td>
                      );
                    })}
                    <td className={`px-4 py-2 ${actionColumnClassName || ""}`}>
                      <div className="flex gap-2 whitespace-nowrap">
                        {extraActions ? extraActions(row) : null}
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
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function useProgrammeOptions() {
  const [programmes, setProgrammes] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const res = await apiRequest<{ data: any[] }>("/api/programmes?page=1&limit=1000");
      setProgrammes(res.data || []);
      setError(null);
    } catch (e: any) {
      setProgrammes([]);
      setError(e?.message || "Erreur de chargement");
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const options = useMemo<FieldOption[]>(
    () =>
      programmes.map((p) => ({
        value: p.id,
        label: `${p.ligne_risque}${p.branch_s2_code ? ` (${p.branch_s2_code})` : ""}`,
      })),
    [programmes]
  );

  const resolve = useCallback(
    (id: number) => {
      const p = programmes.find((item) => item.id === id);
      if (!p) return String(id);
      return `${p.ligne_risque}${p.branch_s2_code ? ` (${p.branch_s2_code})` : ""}`;
    },
    [programmes]
  );

  return { programmes, options, resolve, error, reload };
}

function useBranchS2Options() {
  const [branches, setBranches] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await apiRequest<{ data: any[] }>("/api/programmes/branches");
      setBranches(res.data || []);
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
    () =>
      branches.map((b) => ({
        value: b.s2_code,
        label: `${b.s2_code}${b.name ? ` - ${b.name}` : ""}`,
      })),
    [branches]
  );

  const resolve = useCallback(
    (s2Code: string) => {
      const code = String(s2Code || "").trim();
      if (!code) return "—";
      const b = branches.find((item) => String(item.s2_code) === code);
      return b ? `${b.s2_code}${b.name ? ` - ${b.name}` : ""}` : code;
    },
    [branches]
  );

  return { options, resolve, error, reload };
}

function useInsurerOptions() {
  const [insurers, setInsurers] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await apiRequest<{ data: any[] }>(
        "/api/partners/insurers?page=1&limit=1000&sort_by=name&sort_dir=asc"
      );
      setInsurers(res.data || []);
      setError(null);
    } catch (e: any) {
      setInsurers([]);
      setError(e?.message || "Erreur de chargement");
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const options = useMemo<FieldOption[]>(
    () => insurers.map((insurer) => ({ value: insurer.name, label: insurer.name })),
    [insurers]
  );

  return { options, error, reload };
}

function useCoverageOptions() {
  const [coverages, setCoverages] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const res = await apiRequest<{ data: any[] }>("/api/programmes/coverages?page=1&limit=1000");
      setCoverages(res.data || []);
      setError(null);
    } catch (e: any) {
      setCoverages([]);
      setError(e?.message || "Erreur de chargement");
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const options = useMemo<FieldOption[]>(
    () => coverages.map((c) => ({ value: c.id_coverage, label: `${c.label}` })),
    [coverages]
  );

  const resolve = useCallback(
    (id: number) => coverages.find((c) => c.id_coverage === id)?.label || String(id),
    [coverages]
  );

  return { coverages, options, resolve, error, reload };
}

function useExclusionOptions() {
  const [exclusions, setExclusions] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const res = await apiRequest<{ data: any[] }>("/api/programmes/exclusions?page=1&limit=1000");
      setExclusions(res.data || []);
      setError(null);
    } catch (e: any) {
      setExclusions([]);
      setError(e?.message || "Erreur de chargement");
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { exclusions, error, reload };
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

function ProgrammePinControls({
  pinnedProgrammeId,
  onPinProgramme,
  programmeOptions,
  resolve,
  scopeLabelSingular = "programme",
  scopeLabelPlural = "programmes",
}: {
  pinnedProgrammeId: number | null;
  onPinProgramme: (id: number | null) => void;
  programmeOptions: FieldOption[];
  resolve: (id: number) => string;
  scopeLabelSingular?: string;
  scopeLabelPlural?: string;
}) {
  return (
    <div className="sticky top-2 z-20 rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-[11px] text-slate-600">
          Contrat figé ({scopeLabelSingular})
          <select
            className="mt-1 h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
            value={pinnedProgrammeId ?? ""}
            onChange={(e) => {
              const next = e.target.value ? Number(e.target.value) : null;
              onPinProgramme(next);
            }}
          >
            <option value="">Aucun (vue globale)</option>
            {programmeOptions.map((opt) => (
              <option key={`pin-programme-${opt.value}`} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        {pinnedProgrammeId ? (
          <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Lecture figée sur: #{pinnedProgrammeId} · {resolve(pinnedProgrammeId)}
          </div>
        ) : (
          <div className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Aucun contrat figé: affichage multi-{scopeLabelPlural}.
          </div>
        )}
      </div>
    </div>
  );
}

function ProgrammesSection({
  pinnedProgrammeId,
  onPinProgramme,
  onOpenDeductibles,
}: {
  pinnedProgrammeId: number | null;
  onPinProgramme: (id: number | null) => void;
  onOpenDeductibles: () => void;
}) {
  const { options: branchOptions, resolve: resolveBranch, error: branchError } = useBranchS2Options();
  const { options: insurerOptions, error: insurerError, reload: reloadInsurers } = useInsurerOptions();
  const defaultBranch = branchOptions[0]?.value ?? "";
  const defaultInsurer = insurerOptions[0]?.value ?? "";
  const { resolve, error, reload } = useProgrammeOptions();

  const openProgrammeSummaryViewer = useCallback((programmeId: number, programmeName?: string) => {
    if (!programmeId || Number.isNaN(programmeId)) return;
    const params = new URLSearchParams();
    params.set("programme_id", String(programmeId));
    if (programmeName) params.set("programme_name", programmeName);
    const url = `/programmes/preview?${params.toString()}`;
    const opened = window.open(url, "_blank");
    if (!opened) {
      window.location.href = url;
    }
  }, []);

  return (
    <section className="space-y-4">
      <OptionErrors errors={[error, branchError, insurerError]} />
      {pinnedProgrammeId ? (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">Contrat figé:</span>
          <span className="rounded-md bg-white/80 px-2 py-1">
            #{pinnedProgrammeId} · {resolve(pinnedProgrammeId)}
          </span>
          <button
            onClick={onOpenDeductibles}
            className="rounded-md border border-amber-300 px-2 py-1 text-xs hover:bg-amber-100"
          >
            Voir Franchises
          </button>
          <button
            onClick={() => onPinProgramme(null)}
            className="rounded-md border border-amber-300 px-2 py-1 text-xs hover:bg-amber-100"
          >
            Retirer le figé
          </button>
        </div>
      ) : null}
      <CrudSection
        title={sectionMeta.programmes.title}
        description={sectionMeta.programmes.description}
        rows={[]}
        columns={[
          { key: "branch_s2_code", label: "Code S2" },
          { key: "ligne_risque", label: "Ligne" },
          { key: "statut", label: "Statut" },
          { key: "devise", label: "Devise" },
          { key: "assureur", label: "Assureur" },
          { key: "debut", label: "Début" },
          { key: "fin", label: "Fin" },
        ]}
        columnClassNames={{
          branch_s2_code: "min-w-[16rem]",
          ligne_risque: "min-w-[10rem]",
          debut: "min-w-[6.5rem] whitespace-nowrap",
          fin: "min-w-[6.5rem] whitespace-nowrap",
        }}
        actionColumnClassName="min-w-[14rem]"
        endpoint="/api/programmes"
        serverMode
        idKey="id"
        exportUrl="/api/export/programmes.csv"
        createTemplate={{
          branch_s2_code: defaultBranch,
          ligne_risque: "Programme",
          limite: 1000000,
          franchise: 25000,
          devise: "EUR",
          assureur: defaultInsurer,
          debut: "",
          fin: "",
          statut: "actif",
        }}
        editableKeys={["branch_s2_code", "ligne_risque", "limite", "franchise", "devise", "assureur", "debut", "fin", "statut"]}
        fields={[
          { key: "branch_s2_code", label: "Code S2", type: "select", required: true, options: branchOptions },
          { key: "ligne_risque", label: "Ligne de risque", type: "text", required: true },
          { key: "limite", label: "Limite", type: "number", min: 0 },
          { key: "franchise", label: "Franchise", type: "number", min: 0 },
          { key: "devise", label: "Devise", type: "text", required: true },
          { key: "assureur", label: "Assureur", type: "select", options: insurerOptions },
          { key: "debut", label: "Début", type: "date" },
          { key: "fin", label: "Fin", type: "date" },
          {
            key: "statut",
            label: "Statut",
            type: "select",
            required: true,
            options: [
              { value: "actif", label: "Actif" },
              { value: "suspendu", label: "Suspendu" },
              { value: "clos", label: "Clos" },
            ],
          },
        ]}
        valueResolvers={{
          branch_s2_code: (row) => resolveBranch(String(row.branch_s2_code || "")),
          debut: (row) => formatDateYMD(row.debut),
          fin: (row) => formatDateYMD(row.fin),
        }}
        filterFields={[
          { key: "branch_s2_code", label: "Code S2", type: "select", options: branchOptions },
          {
            key: "statut",
            label: "Statut",
            type: "select",
            options: [
              { value: "actif", label: "Actif" },
              { value: "suspendu", label: "Suspendu" },
              { value: "clos", label: "Clos" },
            ],
          },
          { key: "devise", label: "Devise", type: "text" },
          { key: "assureur", label: "Assureur", type: "select", options: insurerOptions },
        ]}
        highlightRowWhen={(row) => Number(row.id) === pinnedProgrammeId}
        extraActions={(row) => {
          const id = Number(row.id);
          const isPinned = id === pinnedProgrammeId;
          return (
            <>
              <button
                onClick={() => onPinProgramme(isPinned ? null : id)}
                className={`inline-flex items-center justify-center rounded-md border px-2 py-1 text-xs ${
                  isPinned
                    ? "border-amber-300 bg-amber-100 text-amber-900"
                    : "border-slate-200 text-slate-700 hover:bg-slate-50"
                }`}
                title={isPinned ? "Contrat déjà figé" : "Figer ce contrat"}
              >
                {isPinned ? "Figé" : "Figer"}
              </button>
              <button
                onClick={() => openProgrammeSummaryViewer(id, String(row.ligne_risque || ""))}
                className="inline-flex items-center justify-center rounded-md border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-50"
                title="Visualiser la synthèse PDF"
                aria-label="Visualiser la synthèse PDF"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                  <path
                    d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
                </svg>
              </button>
            </>
          );
        }}
        onChanged={() => {
          reload();
          reloadInsurers();
        }}
      />
    </section>
  );
}

function LayersSection({
  pinnedProgrammeId,
  onPinProgramme,
}: {
  pinnedProgrammeId: number | null;
  onPinProgramme: (id: number | null) => void;
}) {
  const { options: programmeOptions, resolve, error, reload } = useProgrammeOptions();
  const defaultProgramme = pinnedProgrammeId ?? (programmeOptions[0]?.value ?? "");
  const layerFields: Field[] = pinnedProgrammeId
    ? [
        { key: "name", label: "Nom", type: "text", required: true },
        {
          key: "layer_type",
          label: "Type",
          type: "select",
          required: true,
          options: LAYER_TYPE_OPTIONS,
        },
        { key: "attachment_point", label: "Attachement", type: "number", min: 0 },
        { key: "limit_amount", label: "Limite", type: "number", min: 0 },
        { key: "currency", label: "Devise", type: "text" },
        { key: "effective_from", label: "Début", type: "date" },
        { key: "effective_to", label: "Fin", type: "date" },
      ]
    : [
        { key: "programme_id", label: "Programme", type: "select", required: true, options: programmeOptions },
        { key: "name", label: "Nom", type: "text", required: true },
        {
          key: "layer_type",
          label: "Type",
          type: "select",
          required: true,
          options: LAYER_TYPE_OPTIONS,
        },
        { key: "attachment_point", label: "Attachement", type: "number", min: 0 },
        { key: "limit_amount", label: "Limite", type: "number", min: 0 },
        { key: "currency", label: "Devise", type: "text" },
        { key: "effective_from", label: "Début", type: "date" },
        { key: "effective_to", label: "Fin", type: "date" },
      ];
  const layerEditableKeys = pinnedProgrammeId
    ? ["name", "layer_type", "attachment_point", "limit_amount", "currency", "effective_from", "effective_to"]
    : [
        "programme_id",
        "name",
        "layer_type",
        "attachment_point",
        "limit_amount",
        "currency",
        "effective_from",
        "effective_to",
      ];
  const layerFilterFields: Field[] = pinnedProgrammeId
    ? [
        {
          key: "layer_type",
          label: "Type",
          type: "select",
          options: LAYER_TYPE_OPTIONS,
        },
        { key: "currency", label: "Devise", type: "text" },
        { key: "from", label: "Du", type: "date" },
        { key: "to", label: "Au", type: "date" },
      ]
    : [
        { key: "programme_id", label: "Programme", type: "select", options: programmeOptions },
        {
          key: "layer_type",
          label: "Type",
          type: "select",
          options: LAYER_TYPE_OPTIONS,
        },
        { key: "currency", label: "Devise", type: "text" },
        { key: "from", label: "Du", type: "date" },
        { key: "to", label: "Au", type: "date" },
      ];

  return (
    <section className="space-y-4">
      <OptionErrors errors={[error]} />
      <ProgrammePinControls
        pinnedProgrammeId={pinnedProgrammeId}
        onPinProgramme={onPinProgramme}
        programmeOptions={programmeOptions}
        resolve={resolve}
      />
      <CrudSection
        title={sectionMeta.layers.title}
        description={sectionMeta.layers.description}
        rows={[]}
        columns={[
          { key: "programme_id", label: "Programme" },
          { key: "name", label: "Nom" },
          { key: "layer_type", label: "Type" },
          { key: "currency", label: "Devise" },
          { key: "effective_from", label: "Début" },
          { key: "effective_to", label: "Fin" },
        ]}
        columnClassNames={{
          programme_id: "min-w-[14rem]",
          name: "min-w-[16rem]",
        }}
        endpoint="/api/programmes/layers"
        serverMode
        idKey="id_layer"
        exportUrl="/api/export/programme-layers.csv"
        fixedFilters={pinnedProgrammeId ? { programme_id: pinnedProgrammeId } : undefined}
        createTemplate={{
          programme_id: defaultProgramme,
          name: "Couche 1",
          layer_type: "PRIMARY",
          attachment_point: 0,
          limit_amount: 1000000,
          currency: "EUR",
          effective_from: "",
          effective_to: "",
        }}
        editableKeys={layerEditableKeys}
        fields={layerFields}
        filterFields={layerFilterFields}
        valueResolvers={{
          programme_id: (row) => resolve(Number(row.programme_id)),
          layer_type: (row) => labelForCode(row.layer_type),
          effective_from: (row) => formatDateYMD(row.effective_from),
          effective_to: (row) => formatDateYMD(row.effective_to),
        }}
        onChanged={reload}
      />
    </section>
  );
}

function PricingSection({
  pinnedProgrammeId,
  onPinProgramme,
}: {
  pinnedProgrammeId: number | null;
  onPinProgramme: (id: number | null) => void;
}) {
  const { options: programmeOptions, resolve, error, reload } = useProgrammeOptions();
  const { coverages, options: coverageOptionsAll, resolve: resolveCoverage, error: coverageError, reload: reloadCoverages } =
    useCoverageOptions();
  const coverageOptions = useMemo<FieldOption[]>(
    () =>
      pinnedProgrammeId
        ? coverages
            .filter((coverage) => Number(coverage.programme_id) === Number(pinnedProgrammeId))
            .map((coverage) => ({ value: coverage.id_coverage, label: `${coverage.label}` }))
        : coverageOptionsAll,
    [coverages, coverageOptionsAll, pinnedProgrammeId]
  );
  const defaultProgramme = pinnedProgrammeId ?? (programmeOptions[0]?.value ?? "");
  const defaultCoverage = coverageOptions[0]?.value ?? "";
  const pricingFields: Field[] = pinnedProgrammeId
    ? [
        { key: "coverage_id", label: "Garantie", type: "select", options: coverageOptions },
        {
          key: "pricing_method",
          label: "Méthode",
          type: "select",
          required: true,
          options: PRICING_METHOD_OPTIONS,
        },
        { key: "premium_amount", label: "Prime", type: "number", min: 0 },
        { key: "rate_value", label: "Taux (%)", type: "number", min: 0, max: 100 },
        { key: "minimum_premium", label: "Prime min.", type: "number", min: 0 },
        { key: "currency", label: "Devise", type: "text" },
        { key: "effective_from", label: "Début", type: "date" },
        { key: "effective_to", label: "Fin", type: "date" },
        { key: "notes", label: "Notes", type: "textarea" },
      ]
    : [
        { key: "programme_id", label: "Programme", type: "select", required: true, options: programmeOptions },
        { key: "coverage_id", label: "Garantie", type: "select", options: coverageOptions },
        {
          key: "pricing_method",
          label: "Méthode",
          type: "select",
          required: true,
          options: PRICING_METHOD_OPTIONS,
        },
        { key: "premium_amount", label: "Prime", type: "number", min: 0 },
        { key: "rate_value", label: "Taux (%)", type: "number", min: 0, max: 100 },
        { key: "minimum_premium", label: "Prime min.", type: "number", min: 0 },
        { key: "currency", label: "Devise", type: "text" },
        { key: "effective_from", label: "Début", type: "date" },
        { key: "effective_to", label: "Fin", type: "date" },
        { key: "notes", label: "Notes", type: "textarea" },
      ];
  const pricingEditableKeys = pinnedProgrammeId
    ? ["coverage_id", "pricing_method", "premium_amount", "rate_value", "minimum_premium", "currency", "effective_from", "effective_to", "notes"]
    : [
        "programme_id",
        "coverage_id",
        "pricing_method",
        "premium_amount",
        "rate_value",
        "minimum_premium",
        "currency",
        "effective_from",
        "effective_to",
        "notes",
      ];
  const pricingFilterFields: Field[] = pinnedProgrammeId
    ? [
        { key: "coverage_id", label: "Garantie", type: "select", options: coverageOptions },
        { key: "pricing_method", label: "Méthode", type: "select", options: PRICING_METHOD_OPTIONS },
        { key: "currency", label: "Devise", type: "text" },
        { key: "from", label: "Du", type: "date" },
        { key: "to", label: "Au", type: "date" },
      ]
    : [
        { key: "programme_id", label: "Programme", type: "select", options: programmeOptions },
        { key: "coverage_id", label: "Garantie", type: "select", options: coverageOptions },
        { key: "pricing_method", label: "Méthode", type: "select", options: PRICING_METHOD_OPTIONS },
        { key: "currency", label: "Devise", type: "text" },
        { key: "from", label: "Du", type: "date" },
        { key: "to", label: "Au", type: "date" },
      ];
  const reloadAll = useCallback(() => {
    reload();
    reloadCoverages();
  }, [reload, reloadCoverages]);

  return (
    <section className="space-y-4">
      <OptionErrors errors={[error, coverageError]} />
      <ProgrammePinControls
        pinnedProgrammeId={pinnedProgrammeId}
        onPinProgramme={onPinProgramme}
        programmeOptions={programmeOptions}
        resolve={resolve}
      />
      <CrudSection
        title={sectionMeta.pricing.title}
        description={sectionMeta.pricing.description}
        rows={[]}
        columns={[
          { key: "programme_id", label: "Programme" },
          { key: "coverage_id", label: "Garantie" },
          { key: "pricing_method", label: "Méthode" },
          { key: "premium_amount", label: "Prime" },
          { key: "rate_value", label: "Taux (%)" },
          { key: "minimum_premium", label: "Prime min." },
          { key: "currency", label: "Devise" },
          { key: "effective_from", label: "Début" },
          { key: "effective_to", label: "Fin" },
        ]}
        columnClassNames={{
          programme_id: "min-w-[9rem] max-w-[12rem] whitespace-normal break-words md:min-w-[12rem] md:max-w-[16rem]",
          coverage_id: "min-w-[10rem] max-w-[14rem] whitespace-normal break-words md:min-w-[13rem] md:max-w-[18rem]",
          pricing_method: "min-w-[8rem] max-w-[10rem] whitespace-normal break-words md:min-w-[10rem] md:max-w-[12rem]",
          premium_amount: "min-w-[7rem] whitespace-nowrap md:min-w-[8rem]",
          rate_value: "min-w-[6rem] whitespace-nowrap md:min-w-[7rem]",
          minimum_premium: "min-w-[7rem] whitespace-nowrap md:min-w-[8rem]",
          currency: "min-w-[4.5rem] whitespace-nowrap text-center",
          effective_from: "min-w-[6.5rem] whitespace-nowrap md:min-w-[7.5rem]",
          effective_to: "min-w-[6.5rem] whitespace-nowrap md:min-w-[7.5rem]",
        }}
        actionColumnClassName="min-w-[6.5rem] whitespace-nowrap"
        rightAlignColumns={["premium_amount", "rate_value", "minimum_premium"]}
        endpoint="/api/programmes/pricing"
        serverMode
        idKey="id_pricing"
        exportUrl="/api/export/programme-pricing.csv"
        fixedFilters={pinnedProgrammeId ? { programme_id: pinnedProgrammeId } : undefined}
        createTemplate={{
          programme_id: defaultProgramme,
          coverage_id: defaultCoverage,
          pricing_method: "FIXED_PREMIUM",
          premium_amount: 100000,
          rate_value: 0,
          minimum_premium: 0,
          currency: "EUR",
          effective_from: "",
          effective_to: "",
          notes: "",
        }}
        editableKeys={pricingEditableKeys}
        fields={pricingFields}
        filterFields={pricingFilterFields}
        valueResolvers={{
          programme_id: (row) => resolve(Number(row.programme_id)),
          coverage_id: (row) => (row.coverage_id ? resolveCoverage(Number(row.coverage_id)) : "Toutes garanties"),
          pricing_method: (row) =>
            PRICING_METHOD_OPTIONS.find((option) => String(option.value) === String(row.pricing_method))?.label ||
            labelForCode(row.pricing_method),
          premium_amount: (row) => formatNumberNoDecimals(row.premium_amount),
          rate_value: (row) => formatPercentValue(row.rate_value),
          minimum_premium: (row) => formatNumberNoDecimals(row.minimum_premium),
          effective_from: (row) => formatDateYMD(row.effective_from),
          effective_to: (row) => formatDateYMD(row.effective_to),
        }}
        onChanged={reloadAll}
      />
    </section>
  );
}

function CoveragesSection({
  pinnedProgrammeId,
  onPinProgramme,
}: {
  pinnedProgrammeId: number | null;
  onPinProgramme: (id: number | null) => void;
}) {
  const { options: programmeOptions, resolve, error, reload } = useProgrammeOptions();
  const { coverages, error: coveragesError, reload: reloadCoverages } = useCoverageOptions();
  const coverageTypeOptions = useMemo<FieldOption[]>(() => {
    if (!pinnedProgrammeId) return COVERAGE_TYPE_OPTIONS;
    const typesForProgramme = new Set(
      coverages
        .filter((coverage) => Number(coverage.programme_id) === Number(pinnedProgrammeId))
        .map((coverage) => String(coverage.coverage_type || "").trim())
        .filter(Boolean)
    );
    if (typesForProgramme.size === 0) return COVERAGE_TYPE_OPTIONS;
    return COVERAGE_TYPE_OPTIONS.filter((option) => typesForProgramme.has(String(option.value)));
  }, [coverages, pinnedProgrammeId]);
  const defaultProgramme = pinnedProgrammeId ?? (programmeOptions[0]?.value ?? "");
  const defaultCoverageType = coverageTypeOptions[0]?.value ?? "OTHER";
  const coverageFields: Field[] = pinnedProgrammeId
    ? [
        { key: "label", label: "Garantie", type: "text", required: true },
        {
          key: "coverage_type",
          label: "Type",
          type: "select",
          required: true,
          options: coverageTypeOptions,
        },
        { key: "limit_per_claim", label: "Limite sinistre", type: "number", min: 0 },
        { key: "limit_annual", label: "Limite annuelle", type: "number", min: 0 },
        { key: "currency", label: "Devise", type: "text" },
      ]
    : [
        { key: "programme_id", label: "Programme", type: "select", required: true, options: programmeOptions },
        { key: "label", label: "Garantie", type: "text", required: true },
        {
          key: "coverage_type",
          label: "Type",
          type: "select",
          required: true,
          options: coverageTypeOptions,
        },
        { key: "limit_per_claim", label: "Limite sinistre", type: "number", min: 0 },
        { key: "limit_annual", label: "Limite annuelle", type: "number", min: 0 },
        { key: "currency", label: "Devise", type: "text" },
      ];
  const coverageEditableKeys = pinnedProgrammeId
    ? ["label", "coverage_type", "limit_per_claim", "limit_annual", "currency"]
    : ["programme_id", "label", "coverage_type", "limit_per_claim", "limit_annual", "currency"];
  const coverageFilterFields: Field[] = pinnedProgrammeId
    ? [
        {
          key: "coverage_type",
          label: "Type",
          type: "select",
          options: coverageTypeOptions,
        },
        { key: "currency", label: "Devise", type: "text" },
      ]
    : [
        { key: "programme_id", label: "Programme", type: "select", options: programmeOptions },
        {
          key: "coverage_type",
          label: "Type",
          type: "select",
          options: coverageTypeOptions,
        },
        { key: "currency", label: "Devise", type: "text" },
      ];
  const reloadAll = useCallback(() => {
    reload();
    reloadCoverages();
  }, [reload, reloadCoverages]);

  return (
    <section className="space-y-4">
      <OptionErrors errors={[error, coveragesError]} />
      <ProgrammePinControls
        pinnedProgrammeId={pinnedProgrammeId}
        onPinProgramme={onPinProgramme}
        programmeOptions={programmeOptions}
        resolve={resolve}
      />
      <CrudSection
        title={sectionMeta.coverages.title}
        description={sectionMeta.coverages.description}
        rows={[]}
        columns={[
          { key: "programme_id", label: "Programme" },
          { key: "label", label: "Garantie" },
          { key: "coverage_type", label: "Type" },
          { key: "limit_per_claim", label: "Limite sinistre" },
          { key: "limit_annual", label: "Limite annuelle" },
          { key: "currency", label: "Devise" },
        ]}
        columnClassNames={{
          programme_id: "min-w-[14rem]",
          label: "min-w-[18rem]",
          coverage_type: "min-w-[11rem]",
          limit_per_claim: "min-w-[9rem] whitespace-nowrap",
          limit_annual: "min-w-[9rem] whitespace-nowrap",
        }}
        rightAlignColumns={["limit_per_claim", "limit_annual"]}
        actionColumnClassName="min-w-[8.5rem]"
        endpoint="/api/programmes/coverages"
        serverMode
        idKey="id_coverage"
        exportUrl="/api/export/programme-coverages.csv"
        fixedFilters={pinnedProgrammeId ? { programme_id: pinnedProgrammeId } : undefined}
        createTemplate={{
          programme_id: defaultProgramme,
          label: "Garantie",
          coverage_type: defaultCoverageType,
          limit_per_claim: 500000,
          limit_annual: 2000000,
          currency: "EUR",
        }}
        editableKeys={coverageEditableKeys}
        fields={coverageFields}
        filterFields={coverageFilterFields}
        valueResolvers={{
          programme_id: (row) => resolve(Number(row.programme_id)),
          coverage_type: (row) => labelForCode(row.coverage_type),
          limit_per_claim: (row) => formatNumberNoDecimals(row.limit_per_claim),
          limit_annual: (row) => formatNumberNoDecimals(row.limit_annual),
        }}
        onChanged={reloadAll}
      />
    </section>
  );
}

function DeductiblesSection({
  pinnedProgrammeId,
  onPinProgramme,
}: {
  pinnedProgrammeId: number | null;
  onPinProgramme: (id: number | null) => void;
}) {
  const { options: programmeOptions, resolve, error, reload } = useProgrammeOptions();
  const { coverages, options: coverageOptionsAll, resolve: resolveCoverage, error: coverageError, reload: reloadCoverages } =
    useCoverageOptions();
  const coverageOptions = useMemo<FieldOption[]>(
    () =>
      pinnedProgrammeId
        ? coverages
            .filter((coverage) => Number(coverage.programme_id) === Number(pinnedProgrammeId))
            .map((coverage) => ({ value: coverage.id_coverage, label: `${coverage.label}` }))
        : coverageOptionsAll,
    [coverages, coverageOptionsAll, pinnedProgrammeId]
  );
  const defaultProgramme = pinnedProgrammeId ?? (programmeOptions[0]?.value ?? "");
  const defaultCoverage = coverageOptions[0]?.value ?? "";
  const deductibleFields: Field[] = pinnedProgrammeId
    ? [
        { key: "coverage_id", label: "Garantie", type: "select", options: coverageOptions },
        { key: "amount", label: "Montant", type: "number", min: 0 },
        {
          key: "unit",
          label: "Type",
          type: "select",
          options: DEDUCTIBLE_UNIT_OPTIONS,
        },
        { key: "currency", label: "Devise", type: "text" },
        { key: "notes", label: "Notes", type: "textarea" },
      ]
    : [
        { key: "programme_id", label: "Ligne", type: "select", required: true, options: programmeOptions },
        { key: "coverage_id", label: "Garantie", type: "select", options: coverageOptions },
        { key: "amount", label: "Montant", type: "number", min: 0 },
        {
          key: "unit",
          label: "Type",
          type: "select",
          options: DEDUCTIBLE_UNIT_OPTIONS,
        },
        { key: "currency", label: "Devise", type: "text" },
        { key: "notes", label: "Notes", type: "textarea" },
      ];
  const deductibleEditableKeys = pinnedProgrammeId
    ? ["coverage_id", "amount", "unit", "currency", "notes"]
    : ["programme_id", "coverage_id", "amount", "unit", "currency", "notes"];
  const programmeFilterFields: Field[] = pinnedProgrammeId
    ? [
        { key: "coverage_id", label: "Garantie", type: "select", options: coverageOptions },
        {
          key: "unit",
          label: "Type",
          type: "select",
          options: DEDUCTIBLE_UNIT_OPTIONS,
        },
        { key: "currency", label: "Devise", type: "text" },
      ]
    : [
        { key: "programme_id", label: "Ligne", type: "select", options: programmeOptions },
        { key: "coverage_id", label: "Garantie", type: "select", options: coverageOptions },
        {
          key: "unit",
          label: "Type",
          type: "select",
          options: DEDUCTIBLE_UNIT_OPTIONS,
        },
        { key: "currency", label: "Devise", type: "text" },
      ];

  const reloadAll = useCallback(() => {
    reload();
    reloadCoverages();
  }, [reload, reloadCoverages]);

  return (
    <section className="space-y-4">
      <OptionErrors errors={[error, coverageError]} />
      <ProgrammePinControls
        pinnedProgrammeId={pinnedProgrammeId}
        onPinProgramme={onPinProgramme}
        programmeOptions={programmeOptions}
        resolve={resolve}
        scopeLabelSingular="ligne"
        scopeLabelPlural="lignes"
      />
      <CrudSection
        title={sectionMeta.deductibles.title}
        description={sectionMeta.deductibles.description}
        rows={[]}
        columns={[
          { key: "programme_id", label: "Ligne" },
          { key: "coverage_id", label: "Garantie" },
          { key: "amount", label: "Montant" },
          { key: "unit", label: "Type" },
          { key: "currency", label: "Devise" },
        ]}
        rightAlignColumns={["amount"]}
        endpoint="/api/programmes/deductibles"
        serverMode
        idKey="id_deductible"
        exportUrl="/api/export/programme-deductibles.csv"
        createTemplate={{
          programme_id: defaultProgramme,
          coverage_id: defaultCoverage,
          amount: 10000,
          unit: "FIXED",
          currency: "EUR",
          notes: "",
        }}
        fixedFilters={pinnedProgrammeId ? { programme_id: pinnedProgrammeId } : undefined}
        editableKeys={deductibleEditableKeys}
        fields={deductibleFields}
        filterFields={programmeFilterFields}
        valueResolvers={{
          programme_id: (row) => resolve(Number(row.programme_id)),
          coverage_id: (row) => resolveCoverage(Number(row.coverage_id)),
          unit: (row) => labelForCode(row.unit),
          amount: (row) => formatNumberNoDecimals(row.amount),
        }}
        onChanged={reloadAll}
      />
    </section>
  );
}

function ExclusionsSection({
  pinnedProgrammeId,
  onPinProgramme,
}: {
  pinnedProgrammeId: number | null;
  onPinProgramme: (id: number | null) => void;
}) {
  const { options: programmeOptions, resolve, error, reload } = useProgrammeOptions();
  const { exclusions, error: exclusionsError, reload: reloadExclusions } = useExclusionOptions();
  const exclusionCategoryOptions = useMemo<FieldOption[]>(() => {
    const filtered = pinnedProgrammeId
      ? exclusions.filter((row) => Number(row.programme_id) === Number(pinnedProgrammeId))
      : exclusions;
    const categories = Array.from(
      new Set(
        filtered
          .map((row) => String(row.category || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, "fr", { sensitivity: "base" }));
    return categories.map((category) => ({ value: category, label: category }));
  }, [exclusions, pinnedProgrammeId]);
  const defaultProgramme = pinnedProgrammeId ?? (programmeOptions[0]?.value ?? "");
  const exclusionFields: Field[] = pinnedProgrammeId
    ? [
        { key: "category", label: "Catégorie", type: "text" },
        { key: "description", label: "Description", type: "textarea", required: true },
      ]
    : [
        { key: "programme_id", label: "Programme", type: "select", required: true, options: programmeOptions },
        { key: "category", label: "Catégorie", type: "text" },
        { key: "description", label: "Description", type: "textarea", required: true },
      ];
  const exclusionEditableKeys = pinnedProgrammeId
    ? ["category", "description"]
    : ["programme_id", "category", "description"];
  const exclusionFilterFields: Field[] = pinnedProgrammeId
    ? [{ key: "category", label: "Catégorie", type: "select", options: exclusionCategoryOptions }]
    : [
        { key: "programme_id", label: "Programme", type: "select", options: programmeOptions },
        { key: "category", label: "Catégorie", type: "select", options: exclusionCategoryOptions },
      ];
  const exclusionCreateFields: Field[] = pinnedProgrammeId
    ? [
        { key: "category", label: "Catégorie", type: "text" },
        { key: "description", label: "Description", type: "text", required: true },
      ]
    : [
        { key: "programme_id", label: "Programme", type: "select", required: true, options: programmeOptions },
        { key: "category", label: "Catégorie", type: "text" },
        { key: "description", label: "Description", type: "text", required: true },
      ];
  const reloadAll = useCallback(() => {
    reload();
    reloadExclusions();
  }, [reload, reloadExclusions]);

  return (
    <section className="space-y-4">
      <OptionErrors errors={[error, exclusionsError]} />
      <ProgrammePinControls
        pinnedProgrammeId={pinnedProgrammeId}
        onPinProgramme={onPinProgramme}
        programmeOptions={programmeOptions}
        resolve={resolve}
      />
      <CrudSection
        title={sectionMeta.exclusions.title}
        description={sectionMeta.exclusions.description}
        rows={[]}
        columns={[
          { key: "programme_id", label: "Programme" },
          { key: "category", label: "Catégorie" },
          { key: "description", label: "Description" },
        ]}
        endpoint="/api/programmes/exclusions"
        serverMode
        idKey="id_exclusion"
        exportUrl="/api/export/programme-exclusions.csv"
        fixedFilters={pinnedProgrammeId ? { programme_id: pinnedProgrammeId } : undefined}
        createTemplate={{ programme_id: defaultProgramme, category: "", description: "Exclusion" }}
        editableKeys={exclusionEditableKeys}
        fields={exclusionFields}
        createFields={exclusionCreateFields}
        createFieldLabelClassNames={{ description: "w-full" }}
        createActionsClassName="ml-auto w-full justify-end"
        filterFields={exclusionFilterFields}
        valueResolvers={{ programme_id: (row) => resolve(Number(row.programme_id)) }}
        onChanged={reloadAll}
      />
    </section>
  );
}

function ConditionsSection({
  pinnedProgrammeId,
  onPinProgramme,
}: {
  pinnedProgrammeId: number | null;
  onPinProgramme: (id: number | null) => void;
}) {
  const { options: programmeOptions, resolve, error, reload } = useProgrammeOptions();
  const defaultProgramme = pinnedProgrammeId ?? (programmeOptions[0]?.value ?? "");
  const conditionFields: Field[] = pinnedProgrammeId
    ? [
        { key: "title", label: "Titre", type: "text", required: true },
        { key: "content", label: "Contenu", type: "textarea", required: true },
      ]
    : [
        { key: "programme_id", label: "Programme", type: "select", required: true, options: programmeOptions },
        { key: "title", label: "Titre", type: "text", required: true },
        { key: "content", label: "Contenu", type: "textarea", required: true },
      ];
  const conditionEditableKeys = pinnedProgrammeId
    ? ["title", "content"]
    : ["programme_id", "title", "content"];
  const conditionFilterFields: Field[] = pinnedProgrammeId
    ? []
    : [{ key: "programme_id", label: "Programme", type: "select", options: programmeOptions }];

  return (
    <section className="space-y-4">
      <OptionErrors errors={[error]} />
      <ProgrammePinControls
        pinnedProgrammeId={pinnedProgrammeId}
        onPinProgramme={onPinProgramme}
        programmeOptions={programmeOptions}
        resolve={resolve}
      />
      <CrudSection
        title={sectionMeta.conditions.title}
        description={sectionMeta.conditions.description}
        rows={[]}
        columns={[
          { key: "programme_id", label: "Programme" },
          { key: "title", label: "Titre" },
          { key: "content", label: "Contenu" },
        ]}
        columnClassNames={{
          programme_id: "min-w-[12rem] whitespace-nowrap",
          title: "min-w-[13rem] whitespace-nowrap",
        }}
        endpoint="/api/programmes/conditions"
        serverMode
        idKey="id_condition"
        exportUrl="/api/export/programme-conditions.csv"
        fixedFilters={pinnedProgrammeId ? { programme_id: pinnedProgrammeId } : undefined}
        createTemplate={{ programme_id: defaultProgramme, title: "Clause", content: "Contenu" }}
        editableKeys={conditionEditableKeys}
        fields={conditionFields}
        filterFields={conditionFilterFields}
        valueResolvers={{ programme_id: (row) => resolve(Number(row.programme_id)) }}
        onChanged={reload}
      />
    </section>
  );
}

function FrontingInsurersSection() {
  const { options: programmeOptions, resolve, error, reload } = useProgrammeOptions();
  const { options: insurerOptions, error: insurerError, reload: reloadInsurers } = useInsurerOptions();
  const defaultProgramme = programmeOptions[0]?.value ?? "";
  const defaultInsurer = insurerOptions[0]?.value ?? "";

  const handleCreate = useCallback(async (data: Record<string, any>) => {
    await apiRequest("/api/programmes/insurers", "POST", {
      ...data,
      insurer_type: "FRONTING",
    });
  }, []);

  return (
    <section className="space-y-4">
      <OptionErrors errors={[error, insurerError]} />
      <CrudSection
        title={sectionMeta.fronting.title}
        description={sectionMeta.fronting.description}
        rows={[]}
        columns={[
          { key: "programme_id", label: "Programme" },
          { key: "insurer_name", label: "Assureur" },
          { key: "share_pct", label: "Quote-part %" },
        ]}
        endpoint="/api/programmes/insurers"
        serverMode
        idKey="id_insurer"
        createTemplate={{ programme_id: defaultProgramme, insurer_name: defaultInsurer, share_pct: 100 }}
        editableKeys={["programme_id", "insurer_name", "share_pct"]}
        fields={[
          { key: "programme_id", label: "Programme", type: "select", required: true, options: programmeOptions },
          { key: "insurer_name", label: "Assureur", type: "select", required: true, options: insurerOptions },
          { key: "share_pct", label: "Quote-part %", type: "number", min: 0, max: 100 },
        ]}
        centerAlignColumns={["share_pct"]}
        filterFields={[{ key: "programme_id", label: "Programme", type: "select", options: programmeOptions }]}
        fixedFilters={{ insurer_type: "FRONTING" }}
        valueResolvers={{ programme_id: (row) => resolve(Number(row.programme_id)) }}
        onCreateOverride={handleCreate}
        onChanged={() => {
          reload();
          reloadInsurers();
        }}
      />
    </section>
  );
}

function ReinsuranceInsurersSection({
  pinnedProgrammeId,
  onPinProgramme,
}: {
  pinnedProgrammeId: number | null;
  onPinProgramme: (id: number | null) => void;
}) {
  const { options: programmeOptions, resolve, error, reload } = useProgrammeOptions();
  const { options: insurerOptions, error: insurerError, reload: reloadInsurers } = useInsurerOptions();
  const defaultProgramme = pinnedProgrammeId ?? (programmeOptions[0]?.value ?? "");
  const defaultInsurer = insurerOptions[0]?.value ?? "";
  const reinsuranceFields: Field[] = pinnedProgrammeId
    ? [
        { key: "insurer_name", label: "Réassureur", type: "select", required: true, options: insurerOptions },
        { key: "share_pct", label: "Quote-part %", type: "number", min: 0, max: 100 },
      ]
    : [
        { key: "programme_id", label: "Programme", type: "select", required: true, options: programmeOptions },
        { key: "insurer_name", label: "Réassureur", type: "select", required: true, options: insurerOptions },
        { key: "share_pct", label: "Quote-part %", type: "number", min: 0, max: 100 },
      ];
  const reinsuranceEditableKeys = pinnedProgrammeId
    ? ["insurer_name", "share_pct"]
    : ["programme_id", "insurer_name", "share_pct"];
  const reinsuranceFilterFields: Field[] = pinnedProgrammeId
    ? []
    : [{ key: "programme_id", label: "Programme", type: "select", options: programmeOptions }];

  const handleCreate = useCallback(async (data: Record<string, any>) => {
    await apiRequest("/api/programmes/insurers", "POST", {
      ...data,
      insurer_type: "REINSURANCE",
    });
  }, []);

  return (
    <section className="space-y-4">
      <OptionErrors errors={[error, insurerError]} />
      <ProgrammePinControls
        pinnedProgrammeId={pinnedProgrammeId}
        onPinProgramme={onPinProgramme}
        programmeOptions={programmeOptions}
        resolve={resolve}
      />
      <CrudSection
        title={sectionMeta.reinsurance.title}
        description={sectionMeta.reinsurance.description}
        rows={[]}
        columns={[
          { key: "programme_id", label: "Programme" },
          { key: "insurer_name", label: "Réassureur" },
          { key: "share_pct", label: "Quote-part %" },
        ]}
        endpoint="/api/programmes/insurers"
        serverMode
        idKey="id_insurer"
        createTemplate={{ programme_id: defaultProgramme, insurer_name: defaultInsurer, share_pct: 100 }}
        editableKeys={reinsuranceEditableKeys}
        fields={reinsuranceFields}
        centerAlignColumns={["share_pct"]}
        filterFields={reinsuranceFilterFields}
        fixedFilters={
          pinnedProgrammeId
            ? { insurer_type: "REINSURANCE", programme_id: pinnedProgrammeId }
            : { insurer_type: "REINSURANCE" }
        }
        valueResolvers={{ programme_id: (row) => resolve(Number(row.programme_id)) }}
        onCreateOverride={handleCreate}
        onChanged={() => {
          reload();
          reloadInsurers();
        }}
      />
    </section>
  );
}

function CarriersSection() {
  const { options: programmeOptions, resolve, error, reload } = useProgrammeOptions();
  const { options: insurerOptions, error: insurerError, reload: reloadInsurers } = useInsurerOptions();
  const defaultProgramme = programmeOptions[0]?.value ?? "";
  const defaultInsurer = insurerOptions[0]?.value ?? "";

  return (
    <section className="space-y-4">
      <OptionErrors errors={[error, insurerError]} />
      <CrudSection
        title={sectionMeta.carriers.title}
        description={sectionMeta.carriers.description}
        rows={[]}
        columns={[
          { key: "programme_id", label: "Programme" },
          { key: "carrier_name", label: "Assureur" },
          { key: "role", label: "Rôle" },
          { key: "share_pct", label: "Quote-part %" },
        ]}
        endpoint="/api/programmes/carriers"
        serverMode
        idKey="id_carrier"
        exportUrl="/api/export/programme-carriers.csv"
        createTemplate={{ programme_id: defaultProgramme, carrier_name: defaultInsurer, role: "LEAD", share_pct: 100 }}
        editableKeys={["programme_id", "carrier_name", "role", "share_pct"]}
        fields={[
          { key: "programme_id", label: "Programme", type: "select", required: true, options: programmeOptions },
          { key: "carrier_name", label: "Assureur", type: "select", required: true, options: insurerOptions },
          {
            key: "role",
            label: "Rôle",
            type: "select",
            required: true,
            options: CARRIER_ROLE_OPTIONS,
          },
          { key: "share_pct", label: "Quote-part %", type: "number", min: 0, max: 100 },
        ]}
        centerAlignColumns={["share_pct"]}
        filterFields={[
          { key: "programme_id", label: "Programme", type: "select", options: programmeOptions },
          {
            key: "role",
            label: "Rôle",
            type: "select",
            options: CARRIER_ROLE_OPTIONS,
          },
        ]}
        valueResolvers={{
          programme_id: (row) => resolve(Number(row.programme_id)),
          role: (row) => labelForCode(row.role),
        }}
        onChanged={() => {
          reload();
          reloadInsurers();
        }}
      />
    </section>
  );
}

function DocumentsSection({
  pinnedProgrammeId,
  onPinProgramme,
}: {
  pinnedProgrammeId: number | null;
  onPinProgramme: (id: number | null) => void;
}) {
  const { options: programmeOptions, resolve, error, reload } = useProgrammeOptions();
  const defaultProgramme = pinnedProgrammeId ?? (programmeOptions[0]?.value ?? "");
  const [previewId, setPreviewId] = useState<number | null>(null);
  const [previewName, setPreviewName] = useState<string>("");
  const documentFields: Field[] = pinnedProgrammeId
    ? [
        {
          key: "doc_type",
          label: "Type",
          type: "select",
          required: true,
          options: DOCUMENT_TYPE_OPTIONS,
        },
        { key: "file", label: "Fichier", type: "file", required: true },
      ]
    : [
        { key: "programme_id", label: "Programme", type: "select", required: true, options: programmeOptions },
        {
          key: "doc_type",
          label: "Type",
          type: "select",
          required: true,
          options: DOCUMENT_TYPE_OPTIONS,
        },
        { key: "file", label: "Fichier", type: "file", required: true },
      ];
  const documentEditableKeys = pinnedProgrammeId ? ["doc_type"] : ["programme_id", "doc_type"];
  const documentFilterFields: Field[] = pinnedProgrammeId
    ? [
        {
          key: "doc_type",
          label: "Type",
          type: "select",
          options: DOCUMENT_TYPE_OPTIONS,
        },
        { key: "from", label: "Du", type: "date" },
        { key: "to", label: "Au", type: "date" },
      ]
    : [
        { key: "programme_id", label: "Programme", type: "select", options: programmeOptions },
        {
          key: "doc_type",
          label: "Type",
          type: "select",
          options: DOCUMENT_TYPE_OPTIONS,
        },
        { key: "from", label: "Du", type: "date" },
        { key: "to", label: "Au", type: "date" },
      ];

  const handleCreate = useCallback(
    async (data: Record<string, any>) => {
      const file = data.file as File | null;
      if (!file) throw new Error("Fichier requis");
      const base64 = await new Promise<string>((resolveBase64, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolveBase64(String(reader.result || ""));
        reader.onerror = () => reject(new Error("file_read_failed"));
        reader.readAsDataURL(file);
      });
      await apiRequest("/api/programmes/documents", "POST", {
        programme_id: data.programme_id,
        doc_type: data.doc_type,
        file_name: file.name,
        file_base64: base64,
      });
    },
    []
  );

  return (
    <section className="space-y-4">
      <OptionErrors errors={[error]} />
      <ProgrammePinControls
        pinnedProgrammeId={pinnedProgrammeId}
        onPinProgramme={onPinProgramme}
        programmeOptions={programmeOptions}
        resolve={resolve}
      />
      <CrudSection
        title={sectionMeta.documents.title}
        description={sectionMeta.documents.description}
        rows={[]}
        columns={[
          { key: "programme_id", label: "Programme" },
          { key: "doc_type", label: "Type" },
          { key: "file_name", label: "Nom du fichier" },
        ]}
        endpoint="/api/programmes/documents"
        serverMode
        idKey="id_document"
        exportUrl="/api/export/programme-documents.csv"
        fixedFilters={pinnedProgrammeId ? { programme_id: pinnedProgrammeId } : undefined}
        createTemplate={{ programme_id: defaultProgramme, doc_type: "POLICY", file: null }}
        editableKeys={documentEditableKeys}
        fields={documentFields}
        filterFields={documentFilterFields}
        valueResolvers={{
          programme_id: (row) => resolve(Number(row.programme_id)),
          doc_type: (row) => labelForCode(row.doc_type),
          file_name: (row) => (
            <button
              onClick={() => {
                setPreviewId(Number(row.id_document));
                setPreviewName(String(row.file_name || "Document"));
              }}
              className="text-blue-700 underline hover:text-blue-800"
            >
              {row.file_name || "Document"}
            </button>
          ),
        }}
        onCreateOverride={handleCreate}
        onChanged={reload}
      />

      {previewId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
          <div className="w-full max-w-5xl overflow-hidden rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="text-sm font-medium text-slate-900">{previewName}</div>
              <button
                onClick={() => setPreviewId(null)}
                className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                Fermer
              </button>
            </div>
            <div className="h-[70vh]">
              <iframe
                className="h-full w-full"
                src={`/api/programmes/documents/${previewId}/view`}
                title={previewName}
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function VersionsSection({
  pinnedProgrammeId,
  onPinProgramme,
}: {
  pinnedProgrammeId: number | null;
  onPinProgramme: (id: number | null) => void;
}) {
  const { options: programmeOptions, resolve, error, reload } = useProgrammeOptions();
  const defaultProgramme = pinnedProgrammeId ?? (programmeOptions[0]?.value ?? "");
  const today = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const versionFields: Field[] = pinnedProgrammeId
    ? [
        { key: "version_label", label: "Version", type: "text", required: true },
        { key: "changed_by", label: "Modifié par", type: "text" },
        { key: "changed_at", label: "Date", type: "date" },
        { key: "change_notes", label: "Notes", type: "textarea" },
      ]
    : [
        { key: "programme_id", label: "Programme", type: "select", required: true, options: programmeOptions },
        { key: "version_label", label: "Version", type: "text", required: true },
        { key: "changed_by", label: "Modifié par", type: "text" },
        { key: "changed_at", label: "Date", type: "date" },
        { key: "change_notes", label: "Notes", type: "textarea" },
      ];
  const versionEditableKeys = pinnedProgrammeId
    ? ["version_label", "changed_by", "change_notes", "changed_at"]
    : ["programme_id", "version_label", "changed_by", "change_notes", "changed_at"];
  const versionFilterFields: Field[] = pinnedProgrammeId
    ? [
        { key: "from", label: "Du", type: "date" },
        { key: "to", label: "Au", type: "date" },
      ]
    : [
        { key: "programme_id", label: "Programme", type: "select", options: programmeOptions },
        { key: "from", label: "Du", type: "date" },
        { key: "to", label: "Au", type: "date" },
      ];

  return (
    <section className="space-y-4">
      <OptionErrors errors={[error]} />
      <ProgrammePinControls
        pinnedProgrammeId={pinnedProgrammeId}
        onPinProgramme={onPinProgramme}
        programmeOptions={programmeOptions}
        resolve={resolve}
      />
      <CrudSection
        title={sectionMeta.versions.title}
        description={sectionMeta.versions.description}
        rows={[]}
        columns={[
          { key: "programme_id", label: "Programme" },
          { key: "version_label", label: "Version" },
          { key: "changed_by", label: "Modifié par" },
          { key: "changed_at", label: "Date" },
        ]}
        endpoint="/api/programmes/versions"
        serverMode
        idKey="id_version"
        exportUrl="/api/export/programme-versions.csv"
        fixedFilters={pinnedProgrammeId ? { programme_id: pinnedProgrammeId } : undefined}
        createTemplate={{ programme_id: defaultProgramme, version_label: "v1", changed_by: "admin", change_notes: "", changed_at: today }}
        editableKeys={versionEditableKeys}
        fields={versionFields}
        filterFields={versionFilterFields}
        valueResolvers={{ programme_id: (row) => resolve(Number(row.programme_id)) }}
        onChanged={reload}
      />
    </section>
  );
}

function ProgrammesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sectionParam = searchParams.get("section") || SECTION_DEFAULT;
  const activeSection = (sectionParam in sectionMeta ? sectionParam : SECTION_DEFAULT) as SectionKey;
  const programmeParam = searchParams.get("programme_id");
  const programmeFromUrl = programmeParam && /^\d+$/.test(programmeParam) ? Number(programmeParam) : null;
  const [pinnedProgrammeId, setPinnedProgrammeId] = useState<number | null>(programmeFromUrl);

  useEffect(() => {
    if (programmeFromUrl) {
      setPinnedProgrammeId(programmeFromUrl);
    }
  }, [programmeFromUrl]);

  const setPinnedProgramme = useCallback(
    (nextProgrammeId: number | null, nextSection?: SectionKey) => {
      setPinnedProgrammeId(nextProgrammeId);
      const params = new URLSearchParams(searchParams.toString());
      if (nextProgrammeId && nextProgrammeId > 0) params.set("programme_id", String(nextProgrammeId));
      else params.delete("programme_id");
      if (nextSection) params.set("section", nextSection);
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const activeContent = useMemo(() => {
    switch (activeSection) {
      case "programmes":
        return (
          <ProgrammesSection
            pinnedProgrammeId={pinnedProgrammeId}
            onPinProgramme={(id) => setPinnedProgramme(id)}
            onOpenDeductibles={() => setPinnedProgramme(pinnedProgrammeId, "deductibles")}
          />
        );
      case "layers":
        return (
          <LayersSection
            pinnedProgrammeId={pinnedProgrammeId}
            onPinProgramme={(id) => setPinnedProgramme(id)}
          />
        );
      case "pricing":
        return (
          <PricingSection
            pinnedProgrammeId={pinnedProgrammeId}
            onPinProgramme={(id) => setPinnedProgramme(id)}
          />
        );
      case "coverages":
        return (
          <CoveragesSection
            pinnedProgrammeId={pinnedProgrammeId}
            onPinProgramme={(id) => setPinnedProgramme(id)}
          />
        );
      case "deductibles":
        return (
          <DeductiblesSection
            pinnedProgrammeId={pinnedProgrammeId}
            onPinProgramme={(id) => setPinnedProgramme(id)}
          />
        );
      case "exclusions":
        return (
          <ExclusionsSection
            pinnedProgrammeId={pinnedProgrammeId}
            onPinProgramme={(id) => setPinnedProgramme(id)}
          />
        );
      case "conditions":
        return (
          <ConditionsSection
            pinnedProgrammeId={pinnedProgrammeId}
            onPinProgramme={(id) => setPinnedProgramme(id)}
          />
        );
      case "fronting":
        return <FrontingInsurersSection />;
      case "reinsurance":
        return (
          <ReinsuranceInsurersSection
            pinnedProgrammeId={pinnedProgrammeId}
            onPinProgramme={(id) => setPinnedProgramme(id)}
          />
        );
      case "carriers":
        return <CarriersSection />;
      case "documents":
        return (
          <DocumentsSection
            pinnedProgrammeId={pinnedProgrammeId}
            onPinProgramme={(id) => setPinnedProgramme(id)}
          />
        );
      case "versions":
        return (
          <VersionsSection
            pinnedProgrammeId={pinnedProgrammeId}
            onPinProgramme={(id) => setPinnedProgramme(id)}
          />
        );
      default:
        return (
          <ProgrammesSection
            pinnedProgrammeId={pinnedProgrammeId}
            onPinProgramme={(id) => setPinnedProgramme(id)}
            onOpenDeductibles={() => setPinnedProgramme(pinnedProgrammeId, "deductibles")}
          />
        );
    }
  }, [activeSection, pinnedProgrammeId, setPinnedProgramme]);

  return (
    <RequireAuth>
      <div className="space-y-8">
        <PageTitle
          title="Contrats d’assurance"
          titleAddon={
            <InfoHint text={"Rôle du bloc : page de pilotage des contrats/programmes d’assurance (tarification, garanties, franchises, clauses, fronting, réassurance).\n\nLecture : naviguer par section pour distinguer le paramétrage commercial (pricing/garanties) du paramétrage technique (fronting/réassurance).\n\nLeviers : sélectionner la bonne section, puis modifier les tables de paramétrage (pricing, deductibles, exclusions, conditions, assureurs/fronting/réassureurs).\n\nAbrégés utiles : S2 = Solvabilité II, RC = responsabilité civile, GWP = primes brutes émises."} />
          }
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
      <ProgrammesPage />
    </Suspense>
  );
}
