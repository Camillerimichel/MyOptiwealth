"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";

type CaptiveChoice = {
  id: number;
  code: string;
  name: string;
  role?: string;
  is_owner?: boolean;
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("admin@myoptiwealth.local");
  const [password, setPassword] = useState("");
  const [selectedCaptiveId, setSelectedCaptiveId] = useState<number | "">("");
  const [captiveChoices, setCaptiveChoices] = useState<CaptiveChoice[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const { token } = await login(
        email,
        password,
        selectedCaptiveId === "" ? null : Number(selectedCaptiveId)
      );
      localStorage.setItem("myoptiwealth_token", token);
      localStorage.setItem("myoptiwealth_email", email);
      setCaptiveChoices([]);
      setSelectedCaptiveId("");
      router.push("/dashboard");
    } catch (err: any) {
      if (err?.code === "captive_selection_required" && Array.isArray(err?.payload?.captives)) {
        setCaptiveChoices(err.payload.captives);
        setError("Plusieurs captives sont disponibles. Choisis celle à ouvrir.");
      } else {
        setError(err?.message || "Erreur de connexion");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Connexion</h1>
        <p className="text-slate-600 text-sm">Accès à la plateforme MyOptiWealth.</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-4 bg-white/90 border border-slate-200 shadow-sm p-5 rounded-lg">
        <div className="space-y-1">
          <label className="text-sm text-slate-700">Email</label>
          <input
            type="email"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm text-slate-700">Mot de passe</label>
          <input
            type="password"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {captiveChoices.length > 0 ? (
          <div className="space-y-1">
            <label className="text-sm text-slate-700">Captive</label>
            <select
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selectedCaptiveId}
              onChange={(e) => setSelectedCaptiveId(e.target.value ? Number(e.target.value) : "")}
              required
            >
              <option value="">Sélectionner...</option>
              {captiveChoices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code}){c.role ? ` - ${c.role}` : ""}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-md bg-blue-600 text-white py-2 text-sm font-semibold hover:bg-blue-700 disabled:opacity-60"
        >
          {loading ? "Connexion..." : "Se connecter"}
        </button>
      </form>
    </div>
  );
}
