/**
 * Reportes de reclamaciones a ARS (solo de la clínica) -- cálculo PURO, sin Next ni
 * Supabase, para probarlo sin base de datos (scripts/test-claims-reports.ts). La
 * página /claims/reports lee los datos (filtrados por RLS) y esto los agrega.
 *
 * Definiciones:
 *   tasa de rechazo   rechazadas / (aprobadas + rechazadas); null si todavía no hay resueltas
 *   por cobrar        suma de (aprobado - cobrado, mínimo 0) de las reclamaciones aprobadas
 *   respuesta (días)  de la PRIMERA vez «enviada» a la primera resolución (aprobada o
 *                     rechazada) posterior, en días calendario de Santo Domingo; sale del historial
 *   antigüedad        días desde que se envió (sin respuesta) o desde que se aprobó (con saldo)
 */

import type { ExportTable } from "../bulk-import/export-tables";
import { CLAIM_STATUS_LABELS, CLAIM_STATUSES, type ClaimStatus } from "./claims";

export type ReportClaim = {
  id: string;
  status: string;
  claimed_amount: number | null;
  approved_amount: number | null;
  paid_amount: number | null;
  rejection_reason: string | null;
  created_at: string;
  /** Catálogo de ARS (id) o, si no hay, el nombre escrito normalizado con prefijo «name:». */
  insurer_key: string;
  insurer_label: string;
};

export type ReportTransition = { claim_id: string; to_status: string; changed_at: string };

export const AGING_BUCKETS = ["0–7 días", "8–15 días", "16–30 días", "31–60 días", "Más de 60 días"] as const;

export type AgingSummary = { buckets: { label: string; count: number; amount: number }[]; count: number; amount: number };

export type StatusCounts = Record<ClaimStatus, number>;

export type InsurerRow = {
  key: string;
  label: string;
  count: number;
  byStatus: StatusCounts;
  claimed: number;
  approved: number;
  paid: number;
  pending: number;
  rejectionRate: number | null;
  avgResponseDays: number | null;
};

export type ClaimsReport = {
  totals: {
    count: number;
    byStatus: StatusCounts;
    claimed: number;
    approved: number;
    paid: number;
    pending: number;
    rejectionRate: number | null;
    avgResponseDays: number | null;
  };
  byInsurer: InsurerRow[];
  byReason: { reason: string; count: number }[];
  sentWithoutResponse: AgingSummary;
  approvedWithBalance: AgingSummary;
};

/** "YYYY-MM-DD" en America/Santo_Domingo de un instante ISO. */
export function dateInSantoDomingo(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });
}

/** Días calendario entre dos fechas "YYYY-MM-DD" (b - a). */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/** Tramo de antigüedad (índice en AGING_BUCKETS) de una cantidad de días (negativos cuentan como 0). */
export function agingBucketIndex(days: number): number {
  const d = Math.max(days, 0);
  if (d <= 7) return 0;
  if (d <= 15) return 1;
  if (d <= 30) return 2;
  if (d <= 60) return 3;
  return 4;
}

