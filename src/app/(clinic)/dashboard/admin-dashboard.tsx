import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BUSINESS_MODEL_LABELS, PAYMENT_STATUS_LABELS, formatPrice } from "@/app/operator/labels";

/**
 * Dashboard de admin/recepción -- comparten la misma vista (confirmado
 * con el usuario: RLS no distingue entre ellos en ninguna de estas
 * tablas -- clinic_subscriptions/fiscal_documents/insurance_claims son
 * legibles por cualquier is_clinic_member -- así que no hay una razón
 * real para separarlas todavía).
 *
 * Todo dato es real -- sin gráficas ni métricas que se vean vacías con
 * poco volumen. Cada bloque con lista vacía muestra un mensaje
 * explícito, nunca se omite ni muestra un "0" desnudo.
 */

const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  confirmada: "Confirmada",
  completada: "Completada",
  cancelada: "Cancelada",
  no_show: "No-show",
};

const CLAIM_STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  enviada: "Enviada",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Administradores",
  medico: "Médicos",
  recepcion: "Recepción",
};

// Reclamación ARS "atrasada": lleva más de 7 días en su estado ACTUAL
// (pendiente/enviada) -- COALESCE(status_updated_at, created_at) porque
// status_updated_at es nullable (solo se llena cuando el estado
// cambia, src/app/(clinic)/claims/actions.ts) -- una reclamación que
// nunca se tocó desde que se creó no debe escapar el umbral por tener
// esa columna en null.
const CLAIM_OVERDUE_DAYS = 7;

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24));
}

