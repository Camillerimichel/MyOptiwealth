"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";

type Template = {
  id: number;
  name: string;
  description: string | null;
  definition: any;
  created_at: string;
};

const templateSchema = z.object({
  tables: z
    .object({
      programmes: z
        .object({
          columns: z.array(z.string()).min(1),
        })
        .optional(),
      sinistres: z
        .object({
          columns: z.array(z.string()).min(1),
        })
        .optional(),
      reglements: z
        .object({
          columns: z.array(z.string()).min(1),
        })
        .optional(),
    })
    .optional(),
  pdf: z
    .object({
      include_summary: z.boolean().optional(),
      include_top_sinistres: z.boolean().optional(),
      include_by_status: z.boolean().optional(),
      include_by_programme: z.boolean().optional(),
    })
    .optional(),
});

const allowedColumns = {
  programmes: [
    "id",
    "ligne_risque",
    "statut",
    "montant_garanti",
    "franchise",
    "devise",
    "date_debut",
    "date_fin",
    "created_at",
  ],
  sinistres: [
    "id",
    "programme_id",
    "ligne_risque",
    "date_survenue",
    "date_decl",
    "statut",
    "montant_estime",
    "montant_paye",
    "devise",
    "description",
    "created_at",
  ],
  reglements: ["id", "sinistre_id", "date", "montant", "created_at"],
};

async function fetchWithToken<T>(url: string): Promise<T> {
  const token = localStorage.getItem("captiva_token");
  const res = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({})))?.error || "Erreur API";
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

async function postWithToken<T>(url: string, body: any): Promise<T> {
  const token = localStorage.getItem("captiva_token");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({})))?.error || "Erreur API";
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

async function putWithToken<T>(url: string, body: any): Promise<T> {
  const token = localStorage.getItem("captiva_token");
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({})))?.error || "Erreur API";
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

