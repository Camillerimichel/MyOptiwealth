"use client";
import { useEffect, useState } from "react";

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    try {
      const token = window.localStorage.getItem("captiva_token");
      if (!token) {
        setRedirecting(true);
        window.location.replace("/login");
        return;
      }
      setReady(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur d'accès au stockage local";
      setErrorMessage(message);
    }
  }, []);

  if (errorMessage) {
    return (
      <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
        Erreur d'authentification client : {errorMessage}
      </div>
    );
  }

  if (!ready) {
    return (
      <p className="text-sm text-slate-600">
        {redirecting ? "Redirection vers la connexion…" : "Chargement…"}
      </p>
    );
  }
  return <>{children}</>;
}
