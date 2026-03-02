"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import PageTitle from "@/components/PageTitle";
import RequireAuth from "@/components/RequireAuth";
import { apiRequest } from "@/lib/api";

type ScheduleItem = {
  id: number;
  name: string;
  job_code: "monthly_closure" | "retry_auto" | "retention" | "submission_prepare" | "alerts_scan";
  frequency: "hourly" | "daily" | "weekly" | "monthly";
  hour_utc?: number | null;
  minute_utc?: number | null;
  day_of_week?: number | null;
  day_of_month?: number | null;
  payload_json?: Record<string, unknown> | null;
  is_active?: number;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: "idle" | "success" | "failed";
  last_error: string | null;
};

type TaskItem = {
  id: number;
  title: string;
  status: "todo" | "in_progress" | "done" | "blocked";
  priority: "low" | "normal" | "high" | "critical";
  due_date: string | null;
};

type AlertRuleItem = {
  id: number;
  event_code: string;
  severity: "info" | "warning" | "critical";
  min_escalation_level: number;
  max_escalation_level: number | null;
  recipients_csv: string;
  cooldown_minutes: number;
  is_active: number;
};

type DeliveryItem = {
  id: number;
  rule_id: number | null;
  event_code: string;
  severity: "info" | "warning" | "critical";
  status: "queued" | "sent" | "failed" | "skipped";
  error_text: string | null;
  created_at: string;
};

type IncidentWatchItem = {
  id: number;
  incident_key: string;
  source_code: string;
  severity: "warning" | "critical";
  status: "open" | "acked" | "resolved";
  title_text: string;
  detail_text: string | null;
  owner_name: string | null;
  sla_minutes: number;
  ack_due_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  acked_at: string | null;
  acked_by_name: string | null;
  resolved_at: string | null;
  escalation_count: number;
  escalated_at: string | null;
};

type QrtDashboard = {
  ops_tracking?: {
    tasks: { todo_count: number; in_progress_count: number; blocked_count: number; overdue_count: number };
    schedules: { total_schedules: number; active_schedules: number; next_run_at: string | null };
    alerts_7d: { queued_count: number; sent_count: number; failed_count: number };
  };
};

type IncidentsSyncResponse = {
  ok: true;
  sync?: {
    detected_count?: number;
    inserted?: number;
    reopened?: number;
    refreshed?: number;
    resolved?: number;
  };
  escalation?: {
    due_count?: number;
    escalated?: number;
  };
};

type SyncFeedback = {
  updated: boolean;
  summary: string;
  details: string[];
};

type AlertsScanResponse = {
  ok: true;
  scan_window_minutes?: number;
  findings?: Array<{
    event_code?: string;
    count?: number;
    jobs?: number;
  }>;
};

type ScanFeedback = {
  updated: boolean;
  summary: string;
  details: string[];
};

function fmtTs(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("fr-FR");
}

function statusClass(status: string) {
  if (["failed", "blocked", "critical", "open"].includes(status)) return "bg-rose-100 text-rose-700";
  if (["warning", "queued", "in_progress", "acked"].includes(status)) return "bg-amber-100 text-amber-700";
  if (["done", "success", "sent", "resolved"].includes(status)) return "bg-emerald-100 text-emerald-700";
  return "bg-slate-100 text-slate-700";
}

function priorityClass(priority: string) {
  if (priority === "critical") return "bg-rose-100 text-rose-700";
  if (priority === "high") return "bg-amber-100 text-amber-700";
  if (priority === "normal") return "bg-sky-100 text-sky-700";
  return "bg-slate-100 text-slate-700";
}

function labelStatus(value: string) {
  const map: Record<string, string> = {
    idle: "inactif",
    success: "succès",
    failed: "échec",
    todo: "à faire",
    in_progress: "en cours",
    done: "terminée",
    blocked: "bloquée",
    open: "ouvert",
    acked: "acquitté",
    resolved: "résolu",
    queued: "en file",
    sent: "envoyé",
    skipped: "ignoré",
  };
  return map[value] || value;
}

function labelSeverity(value: string) {
  const map: Record<string, string> = {
    critical: "critique",
    warning: "avertissement",
    info: "information",
  };
  return map[value] || value;
}

function labelPriority(value: string) {
  const map: Record<string, string> = {
    low: "basse",
    normal: "normale",
    high: "haute",
    critical: "critique",
  };
  return map[value] || value;
}

function labelFrequency(value: string) {
  const map: Record<string, string> = {
    hourly: "horaire",
    daily: "quotidienne",
    weekly: "hebdomadaire",
    monthly: "mensuelle",
  };
  return map[value] || value;
}

function labelScheduleCode(value: string) {
  const map: Record<string, string> = {
    alerts_scan: "scan_alertes",
    monthly_closure: "cloture_mensuelle",
    retry_auto: "relance_auto",
    retention: "retention",
    submission_prepare: "preparation_soumission",
  };
  return map[value] || value;
}

function parseSchedulePayload(input: unknown) {
  if (input == null) return {};
  if (typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>;
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      if (typeof parsed === "object" && parsed && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return { raw_payload: input };
    }
  }
  return {};
}

function scheduleCadenceLabel(s: ScheduleItem) {
  const base = `${labelFrequency(s.frequency)} (${String(s.hour_utc ?? 0).padStart(2, "0")}:${String(s.minute_utc ?? 0).padStart(2, "0")} UTC)`;
  if (s.frequency === "weekly") return `${base}, jour semaine=${s.day_of_week ?? "non défini"}`;
  if (s.frequency === "monthly") return `${base}, jour mois=${s.day_of_month ?? "non défini"}`;
  return base;
}

function scheduleOperationDetails(code: ScheduleItem["job_code"]) {
  if (code === "monthly_closure") {
    return {
      title: "Clôture mensuelle QRT",
      summary:
        "Construit les faits QRT, valide les contrôles, génère un export XML, puis publie et verrouille l'export (sauf paramètres contraires).",
      steps: [
        "Détermination de la période cible (mois précédent si non précisé).",
        "Calcul des faits QRT sur la captive et la source demandée.",
        "Validation fonctionnelle/technique des faits.",
        "Génération du fichier XML réglementaire.",
        "Insertion d'un enregistrement d'export en base.",
        "Publication de l'export puis verrouillage pour figer le résultat.",
      ],
      impacts: [
        "Tables/objets impactés: qrt_exports + stockage XML.",
        "Conséquence métier: un jeu QRT devient officiellement publié/verrouillé.",
      ],
    };
  }
  if (code === "retry_auto") {
    return {
      title: "Relance automatique d'un workflow",
      summary:
        "Reprend un export existant via workflow_request_key, le publie si nécessaire, puis le verrouille.",
      steps: [
        "Recherche du dernier export lié à la clé workflow.",
        "Vérification de l'état actuel (déjà verrouillé ou non).",
        "Publication si l'export n'est pas encore publié.",
        "Verrouillage final pour sécuriser l'état.",
      ],
      impacts: [
        "Table impactée: qrt_exports.",
        "Conséquence métier: remise en cohérence d'un workflow inachevé.",
      ],
    };
  }
  if (code === "retention") {
    return {
      title: "Rétention / archivage",
      summary:
        "Archive les exports anciens selon la politique de rétention, met à jour les traces d'archivage et les chemins.",
      steps: [
        "Calcul de la date de coupure (retention_days).",
        "Sélection des exports à archiver (optionnellement uniquement verrouillés).",
        "Déplacement/copie des fichiers en archive.",
        "Journalisation de l'archivage.",
        "Mise à jour des chemins de fichiers en base.",
      ],
      impacts: [
        "Tables/objets impactés: qrt_exports, qrt_archive_logs, stockage archive.",
        "Conséquence métier: réduction des volumes actifs et conservation historisée.",
      ],
    };
  }
  if (code === "submission_prepare") {
    return {
      title: "Préparation de soumission",
      summary:
        "Prépare un package de soumission à partir d'un export et enregistre l'état prêt à transmettre.",
      steps: [
        "Sélection de l'export cible (id explicite ou dernier export de la source).",
        "Contrôle de présence du fichier XML.",
        "Génération d'un manifeste/package de soumission.",
        "Enregistrement/rafraîchissement du statut de soumission.",
      ],
      impacts: [
        "Tables/objets impactés: qrt_submissions, qrt_exports, stockage package.",
        "Conséquence métier: dossier prêt pour canal de soumission externe.",
      ],
    };
  }
  return {
    title: "Scan d'alertes",
    summary:
      "Analyse les échecs récents (workflow, soumission, webhook), puis prépare les notifications selon les règles d'alerte actives.",
    steps: [
      "Lecture de la fenêtre temporelle (since_minutes).",
      "Comptage des erreurs récentes par type d'événement.",
      "Application des règles d'alertes (sévérité, niveaux, cooldown).",
      "Création des délivrances et jobs d'envoi email.",
    ],
    impacts: [
      "Tables/objets impactés: qrt_alert_deliveries, jobs.",
      "Conséquence métier: déclenchement de notifications opérationnelles.",
    ],
  };
}

