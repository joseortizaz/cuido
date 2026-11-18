import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentClinicMembership } from "@/lib/supabase/clinic-context";
import { isClinicReadOnly, ReadOnlyPage } from "@/app/(clinic)/_components/read-only-notice";
import { PageBody, PageHeader } from "@/app/(clinic)/_components/page-header";
import { sectionsForSex } from "@/lib/domain/medical-history";
import { HistoryForm } from "../history-form";
import { openPatientRecord } from "../actions";

/** «Abrir Expediente»: historia general del paciente (todo opcional). Sin expediente no hay consultas. */
export default async function OpenRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const membership = await getCurrentClinicMembership(supabase);
  if (!membership) redirect("/onboarding");
  if (membership.role !== "admin" && membership.role !== "medico") redirect(`/patients/${id}`);
  if (await isClinicReadOnly()) return <ReadOnlyPage backHref={`/patients/${id}`} backLabel="Paciente" />;

  const { data: patient } = await supabase
    .from("patients")
    .select("id, first_name, last_name, record_number, sex, voided_at")
    .eq("id", id)
    .maybeSingle();
  if (!patient) notFound();
  if (patient.voided_at !== null) redirect(`/patients/${id}`);

  const { data: record } = await supabase.from("patient_records").select("id").eq("patient_id", id).maybeSingle();
  if (record) redirect(`/patients/${id}?tab=expediente`);

  return (
    <>
      <PageHeader
        title="Abrir expediente"
        subtitle={
          <>
            {patient.first_name} {patient.last_name} · Código {patient.record_number}
          </>
        }
        back={{ href: `/patients/${id}`, label: <>{patient.first_name} {patient.last_name}</> }}
      />
      <PageBody narrow>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Registra la historia general del paciente. Todo es opcional y se puede completar o corregir después; cada ajuste
          queda registrado. Mientras el expediente no esté abierto, no se pueden registrar consultas. Las alergias y los
          medicamentos activos se agregan en el expediente una vez abierto.
        </p>
        <HistoryForm
          action={openPatientRecord.bind(null, id)}
          sections={sectionsForSex(patient.sex)}
          initialValues={{}}
          submitLabel="Abrir expediente"
          cancelHref={`/patients/${id}`}
          withReason={false}
        />
      </PageBody>
    </>
  );
}
