"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";

function buildErrorMessage(payload: any) {
  if (payload && typeof payload.error === "string" && payload.error.trim()) return payload.error;
  return "Erreur lors du chargement du PDF.";
}

function ProgrammePdfPreviewContent() {
  const searchParams = useSearchParams();
  const programmeId = useMemo(() => {
    const raw = searchParams.get("programme_id");
    if (!raw || !/^\d+$/.test(raw)) return null;
    return Number(raw);
  }, [searchParams]);
  const programmeName = (searchParams.get("programme_name") || "").trim();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadPdf = useCallback(async () => {
    if (!programmeId) {
      setError("Programme invalide.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("myoptiwealth_token");
      const res = await fetch(`/api/programmes/${programmeId}/summary.pdf`, {
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(buildErrorMessage(payload));
      }
      const blob = await res.blob();
      const nextUrl = URL.createObjectURL(blob);
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return nextUrl;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors du chargement du PDF.");
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    } finally {
      setLoading(false);
    }
  }, [programmeId]);

  useEffect(() => {
    loadPdf();
    return () => {
      setBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [loadPdf]);

  const handleDownload = useCallback(() => {
    if (!blobUrl || !programmeId) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = `programme_${programmeId}_synthese.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [blobUrl, programmeId]);

  const handleOpenNative = useCallback(() => {
    if (!blobUrl) return;
    window.open(blobUrl, "_blank", "noopener,noreferrer");
  }, [blobUrl]);

  const handleCloseViewer = useCallback(() => {
    window.close();
    window.setTimeout(() => {
      if (!window.closed) window.history.back();
    }, 120);
  }, []);

  return (
    <RequireAuth>
      <div className="min-h-screen bg-gradient-to-b from-slate-100 via-white to-slate-100 p-4 md:p-6">
        <div className="mx-auto max-w-7xl space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <PageTitle
                title="Visualiseur PDF Programme"
                description={`${programmeName ? `${programmeName} • ` : ""}${programmeId ? `Programme #${programmeId}` : "Programme non défini"}`}
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleCloseViewer}
                  className="rounded-md border border-rose-200 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50"
                >
                  Fermer
                </button>
                <button
                  onClick={loadPdf}
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Actualiser
                </button>
                <button
                  onClick={handleDownload}
                  disabled={!blobUrl || loading}
                  className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Télécharger
                </button>
                <button
                  onClick={handleOpenNative}
                  disabled={!blobUrl || loading}
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white hover:bg-slate-800 disabled:opacity-60"
                >
                  Ouvrir natif
                </button>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-xs uppercase tracking-wide text-slate-500">
              Prévisualisation
            </div>
            <div className="h-[78vh] min-h-[560px] bg-slate-100">
              {loading ? (
                <div className="flex h-full items-center justify-center">
                  <div className="text-sm text-slate-600">Chargement du PDF…</div>
                </div>
              ) : error ? (
                <div className="flex h-full items-center justify-center p-8">
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    {error}
                  </div>
                </div>
              ) : blobUrl ? (
                <iframe
                  title="Synthèse programme PDF"
                  src={blobUrl}
                  className="h-full w-full bg-white"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  Aucun document à afficher.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </RequireAuth>
  );
}

export default function ProgrammePdfPreviewPage() {
  return (
    <Suspense
      fallback={
        <RequireAuth>
          <div className="min-h-screen bg-gradient-to-b from-slate-100 via-white to-slate-100 p-4 md:p-6">
            <div className="mx-auto max-w-7xl rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm">
              Chargement du visualiseur PDF…
            </div>
          </div>
        </RequireAuth>
      }
    >
      <ProgrammePdfPreviewContent />
    </Suspense>
  );
}