export async function AdminDashboard({
  clinicId,
  businessModel,
}: {
  clinicId: string;
  businessModel: string;
}) {
  const supabase = await createClient();

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfToday.getDate() + 1);
  const todayParam = toDateInputValue(startOfToday);

  const [
    { data: todayAppointments },
    { data: fiscalDocs, count: fiscalDocsCount },
    { data: claimsRaw },
    { count: patientCount },
    { data: members },
    { data: subscription },
  ] = await Promise.all([
    supabase
      .from("appointments")
      .select("id, status")
      .gte("scheduled_at", startOfToday.toISOString())
      .lt("scheduled_at", startOfTomorrow.toISOString()),
    supabase
      .from("fiscal_documents")
      .select("id, e_ncf, comprador_nombre, created_at", { count: "exact" })
      .eq("status", "generado")
      .order("created_at", { ascending: true })
      .limit(5),
    supabase
      .from("insurance_claims")
      .select("id, status, created_at, status_updated_at, encounter_id")
      .in("status", ["pendiente", "enviada"]),
    supabase.from("patients").select("id", { count: "exact", head: true }),
    supabase.from("clinic_members").select("role"),
    supabase.from("clinic_subscriptions").select("*").eq("clinic_id", clinicId).maybeSingle(),
  ]);

  // ---- Hoy ----
  const statusCounts: Record<string, number> = {};
  for (const a of todayAppointments ?? []) {
    statusCounts[a.status] = (statusCounts[a.status] ?? 0) + 1;
  }
  const todayTotal = todayAppointments?.length ?? 0;
  const todayPending = statusCounts.pendiente ?? 0;
  const todayHref = `/appointments?date=${todayParam}&view=day`;

  // ---- e-CF sin firmar ----
  const overdueFiscalDocs = fiscalDocs ?? [];
  const fiscalDocsTotal = fiscalDocsCount ?? 0;

  // ---- Reclamaciones ARS atrasadas ----
  const overdueClaims = (claimsRaw ?? [])
    .map((c) => ({ ...c, days: daysAgo(c.status_updated_at ?? c.created_at) }))
    .filter((c) => c.days >= CLAIM_OVERDUE_DAYS)
    .sort((a, b) => b.days - a.days);

  const claimEncounterIds = Array.from(new Set(overdueClaims.slice(0, 5).map((c) => c.encounter_id)));
  const { data: claimEncounters } =
    claimEncounterIds.length > 0
      ? await supabase.from("encounters").select("id, patient_id").in("id", claimEncounterIds)
      : { data: [] as { id: string; patient_id: string }[] };
  const claimPatientIds = Array.from(new Set((claimEncounters ?? []).map((e) => e.patient_id)));
  const { data: claimPatients } =
    claimPatientIds.length > 0
      ? await supabase.from("patients").select("id, first_name, last_name").in("id", claimPatientIds)
      : { data: [] as { id: string; first_name: string; last_name: string }[] };
  const patientByEncounterId = new Map(
    (claimEncounters ?? []).map((e) => {
      const p = (claimPatients ?? []).find((pt) => pt.id === e.patient_id);
      return [e.id, p ? `${p.first_name} ${p.last_name}` : "—"];
    })
  );

  // ---- Tu clínica ----
  const roleCounts: Record<string, number> = {};
  for (const m of members ?? []) {
    roleCounts[m.role] = (roleCounts[m.role] ?? 0) + 1;
  }

  const hasAlerts = fiscalDocsTotal > 0 || overdueClaims.length > 0 || todayPending > 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-12">
      {/* Hoy */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Hoy</h2>
          <Link href={todayHref} className="text-sm text-brand-blue hover:underline">
            Ver agenda →
          </Link>
        </div>
        {todayTotal === 0 ? (
          <p className="text-sm text-zinc-500">Sin citas agendadas para hoy.</p>
        ) : (
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-sm font-medium">
              {todayTotal} cita{todayTotal === 1 ? "" : "s"} hoy
            </p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
              {Object.entries(statusCounts).map(([status, count]) => (
                <span key={status}>
                  {APPOINTMENT_STATUS_LABELS[status] ?? status}: <strong>{count}</strong>
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Pendientes de atención */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Pendientes de atención</h2>
        {!hasAlerts ? (
          <p className="text-sm text-zinc-500">Nada pendiente por ahora — todo al día.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {todayPending > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/30">
                <Link href={todayHref} className="font-medium text-amber-900 hover:underline dark:text-amber-300">
                  {todayPending} cita{todayPending === 1 ? "" : "s"} de hoy sin confirmar →
                </Link>
              </div>
            )}

            {fiscalDocsTotal > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/30">
                <p className="font-medium text-amber-900 dark:text-amber-300">
                  {fiscalDocsTotal} e-CF generado{fiscalDocsTotal === 1 ? "" : "s"} sin firmar
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {overdueFiscalDocs.map((doc) => (
                    <li key={doc.id}>
                      <Link href={`/billing/${doc.id}`} className="text-amber-800 hover:underline dark:text-amber-400">
                        {doc.e_ncf ?? "(sin e-NCF)"} — {doc.comprador_nombre}
                      </Link>
                    </li>
                  ))}
                </ul>
                {fiscalDocsTotal > overdueFiscalDocs.length && (
                  <Link href="/billing" className="mt-2 inline-block text-xs text-amber-800 hover:underline dark:text-amber-400">
                    Ver los {fiscalDocsTotal - overdueFiscalDocs.length} restantes en Facturación →
                  </Link>
                )}
              </div>
            )}

            {overdueClaims.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm dark:border-amber-900 dark:bg-amber-950/30">
                <p className="font-medium text-amber-900 dark:text-amber-300">
                  {overdueClaims.length} reclamación{overdueClaims.length === 1 ? "" : "es"} ARS con {CLAIM_OVERDUE_DAYS}+ días sin
                  avanzar
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {overdueClaims.slice(0, 5).map((claim) => (
                    <li key={claim.id}>
                      <Link
                        href={`/claims?status=${claim.status}`}
                        className="text-amber-800 hover:underline dark:text-amber-400"
                      >
                        {patientByEncounterId.get(claim.encounter_id) ?? "—"} —{" "}
                        {CLAIM_STATUS_LABELS[claim.status] ?? claim.status} hace {claim.days} días
                      </Link>
                    </li>
                  ))}
                </ul>
                {overdueClaims.length > 5 && (
                  <Link href="/claims" className="mt-2 inline-block text-xs text-amber-800 hover:underline dark:text-amber-400">
                    Ver las {overdueClaims.length - 5} restantes en Reclamaciones →
                  </Link>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Tu clínica */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Tu clínica</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-xs text-zinc-500">Pacientes</p>
            <p className="mt-1 text-2xl font-semibold">{patientCount ?? 0}</p>
          </div>
          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-xs text-zinc-500">Equipo</p>
            <div className="mt-1 flex flex-col gap-0.5 text-sm">
              {Object.keys(ROLE_LABELS).map((role) => (
                <span key={role}>
                  {ROLE_LABELS[role]}: <strong>{roleCounts[role] ?? 0}</strong>
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 p-4 sm:col-span-2 dark:border-zinc-800">
            <p className="text-xs text-zinc-500">Plan y facturación</p>
            {subscription ? (
              <div className="mt-1 flex flex-col gap-0.5 text-sm">
                <span>{BUSINESS_MODEL_LABELS[businessModel] ?? businessModel}</span>
                <span>
                  Estado de pago:{" "}
                  <strong>{PAYMENT_STATUS_LABELS[subscription.payment_status] ?? subscription.payment_status}</strong>
                </span>
                <span>Precio: {formatPrice(subscription.price)}</span>
                {subscription.next_payment_due_on && (
                  <span>
                    Próximo pago:{" "}
                    {new Date(`${subscription.next_payment_due_on}T00:00:00`).toLocaleDateString("es-DO", {
                      dateStyle: "medium",
                    })}
                  </span>
                )}
              </div>
            ) : (
              <p className="mt-1 text-sm text-zinc-500">Sin información de plan todavía.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
