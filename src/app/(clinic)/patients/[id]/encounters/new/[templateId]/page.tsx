import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { parseTemplateSchema } from "@/lib/domain/specialty-template";
import { EncounterForm } from "./encounter-form";
import { isClinicReadOnly, ReadOnlyPage } from "@/app/(clinic)/_components/read-only-notice";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";
import { RecordRequired } from "@/app/(clinic)/_components/record-required";

export default async function NewEncounterFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; templateId: string }>;
  searchParams: Promise<{ appointmentId?: string }>;
}) {
  const { id, templateId } = await params;
  const { appointmentId: appointmentIdParam } = await searchParams;
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
    .select("id, name, schema, is_active")
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

  return (
    <>
      <PageHeader
        title={<>Nueva consulta — {template.name}</>}
        subtitle={<>{patient.first_name} {patient.last_name}</>}
        back={{ href: appointmentId ? "/appointments" : `/patients/${id}/encounters/new`, label: <>{appointmentId ? "Agenda" : "Elegir especialidad"}</> }}
      />
      <PageBody narrow>
      <EncounterForm patientId={id} templateId={template.id} appointmentId={appointmentId} fields={fields} />
      </PageBody>
    </>
  );
}
