import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isClinicReadOnly, ReadOnlyPage } from "@/app/(clinic)/_components/read-only-notice";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";
import { RecordRequired } from "@/app/(clinic)/_components/record-required";
import { StudyForm } from "../study-form";
import { createStudy } from "../actions";

/** Registrar el resultado de un estudio (o solo indicarlo). Solo admin y médicos. */
export default async function NewStudyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
    .select("id, first_name, last_name, record_number, voided_at")
    .eq("id", id)
    .maybeSingle();
  if (!patient) notFound();
  if (patient.voided_at !== null) redirect(`/patients/${id}`);
  const { data: record } = await supabase.from("patient_records").select("id").eq("patient_id", id).maybeSingle();
  if (!record) return <RecordRequired patientId={id} patientName={`${patient.first_name} ${patient.last_name}`} />;

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Santo_Domingo" });

  return (
    <>
      <PageHeader
        title="Registrar estudio o resultado"
        subtitle={
          <>
            {patient.first_name} {patient.last_name} · Código {patient.record_number}
          </>
        }
        back={{ href: `/patients/${id}?tab=expediente`, label: "Expediente" }}
      />
      <PageBody narrow>
        <StudyForm
          action={createStudy.bind(null, id)}
          mode="new"
          cancelHref={`/patients/${id}?tab=expediente`}
          initial={{
            category: "",
            study_name: "",
            ordered_at: "",
            performed_at: today,
            status: "recibido",
            result_text: "",
            interpretation: "",
            values: [],
          }}
        />
      </PageBody>
    </>
  );
}