function labelAlertEventCode(value: string) {
  const map: Record<string, string> = {
    "workflow.failed": "Workflow en echec",
    "submission.failed": "Soumission en echec",
    "webhook.failed": "Webhook en echec",
    "schedule.failed": "Planning en echec",
    "incident.unacked_escalation": "Incident non acquitte (escalade)",
  };
  return map[value] || value;
}

const ALERT_EVENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "workflow.failed", label: "Workflow en echec" },
  { value: "submission.failed", label: "Soumission en echec" },
  { value: "webhook.failed", label: "Webhook en echec" },
  { value: "schedule.failed", label: "Planning en echec" },
  { value: "incident.unacked_escalation", label: "Incident non acquitte (escalade)" },
];

const ALERT_RECIPIENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "ops@myoptiwealth.fr", label: "Equipe Ops" },
  { value: "risk@myoptiwealth.fr", label: "Equipe Risk" },
  { value: "direction@myoptiwealth.fr", label: "Direction" },
  { value: "ops@myoptiwealth.fr,risk@myoptiwealth.fr", label: "Ops + Risk" },
  { value: "ops@myoptiwealth.fr,risk@myoptiwealth.fr,direction@myoptiwealth.fr", label: "Ops + Risk + Direction" },
  { value: "admin@myoptiwealth.fr", label: "Administrateur" },
  { value: "__custom__", label: "Personnalise (saisie manuelle)" },
];

function isOverdueDate(dueDate: string | null | undefined) {
  if (!dueDate) return false;
  const t = new Date();
  const k = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  return dueDate < k;
}

function isIncidentOverdueAck(status: string, ackDueAt: string | null | undefined) {
  if (status !== "open") return false;
  if (!ackDueAt) return false;
  const due = new Date(ackDueAt);
  return !Number.isNaN(due.getTime()) && due.getTime() < Date.now();
}

const PAGE_SIZE_DEFAULT = 10;
const PAGE_SIZE_INCIDENTS = 5;
const PAGE_SIZE_ALERTS = 5;
const PANEL_PREFS_KEY = "myoptiwealth_ops_panels_v1";

function pageCount(total: number, pageSize = PAGE_SIZE_DEFAULT) {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize));
}

function clampPage(page: number, totalItems: number, pageSize = PAGE_SIZE_DEFAULT) {
  return Math.min(Math.max(1, page), pageCount(totalItems, pageSize));
}

function pageSlice<T>(items: T[], page: number, pageSize = PAGE_SIZE_DEFAULT) {
  const p = clampPage(page, items.length, pageSize);
  const start = (p - 1) * pageSize;
  return items.slice(start, start + pageSize);
}

