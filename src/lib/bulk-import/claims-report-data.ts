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
        "id, status, claimed_amount, approved_amount, paid_amount, rejection_reason, created_at, patient_insurers(insurer_id, insurer_name, patients(is_test))"
      );
    if (sinceTimestamp) query = query.gte("created_at", sinceTimestamp);
    return query.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
  });

  const historyRows = await fetchAllPages(async (from, to) => {
    let query = supabase
      .from("insurance_claim_status_history")
      .select("id, claim_id, to_status, changed_at, insurance_claims(patient_insurers(patients(is_test)))");
    if (sinceTimestamp) query = query.gte("changed_at", sinceTimestamp);
    return query.order("changed_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
  });

  // Las reclamaciones de pacientes de prueba (datos ficticios) no entran en los reportes.
  // El paciente sale de la aseguradora de la reclamación (recepción ya no lee las consultas).
  type TestFlag = Obj<{ patients: Obj<{ is_test: boolean }> }>;
  const isTestClaim = (insurer: TestFlag): boolean => {
    const e = Array.isArray(insurer) ? insurer[0] : insurer;
    const p = e ? (Array.isArray(e.patients) ? e.patients[0] : e.patients) : null;
    return p?.is_test === true;
  };

  const claims: ReportClaim[] = (
    (claimRows as unknown as (Omit<ReportClaim, "insurer_key" | "insurer_label"> & {
      patient_insurers: Obj<{ insurer_id: string | null; insurer_name: string; patients: Obj<{ is_test: boolean }> }>;
    })[]).filter((r) => !isTestClaim(r.patient_insurers as unknown as TestFlag))
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

  const transitions = (
    historyRows as unknown as (ReportTransition & { insurance_claims: Obj<{ patient_insurers: TestFlag }> })[]
  ).filter((h) => {
    const c = Array.isArray(h.insurance_claims) ? h.insurance_claims[0] : h.insurance_claims;
    return !(c && isTestClaim(c.patient_insurers));
  }) as ReportTransition[];
  return { report: buildClaimsReport(claims, transitions, today), today, since };
}
