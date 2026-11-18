import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isClinicReadOnly, ReadOnlyPage } from "@/app/(clinic)/_components/read-only-notice";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";
import type { StudyValue } from "@/lib/domain/study-results";
import { StudyForm } from "../../study-form";
import { updateStudy } from "../../actions";

/** Completar o corregir un estudio: cada ajuste deja una revisión con su motivo. */
export default async function EditStudyPage({ params }: { params: Promise<{ id: string; studyId: string }> }) {
  const { id, studyId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") redirect(`/patients/${id}`);
  const back = `/patients/${id}/studies/${studyId}`;
  if (await isClinicReadOnly()) return <ReadOnlyPage backHref={back} backLabel="Estudio" />;

  const { data: study } = await supabase.from("study_results").select("*").eq("id", studyId).eq("patient_id", id).maybeSingle();
  if (!study) notFound();
  if (study.status === "anulado") redirect(back);
  const { data: patient } = await supabase.from("patients").select("voided_at").eq("id", id).maybeSingle();
  if (!patient || patient.voided_at !== null) redirect(`/patients/${id}`);

  return (
    <>
      <PageHeader title={`Completar o corregir: ${study.study_name}`} back={{ href: back, label: "Estudio" }} />
      <PageBody narrow>
        <StudyForm
          action={updateStudy.bind(null, id, studyId)}
          mode="edit"
          cancelHref={back}
          initial={{
            category: study.category,
            study_name: study.study_name,
            ordered_at: study.ordered_at ?? "",
            performed_at: study.performed_at ?? "",
            status: study.status === "recibido" ? "recibido" : "pendiente",
            result_text: study.result_text ?? "",
            interpretation: study.interpretation ?? "",
            values: (Array.isArray(study.result_values) ? study.result_values : []) as unknown as StudyValue[],
          }}
        />
      </PageBody>
    </>
  );
}
