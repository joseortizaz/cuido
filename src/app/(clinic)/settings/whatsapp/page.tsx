import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isClinicReadOnly } from "@/app/(clinic)/_components/read-only-notice";
import { formatDrDateTime } from "@/lib/domain/dr-time";
import { RemindersToggleForm } from "./settings-form";

const STATUS_LABEL: Record<string, string> = {
  en_envio: "En envío",
  enviado: "Enviado",
  omitido: "Omitido",
  fallido: "No se pudo enviar",
};
const RESPONSE_LABEL: Record<string, string> = { confirmar: "Confirmó", cancelar: "Canceló" };

/**
 * Ajustes de WhatsApp de la clínica (solo admin): interruptor de los recordatorios de citas y
 * lista de los últimos recordatorios con lo que respondió cada paciente.
 */
export default async function WhatsAppSettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin") redirect("/dashboard");
  const readOnly = await isClinicReadOnly();

  const sinceDate = new Date();
  sinceDate.setUTCDate(sinceDate.getUTCDate() - 30);
  const since = sinceDate.toISOString();
  const [{ data: settings }, { data: reminders }] = await Promise.all([
    supabase.from("clinic_whatsapp_settings").select("reminders_enabled").eq("clinic_id", membership.clinicId).maybeSingle(),
    supabase
      .from("appointment_reminders")
      .select("id, appointment_id, status, response, responded_at, claimed_at, sent_at")
      .gte("claimed_at", since)
      .order("claimed_at", { ascending: false })
      .limit(100),
  ]);

  const appointmentIds = (reminders ?? []).map((r) => r.appointment_id);
  const { data: appointments } = appointmentIds.length
    ? await supabase.from("appointments").select("id, patient_id, scheduled_at").in("id", appointmentIds)
    : { data: [] as { id: string; patient_id: string; scheduled_at: string }[] };
  const patientIds = Array.from(new Set((appointments ?? []).map((a) => a.patient_id)));
  const { data: patients } = patientIds.length
    ? await supabase.from("patients").select("id, first_name, last_name").in("id", patientIds)
    : { data: [] as { id: string; first_name: string; last_name: string }[] };
  const apptById = new Map((appointments ?? []).map((a) => [a.id, a]));
  const patientName = new Map((patients ?? []).map((p) => [p.id, `${p.first_name} ${p.last_name}`]));

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <div>
        <Link href="/appointments" className="text-sm text-zinc-500 hover:underline">
          ← Agenda
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">Recordatorios por WhatsApp</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Cuido envía a cada paciente <strong>un recordatorio</strong> de su cita, la víspera a las 9:00 a. m., desde el
          número de WhatsApp de Cuido, con la clínica, la fecha y la hora, y botones para confirmar o cancelar.
        </p>
      </div>

      <section className="flex flex-col gap-3">
        <RemindersToggleForm enabled={settings?.reminders_enabled === true} disabled={readOnly} />
        <ul className="list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400">
          <li>Solo se envía a pacientes que aceptaron (se registra en su ficha) y a su teléfono registrado.</li>
          <li>El paciente puede dejar de recibirlos respondiendo BAJA, y tú puedes revocarlo en su ficha.</li>
          <li>Las citas de Salud Mental / Psicología nunca reciben recordatorio automático.</li>
          <li>Si la clínica está en solo lectura o suspendida, no se envía.</li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium">Últimos 30 días</h2>
        {(reminders ?? []).length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Todavía no se ha enviado ningún recordatorio.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-zinc-100 text-sm dark:divide-zinc-900">
            {(reminders ?? []).map((r) => {
              const appt = apptById.get(r.appointment_id);
              return (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>
                    <span className="font-medium">{appt ? (patientName.get(appt.patient_id) ?? "Paciente") : "Cita eliminada"}</span>
                    {appt ? ` · cita ${formatDrDateTime(appt.scheduled_at, { dateStyle: "medium", timeStyle: "short" })}` : ""}
                  </span>
                  <span className="text-zinc-500">
                    {STATUS_LABEL[r.status] ?? r.status}
                    {r.response ? ` · ${RESPONSE_LABEL[r.response] ?? r.response}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
