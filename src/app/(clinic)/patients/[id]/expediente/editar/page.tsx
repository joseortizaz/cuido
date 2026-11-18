import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isClinicReadOnly, ReadOnlyPage } from "@/app/(clinic)/_components/read-only-notice";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";
import { findSection, sectionsForSex } from "@/lib/domain/medical-history";
import { HistoryForm } from "../history-form";
import { savePatientHistory } from "../actions";

/** Completar o corregir una sección de la historia general (con motivo opcional del ajuste). */
export default async function EditHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ seccion?: string }>;
}) {
  const { id } = await params;
  const { seccion } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") redirect(`/patients/${id}`);
  if (await isClinicReadOnly()) return <ReadOnlyPage backHref={`/patients/${id}?tab=expediente`} backLabel="Expediente" />;

  const { data: patient } = await supabase
    .from("patients")
    .select("id, first_name, last_name, record_number, sex, voided_at")
    .eq("id", id)
    .maybeSingle();
  if (!patient) notFound();
  if (patient.voided_at !== null) redirect(`/patients/${id}`);

  const [{ data: record }, { data: history }] = await Promise.all([
    supabase.from("patient_records").select("id").eq("patient_id", id).maybeSingle(),
    supabase.from("patient_medical_history").select("*").eq("patient_id", id).maybeSingle(),
  ]);
  if (!record) redirect(`/patients/${id}/expediente/abrir`);

  const all = sectionsForSex(patient.sex);
  const section = seccion && seccion !== "todas" ? findSection(seccion) : undefined;
  const sections = section && all.some((s) => s.id === section.id) ? [section] : all;
  const sectionId = sections.length === 1 ? sections[0].id : "todas";

  const initialValues: Record<string, string> = {};
  for (const s of sections) {
    for (const f of s.fields) initialValues[f.key] = (history?.[f.key] as string | null | undefined) ?? "";
  }

  return (
    <>
      <PageHeader
        title={sections.length === 1 ? `Completar o corregir: ${sections[0].title}` : "Completar o corregir la historia general"}
        subtitle={
          <>
            {patient.first_name} {patient.last_name} · Código {patient.record_number}
          </>
        }
        back={{ href: `/patients/${id}?tab=expediente`, label: "Expediente" }}
      />
      <PageBody narrow>
        <HistoryForm
          action={savePatientHistory.bind(null, id, sectionId)}
          sections={sections}
          initialValues={initialValues}
          submitLabel="Guardar ajuste"
          cancelHref={`/patients/${id}?tab=expediente`}
          withReason
        />
      </PageBody>
    </>
  );
}