function Pager({ total, page, onPage, pageSize = PAGE_SIZE_DEFAULT }: { total: number; page: number; onPage: (next: number) => void; pageSize?: number }) {
  const pages = pageCount(total, pageSize);
  const p = clampPage(page, total, pageSize);
  const start = total === 0 ? 0 : (p - 1) * pageSize + 1;
  const end = Math.min(total, p * pageSize);
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-xs text-slate-600">
      <span>{start}-{end} / {total}</span>
      <button disabled={p <= 1} onClick={() => onPage(p - 1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">
        Précédent
      </button>
      <span>Page {p}/{pages} • {pageSize} / page</span>
      <button disabled={p >= pages} onClick={() => onPage(p + 1)} className="rounded border border-slate-300 px-2 py-1 disabled:opacity-40">
        Suivant
      </button>
    </div>
  );
}

export default function OperationsQrtPage() {
  const initialPanelPrefs = (() => {
    const fallback = { showIncidents: false, showSchedules: false, showTasks: false, showAlerts: false };
    if (typeof window === "undefined") return fallback;
    try {
      const parsed = JSON.parse(window.localStorage.getItem(PANEL_PREFS_KEY) || "{}");
      return {
        showIncidents: Boolean(parsed?.showIncidents),
        showSchedules: Boolean(parsed?.showSchedules),
        showTasks: Boolean(parsed?.showTasks),
        showAlerts: Boolean(parsed?.showAlerts),
      };
    } catch {
      return fallback;
    }
  })();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [rules, setRules] = useState<AlertRuleItem[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryItem[]>([]);
  const [watch, setWatch] = useState<IncidentWatchItem[]>([]);
  const [dash, setDash] = useState<QrtDashboard | null>(null);

  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<SyncFeedback | null>(null);
  const [scanFeedback, setScanFeedback] = useState<ScanFeedback | null>(null);

  const [scheduleEditOpen, setScheduleEditOpen] = useState(false);
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);
  const [scheduleEditName, setScheduleEditName] = useState("");
  const [scheduleEditCode, setScheduleEditCode] = useState<ScheduleItem["job_code"]>("alerts_scan");
  const [scheduleEditFrequency, setScheduleEditFrequency] = useState<ScheduleItem["frequency"]>("hourly");
  const [scheduleEditHourUtc, setScheduleEditHourUtc] = useState("0");
  const [scheduleEditMinuteUtc, setScheduleEditMinuteUtc] = useState("0");
  const [scheduleEditDayOfWeek, setScheduleEditDayOfWeek] = useState("");
  const [scheduleEditDayOfMonth, setScheduleEditDayOfMonth] = useState("");
  const [scheduleEditPayload, setScheduleEditPayload] = useState("{}");
  const [scheduleEditIsActive, setScheduleEditIsActive] = useState(true);

  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState<TaskItem["priority"]>("normal");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [taskFilterStatus, setTaskFilterStatus] = useState<"all" | TaskItem["status"]>("all");
  const [taskFilterPriority, setTaskFilterPriority] = useState<"all" | TaskItem["priority"]>("all");

  const [ruleEventCode, setRuleEventCode] = useState("workflow.failed");
  const [ruleSeverity, setRuleSeverity] = useState<AlertRuleItem["severity"]>("critical");
  const [ruleMinEscalation, setRuleMinEscalation] = useState("0");
  const [ruleMaxEscalation, setRuleMaxEscalation] = useState("");
  const [ruleRecipientsPreset, setRuleRecipientsPreset] = useState("ops@myoptiwealth.fr");
  const [ruleRecipientsCustom, setRuleRecipientsCustom] = useState("");
  const [ruleCooldownMinutes, setRuleCooldownMinutes] = useState("30");
  const [ruleIsActive, setRuleIsActive] = useState(true);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [deliveryFilterStatus, setDeliveryFilterStatus] = useState<"all" | DeliveryItem["status"]>("all");
  const [deliveryFilterSeverity, setDeliveryFilterSeverity] = useState<"all" | DeliveryItem["severity"]>("all");

  const [incidentFilterStatus, setIncidentFilterStatus] = useState<"all" | IncidentWatchItem["status"]>("open");
  const [incidentFilterSeverity, setIncidentFilterSeverity] = useState<"all" | IncidentWatchItem["severity"]>("all");
  const [showIncidents, setShowIncidents] = useState(initialPanelPrefs.showIncidents);
  const [showSchedules, setShowSchedules] = useState(initialPanelPrefs.showSchedules);
  const [showTasks, setShowTasks] = useState(initialPanelPrefs.showTasks);
  const [showAlerts, setShowAlerts] = useState(initialPanelPrefs.showAlerts);
  const [showAlertRulesBlock, setShowAlertRulesBlock] = useState(false);
  const [showAlertDeliveriesBlock, setShowAlertDeliveriesBlock] = useState(false);
  const [incidentPage, setIncidentPage] = useState(1);
  const [schedulePage, setSchedulePage] = useState(1);
  const [taskPage, setTaskPage] = useState(1);
  const [rulePage, setRulePage] = useState(1);
  const [deliveryPage, setDeliveryPage] = useState(1);
  const [scheduleDetail, setScheduleDetail] = useState<ScheduleItem | null>(null);

  const metrics = useMemo(() => {
    const t = dash?.ops_tracking?.tasks;
    const s = dash?.ops_tracking?.schedules;
    const a = dash?.ops_tracking?.alerts_7d;
    return {
      todo: t?.todo_count ?? 0,
      blocked: t?.blocked_count ?? 0,
      overdue: t?.overdue_count ?? 0,
      nextRun: s?.next_run_at ?? null,
      activeSchedules: s?.active_schedules ?? 0,
      failedAlerts: a?.failed_count ?? 0,
    };
  }, [dash]);

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (taskFilterStatus !== "all" && t.status !== taskFilterStatus) return false;
      if (taskFilterPriority !== "all" && t.priority !== taskFilterPriority) return false;
      return true;
    });
  }, [taskFilterPriority, taskFilterStatus, tasks]);

  const filteredDeliveries = useMemo(() => {
    return deliveries.filter((d) => {
      if (deliveryFilterStatus !== "all" && d.status !== deliveryFilterStatus) return false;
      if (deliveryFilterSeverity !== "all" && d.severity !== deliveryFilterSeverity) return false;
      return true;
    });
  }, [deliveries, deliveryFilterSeverity, deliveryFilterStatus]);

  const filteredIncidents = useMemo(() => {
    return watch.filter((i) => {
      if (incidentFilterStatus !== "all" && i.status !== incidentFilterStatus) return false;
      if (incidentFilterSeverity !== "all" && i.severity !== incidentFilterSeverity) return false;
      return true;
    });
  }, [incidentFilterSeverity, incidentFilterStatus, watch]);

  const criticalOpenCount = useMemo(() => watch.filter((i) => i.status === "open" && i.severity === "critical").length, [watch]);
  const warningOpenCount = useMemo(() => watch.filter((i) => i.status === "open" && i.severity === "warning").length, [watch]);
  const healthTone = criticalOpenCount > 0 ? "critical" : warningOpenCount > 0 ? "warning" : "ok";
  const permanentTasks = useMemo(
    () => schedules.filter((s) => s.frequency === "hourly"),
    [schedules]
  );
  const pagedIncidents = useMemo(() => pageSlice(filteredIncidents, incidentPage, PAGE_SIZE_INCIDENTS), [filteredIncidents, incidentPage]);
  const pagedSchedules = useMemo(() => pageSlice(schedules, schedulePage, PAGE_SIZE_DEFAULT), [schedules, schedulePage]);
  const pagedTasks = useMemo(() => pageSlice(filteredTasks, taskPage, PAGE_SIZE_DEFAULT), [filteredTasks, taskPage]);
  const activeRules = useMemo(() => rules.filter((r) => Number(r.is_active || 0) === 1), [rules]);
  const pagedRules = useMemo(() => pageSlice(activeRules, rulePage, PAGE_SIZE_ALERTS), [activeRules, rulePage]);
  const pagedDeliveries = useMemo(() => pageSlice(filteredDeliveries, deliveryPage, PAGE_SIZE_ALERTS), [filteredDeliveries, deliveryPage]);
  const effectiveRuleRecipients = ruleRecipientsPreset === "__custom__" ? ruleRecipientsCustom : ruleRecipientsPreset;

  useEffect(() => setIncidentPage(1), [incidentFilterStatus, incidentFilterSeverity]);
  useEffect(() => setTaskPage(1), [taskFilterPriority, taskFilterStatus]);
  useEffect(() => setDeliveryPage(1), [deliveryFilterSeverity, deliveryFilterStatus]);
  useEffect(() => setIncidentPage((p) => clampPage(p, filteredIncidents.length, PAGE_SIZE_INCIDENTS)), [filteredIncidents.length]);
  useEffect(() => setSchedulePage((p) => clampPage(p, schedules.length, PAGE_SIZE_DEFAULT)), [schedules.length]);
  useEffect(() => setTaskPage((p) => clampPage(p, filteredTasks.length, PAGE_SIZE_DEFAULT)), [filteredTasks.length]);
  useEffect(() => setRulePage((p) => clampPage(p, activeRules.length, PAGE_SIZE_ALERTS)), [activeRules.length]);
  useEffect(() => setDeliveryPage((p) => clampPage(p, filteredDeliveries.length, PAGE_SIZE_ALERTS)), [filteredDeliveries.length]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      PANEL_PREFS_KEY,
      JSON.stringify({ showIncidents, showSchedules, showTasks, showAlerts })
    );
  }, [showIncidents, showSchedules, showTasks, showAlerts]);

  async function loadAll(silent = false) {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const [schedRes, tasksRes, rulesRes, delRes, dashRes, watchRes] = await Promise.all([
        apiRequest<{ ok: true; items: ScheduleItem[] }>("/api/qrt/schedules"),
        apiRequest<{ ok: true; items: TaskItem[] }>("/api/qrt/tasks"),
        apiRequest<{ ok: true; items: AlertRuleItem[] }>("/api/qrt/alerts/rules"),
        apiRequest<{ ok: true; items: DeliveryItem[] }>("/api/qrt/alerts/deliveries"),
        apiRequest<QrtDashboard>("/api/qrt/dashboard"),
        apiRequest<{ ok: true; items: IncidentWatchItem[] }>("/api/qrt/incidents/watch"),
      ]);
      setSchedules(schedRes.items || []);
      setTasks(tasksRes.items || []);
      setRules(rulesRes.items || []);
      setDeliveries(delRes.items || []);
      setDash(dashRes || null);
      setWatch(watchRes.items || []);
      setLastRefreshAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur chargement");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      loadAll(true);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [autoRefresh]);

  async function runNow(scheduleId: number) {
    try {
      await apiRequest(`/api/qrt/schedules/${scheduleId}/run-now`, "POST", {});
      await loadAll(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur exécution planning");
    }
  }

  function openCreateScheduleModal() {
    setEditingScheduleId(null);
    setScheduleEditName("Nouveau planning");
    setScheduleEditCode("alerts_scan");
    setScheduleEditFrequency("hourly");
    setScheduleEditHourUtc("0");
    setScheduleEditMinuteUtc("0");
    setScheduleEditDayOfWeek("");
    setScheduleEditDayOfMonth("");
    setScheduleEditPayload(JSON.stringify({ since_minutes: 60 }, null, 2));
    setScheduleEditIsActive(true);
    setScheduleEditOpen(true);
  }

  function openEditScheduleModal(s: ScheduleItem) {
    setEditingScheduleId(Number(s.id));
    setScheduleEditName(String(s.name || ""));
    setScheduleEditCode(s.job_code);
    setScheduleEditFrequency(s.frequency);
    setScheduleEditHourUtc(String(Number(s.hour_utc ?? 0)));
    setScheduleEditMinuteUtc(String(Number(s.minute_utc ?? 0)));
    setScheduleEditDayOfWeek(s.day_of_week == null ? "" : String(Number(s.day_of_week)));
    setScheduleEditDayOfMonth(s.day_of_month == null ? "" : String(Number(s.day_of_month)));
    setScheduleEditPayload(JSON.stringify(parseSchedulePayload(s.payload_json), null, 2));
    setScheduleEditIsActive(Number(s.is_active || 0) === 1);
    setScheduleEditOpen(true);
  }

  async function saveScheduleEdit() {
    try {
      setLoading(true);
      let payloadObj: Record<string, unknown> = {};
      const rawPayload = String(scheduleEditPayload || "").trim();
      if (rawPayload) {
        try {
          const parsed = JSON.parse(rawPayload);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("payload_json_invalid");
          payloadObj = parsed as Record<string, unknown>;
        } catch {
          throw new Error("payload_json_invalid");
        }
      }
      const hourUtc = Math.max(0, Math.min(23, Number(scheduleEditHourUtc || 0)));
      const minuteUtc = Math.max(0, Math.min(59, Number(scheduleEditMinuteUtc || 0)));
      const dayOfWeek = scheduleEditFrequency === "weekly" ? Math.max(0, Math.min(6, Number(scheduleEditDayOfWeek || 0))) : null;
      const dayOfMonth = scheduleEditFrequency === "monthly" ? Math.max(1, Math.min(28, Number(scheduleEditDayOfMonth || 1))) : null;
      if (editingScheduleId == null) {
        await apiRequest("/api/qrt/schedules", "POST", {
          name: scheduleEditName,
          job_code: scheduleEditCode,
          frequency: scheduleEditFrequency,
          hour_utc: Number.isFinite(hourUtc) ? hourUtc : 0,
          minute_utc: Number.isFinite(minuteUtc) ? minuteUtc : 0,
          day_of_week: dayOfWeek,
          day_of_month: dayOfMonth,
          payload_json: payloadObj,
          is_active: scheduleEditIsActive,
        });
      } else {
        await apiRequest(`/api/qrt/schedules/${editingScheduleId}`, "PATCH", {
          name: scheduleEditName,
          frequency: scheduleEditFrequency,
          hour_utc: Number.isFinite(hourUtc) ? hourUtc : 0,
          minute_utc: Number.isFinite(minuteUtc) ? minuteUtc : 0,
          day_of_week: dayOfWeek,
          day_of_month: dayOfMonth,
          payload_json: payloadObj,
          is_active: scheduleEditIsActive,
        });
      }
      setScheduleEditOpen(false);
      setEditingScheduleId(null);
      await loadAll(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur modification planning");
    } finally {
      setLoading(false);
    }
  }

  async function deleteSchedule(scheduleId: number) {
    const ok = window.confirm(`Supprimer la ligne planning #${scheduleId} ?`);
    if (!ok) return;
    try {
      await apiRequest(`/api/qrt/schedules/${scheduleId}`, "DELETE");
      await loadAll(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur suppression planning");
    }
  }

  async function setPermanentTaskActive(s: ScheduleItem, active: boolean) {
    try {
      await apiRequest(`/api/qrt/schedules/${s.id}`, "PATCH", {
        name: s.name,
        frequency: s.frequency,
        hour_utc: s.hour_utc ?? 0,
        minute_utc: s.minute_utc ?? 0,
        day_of_week: s.day_of_week ?? null,
        day_of_month: s.day_of_month ?? null,
        payload_json: s.payload_json || {},
        is_active: active,
      });
      await loadAll(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur changement statut tâche permanente");
    }
  }

  async function createTask() {
    try {
      setLoading(true);
      await apiRequest("/api/qrt/tasks", "POST", {
        title: taskTitle,
        priority: taskPriority,
        due_date: taskDueDate || null,
        status: "todo",
      });
      setTaskTitle("");
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur création tâche");
    } finally {
      setLoading(false);
    }
  }

  async function patchTaskStatus(taskId: number, nextStatus: TaskItem["status"]) {
    try {
      await apiRequest(`/api/qrt/tasks/${taskId}`, "PATCH", { status: nextStatus });
      await loadAll(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur mise à jour tâche");
    }
  }

  function openCreateRuleModal() {
    setEditingRuleId(null);
    setRuleEventCode("workflow.failed");
    setRuleSeverity("critical");
    setRuleMinEscalation("0");
    setRuleMaxEscalation("");
    setRuleRecipientsPreset("ops@myoptiwealth.fr");
    setRuleRecipientsCustom("");
    setRuleCooldownMinutes("30");
    setRuleIsActive(true);
    setRuleModalOpen(true);
  }

  function openEditRuleModal(rule: AlertRuleItem) {
    setEditingRuleId(Number(rule.id));
    setRuleEventCode(String(rule.event_code || "workflow.failed"));
    setRuleSeverity(rule.severity || "warning");
    setRuleMinEscalation(String(Number(rule.min_escalation_level || 0)));
    setRuleMaxEscalation(rule.max_escalation_level == null ? "" : String(Number(rule.max_escalation_level)));
    const preset = ALERT_RECIPIENT_OPTIONS.find((o) => o.value !== "__custom__" && o.value === String(rule.recipients_csv || "").trim());
    setRuleRecipientsPreset(preset ? preset.value : "__custom__");
    setRuleRecipientsCustom(preset ? "" : String(rule.recipients_csv || ""));
    setRuleCooldownMinutes(String(Number(rule.cooldown_minutes || 30)));
    setRuleIsActive(Number(rule.is_active || 0) === 1);
    setRuleModalOpen(true);
  }

  async function saveRule() {
    try {
      setLoading(true);
      const minEsc = Math.max(0, Math.min(9, Number(ruleMinEscalation || 0)));
      const maxEsc = ruleMaxEscalation.trim() === "" ? null : Math.max(0, Math.min(9, Number(ruleMaxEscalation)));
      const cooldown = Math.max(0, Math.min(1440, Number(ruleCooldownMinutes || 30)));
      const payload = {
        event_code: ruleEventCode,
        severity: ruleSeverity,
        min_escalation_level: Number.isFinite(minEsc) ? minEsc : 0,
        max_escalation_level: maxEsc != null && Number.isFinite(maxEsc) ? maxEsc : null,
        recipients_csv: effectiveRuleRecipients,
        cooldown_minutes: Number.isFinite(cooldown) ? cooldown : 30,
        is_active: ruleIsActive,
      };
      if (editingRuleId == null) {
        await apiRequest("/api/qrt/alerts/rules", "POST", payload);
      } else {
        await apiRequest(`/api/qrt/alerts/rules/${editingRuleId}`, "PATCH", payload);
      }
      setRuleRecipientsCustom("");
      setRuleModalOpen(false);
      setEditingRuleId(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur enregistrement règle alerte");
    } finally {
      setLoading(false);
    }
  }

  async function deleteRule(ruleId: number) {
    const ok = window.confirm(`Supprimer la règle #${ruleId} ?`);
    if (!ok) return;
    try {
      await apiRequest(`/api/qrt/alerts/rules/${ruleId}`, "PATCH", { is_active: false });
      await loadAll(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur suppression règle alerte");
    }
  }

  async function scanAlerts() {
    try {
      const rsp = await apiRequest<AlertsScanResponse>("/api/qrt/alerts/scan", "POST", { since_minutes: 60 });
      const findings = Array.isArray(rsp?.findings) ? rsp.findings : [];
      const detected = findings.reduce((acc, f) => acc + Number(f?.count || 0), 0);
      const queued = findings.reduce((acc, f) => acc + Number(f?.jobs || 0), 0);
      const details = findings.length
        ? findings.map((f) => `${labelAlertEventCode(String(f?.event_code || "unknown"))}: ${Number(f?.count || 0)} erreur(s), ${Number(f?.jobs || 0)} alerte(s) préparée(s)`)
        : ["Aucune erreur détectée sur la fenêtre de scan."];
      details.unshift(`Fenêtre analysée: ${Number(rsp?.scan_window_minutes || 60)} minute(s)`);
      setScanFeedback({
        updated: detected > 0 || queued > 0,
        summary: detected > 0 || queued > 0 ? "Le scan a détecté des erreurs et préparé des alertes." : "Le scan est terminé: aucune erreur détectée.",
        details,
      });
      await loadAll(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur scan alertes");
    }
  }

  async function syncIncidents() {
    try {
      const rsp = await apiRequest<IncidentsSyncResponse>("/api/qrt/incidents/sync", "POST", {});
      const inserted = Number(rsp?.sync?.inserted || 0);
      const reopened = Number(rsp?.sync?.reopened || 0);
      const refreshed = Number(rsp?.sync?.refreshed || 0);
      const resolved = Number(rsp?.sync?.resolved || 0);
      const escalated = Number(rsp?.escalation?.escalated || 0);
      const changes = inserted + reopened + refreshed + resolved + escalated;
      const details = [
        `Incidents détectés: ${Number(rsp?.sync?.detected_count || 0)}`,
        `Nouveaux incidents: ${inserted}`,
        `Incidents réouverts: ${reopened}`,
        `Incidents rafraîchis: ${refreshed}`,
        `Incidents résolus: ${resolved}`,
        `Escalades envoyées: ${escalated}`,
      ];
      setSyncFeedback({
        updated: changes > 0,
        summary: changes > 0 ? "La synchronisation a mis à jour des incidents." : "Aucune mise à jour détectée.",
        details,
      });
      await loadAll(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur sync incidents");
    }
  }

  async function assignIncident(i: IncidentWatchItem) {
    const owner = window.prompt("Responsable (email/nom):", i.owner_name || "")?.trim() || "";
    if (!owner) return;
    const slaRaw = window.prompt("SLA d'acquittement (minutes):", String(i.sla_minutes || 240))?.trim() || "";
    const sla = Number(slaRaw || i.sla_minutes || 240);
    try {
      await apiRequest(`/api/qrt/incidents/watch/${i.id}`, "PATCH", {
        action: "assign",
        owner_name: owner,
        sla_minutes: Number.isFinite(sla) ? sla : i.sla_minutes,
      });
      await loadAll(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur assign incident");
    }
  }

  async function ackIncident(i: IncidentWatchItem) {
    const notes = window.prompt("Notes d'acquittement (optionnel):", "") || "";
    try {
      await apiRequest(`/api/qrt/incidents/watch/${i.id}`, "PATCH", {
        action: "ack",
        notes_text: notes,
      });
      await loadAll(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur ack incident");
    }
  }

  async function resolveIncident(i: IncidentWatchItem) {
    try {
      await apiRequest(`/api/qrt/incidents/watch/${i.id}`, "PATCH", { action: "resolve" });
      await loadAll(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur resolve incident");
    }
  }

  return (
    <RequireAuth>
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageTitle
            title="Opérations QRT"
            description="Cockpit d’exploitation: plannings, tâches, incidents, alertes."
          />
          <div className="flex items-center gap-2">
            <button onClick={() => setAutoRefresh((v) => !v)} className={`rounded border px-3 py-1.5 text-sm ${autoRefresh ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-white text-slate-700"}`}>
              Actualisation auto {autoRefresh ? "ACTIVÉE" : "DÉSACTIVÉE"}
            </button>
            <Link href="/dashboard" className="rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-700">Retour tableau de bord</Link>
            <button onClick={() => loadAll()} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white">Rafraîchir</button>
          </div>
        </div>

        <div className="text-xs text-slate-500">Dernière actualisation: {fmtTs(lastRefreshAt)}</div>
        {error ? <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
        {syncFeedback ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-20">
            <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
              <h3 className="text-base font-semibold text-slate-900">Résultat de la synchronisation</h3>
              <p className={`mt-2 text-sm ${syncFeedback.updated ? "text-emerald-700" : "text-slate-700"}`}>{syncFeedback.summary}</p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {syncFeedback.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
              <div className="mt-4 flex justify-end">
                <button onClick={() => setSyncFeedback(null)} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white">
                  Fermer
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {scanFeedback ? (
          <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-20">
            <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
              <h3 className="text-base font-semibold text-slate-900">Résultat du scan erreurs</h3>
              <p className={`mt-2 text-sm ${scanFeedback.updated ? "text-amber-700" : "text-slate-700"}`}>{scanFeedback.summary}</p>
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-700">
                {scanFeedback.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
              <div className="mt-4 flex justify-end">
                <button onClick={() => setScanFeedback(null)} className="rounded-md bg-slate-900 px-3 py-1.5 text-sm text-white">
                  Fermer
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <section className={`rounded-xl border p-4 ${healthTone === "critical" ? "border-rose-200 bg-rose-50" : healthTone === "warning" ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">{healthTone === "critical" ? "Statut: incident critique" : healthTone === "warning" ? "Statut: vigilance" : "Statut: nominal"}</h2>
              <p className="text-sm">{criticalOpenCount} incident(s) critique(s) ouverts • {warningOpenCount} avertissement(s) ouverts</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="group relative">
                <button onClick={syncIncidents} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm">Synchroniser incidents</button>
                <div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-80 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  Lance immédiatement la détection des incidents, met à jour leur état et déclenche les escalades si le SLA est dépassé.
                </div>
              </div>
              <div className="group relative">
                <button onClick={scanAlerts} className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm">Scan erreurs</button>
                <div className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-80 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  Analyse les erreurs récentes (workflow, soumission, webhook) et prépare les notifications mail selon les règles d’alerte.
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Tâches à faire</div><div className="text-xl font-semibold">{metrics.todo}</div></div>
          <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Tâches bloquées</div><div className="text-xl font-semibold">{metrics.blocked}</div></div>
          <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Tâches en retard</div><div className="text-xl font-semibold">{metrics.overdue}</div></div>
          <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Plannings actifs</div><div className="text-xl font-semibold">{metrics.activeSchedules}</div></div>
          <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Prochaine exécution</div><div className="text-sm font-medium">{fmtTs(metrics.nextRun)}</div></div>
          <div className="rounded-lg border border-slate-200 bg-white p-3"><div className="text-xs text-slate-500">Alertes mail KO (7j)</div><div className="text-xl font-semibold">{metrics.failedAlerts}</div></div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Incidents d’exploitation</h2>
            <button onClick={() => setShowIncidents((v) => !v)} className="rounded border border-slate-300 px-2 py-1 text-xs">
              {showIncidents ? "Masquer" : "Afficher"}
            </button>
          </div>
          {showIncidents ? (
            <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Filtres:</span>
            <select value={incidentFilterStatus} onChange={(e) => setIncidentFilterStatus(e.target.value as "all" | IncidentWatchItem["status"])} className="rounded border border-slate-300 px-2 py-1">
              <option value="all">statut: tous</option>
              <option value="open">ouvert</option>
              <option value="acked">acquitté</option>
              <option value="resolved">résolu</option>
            </select>
            <select value={incidentFilterSeverity} onChange={(e) => setIncidentFilterSeverity(e.target.value as "all" | IncidentWatchItem["severity"])} className="rounded border border-slate-300 px-2 py-1">
              <option value="all">sévérité: toutes</option>
              <option value="critical">critique</option>
              <option value="warning">avertissement</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2">Incident</th>
                  <th>Statut</th>
                  <th>Sévérité</th>
                  <th>Responsable</th>
                  <th>SLA échéance</th>
                  <th>Escalade</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedIncidents.map((i) => {
                  const overdue = isIncidentOverdueAck(i.status, i.ack_due_at);
                  return (
                    <tr key={i.id} className="border-t border-slate-100">
                      <td className="py-2">
                        <div className="font-medium">{i.title_text}</div>
                        <div className="text-xs text-slate-500">{i.detail_text || "—"}</div>
                      </td>
                      <td><span className={`rounded-full px-2 py-0.5 text-xs ${statusClass(i.status)}`}>{labelStatus(i.status)}</span></td>
                      <td><span className={`rounded-full px-2 py-0.5 text-xs ${statusClass(i.severity)}`}>{labelSeverity(i.severity)}</span></td>
                      <td className="text-xs">{i.owner_name || "—"}</td>
                      <td className={`text-xs ${overdue ? "text-rose-700" : ""}`}>{fmtTs(i.ack_due_at)}</td>
                      <td className="text-xs">{i.escalation_count || 0}</td>
                      <td>
                        <div className="flex flex-wrap items-center gap-1">
                          <div className="group relative">
                            <button onClick={() => assignIncident(i)} className="rounded border border-slate-300 px-2 py-1 text-xs">Assigner</button>
                            <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 w-64 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                              Attribuer cet incident à un responsable et fixer le SLA d&apos;acquittement.
                            </div>
                          </div>
                          <div className="group relative">
                            <button onClick={() => ackIncident(i)} className="rounded border border-slate-300 px-2 py-1 text-xs">Acquitter</button>
                            <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 w-64 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                              Confirmer la prise en charge de l&apos;incident et ajouter une note optionnelle.
                            </div>
                          </div>
                          <div className="group relative">
                            <button onClick={() => resolveIncident(i)} className="rounded border border-slate-300 px-2 py-1 text-xs">Résoudre</button>
                            <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 w-64 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                              Clôturer l&apos;incident une fois le problème corrigé.
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!filteredIncidents.length ? <tr><td colSpan={7} className="py-4 text-center text-slate-500">Aucun incident avec ce filtre</td></tr> : null}
              </tbody>
            </table>
          </div>
          <Pager total={filteredIncidents.length} page={incidentPage} onPage={setIncidentPage} pageSize={PAGE_SIZE_INCIDENTS} />
            </>
          ) : null}
        </section>

        {scheduleDetail ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl max-h-[90vh] overflow-y-auto">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">Détails du planning #{scheduleDetail.id}</h3>
                <button onClick={() => setScheduleDetail(null)} className="rounded border border-slate-300 px-2 py-1 text-xs">Fermer</button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded border border-slate-200 p-3">
                  <div className="text-xs text-slate-500">Nom</div>
                  <div className="text-sm font-medium text-slate-900">{scheduleDetail.name}</div>
                </div>
                <div className="rounded border border-slate-200 p-3">
                  <div className="text-xs text-slate-500">Type opération</div>
                  <div className="text-sm font-medium text-slate-900">{labelScheduleCode(scheduleDetail.job_code)} ({scheduleDetail.job_code})</div>
                </div>
                <div className="rounded border border-slate-200 p-3">
                  <div className="text-xs text-slate-500">Cadence d&apos;exécution</div>
                  <div className="text-sm font-medium text-slate-900">{scheduleCadenceLabel(scheduleDetail)}</div>
                </div>
                <div className="rounded border border-slate-200 p-3">
                  <div className="text-xs text-slate-500">Statut planning</div>
                  <div className="text-sm font-medium text-slate-900">
                    {Number(scheduleDetail.is_active || 0) === 1 ? "Actif" : "Inactif"} • dernier run: {fmtTs(scheduleDetail.last_run_at)} • prochain run: {fmtTs(scheduleDetail.next_run_at)}
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded border border-slate-200 p-3">
                <div className="text-sm font-semibold text-slate-900">Ce qui sera exécuté quand vous cliquez sur &quot;Exécuter&quot;</div>
                <div className="mt-1 text-sm text-slate-700">{scheduleOperationDetails(scheduleDetail.job_code).summary}</div>
                <div className="mt-2 text-xs font-medium text-slate-800">Séquence détaillée:</div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {scheduleOperationDetails(scheduleDetail.job_code).steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ul>
                <div className="mt-2 text-xs font-medium text-slate-800">Impacts et traçabilité:</div>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700">
                  {scheduleOperationDetails(scheduleDetail.job_code).impacts.map((impact) => (
                    <li key={impact}>{impact}</li>
                  ))}
                </ul>
              </div>

              <div className="mt-4 rounded border border-slate-200 p-3">
                <div className="text-sm font-semibold text-slate-900">Paramètres configurés (payload)</div>
                <pre className="mt-2 overflow-auto rounded bg-slate-50 p-2 text-xs text-slate-700">
{JSON.stringify(parseSchedulePayload(scheduleDetail.payload_json), null, 2)}
                </pre>
                <div className="mt-2 text-xs text-slate-500">
                  Cette section montre exactement les paramètres actuellement définis pour ce planning. En l&apos;absence de paramètre, le worker applique ses valeurs par défaut.
                </div>
                {scheduleDetail.last_error ? (
                  <div className="mt-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
                    Dernière erreur connue: {scheduleDetail.last_error}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {scheduleEditOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl max-h-[90vh] overflow-y-auto">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">{editingScheduleId == null ? "Ajouter un planning" : `Modifier planning #${editingScheduleId}`}</h3>
                <button onClick={() => setScheduleEditOpen(false)} className="rounded border border-slate-300 px-2 py-1 text-xs">Fermer</button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="text-sm text-slate-700">
                  Nom
                  <input value={scheduleEditName} onChange={(e) => setScheduleEditName(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
                </label>
                {editingScheduleId == null ? (
                  <label className="text-sm text-slate-700">
                    Type
                    <select value={scheduleEditCode} onChange={(e) => setScheduleEditCode(e.target.value as ScheduleItem["job_code"])} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
                      <option value="alerts_scan">scan_alertes</option>
                      <option value="monthly_closure">cloture_mensuelle</option>
                      <option value="retry_auto">relance_auto</option>
                      <option value="retention">retention</option>
                      <option value="submission_prepare">preparation_soumission</option>
                    </select>
                  </label>
                ) : (
                  <label className="text-sm text-slate-700">
                    Type (lecture seule)
                    <input value={`${labelScheduleCode(scheduleEditCode)} (${scheduleEditCode})`} readOnly className="mt-1 w-full rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-600" />
                  </label>
                )}
                <label className="text-sm text-slate-700">
                  Fréquence
                  <select value={scheduleEditFrequency} onChange={(e) => setScheduleEditFrequency(e.target.value as ScheduleItem["frequency"])} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
                    <option value="hourly">horaire</option>
                    <option value="daily">quotidienne</option>
                    <option value="weekly">hebdomadaire</option>
                    <option value="monthly">mensuelle</option>
                  </select>
                </label>
                <label className="text-sm text-slate-700">
                  Actif
                  <div className="mt-2">
                    <input type="checkbox" checked={scheduleEditIsActive} onChange={(e) => setScheduleEditIsActive(e.target.checked)} />
                  </div>
                </label>
                <label className="text-sm text-slate-700">
                  Heure UTC (0-23)
                  <input value={scheduleEditHourUtc} onChange={(e) => setScheduleEditHourUtc(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
                </label>
                <label className="text-sm text-slate-700">
                  Minute UTC (0-59)
                  <input value={scheduleEditMinuteUtc} onChange={(e) => setScheduleEditMinuteUtc(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
                </label>
                {scheduleEditFrequency === "weekly" ? (
                  <label className="text-sm text-slate-700">
                    Jour semaine (0-6)
                    <input value={scheduleEditDayOfWeek} onChange={(e) => setScheduleEditDayOfWeek(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
                  </label>
                ) : null}
                {scheduleEditFrequency === "monthly" ? (
                  <label className="text-sm text-slate-700">
                    Jour mois (1-28)
                    <input value={scheduleEditDayOfMonth} onChange={(e) => setScheduleEditDayOfMonth(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
                  </label>
                ) : null}
              </div>
              <label className="mt-3 block text-sm text-slate-700">
                Paramètres JSON (payload)
                <textarea
                  value={scheduleEditPayload}
                  onChange={(e) => setScheduleEditPayload(e.target.value)}
                  rows={8}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs font-mono"
                />
              </label>
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setScheduleEditOpen(false)} className="rounded border border-slate-300 px-3 py-1.5 text-sm">Annuler</button>
                <button onClick={saveScheduleEdit} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white">{editingScheduleId == null ? "Créer planning" : "Enregistrer"}</button>
              </div>
            </div>
          </div>
        ) : null}

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Plannings</h2>
            <div className="flex items-center gap-2">
              <button onClick={openCreateScheduleModal} className="rounded bg-slate-900 px-2 py-1 text-xs text-white">Ajouter</button>
              <button onClick={() => setShowSchedules((v) => !v)} className="rounded border border-slate-300 px-2 py-1 text-xs">
                {showSchedules ? "Masquer" : "Afficher"}
              </button>
            </div>
          </div>
          {showSchedules ? (
            <>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-slate-500"><th className="py-2">Nom</th><th>Type</th><th>Fréquence</th><th>Prochaine exécution</th><th>Dernier statut</th><th>Actions</th></tr></thead>
              <tbody>
                {pagedSchedules.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="py-2">{s.name}</td>
                    <td>{labelScheduleCode(s.job_code)}</td>
                    <td>{labelFrequency(s.frequency)}</td>
                    <td>{fmtTs(s.next_run_at)}</td>
                    <td><span className={`rounded-full px-2 py-0.5 text-xs ${statusClass(s.last_status)}`}>{labelStatus(s.last_status)}</span></td>
                    <td className="space-x-1">
                      <button onClick={() => setScheduleDetail(s)} className="rounded border border-slate-300 px-2 py-1 text-xs">Détails</button>
                      <button onClick={() => openEditScheduleModal(s)} className="rounded border border-slate-300 px-2 py-1 text-xs">Modifier</button>
                      <button onClick={() => runNow(s.id)} className="rounded border border-slate-300 px-2 py-1 text-xs">Exécuter</button>
                      <button onClick={() => deleteSchedule(s.id)} className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-700">Supprimer</button>
                    </td>
                  </tr>
                ))}
                {!schedules.length ? <tr><td colSpan={6} className="py-4 text-center text-slate-500">Aucun planning</td></tr> : null}
              </tbody>
            </table>
          </div>
          <Pager total={schedules.length} page={schedulePage} onPage={setSchedulePage} />
            </>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Tâches</h2>
            <button onClick={() => setShowTasks((v) => !v)} className="rounded border border-slate-300 px-2 py-1 text-xs">
              {showTasks ? "Masquer" : "Afficher"}
            </button>
          </div>
          {showTasks ? (
            <>
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-2 text-sm font-semibold text-slate-800">Tâches permanentes</div>
            <div className="space-y-2">
              {permanentTasks.map((s) => {
                const active = Number(s.is_active || 0) === 1;
                return (
                  <div key={`perm-${s.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm">
                    <div>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-slate-500">{labelScheduleCode(s.job_code)} • prochaine exécution: {fmtTs(s.next_run_at)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-700"}`}>
                        {active ? "active" : "bloquée"}
                      </span>
                      {active ? (
                        <button onClick={() => setPermanentTaskActive(s, false)} className="rounded border border-slate-300 px-2 py-1 text-xs">
                          Bloquer
                        </button>
                      ) : (
                        <button onClick={() => setPermanentTaskActive(s, true)} className="rounded border border-slate-300 px-2 py-1 text-xs">
                          Relancer
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {!permanentTasks.length ? <div className="text-xs text-slate-500">Aucune tâche permanente détectée (fréquence horaire).</div> : null}
            </div>
          </div>

          <div className="mb-4 grid gap-2 md:grid-cols-4">
            <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} className="rounded border border-slate-300 px-2 py-1.5 text-sm" placeholder="Titre tâche" />
            <select value={taskPriority} onChange={(e) => setTaskPriority(e.target.value as TaskItem["priority"])} className="rounded border border-slate-300 px-2 py-1.5 text-sm">
              <option value="normal">normale</option>
              <option value="high">haute</option>
              <option value="critical">critique</option>
              <option value="low">basse</option>
            </select>
            <input value={taskDueDate} onChange={(e) => setTaskDueDate(e.target.value)} type="date" className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
            <button disabled={loading || !taskTitle.trim()} onClick={createTask} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">Ajouter tâche</button>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500">Filtres:</span>
            <select value={taskFilterStatus} onChange={(e) => setTaskFilterStatus(e.target.value as "all" | TaskItem["status"])} className="rounded border border-slate-300 px-2 py-1 text-xs">
              <option value="all">statut: tous</option>
              <option value="todo">à faire</option>
              <option value="in_progress">en cours</option>
              <option value="blocked">bloquée</option>
              <option value="done">terminée</option>
            </select>
            <select value={taskFilterPriority} onChange={(e) => setTaskFilterPriority(e.target.value as "all" | TaskItem["priority"])} className="rounded border border-slate-300 px-2 py-1 text-xs">
              <option value="all">priorité: toutes</option>
              <option value="critical">critique</option>
              <option value="high">haute</option>
              <option value="normal">normale</option>
              <option value="low">basse</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-slate-500"><th className="py-2">Titre</th><th>Priorité</th><th>Statut</th><th>Échéance</th><th></th></tr></thead>
              <tbody>
                {pagedTasks.map((t) => (
                  <tr key={t.id} className="border-t border-slate-100">
                    <td className="py-2">{t.title}</td>
                    <td><span className={`rounded-full px-2 py-0.5 text-xs ${priorityClass(t.priority)}`}>{labelPriority(t.priority)}</span></td>
                    <td><span className={`rounded-full px-2 py-0.5 text-xs ${statusClass(t.status)}`}>{labelStatus(t.status)}</span></td>
                    <td className={isOverdueDate(t.due_date) && t.status !== "done" ? "text-rose-700" : ""}>{t.due_date || "—"}</td>
                    <td className="space-x-1">
                      <button onClick={() => patchTaskStatus(t.id, "in_progress")} className="rounded border border-slate-300 px-2 py-1 text-xs">Démarrer</button>
                      <button onClick={() => patchTaskStatus(t.id, "done")} className="rounded border border-slate-300 px-2 py-1 text-xs">Terminer</button>
                      <button onClick={() => patchTaskStatus(t.id, "blocked")} className="rounded border border-slate-300 px-2 py-1 text-xs">Bloquer</button>
                    </td>
                  </tr>
                ))}
                {!filteredTasks.length ? <tr><td colSpan={5} className="py-4 text-center text-slate-500">Aucune tâche avec ce filtre</td></tr> : null}
              </tbody>
            </table>
          </div>
          <Pager total={filteredTasks.length} page={taskPage} onPage={setTaskPage} />
            </>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Alertes</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowAlerts((v) => !v)} className="rounded border border-slate-300 px-2 py-1 text-xs">
                {showAlerts ? "Masquer" : "Afficher"}
              </button>
              <div className="group relative">
                <button onClick={scanAlerts} className="rounded border border-slate-300 px-2 py-1 text-xs">Scan erreurs</button>
                <div className="pointer-events-none absolute right-0 top-full z-20 mt-2 w-80 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  Analyse les erreurs récentes (workflow, soumission, webhook) et prépare les notifications mail selon les règles d’alerte.
                </div>
              </div>
            </div>
          </div>
          {showAlerts ? (
            <>
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-700">Règles</h3>
                <div className="flex items-center gap-2">
                  <button onClick={openCreateRuleModal} className="rounded bg-slate-900 px-2 py-1 text-xs text-white">
                    Ajouter
                  </button>
                  <button onClick={() => setShowAlertRulesBlock((v) => !v)} className="rounded border border-slate-300 px-2 py-1 text-xs">
                    {showAlertRulesBlock ? "Masquer" : "Afficher"}
                  </button>
                </div>
              </div>
              {showAlertRulesBlock ? (
                <>
                  <div className="space-y-2">
                    {pagedRules.map((r) => (
                      <div key={r.id} className="rounded border border-slate-200 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium">Règle #{r.id} • {labelAlertEventCode(r.event_code)}</div>
                            <div className="text-xs text-slate-500">{r.event_code}</div>
                          </div>
                          <span className={`rounded-full px-2 py-0.5 text-xs ${statusClass(r.severity)}`}>{labelSeverity(r.severity)}</span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Escalade: L{r.min_escalation_level} à {r.max_escalation_level == null ? "ouvert" : `L${r.max_escalation_level}`}
                        </div>
                        <div className="mt-1 text-xs text-slate-600">Destinataires: {r.recipients_csv}</div>
                        <div className="mt-1 text-xs text-slate-600">Cooldown: {Number(r.cooldown_minutes || 0)} minute(s)</div>
                        <div className="mt-2 flex items-center gap-2">
                          <button onClick={() => openEditRuleModal(r)} className="rounded border border-slate-300 px-2 py-1 text-xs">Modifier</button>
                          <button onClick={() => deleteRule(r.id)} className="rounded border border-rose-300 px-2 py-1 text-xs text-rose-700">Supprimer</button>
                        </div>
                      </div>
                    ))}
                    {!activeRules.length ? <div className="text-sm text-slate-500">Aucune règle active.</div> : null}
                  </div>
                  <Pager total={activeRules.length} page={rulePage} onPage={setRulePage} pageSize={PAGE_SIZE_ALERTS} />
                </>
              ) : null}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-700">Dernières délivrances</h3>
                <button onClick={() => setShowAlertDeliveriesBlock((v) => !v)} className="rounded border border-slate-300 px-2 py-1 text-xs">
                  {showAlertDeliveriesBlock ? "Masquer" : "Afficher"}
                </button>
              </div>
              {showAlertDeliveriesBlock ? (
                <>
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    <select value={deliveryFilterStatus} onChange={(e) => setDeliveryFilterStatus(e.target.value as "all" | DeliveryItem["status"])} className="rounded border border-slate-300 px-2 py-1 text-xs">
                      <option value="all">statut: tous</option>
                      <option value="failed">échec</option>
                      <option value="queued">en file</option>
                      <option value="sent">envoyé</option>
                      <option value="skipped">ignoré</option>
                    </select>
                    <select value={deliveryFilterSeverity} onChange={(e) => setDeliveryFilterSeverity(e.target.value as "all" | DeliveryItem["severity"])} className="rounded border border-slate-300 px-2 py-1 text-xs">
                      <option value="all">sévérité: toutes</option>
                      <option value="critical">critique</option>
                      <option value="warning">avertissement</option>
                      <option value="info">information</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    {pagedDeliveries.map((d) => (
                      <div key={d.id} className="rounded border border-slate-200 px-3 py-2 text-sm">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="font-medium">Alerte #{d.id} • {labelAlertEventCode(d.event_code)}</div>
                            <div className="text-xs text-slate-500">{d.event_code}</div>
                            <div className={`text-xs ${d.rule_id == null ? "text-amber-700" : "text-slate-500"}`}>
                              {d.rule_id == null ? "Règle: non liée (envoi manuel/test)" : `Règle: #${d.rule_id}`}
                            </div>
                          </div>
                          <span className={`rounded-full px-2 py-0.5 text-xs ${statusClass(d.status)}`}>{labelStatus(d.status)}</span>
                        </div>
                        <div className="mt-1 text-xs text-slate-600">{fmtTs(d.created_at)}</div>
                        {d.error_text ? <div className="mt-1 text-xs text-rose-600">{d.error_text}</div> : null}
                      </div>
                    ))}
                    {!filteredDeliveries.length ? <div className="text-sm text-slate-500">Aucune délivrance avec ce filtre.</div> : null}
                  </div>
                  <Pager total={filteredDeliveries.length} page={deliveryPage} onPage={setDeliveryPage} pageSize={PAGE_SIZE_ALERTS} />
                </>
              ) : null}
            </div>
          </div>
          {ruleModalOpen ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
              <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl max-h-[90vh] overflow-y-auto">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-base font-semibold text-slate-900">{editingRuleId == null ? "Ajouter une règle" : `Modifier la règle #${editingRuleId}`}</h3>
                  <button onClick={() => setRuleModalOpen(false)} className="rounded border border-slate-300 px-2 py-1 text-xs">Fermer</button>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="text-sm text-slate-700">
                    Code événement
                    <select value={ruleEventCode} onChange={(e) => setRuleEventCode(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
                      {ALERT_EVENT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label} ({opt.value})</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-slate-700">
                    Sévérité
                    <select value={ruleSeverity} onChange={(e) => setRuleSeverity(e.target.value as AlertRuleItem["severity"])} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
                      <option value="critical">critique</option>
                      <option value="warning">avertissement</option>
                      <option value="info">information</option>
                    </select>
                  </label>
                  <label className="text-sm text-slate-700">
                    Escalade min (0-9)
                    <input value={ruleMinEscalation} onChange={(e) => setRuleMinEscalation(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
                  </label>
                  <label className="text-sm text-slate-700">
                    Escalade max (optionnel)
                    <input value={ruleMaxEscalation} onChange={(e) => setRuleMaxEscalation(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
                  </label>
                  <label className="text-sm text-slate-700">
                    Destinataires
                    <select value={ruleRecipientsPreset} onChange={(e) => setRuleRecipientsPreset(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm">
                      {ALERT_RECIPIENT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-slate-700">
                    Cooldown (minutes)
                    <input value={ruleCooldownMinutes} onChange={(e) => setRuleCooldownMinutes(e.target.value)} className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm" />
                  </label>
                </div>
                {ruleRecipientsPreset === "__custom__" ? (
                  <label className="mt-3 block text-sm text-slate-700">
                    Destinataires personnalisés (CSV)
                    <input
                      value={ruleRecipientsCustom}
                      onChange={(e) => setRuleRecipientsCustom(e.target.value)}
                      className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                      placeholder="ops@myoptiwealth.fr,risk@myoptiwealth.fr"
                    />
                  </label>
                ) : null}
                <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={ruleIsActive} onChange={(e) => setRuleIsActive(e.target.checked)} />
                  Règle active
                </label>
                <div className="mt-2 text-xs text-slate-500">
                  Cooldown = délai anti-spam: pendant cette durée, la même règle n&apos;envoie pas de nouvelle alerte identique.
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button onClick={() => setRuleModalOpen(false)} className="rounded border border-slate-300 px-3 py-1.5 text-sm">Annuler</button>
                  <button disabled={loading || !effectiveRuleRecipients.trim()} onClick={saveRule} className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">
                    {editingRuleId == null ? "Créer la règle" : "Enregistrer"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
            </>
          ) : null}
        </section>
      </div>
    </RequireAuth>
  );
}
