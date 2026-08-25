import { createClient } from "@/lib/supabase/server";

/**
 * Dashboard de médico -- deliberadamente simple: solo su propia agenda
 * de hoy y cuántos pacientes ha atendido en total. Nada de
 * fiscal/ARS/plan (eso es "Tu clínica", solo admin/recepción).
 */

const APPOINTMENT_STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  confirmada: "Confirmada",
  completada: "Completada",
  cancelada: "Cancelada",
  no_show: "No-show",
};

export async function DoctorDashboard({ userId }: { userId: string }) {
  const supabase = await createClient();

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfToday.getDate() + 1);

  const [{ data: appointments }, { data: attendedEncounters }] = await Promise.all([
    supabase
      .from("appointments")
      // .eq("provider_id", userId) es redundante con RLS (un médico solo
      // ve sus propias citas, appointments_select) -- explícito a
      // propósito, no depende únicamente de que la política no cambie.
      .select("id, patient_id, specialty_template_id, scheduled_at, status, reason")
      .eq("provider_id", userId)
      .gte("scheduled_at", startOfToday.toISOString())
      .lt("scheduled_at", startOfTomorrow.toISOString())
      .order("scheduled_at"),
    supabase.from("encounters").select("patient_id").eq("provider_id", userId),
  ]);

  const patientIds = Array.from(new Set((appointments ?? []).map((a) => a.patient_id)));
  const templateIds = Array.from(new Set((appointments ?? []).map((a) => a.specialty_template_id)));
  const [{ data: patients }, { data: templates }] = await Promise.all([
    patientIds.length
      ? supabase.from("patients").select("id, first_name, last_name").in("id", patientIds)
      : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
    templateIds.length
      ? supabase.from("specialty_templates").select("id, name").in("id", templateIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const patientById = new Map((patients ?? []).map((p) => [p.id, `${p.first_name} ${p.last_name}`]));
  const templateById = new Map((templates ?? []).map((t) => [t.id, t.name]));

  // PostgREST no da COUNT DISTINCT -- clínicas pequeñas, deduplicar en
  // JS sobre un solo campo es barato.
  const attendedPatientCount = new Set((attendedEncounters ?? []).map((e) => e.patient_id)).size;

  const formatTime = (value: string) => new Date(value).toLocaleTimeString("es-DO", { timeStyle: "short" });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-12">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Mis citas de hoy</h2>
        {!appointments || appointments.length === 0 ? (
          <p className="text-sm text-zinc-500">Sin citas agendadas para hoy.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
            {appointments.map((a) => (
              <li key={a.id} className="flex flex-col gap-0.5 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {formatTime(a.scheduled_at)} · {patientById.get(a.patient_id) ?? "—"}
                  </span>
                  <span className="text-xs text-zinc-500">{APPOINTMENT_STATUS_LABELS[a.status] ?? a.status}</span>
                </div>
                <span className="text-xs text-zinc-500">
                  {templateById.get(a.specialty_template_id) ?? "—"}
                  {a.reason ? ` · ${a.reason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Has atendido a <strong>{attendedPatientCount}</strong> paciente{attendedPatientCount === 1 ? "" : "s"} en total.
      </p>
    </div>
  );
}
