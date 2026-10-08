import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../supabase/database.types";
import { insurerKey } from "../domain/claims";
import {
  buildClaimsReport,
  periodStart,
  type ClaimsReport,
  type ReportClaim,
  type ReportTransition,
} from "../domain/claims-report";
import { fetchAllPages } from "./fetch-all";
import { todayInSantoDomingo } from "./export-tables";

// Deliberadamente SIN `import "server-only"` -- ver la misma nota en
// src/lib/bulk-import/patients.ts.

type Obj<T> = T | T[] | null;

/**
 * Lee (con el cliente del usuario: RLS aísla la clínica) las reclamaciones registradas en el
 * periodo y su historial de estados, paginado, y arma el reporte. Nada se calcula entre
 * clínicas: RLS solo entrega las de la clínica del usuario.
 *
 * El historial se filtra por `changed_at >= inicio del periodo`: como las reclamaciones del
 * periodo se crearon después del inicio, TODOS sus cambios de estado están en ese rango.
 */
export async function loadClaimsReport(
  supabase: SupabaseClient<Database>,
  period: string
): Promise<{ report: ClaimsReport; today: string; since: string | null }> {
  const today = todayInSantoDomingo();
  const since = periodStart(period, today);
  // Santo Domingo es UTC-4 todo el año (sin horario de verano): 00:00 local = 04:00 UTC.
  const sinceTimestamp = since ? `${since}T04:00:00Z` : null;

  const claimRows = await fetchAllPages(async (from, to) => {
    let query = supabase
      .from("insurance_claims")
      .select(
        "id, status, claimed_amount, approved_amount, paid_amount, rejection_reason, created_at, patient_insurers(insurer_id, insurer_name)"
      );
    if (sinceTimestamp) query = query.gte("created_at", sinceTimestamp);
    return query.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
  });

  const historyRows = await fetchAllPages(async (from, to) => {
    let query = supabase.from("insurance_claim_status_history").select("id, claim_id, to_status, changed_at");
    if (sinceTimestamp) query = query.gte("changed_at", sinceTimestamp);
    return query.order("changed_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
  });

  const claims: ReportClaim[] = (
    claimRows as unknown as (Omit<ReportClaim, "insurer_key" | "insurer_label"> & {
      patient_insurers: Obj<{ insurer_id: string | null; insurer_name: string }>;
    })[]
  ).map((r) => {
    const ins = Array.isArray(r.patient_insurers) ? r.patient_insurers[0] : r.patient_insurers;
    return {
      id: r.id,
      status: r.status,
      claimed_amount: r.claimed_amount,
      approved_amount: r.approved_amount,
      paid_amount: r.paid_amount,
      rejection_reason: r.rejection_reason,
      created_at: r.created_at,
      insurer_key: ins ? insurerKey(ins) : "name:sin-aseguradora",
      insurer_label: ins ? ins.insurer_name : "Sin aseguradora",
    };
  });

  const transitions = historyRows as unknown as ReportTransition[];
  return { report: buildClaimsReport(claims, transitions, today), today, since };
}