/** Motivo de rechazo normalizado para agrupar: minúsculas, sin acentos, espacios colapsados. */
export function normalizeReason(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function emptyStatusCounts(): StatusCounts {
  return { pendiente: 0, enviada: 0, aprobada: 0, rechazada: 0 };
}

function rejectionRate(counts: StatusCounts): number | null {
  const resolved = counts.aprobada + counts.rechazada;
  return resolved === 0 ? null : counts.rechazada / resolved;
}

function pendingOf(c: Pick<ReportClaim, "status" | "approved_amount" | "paid_amount">): number {
  if (c.status !== "aprobada" || c.approved_amount === null) return 0;
  return Math.max(c.approved_amount - (c.paid_amount ?? 0), 0);
}

function emptyAging(): AgingSummary {
  return { buckets: AGING_BUCKETS.map((label) => ({ label, count: 0, amount: 0 })), count: 0, amount: 0 };
}

export function buildClaimsReport(claims: ReportClaim[], transitions: ReportTransition[], today: string): ClaimsReport {
  const byClaim = new Map<string, ReportTransition[]>();
  for (const t of transitions) {
    const list = byClaim.get(t.claim_id) ?? [];
    list.push(t);
    byClaim.set(t.claim_id, list);
  }
  for (const list of byClaim.values()) list.sort((a, b) => a.changed_at.localeCompare(b.changed_at));

  /** Fecha (día local) de la primera transición a `status`, o null. */
  const firstDate = (claimId: string, status: ClaimStatus): string | null => {
    const t = (byClaim.get(claimId) ?? []).find((x) => x.to_status === status);
    return t ? dateInSantoDomingo(t.changed_at) : null;
  };
  /** Días de respuesta de la ARS (primer «enviada» -> primera resolución posterior), o null. */
  const responseDays = (claimId: string): number | null => {
    const list = byClaim.get(claimId) ?? [];
    const sentIdx = list.findIndex((x) => x.to_status === "enviada");
    if (sentIdx < 0) return null;
    const resolved = list.slice(sentIdx + 1).find((x) => x.to_status === "aprobada" || x.to_status === "rechazada");
    if (!resolved) return null;
    return Math.max(daysBetween(dateInSantoDomingo(list[sentIdx].changed_at), dateInSantoDomingo(resolved.changed_at)), 0);
  };

  const totals = {
    count: claims.length,
    byStatus: emptyStatusCounts(),
    claimed: 0,
    approved: 0,
    paid: 0,
    pending: 0,
  };
  const insurers = new Map<string, InsurerRow & { _days: number[] }>();
  const reasons = new Map<string, { reason: string; count: number }>();
  const sent = emptyAging();
  const balance = emptyAging();
  const allDays: number[] = [];

  for (const c of claims) {
    const status = (CLAIM_STATUSES as readonly string[]).includes(c.status) ? (c.status as ClaimStatus) : "pendiente";
    totals.byStatus[status] += 1;
    totals.claimed += c.claimed_amount ?? 0;
    totals.approved += c.approved_amount ?? 0;
    totals.paid += c.paid_amount ?? 0;
    const pending = pendingOf(c);
    totals.pending += pending;

    let row = insurers.get(c.insurer_key);
    if (!row) {
      row = {
        key: c.insurer_key,
        label: c.insurer_label,
        count: 0,
        byStatus: emptyStatusCounts(),
        claimed: 0,
        approved: 0,
        paid: 0,
        pending: 0,
        rejectionRate: null,
        avgResponseDays: null,
        _days: [],
      };
      insurers.set(c.insurer_key, row);
    }
    row.count += 1;
    row.byStatus[status] += 1;
    row.claimed += c.claimed_amount ?? 0;
    row.approved += c.approved_amount ?? 0;
    row.paid += c.paid_amount ?? 0;
    row.pending += pending;
    const days = responseDays(c.id);
    if (days !== null) {
      row._days.push(days);
      allDays.push(days);
    }

    if (status === "rechazada" && c.rejection_reason && c.rejection_reason.trim() !== "") {
      const key = normalizeReason(c.rejection_reason);
      const existing = reasons.get(key);
      if (existing) existing.count += 1;
      else reasons.set(key, { reason: c.rejection_reason.trim(), count: 1 });
    }

    if (status === "enviada") {
      const since = firstDate(c.id, "enviada") ?? dateInSantoDomingo(c.created_at);
      const b = sent.buckets[agingBucketIndex(daysBetween(since, today))];
      const amount = c.claimed_amount ?? 0;
      b.count += 1;
      b.amount += amount;
      sent.count += 1;
      sent.amount += amount;
    }
    if (pending > 0) {
      const since = firstDate(c.id, "aprobada") ?? dateInSantoDomingo(c.created_at);
      const b = balance.buckets[agingBucketIndex(daysBetween(since, today))];
      b.count += 1;
      b.amount += pending;
      balance.count += 1;
      balance.amount += pending;
    }
  }

  const avg = (xs: number[]) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
  const byInsurer: InsurerRow[] = [...insurers.values()]
    .map(({ _days, ...row }) => ({ ...row, rejectionRate: rejectionRate(row.byStatus), avgResponseDays: avg(_days) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    totals: { ...totals, rejectionRate: rejectionRate(totals.byStatus), avgResponseDays: avg(allDays) },
    byInsurer,
    byReason: [...reasons.values()].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    sentWithoutResponse: sent,
    approvedWithBalance: balance,
  };
}

export const PERIOD_OPTIONS = [
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
  { value: "365", label: "Últimos 12 meses" },
  { value: "todo", label: "Todo el historial" },
] as const;

/** Fecha mínima ("YYYY-MM-DD") del periodo, o null si es «todo» o desconocido. */
export function periodStart(period: string, today: string): string | null {
  const days = Number(period);
  if (!Number.isFinite(days) || days <= 0) return null;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

const pct = (r: number | null) => (r === null ? "" : `${(r * 100).toFixed(1)} %`);
const num = (n: number | null) => (n === null ? "" : Math.round(n * 10) / 10);

/** El reporte como tablas (una hoja cada una) para la descarga en Excel. */
export function reportTables(report: ClaimsReport): ExportTable[] {
  const { totals } = report;
  return [
    {
      name: "Resumen",
      headers: ["Indicador", "Valor"],
      rows: [
        ["Reclamaciones", totals.count],
        ...CLAIM_STATUSES.map((s) => [CLAIM_STATUS_LABELS[s], totals.byStatus[s]] as [string, number]),
        ["Total reclamado", totals.claimed],
        ["Total aprobado", totals.approved],
        ["Total cobrado", totals.paid],
        ["Por cobrar", totals.pending],
        ["Tasa de rechazo", pct(totals.rejectionRate)],
        ["Días promedio de respuesta de la ARS", num(totals.avgResponseDays)],
      ],
    },
    {
      name: "Por ARS",
      headers: [
        "ARS",
        "Reclamaciones",
        "Pendientes",
        "Enviadas",
        "Aprobadas",
        "Rechazadas",
        "Reclamado",
        "Aprobado",
        "Cobrado",
        "Por cobrar",
        "Tasa de rechazo",
        "Días promedio de respuesta",
      ],
      rows: report.byInsurer.map((r) => [
        r.label,
        r.count,
        r.byStatus.pendiente,
        r.byStatus.enviada,
        r.byStatus.aprobada,
        r.byStatus.rechazada,
        r.claimed,
        r.approved,
        r.paid,
        r.pending,
        pct(r.rejectionRate),
        num(r.avgResponseDays),
      ]),
    },
    { name: "Motivos de rechazo", headers: ["Motivo", "Reclamaciones"], rows: report.byReason.map((r) => [r.reason, r.count]) },
    {
      name: "Antigüedad",
      headers: ["Tramo", "Enviadas sin respuesta", "Monto reclamado", "Aprobadas con saldo", "Saldo por cobrar"],
      rows: AGING_BUCKETS.map((label, i) => [
        label,
        report.sentWithoutResponse.buckets[i].count,
        report.sentWithoutResponse.buckets[i].amount,
        report.approvedWithBalance.buckets[i].count,
        report.approvedWithBalance.buckets[i].amount,
      ]),
    },
  ];
}