async function deleteWithToken<T>(url: string): Promise<T> {
  const token = localStorage.getItem("captiva_token");
  const res = await fetch(url, {
    method: "DELETE",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({})))?.error || "Erreur API";
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export default function ReportTemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [definition, setDefinition] = useState(
    JSON.stringify(
      {
        tables: {
          programmes: { columns: ["id", "ligne_risque", "statut", "montant_garanti"] },
          sinistres: { columns: ["id", "programme_id", "statut", "montant_estime"] },
          reglements: { columns: ["id", "sinistre_id", "montant", "date"] },
        },
        pdf: {
          include_summary: true,
          include_top_sinistres: true,
          include_by_status: true,
          include_by_programme: true,
        },
      },
      null,
      2
    )
  );
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [preview, setPreview] = useState<any>(null);

  async function load() {
    try {
      setLoading(true);
      const me = await fetchWithToken<{ roles: string[] }>("/api/auth/me");
      setIsAdmin(me.roles?.includes("admin"));
      const rows = await fetchWithToken<Template[]>("/api/reports/templates");
      setTemplates(rows);
    } catch (err: any) {
      setError(err.message || "Erreur");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function loadOne(id: number) {
    try {
      setError(null);
      const tpl = await fetchWithToken<Template>(`/api/reports/templates/${id}`);
      setSelected(tpl);
      setName(tpl.name);
      setDescription(tpl.description || "");
      setDefinition(JSON.stringify(tpl.definition || {}, null, 2));
      const prev = await postWithToken<any>("/api/reports/preview", {
        template_id: tpl.id,
        limit: 5,
      });
      setPreview(prev);
    } catch (err: any) {
      setError(err.message || "Erreur");
    }
  }

  async function createTemplate() {
    try {
      setLoading(true);
      setError(null);
      setWarnings([]);
      let def;
      try {
        def = JSON.parse(definition);
      } catch (err) {
        throw new Error("JSON invalide");
      }
      const parsed = templateSchema.safeParse(def);
      if (!parsed.success) {
        throw new Error("Schéma template invalide");
      }
      const w = validateTemplate(def);
      if (w.length) setWarnings(w);
      await postWithToken("/api/reports/templates", { name, description, definition: def });
      await load();
    } catch (err: any) {
      setError(err.message || "Erreur");
    } finally {
      setLoading(false);
    }
  }

  async function updateTemplate() {
    if (!selected) return;
    try {
      setLoading(true);
      setError(null);
      setWarnings([]);
      let def;
      try {
        def = JSON.parse(definition);
      } catch (err) {
        throw new Error("JSON invalide");
      }
      const parsed = templateSchema.safeParse(def);
      if (!parsed.success) {
        throw new Error("Schéma template invalide");
      }
      const w = validateTemplate(def);
      if (w.length) setWarnings(w);
      await putWithToken(`/api/reports/templates/${selected.id}`, {
        name,
        description,
        definition: def,
      });
      await load();
    } catch (err: any) {
      setError(err.message || "Erreur");
    } finally {
      setLoading(false);
    }
  }

  async function duplicateTemplate() {
    if (!selected) return;
    try {
      setLoading(true);
      setError(null);
      setWarnings([]);
      const baseName = selected.name || "Template";
      const def =
        typeof selected.definition === "string"
          ? JSON.parse(selected.definition)
          : selected.definition || {};
      const parsed = templateSchema.safeParse(def);
      if (!parsed.success) {
        throw new Error("Schéma template invalide");
      }
      const w = validateTemplate(def);
      if (w.length) setWarnings(w);
      await postWithToken("/api/reports/templates", {
        name: `${baseName} (copy)`,
        description: selected.description || null,
        definition: def,
      });
      await load();
    } catch (err: any) {
      setError(err.message || "Erreur");
    } finally {
      setLoading(false);
    }
  }

  async function deleteTemplate() {
    if (!selected) return;
    if (!confirm(`Supprimer le template "${selected.name}" ?`)) return;
    try {
      setLoading(true);
      setError(null);
      await deleteWithToken(`/api/reports/templates/${selected.id}`);
      setSelected(null);
      await load();
    } catch (err: any) {
      setError(err.message || "Erreur");
    } finally {
      setLoading(false);
    }
  }

  function validateTemplate(def: any) {
    const warns: string[] = [];
    const tables = def?.tables || {};
    const keys = Object.keys(tables);
    if (!keys.length) warns.push("Aucune table définie dans tables.");
    for (const table of ["programmes", "sinistres", "reglements"] as const) {
      const cols = tables?.[table]?.columns || [];
      if (cols.length === 0 && tables?.[table]) {
        warns.push(`Table ${table}: columns vide.`);
      }
      const unknown = cols.filter((c: string) => !allowedColumns[table].includes(c));
      if (unknown.length) {
        warns.push(`Table ${table}: colonnes inconnues: ${unknown.join(", ")}`);
      }
    }
    return warns;
  }

  return (
    <RequireAuth>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageTitle title="Templates rapports" />
          <button
            onClick={load}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-sm"
          >
            Rafraîchir
          </button>
        </div>

        {error && <p className="text-sm text-red-600">Erreur: {error}</p>}
        {warnings.length > 0 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <div className="font-semibold">Avertissements</div>
            <ul className="mt-1 list-disc pl-5">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
        {!isAdmin && !loading && (
          <p className="text-sm text-slate-600">Accès réservé aux administrateurs.</p>
        )}

        {isAdmin && (
          <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-2 text-sm font-semibold">
              Templates existants
            </div>
            <ul className="divide-y divide-slate-100">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <div>
                    <div className="font-medium">{t.name}</div>
                    <div className="text-xs text-slate-500">{t.description || "—"}</div>
                  </div>
                  <button
                    onClick={() => loadOne(t.id)}
                    className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                  >
                    Voir
                  </button>
                </li>
              ))}
              {!templates.length && (
                <li className="px-4 py-3 text-sm text-slate-500">Aucun template.</li>
              )}
            </ul>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold">Éditeur (création)</div>
            <div className="mt-2 grid gap-2 text-sm">
              <label className="text-slate-600">Nom</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1"
              />
              <label className="text-slate-600">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="rounded-md border border-slate-200 bg-white px-2 py-1"
              />
              <label className="text-slate-600">Definition (JSON)</label>
              <textarea
                value={definition}
                onChange={(e) => setDefinition(e.target.value)}
                rows={12}
                className="rounded-md border border-slate-200 bg-white p-2 font-mono text-xs"
              />
              <div className="flex items-center gap-2">
                <button
                  onClick={createTemplate}
                  className="rounded-md border border-slate-200 bg-slate-900 px-3 py-1.5 text-sm text-white"
                >
                  Créer
                </button>
                {selected && (
                  <>
                    <button
                      onClick={updateTemplate}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-sm"
                    >
                      Mettre à jour
                    </button>
                    <button
                      onClick={duplicateTemplate}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-sm"
                    >
                      Dupliquer
                    </button>
                    <button
                      onClick={deleteTemplate}
                      className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700"
                    >
                      Supprimer
                    </button>
                  </>
                )}
                {loading && <span className="text-slate-500">Chargement…</span>}
              </div>
            </div>
          </div>
          </div>
        )}

        {isAdmin && selected && (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold">Détail template #{selected.id}</div>
            <pre className="mt-2 overflow-auto rounded bg-slate-50 p-3 text-xs">
              {JSON.stringify(selected.definition, null, 2)}
            </pre>
          </div>
        )}

        {isAdmin && preview && (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-sm font-semibold">Prévisualisation (extrait)</div>
            <div className="mt-2 space-y-3">
              {Object.entries(preview.preview || {}).map(([name, rows]: any) => (
                <div key={name} className="overflow-auto rounded border border-slate-100">
                  <div className="bg-slate-50 px-3 py-1 text-xs font-semibold uppercase text-slate-600">
                    {name}
                  </div>
                  <table className="min-w-full text-xs">
                    <thead className="bg-white text-left text-[10px] uppercase text-slate-500">
                      <tr>
                        {rows?.[0] ? Object.keys(rows[0]).map((k: string) => (
                          <th key={k} className="px-2 py-1">{k}</th>
                        )) : (
                          <th className="px-2 py-1">Aucune donnée</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {(rows || []).map((r: any, idx: number) => (
                        <tr key={idx} className="border-t border-slate-100">
                          {Object.keys(r).map((k) => (
                            <td key={k} className="px-2 py-1">{String(r[k])}</td>
                          ))}
                        </tr>
                      ))}
                      {!rows?.length && (
                        <tr>
                          <td className="px-2 py-2 text-slate-500">Aucun enregistrement.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </RequireAuth>
  );
}
