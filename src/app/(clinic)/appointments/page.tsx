import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { AppointmentRowActions } from "./appointment-row-actions";

const STATUS_LABELS: Record<string, string> = {
  pendiente: "Pendiente",
  confirmada: "Confirmada",
  completada: "Completada",
  cancelada: "Cancelada",
  no_show: "No-show",
};

function parseDateParam(value: string | undefined): Date {
  if (value) {
    const parsed = new Date(`${value}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Lunes de la semana que contiene `date` (semana lunes→domingo). */
function startOfWeek(date: Date): Date {
  const day = date.getDay(); // 0 = domingo
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);
  return monday;
}

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string; providerId?: string }>;
}) {
  const { date: dateParam, view: viewParam, providerId: providerIdParam } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");

  const canManage = membership.role === "admin" || membership.role === "recepcion";
  const canConvert = membership.role === "admin" || membership.role === "medico";

  const view = viewParam === "week" ? "week" : "day";
  const selectedDate = parseDateParam(dateParam);
  const rangeStart = view === "week" ? startOfWeek(selectedDate) : selectedDate;
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeStart.getDate() + (view === "week" ? 7 : 1));

  let query = supabase
    .from("appointments")
    .select("id, patient_id, provider_id, specialty_template_id, scheduled_at, reason, status")
    .gte("scheduled_at", rangeStart.toISOString())
    .lt("scheduled_at", rangeEnd.toISOString())
    .order("scheduled_at");

  // El filtro por médico solo tiene sentido para quien ve la clínica
  // completa (admin/recepción) -- un médico ya solo ve lo suyo vía RLS,
  // así que ignoramos el query param en su caso en vez de dejarlo
  // filtrar sobre un conjunto que ya está vacío para cualquier otro id.
  if (canManage && providerIdParam) {
    query = query.eq("provider_id", providerIdParam);
  }

  const { data: appointments } = await query;

  const patientIds = Array.from(new Set((appointments ?? []).map((a) => a.patient_id)));
  const providerIds = Array.from(new Set((appointments ?? []).map((a) => a.provider_id)));
  const templateIds = Array.from(new Set((appointments ?? []).map((a) => a.specialty_template_id)));
  const appointmentIds = (appointments ?? []).map((a) => a.id);

  const [{ data: patients }, { data: templates }, { data: linkedEncounters }, { data: clinicMembers }] =
    await Promise.all([
      patientIds.length
        ? supabase.from("patients").select("id, first_name, last_name").in("id", patientIds)
        : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[] }),
      templateIds.length
        ? supabase.from("specialty_templates").select("id, name").in("id", templateIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      appointmentIds.length
        ? supabase.from("encounters").select("appointment_id").in("appointment_id", appointmentIds)
        : Promise.resolve({ data: [] as { appointment_id: string | null }[] }),
      canManage
        ? supabase.from("clinic_members").select("user_id, role").in("role", ["admin", "medico"])
        : Promise.resolve({ data: [] as { user_id: string; role: string }[] }),
    ]);

  // El email no vive en clinic_members/appointments (auth.users no está
  // expuesto vía la Data API) -- se resuelve server-side con el cliente
  // admin, mismo patrón que src/app/team/page.tsx.
  const admin = createAdminClient();
  const emailByUserId = new Map<string, string>();
  const idsToResolve = canManage ? Array.from(new Set([...providerIds, ...(clinicMembers ?? []).map((m) => m.user_id)])) : providerIds;
  await Promise.all(
    idsToResolve.map(async (userId) => {
      const { data } = await admin.auth.admin.getUserById(userId);
      if (data.user?.email) emailByUserId.set(userId, data.user.email);
    })
  );

  const patientById = new Map((patients ?? []).map((p) => [p.id, `${p.first_name} ${p.last_name}`]));
  const templateById = new Map((templates ?? []).map((t) => [t.id, t.name]));
  const linkedAppointmentIds = new Set((linkedEncounters ?? []).map((e) => e.appointment_id).filter(Boolean));

  const formatTime = (value: string) =>
    new Date(value).toLocaleString("es-DO", { dateStyle: view === "week" ? "medium" : undefined, timeStyle: "short" });

  const prevDate = new Date(rangeStart);
  prevDate.setDate(rangeStart.getDate() - (view === "week" ? 7 : 1));
  const nextDate = new Date(rangeStart);
  nextDate.setDate(rangeStart.getDate() + (view === "week" ? 7 : 1));

  const providerParam = providerIdParam ? `&providerId=${providerIdParam}` : "";

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-16">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Agenda</h1>
        {canManage && (
          <Link
            href="/appointments/new"
            className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
          >
            Nueva cita
          </Link>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Link
          href={`/appointments?date=${toDateInputValue(prevDate)}&view=${view}${providerParam}`}
          className="text-zinc-500 hover:underline"
        >
          ← Anterior
        </Link>
        <span className="font-medium">
          {view === "day"
            ? selectedDate.toLocaleDateString("es-DO", { dateStyle: "full" })
            : `Semana del ${startOfWeek(selectedDate).toLocaleDateString("es-DO", { dateStyle: "medium" })}`}
        </span>
        <Link
          href={`/appointments?date=${toDateInputValue(nextDate)}&view=${view}${providerParam}`}
          className="text-zinc-500 hover:underline"
        >
          Siguiente →
        </Link>
        <span className="ml-auto flex gap-2">
          <Link
            href={`/appointments?date=${toDateInputValue(selectedDate)}&view=day${providerParam}`}
            className={view === "day" ? "font-medium text-brand-blue" : "text-zinc-500 hover:underline"}
          >
            Día
          </Link>
          <Link
            href={`/appointments?date=${toDateInputValue(selectedDate)}&view=week${providerParam}`}
            className={view === "week" ? "font-medium text-brand-blue" : "text-zinc-500 hover:underline"}
          >
            Semana
          </Link>
        </span>
      </div>

      {canManage && (clinicMembers ?? []).length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Link
            href={`/appointments?date=${toDateInputValue(selectedDate)}&view=${view}`}
            className={!providerIdParam ? "font-medium text-brand-blue" : "text-zinc-500 hover:underline"}
          >
            Toda la clínica
          </Link>
          {(clinicMembers ?? []).map((m) => (
            <Link
              key={m.user_id}
              href={`/appointments?date=${toDateInputValue(selectedDate)}&view=${view}&providerId=${m.user_id}`}
              className={
                providerIdParam === m.user_id ? "font-medium text-brand-blue" : "text-zinc-500 hover:underline"
              }
            >
              {emailByUserId.get(m.user_id) ?? m.user_id}
            </Link>
          ))}
        </div>
      )}

      {!appointments || appointments.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin citas en este rango.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {appointments.map((appt) => {
            const alreadyConverted = linkedAppointmentIds.has(appt.id);
            const convertible = canConvert && !alreadyConverted && (appt.status === "pendiente" || appt.status === "confirmada");
            return (
              <li key={appt.id} className="flex flex-col gap-2 py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      {formatTime(appt.scheduled_at)} · {patientById.get(appt.patient_id) ?? appt.patient_id}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {templateById.get(appt.specialty_template_id) ?? "—"} ·{" "}
                      {emailByUserId.get(appt.provider_id) ?? appt.provider_id}
                      {appt.reason ? ` · ${appt.reason}` : ""}
                    </p>
                  </div>
                  <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                    {STATUS_LABELS[appt.status] ?? appt.status}
                  </span>
                </div>
                <AppointmentRowActions
                  appointmentId={appt.id}
                  currentStatus={appt.status}
                  canManage={canManage}
                  convertHref={
                    convertible
                      ? `/patients/${appt.patient_id}/encounters/new/${appt.specialty_template_id}?appointmentId=${appt.id}`
                      : null
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
