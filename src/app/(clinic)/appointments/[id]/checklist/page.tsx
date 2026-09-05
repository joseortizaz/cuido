import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { ChecklistForm } from "./checklist-form";

/**
 * Checklist prequirúrgico de una cita con appointment_type =
 * 'procedimiento_quirurgico'. La fila de appointment_surgical_checklist
 * debería existir siempre (trigger appointments_create_surgical_checklist,
 * supabase/migrations/20260906100000_appointment_type_y_checklist_quirurgico.sql
 * la crea al agendar/convertir la cita) -- el INSERT de más abajo es solo
 * una red de seguridad, no el camino esperado.
 *
 * El estado de "consentimiento informado" NO es un campo de este
 * checklist: se resuelve en vivo consultando `consents` por patient_id
 * (requisito explícito del usuario -- nunca un booleano manual sin
 * verificación real). `consents` no tiene ni necesita un vínculo a
 * `appointments` -- un consentimiento es per-paciente, no per-visita.
 */
export default async function SurgicalChecklistPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") {
    redirect("/appointments");
  }

  const { data: appointment } = await supabase
    .from("appointments")
    .select("id, clinic_id, patient_id, scheduled_at, appointment_type")
    .eq("id", id)
    .maybeSingle();

  if (!appointment || appointment.appointment_type !== "procedimiento_quirurgico") {
    notFound();
  }

  const { data: patient } = await supabase
    .from("patients")
    .select("first_name, last_name")
    .eq("id", appointment.patient_id)
    .maybeSingle();

  let { data: checklist } = await supabase
    .from("appointment_surgical_checklist")
    .select("evaluacion_cardiovascular, analiticas_sangre, implantes_aprobados_seguro")
    .eq("appointment_id", id)
    .maybeSingle();

  if (!checklist) {
    const { data: created } = await supabase
      .from("appointment_surgical_checklist")
      // clinic_id se deriva aquí de la cita ya cargada arriba, y de nuevo
      // se valida vía RLS (is_clinic_clinician) -- mismo principio que el
      // resto de los INSERT del proyecto: el valor del cliente nunca es
      // la barrera de seguridad real.
      .insert({ appointment_id: id, clinic_id: appointment.clinic_id })
      .select("evaluacion_cardiovascular, analiticas_sangre, implantes_aprobados_seguro")
      .single();
    checklist = created;
  }

  if (!checklist) notFound();

  // Consentimiento firmado más reciente del paciente -- consents no
  // distingue "para esta cirugía" de "en general" salvo por el template
  // usado, así que si hay uno con el template quirúrgico específico
  // (sembrado en la misma migración) se destaca como más preciso.
  const { data: consent } = await supabase
    .from("consents")
    .select("signed_at, consent_template_id")
    .eq("patient_id", appointment.patient_id)
    .eq("status", "firmado")
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: surgicalTemplate } = await supabase
    .from("consent_templates")
    .select("id")
    .eq("code", "consentimiento_quirurgico")
    .maybeSingle();

  const isSurgicalConsent =
    !!consent && !!surgicalTemplate && consent.consent_template_id === surgicalTemplate.id;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-6 py-16">
      <div>
        <Link href="/appointments" className="text-sm text-zinc-500 hover:underline">
          ← Volver a la agenda
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Checklist prequirúrgico</h1>
        <p className="text-sm text-zinc-500">
          {patient ? `${patient.first_name} ${patient.last_name}` : appointment.patient_id} ·{" "}
          {new Date(appointment.scheduled_at).toLocaleString("es-DO", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
      </div>

      <div className="rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <p className="text-sm font-medium">Consentimiento informado</p>
        {consent ? (
          <p className="mt-1 text-sm text-green-700 dark:text-green-400">
            Firmado el{" "}
            {new Date(consent.signed_at).toLocaleDateString("es-DO", { dateStyle: "medium" })}
            {isSurgicalConsent
              ? " (consentimiento quirúrgico específico)."
              : " (consentimiento general del paciente)."}
          </p>
        ) : (
          <p className="mt-1 text-sm text-red-600 dark:text-red-400">
            Sin consentimiento firmado para este paciente. Debe firmarse antes del procedimiento.
          </p>
        )}
        <p className="mt-1 text-xs text-zinc-500">
          Este estado se verifica en vivo contra los consentimientos firmados del paciente — no es
          un campo manual.
        </p>
      </div>

      <ChecklistForm
        appointmentId={id}
        evaluacionCardiovascular={checklist.evaluacion_cardiovascular}
        analiticasSangre={checklist.analiticas_sangre}
        implantesAprobadosSeguro={checklist.implantes_aprobados_seguro}
      />
    </div>
  );
}
