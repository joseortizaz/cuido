import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { activeFieldsForType, parseTemplateSchema } from "@/lib/domain/specialty-template";
import {
  ENCOUNTER_TYPE_LABELS,
  FIXED_TYPE_BY_TEMPLATE_CODE,
  TEMPLATE_REDIRECT_BY_TYPE,
  isEncounterType,
} from "@/lib/domain/encounter-types";
import { EncounterForm } from "./encounter-form";
import { EncounterTypeChooser } from "./type-chooser";
import { isClinicReadOnly, ReadOnlyPage } from "@/app/(clinic)/_components/read-only-notice";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";
import { RecordRequired } from "@/app/(clinic)/_components/record-required";
import { PatientSummaryCard, loadPatientSummary } from "@/app/(clinic)/_components/patient-summary-card";

/**
 * Flujo de nueva consulta: especialidad (el picker) → tipo (aquí, si no viene en la URL) → formulario.
 * Los tipos quirúrgicos de las plantillas quirúrgicas existentes ya traen su tipo fijo; en Ortopedia la
 * postquirúrgica apunta a su nota operatoria.
 */
export default async function NewEncounterFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; templateId: string }>;
  searchParams: Promise<{ appointmentId?: string; tipo?: string }>;
}) {
  const { id, templateId } = await params;
  const { appointmentId: appointmentIdParam, tipo } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") {
    redirect(`/patients/${id}`);
  }
  if (await isClinicReadOnly()) {
    return <ReadOnlyPage backHref={`/patients/${id}`} backLabel="Paciente" />;
  }

  const { data: patient } = await supabase
    .from("patients")
    .select("id, first_name, last_name")
    .eq("id", id)
    .maybeSingle();
  if (!patient) notFound();

  const { data: openRecord } = await supabase.from("patient_records").select("id").eq("patient_id", id).maybeSingle();
  if (!openRecord) return <RecordRequired patientId={id} patientName={`${patient.first_name} ${patient.last_name}`} />;

  const { data: template } = await supabase
    .from("specialty_templates")
    .select("id, code, name, schema, is_active")
    .eq("id", templateId)
    .maybeSingle();
  if (!template || !template.is_active) notFound();

  const { fields } = parseTemplateSchema(template.schema);

  // Defensa en profundidad: nunca confiar ciegamente en el query param
  // -- se verifica que la cita exista, sea de este paciente y ya tenga
  // fijada esta misma especialidad, antes de ofrecer saltar el picker.
  let appointmentId: string | null = null;
  if (appointmentIdParam) {
    const { data: appointment } = await supabase
      .from("appointments")
      .select("id")
      .eq("id", appointmentIdParam)
      .eq("patient_id", id)
      .eq("specialty_template_id", templateId)
      .maybeSingle();
    if (appointment) appointmentId = appointment.id;
  }

  const fixedType = FIXED_TYPE_BY_TEMPLATE_CODE[template.code];
  const type = fixedType ?? (isEncounterType(tipo) ? tipo : null);
  const backHref = appointmentId ? "/appointments" : `/patients/${id}/encounters/new`;
  const backLabel = appointmentId ? "Agenda" : "Elegir especialidad";

  // Paso 2: elegir el tipo de consulta.
  if (!type) {
    return (
      <>
        <PageHeader
          title={<>Nueva consulta — {template.name}</>}
          subtitle={<>{patient.first_name} {patient.last_name}</>}
          back={{ href: backHref, label: <>{backLabel}</> }}
        />
        <PageBody narrow>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">¿Qué tipo de consulta es?</p>
          <EncounterTypeChooser patientId={id} templateId={template.id} appointmentId={appointmentId} />
        </PageBody>
      </>
    );
  }

  // En algunas especialidades el tipo se registra con otra plantilla (la quirúrgica existente).
  const redirectCode = TEMPLATE_REDIRECT_BY_TYPE[template.code]?.[type];
  if (redirectCode) {
    const { data: target } = await supabase
      .from("specialty_templates")
      .select("id")
      .eq("code", redirectCode)
      .eq("is_active", true)
      .maybeSingle();
    if (target) {
      redirect(
        `/patients/${id}/encounters/new/${target.id}?tipo=${type}${appointmentId ? `&appointmentId=${appointmentId}` : ""}`
      );
    }
  }

  const summary = await loadPatientSummary(supabase, id);

  return (
    <>
      <PageHeader
        title={<>Nueva consulta — {template.name}</>}
        subtitle={
          <>
            {patient.first_name} {patient.last_name} · {ENCOUNTER_TYPE_LABELS[type]}
          </>
        }
        back={{
          href: fixedType ? backHref : `/patients/${id}/encounters/new/${template.id}${appointmentId ? `?appointmentId=${appointmentId}` : ""}`,
          label: <>{fixedType ? backLabel : "Cambiar tipo de consulta"}</>,
        }}
      />
      <PageBody narrow>
        <PatientSummaryCard summary={summary} patientId={id} />
        <EncounterForm
          patientId={id}
          templateId={template.id}
          appointmentId={appointmentId}
          encounterType={type}
          fields={activeFieldsForType(fields, type)}
        />
      </PageBody>
    </>
  );
}
