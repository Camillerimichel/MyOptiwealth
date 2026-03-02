"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";
import { apiRequest } from "@/lib/api";

type CaptiveUser = {
  id: number;
  email: string;
  user_status: "active" | "disabled";
  membership_role: "owner" | "intervenant" | "manager" | "viewer";
  membership_status: "active" | "disabled";
  is_owner: boolean;
  roles: string[];
  date_debut?: string | null;
  date_fin?: string | null;
};

type UserDraft = {
  rolesText: string;
  membership_role: "owner" | "intervenant" | "manager" | "viewer";
  membership_status: "active" | "disabled";
  is_owner: boolean;
};

const membershipRoles = [
  { value: "intervenant", label: "Intervenant" },
  { value: "manager", label: "Manager" },
  { value: "viewer", label: "Lecture seule" },
  { value: "owner", label: "Owner" },
] as const;

function parseRoles(input: string) {
  return [...new Set(input.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
}

function buildDraft(user: CaptiveUser): UserDraft {
  return {
    rolesText: (user.roles || []).join(", "),
    membership_role: user.membership_role,
    membership_status: user.membership_status,
    is_owner: Boolean(user.is_owner),
  };
}

export default function UtilisateursPage() {
  const [users, setUsers] = useState<CaptiveUser[]>([]);
  const [drafts, setDrafts] = useState<Record<number, UserDraft>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRoles, setNewRoles] = useState("admin");
  const [newMembershipRole, setNewMembershipRole] = useState<"owner" | "intervenant" | "manager" | "viewer">(
    "intervenant"
  );
  const [newIsOwner, setNewIsOwner] = useState(false);
  const [newMembershipStatus, setNewMembershipStatus] = useState<"active" | "disabled">("active");

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiRequest<CaptiveUser[]>("/api/captive/users");
      setUsers(data);
      setDrafts(Object.fromEntries(data.map((u) => [u.id, buildDraft(u)])));
    } catch (err: any) {
      setError(err?.message || "Impossible de charger les utilisateurs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await apiRequest("/api/captive/users", "POST", {
        email: newEmail,
        password: newPassword || undefined,
        roles: parseRoles(newRoles),
        membership: {
          role: newMembershipRole,
          is_owner: newMembershipRole === "owner" || newIsOwner ? 1 : 0,
          status: newMembershipStatus,
        },
      });
      setNewEmail("");
      setNewPassword("");
      setNewRoles("admin");
      setNewMembershipRole("intervenant");
      setNewIsOwner(false);
      setNewMembershipStatus("active");
      setMessage("Utilisateur affecté à la captive.");
      await loadUsers();
    } catch (err: any) {
      setError(err?.message || "Création impossible.");
    }
  };

  const handleSave = async (userId: number) => {
    const draft = drafts[userId];
    if (!draft) return;
    setSavingId(userId);
    setError(null);
    setMessage(null);
    try {
      await apiRequest(`/api/captive/users/${userId}`, "PATCH", {
        roles: parseRoles(draft.rolesText),
        membership: {
          role: draft.membership_role,
          is_owner: draft.membership_role === "owner" || draft.is_owner ? 1 : 0,
          status: draft.membership_status,
        },
      });
      setMessage("Mise à jour enregistrée.");
      await loadUsers();
    } catch (err: any) {
      setError(err?.message || "Mise à jour impossible.");
    } finally {
      setSavingId(null);
    }
  };

  const handleRemove = async (userId: number) => {
    if (!confirm("Retirer cet utilisateur de la captive ?")) return;
    setSavingId(userId);
    setError(null);
    setMessage(null);
    try {
      await apiRequest(`/api/captive/users/${userId}`, "DELETE");
      setMessage("Utilisateur retiré de la captive.");
      await loadUsers();
    } catch (err: any) {
      setError(err?.message || "Suppression impossible.");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <RequireAuth>
      <div className="space-y-6">
        <PageTitle
          title="Utilisateurs de la captive"
          description="Gestion des intervenants de la captive connectée (owner, manager, intervenant, viewer)."
        />

        {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}

        <form onSubmit={handleCreate} className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">Affecter un utilisateur</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              type="email"
              required
              placeholder="Email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="password"
              placeholder="Mot de passe (si nouvel utilisateur)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="text"
              placeholder="Roles globaux (ex: admin,cfo)"
              value={newRoles}
              onChange={(e) => setNewRoles(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <select
              value={newMembershipRole}
              onChange={(e) => setNewMembershipRole(e.target.value as UserDraft["membership_role"])}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              {membershipRoles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
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
            <label className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={newIsOwner}
                onChange={(e) => setNewIsOwner(e.target.checked)}
              />
              Owner
            </label>
          </div>
          <button className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
            Ajouter / affecter
          </button>
        </form>

        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-3 py-2 text-left">Email</th>
                <th className="px-3 py-2 text-left">Roles globaux</th>
                <th className="px-3 py-2 text-left">Role captive</th>
                <th className="px-3 py-2 text-left">Owner</th>
                <th className="px-3 py-2 text-left">Statut membership</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                    Chargement...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                    Aucun utilisateur affecté.
                  </td>
                </tr>
              ) : (
                users.map((u) => {
                  const draft = drafts[u.id] || buildDraft(u);
                  return (
                    <tr key={u.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <div className="font-medium text-slate-800">{u.email}</div>
                        <div className="text-xs text-slate-500">Compte: {u.user_status}</div>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={draft.rolesText}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [u.id]: { ...draft, rolesText: e.target.value },
                            }))
                          }
                          className="w-full rounded-md border border-slate-300 px-2 py-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={draft.membership_role}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [u.id]: { ...draft, membership_role: e.target.value as UserDraft["membership_role"] },
                            }))
                          }
                          className="rounded-md border border-slate-300 px-2 py-1"
                        >
                          {membershipRoles.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={draft.is_owner}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [u.id]: { ...draft, is_owner: e.target.checked },
                            }))
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={draft.membership_status}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [u.id]: { ...draft, membership_status: e.target.value as "active" | "disabled" },
                            }))
                          }
                          className="rounded-md border border-slate-300 px-2 py-1"
                        >
                          <option value="active">active</option>
                          <option value="disabled">disabled</option>
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleSave(u.id)}
                            disabled={savingId === u.id}
                            className="rounded-md border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-60"
                          >
                            Enregistrer
                          </button>
                          <button
                            onClick={() => handleRemove(u.id)}
                            disabled={savingId === u.id}
                            className="rounded-md border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50 disabled:opacity-60"
                          >
                            Retirer
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
      </div>
    </RequireAuth>
  );
}
